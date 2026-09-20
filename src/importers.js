import { basename, extractMessageText, fmtTime, normalizeText, roleOf, sha256, stableId } from './core.js';

export async function importFiles(files, onProgress = () => {}) {
  const sources = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({stage:'read', current:i+1, total:files.length, name:file.name});
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.zip')) sources.push(await importZip(file, onProgress));
    else if (lower.endsWith('.json')) sources.push(await importJsonFile(file));
    else if (lower.endsWith('.html') || lower.endsWith('.htm')) sources.push(await importHtmlFile(file));
    else throw new Error(`未対応のファイル形式です: ${file.name}`);
  }
  return sources;
}

async function importZip(file, onProgress) {
  if (!globalThis.JSZip) throw new Error('ZIPライブラリの読み込みに失敗しました。');
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = await sha256(rawBytes);
  const zip = await JSZip.loadAsync(rawBytes);
  const entries = Object.values(zip.files).filter(e => !e.dir);
  const entryNames = entries.map(e => e.name);
  const assetIndex = new Map();
  for (const name of entryNames) {
    assetIndex.set(name, true);
    assetIndex.set(basename(name), true);
  }

  let candidates = entries.filter(e => /(^|\/)conversations(?:[-_ .]?\d+)?\.json$/i.test(e.name));
  if (!candidates.length) candidates = entries.filter(e => /conversation.*\.json$/i.test(basename(e.name)));
  if (!candidates.length) candidates = entries.filter(e => /\.json$/i.test(e.name));

  const conversations = [];
  const jsonFiles = [];
  for (let i=0;i<candidates.length;i++) {
    const entry = candidates[i];
    onProgress({stage:'parse', current:i+1, total:candidates.length, name:entry.name});
    let text;
    try { text = await entry.async('text'); } catch { continue; }
    let parsed;
    try { parsed = JSON.parse(text); } catch { continue; }
    const convs = findConversationObjects(parsed);
    if (!convs.length) continue;
    jsonFiles.push({name:entry.name, rawText:text});
    for (const c of convs) conversations.push(await normalizeOpenAIConversation(c, entry.name, assetIndex));
  }

  if (!conversations.length) throw new Error('ZIP内からChatGPT会話JSONを認識できませんでした。展開済みJSONを直接選択して試すこともできます。');

  return {
    id: stableId('source'),
    kind: 'openai-export-zip',
    name: file.name,
    importedAt: new Date().toISOString(),
    rawFileHash: fileHash,
    rawSize: rawBytes.byteLength,
    entryNames,
    conversations,
    jsonFiles,
    sourceFile: file,
  };
}

async function importJsonFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const convs = findConversationObjects(parsed);
  if (!convs.length) throw new Error(`${file.name} をChatGPT会話JSONとして認識できませんでした。`);
  const conversations = [];
  for (const c of convs) conversations.push(await normalizeOpenAIConversation(c, file.name, new Map()));
  return {
    id: stableId('source'), kind:'openai-json', name:file.name, importedAt:new Date().toISOString(),
    rawFileHash: await sha256(text), rawSize:new Blob([text]).size,
    entryNames:[file.name], conversations, jsonFiles:[{name:file.name, rawText:text}], sourceFile:file,
  };
}

