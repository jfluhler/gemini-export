/* Test app-core: real markdown -> docx, validate OMML present + well-formed. */
const { parseHTML } = require('linkedom');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OUT = path.join(os.tmpdir(), 'gemini-export-tests');
fs.mkdirSync(OUT, { recursive: true });

const dom = parseHTML('<!doctype html><html><body></body></html>');
global.document = dom.document;
global.DOMParser = dom.DOMParser;      // linkedom's DOMParser
global.marked = require('marked');
global.katex = require('katex');

const { mdToDocxBytes } = require('../md2docx/app-core.js');

const md = fs.readFileSync('/Users/jfluhler/Downloads/gemini-conversation.md', 'utf8');
const bytes = mdToDocxBytes(md);
const outFile = path.join(OUT, 'from-markdown.docx');
fs.writeFileSync(outFile, bytes);
console.log('wrote', outFile);

// pull document.xml back out for inspection
const AppCore = require('../md2docx/app-core.js');
const html = AppCore.mdToHtml(md);
const d2 = parseHTML('<!doctype html><html><body>' + html + '</body></html>');
const xml = AppCore.documentXml(d2.document.body);

const omml = (xml.match(/<m:oMath>/g) || []).length;
const omathpara = (xml.match(/<m:oMathPara>/g) || []).length;
const latexLeftAsText = (xml.match(/\\frac|\\tau|\\int/g) || []).length;
console.log('bytes:', bytes.length);
console.log('m:oMath (inline+display):', omml);
console.log('m:oMathPara (display):', omathpara);
console.log('leftover raw LaTeX in text:', latexLeftAsText);
