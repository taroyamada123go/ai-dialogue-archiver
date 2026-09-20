import { APP_VERSION, downloadBlob, escapeHtml, stableId } from './src/core.js';
import { importFiles } from './src/importers.js';
import { inspectSource } from './src/integrity.js';
import { compareConversations } from './src/compare.js';
import {
  saveArchive, getArchive, listArchives, deleteArchive, listProjects,
  saveArchiveOriginalToOpfs, requestPersistentStorage
} from './src/storage.js';
import { buildV15Html } from './src/v15.js';
import { protectFragmentForDisplay, externalUrlFromGate } from './src/network-policy.js';

const state={
  mode:'quick',sources:[],comparison:null,autoMatches:[],installPrompt:null,
  library:[],viewerArchive:null,viewerCurrentNode:null,viewerSearchTimer:null,
};
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

  $('librarySearch').addEventListener('input',renderLibrary);
  $('refreshLibraryBtn').addEventListener('click',loadLibrary);
  $('libraryList').addEventListener('click',e=>{
    const card=e.target.closest('[data-open-archive]');
    if(card) openArchive(card.dataset.openArchive);
  });

  $('viewerCloseBtn').addEventListener('click',closeViewer);
  $('viewerMoreBtn').addEventListener('click',()=>{$('viewerActions').hidden=!$('viewerActions').hidden;});
  $('viewerLoadBtn').addEventListener('click',loadViewerIntoWorkspace);
  $('viewerExportBtn').addEventListener('click',exportViewerV15);
  $('viewerDeleteBtn').addEventListener('click',deleteViewerArchive);
  $('viewerTopBtn').addEventListener('click',()=>{$('libraryViewer').scrollTo({top:0,behavior:'smooth'});});
  $('viewerSearch').addEventListener('input',()=>{
    clearTimeout(state.viewerSearchTimer);
    state.viewerSearchTimer=setTimeout(renderViewerTranscript,100);
  });
  $('viewerTranscript').addEventListener('click',e=>{
    const external=e.target.closest('[data-external-url]');
    if(external){
      const url=externalUrlFromGate(external);
      if(url) window.open(url,'_blank','noopener,noreferrer');
      return;
    }
    const b=e.target.closest('[data-branch-child]');
    if(!b||!state.viewerArchive)return;
    state.viewerCurrentNode=bestLeafFrom(state.viewerArchive.conversation,b.dataset.branchChild);
    renderViewerTranscript();
    requestAnimationFrame(()=>document.querySelector(`[data-node-id="${cssEscape(b.dataset.branchChild)}"]`)?.scrollIntoView({block:'center'}));
  });

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.installPrompt=e;$('installBtn').hidden=false;});
  $('installBtn').addEventListener('click',async()=>{if(state.installPrompt){state.installPrompt.prompt();await state.installPrompt.userChoice;state.installPrompt=null;$('installBtn').hidden=true;}});
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  const secure=Boolean(globalThis.crypto?.subtle); const opfs=Boolean(navigator.storage?.getDirectory);
  $('runtimeBadge').textContent=secure?(opfs?'LOCAL · OPFS':'LOCAL'):'HTTPS REQUIRED';
  $('runtimeBadge').className=`badge ${secure?'ok':'bad'}`;
  updateSelectors();
  loadLibrary();
}

function setMode(mode){
  state.mode=mode;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  $('modeDescription').textContent=mode==='quick'?'Quick Capture':'Verified Archive';
  if(mode==='verified'&&state.sources.length)autoCrossVerify().catch(e=>toast(`自動照合エラー: ${e.message}`));
}

