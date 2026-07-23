/*
 * Gemini Export — bookmarklet source
 *
 * Adds a small floating panel to gemini.google.com with two buttons:
 *   • Download Markdown      -> clean .md with LaTeX ($…$ / $$…$$)
 *   • Download Word (.docx)  -> a REAL zipped .docx with NATIVE equations
 *
 * How the math survives: Gemini renders equations with KaTeX, which leaves two
 * hidden copies in the DOM — the original LaTeX inside
 *   <annotation encoding="application/x-tex">…</annotation>
 * and a MathML <math> tree. Markdown uses the LaTeX; the .docx converts the
 * MathML into OMML (Office Math) so Word/Pages show real, editable equations.
 *
 * No external libraries: the .docx is a hand-built ZIP (store, no compression)
 * containing a minimal OOXML package.
 */
(function () {
  'use strict';

  var PANEL_ID = 'gemini-export-panel';

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
   * 2. KaTeX helpers                                                  *
   * ================================================================ */
  function katexLatex(el) {
    var ann = el.querySelector('.katex-mathml annotation, annotation[encoding="application/x-tex"]');
    return ann ? ann.textContent : (el.textContent || '');
  }
  function isDisplayMath(el) {
    return !!el.closest('.katex-display');
  }
  function katexMath(el) {
    return el.querySelector('.katex-mathml math') || el.querySelector('math');
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
   * 4. MathML (KaTeX) -> OMML (Office Math)                           *
   * ================================================================ */
  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function xmlAttr(s) { return xmlEsc(s).replace(/"/g, '&quot;'); }
  function localName(el) { return el.tagName.toLowerCase().replace(/^[^:]*:/, ''); }
  function kids(el) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 1; }); }

  function mmlChildren(el) {
    var s = '';
    Array.prototype.forEach.call(el.childNodes, function (c) { s += mml(c); });
    return s;
  }
  function tokenRun(el) {
    var t = el.textContent;
    if (t == null || t === '') return '';
    return '<m:r><m:t xml:space="preserve">' + xmlEsc(t) + '</m:t></m:r>';
  }
  function grp(el) { return el ? mml(el) : ''; }

  function mmlAccentOr(el, pos) {
    var c = kids(el), base = c[0], mark = c[1];
    var accented = el.getAttribute('accent') === 'true' || el.getAttribute('accentunder') === 'true';
    if (accented && mark) {
      return '<m:acc><m:accPr><m:chr m:val="' + xmlAttr(mark.textContent || '') +
        '"/></m:accPr><m:e>' + grp(base) + '</m:e></m:acc>';
    }
    if (pos === 'under') {
      return '<m:limLow><m:e>' + grp(base) + '</m:e><m:lim>' + grp(mark) + '</m:lim></m:limLow>';
    }
    return '<m:limUpp><m:e>' + grp(base) + '</m:e><m:lim>' + grp(mark) + '</m:lim></m:limUpp>';
  }
  function mmlUnderOver(el) {
    var c = kids(el), base = c[0], under = c[1], over = c[2];
    var inner = '<m:limLow><m:e>' + grp(base) + '</m:e><m:lim>' + grp(under) + '</m:lim></m:limLow>';
    return '<m:limUpp><m:e>' + inner + '</m:e><m:lim>' + grp(over) + '</m:lim></m:limUpp>';
  }
  function mmlTable(el) {
    var rows = '';
    Array.prototype.forEach.call(el.children, function (tr) {
      if (localName(tr) !== 'mtr') return;
      var cells = '';
      Array.prototype.forEach.call(tr.children, function (td) {
        cells += '<m:e>' + mmlChildren(td) + '</m:e>';
      });
      rows += '<m:mr>' + cells + '</m:mr>';
    });
    return '<m:m>' + rows + '</m:m>';
  }
  function mmlFenced(el) {
    var open = el.getAttribute('open'); if (open == null) open = '(';
    var close = el.getAttribute('close'); if (close == null) close = ')';
    return '<m:d><m:dPr><m:begChr m:val="' + xmlAttr(open) + '"/><m:endChr m:val="' +
      xmlAttr(close) + '"/></m:dPr><m:e>' + mmlChildren(el) + '</m:e></m:d>';
  }

  function mml(node) {
    if (node.nodeType !== 1) return '';
    var el = node, tag = localName(el), c = kids(el);
    switch (tag) {
      case 'annotation': return '';
      case 'math': case 'semantics': case 'mrow': case 'mstyle':
      case 'mpadded': case 'menclose': case 'mphantom': case 'merror':
        return mmlChildren(el);
      case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms':
        return tokenRun(el);
      case 'mspace': return '<m:r><m:t xml:space="preserve"> </m:t></m:r>';
      case 'mfrac':
        return '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>' + grp(c[0]) +
          '</m:num><m:den>' + grp(c[1]) + '</m:den></m:f>';
      case 'msqrt':
        return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' +
          mmlChildren(el) + '</m:e></m:rad>';
      case 'mroot':
        return '<m:rad><m:deg>' + grp(c[1]) + '</m:deg><m:e>' + grp(c[0]) + '</m:e></m:rad>';
      case 'msup':
        return '<m:sSup><m:e>' + grp(c[0]) + '</m:e><m:sup>' + grp(c[1]) + '</m:sup></m:sSup>';
      case 'msub':
        return '<m:sSub><m:e>' + grp(c[0]) + '</m:e><m:sub>' + grp(c[1]) + '</m:sub></m:sSub>';
      case 'msubsup':
        return '<m:sSubSup><m:e>' + grp(c[0]) + '</m:e><m:sub>' + grp(c[1]) +
          '</m:sub><m:sup>' + grp(c[2]) + '</m:sup></m:sSubSup>';
      case 'munder': return mmlAccentOr(el, 'under');
      case 'mover': return mmlAccentOr(el, 'over');
      case 'munderover': return mmlUnderOver(el);
      case 'mtable': return mmlTable(el);
      case 'mfenced': return mmlFenced(el);
      default: return mmlChildren(el);
    }
  }

  /* Convert a MathML <math> element to the inner OMML of an <m:oMath>. */
  function mathToOmml(math) {
    if (!math) return '';
    var sem = math.querySelector('semantics');
    var nodes = sem ? Array.prototype.slice.call(sem.childNodes)
                    : Array.prototype.slice.call(math.childNodes);
    var out = '';
    nodes.forEach(function (n) {
      if (n.nodeType === 1 && localName(n) === 'annotation') return;
      out += mml(n);
    });
    return out;
  }
  function katexToOmml(katexSpan) { return mathToOmml(katexMath(katexSpan)); }

  /* ---- KaTeX bridge: Gemini stores LaTeX (data-math) but omits MathML, so we
   * render LaTeX -> MathML ourselves, then reuse mathToOmml above. KaTeX with
   * output:'mathml' needs no CSS/fonts. Prefer the page's copy; fall back to a
   * CDN load; if both fail (e.g. CSP), callers degrade to LaTeX-as-text. ---- */
  /* Use the page's KaTeX if it happens to be exposed; otherwise the .doc path
   * keeps KaTeX's visual render. (Gemini's CSP blocks loading our own KaTeX, so
   * native-equation .docx lives in the separate md2docx.html app instead.) */
  var KATEX = (typeof window !== 'undefined' && window.katex) ? window.katex : null;
  function ensureKatex() { return Promise.resolve(KATEX); }
  function latexToMath(latex, display) {
    if (!KATEX) return null;
    try {
      var html = KATEX.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: !!display });
      /* Parse inertly (no script execution, no live-DOM insertion). */
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.querySelector('math');
    } catch (e) { return null; }
  }
  function latexToOmml(latex, display) { return mathToOmml(latexToMath(latex, display)); }

  /* ================================================================ *
   * 5. DOM -> WordprocessingML (document.xml body)                    *
   * ================================================================ */
  var F0 = {};
  function assign(f, extra) {
    var o = {}, k;
    for (k in f) o[k] = f[k];
    if (extra) for (k in extra) o[k] = extra[k];
    return o;
  }
  function runText(text, f) {
    if (!text) return '';
    var rpr = '';
    if (f.b) rpr += '<w:b/>';
    if (f.i) rpr += '<w:i/>';
    if (f.mono) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (f.sz) rpr += '<w:sz w:val="' + f.sz + '"/><w:szCs w:val="' + f.sz + '"/>';
    if (f.color) rpr += '<w:color w:val="' + f.color + '"/>';
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') +
      '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
  }

  function inlineNode(c, f) {
    if (c.nodeType === 3) {
      var t = c.textContent.replace(/\s+/g, ' ');
      return t ? runText(t, f) : '';
    }
    if (c.nodeType !== 1) return '';
    var el = c, tag = el.tagName.toLowerCase();

    if (el.classList.contains('math-inline') || el.classList.contains('math-block')) {
      var latex = (el.getAttribute('data-math') || '').trim();
      if (!latex) return '';
      var mo = latexToOmml(latex, el.classList.contains('math-block'));
      return mo ? '<m:oMath>' + mo + '</m:oMath>' : runText(latex, assign(f, { i: 1 }));
    }
    if (el.classList.contains('katex')) {
      var omml = katexToOmml(el);
      return omml ? '<m:oMath>' + omml + '</m:oMath>' : '';
    }
    if (el.classList.contains('katex-mathml') ||
        el.classList.contains('katex-html') ||
        el.classList.contains('katex-display')) {
      var k = el.querySelector('.katex');
      if (k) { var o2 = katexToOmml(k); return o2 ? '<m:oMath>' + o2 + '</m:oMath>' : ''; }
      return '';
    }
    switch (tag) {
      case 'br': return '<w:br/>';
      case 'strong':
      case 'b': return inlineRuns(el, assign(f, { b: 1 }));
      case 'em':
      case 'i': return inlineRuns(el, assign(f, { i: 1 }));
      case 'code':
        return el.closest('pre') ? inlineRuns(el, f) : runText(el.textContent, assign(f, { mono: 1 }));
      default: return inlineRuns(el, f);
    }
  }
  function inlineRuns(parent, f) {
    var out = '';
    Array.prototype.forEach.call(parent.childNodes, function (c) { out += inlineNode(c, f); });
    return out;
  }

  function para(runs, pPr) {
    if (!runs && !pPr) return '';
    return '<w:p>' + (pPr || '') + (runs || '') + '</w:p>';
  }

  function displayEqParagraph(katexDisplay) {
    var k = katexDisplay.querySelector('.katex');
    var om = k ? katexToOmml(k) : '';
    if (!om) return '';
    return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>' +
      om + '</m:oMath></m:oMathPara></w:p>';
  }
  function displayEqFromLatex(el) {
    var latex = (el.getAttribute('data-math') || '').trim();
    if (!latex) return '';
    var om = latexToOmml(latex, true);
    if (om) {
      return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>' +
        om + '</m:oMath></m:oMathPara></w:p>';
    }
    return para(runText(latex, { i: 1 }), '<w:pPr><w:jc w:val="center"/></w:pPr>');
  }

  function listBlocks(listEl, ordered, depth) {
    var out = '', i = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName.toLowerCase() !== 'li') return;
      i++;
      var runs = runText(ordered ? (i + '. ') : '• ', F0);
      Array.prototype.forEach.call(li.childNodes, function (c) {
        if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) return;
        runs += inlineNode(c, F0);
      });
      out += '<w:p><w:pPr><w:ind w:left="' + (360 * (depth + 1)) + '"/></w:pPr>' + runs + '</w:p>';
      Array.prototype.forEach.call(li.children, function (n) {
        var t = n.tagName.toLowerCase();
        if (t === 'ul') out += listBlocks(n, false, depth + 1);
        else if (t === 'ol') out += listBlocks(n, true, depth + 1);
      });
    });
    return out;
  }

  function preBlock(el) {
    var codeEl = el.querySelector('code');
    var text = (codeEl ? codeEl.textContent : el.textContent).replace(/\n+$/, '');
    var runs = '';
    text.split('\n').forEach(function (ln, idx) {
      if (idx) runs += '<w:br/>';
      runs += runText(ln, { mono: 1 });
    });
    return '<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/>' +
      '<w:spacing w:before="80" w:after="80"/></w:pPr>' + runs + '</w:p>';
  }

  function quoteBlock(el) {
    return '<w:p><w:pPr><w:ind w:left="360"/><w:pBdr>' +
      '<w:left w:val="single" w:sz="18" w:space="8" w:color="DADCE0"/></w:pBdr></w:pPr>' +
      inlineRuns(el, { i: 1 }) + '</w:p>';
  }

  function tableBlock(el) {
    var rowsXml = '';
    el.querySelectorAll('tr').forEach(function (tr) {
      var cells = '';
      tr.querySelectorAll('th,td').forEach(function (cell) {
        var isH = cell.tagName === 'TH';
        var body = para(inlineRuns(cell, isH ? { b: 1 } : F0)) || '<w:p/>';
        cells += '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + body + '</w:tc>';
      });
      rowsXml += '<w:tr>' + cells + '</w:tr>';
    });
    var b = '<w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
        return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="DADCE0"/>';
      }).join('') + '</w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + b + '</w:tblPr>' + rowsXml + '</w:tbl>';
  }

  function isBlockTag(t) {
    return /^(p|div|section|article|main|ul|ol|pre|table|blockquote|figure|h[1-6])$/.test(t);
  }
  /* Does this element hold block-level children (so we should recurse), or is
   * it just an inline container we can flatten into one paragraph? */
  function hasBlockChild(el) {
    return Array.prototype.some.call(el.children, function (c) {
      return isBlockTag(c.tagName.toLowerCase()) ||
        c.classList.contains('katex-display') ||
        (c.children && c.children.length && hasBlockChild(c));
    });
  }

  function contentBlocks(root) {
    var out = '';
    Array.prototype.forEach.call(root.childNodes, function (node) {
      if (node.nodeType === 3) {
        var t = node.textContent.trim();
        if (t) out += para(runText(t, F0));
        return;
      }
      if (node.nodeType !== 1) return;
      var el = node, tag = el.tagName.toLowerCase();

      /* Math is handled first, wherever it appears in the tree. */
      if (el.classList.contains('math-block')) { out += displayEqFromLatex(el); return; }
      if (el.classList.contains('math-inline')) { out += para(inlineNode(el, F0)); return; }
      if (el.classList.contains('katex-display')) { out += displayEqParagraph(el); return; }
      if (el.classList.contains('katex')) { out += para(inlineNode(el, F0)); return; }

      switch (tag) {
        case 'h1': out += para(inlineRuns(el, { b: 1, sz: 34 }), headingPr()); break;
        case 'h2': out += para(inlineRuns(el, { b: 1, sz: 30 }), headingPr()); break;
        case 'h3': out += para(inlineRuns(el, { b: 1, sz: 26 }), headingPr()); break;
        case 'h4':
        case 'h5':
        case 'h6': out += para(inlineRuns(el, { b: 1, sz: 24 }), headingPr()); break;
        case 'p': out += para(inlineRuns(el, F0)); break;
        case 'ul': out += listBlocks(el, false, 0); break;
        case 'ol': out += listBlocks(el, true, 0); break;
        case 'pre': out += preBlock(el); break;
        case 'blockquote': out += quoteBlock(el); break;
        case 'table': out += tableBlock(el); break;
        case 'hr':
          out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>';
          break;
        case 'br': break;
        /* Unknown wrapper: recurse if it holds blocks, else flatten to a
         * paragraph so any inline math inside is still captured. */
        default:
          if (hasBlockChild(el)) out += contentBlocks(el);
          else out += para(inlineRuns(el, F0));
      }
    });
    return out;
  }
  function headingPr() { return '<w:pPr><w:spacing w:before="200" w:after="80"/><w:keepNext/></w:pPr>'; }

  function buildDocumentXml(turns) {
    var body = '';
    turns.forEach(function (t) {
      var label = t.role === 'user' ? 'You' : 'Gemini';
      body += para(runText(label, { b: 1, sz: 28, color: '1A73E8' }),
        '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>');
      body += contentBlocks(t.el);
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' +
      'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" ' +
      'w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  /* ================================================================ *
   * 6. Minimal ZIP (store / no compression) -> .docx package         *
   * ================================================================ */
  var CRC_TABLE = (function () {
    var t = [], n, k, c;
    for (n = 0; n < 256; n++) {
      c = n;
      for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

  function zipSync(files) {
    var enc = new TextEncoder();
    var parts = [], central = [], offset = 0;
    function add(arr) {
      var u = arr instanceof Uint8Array ? arr : Uint8Array.from(arr);
      parts.push(u); offset += u.length;
    }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data), size = data.length, lo = offset;
      add([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(size), u32(size), u16(name.length), u16(0)));
      add(name); add(data);
      central.push({ name: name, crc: crc, size: size, off: lo });
    });
    var cdStart = offset;
    central.forEach(function (c) {
      add([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off)));
      add(c.name);
    });
    add([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(offset - cdStart), u32(cdStart), u16(0)));

    var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }

  var CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  var DOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  function buildDocxBlob(turns) {
    var enc = new TextEncoder();
    var files = [
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(DOT_RELS) },
      { name: 'word/document.xml', data: enc.encode(buildDocumentXml(turns)) }
    ];
    return new Blob([zipSync(files)],
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ================================================================ *
   * 7. DOM -> Word-openable HTML (.doc fallback, MathML equations)    *
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
   * 8. Actions + panel UI                                            *
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
  panel.appendChild(btn('Download Markdown', doMarkdown));
  panel.appendChild(btn('Download Word (.doc)', doWordDoc));
  panel.appendChild(status);
  document.body.appendChild(panel);
})();
