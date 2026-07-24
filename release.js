/*
 * release.js — package the ready-to-run zip attached to GitHub releases.
 * Run: npm run release   (build first; this only collects built artifacts)
 *
 * The zip is what most people actually download, so it ships the two
 * double-clickable HTML files and nothing that needs npm.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const pkg = require('./package.json');
const dist = path.join(__dirname, 'dist');
const stage = path.join(dist, 'gemini-export-tool');
const zipPath = path.join(dist, 'gemini-export-tool.zip');

/* Built artifacts must exist and be newer than their sources — a stale zip that
 * looks fine is the whole failure mode this script exists to prevent. */
const required = [
  { file: 'install.html', from: ['gemini-export.js', 'build.js', 'md2docx/app-core.js'] },
  { file: 'md2docx/md2docx.html', from: ['md2docx/app-core.js', 'md2docx/build-app.js'] },
];
for (const r of required) {
  const built = path.join(__dirname, r.file);
  if (!fs.existsSync(built)) throw new Error('Missing ' + r.file + ' — run `npm run build` first.');
  const builtAt = fs.statSync(built).mtimeMs;
  for (const s of r.from) {
    if (fs.statSync(path.join(__dirname, s)).mtimeMs > builtAt) {
      throw new Error(r.file + ' is older than ' + s + ' — run `npm run build` first.');
    }
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

fs.copyFileSync(path.join(__dirname, 'install.html'), path.join(stage, 'install.html'));
fs.copyFileSync(path.join(__dirname, 'md2docx', 'md2docx.html'), path.join(stage, 'md2docx.html'));
fs.copyFileSync(path.join(__dirname, 'LICENSE'), path.join(stage, 'LICENSE'));

fs.writeFileSync(path.join(stage, 'README.txt'),
`Gemini Export v${pkg.version}
================================

Export Google Gemini conversations - including equations - to Word and Markdown.
Nothing to install. Nothing is uploaded; everything runs in your browser.

1. INSTALL THE BOOKMARKLET
   Open install.html and drag the "Gemini Export" button to your bookmarks bar.
   (Press Cmd+Shift+B / Ctrl+Shift+B if the bar is hidden.)

2. EXPORT A CONVERSATION
   Open a conversation on gemini.google.com and click the bookmark.
   A panel appears top-right. Choose "Whole chat" or "Last only", then:

     Download Word (.docx)  - real .docx with native, editable equations
     Download Markdown      - clean .md with LaTeX ($...$ / $$...$$)
     Download Word (.doc)   - legacy format, equations shown

   Open the .docx in Word, or in Pages via File > Open.

3. CONVERTING MARKDOWN FROM ANYWHERE ELSE
   Open md2docx.html and drag any .md file onto it to get the same .docx
   conversion. This is also the fallback if the one-click .docx ever stops
   working after a Gemini update.

UPGRADING
   Bookmarklets are copied once, not linked. To update, open the new
   install.html, drag the button again, and delete the old bookmark. The
   panel shows its version next to the title.

Not affiliated with Google. "Gemini" is a trademark of its respective owner.
You are responsible for ensuring your use complies with applicable laws and
the terms of service of any site you run it on. Provided "as is" - see LICENSE.
`);

execFileSync('zip', ['-r', '-q', zipPath, 'gemini-export-tool'], { cwd: dist });
fs.rmSync(stage, { recursive: true, force: true });

console.log('Wrote dist/gemini-export-tool.zip (' +
  Math.round(fs.statSync(zipPath).size / 1024) + ' KB) for v' + pkg.version);