async function handleFiles(files){
  if(!files.length)return;
  showProgress(true,'読み込みを開始…',3);
  try{
    const imported=await importFiles(files,p=>{
      const pct=p.total?Math.round((p.current/p.total)*70):20;
      showProgress(true,`${p.name||''} · ${p.stage==='parse'?'解析':'読込'} ${p.current||''}/${p.total||''}`,pct);
    });
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

function showProgress(show,text='',pct=0){
  const p=$('progress');p.hidden=!show;
  if(show){$('progressText').textContent=text;$('progressBar').style.width=`${Math.max(0,Math.min(100,pct))}%`;}
}

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
    if(best)state.autoMatches.push(best);
  }
  if(state.autoMatches.length){
    const best=state.autoMatches.slice().sort((a,b)=>b.quality-a.quality)[0];
    state.comparison={aKey:best.a.key,bKey:best.b.key,result:best.result,auto:true};
    $('compareA').value=best.a.key;$('compareB').value=best.b.key;$('inspectSelect').value=best.a.key;
    renderIntegrity();renderComparison();updateArchiveStatus();renderSources();
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
  box.innerHTML=state.sources.map(s=>{
    const err=(s.integrity||[]).reduce((n,r)=>n+r.errors,0), warn=(s.integrity||[]).reduce((n,r)=>n+r.warnings,0);
    const badge=err?'<span class="badge bad">FAIL</span>':warn?'<span class="badge warn">PASS + WARN</span>':'<span class="badge ok">PASS</span>';
    const size=Number.isFinite(s.rawSize)?`${(s.rawSize/1024/1024).toFixed(2)} MB`:'library';
    const hash=s.rawFileHash?` · SHA-256 ${s.rawFileHash.slice(0,14)}…`:'';
    return `<div class="source-row"><div><strong>${escapeHtml(s.name)}</strong><small>${kindLabel(s.kind)} · ${size}${hash}</small><div class="source-meta"><span class="chip">${s.conversations.length} conversations</span><span class="chip">${s.entryNames?.length||1} source</span>${state.autoMatches.some(m=>m.a.source===s||m.b.source===s)?'<span class="chip">auto matched</span>':''}</div></div>${badge}</div>`;
  }).join('');
}
function kindLabel(k){return k==='openai-export-zip'?'OpenAI Export ZIP':k==='openai-json'?'OpenAI JSON':k==='library-archive'?'Saved Library':'HTML Capture';}

function conversationOptions(){
  const out=[];state.sources.forEach((s,si)=>s.conversations.forEach((c,ci)=>out.push({key:`${si}:${ci}`,label:`${s.name} / ${c.title}`,source:s,conv:c,report:s.integrity?.[ci]})));return out;
}
function updateSelectors(){
  const opts=conversationOptions();const html=opts.length?opts.map(o=>`<option value="${o.key}">${escapeHtml(o.label)}</option>`).join(''):'<option value="">—</option>';
  for(const id of ['inspectSelect','compareA','compareB'])$(id).innerHTML=html;
  if(opts.length>1)$('compareB').selectedIndex=1;
}
function getSelection(id){const v=$(id).value;if(!v)return null;const[si,ci]=v.split(':').map(Number);const source=state.sources[si],conv=source?.conversations?.[ci];return conv?{source,conv,report:source.integrity?.[ci],si,ci}:null;}

function renderIntegrity(){
  const sel=getSelection('inspectSelect'), sum=$('integritySummary'), issues=$('issueList');
  if(!sel){sum.className='integrity-summary empty-state';sum.textContent='会話を読み込むと検査結果が表示されます。';issues.className='issue-list empty-state';issues.textContent='エラー・警告の詳細';return;}
  const r=sel.report;
  if(!r){sum.className='integrity-summary empty-state';sum.textContent='この保存済み会話には検査レポートがありません。';issues.className='issue-list empty-state';issues.textContent='検査レポートなし';updateArchiveStatus();return;}
  const cls=r.errors?'bad':r.warnings?'warn':'ok';
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

function statusForSelection(sel,key=$('inspectSelect').value){
  if(!sel)return 'NO ARCHIVE';
  if(sel.report?.errors)return 'INTERNAL FAIL';
  const cmp=(state.comparison && (state.comparison.aKey===key || state.comparison.bKey===key)) ? state.comparison.result : null;
  if(cmp?.graphVerified)return 'GRAPH VERIFIED';
  if(cmp?.graphEquivalent)return 'GRAPH MATCH · AMBIGUOUS';
  if(cmp?.verified)return 'PATH VERIFIED';
  return sel.report?'INTERNAL PASS · UNVERIFIED':'UNVERIFIED';
}
function updateArchiveStatus(){
  const sel=getSelection('inspectSelect');const b=$('archiveStatus');const status=statusForSelection(sel);
  b.textContent=status;b.className=`badge ${status.includes('FAIL')?'bad':status.includes('VERIFIED')&&!status.includes('UNVERIFIED')?'ok':status==='NO ARCHIVE'?'neutral':'warn'}`;
}

async function saveLocal(){
  const sel=getSelection('inspectSelect');
  if(!sel){toast('先に保存する会話を選択してください。');return;}
  try{
    await requestPersistentStorage();
    const now=new Date().toISOString();
    const graphHash=sel.report?.graphHash||stableId('graph');
    const id=`archive-${graphHash}`;
    const old=await getArchive(id);
    const conversation=serializeConv(sel.conv,false);
    const archive={
      id,version:APP_VERSION,title:sel.conv.title||'(無題)',savedAt:old?.savedAt||now,updatedAt:now,
      status:statusForSelection(sel),graphHash:sel.report?.graphHash||null,
      source:{name:sel.source.name,kind:sel.source.kind,rawFileHash:sel.source.rawFileHash||null,rawSize:sel.source.rawSize||null},
      stats:sel.report?.stats||deriveStats(sel.conv),report:sel.report||null,conversation,
      originalOpfsPath:old?.originalOpfsPath||null,
    };
    const opfs=await saveArchiveOriginalToOpfs(id,sel.source.sourceFile,sel.source.name).catch(()=>({available:false}));
    if(opfs.available)archive.originalOpfsPath=opfs.path;
    await saveArchive(archive);
    await loadLibrary();
    toast('選択中の会話をライブラリへ保存しました。');
  }catch(e){toast(`ライブラリ保存に失敗: ${e.message}`);console.error(e);}
}

function serializeProject(includeRaw=false){
  return {id:stableId('project'),version:APP_VERSION,createdAt:new Date().toISOString(),mode:state.mode,sources:state.sources.map(s=>({id:s.id,kind:s.kind,name:s.name,importedAt:s.importedAt,rawFileHash:s.rawFileHash,rawSize:s.rawSize,entryNames:s.entryNames,integrity:s.integrity,conversations:s.conversations.map(c=>serializeConv(c,includeRaw))})),comparison:state.comparison};
}
function serializeConv(c,includeRaw){
  const nodes=Object.fromEntries(Object.entries(c.nodes||{}).map(([id,n])=>[id,includeRaw?n:{...n,raw:undefined}]));
  return {id:c.id,title:c.title,createTime:c.createTime,updateTime:c.updateTime,currentNode:c.currentNode,sourceFormat:c.sourceFormat,sourceName:c.sourceName,rootIds:c.rootIds,nodes,htmlFlavor:c.htmlFlavor??null,rawOriginalText:c.rawOriginalText??null,...(includeRaw?{rawObject:c.rawObject,htmlRaw:c.htmlRaw,visualHtml:c.visualHtml??null}: {})};
}

async function exportArchive(){
  if(!state.sources.length){toast('先に資料を読み込んでください。');return;}
  if(!globalThis.JSZip){toast('ZIPライブラリがありません。');return;}
  showProgress(true,'Archive Bundleを構築中…',15);
  try{
    const zip=new JSZip();const project=serializeProject(false);
    const manifest={format:'AI Dialogue Archive Bundle',version:APP_VERSION,createdAt:new Date().toISOString(),mode:state.mode,sources:project.sources.map(s=>({name:s.name,kind:s.kind,sha256:s.rawFileHash,size:s.rawSize,conversations:s.conversations.length,integrity:(s.integrity||[]).map(r=>({label:r.label,errors:r.errors,warnings:r.warnings,graphHash:r.graphHash}))})),comparison:state.comparison?.result?{label:state.comparison.result.label,graphEquivalent:state.comparison.result.graphEquivalent,graphVerified:state.comparison.result.graphVerified,graphAmbiguous:state.comparison.result.graphAmbiguous,verifiedPath:state.comparison.result.verified}:null};
    zip.file('manifest.json',JSON.stringify(manifest,null,2));
    zip.file('normalized/project.json',JSON.stringify(project,null,2));
    for(let i=0;i<state.sources.length;i++){
      const s=state.sources[i];showProgress(true,`${s.name} を格納`,25+Math.round(i/state.sources.length*35));
      if(s.sourceFile)zip.file(`originals/${sanitize(s.name)}`,s.sourceFile,{compression:'STORE'});
      s.conversations.forEach((c,ci)=>zip.file(`conversations/source-${i+1}/conversation-${String(ci+1).padStart(4,'0')}.json`,JSON.stringify(serializeConv(c,true),null,2)));
      zip.file(`reports/source-${i+1}-integrity.json`,JSON.stringify(s.integrity||[],null,2));
    }
    if(state.comparison)zip.file('reports/cross-source-comparison.json',JSON.stringify(state.comparison,null,2));
    showProgress(true,'ZIP生成中…',72);
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}},m=>showProgress(true,`ZIP生成 ${Math.round(m.percent)}%`,72+Math.round(m.percent*.27)));
    downloadBlob(blob,`ai-dialogue-archive-${dateStamp()}.zip`);showProgress(false);toast('Archive Bundleを生成しました。');
  }catch(e){showProgress(false);toast(`Archive生成失敗: ${e.message}`);console.error(e);}
}

