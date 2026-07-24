# Gemini Export

Export Google Gemini conversations — including equations — to Markdown and Word.

**➤ [Download the ready-to-run tool](https://github.com/jfluhler/gemini-export/releases/latest/download/gemini-export-tool.zip)** (zip, no install) — or see all [Releases](https://github.com/jfluhler/gemini-export/releases). Unzip, open `install.html` and `md2docx.html` in your browser.

<p align="center">
  <img src="assets/panel-in-context.png" alt="The Gemini Export panel open on a Gemini conversation with rendered equations" width="820">
</p>

## Two pieces

**1. Bookmarklet** (this folder) — a button you add to your browser's bookmarks bar.
On a `gemini.google.com` conversation it shows a small panel with a scope toggle
(Whole chat / Last only) and three downloads:
- **Word (.docx)** — a real `.docx` with native, editable equations, in one click.
- **Markdown** — pristine LaTeX (`$…$` / `$$…$$`), read from Gemini's `data-math` source.
- **Word (.doc)** — legacy format; equations appear as pictures, not editable objects.

<p align="center">
  <img src="assets/panel.png" alt="The Gemini Export panel: Whole chat / Last only toggle, then Download Word (.docx), Download Markdown, Download Word (.doc)" width="300">
</p>

To install: open **`install.html`** and drag the **⬇️ Gemini Export** button to your bookmarks bar.

**2. `md2docx/` app** — a self-contained `md2docx.html`. Double-click it, drag any `.md`
file on, and it downloads a real **`.docx` with native, editable equations**. Runs
entirely on-device (no upload, no install).

**Typical workflow:** bookmarklet → *Download Word (.docx)* → open in Word (or in Pages
via File → Open). Use the `md2docx.html` app for Markdown from anywhere else, or as the
fallback described below.

### How the one-click `.docx` works

Gemini renders equations with KaTeX in `output: 'html'` mode, so the page contains **no
MathML and no TeX annotation** — only `aria-hidden` spans. Reading the rendered math
therefore gets you nothing; a DOM-scraping converter finds zero equations. What the page
*does* have is the original LaTeX in `data-math` attributes, plus KaTeX itself on
`window`. The bookmarklet uses both: `data-math` → KaTeX MathML → OMML → zip, all
in-page, sharing the same `app-core.js` engine as the `md2docx` app (`build.js` prepends
it to the bookmarklet).

Because it borrows the page's own KaTeX, nothing is fetched and CSP never comes into
play, and the bookmarklet stays ~64 KB instead of the ~500 KB a bundled KaTeX would cost.
Two Gemini-specific constraints the code has to respect:

- `window.katex` is Google's internal, not a public API — it can disappear in any deploy.
  The button feature-detects it and falls back to advising the Markdown + `md2docx.html`
  route rather than failing silently.
The `.doc` export deliberately does **not** embed MathML — it ships KaTeX's visual
render. A `.doc` is HTML that Word interprets, and Word's importer mishandles MathML
badly: it renders the TeX `<annotation>` inside `<semantics>` as a second copy of every
equation, and it silently drops paragraphs that sit between two display equations. Both
were observed in Word. The `.docx` path avoids all of this by building OMML directly
rather than asking Word to interpret HTML, so that is the one to use for real equations.

- Gemini enforces **Trusted Types**, which guards `DOMParser.parseFromString` as well as
  `innerHTML` — both throw. So no step may go through an HTML string: the conversion
  clones nodes rather than serializing, and builds MathML with `katex.render()` into a
  detached element rather than parsing `renderToString()` output. Getting this wrong fails
  quietly, because the thrown error is caught and every equation degrades to literal LaTeX
  text; `npm test` stubs the sink to throw so that can't regress unnoticed.

## Layout

```
.                     bookmarklet source + built artifacts
├── gemini-export.js  bookmarklet source (edit here)
├── build.js          builds bookmarklet.txt + install.html
├── release.js        packages dist/gemini-export-tool.zip
├── install.html      drag-to-install page   (generated)
├── bookmarklet.txt   raw javascript: URL     (generated)
├── md2docx/          the Markdown → .docx app
│   ├── app-core.js   conversion pipeline (LaTeX → KaTeX MathML → OMML → .docx zip)
│   ├── build-app.js  bundles KaTeX + marked + app-core into one HTML file
│   └── md2docx.html  the app                (generated)
└── test/             self-tests / validation harnesses
```

## Build & test

```
npm install          # first time (installs katex, marked, jsdom, linkedom)
npm run build        # rebuild bookmarklet + app
npm test             # run both harnesses in a headless DOM
npm run release      # package dist/gemini-export-tool.zip (build first)
```

The bookmarklet's version comes from `package.json` and is shown in the panel —
bookmarklets are copied, not linked, so a stale bookmark is otherwise invisible.
`npm test` covers the Trusted Types path explicitly: Gemini enforces TT, and the
tests stub `DOMParser.parseFromString` to throw so a regression fails the suite
instead of silently emitting equations as literal LaTeX.

## Disclaimer

This project is provided as an educational **example of client-side DOM
extraction** and document conversion. It is not affiliated with, endorsed by,
or connected to Google, and "Gemini" is a trademark of its respective owner.

You are solely responsible for how you use it. Ensure your use complies with
all applicable laws and with the terms of service of any website you run it
against (including Google Gemini's Terms of Service). Only export content you
have the right to access and use.

The software is provided "as is", without warranty of any kind — see
[LICENSE](LICENSE).
