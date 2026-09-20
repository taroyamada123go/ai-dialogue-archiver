import { escapeHtml } from './core.js';
import { enumeratePaths } from './compare.js';

export function buildV15Html(conv, options={}) {
  const paths=enumeratePaths(conv,500);
  const chosen=chooseCurrentPath(conv,paths);
  const messages=chosen.map(id=>conv.nodes[id]).filter(n=>n && ['user','assistant'].includes(n.role));
  const raw=rawOriginalFor(conv);
  const transcript=messages.map((m,i)=>`<article class="msg ${m.role}" id="m-${i}" data-archive-role="${m.role}" data-message-id="${escapeHtml(m.messageId||m.id||'')}"><div class="role">${m.role==='user'?'User':'ChatGPT'}</div><div class="body" data-archive-body>${renderBody(m)}</div></article>`).join('');
  const visual=options.visualHtml ? `<iframe sandbox="" srcdoc="${escapeHtml(options.visualHtml)}"></iframe>` : `<div class="empty">Visual Replicaはこの会話に関連付けられたHTMLキャプチャがある場合に表示できます。</div>`;
  const data={id:conv.id,title:conv.title,pathCount:paths.length,nodeCount:Object.keys(conv.nodes||{}).length};
  const snapshot=archiveSnapshot(conv);
  return `<!doctype html><html lang="ja" data-ai-archive="v15" data-archive-version="0.2.0"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(conv.title)} — Archive</title><style>${v15Css()}</style></head><body>
<header><div><h1>${escapeHtml(conv.title)}</h1><div class="status">Archive · ${escapeHtml(options.status||'UNVERIFIED')} · ${new Date().toISOString()}</div></div><div class="controls"><button data-tab="visual">Visual Replica</button><button data-tab="semantic" class="active">Transcript</button><button data-tab="raw">Raw Original</button><input id="q" placeholder="検索"></div></header>
<main><section id="visual" class="tab">${visual}</section><section id="semantic" class="tab active"><div class="meta">Nodes ${data.nodeCount} · Paths ${data.pathCount}</div>${transcript}</section><section id="raw" class="tab"><pre>${escapeHtml(raw)}</pre></section></main>
<script type="application/json" id="archive-conversation">${safeScriptJson(snapshot)}</script>
<script>${v15Js()}</script></body></html>`;
}

function archiveSnapshot(conv){
  const nodes={};
  for(const [id,n] of Object.entries(conv.nodes||{})){
    nodes[id]={
      id:n.id,parent:n.parent,children:[...(n.children||[])],role:n.role,text:n.text,
      createTime:n.createTime??null,updateTime:n.updateTime??null,messageId:n.messageId??null,
      contentType:n.contentType??null,status:n.status??null,sourceIndex:n.sourceIndex??null,
    };
  }
  return {format:'AI Dialogue Conversation Snapshot',version:'0.2.0',conversation:{
    id:conv.id??null,title:conv.title??'(無題)',createTime:conv.createTime??null,updateTime:conv.updateTime??null,
    currentNode:conv.currentNode??null,rootIds:[...(conv.rootIds||[])],nodes
  }};
}

function rawOriginalFor(conv){
  if(conv.rawObject) return JSON.stringify(conv.rawObject,null,2);
  if(typeof conv.rawOriginalText==='string' && conv.rawOriginalText.trim()) return conv.rawOriginalText;
  return '{}';
}
function chooseCurrentPath(conv,paths){if(!paths.length)return[];if(conv.currentNode){const p=paths.find(p=>p.includes(conv.currentNode)&&p[p.length-1]===conv.currentNode);if(p)return p;const q=paths.find(p=>p.includes(conv.currentNode));if(q)return q.slice(0,q.indexOf(conv.currentNode)+1);}return paths.sort((a,b)=>b.length-a.length)[0];}
function renderBody(m){return m.richHtml ? m.richHtml : renderText(m.text);}
function renderText(t){return escapeHtml(t).replace(/\n/g,'<br>');}
function safeScriptJson(value){return JSON.stringify(value).replace(/<\/script/gi,'<\\/script');}
function v15Css(){return `:root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#0a0b0d;color:#e9eaed}header{position:sticky;top:0;z-index:5;background:rgba(8,9,11,.92);backdrop-filter:blur(18px);border-bottom:1px solid #2b2e34;padding:12px 18px;display:flex;gap:16px;align-items:center;justify-content:space-between}h1{font-size:17px;margin:0 0 4px}.status,.meta{font-size:11px;color:#9297a1}.controls{display:flex;gap:7px;align-items:center;flex-wrap:wrap}button,input{border:1px solid #343842;background:#17191e;color:#eee;border-radius:8px;padding:8px 10px}button.active{background:#313640}input{width:150px}main{max-width:980px;margin:auto;padding:18px}.tab{display:none}.tab.active{display:block}.msg{padding:18px;border:1px solid #2c3038;margin:12px 0}.msg.user{background:#111318}.msg.assistant{background:#1a1d22}.role{font-size:11px;color:#969ca7;margin-bottom:10px;text-transform:uppercase}.body{white-space:normal;line-height:1.65;word-break:break-word}.body img{max-width:100%;height:auto}.body table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.body th,.body td{border:1px solid #343842;padding:7px 9px}.body pre,pre{white-space:pre-wrap;word-break:break-word;background:#111318;border:1px solid #2c3038;padding:16px}.body code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.body blockquote{margin:1em 0;padding-left:1em;border-left:2px solid #454b56;color:#c9cdd5}.body svg{max-width:100%;height:auto}.empty{padding:40px;border:1px dashed #3b404a;color:#a9aeb8}iframe{width:100%;height:78vh;border:1px solid #2c3038;background:white}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.controls{width:100%}input{flex:1;min-width:110px}main{padding:10px}.msg{padding:14px}}`;}
function v15Js(){return `document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.tab).classList.add('active')});document.getElementById('q').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('.msg').forEach(m=>m.style.display=!q||m.innerText.toLowerCase().includes(q)?'block':'none')});`;}