function exportV15(){
  const sel=getSelection('inspectSelect');if(!sel){toast('出力する会話を選択してください。');return;}
  let visualHtml=sel.conv.visualHtml||null;
  if(!visualHtml && sel.source.kind==='html-capture')visualHtml=sel.source.htmlRaw;
  else if(!visualHtml && state.comparison){
    const a=getSelection('compareA'),b=getSelection('compareB');
    if(a?.conv===sel.conv && b?.source.kind==='html-capture')visualHtml=b.conv.visualHtml||b.source.htmlRaw;
    if(b?.conv===sel.conv && a?.source.kind==='html-capture')visualHtml=a.conv.visualHtml||a.source.htmlRaw;
  }
  const status=statusForSelection(sel);
  const html=buildV15Html(sel.conv,{visualHtml,status});downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),`${sanitize(sel.conv.title||'conversation')}-v15.html`);toast('v15 HTMLを生成しました。');
}

function exportReport(){
  if(!state.sources.length){toast('先に資料を読み込んでください。');return;}
  const report={version:APP_VERSION,createdAt:new Date().toISOString(),sources:state.sources.map(s=>({name:s.name,kind:s.kind,sha256:s.rawFileHash,integrity:s.integrity})),comparison:state.comparison};
  downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`verification-report-${dateStamp()}.json`);toast('検証レポートを出力しました。');
}

