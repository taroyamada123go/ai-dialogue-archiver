import { basename, canonicalize, extractMessageText, fmtTime, normalizeText, roleOf, sha256, stableId } from './core.js';

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
  const nodes = {};
  let previous = null;
  extracted.forEach((m, i) => {
    const id = `html-${i+1}`;
    nodes[id] = {
      id, parent:previous, children:[], role:m.role, text:m.text,
      normalizedText:normalizeText(m.text), raw:m.raw ?? null, createTime:null,
      sourceIndex:i,
    };
    if (previous) nodes[previous].children.push(id);
    previous = id;
  });
  await addHashes(nodes);
  const title = (doc.querySelector('title')?.textContent || file.name).trim();
  const conversation = {
    id:null, title, createTime:null, updateTime:null, currentNode:previous,
    sourceFormat:'html-capture', sourceName:file.name,
    nodes, rootIds: extracted.length ? ['html-1'] : [],
    rawObject:null, htmlRaw:html,
  };
  return {
    id: stableId('source'), kind:'html-capture', name:file.name, importedAt:new Date().toISOString(),
    rawFileHash:await sha256(html), rawSize:new Blob([html]).size,
    entryNames:[file.name], conversations:[conversation], htmlRaw:html, sourceFile:file,
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

async function addHashes(nodes) {
  const list = Object.values(nodes);
  await Promise.all(list.map(async n => {
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
  const items = [];
  const direct = [...doc.querySelectorAll('[data-message-author-role]')];
  for (const el of direct) {
    const role = el.getAttribute('data-message-author-role') || 'unknown';
    const text = cleanElementText(el);
    if (text) items.push({role, text});
  }
  if (items.length) return dedupeConsecutive(items);

  for (const article of doc.querySelectorAll('article')) {
    const roleEl = article.querySelector('[data-message-author-role]');
    if (!roleEl) continue;
    const role = roleEl.getAttribute('data-message-author-role') || 'unknown';
    const text = cleanElementText(article);
    if (text) items.push({role,text});
  }
  return dedupeConsecutive(items);
}

function cleanElementText(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('button,svg,style,script,noscript').forEach(x=>x.remove());
  return (clone.innerText || clone.textContent || '').replace(/\u00a0/g,' ').trim();
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
