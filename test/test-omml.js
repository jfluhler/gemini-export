/* Runs the real converter functions against realistic KaTeX MathML. */
const { parseHTML } = require('linkedom');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OUT = path.join(os.tmpdir(), 'gemini-export-tests');
fs.mkdirSync(OUT, { recursive: true });

// KaTeX-style output for:  x^2 + \frac{a}{b} = \sqrt{c},  and \sum_{i=1}^{n} i
const HTML = `<div class="markdown">
<p>Inline <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo>=</mo><msqrt><mi>c</mi></msqrt></mrow><annotation encoding="application/x-tex">x^2 + \\frac{a}{b} = \\sqrt{c}</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">VISUAL</span></span> done.</p>
<span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><munderover><mo>∑</mo><mrow><mi>i</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>i</mi></mrow><annotation encoding="application/x-tex">\\sum_{i=1}^{n} i</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">VISUAL</span></span></span>
</div>`;

const { document } = parseHTML(`<!doctype html><html><body>${HTML}</body></html>`);
global.document = document;

// ---- copy of converter internals from gemini-export.js ----
function xmlEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function xmlAttr(s){return xmlEsc(s).replace(/"/g,'&quot;');}
function localName(el){return el.tagName.toLowerCase().replace(/^[^:]*:/,'');}
function kids(el){return Array.prototype.filter.call(el.childNodes,function(n){return n.nodeType===1;});}
function katexMath(el){return el.querySelector('.katex-mathml math')||el.querySelector('math');}
function mmlChildren(el){var s='';Array.prototype.forEach.call(el.childNodes,function(c){s+=mml(c);});return s;}
function tokenRun(el){var t=el.textContent;if(t==null||t==='')return '';return '<m:r><m:t xml:space="preserve">'+xmlEsc(t)+'</m:t></m:r>';}
function grp(el){return el?mml(el):'';}
function mmlAccentOr(el,pos){var c=kids(el),base=c[0],mark=c[1];var acc=el.getAttribute('accent')==='true'||el.getAttribute('accentunder')==='true';if(acc&&mark)return '<m:acc><m:accPr><m:chr m:val="'+xmlAttr(mark.textContent||'')+'"/></m:accPr><m:e>'+grp(base)+'</m:e></m:acc>';if(pos==='under')return '<m:limLow><m:e>'+grp(base)+'</m:e><m:lim>'+grp(mark)+'</m:lim></m:limLow>';return '<m:limUpp><m:e>'+grp(base)+'</m:e><m:lim>'+grp(mark)+'</m:lim></m:limUpp>';}
function mmlUnderOver(el){var c=kids(el),base=c[0],under=c[1],over=c[2];var inner='<m:limLow><m:e>'+grp(base)+'</m:e><m:lim>'+grp(under)+'</m:lim></m:limLow>';return '<m:limUpp><m:e>'+inner+'</m:e><m:lim>'+grp(over)+'</m:lim></m:limUpp>';}
function mml(node){
  if(node.nodeType!==1)return '';
  var el=node,tag=localName(el),c=kids(el);
  switch(tag){
    case 'annotation':return '';
    case 'math':case 'semantics':case 'mrow':case 'mstyle':case 'mpadded':case 'menclose':case 'mphantom':case 'merror':return mmlChildren(el);
    case 'mi':case 'mn':case 'mo':case 'mtext':case 'ms':return tokenRun(el);
    case 'mspace':return '<m:r><m:t xml:space="preserve"> </m:t></m:r>';
    case 'mfrac':return '<m:f><m:fPr><m:type m:val="bar"/></m:fPr><m:num>'+grp(c[0])+'</m:num><m:den>'+grp(c[1])+'</m:den></m:f>';
    case 'msqrt':return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>'+mmlChildren(el)+'</m:e></m:rad>';
    case 'mroot':return '<m:rad><m:deg>'+grp(c[1])+'</m:deg><m:e>'+grp(c[0])+'</m:e></m:rad>';
    case 'msup':return '<m:sSup><m:e>'+grp(c[0])+'</m:e><m:sup>'+grp(c[1])+'</m:sup></m:sSup>';
    case 'msub':return '<m:sSub><m:e>'+grp(c[0])+'</m:e><m:sub>'+grp(c[1])+'</m:sub></m:sSub>';
    case 'msubsup':return '<m:sSubSup><m:e>'+grp(c[0])+'</m:e><m:sub>'+grp(c[1])+'</m:sub><m:sup>'+grp(c[2])+'</m:sup></m:sSubSup>';
    case 'munder':return mmlAccentOr(el,'under');
    case 'mover':return mmlAccentOr(el,'over');
    case 'munderover':return mmlUnderOver(el);
    default:return mmlChildren(el);
  }
}
function katexToOmml(katexSpan){
  var math=katexMath(katexSpan);
  if(!math){console.log('  !! katexMath returned null');return '';}
  var sem=math.querySelector('semantics');
  var nodes=sem?Array.prototype.slice.call(sem.childNodes):Array.prototype.slice.call(math.childNodes);
  var out='';nodes.forEach(function(n){if(n.nodeType===1&&localName(n)==='annotation')return;out+=mml(n);});
  return out;
}

const eqs = [];
document.querySelectorAll('.katex').forEach(function(k,i){
  console.log('--- equation '+(i+1)+' ---');
  var omml = katexToOmml(k);
  console.log('length:', omml.length);
  console.log(omml);
  console.log();
  eqs.push(omml);
});

// ---- build a real docx from these equations (same zip code as the tool) ----
const CRC_TABLE=(function(){var t=[],n,k,c;for(n=0;n<256;n++){c=n;for(k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c>>>0;}return t;})();
function crc32(b){var c=0xFFFFFFFF;for(var i=0;i<b.length;i++)c=CRC_TABLE[(c^b[i])&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function u16(n){return[n&255,(n>>>8)&255];}function u32(n){return[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];}
function zipSync(files){var enc=new TextEncoder();var parts=[],central=[],offset=0;function add(a){var u=a instanceof Uint8Array?a:Uint8Array.from(a);parts.push(u);offset+=u.length;}files.forEach(function(f){var name=enc.encode(f.name),data=f.data,crc=crc32(data),size=data.length,lo=offset;add([].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(size),u32(size),u16(name.length),u16(0)));add(name);add(data);central.push({name:name,crc:crc,size:size,off:lo});});var cdStart=offset;central.forEach(function(c){add([].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(c.crc),u32(c.size),u32(c.size),u16(c.name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(c.off)));add(c.name);});add([].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(offset-cdStart),u32(cdStart),u16(0)));var total=parts.reduce(function(a,p){return a+p.length;},0);var out=new Uint8Array(total),pos=0;parts.forEach(function(p){out.set(p,pos);pos+=p.length;});return out;}

const CT='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const RELS='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
const DOC='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>'+
  '<w:p><w:r><w:t xml:space="preserve">Inline: </w:t></w:r><m:oMath>'+eqs[0]+'</m:oMath></w:p>'+
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>'+eqs[1]+'</m:oMath></m:oMathPara></w:p>'+
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';

const enc=new TextEncoder();
fs.writeFileSync(path.join(OUT, 'test-equations.docx'), zipSync([
  {name:'[Content_Types].xml',data:enc.encode(CT)},
  {name:'_rels/.rels',data:enc.encode(RELS)},
  {name:'word/document.xml',data:enc.encode(DOC)}
]));
fs.writeFileSync(path.join(OUT, 'test-equations.document.xml'), DOC);
console.log('Wrote', path.join(OUT, 'test-equations.docx'));
