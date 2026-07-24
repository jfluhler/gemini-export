/* Smoke-test the bookmarklet: run it against a fake Gemini DOM and verify all
 * three buttons produce correct output.
 *
 * `src` is concatenated exactly the way build.js does it (app-core + panel),
 * so the .docx path is exercised as shipped. Gemini renders KaTeX with
 * output:'html' and exposes window.katex, so the fake page mirrors that: the
 * math elements carry ONLY data-math and no MathML, and katex lives on the
 * window rather than being bundled. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const src =
  fs.readFileSync(path.join(__dirname, '..', 'md2docx', 'app-core.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, '..', 'gemini-export.js'), 'utf8');

/* The nastiest equation from a real conversation: nested \left…\right fences,
 * \operatorname, and fractions inside delimiters. */
const HARD_TEX =
  '\\vert{}\\chi(\\tau_d, f_d)\\vert{} = \\left(1 - \\frac{\\vert{}\\tau_d\\vert{}}{\\tau}\\right) ' +
  '\\left\\vert{} \\operatorname{sinc}\\left[ \\left( f_d + \\frac{B}{\\tau}\\tau_d \\right) ' +
  '(\\tau - \\vert{}\\tau_d\\vert{}) \\right] \\right\\vert{}, \\quad \\vert{}\\tau_d\\vert{} \\le \\tau';

// Minimal Gemini-like conversation: one user turn, one model turn with math.
const page = `<!doctype html><html><body>
<conversation-container>
  <user-query><div class="query-text">Explain the mass-energy relation.</div></user-query>
  <message-content><div class="markdown">
    <p>The relation is <span class="math-inline" data-math="E = mc^2"></span> where mass matters.</p>
    <div class="math-block" data-math="\\int_0^\\infty e^{-x}\\,dx = 1"></div>
    <div class="math-block" data-math="${HARD_TEX.replace(/"/g, '&quot;')}"></div>
    <ul><li>speed of light <span class="math-inline" data-math="c"></span></li></ul>
    <button aria-label="copy">copy</button>
  </div></message-content>
</conversation-container>
</body></html>`;

const dom = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

/* Match the real page: evaluate KaTeX *inside* the window, so katex.render()
 * builds nodes with this document. Requiring it from Node instead would leave
 * its internal `document` reference unbound, and the DOM path would be skipped
 * — hiding the very thing these tests need to cover. */
win.eval(fs.readFileSync(require.resolve('katex/dist/katex.min.js'), 'utf8'));
if (!win.TextEncoder) win.TextEncoder = TextEncoder;

// Capture whatever gets downloaded (stub object URLs + anchor navigation).
const captured = [];
win.URL.createObjectURL = function (blob) { captured.push(blob); return 'blob:captured'; };
win.URL.revokeObjectURL = function () {};
win.HTMLAnchorElement.prototype.click = function () {};

async function blobText(b) {
  if (typeof b.text === 'function') return b.text();
  return Buffer.from(await b.arrayBuffer()).toString('utf8');
}

