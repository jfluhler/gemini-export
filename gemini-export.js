/*
 * Gemini Export — bookmarklet source
 *
 * Adds a small floating panel to gemini.google.com with three buttons:
 *   • Download Word (.docx) -> real .docx, native editable equations
 *   • Download Markdown     -> clean .md with pristine LaTeX ($…$ / $$…$$)
 *   • Download Word (.doc)  -> legacy HTML-flavoured doc, equations shown
 *
 * Gemini stores the original LaTeX in `data-math` attributes on .math-inline /
 * .math-block elements; every path reads those rather than the rendered math,
 * because Gemini renders KaTeX with output:'html' — there is no MathML and no
 * TeX annotation in the DOM, only aria-hidden spans.
 *
 * The .docx path bundles md2docx's AppCore (build.js prepends it) and converts
 * in-page: data-math -> KaTeX MathML -> OMML -> zip. It borrows the page's own
 * window.katex, so no script is fetched and CSP is never involved; if Gemini
 * ever stops exposing katex, the button degrades to advising the Markdown +
 * md2docx.html route. Nodes are cloned rather than innerHTML-assigned, since
 * Gemini enforces Trusted Types.
 */
(function () {
  'use strict';

  var PANEL_ID = 'gemini-export-panel';
  /* build.js substitutes the package.json version here. Running this file
   * unbuilt (the test harness does) leaves the placeholder, so show 'dev'. */
  var VERSION = '__VERSION__';
  if (VERSION.charAt(0) === '_') VERSION = 'dev';

  /* Toggle: if the panel is already open, close it and stop. */
  var existing = document.getElementById(PANEL_ID);
  if (existing) { existing.remove(); return; }

  /* ================================================================ *
   * 1. Find the conversation turns                                    *
   * ================================================================ */
  function getTurns(lastOnly) {
    var turns = [];
    var containers = Array.prototype.slice.call(document.querySelectorAll('conversation-container'));
    if (lastOnly && containers.length) containers = [containers[containers.length - 1]];
    containers.forEach(function (c) {
      var u = c.querySelector('user-query .query-text') || c.querySelector('user-query');
      var m = c.querySelector('message-content .markdown') ||
              c.querySelector('.model-response-text .markdown') ||
              c.querySelector('message-content');
      if (u) turns.push({ role: 'user', el: u });
      if (m) turns.push({ role: 'model', el: m });
    });
    if (!turns.length) {
      var mds = Array.prototype.slice.call(document.querySelectorAll('.markdown'));
      if (lastOnly && mds.length) mds = [mds[mds.length - 1]];
      mds.forEach(function (m) { turns.push({ role: 'model', el: m }); });
    }
    return turns;
  }

  /* ================================================================ *
   * 2. KaTeX helpers (fallback for pages without data-math)           *
   * ================================================================ */
  function katexLatex(el) {
    var ann = el.querySelector('.katex-mathml annotation, annotation[encoding="application/x-tex"]');
    return ann ? ann.textContent : (el.textContent || '');
  }
  function isDisplayMath(el) {
    return !!el.closest('.katex-display');
  }

  /* ================================================================ *
   * 3. DOM -> Markdown                                                *
   * ================================================================ */
  function mdChildren(node) {
    var out = '';
    node.childNodes.forEach(function (child) { out += mdNode(child); });
    return out;
  }

  function mdNode(node) {
    if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== 1) return '';

    var el = node;
    var tag = el.tagName.toLowerCase();

    /* Gemini stores pristine LaTeX in data-math on .math-inline / .math-block. */
    if (el.classList.contains('math-inline')) {
      var li = (el.getAttribute('data-math') || '').trim();
      return li ? ('$' + li + '$') : '';
    }
    if (el.classList.contains('math-block')) {
      var lb = (el.getAttribute('data-math') || '').trim();
      return lb ? ('\n\n$$' + lb + '$$\n\n') : '';
    }
    /* Fallback: some pages only have KaTeX (LaTeX in a hidden annotation). */
    if (el.classList.contains('katex')) {
      var tex = katexLatex(el).trim();
      if (!tex) return '';
      return isDisplayMath(el) ? ('\n\n$$' + tex + '$$\n\n') : ('$' + tex + '$');
    }
    if (el.classList.contains('katex-display') ||
        el.classList.contains('katex-mathml') ||
        el.classList.contains('katex-html')) {
      var k = el.querySelector('.katex');
      return k ? mdNode(k) : '';
    }

    switch (tag) {
      case 'h1': return '\n# '    + mdChildren(el).trim() + '\n\n';
      case 'h2': return '\n## '   + mdChildren(el).trim() + '\n\n';
      case 'h3': return '\n### '  + mdChildren(el).trim() + '\n\n';
      case 'h4': return '\n#### ' + mdChildren(el).trim() + '\n\n';
      case 'h5': return '\n##### '+ mdChildren(el).trim() + '\n\n';
      case 'h6': return '\n###### '+ mdChildren(el).trim() + '\n\n';
      case 'p':  return mdChildren(el).trim() + '\n\n';
      case 'br': return '  \n';
      case 'hr': return '\n---\n\n';
      case 'strong':
      case 'b': return '**' + mdChildren(el).trim() + '**';
      case 'em':
      case 'i': return '*' + mdChildren(el).trim() + '*';
      case 'del':
      case 's': return '~~' + mdChildren(el).trim() + '~~';
      case 'a': {
        var href = el.getAttribute('href') || '';
        var txt = mdChildren(el).trim();
        return href ? ('[' + txt + '](' + href + ')') : txt;
      }
      case 'code':
        if (el.closest('pre')) return mdChildren(el);
        return '`' + el.textContent + '`';
      case 'pre': {
        var codeEl = el.querySelector('code');
        var lang = '';
        if (codeEl) {
          var m = (codeEl.className || '').match(/language-([\w+-]+)/);
          if (m) lang = m[1];
        }
        var body = (codeEl ? codeEl.textContent : el.textContent).replace(/\n+$/, '');
        return '\n```' + lang + '\n' + body + '\n```\n\n';
      }
      case 'ul':
      case 'ol': return mdList(el, tag === 'ol') + '\n';
      case 'li': return mdChildren(el).trim();
      case 'blockquote':
        return mdChildren(el).trim().split('\n').map(function (l) { return '> ' + l; }).join('\n') + '\n\n';
      case 'table': return mdTable(el) + '\n';
      default: return mdChildren(el);
    }
  }

  function mdList(listEl, ordered) {
    var out = '\n';
    var i = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName.toLowerCase() !== 'li') return;
      i++;
      var marker = ordered ? (i + '. ') : '- ';
      var nested = '';
      li.querySelectorAll(':scope > ul, :scope > ol').forEach(function (n) {
        nested += mdList(n, n.tagName.toLowerCase() === 'ol')
          .split('\n').map(function (l) { return l ? '  ' + l : l; }).join('\n');
      });
      var text = '';
      li.childNodes.forEach(function (c) {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) return;
        text += mdNode(c);
      });
      out += marker + text.trim() + '\n' + nested;
    });
    return out;
  }

  function mdTable(tableEl) {
    var rows = [];
    tableEl.querySelectorAll('tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('th,td').forEach(function (cell) {
        cells.push(mdChildren(cell).trim().replace(/\|/g, '\\|').replace(/\n/g, ' '));
      });
      rows.push(cells);
    });
    if (!rows.length) return '';
    var head = rows[0];
    var sep = head.map(function () { return '---'; });
    var lines = ['| ' + head.join(' | ') + ' |', '| ' + sep.join(' | ') + ' |'];
    rows.slice(1).forEach(function (r) { lines.push('| ' + r.join(' | ') + ' |'); });
    return '\n' + lines.join('\n') + '\n';
  }

  function toMarkdown(turns) {
    var parts = [];
    turns.forEach(function (t) {
      var label = t.role === 'user' ? '## You' : '## Gemini';
      var body = mdChildren(t.el).replace(/\n{3,}/g, '\n\n').trim();
      parts.push(label + '\n\n' + body);
    });
    return parts.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  /* ================================================================ *
   * 4. KaTeX bridge — render LaTeX (data-math) to MathML for the .doc *
   * ================================================================ */
  /* Use the page's KaTeX if it's exposed; otherwise the .doc path keeps
   * KaTeX's visual render. Gemini's CSP blocks loading our own KaTeX, so
   * native-equation .docx lives in the separate md2docx.html app. */
  var KATEX = (typeof window !== 'undefined' && window.katex) ? window.katex : null;
  function ensureKatex() { return Promise.resolve(KATEX); }
  /* Delegate to AppCore (bundled ahead of this file by build.js) so both export
   * paths share one implementation — this used to be a near-copy that parsed an
   * HTML string, which Trusted Types blocks on Gemini, and the .doc silently
   * fell back to KaTeX's visual render instead of real MathML. */
  function latexToMath(latex, display) {
    if (!KATEX || typeof AppCore === 'undefined') return null;
    return AppCore.latexToMath(latex, display);
  }

  /* ================================================================ *
   * 5. DOM -> Word-openable HTML (.doc, MathML equations)             *
   * ================================================================ */
  function cleanHtml(el) {
    var clone = el.cloneNode(true);
    /* Replace each math element with KaTeX-rendered MathML (Word/Pages read it
     * as native equations). Without KaTeX, leave the existing visual render. */
    clone.querySelectorAll('.math-inline,.math-block').forEach(function (n) {
      var math = latexToMath(n.getAttribute('data-math') || '', n.classList.contains('math-block'));
      if (math) {
        while (n.firstChild) n.removeChild(n.firstChild);
        n.appendChild(clone.ownerDocument.importNode(math, true));
      }
    });
    clone.querySelectorAll('button,[role="button"],mat-icon,svg,.code-block-decoration')
      .forEach(function (n) { n.remove(); });
    return clone.innerHTML;
  }
  /* ================================================================ *
   * 5b. DOM -> .docx (native equations, via the bundled AppCore)      *
   * ================================================================ *
   * Gemini renders KaTeX with output:'html' — the DOM holds no MathML and no
   * TeX annotation, only aria-hidden spans. So we never read the rendered
   * math: AppCore re-renders the pristine LaTeX from `data-math` through the
   * page's own KaTeX. Nodes are cloned (never innerHTML-assigned) because
   * Gemini enforces Trusted Types. */
  function buildDocBody(turns) {
    var root = document.createElement('div');
    turns.forEach(function (t, i) {
      var h = document.createElement('h2');
      h.textContent = t.role === 'user' ? 'You' : 'Gemini';
      root.appendChild(h);
      var clone = t.el.cloneNode(true);
      clone.querySelectorAll('button,[role="button"],mat-icon,svg,.code-block-decoration')
        .forEach(function (n) { n.remove(); });
      root.appendChild(clone);
      if (i < turns.length - 1) root.appendChild(document.createElement('hr'));
    });
    return root;
  }
  function hasMathEngine() {
    return !!(window.katex && typeof window.katex.renderToString === 'function');
  }

  function toWordHtml(turns) {
    var body = '';
    turns.forEach(function (t) {
      var label = t.role === 'user' ? 'You' : 'Gemini';
      body += '<h2 style="color:#1a73e8">' + label + '</h2>';
      body += '<div>' + cleanHtml(t.el) + '</div><hr/>';
    });
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
      'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
      'xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"><title>Gemini conversation</title></head>' +
      '<body>' + body + '</body></html>';
  }

  /* ================================================================ *
   * 6. Actions + panel UI                                            *
   * ================================================================ */
  var scope = 'all'; /* 'all' | 'last' */
  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }
  function flash(msg) {
    var s = document.getElementById(PANEL_ID + '-status');
    if (s) s.textContent = msg;
  }

  function fileBase() { return scope === 'last' ? 'gemini-last' : 'gemini-conversation'; }
  function grab() { return getTurns(scope === 'last'); }

  function doMarkdown() {
    var turns = grab();
    if (!turns.length) { flash('No conversation found.'); return; }
    downloadBlob(fileBase() + '.md',
      new Blob([toMarkdown(turns)], { type: 'text/markdown;charset=utf-8' }));
    flash('Downloaded .md (' + turns.length + ' turns).');
  }
  function doWordDoc() {
    var turns = grab();
    if (!turns.length) { flash('No conversation found.'); return; }
    flash('Preparing equations…');
    ensureKatex().then(function () {
      downloadBlob(fileBase() + '.doc',
        new Blob(['﻿', toWordHtml(turns)], { type: 'application/msword' }));
      flash('Downloaded .doc (' + turns.length + ' turns)' +
        (KATEX ? '.' : ' — no math engine, using visual math.'));
    });
  }

  function doDocx() {
    var turns = grab();
    if (!turns.length) { flash('No conversation found.'); return; }
    /* window.katex is Gemini's internal, not an API — it can vanish in any
     * deploy. Degrade to the Markdown + md2docx.html route instead of failing. */
    if (!hasMathEngine() || typeof AppCore === 'undefined') {
      flash('Math engine unavailable — use Markdown, then md2docx.html.');
      return;
    }
    flash('Building .docx…');
    try {
      var bytes = AppCore.bodyToDocxBytes(buildDocBody(turns));
      downloadBlob(fileBase() + '.docx', new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }));
      /* Say so when equations came out as literal LaTeX — that failure is
       * invisible until you open the file in Word. */
      var missed = AppCore.mathFallbacks();
      flash(missed
        ? 'Downloaded .docx, but ' + missed + ' equation(s) stayed as LaTeX text.'
        : 'Downloaded .docx (' + turns.length + ' turns).');
    } catch (e) {
      flash('Error: ' + (e && e.message ? e.message : e));
    }
  }

  function btn(text, onClick) {
    var b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'display:block;width:100%;margin:4px 0;padding:8px 12px;' +
      'border:0;border-radius:8px;background:#1a73e8;color:#fff;font:600 13px system-ui;cursor:pointer;';
    b.onmouseover = function () { b.style.background = '#1666c9'; };
    b.onmouseout = function () { b.style.background = '#1a73e8'; };
    b.onclick = onClick;
    return b;
  }

  var panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;' +
    'background:#fff;color:#202124;box-shadow:0 4px 20px rgba(0,0,0,.25);' +
    'border-radius:12px;padding:12px;width:220px;font:13px system-ui;';

  var title = document.createElement('div');
  title.textContent = 'Gemini Export';
  title.style.cssText = 'font-weight:700;margin-bottom:8px;';
  /* Version matters here: the bookmarklet is a copied-once snapshot, so a stale
   * bookmark is invisible without it. */
  var ver = document.createElement('span');
  ver.textContent = ' v' + VERSION;
  ver.style.cssText = 'font-weight:400;font-size:11px;color:#80868b;';
  title.appendChild(ver);
  var close = document.createElement('span');
  close.textContent = '×';
  close.style.cssText = 'float:right;cursor:pointer;font-size:18px;line-height:14px;color:#5f6368;';
  close.onclick = function () { panel.remove(); };
  title.appendChild(close);

  /* Scope toggle: whole chat vs. last exchange only. */
  var scopeWrap = document.createElement('div');
  scopeWrap.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
  function scopeBtn(text, val) {
    var b = document.createElement('button');
    b.textContent = text;
    function paint() {
      var on = scope === val;
      b.style.cssText = 'flex:1;padding:6px 4px;border:1px solid #dadce0;border-radius:8px;' +
        'font:600 12px system-ui;cursor:pointer;' +
        (on ? 'background:#e8f0fe;color:#1a73e8;border-color:#1a73e8;' : 'background:#fff;color:#5f6368;');
    }
    b.onclick = function () { scope = val; repaintScope(); flash(''); };
    b._paint = paint; paint();
    return b;
  }
  var sAll = scopeBtn('Whole chat', 'all');
  var sLast = scopeBtn('Last only', 'last');
  function repaintScope() { sAll._paint(); sLast._paint(); }
  scopeWrap.appendChild(sAll);
  scopeWrap.appendChild(sLast);

  var status = document.createElement('div');
  status.id = PANEL_ID + '-status';
  status.style.cssText = 'margin-top:8px;font-size:12px;color:#5f6368;min-height:16px;';

  panel.appendChild(title);
  panel.appendChild(scopeWrap);
  panel.appendChild(btn('Download Word (.docx)', doDocx));
  panel.appendChild(btn('Download Markdown', doMarkdown));
  panel.appendChild(btn('Download Word (.doc)', doWordDoc));
  panel.appendChild(status);
  document.body.appendChild(panel);
})();