async function importHtmlFile(file) {
  const html = await file.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const extracted = extractMessagesFromHtml(doc);
  const visualHtml = extractVisualReplicaHtml(doc);
  const rawOriginalText = extractRawOriginalText(doc);
  const embeddedSnapshot = extractArchiveSnapshot(doc);
  const embeddedOpenAI = parseOpenAIRaw(rawOriginalText);

  let conversation = null;
  let htmlFlavor = detectHtmlFlavor(doc, extracted);

  // v0.2+ archives embed their normalized graph explicitly. Prefer that because it
  // preserves branch topology even when only one transcript path is visible.
  if (embeddedSnapshot?.conversation?.nodes) {
    conversation = await hydrateConversationSnapshot(embeddedSnapshot.conversation, file.name);
    conversation.sourceFormat = 'v15-html';
    htmlFlavor = 'v15-embedded';
  }

  // Older v15 files may contain the original OpenAI conversation JSON in the
  // Raw Original pane. Recover that graph when possible instead of flattening it.
  if (!conversation && embeddedOpenAI) {
    conversation = await normalizeOpenAIConversation(embeddedOpenAI, file.name, new Map());
    conversation.sourceFormat = 'v15-html';
    htmlFlavor = 'v15-raw-recovered';
  }

  if (conversation) {
    attachRichHtmlToConversation(conversation, extracted);
  } else {
    const nodes = {};
    let previous = null;
    extracted.forEach((m, i) => {
      const id = `html-${i+1}`;
      nodes[id] = {
        id, parent:previous, children:[], role:m.role, text:m.text,
        normalizedText:normalizeText(m.text), raw:null, createTime:null,
        sourceIndex:i, richHtml:m.richHtml || null,
      };
      if (previous) nodes[previous].children.push(id);
      previous = id;
    });
    await addHashes(nodes);
    const title = (doc.querySelector('title')?.textContent || file.name).replace(/\s+[—|-]\s+Archive\s*$/i,'').trim();
    conversation = {
      id:null, title, createTime:null, updateTime:null, currentNode:previous,
      sourceFormat:'html-capture', sourceName:file.name,
      nodes, rootIds: extracted.length ? ['html-1'] : [], rawObject:null,
    };
  }

  conversation.htmlRaw = html;
  conversation.visualHtml = visualHtml;
  conversation.rawOriginalText = rawOriginalText;
  conversation.htmlFlavor = htmlFlavor;

  return {
    id: stableId('source'), kind:'html-capture', name:file.name, importedAt:new Date().toISOString(),
    rawFileHash:await sha256(html), rawSize:new Blob([html]).size,
    entryNames:[file.name], conversations:[conversation], htmlRaw:html,
    htmlFlavor, sourceFile:file,
  };
}

function findConversationObjects(parsed) {
  const found = [];
  const accept = c => c && typeof c === 'object' && c.mapping && typeof c.mapping === 'object';
  if (Array.isArray(parsed)) parsed.forEach(x => { if (accept(x)) found.push(x); });
  else if (accept(parsed)) found.push(parsed);
  else if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed)) {
      if (Array.isArray(v)) v.forEach(x => { if (accept(x)) found.push(x); });
      else if (accept(v)) found.push(v);
    }
  }
  return found;
}

async function normalizeOpenAIConversation(c, sourceName, assetIndex) {
  const nodes = {};
  for (const [mappingKey, node] of Object.entries(c.mapping || {})) {
    const message = node?.message ?? null;
    const id = String(node?.id ?? mappingKey);
    const text = extractMessageText(message);
    const refs = collectReferenceCandidates(message);
    nodes[id] = {
      id,
      mappingKey,
      parent: node?.parent == null ? null : String(node.parent),
      children: Array.isArray(node?.children) ? node.children.map(String) : [],
      role: roleOf(message),
      text,
      normalizedText: normalizeText(text),
      createTime: fmtTime(message?.create_time ?? node?.create_time),
      updateTime: fmtTime(message?.update_time ?? node?.update_time),
      messageId: message?.id ? String(message.id) : null,
      contentType: message?.content?.content_type ?? null,
      status: message?.status ?? null,
      references: refs.map(r => ({...r, resolved: resolveRef(r.value, assetIndex)})),
      raw: node,
    };
  }
  await addHashes(nodes);
  const rootIds = Object.values(nodes).filter(n => n.parent == null).map(n => n.id);
  return {
    id: c.id ?? c.conversation_id ?? null,
    title: c.title ?? '(無題)',
    createTime: fmtTime(c.create_time), updateTime: fmtTime(c.update_time),
    currentNode: c.current_node ? String(c.current_node) : null,
    sourceFormat:'openai-export', sourceName,
    nodes, rootIds, rawObject:c,
  };
}