async function loadLibrary(){
  try{
    await migrateLegacyProjects();
    state.library=await listArchives();
    renderLibrary();
  }catch(e){
    $('libraryList').className='library-list empty-state';
    $('libraryList').textContent=`ライブラリを開けません: ${e.message}`;
  }
}

async function migrateLegacyProjects(){
  const key='ai-dialogue-archiver-v03-migrated';
  try{if(localStorage.getItem(key))return;}catch{}
  try{
    const projects=await listProjects();
    for(const p of projects||[]){
      for(const s of p.sources||[]){
        for(let i=0;i<(s.conversations||[]).length;i++){
          const conv=s.conversations[i],report=s.integrity?.[i];
          const graphHash=report?.graphHash;if(!graphHash)continue;
          const id=`archive-${graphHash}`;
          if(await getArchive(id))continue;
          const now=p.createdAt||new Date().toISOString();
          await saveArchive({
            id,version:p.version||'0.2.0',title:conv.title||'(無題)',savedAt:now,updatedAt:now,
            status:report?.errors?'INTERNAL FAIL':report?'INTERNAL PASS · UNVERIFIED':'UNVERIFIED',graphHash,
            source:{name:s.name||'Legacy local record',kind:s.kind||'legacy-project',rawFileHash:s.rawFileHash||null,rawSize:s.rawSize||null},
            stats:report?.stats||deriveStats(conv),report:report||null,conversation:conv,originalOpfsPath:null,
          });
        }
      }
    }
  }catch(e){console.warn('Legacy migration skipped',e);}
  try{localStorage.setItem(key,'1');}catch{}
}

function renderLibrary(){
  const list=$('libraryList');
  const q=($('librarySearch').value||'').trim().toLowerCase();
  const items=state.library.filter(a=>!q||`${a.title||''} ${a.source?.name||''} ${a.status||''}`.toLowerCase().includes(q));
  $('libraryCount').textContent=String(state.library.length);
  if(!state.library.length){list.className='library-list empty-state';list.textContent='まだ保存済み会話はありません。資料を読み込み、会話を選んで「ライブラリへ保存」を押してください。';return;}
  if(!items.length){list.className='library-list empty-state';list.textContent='一致する保存済み会話はありません。';return;}
  list.className='library-list';
  list.innerHTML=items.map(a=>{
    const stats=a.stats||deriveStats(a.conversation||{});
    const cls=statusClass(a.status);
    return `<button class="library-card" data-open-archive="${escapeHtml(a.id)}"><div class="library-card-main"><strong>${escapeHtml(a.title||'(無題)')}</strong><small>${escapeHtml(a.source?.name||'Local Library')} · ${formatDate(a.updatedAt||a.savedAt)}</small><div class="source-meta"><span class="chip">${stats.user||0} user</span><span class="chip">${stats.assistant||0} assistant</span><span class="chip">${stats.branchPoints||0} branches</span></div></div><span class="badge ${cls}">${escapeHtml(shortStatus(a.status))}</span></button>`;
  }).join('');
}

