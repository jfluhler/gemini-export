/* Smoke-test the bookmarklet: run gemini-export.js against a fake Gemini DOM
 * and verify both buttons produce correct output. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'gemini-export.js'), 'utf8');

// Minimal Gemini-like conversation: one user turn, one model turn with math.
const page = `<!doctype html><html><body>
<conversation-container>
  <user-query><div class="query-text">Explain the mass-energy relation.</div></user-query>
  <message-content><div class="markdown">
    <p>The relation is <span class="math-inline" data-math="E = mc^2"></span> where mass matters.</p>
    <div class="math-block" data-math="\\int_0^\\infty e^{-x}\\,dx = 1"></div>
    <ul><li>speed of light <span class="math-inline" data-math="c"></span></li></ul>
  </div></message-content>
</conversation-container>
</body></html>`;

const dom = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window;

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
  check('has Whole chat / Last only toggle', !!byText('Whole chat') && !!byText('Last only'));
  check('has Markdown + .doc buttons', !!byText('Download Markdown') && !!byText('Download Word (.doc)'));

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

  console.log(pass ? '\nALL PASS' : '\nFAILURES');
  process.exit(pass ? 0 : 1);
})();
