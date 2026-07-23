/*
 * build.js — wraps gemini-export.js into a bookmarklet and writes install.html
 * Run: node build.js
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'gemini-export.js'), 'utf8');

/*
 * We deliberately do NOT strip newlines: the source has // comments, so the
 * bookmarklet keeps real line breaks (encoded as %0A). encodeURIComponent
 * escapes double-quotes, so the result is safe inside a double-quoted href.
 */
const bookmarklet = 'javascript:' + encodeURIComponent(src);

fs.writeFileSync(path.join(__dirname, 'bookmarklet.txt'), bookmarklet);

// A download-arrow SVG, used as the install-page favicon.
const favicon =
  "data:image/svg+xml," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
    '<rect width="24" height="24" rx="5" fill="#1a73e8"/>' +
    '<path d="M12 5v8m0 0l-3.2-3.2M12 13l3.2-3.2M6 17.5h12" ' +
    'fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>');

// Emoji in the bookmark NAME is the only reliable "icon" for a javascript: bookmark.
const bookmarkName = "⬇️ Gemini Export";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="${favicon}">
<title>Install — Gemini Export</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; color: #202124; }
  h1 { font-size: 24px; }
  .drag { display: inline-flex; align-items: center; gap: 8px; padding: 12px 20px; margin: 16px 0;
          background: #1a73e8; color: #fff; border-radius: 10px; font-weight: 700; text-decoration: none; }
  code { background: #f1f3f4; padding: 2px 6px; border-radius: 4px; }
  ol { padding-left: 20px; }
  .note { background: #f8f9fa; border-left: 4px solid #1a73e8; padding: 12px 16px; border-radius: 6px; margin-top: 20px; }
  .tip { font-size: 14px; color: #5f6368; }
</style>
</head>
<body>
  <h1>⬇️ Gemini Export</h1>
  <p>Drag this button up to your bookmarks bar (⌘⇧B shows it in Chrome/Safari):</p>
  <p><a class="drag" href="${bookmarklet}">${bookmarkName}</a></p>
  <p class="tip">The bookmark keeps the ⬇️ emoji as its icon — <code>javascript:</code> bookmarks can't
     use a real favicon, so the emoji is the icon. Rename the bookmark freely; keep an emoji up front if you want one.</p>

  <ol>
    <li>Open a conversation on <code>gemini.google.com</code>.</li>
    <li>Click the <strong>${bookmarkName}</strong> bookmark. A small panel appears top-right.</li>
    <li>Pick a scope: <strong>Whole chat</strong> or <strong>Last only</strong> (just the last question + answer).</li>
    <li>Then choose a format:
      <ul>
        <li><strong>Download Markdown</strong> — clean <code>.md</code> with pristine LaTeX (<code>$…$</code> / <code>$$…$$</code>).</li>
        <li><strong>Download Word (.doc)</strong> — opens in Word/Pages with equations shown.</li>
      </ul>
    </li>
  </ol>

  <div class="note">
    <p><strong>Want a real <code>.docx</code> with native, editable equations?</strong>
       Use the companion app: open <code>md2docx.html</code>, then drag your downloaded
       <code>.md</code> onto it. It converts on-device (no upload, no install) and downloads a
       <code>.docx</code> you can open in Word — or in Pages (File → Open).</p>
    <p>Why a separate app: Gemini's security policy blocks the in-page math engine the one-click
       <code>.docx</code> would need, so the conversion lives in the standalone file instead.</p>
  </div>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'install.html'), html);

console.log('Wrote bookmarklet.txt (' + bookmarklet.length + ' chars) and install.html');