(async function () {
  win.eval(src);                                   // run the bookmarklet
  const panel = win.document.getElementById('gemini-export-panel');
  const buttons = [].slice.call(panel.querySelectorAll('button'));
  const byText = function (t) { return buttons.find(function (b) { return b.textContent === t; }); };

  let pass = true;
  function check(name, cond) { console.log((cond ? '  ✓ ' : '  ✗ ') + name); if (!cond) pass = false; }

  check('panel mounted', !!panel);
  /* Unbuilt source shows 'dev'; build.js substitutes the real version. Either
   * way the raw placeholder must never reach the panel. */
  check('panel shows a version', /v(dev|\d+\.\d+\.\d+)/.test(panel.textContent) &&
    panel.textContent.indexOf('__VERSION__') === -1);
  check('has Whole chat / Last only toggle', !!byText('Whole chat') && !!byText('Last only'));
  check('has Markdown + .doc + .docx buttons',
    !!byText('Download Markdown') && !!byText('Download Word (.doc)') && !!byText('Download Word (.docx)'));

  // --- Markdown ---
  byText('Download Markdown').onclick();
  const md = await blobText(captured.pop());
  check('markdown has heading', /## Gemini/.test(md));
  check('markdown inline math $E = mc^2$', md.indexOf('$E = mc^2$') !== -1);
  check('markdown display math $$…$$', md.indexOf('$$\\int_0^\\infty e^{-x}\\,dx = 1$$') !== -1);
  check('markdown user turn captured', /## You/.test(md) && /mass-energy relation/.test(md));
  check('markdown list item', md.indexOf('- speed of light $c$') !== -1);

  // --- Word .doc (async: waits on ensureKatex) ---
  byText('Download Word (.doc)').onclick();
  await new Promise(function (r) { setTimeout(r, 50); });
  const doc = await blobText(captured.pop());
  check('.doc is Word HTML', /xmlns:w=/.test(doc) && /<h2/.test(doc));
  check('.doc includes both turns', /You/.test(doc) && /Gemini/.test(doc));

  // --- Word .docx (DOM -> OMML -> zip, no Markdown round-trip) ---
  byText('Download Word (.docx)').onclick();
  const zip = Buffer.from(await captured.pop().arrayBuffer());
  /* The zip is stored (never deflated), so document.xml sits verbatim in the
   * bytes and we can assert on it without an unzip dependency. */
  const raw = zip.toString('latin1');
  check('.docx is a zip', zip[0] === 0x50 && zip[1] === 0x4b);
  check('.docx has the three OPC parts',
    raw.indexOf('[Content_Types].xml') !== -1 &&
    raw.indexOf('_rels/.rels') !== -1 &&
    raw.indexOf('word/document.xml') !== -1);
  check('.docx has native equations', (raw.match(/<m:oMath>/g) || []).length >= 4);
  check('.docx centres display equations', (raw.match(/<m:oMathPara>/g) || []).length >= 2);
  check('.docx keeps both turns', /You/.test(raw) && /Gemini/.test(raw));
  check('.docx converted the hard equation', raw.indexOf('sinc') !== -1);
  check('.docx leaked no raw LaTeX', !/\\frac|\\tau|\\int|\\operatorname/.test(raw));
  check('.docx dropped UI chrome', raw.indexOf('aria-label') === -1);

  check('.docx reported no LaTeX fallbacks', win.AppCore.mathFallbacks() === 0);

  /* --- Trusted Types regression ---
   * Gemini enforces Trusted Types, which makes DOMParser.parseFromString throw.
   * The conversion must not depend on it: it once did, caught the error, and
   * silently wrote every equation out as literal LaTeX. jsdom has no TT, so we
   * simulate the throwing sink. */
  const realParse = win.DOMParser.prototype.parseFromString;
  win.DOMParser.prototype.parseFromString = function () {
    throw new TypeError("Failed to execute 'parseFromString' on 'DOMParser': " +
      "This document requires 'TrustedHTML' assignment.");
  };
  byText('Download Word (.docx)').onclick();
  const ttRaw = Buffer.from(await captured.pop().arrayBuffer()).toString('latin1');
  check('TT: equations still convert without DOMParser',
    (ttRaw.match(/<m:oMath>/g) || []).length >= 4);
  check('TT: no equation fell back to LaTeX text', win.AppCore.mathFallbacks() === 0);
  check('TT: no raw LaTeX in output', !/\\frac|\\tau|\\int|\\operatorname/.test(ttRaw));
  win.DOMParser.prototype.parseFromString = realParse;

  // --- Graceful degradation when Gemini stops exposing katex ---
  const savedKatex = win.katex;
  win.katex = undefined;
  const before = captured.length;
  byText('Download Word (.docx)').onclick();
  const statusText = win.document.getElementById('gemini-export-panel-status').textContent;
  check('no math engine -> nothing downloaded', captured.length === before);
  check('no math engine -> tells user the fallback', /md2docx/.test(statusText));
  win.katex = savedKatex;

  console.log(pass ? '\nALL PASS' : '\nFAILURES');
  process.exit(pass ? 0 : 1);
})();
