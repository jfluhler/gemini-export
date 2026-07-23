/*
 * zip-selftest.js — validates the .docx packaging path independently of the
 * browser DOM. Uses the SAME zip/CRC logic as gemini-export.js and a hardcoded
 * document.xml with a sample equation, then writes sample.docx to a temp dir.
 * Run: node zip-selftest.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const OUT = path.join(os.tmpdir(), 'gemini-export-tests');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (function () {
  var t = [], n, k, c;
  for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) { var c = 0xFFFFFFFF; for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function u16(n) { return [n & 255, (n >>> 8) & 255]; }
function u32(n) { return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]; }

function zipSync(files) {
  var enc = new TextEncoder();
  var parts = [], central = [], offset = 0;
  function add(arr) { var u = arr instanceof Uint8Array ? arr : Uint8Array.from(arr); parts.push(u); offset += u.length; }
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
  var total = parts.reduce(function (a, p) { return a + p.length; }, 0);
  var out = new Uint8Array(total), pos = 0;
  parts.forEach(function (p) { out.set(p, pos); pos += p.length; });
  return out;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const DOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

/* Sample body: a heading, a sentence with inline math, and a display fraction. */
const DOCUMENT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
  '<w:body>' +
  '<w:p><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t>Self-test equation</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">Einstein said </w:t></w:r>' +
  '<m:oMath><m:r><m:t xml:space="preserve">E=</m:t></m:r>' +
  '<m:sSup><m:e><m:r><m:t>mc</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>' +
  '<w:r><w:t xml:space="preserve"> and a fraction:</w:t></w:r></w:p>' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>' +
  '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>' +
  '</m:oMath></m:oMathPara></w:p>' +
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>' +
  '</w:body></w:document>';

const enc = new TextEncoder();
const bytes = zipSync([
  { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
  { name: '_rels/.rels', data: enc.encode(DOT_RELS) },
  { name: 'word/document.xml', data: enc.encode(DOCUMENT) }
]);
const outFile = path.join(OUT, 'sample.docx');
fs.writeFileSync(outFile, bytes);
console.log('Wrote ' + outFile + ' (' + bytes.length + ' bytes)');
