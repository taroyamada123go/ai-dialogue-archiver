import { APP_VERSION, canonicalize, downloadBlob, escapeHtml, sha256, stableId } from './src/core.js';
import { importFiles } from './src/importers.js';
import { inspectSource } from './src/integrity.js';
import { compareConversations } from './src/compare.js';
import { saveProject, saveProjectToOpfs } from './src/storage.js';
import { buildV15Html } from './src/v15.js';

const state={mode:'quick',sources:[],comparison:null,autoMatches:[],installPrompt:null};
const $=id=>document.getElementById(id);

setup();

function setup(){
  document.querySelectorAll('[data-mode]').forEach(btn=>btn.addEventListener('click',()=>setMode(btn.dataset.mode)));
  $('fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
  const dz=$('dropZone');
  ['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
  $('inspectSelect').addEventListener('change',renderIntegrity);
  $('compareBtn').addEventListener('click',runCompare);
  $('saveLocalBtn').addEventListener('click',saveLocal);
  $('exportArchiveBtn').addEventListener('click',exportArchive);
  $('exportV15Btn').addEventListener('click',exportV15);
  $('exportReportBtn').addEventListener('click',exportReport);
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('installBtn').hidden=false;});
  $('installBtn').addEventListener('click',async()=>{if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('installBtn').hidden=true;}});
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  const secure=Boolean(globalThis.crypto?.subtle); const opfs=Boolean(navigator.storage?.getDirectory);
  $('runtimeBadge').textContent=secure?(opfs?'LOCAL · OPFS':'LOCAL'):'HTTPS REQUIRED';
  $('runtimeBadge').className=`badge ${secure?'ok':'bad'}`;
  updateSelectors();
}

function setMode(mode){state.mode=mode;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));$('modeDescription').textContent=mode==='quick'?'Quick Capture':'Verified Archive';if(mode==='verified'&&state.sources.length)autoCrossVerify().catch(e=>toast(`自動照合エラー: ${e.message}`));}

async function handleFiles(files){
  if(!files.length)return;
  showProgress(true,'読み込みを開始…',3);
  try{
    const imported=await importFiles(files,p=>{const pct=p.total?Math.round((p.current/p.total)*70):20;showProgress(true,`${p.name||''} · ${p.stage==='parse'?'解析':'読込'} ${p.current||''}/${p.total||''}`,pct)});
    for(const source of imported){
      showProgress(true,`${source.name} · 内部完全性を検査`,78);
      source.integrity=await inspectSource(source,p=>showProgress(true,`${source.name} · ${p.current}/${p.total} ${p.title||''}`,78+Math.round((p.current/p.total)*20)));
      state.sources.push(source);
    }
    renderSources();updateSelectors();renderIntegrity();
    if(state.mode==='verified') await autoCrossVerify();
    showProgress(true,'完了',100);setTimeout(()=>showProgress(false),500);
    toast(`${imported.length} 件の資料を読み込みました。`);
  }catch(err){showProgress(false);toast(`エラー: ${err.message}`);console.error(err);}
  finally{$('fileInput').value='';}
}