async function openArchive(id){
  try{
    const archive=await getArchive(id);if(!archive){toast('保存済み会話が見つかりません。');await loadLibrary();return;}
    state.viewerArchive=archive;
    state.viewerCurrentNode=archive.conversation?.currentNode||bestLeafFrom(archive.conversation,null);
    $('viewerTitle').textContent=archive.title||'(無題)';
    $('viewerStatus').textContent=archive.status||'UNVERIFIED';
    $('viewerSearch').value='';$('viewerActions').hidden=true;
    $('libraryViewer').hidden=false;document.body.classList.add('viewer-open');
    $('libraryViewer').scrollTop=0;
    renderViewerMeta();renderViewerTranscript();
  }catch(e){toast(`会話を開けません: ${e.message}`);}
}

function closeViewer(){
  $('libraryViewer').hidden=true;document.body.classList.remove('viewer-open');
  state.viewerArchive=null;state.viewerCurrentNode=null;
}

function renderViewerMeta(){
  const a=state.viewerArchive;if(!a)return;
  const s=a.stats||deriveStats(a.conversation||{});
  $('viewerMeta').innerHTML=`<span>${s.user||0} User</span><span>${s.assistant||0} ChatGPT</span><span>${s.branchPoints||0} Branches</span><span>${formatDate(a.updatedAt||a.savedAt)}</span>${a.graphHash?`<span class="viewer-hash">${escapeHtml(a.graphHash.slice(0,16))}…</span>`:''}`;
}

function renderViewerTranscript(){
  const a=state.viewerArchive,box=$('viewerTranscript');if(!a)return;
  const conv=a.conversation||{},path=pathToNode(conv,state.viewerCurrentNode);
  const q=($('viewerSearch').value||'').trim().toLowerCase();
  let matched=0,rendered=0;
  const html=[];
  for(let i=0;i<path.length;i++){
    const id=path[i],n=conv.nodes?.[id];if(!n||!['user','assistant','system','tool'].includes(n.role))continue;
    if(!String(n.text||'').trim()&&!n.richHtml)continue;
    const isMatch=!q||String(n.text||'').toLowerCase().includes(q);
    if(q&&!isMatch)continue;
    matched++;rendered++;
    const role=n.role==='user'?'User':n.role==='assistant'?'ChatGPT':n.role;
    const rich=n.richHtml?sanitizeForDisplay(n.richHtml):escapeHtml(n.text||'').replace(/\n/g,'<br>');
    const children=(n.children||[]).filter(cid=>conv.nodes?.[cid]);
    const activeNext=path[i+1]||null;
    const branch=children.length>1?`<div class="viewer-branches"><span>分岐 ${children.length}</span>${children.map((cid,idx)=>{const child=conv.nodes[cid];const label=branchLabel(child,idx);return `<button class="branch-choice ${cid===activeNext?'active':''}" data-branch-child="${escapeHtml(cid)}">${escapeHtml(label)}</button>`;}).join('')}</div>`:'';
    html.push(`<article class="viewer-message ${escapeHtml(n.role)}" data-node-id="${escapeHtml(id)}"><div class="viewer-role">${escapeHtml(role)}</div><div class="viewer-body">${rich}</div>${branch}</article>`);
  }
  $('viewerMatchCount').textContent=q?`${matched}件`:`${rendered}件`;
  box.innerHTML=html.join('')||'<div class="empty-state">一致する本文がありません。</div>';
}

function pathToNode(conv,target){
  const nodes=conv?.nodes||{};let id=target&&nodes[target]?target:conv?.currentNode;
  if(!id||!nodes[id])id=bestLeafFrom(conv,null);
  const out=[],seen=new Set();
  while(id&&nodes[id]&&!seen.has(id)){seen.add(id);out.push(id);id=nodes[id].parent;}
  if(out.length)return out.reverse();
  const root=(conv?.rootIds||[]).find(x=>nodes[x])||Object.values(nodes).find(n=>n.parent==null)?.id;
  return root?[root]:[];
}

