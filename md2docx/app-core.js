/*
 * app-core.js — Markdown -> .docx (native equations) conversion core.
 * Runs in the browser (md2docx.html) and in Node (test harness).
 * Depends on globals: marked, katex, document, DOMParser, TextEncoder.
 * Exposes mdToDocxBytes(md) -> Uint8Array.
 */
(function (root) {
  'use strict';

  /* ---------- shared escaping ---------- */
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function xmlAttr(s) { return xmlEsc(s).replace(/"/g, '&quot;'); }
  function localName(el) { return el.tagName.toLowerCase().replace(/^[^:]*:/, ''); }
  function kids(el) { return Array.prototype.filter.call(el.childNodes, function (n) { return n.nodeType === 1; }); }

  /* ================================================================ *
   * 1. Markdown -> HTML, with $…$ / $$…$$ turned into math elements   *
   * ================================================================ */
  function mdToHtml(md) {
    /* Protect fenced/inline code so $ inside code isn't treated as math. */
    var segments = md.split(/(```[\s\S]*?```|`[^`\n]*`)/);
    var store = [];
    for (var i = 0; i < segments.length; i++) {
      if (i % 2 === 1) continue; /* odd = code, leave untouched */
      var s = segments[i];
      /* display math $$…$$ -> its own paragraph placeholder */
      s = s.replace(/\$\$([\s\S]+?)\$\$/g, function (_, tex) {
        var id = store.length; store.push({ latex: tex.trim(), display: true });
        return '\n\n@@MATH' + id + '@@\n\n';
      });
      /* inline math $…$ (no newline, not $$) */
      s = s.replace(/\$([^\$\n]+?)\$/g, function (_, tex) {
        var id = store.length; store.push({ latex: tex.trim(), display: false });
        return '@@MATH' + id + '@@';
      });
      segments[i] = s;
    }
    var parse = (typeof marked.parse === 'function') ? marked.parse : marked;
    var html = parse(segments.join(''), { gfm: true, breaks: false });

    /* Swap placeholders back to math elements carrying the LaTeX. */
    store.forEach(function (m, id) {
      if (m.display) {
        var block = '<div class="math-block" data-math="' + xmlAttr(m.latex) + '"></div>';
        var tag = '@@MATH' + id + '@@';
        /* marked wraps a lone placeholder in <p>…</p>; unwrap it. */
        if (html.indexOf('<p>' + tag + '</p>') !== -1) html = html.replace('<p>' + tag + '</p>', block);
        else html = html.replace(tag, block);
      } else {
        html = html.replace('@@MATH' + id + '@@',
          '<span class="math-inline" data-math="' + xmlAttr(m.latex) + '"></span>');
      }
    });
    return html;
  }

  /* ================================================================ *
   * 2. MathML -> OMML                                                 *
   * ================================================================ */
  function mmlChildren(el) { var s = ''; Array.prototype.forEach.call(el.childNodes, function (c) { s += mml(c); }); return s; }
  function tokenRun(el) { var t = el.textContent; if (t == null || t === '') return ''; return '<m:r><m:t xml:space="preserve">' + xmlEsc(t) + '</m:t></m:r>'; }
  function grp(el) { return el ? mml(el) : ''; }
  function mmlAccentOr(el, pos) {
    var c = kids(el), base = c[0], mark = c[1];
    var acc = el.getAttribute('accent') === 'true' || el.getAttribute('accentunder') === 'true';
    if (acc && mark) return '<m:acc><m:accPr><m:chr m:val="' + xmlAttr(mark.textContent || '') + '"/></m:accPr><m:e>' + grp(base) + '</m:e></m:acc>';
    if (pos === 'under') return '<m:limLow><m:e>' + grp(base) + '</m:e><m:lim>' + grp(mark) + '</m:lim></m:limLow>';
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
      Array.prototype.forEach.call(tr.children, function (td) { cells += '<m:e>' + mmlChildren(td) + '</m:e>'; });
      rows += '<m:mr>' + cells + '</m:mr>';
    });
    return '<m:m>' + rows + '</m:m>';
  }
  function mmlFenced(el) {
    var open = el.getAttribute('open'); if (open == null) open = '(';
    var close = el.getAttribute('close'); if (close == null) close = ')';
    return '<m:d><m:dPr><m:begChr m:val="' + xmlAttr(open) + '"/><m:endChr m:val="' + xmlAttr(close) + '"/></m:dPr><m:e>' + mmlChildren(el) + '</m:e></m:d>';
  }
  function mml(node) {
    if (node.nodeType !== 1) return '';
    var el = node, tag = localName(el), c = kids(el);
    switch (tag) {
      case 'annotation': return '';
      case 'math': case 'semantics': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose': case 'mphantom': case 'merror': return mmlChildren(el);
      case 'mi': case 'mn': case 'mo': case 'mtext': case 'ms': return tokenRun(el);
      case 'mspace': return '<m:r><m:t xml:space="preserve"> </m:t></m:r>';
      case 'mfrac': return '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>' + grp(c[0]) + '</m:num><m:den>' + grp(c[1]) + '</m:den></m:f>';
      case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + mmlChildren(el) + '</m:e></m:rad>';
      case 'mroot': return '<m:rad><m:deg>' + grp(c[1]) + '</m:deg><m:e>' + grp(c[0]) + '</m:e></m:rad>';
      case 'msup': return '<m:sSup><m:e>' + grp(c[0]) + '</m:e><m:sup>' + grp(c[1]) + '</m:sup></m:sSup>';
      case 'msub': return '<m:sSub><m:e>' + grp(c[0]) + '</m:e><m:sub>' + grp(c[1]) + '</m:sub></m:sSub>';
      case 'msubsup': return '<m:sSubSup><m:e>' + grp(c[0]) + '</m:e><m:sub>' + grp(c[1]) + '</m:sub><m:sup>' + grp(c[2]) + '</m:sup></m:sSubSup>';
      case 'munder': return mmlAccentOr(el, 'under');
      case 'mover': return mmlAccentOr(el, 'over');
      case 'munderover': return mmlUnderOver(el);
      case 'mtable': return mmlTable(el);
      case 'mfenced': return mmlFenced(el);
      default: return mmlChildren(el);
    }
  }
  function mathToOmml(math) {
    if (!math) return '';
    var sem = math.querySelector('semantics');
    var nodes = sem ? Array.prototype.slice.call(sem.childNodes) : Array.prototype.slice.call(math.childNodes);
    var out = '';
    nodes.forEach(function (n) { if (n.nodeType === 1 && localName(n) === 'annotation') return; out += mml(n); });
    return out;
  }
  function latexToMath(latex, display) {
    try {
      var html = katex.renderToString(latex, { output: 'mathml', throwOnError: false, displayMode: !!display });
      var doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.querySelector('math');
    } catch (e) { return null; }
  }
  function latexToOmml(latex, display) { return mathToOmml(latexToMath(latex, display)); }

  /* ================================================================ *
   * 3. HTML DOM -> WordprocessingML                                   *
   * ================================================================ */
  var F0 = {};
  function assign(f, extra) { var o = {}, k; for (k in f) o[k] = f[k]; if (extra) for (k in extra) o[k] = extra[k]; return o; }
  function runText(text, f) {
    if (!text) return '';
    var rpr = '';
    if (f.b) rpr += '<w:b/>';
    if (f.i) rpr += '<w:i/>';
    if (f.mono) rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (f.sz) rpr += '<w:sz w:val="' + f.sz + '"/><w:szCs w:val="' + f.sz + '"/>';
    if (f.color) rpr += '<w:color w:val="' + f.color + '"/>';
    return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
  }
  function inlineNode(c, f) {
    if (c.nodeType === 3) { var t = c.textContent.replace(/\s+/g, ' '); return t ? runText(t, f) : ''; }
    if (c.nodeType !== 1) return '';
    var el = c, tag = el.tagName.toLowerCase();
    if (el.classList.contains('math-inline') || el.classList.contains('math-block')) {
      var latex = (el.getAttribute('data-math') || '').trim();
      if (!latex) return '';
      var mo = latexToOmml(latex, el.classList.contains('math-block'));
      return mo ? '<m:oMath>' + mo + '</m:oMath>' : runText(latex, assign(f, { i: 1 }));
    }
    switch (tag) {
      case 'br': return '<w:br/>';
      case 'strong': case 'b': return inlineRuns(el, assign(f, { b: 1 }));
      case 'em': case 'i': return inlineRuns(el, assign(f, { i: 1 }));
      case 'code': return el.closest('pre') ? inlineRuns(el, f) : runText(el.textContent, assign(f, { mono: 1 }));
      default: return inlineRuns(el, f);
    }
  }
  function inlineRuns(parent, f) { var out = ''; Array.prototype.forEach.call(parent.childNodes, function (c) { out += inlineNode(c, f); }); return out; }
  function para(runs, pPr) { if (!runs && !pPr) return ''; return '<w:p>' + (pPr || '') + (runs || '') + '</w:p>'; }
  function headingPr() { return '<w:pPr><w:spacing w:before="200" w:after="80"/><w:keepNext/></w:pPr>'; }
  function displayEqFromLatex(el) {
    var latex = (el.getAttribute('data-math') || '').trim();
    if (!latex) return '';
    var om = latexToOmml(latex, true);
    if (om) return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>' + om + '</m:oMath></m:oMathPara></w:p>';
    return para(runText(latex, { i: 1 }), '<w:pPr><w:jc w:val="center"/></w:pPr>');
  }
  function listBlocks(listEl, ordered, depth) {
    var out = '', i = 0;
    Array.prototype.forEach.call(listEl.children, function (li) {
      if (li.tagName.toLowerCase() !== 'li') return;
      i++;
      var runs = runText(ordered ? (i + '. ') : '• ', F0);
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
    text.split('\n').forEach(function (ln, idx) { if (idx) runs += '<w:br/>'; runs += runText(ln, { mono: 1 }); });
    return '<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/><w:spacing w:before="80" w:after="80"/></w:pPr>' + runs + '</w:p>';
  }
  function quoteBlock(el) {
    return '<w:p><w:pPr><w:ind w:left="360"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="DADCE0"/></w:pBdr></w:pPr>' + inlineRuns(el, { i: 1 }) + '</w:p>';
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
    var b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
      return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="DADCE0"/>';
    }).join('') + '</w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + b + '</w:tblPr>' + rowsXml + '</w:tbl>';
  }
  function isBlockTag(t) { return /^(p|div|section|article|main|ul|ol|pre|table|blockquote|figure|h[1-6])$/.test(t); }
  function hasBlockChild(el) {
    return Array.prototype.some.call(el.children, function (c) {
      return isBlockTag(c.tagName.toLowerCase()) || c.classList.contains('math-block') || (c.children && c.children.length && hasBlockChild(c));
    });
  }
  function contentBlocks(root) {
    var out = '';
    Array.prototype.forEach.call(root.childNodes, function (node) {
      if (node.nodeType === 3) { var t = node.textContent.trim(); if (t) out += para(runText(t, F0)); return; }
      if (node.nodeType !== 1) return;
      var el = node, tag = el.tagName.toLowerCase();
      if (el.classList.contains('math-block')) { out += displayEqFromLatex(el); return; }
      if (el.classList.contains('math-inline')) { out += para(inlineNode(el, F0)); return; }
      switch (tag) {
        case 'h1': out += para(inlineRuns(el, { b: 1, sz: 34 }), headingPr()); break;
        case 'h2': out += para(inlineRuns(el, { b: 1, sz: 30 }), headingPr()); break;
        case 'h3': out += para(inlineRuns(el, { b: 1, sz: 26 }), headingPr()); break;
        case 'h4': case 'h5': case 'h6': out += para(inlineRuns(el, { b: 1, sz: 24 }), headingPr()); break;
        case 'p': out += para(inlineRuns(el, F0)); break;
        case 'ul': out += listBlocks(el, false, 0); break;
        case 'ol': out += listBlocks(el, true, 0); break;
        case 'pre': out += preBlock(el); break;
        case 'blockquote': out += quoteBlock(el); break;
        case 'table': out += tableBlock(el); break;
        case 'hr': out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'; break;
        case 'br': break;
        default: if (hasBlockChild(el)) out += contentBlocks(el); else out += para(inlineRuns(el, F0));
      }
    });
    return out;
  }
  function documentXml(bodyEl) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' +
      contentBlocks(bodyEl) +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  /* ================================================================ *
   * 4. Minimal ZIP (store) -> .docx bytes                             *
   * ================================================================ */
  var CRC_TABLE = (function () { var t = [], n, k, c; for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function u16(n) { return [n & 255, (n >>> 8) & 255]; }
  function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }
  function zipSync(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function add(a) { var u = a instanceof Uint8Array ? a : Uint8Array.from(a); parts.push(u); offset += u.length; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data), size = data.length, lo = offset;
      add([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(size), u32(size), u16(name.length), u16(0)));
      add(name); add(data);
      central.push({ name: name, crc: crc, size: size, off: lo });
    });
    var cdStart = offset;
    central.forEach(function (c) {
      add([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.off)));
      add(c.name);
    });
    add([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(offset - cdStart), u32(cdStart), u16(0)));
    var total = parts.reduce(function (a, p) { return a + p.length; }, 0), out = new Uint8Array(total), pos = 0;
    parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
    return out;
  }
  var CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
  var DOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

  function mdToDocxBytes(md) {
    var html = mdToHtml(md);
    var doc = new DOMParser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html');
    var enc = new TextEncoder();
    return zipSync([
      { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
      { name: '_rels/.rels', data: enc.encode(DOT_RELS) },
      { name: 'word/document.xml', data: enc.encode(documentXml(doc.body)) }
    ]);
  }

  root.AppCore = { mdToDocxBytes: mdToDocxBytes, mdToHtml: mdToHtml, documentXml: documentXml };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AppCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