function showProgress(show,text='',pct=0){const p=$('progress');p.hidden=!show;if(show){$('progressText').textContent=text;$('progressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;}}

async function autoCrossVerify(){
  const opts=conversationOptions();
  const captures=opts.filter(o=>o.source.kind==='html-capture');
  const originals=opts.filter(o=>o.source.kind!=='html-capture');
  if(!captures.length||!originals.length)return;
  state.autoMatches=[];
  for(let ci=0;ci<captures.length;ci++){
    const cap=captures[ci];
    const ranked=originals.map(o=>({o,score:bodyOverlapScore(cap.conv,o.conv)})).sort((a,b)=>b.score-a.score).slice(0,4).filter(x=>x.score>0);
    let best=null;
    for(let i=0;i<ranked.length;i++){
      showProgress(true,`自動照合 ${ci+1}/${captures.length} · 候補 ${i+1}/${ranked.length}`,94);
      const result=await compareConversations(ranked[i].o.conv,cap.conv);
      const quality=(result.graphVerified?1_000_000:result.graphEquivalent?500_000:0)+(result.verified?100_000:0)+result.sequenceAgreement*10_000+result.evidence.normalizedBodyMatches;
      if(!best||quality>best.quality)best={a:ranked[i].o,b:cap,result,quality};
    }
    if(best){state.autoMatches.push(best);}
  }
  if(state.autoMatches.length){
    const best=state.autoMatches.slice().sort((a,b)=>b.quality-a.quality)[0];
    state.comparison={aKey:best.a.key,bKey:best.b.key,result:best.result,auto:true};
    $('compareA').value=best.a.key;$('compareB').value=best.b.key;$('inspectSelect').value=best.a.key;
    renderIntegrity();renderComparison();updateArchiveStatus();
    renderSources();
    toast(`本文から ${state.autoMatches.length} 件のキャプチャ候補を自動照合しました。`);
  }
}
function bodyOverlapScore(a,b){
  const counts=new Map();
  for(const n of Object.values(b.nodes||{})){if(!['user','assistant'].includes(n.role)||!n.normalizedTextHash)continue;counts.set(n.normalizedTextHash,(counts.get(n.normalizedTextHash)||0)+1);}
  let score=0,total=0;
  for(const n of Object.values(a.nodes||{})){if(!['user','assistant'].includes(n.role)||!n.normalizedTextHash)continue;total++;const c=counts.get(n.normalizedTextHash)||0;if(c){score++;counts.set(n.normalizedTextHash,c-1);}}
  return total?score/total:0;
}

function renderSources(){
  const box=$('sourceList');
  if(!state.sources.length){box.className='source-list empty-state';box.textContent='まだ資料は読み込まれていません。';return;}
  box.className='source-list';
  box.innerHTML=state.sources.map((s,i)=>{
    const err=(s.integrity||[]).reduce((n,r)=>n+r.errors,0), warn=(s.integrity||[]).reduce((n,r)=>n+r.warnings,0);
    const badge=err?'<span class="badge bad">FAIL</span>':warn?'<span class="badge warn">PASS + WARN</span>':'<span class="badge ok">PASS</span>';
    return `<div class="source-row"><div><strong>${escapeHtml(s.name)}</strong><small>${kindLabel(s.kind)} · ${(s.rawSize/1024/1024).toFixed(2)} MB · SHA-256 ${s.rawFileHash.slice(0,14)}…</small><div class="source-meta"><span class="chip">${s.conversations.length} conversations</span><span class="chip">${s.entryNames?.length||1} files indexed</span>${state.autoMatches.some(m=>m.a.source===s||m.b.source===s)?'<span class="chip">auto matched</span>':''}</div></div>${badge}</div>`;
  }).join('');
}
function kindLabel(k){return k==='openai-export-zip'?'OpenAI Export ZIP':k==='openai-json'?'OpenAI JSON':'HTML Capture';}

function conversationOptions(){
  const out=[];state.sources.forEach((s,si)=>s.conversations.forEach((c,ci)=>out.push({key:`${si}:${ci}`,label:`${s.name} / ${c.title}`,source:s,conv:c,report:s.integrity?.[ci]})));return out;
}
function updateSelectors(){
  const opts=conversationOptions();const html=opts.length?opts.map(o=>`<option value="${o.key}">${escapeHtml(o.label)}</option>`).join(''):'<option value="">—</option>';
  for(const id of ['inspectSelect','compareA','compareB']){$(id).innerHTML=html;}
  if(opts.length>1)$('compareB').selectedIndex=1;
}
function getSelection(id){const v=$(id).value;if(!v)return null;const[si,ci]=v.split(':').map(Number);const source=state.sources[si],conv=source?.conversations?.[ci];return conv?{source,conv,report:source.integrity?.[ci],si,ci}:null;}

function renderIntegrity(){
  const sel=getSelection('inspectSelect'), sum=$('integritySummary'), issues=$('issueList');
  if(!sel){sum.className='integrity-summary empty-state';sum.textContent='会話を読み込むと検査結果が表示されます。';issues.className='issue-list empty-state';issues.textContent='エラー・警告の詳細';return;}
  const r=sel.report;const cls=r.errors?'bad':r.warnings?'warn':'ok';
  sum.className='integrity-summary';sum.innerHTML=`<div class="score-card"><div class="result ${cls}">${escapeHtml(r.label)}</div><div class="stats"><div class="stat"><b>${r.stats.nodes}</b><span>Nodes</span></div><div class="stat"><b>${r.stats.user}</b><span>User</span></div><div class="stat"><b>${r.stats.assistant}</b><span>Assistant</span></div><div class="stat"><b>${r.stats.branchPoints}</b><span>Branches</span></div><div class="stat"><b>${r.stats.leaves}</b><span>Leaves</span></div><div class="stat"><b>${r.stats.missingAssetRefs}</b><span>Missing refs</span></div></div><div class="hash">GRAPH SHA-256 · ${r.graphHash}</div></div>`;
  if(!r.issues.length){issues.className='issue-list';issues.innerHTML='<div class="issue"><b class="ok">OK</b> 検出可能な内部矛盾はありません。</div>';}
  else{issues.className='issue-list';issues.innerHTML=r.issues.map(x=>`<div class="issue ${x.severity}"><b>${x.code}</b>${escapeHtml(x.message)}${x.nodeId?`<div class="muted">node: ${escapeHtml(x.nodeId)}</div>`:''}</div>`).join('');}
  updateArchiveStatus();
}

async function runCompare(){
  const A=getSelection('compareA'),B=getSelection('compareB');if(!A||!B){toast('比較する2つの会話を選択してください。');return;}
  $('compareResult').className='empty-state';$('compareResult').textContent='照合中…';
  await new Promise(r=>requestAnimationFrame(()=>r()));
  try{state.comparison={aKey:$('compareA').value,bKey:$('compareB').value,result:await compareConversations(A.conv,B.conv)};renderComparison();updateArchiveStatus();}
  catch(e){$('compareResult').textContent=`照合エラー: ${e.message}`;console.error(e);}
}

function renderComparison(){
  const c=state.comparison?.result;if(!c)return;const pct=Math.round(c.sequenceAgreement*1000)/10;
  const statusClass=c.graphVerified?'ok':c.graphEquivalent||c.sequenceAgreement>=.95?'warn':'bad';
  const diffs=c.bestPath.edits.slice(0,100).map(renderDiff).join('')||'<div class="diff-item"><div class="kind">NO PATH DIFFERENCE</div>選択された最良経路では本文差分がありません。</div>';
  const aBranches=c.branchSummary.aUnmatchedBranches.slice(0,50),bBranches=c.branchSummary.bUnmatchedBranches.slice(0,50);
  $('compareResult').className='compare-result';$('compareResult').innerHTML=`<div class="compare-head"><strong class="result ${statusClass}">${escapeHtml(c.label)}</strong><span class="badge ${statusClass}">${c.graphVerified?'GRAPH':c.graphEquivalent?'GRAPH?':c.verified?'PATH':'DIFF'}</span></div><div class="metrics"><div class="metric"><b>${pct}%</b><span>Sequence agreement</span></div><div class="metric"><b>${c.evidence.exactBodyMatches}</b><span>Raw body matches</span></div><div class="metric"><b>${c.evidence.normalizedBodyMatches}</b><span>Normalized matches</span></div><div class="metric"><b>${c.bestPath.edits.length}</b><span>Path differences</span></div></div><div class="diff-list">${diffs}</div><div class="branch-box"><details><summary>最良経路外の枝 · A ${aBranches.length} / B ${bBranches.length}</summary>${branchRows('A',aBranches)}${branchRows('B',bBranches)}</details></div>`;
}
function renderDiff(d){if(d.type==='modified'){const html=d.diff.map(x=>`<span class="${x.t==='add'?'add':x.t==='del'?'del':''}">${escapeHtml(x.v)}</span>`).join('');return `<div class="diff-item"><div class="kind">MODIFIED · ${escapeHtml(d.a.role)}</div>${html}</div>`;}const x=d.a||d.b;return `<div class="diff-item"><div class="kind">${d.type.toUpperCase()} · ${escapeHtml(x.role)}</div>${escapeHtml(x.text).replace(/\n/g,'<br>')}</div>`;}
function branchRows(label,arr){return arr.map(x=>`<div class="branch-item"><b>${label} · ${escapeHtml(x.role)}</b> · ${escapeHtml((x.text||'').slice(0,180))}${(x.text||'').length>180?'…':''}</div>`).join('');}

function updateArchiveStatus(){
  const sel=getSelection('inspectSelect');const b=$('archiveStatus');if(!sel){b.textContent='NO ARCHIVE';b.className='badge neutral';return;}
  if(sel.report?.errors){b.textContent='INTERNAL FAIL';b.className='badge bad';return;}
  const key=$('inspectSelect').value;
  const cmp=(state.comparison && (state.comparison.aKey===key || state.comparison.bKey===key)) ? state.comparison.result : null;
  if(cmp?.graphVerified){b.textContent='GRAPH VERIFIED';b.className='badge ok';}
  else if(cmp?.graphEquivalent){b.textContent='GRAPH MATCH · AMBIGUOUS';b.className='badge warn';}
  else if(cmp?.verified){b.textContent='PATH VERIFIED';b.className='badge ok';}
  else{b.textContent='INTERNAL PASS · UNVERIFIED';b.className='badge warn';}
}

async function saveLocal(){
  if(!state.sources.length){toast('先に資料を読み込んでください。');return;}
  const project=serializeProject(false);project.id=project.id||stableId('project');
  try{
    const opfs=await saveProjectToOpfs(project,state.sources);
    project.localStorage={opfs:opfs.available,persisted:opfs.persisted??false,files:opfs.files||[]};
    await saveProject(project);
    toast(opfs.available?'原本・検査結果をブラウザ内へ保存しました。':'検査結果をIndexedDBへ保存しました（原本OPFSは利用不可）。');
  }catch(e){toast(`ローカル保存に失敗: ${e.message}`);}
}

function serializeProject(includeRaw=false){
  return {id:stableId('project'),version:APP_VERSION,createdAt:new Date().toISOString(),mode:state.mode,sources:state.sources.map(s=>({id:s.id,kind:s.kind,name:s.name,importedAt:s.importedAt,rawFileHash:s.rawFileHash,rawSize:s.rawSize,entryNames:s.entryNames,integrity:s.integrity,conversations:s.conversations.map(c=>serializeConv(c,includeRaw))})),comparison:state.comparison};
}
function serializeConv(c,includeRaw){const nodes=Object.fromEntries(Object.entries(c.nodes||{}).map(([id,n])=>[id,includeRaw?n:{...n,raw:undefined}]));return {id:c.id,title:c.title,createTime:c.createTime,updateTime:c.updateTime,currentNode:c.currentNode,sourceFormat:c.sourceFormat,sourceName:c.sourceName,rootIds:c.rootIds,nodes,...(includeRaw?{rawObject:c.rawObject,htmlRaw:c.htmlRaw}: {})};}

async function exportArchive(){
  if(!state.sources.length){toast('先に資料を読み込んでください。');return;}
  if(!globalThis.JSZip){toast('ZIPライブラリがありません。');return;}
  showProgress(true,'Archive Bundleを構築中…',15);
  try{
    const zip=new JSZip();const project=serializeProject(false);
    const manifest={format:'AI Dialogue Archive Bundle',version:APP_VERSION,createdAt:new Date().toISOString(),mode:state.mode,sources:project.sources.map(s=>({name:s.name,kind:s.kind,sha256:s.rawFileHash,size:s.rawSize,conversations:s.conversations.length,integrity:s.integrity.map(r=>({label:r.label,errors:r.errors,warnings:r.warnings,graphHash:r.graphHash}))})),comparison:state.comparison?.result?{label:state.comparison.result.label,graphEquivalent:state.comparison.result.graphEquivalent,graphVerified:state.comparison.result.graphVerified,graphAmbiguous:state.comparison.result.graphAmbiguous,verifiedPath:state.comparison.result.verified}:null};
    zip.file('manifest.json',JSON.stringify(manifest,null,2));
    zip.file('normalized/project.json',JSON.stringify(project,null,2));
    for(let i=0;i<state.sources.length;i++){
      const s=state.sources[i];showProgress(true,`${s.name} を原本として格納`,25+Math.round(i/state.sources.length*35));
      if(s.sourceFile)zip.file(`originals/${sanitize(s.name)}`,s.sourceFile,{compression:'STORE'});
      s.conversations.forEach((c,ci)=>zip.file(`conversations/source-${i+1}/conversation-${String(ci+1).padStart(4,'0')}.json`,JSON.stringify(serializeConv(c,true),null,2)));
      zip.file(`reports/source-${i+1}-integrity.json`,JSON.stringify(s.integrity,null,2));
    }
    if(state.comparison)zip.file('reports/cross-source-comparison.json',JSON.stringify(state.comparison,null,2));
    showProgress(true,'ZIP生成中…',72);
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},m=>showProgress(true,`ZIP生成 ${Math.round(m.percent)}%`,72+Math.round(m.percent*.27)));
    downloadBlob(blob,`ai-dialogue-archive-${dateStamp()}.zip`);showProgress(false);toast('Archive Bundleを生成しました。');
  }catch(e){showProgress(false);toast(`Archive生成失敗: ${e.message}`);console.error(e);}
}

function exportV15(){
  const sel=getSelection('inspectSelect');if(!sel){toast('出力する会話を選択してください。');return;}
  let visualHtml=null;
  if(sel.source.kind==='html-capture')visualHtml=sel.source.htmlRaw;
  else if(state.comparison){
    const a=getSelection('compareA'),b=getSelection('compareB');
    if(a?.conv===sel.conv && b?.source.kind==='html-capture')visualHtml=b.source.htmlRaw;
    if(b?.conv===sel.conv && a?.source.kind==='html-capture')visualHtml=a.source.htmlRaw;
  }
  const key=$('inspectSelect').value; const cmp=(state.comparison && (state.comparison.aKey===key || state.comparison.bKey===key)) ? state.comparison.result : null;
  const status=sel.report.errors?'INTERNAL FAIL':cmp?.graphVerified?'GRAPH VERIFIED':cmp?.graphEquivalent?'GRAPH MATCH / AMBIGUOUS DUPLICATES':cmp?.verified?'PATH VERIFIED':'INTERNAL PASS / EXTERNAL UNVERIFIED';
  const html=buildV15Html(sel.conv,{visualHtml,status});downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),`${sanitize(sel.conv.title||'conversation')}-v15.html`);toast('v15 HTMLを生成しました。');
}

function exportReport(){
  if(!state.sources.length){toast('先に資料を読み込んでください。');return;}
  const report={version:APP_VERSION,createdAt:new Date().toISOString(),sources:state.sources.map(s=>({name:s.name,kind:s.kind,sha256:s.rawFileHash,integrity:s.integrity})),comparison:state.comparison};
  downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`verification-report-${dateStamp()}.json`);toast('検証レポートを出力しました。');
}
function sanitize(s){return String(s||'archive').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,100);}
function dateStamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3500);}