function bestLeafFrom(conv,startId){
  const nodes=conv?.nodes||{};
  const starts=startId&&nodes[startId]?[startId]:(conv?.rootIds||[]).filter(id=>nodes[id]);
  if(!starts.length){const first=Object.values(nodes).find(n=>n.parent==null);if(first)starts.push(first.id);}
  let best=null;
  const stack=starts.map(id=>({id,depth:0}));const seen=new Set();
  while(stack.length){
    const {id,depth}=stack.pop();if(!nodes[id]||seen.has(id))continue;seen.add(id);
    const kids=(nodes[id].children||[]).filter(k=>nodes[k]);
    if(!kids.length){const score=depth*1_000_000+(nodes[id].sourceIndex??0);if(!best||score>best.score)best={id,score};}
    else kids.forEach(k=>stack.push({id:k,depth:depth+1}));
  }
  return best?.id||startId||conv?.currentNode||Object.keys(nodes).pop()||null;
}

function branchLabel(n,idx){
  const t=String(n?.text||'').replace(/\s+/g,' ').trim();
  return t?`${idx+1}: ${t.slice(0,28)}${t.length>28?'…':''}`:`Branch ${idx+1}`;
}

async function loadViewerIntoWorkspace(){
  const a=state.viewerArchive;if(!a)return;
  const conv=deepClone(a.conversation);
  const source={id:stableId('source'),kind:'library-archive',name:`Library · ${a.title}`,importedAt:new Date().toISOString(),rawFileHash:a.source?.rawFileHash||null,rawSize:a.source?.rawSize||0,entryNames:['local-library'],conversations:[conv],integrity:[a.report||null],sourceFile:null};
  state.sources.push(source);renderSources();updateSelectors();
  const key=`${state.sources.length-1}:0`;$('inspectSelect').value=key;$('compareA').value=key;renderIntegrity();
  closeViewer();document.querySelector('.import-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
  toast('保存済み会話を検証画面へ読み込みました。');
}

function exportViewerV15(){
  const a=state.viewerArchive;if(!a)return;
  const html=buildV15Html(a.conversation,{status:a.status||'UNVERIFIED'});
  downloadBlob(new Blob([html],{type:'text/html;charset=utf-8'}),`${sanitize(a.title||'conversation')}-v15.html`);
  toast('保存済み会話からv15 HTMLを生成しました。');
}

async function deleteViewerArchive(){
  const a=state.viewerArchive;if(!a)return;
  if(!confirm(`「${a.title||'(無題)'}」をWebアプリ内ライブラリから削除しますか？\n外部に保存したArchive Bundleやv15 HTMLは削除されません。`))return;
  await deleteArchive(a.id);closeViewer();await loadLibrary();toast('ライブラリから削除しました。');
}

function sanitizeForDisplay(html){
  return protectFragmentForDisplay(html);
}

function deriveStats(conv){
  const list=Object.values(conv?.nodes||{});
  return {nodes:list.length,user:list.filter(n=>n.role==='user').length,assistant:list.filter(n=>n.role==='assistant').length,branchPoints:list.filter(n=>(n.children||[]).length>1).length,leaves:list.filter(n=>!(n.children||[]).length).length,missingAssetRefs:0};
}
function statusClass(status=''){return status.includes('FAIL')?'bad':status.includes('VERIFIED')&&!status.includes('UNVERIFIED')?'ok':status.includes('PASS')||status.includes('AMBIGUOUS')?'warn':'neutral';}
function shortStatus(status='UNVERIFIED'){if(status.startsWith('GRAPH VERIFIED'))return 'GRAPH VERIFIED';if(status.startsWith('PATH VERIFIED'))return 'PATH VERIFIED';if(status.includes('FAIL'))return 'FAIL';if(status.includes('PASS'))return 'INTERNAL PASS';return 'UNVERIFIED';}
function formatDate(value){if(!value)return '—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return String(value);return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);}
function deepClone(v){if(globalThis.structuredClone)try{return structuredClone(v);}catch{}return JSON.parse(JSON.stringify(v));}
function cssEscape(v){return globalThis.CSS?.escape?CSS.escape(String(v)):String(v).replace(/["\\]/g,'\\$&');}
function sanitize(s){return String(s||'archive').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,100);}
function dateStamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
function toast(text){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,3500);}
