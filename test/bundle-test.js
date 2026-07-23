/* Execute the ACTUAL md2docx.html bundle in jsdom and run a real conversion. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OUT = path.join(os.tmpdir(), 'gemini-export-tests');
fs.mkdirSync(OUT, { recursive: true });

const html = fs.readFileSync(path.join(__dirname, '..', 'md2docx', 'md2docx.html'), 'utf8');
const md = fs.readFileSync(path.join(__dirname, "fixture.md"), "utf8");

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;

// Give the inline scripts a tick to execute, then drive AppCore directly.
setTimeout(function () {
  const checks = {
    'window.katex': typeof win.katex,
    'window.marked': typeof win.marked,
    'window.marked.parse': typeof (win.marked && win.marked.parse),
    'window.AppCore': typeof win.AppCore,
    'AppCore.mdToDocxBytes': typeof (win.AppCore && win.AppCore.mdToDocxBytes),
    'drop element': !!win.document.getElementById('drop')
  };
  console.log('--- bundle globals ---');
  Object.keys(checks).forEach(function (k) { console.log('  ' + k + ':', checks[k]); });

  try {
    const bytes = win.AppCore.mdToDocxBytes(md);
    fs.writeFileSync(path.join(OUT, 'bundle-test.docx'), Buffer.from(bytes));
    const xml = win.AppCore.documentXml(
      new win.DOMParser().parseFromString('<!doctype html><html><body>' + win.AppCore.mdToHtml(md) + '</body></html>', 'text/html').body
    );
    console.log('--- conversion ---');
    console.log('  bytes:', bytes.length);
    console.log('  m:oMath:', (xml.match(/<m:oMath>/g) || []).length);
    console.log('  m:oMathPara:', (xml.match(/<m:oMathPara>/g) || []).length);
    console.log('  leftover raw LaTeX:', (xml.match(/\\frac|\\tau|\\int/g) || []).length);
  } catch (e) {
    console.log('CONVERSION ERROR:', e.message);
    process.exit(1);
  }
}, 500);
