/*
 * build-app.js — bundle KaTeX + marked + app-core + UI into one self-contained
 * md2docx.html. Double-click it; drag a .md file on; get a .docx. No installs.
 * Run: node build-app.js
 */
const fs = require('fs');
const path = require('path');

const katexJs = fs.readFileSync(path.join(__dirname, '..', 'node_modules/katex/dist/katex.min.js'), 'utf8');
const markedJs = fs.readFileSync(path.join(__dirname, '..', 'node_modules/marked/lib/marked.umd.js'), 'utf8');
const coreJs = fs.readFileSync(path.join(__dirname, 'app-core.js'), 'utf8');

const ui = `
document.addEventListener('DOMContentLoaded', function () {
  var drop = document.getElementById('drop');
  var input = document.getElementById('file');
  var status = document.getElementById('status');
  function setStatus(msg, ok) { status.textContent = msg; status.className = ok === false ? 'err' : (ok ? 'ok' : ''); }

  function download(name, bytes) {
    var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function handleFile(file) {
    if (!/\\.(md|markdown|txt)$/i.test(file.name)) { setStatus('Please drop a .md file (got ' + file.name + ').', false); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var bytes = AppCore.mdToDocxBytes(String(reader.result));
        var out = file.name.replace(/\\.(md|markdown|txt)$/i, '') + '.docx';
        download(out, bytes);
        setStatus('Converted → ' + out + '  (' + Math.round(bytes.length / 1024) + ' KB). Opens in Word or Pages.', true);
      } catch (e) { setStatus('Error: ' + (e && e.message ? e.message : e), false); }
    };
    reader.onerror = function () { setStatus('Could not read file.', false); };
    reader.readAsText(file);
  }
  function handleFiles(list) { for (var i = 0; i < list.length; i++) handleFile(list[i]); }

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('hover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove('hover'); });
  });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  drop.addEventListener('click', function () { input.click(); });
  input.addEventListener('change', function () { if (input.files) handleFiles(input.files); });

  if (typeof katex === 'undefined' || typeof marked === 'undefined' || typeof AppCore === 'undefined') {
    setStatus('Bundle failed to load — the app is incomplete.', false);
  }
});
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Markdown → Word (.docx) — with equations</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 -apple-system, system-ui, sans-serif; max-width: 680px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 22px; }
  #drop { margin: 24px 0; padding: 48px 24px; border: 2px dashed #1a73e8; border-radius: 16px; text-align: center;
          background: rgba(26,115,232,.05); cursor: pointer; transition: background .15s, border-color .15s; }
  #drop.hover { background: rgba(26,115,232,.15); border-color: #1666c9; }
  #drop .big { font-size: 18px; font-weight: 700; color: #1a73e8; }
  #drop .sub { color: #5f6368; font-size: 14px; margin-top: 6px; }
  #status { min-height: 24px; font-size: 14px; }
  #status.ok { color: #188038; } #status.err { color: #c5221f; }
  code { background: rgba(128,128,128,.15); padding: 2px 6px; border-radius: 4px; }
  .note { color: #5f6368; font-size: 13px; margin-top: 28px; border-top: 1px solid rgba(128,128,128,.25); padding-top: 16px; }
  input[type=file] { display: none; }
</style>
</head>
<body>
  <h1>Markdown → Word (.docx)</h1>
  <p>Drop a Markdown file below (or click to choose). It converts entirely on your device — nothing is uploaded — and downloads a <code>.docx</code> with <strong>native, editable equations</strong>. Open the result in Word, or in Pages (File → Open).</p>

  <div id="drop">
    <div class="big">Drop a .md file here</div>
    <div class="sub">or click to choose — LaTeX <code>$…$</code> / <code>$$…$$</code> becomes real equations</div>
  </div>
  <input type="file" id="file" accept=".md,.markdown,.txt">
  <div id="status"></div>

  <div class="note">
    Self-contained: KaTeX + Markdown parser are bundled in this one file. Works offline, no install.
    Pairs with the Gemini Export bookmarklet's <strong>Download Markdown</strong> button.
  </div>

<script>${katexJs}</script>
<script>${markedJs}</script>
<script>${coreJs}</script>
<script>${ui}</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'md2docx.html'), html);
console.log('Wrote md2docx.html (' + Math.round(html.length / 1024) + ' KB)');