async function hydrateConversationSnapshot(src, sourceName) {
  const nodes = {};
  for (const [key, rawNode] of Object.entries(src.nodes || {})) {
    const id = String(rawNode?.id ?? key);
    nodes[id] = {
      ...rawNode,
      id,
      parent: rawNode?.parent == null ? null : String(rawNode.parent),
      children: Array.isArray(rawNode?.children) ? rawNode.children.map(String) : [],
      role: normalizeRole(rawNode?.role) || 'unknown',
      text: String(rawNode?.text ?? ''),
      normalizedText: normalizeText(rawNode?.text ?? ''),
      raw: null,
    };
  }
  await addHashes(nodes);
  const rootIds = Array.isArray(src.rootIds) && src.rootIds.length
    ? src.rootIds.map(String).filter(id=>nodes[id])
    : Object.values(nodes).filter(n=>n.parent==null).map(n=>n.id);
  return {
    id: src.id ?? null,
    title: src.title ?? '(無題)',
    createTime: src.createTime ?? null,
    updateTime: src.updateTime ?? null,
    currentNode: src.currentNode && nodes[String(src.currentNode)] ? String(src.currentNode) : inferCurrentNode(nodes),
    sourceFormat:'v15-html', sourceName,
    nodes, rootIds, rawObject:null,
  };
}

async function addHashes(nodes) {
  const list = Object.values(nodes);
  await Promise.all(list.map(async n => {
    n.normalizedText = normalizeText(n.text);
    n.rawTextHash = await sha256(n.text);
    n.normalizedTextHash = await sha256(n.normalizedText);
    n.anchorHash = await sha256(`${n.role}\0${n.normalizedText}`);
  }));
  await Promise.all(list.map(async n => {
    const p = n.parent && nodes[n.parent] ? nodes[n.parent] : null;
    const children = (n.children || []).map(id => nodes[id]).filter(Boolean);
    const parentAnchor = p?.anchorHash ?? '';
    n.parentContextHash = await sha256(`${parentAnchor}\0${n.anchorHash}`);
    n.neighborhoodHash = await sha256(`${parentAnchor}\0${n.anchorHash}\0${children.map(c=>c.anchorHash).sort().join('\0')}`);
  }));
}

function collectReferenceCandidates(obj) {
  const out = [];
  const seen = new Set();
  const keyPattern = /(file|asset|attach|image|audio|video|upload|pointer|url|path)/i;
  function walk(v, path=[]) {
    if (Array.isArray(v)) return v.forEach((x,i)=>walk(x,path.concat(i)));
    if (!v || typeof v !== 'object') return;
    for (const [k,val] of Object.entries(v)) {
      const p = path.concat(k);
      if (typeof val === 'string' && keyPattern.test(k)) {
        const key = `${p.join('.')}\0${val}`;
        if (!seen.has(key)) { seen.add(key); out.push({path:p.join('.'), key:k, value:val}); }
      }
      if (val && typeof val === 'object') walk(val,p);
    }
  }
  walk(obj);
  return out;
}

