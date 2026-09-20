// v0.4 privacy boundary: imported conversation HTML must never trigger
// network access merely because it was parsed or displayed.

const LOAD_ATTRS = ['src','srcset','poster','background'];

export function neutralizeHtmlForSafeParsing(input='',options={}){
  // Work on markup tokens only. Never run broad attribute regexes across text,
  // code blocks, or embedded JSON because archive fidelity is more important
  // than convenience.
  let html=String(input||'');
  // Styles are irrelevant to semantic extraction. Visual-replica export may opt to
  // keep them, but network-bearing CSS is stripped either way.
  html=html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,(m,attrs,css)=>{
    if(!options.preserveStyles)return '<style>/* styles suppressed during safe import */</style>';
    const safe=css.replace(/@import\b[^;]*;?/gi,'').replace(/url\s*\([^)]*\)/gi,'none');
    return `<style${attrs}>${safe}</style>`;
  });

  let out='',i=0;
  while(i<html.length){
    const lt=html.indexOf('<',i);
    if(lt<0){out+=html.slice(i);break;}
    out+=html.slice(i,lt);
    if(html.startsWith('<!--',lt)){
      const end=html.indexOf('-->',lt+4);
      if(end<0){out+=html.slice(lt);break;}
      out+=html.slice(lt,end+3);i=end+3;continue;
    }
    const end=findTagEnd(html,lt+1);
    if(end<0){out+=html.slice(lt);break;}
    const tag=html.slice(lt,end+1);
    const name=startTagName(tag);
    out+=neutralizeStartTag(tag);
    i=end+1;
    // Embedded archive JSON lives in <script type=application/json>. Its text may
    // legitimately contain strings that look like HTML; never tokenize inside it.
    if(name==='script'){
      const lower=html.toLowerCase();
      const close=lower.indexOf('</script',i);
      if(close>=0){
        out+=html.slice(i,close);
        const closeEnd=findTagEnd(html,close+2);
        if(closeEnd>=0){out+=html.slice(close,closeEnd+1);i=closeEnd+1;}
        else{out+=html.slice(close);i=html.length;}
      }else{out+=html.slice(i);i=html.length;}
    }
  }
  return out;
}
export function protectFragmentForDisplay(input=''){
  const doc=new DOMParser().parseFromString(`<div id="__archive_net_root">${String(input||'')}</div>`,'text/html');
  const root=doc.getElementById('__archive_net_root');
  if(!root) return '';

  root.querySelectorAll('script,noscript,iframe,object,embed,foreignObject,form,input,textarea,select,link,meta,base').forEach(x=>x.remove());

  const nodes=[root,...root.querySelectorAll('*')];
  for(const el of nodes){
    for(const attr of [...(el.attributes||[])]){
      const name=attr.name.toLowerCase();
      const value=String(attr.value||'').trim();
      if(name.startsWith('on')||name==='srcdoc'||name==='formaction'||name==='autofocus') el.removeAttribute(attr.name);
      else if((name==='href'||name==='src'||name==='xlink:href')&&/^javascript:/i.test(value)) el.removeAttribute(attr.name);
      else if(name==='style'&&/(url\s*\(|@import\b|expression\s*\()/i.test(value)) el.removeAttribute(attr.name);
    }

    const tag=el.tagName?.toLowerCase();
    if(tag==='a'){
      const href=el.getAttribute('href');
      if(href){
        el.setAttribute('rel','noopener noreferrer');
        el.setAttribute('referrerpolicy','no-referrer');
        el.setAttribute('target','_blank');
        if(isNetworkUrl(href)) el.classList.add('external-user-link');
      }
    }
  }

  // Images are the common automatic resource in archived transcripts. Inline data/blob
  // images remain visible. Anything else becomes an explicit user-initiated gate.
  for(const img of [...root.querySelectorAll('img')]){
    const original=firstAttr(img,['data-archiver-src','src']);
    img.removeAttribute('src'); img.removeAttribute('srcset'); img.removeAttribute('data-archiver-srcset');
    if(original && isInlineUrl(original)){
      img.setAttribute('src',original);
      img.removeAttribute('data-archiver-src');
      continue;
    }
    if(original){
      img.replaceWith(makeExternalGate(doc,original,'外部画像',img.getAttribute('alt')||''));
    }else{
      img.remove();
    }
  }

  // Other media are never auto-loaded. Offer a click-through instead.
  for(const media of [...root.querySelectorAll('video,audio,source,track')]){
    const original=firstAttr(media,['data-archiver-src','src','data-archiver-poster','poster']);
    if(original && !isInlineUrl(original)) media.replaceWith(makeExternalGate(doc,original,'外部メディア',''));
    else{
      media.removeAttribute('src');media.removeAttribute('poster');media.removeAttribute('srcset');
      if(tagName(media)==='source'||tagName(media)==='track')media.remove();
    }
  }

  // SVG may reference remote <image>/<use> resources.
  for(const el of [...root.querySelectorAll('image,use,feImage')]){
    const original=firstAttr(el,['data-archiver-href','data-archiver-xlink:href','href','xlink:href']);
    el.removeAttribute('href');el.removeAttribute('xlink:href');
    if(original&&!isInlineUrl(original)){
      const gate=makeExternalGate(doc,original,'外部SVGリソース','');
      // HTML button cannot live inside SVG. Put the gate immediately after the nearest SVG.
      const svg=el.closest('svg');
      if(svg?.parentNode) svg.parentNode.insertBefore(gate,svg.nextSibling);
    }
  }

  return root.innerHTML;
}

export function externalUrlFromGate(el){
  return String(el?.getAttribute?.('data-external-url')||'').trim();
}

export function isNetworkUrl(value=''){
  const s=String(value||'').trim();
  if(!s||s.startsWith('#')||isInlineUrl(s))return false;
  return /^(?:https?:)?\/\//i.test(s)||/^[a-z][a-z0-9+.-]*:/i.test(s)||/^(?:\.\.?\/|\/)/.test(s)||!s.includes(':');
}

export function isInlineUrl(value=''){
  return /^(?:data:|blob:)/i.test(String(value||'').trim());
}

function makeExternalGate(doc,url,label,alt){
  const b=doc.createElement('button');
  b.type='button';b.className='external-resource-gate';b.setAttribute('data-external-url',url);
  const host=displayHost(url);
  b.innerHTML=`<span>${escapeText(label)}</span>${alt?`<strong>${escapeText(alt)}</strong>`:''}<small>${escapeText(host)} · タップした場合のみ外部アクセス</small>`;
  return b;
}

function firstAttr(el,names){
  for(const name of names){const v=el.getAttribute?.(name);if(v)return v;}
  return '';
}
function tagName(el){return el?.tagName?.toLowerCase?.()||'';}
function displayHost(url){
  try{return new URL(url,location.href).host||String(url).slice(0,80);}catch{return String(url).slice(0,80);}
}
function neutralizeTagAttr(tag,attr){
  const escaped=attr.replace(':','\\:');
  const re=new RegExp(`\\s${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,'i');
  return tag.replace(re,(m,dq,sq,bare)=>{
    const value=dq??sq??bare??'';const quote=dq!==undefined?'"':sq!==undefined?"'":'"';
    return ` data-archiver-${attr}=${quote}${escapeAttrValue(value,quote)}${quote}`;
  });
}
function findTagEnd(html,start){
  let quote=null;
  for(let i=start;i<html.length;i++){
    const c=html[i];
    if(quote){if(c===quote)quote=null;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='>')return i;
  }
  return -1;
}
function startTagName(tag){const m=tag.match(/^<\s*([a-zA-Z0-9:-]+)/);return m?m[1].toLowerCase():'';}
function neutralizeStartTag(tag){
  if(/^<\s*\//.test(tag)||/^<\s*[!?]/.test(tag))return tag;
  const m=tag.match(/^<\s*([a-zA-Z0-9:-]+)/);if(!m)return tag;
  const name=m[1].toLowerCase();
  if(name==='base')return '';
  if(name==='meta'&&/http-equiv\s*=\s*(?:["']?refresh["']?)/i.test(tag))return '';
  let out=tag;
  for(const attr of LOAD_ATTRS)out=neutralizeTagAttr(out,attr);
  out=neutralizeTagAttr(out,'srcdoc');
  if(name==='object')out=neutralizeTagAttr(out,'data');
  if(['link','image','use','feimage'].includes(name)){
    out=neutralizeTagAttr(out,'href');
    out=neutralizeTagAttr(out,'xlink:href');
  }
  out=out.replace(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i,(whole,dq,sq)=>{
    const value=dq??sq??'';
    if(!/url\s*\(|@import\b/i.test(value))return whole;
    const quote=dq!==undefined?'"':"'";
    return ` data-archiver-style=${quote}${escapeAttrValue(value,quote)}${quote}`;
  });
  return out;
}
function escapeAttrValue(value,quote){
  const s=String(value).replace(/&/g,'&amp;');
  return quote==='"'?s.replace(/"/g,'&quot;'):s.replace(/'/g,'&#39;');
}
function escapeText(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