function resolveRef(value, assetIndex) {
  if (!value || !assetIndex?.size) return 'unknown';
  const raw = String(value);
  const clean = raw.replace(/^file:\/\//,'').replace(/^sandbox:\/\//,'').split(/[?#]/)[0];
  const base = basename(clean);
  if (assetIndex.has(clean) || assetIndex.has(base)) return 'found';
  if (/^(https?:|data:|blob:|sediment:|openai:)/i.test(raw)) return 'logical';
  if (/[/\\]|\.[a-z0-9]{2,6}$/i.test(clean)) return 'missing';
  return 'logical';
}

function extractMessagesFromHtml(doc) {
  const selectors = [
    '[data-archive-role]',
    'article.msg',
    'article.message',
    '.transcript .msg',
    '.transcript .message',
    '#semantic .msg',
    '#semantic .message',
    '#transcript .msg',
    '#transcript .message',
    '[data-message-author-role]',
  ];
  for (const selector of selectors) {
    const items = extractBySelector(doc, selector);
    if (items.length) return dedupeConsecutive(items);
  }

  // Last-resort legacy scan. Require an explicit role marker to avoid treating
  // navigation or page chrome as conversation messages.
  const candidates = [...doc.querySelectorAll('article,section,div')].filter(el => {
    if (!roleFromElement(el)) return false;
    return Boolean(findBodyElement(el));
  });
  return dedupeConsecutive(candidates.map(messageFromElement).filter(Boolean));
}

function extractBySelector(doc, selector) {
  const out=[];
  for (const el of doc.querySelectorAll(selector)) {
    const item=messageFromElement(el);
    if(item)out.push(item);
  }
  return out;
}

function messageFromElement(el) {
  const role = roleFromElement(el);
  if (!role) return null;
  const body = findBodyElement(el) || el;
  const text = cleanElementText(body, body===el);
  if (!text) return null;
  return {role, text, richHtml:sanitizeRichHtml(body), sourceTag:el.tagName?.toLowerCase() || ''};
}

function roleFromElement(el) {
  const attrs = [
    el.getAttribute?.('data-archive-role'),
    el.getAttribute?.('data-message-author-role'),
    el.getAttribute?.('data-role'),
    el.getAttribute?.('data-speaker'),
    el.getAttribute?.('data-author'),
  ];
  for (const v of attrs) { const role=normalizeRole(v); if(role)return role; }

  for (const c of [...(el.classList || [])]) { const role=normalizeRole(c); if(role)return role; }

  const label = el.querySelector?.('.role,.speaker,.author,.message-role,.message-author,[data-role-label]');
  const role = normalizeRole(label?.textContent);
  return role || null;
}

function normalizeRole(value) {
  const s=normalizeText(value).toLowerCase().replace(/[：:]\s*$/,'').trim();
  if(!s)return null;
  if (/^(user|human|you|ユーザー)$/.test(s)) return 'user';
  if (/^(assistant|chatgpt|gpt|ai|model|アシスタント)$/.test(s)) return 'assistant';
  return null;
}

function findBodyElement(el) {
  if (el.matches?.('[data-archive-body]')) return el;
  const candidates = [
    '[data-archive-body]', '.body', '.message-body', '.message-content', '.content',
    '.markdown', '.prose', '.text', '.boxed', '.message-text'
  ];
  for (const selector of candidates) {
    const body=el.querySelector?.(selector);
    if(body)return body;
  }
  return null;
}

function cleanElementText(el, stripRoleLabel=false) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,button,input,textarea,select,form,nav').forEach(x=>x.remove());
  if(stripRoleLabel) clone.querySelectorAll('.role,.speaker,.author,.message-role,.message-author,[data-role-label]').forEach(x=>x.remove());
  clone.querySelectorAll('br').forEach(x=>x.replaceWith('\n'));
  clone.querySelectorAll('p,div,li,tr,pre,blockquote,h1,h2,h3,h4,h5,h6').forEach(x=>x.append('\n'));
  return (clone.textContent || '').replace(/\u00a0/g,' ').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function sanitizeRichHtml(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('script,style,noscript,button,input,textarea,select,form,nav,iframe,object,embed,foreignObject').forEach(x=>x.remove());
  const all=[clone,...clone.querySelectorAll('*')];
  for(const node of all){
    for(const attr of [...(node.attributes||[])]){
      const name=attr.name.toLowerCase(); const value=String(attr.value||'').trim();
      if(name.startsWith('on') || name==='srcdoc' || name==='formaction' || name==='autofocus') node.removeAttribute(attr.name);
      else if((name==='href'||name==='src'||name==='xlink:href') && /^javascript:/i.test(value)) node.removeAttribute(attr.name);
      else if(name==='id') node.removeAttribute(attr.name);
    }
    if(node.tagName?.toLowerCase()==='a'){
      node.setAttribute('rel','noopener noreferrer');
      if(!node.getAttribute('target'))node.setAttribute('target','_blank');
    }
  }
  return clone.innerHTML;
}

function dedupeConsecutive(items) {
  const out=[];
  for (const item of items) {
    const last=out[out.length-1];
    if (last && last.role===item.role && normalizeText(last.text)===normalizeText(item.text)) continue;
    out.push(item);
  }
  return out;
}

function extractArchiveSnapshot(doc) {
  const el=doc.querySelector('script#archive-conversation[type="application/json"],script[data-archive-conversation][type="application/json"]');
  if(!el)return null;
  try{
    const parsed=JSON.parse(el.textContent||'');
    if(parsed?.conversation?.nodes)return parsed;
    if(parsed?.nodes)return {conversation:parsed};
  }catch{}
  return null;
}

function extractRawOriginalText(doc) {
  const selectors = [
    '#raw pre', '#raw-original pre', '#rawOriginal pre', '[data-layer="raw"] pre', '.raw-original pre',
    'pre[data-raw-original]', 'script[data-openai-raw][type="application/json"]'
  ];
  for(const selector of selectors){
    const el=doc.querySelector(selector);
    if(el && (el.textContent||'').trim()) return (el.textContent||'').trim();
  }
  return null;
}

function parseOpenAIRaw(text) {
  if(!text)return null;
  try{
    const parsed=JSON.parse(text);
    return findConversationObjects(parsed)[0] || null;
  }catch{return null;}
}

function extractVisualReplicaHtml(doc) {
  const frame=doc.querySelector('#visual iframe[srcdoc],#visual-replica iframe[srcdoc],#visualReplica iframe[srcdoc],[data-layer="visual"] iframe[srcdoc],iframe[data-visual-replica][srcdoc]');
  if(frame?.getAttribute('srcdoc'))return frame.getAttribute('srcdoc');
  return null;
}

function detectHtmlFlavor(doc, extracted) {
  if(doc.querySelector('script#archive-conversation'))return 'v15-embedded';
  if(doc.querySelector('#visual,#semantic,#raw') || doc.querySelector('article.msg .role'))return 'legacy-v15';
  if(doc.querySelector('[data-message-author-role]'))return 'chatgpt-capture';
  return extracted.length?'generic-transcript':'unknown-html';
}

function attachRichHtmlToConversation(conv, extracted) {
  if(!extracted.length)return;
  const path=currentOrLongestPath(conv).filter(id=>['user','assistant'].includes(conv.nodes[id]?.role));
  let cursor=0;
  for(const msg of extracted){
    const target=normalizeText(msg.text);
    let match=-1;
    for(let i=cursor;i<path.length;i++){
      const node=conv.nodes[path[i]];
      if(node.role===msg.role && node.normalizedText===target){match=i;break;}
    }
    // Rendered legacy HTML can contain tables, captions, or other visible text
    // whose plain-text form differs from the original Markdown. In that case
    // fall back to the next same-role node on the visible path.
    if(match<0){for(let i=cursor;i<path.length;i++){if(conv.nodes[path[i]]?.role===msg.role){match=i;break;}}}
    if(match>=0){
      const node=conv.nodes[path[match]];
      node.richHtml=msg.richHtml || null;
      node.sourceIndex=match;
      cursor=match+1;
    }
  }
}

function currentOrLongestPath(conv) {
  if(conv.currentNode && conv.nodes?.[conv.currentNode]){
    const out=[],seen=new Set();let id=conv.currentNode;
    while(id && conv.nodes[id] && !seen.has(id)){seen.add(id);out.push(id);id=conv.nodes[id].parent;}
    return out.reverse();
  }
  const nodes=conv.nodes||{}; const roots=Object.values(nodes).filter(n=>n.parent==null).map(n=>n.id);
  let best=[]; const stack=roots.map(id=>({id,path:[]}));
  while(stack.length){
    const {id,path}=stack.pop(); const n=nodes[id]; if(!n)continue; const next=path.concat(id); const kids=(n.children||[]).filter(x=>nodes[x]);
    if(!kids.length && next.length>best.length)best=next; else kids.forEach(k=>stack.push({id:k,path:next}));
  }
  return best;
}

function inferCurrentNode(nodes) {
  const leaves=Object.values(nodes).filter(n=>!(n.children||[]).length);
  return leaves.sort((a,b)=>(b.sourceIndex??0)-(a.sourceIndex??0))[0]?.id || Object.keys(nodes).pop() || null;
}
