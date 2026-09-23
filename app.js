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
  library:[],librarySearchMode:'title',librarySearchResults:[],uiLanguage:'ja',homeExportAction:'library',viewerArchive:null,viewerCurrentNode:null,viewerLayer:'visual',viewerMatches:[],viewerMatchIndex:-1,viewerImages:[],viewerImageMetaVisible:true,viewerTranscriptScrollTop:0,viewerSearchOrigin:null,viewerLastSearchQuery:'',viewerSearchSnapshots:null,viewerPromptMatches:[],viewerPromptMatchIndex:-1,viewerPromptSearchSnapshots:null,viewerPromptLastSearchQuery:'',
};
const $=id=>document.getElementById(id);


function setup(){
  applySavedAppTheme();
  state.uiLanguage=savedUiLanguage();
  applyUiLanguage();
  $('appThemeBtn')?.addEventListener('click',toggleAppTheme);
  $('appSettingsBtn')?.addEventListener('click',e=>{e.stopPropagation();toggleHomePopover('appSettingsPanel');});
  $('appMoreBtn')?.addEventListener('click',e=>{e.stopPropagation();toggleHomePopover('appInfoPanel');});
  document.querySelectorAll('[data-ui-language]').forEach(btn=>btn.addEventListener('click',()=>setUiLanguage(btn.dataset.uiLanguage)));
  $('librarySearchModeBtn')?.addEventListener('click',()=>setLibrarySearchMode(state.librarySearchMode==='title'?'full':'title'));
  $('homeExportTrigger')?.addEventListener('click',e=>{e.stopPropagation();$('homeExportCtl').classList.toggle('open');$('homeModeCtl').classList.remove('open');});
  document.querySelectorAll('[data-export-action]').forEach(btn=>btn.addEventListener('click',()=>setHomeExportAction(btn.dataset.exportAction)));
  $('homeExportExecuteBtn')?.addEventListener('click',executeHomeExportAction);
  $('homeModeTrigger')?.addEventListener('click',e=>{e.stopPropagation();$('homeModeCtl').classList.toggle('open');$('homeExportCtl').classList.remove('open');});
  document.querySelectorAll('[data-home-mode]').forEach(btn=>btn.addEventListener('click',()=>{setMode(btn.dataset.homeMode);$('homeModeCtl').classList.remove('open');}));
  $('fileInput').addEventListener('change',e=>handleFiles([...e.target.files]));
  const dz=$('dropZone');
  ['dragenter','dragover'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(t=>dz.addEventListener(t,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>handleFiles([...e.dataTransfer.files]));
  $('inspectSelect').addEventListener('change',renderIntegrity);
  $('compareBtn').addEventListener('click',runCompare);

  $('librarySearch').addEventListener('input',renderLibrary);
  $('librarySearch').addEventListener('search',renderLibrary);
  $('librarySearchGo')?.addEventListener('click',openFirstLibrarySearchResult);
  $('refreshLibraryBtn').addEventListener('click',loadLibrary);
  $('libraryList').addEventListener('click',e=>{
    const assign=e.target.closest('[data-assign-archive]');
    if(assign){assignArchiveToVerification(assign.dataset.archiveId,assign.dataset.assignArchive);return;}
    const card=e.target.closest('[data-open-archive]');
    if(card) openArchive(card.dataset.openArchive);
  });
  $('libraryList').addEventListener('dragstart',e=>{
    const card=e.target.closest('[data-archive-id]');if(!card||!e.dataTransfer)return;
    e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('application/x-ai-dialogue-archive',card.dataset.archiveId);e.dataTransfer.setData('text/plain',card.dataset.archiveId);
  });
  for(const [id,target] of [['compareDropA','A'],['compareDropB','B']]){
    const slot=$(id);if(!slot)continue;
    slot.addEventListener('dragover',e=>{e.preventDefault();slot.classList.add('drag-over');});
    slot.addEventListener('dragleave',()=>slot.classList.remove('drag-over'));
    slot.addEventListener('drop',e=>{e.preventDefault();slot.classList.remove('drag-over');const archiveId=e.dataTransfer?.getData('application/x-ai-dialogue-archive')||e.dataTransfer?.getData('text/plain');if(archiveId)assignArchiveToVerification(archiveId,target);});
  }

  $('viewerCloseBtn').addEventListener('click',closeViewer);
  const toggleActions=e=>{e.stopPropagation();$('viewerActions').hidden=!$('viewerActions').hidden;};
  $('viewerMoreBtn').addEventListener('click',toggleActions);
  $('viewerPreviewMoreBtn').addEventListener('click',toggleActions);
  $('viewerThemeBtn').addEventListener('click',toggleViewerTheme);
  $('viewerPreviewThemeBtn').addEventListener('click',toggleViewerTheme);
  $('viewerHistoryBtn').addEventListener('click',()=>{$('viewerHistoryPanel').hidden=!$('viewerHistoryPanel').hidden;});
  $('viewerOverviewBtn').addEventListener('click',toggleViewerOverview);
  $('viewerLayerTrigger').addEventListener('click',e=>{e.stopPropagation();$('viewerLayerCtl').classList.toggle('open');});
  document.querySelectorAll('[data-viewer-layer]').forEach(btn=>btn.addEventListener('click',()=>setViewerLayer(btn.dataset.viewerLayer)));
  $('viewerLoadBtn').addEventListener('click',loadViewerIntoWorkspace);
  $('viewerExportBtn').addEventListener('click',exportViewerV15);
  $('viewerDeleteBtn').addEventListener('click',deleteViewerArchive);
  $('viewerTopBtn').addEventListener('click',()=>{const scroller=$('viewerPreviewOverlay').hidden?$('libraryViewer'):$('viewerPreviewOverlay');scroller.scrollTo({top:0,behavior:'smooth'});});
  $('viewerBottomBtn').addEventListener('click',()=>{const scroller=$('viewerPreviewOverlay').hidden?$('libraryViewer'):$('viewerPreviewOverlay');scroller.scrollTo({top:scroller.scrollHeight,behavior:'smooth'});});
  $('viewerSearch').addEventListener('input',handleViewerSearchInput);
  $('viewerSearch').addEventListener('search',handleViewerSearchInput);
  $('viewerSearch').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.isComposing){e.preventDefault();moveViewerMatch(e.shiftKey?-1:1);}
  });
  $('viewerSearchGo').addEventListener('click',()=>moveViewerMatch(1));
  $('viewerPreviewBtn').addEventListener('click',openViewerPreview);
  $('viewerPreviewBackBtn').addEventListener('click',closeViewer);
  $('viewerTranscriptBtn').addEventListener('click',()=>closeViewerPreview(true));
  $('viewerImageIndexBtn').addEventListener('click',toggleViewerImageMeta);
  $('viewerImagePromptsBtn').addEventListener('click',toggleViewerImagePrompts);
  $('viewerPromptSearch').addEventListener('input',handleViewerPromptSearchInput);
  $('viewerPromptSearch').addEventListener('search',handleViewerPromptSearchInput);
  $('viewerPromptSearch').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();moveViewerPromptMatch(e.shiftKey?-1:1);}});
  $('viewerPromptSearchGo').addEventListener('click',()=>moveViewerPromptMatch(1));
  $('viewerPreviewGrid').addEventListener('click',handleViewerPreviewClick);
  $('viewerImageLightboxClose').addEventListener('click',closeViewerImageLightbox);
  $('viewerImageLightbox').addEventListener('click',e=>{if(e.target===$('viewerImageLightbox'))closeViewerImageLightbox();});
  $('viewerTranscript').addEventListener('click',handleViewerTranscriptClick);
  document.addEventListener('click',e=>{
    if(!$('viewerLayerCtl').contains(e.target))$('viewerLayerCtl').classList.remove('open');
    if(!$('homeExportCtl')?.contains(e.target))$('homeExportCtl')?.classList.remove('open');
    if(!$('homeModeCtl')?.contains(e.target))$('homeModeCtl')?.classList.remove('open');
    if(!$('appSettingsPanel')?.contains(e.target)&&e.target!==$('appSettingsBtn'))$('appSettingsPanel').hidden=true;
    if(!$('appInfoPanel')?.contains(e.target)&&e.target!==$('appMoreBtn'))$('appInfoPanel').hidden=true;
    if(!$('viewerActions').contains(e.target)&&e.target!==$('viewerMoreBtn')&&e.target!==$('viewerPreviewMoreBtn'))$('viewerActions').hidden=true;
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


function savedTheme(){
  try{return localStorage.getItem('ada-theme')||localStorage.getItem('ada-viewer-theme')||'light';}catch{return 'light';}
}
function applySavedAppTheme(){
  const dark=savedTheme()==='dark';
  document.documentElement.classList.toggle('app-dark',dark);
  syncAppThemeControl();
}
function toggleAppTheme(){
  const dark=!document.documentElement.classList.contains('app-dark');
  document.documentElement.classList.toggle('app-dark',dark);
  try{localStorage.setItem('ada-theme',dark?'dark':'light');localStorage.setItem('ada-viewer-theme',dark?'dark':'light');}catch{}
  syncAppThemeControl();
  if(!$('libraryViewer')?.hidden){$('libraryViewer').classList.toggle('dark-theme',dark);syncViewerThemeControls();}
}
function syncAppThemeControl(){
  const dark=document.documentElement.classList.contains('app-dark');
  const b=$('appThemeBtn');if(!b)return;
  b.setAttribute('aria-label',dark?'ライトモードへ':'ダークモードへ');
  b.title=dark?'ライトモードへ':'ダークモードへ';
}


const UI_TEXT={
  homeSubtitle:{ja:'会話を保存・検証・閲覧する。',en:'Capture, verify, and read conversations.'},
  settings:{ja:'設定',en:'Settings'},uiLanguage:{ja:'UI Language',en:'UI Language'},
  localProcessing:{ja:'端末内処理',en:'Local processing'},localProcessingDesc:{ja:'会話本文はブラウザ内で処理。外部リソースは自動取得しません。',en:'Conversation content is processed in the browser. External resources are not fetched automatically.'},
  library:{ja:'ライブラリ',en:'Library'},libraryDesc:{ja:'読み込んだ会話はこのWebアプリ内に保存し、そのまま検索・閲覧できます。',en:'Imported conversations can be stored, searched, and read in this web app.'},
  storageLimits:{ja:'保存方式と限界',en:'Storage & limits'},storageLimitsDesc:{ja:'IndexedDB / OPFSを使用。重要な会話はArchive Bundle / v15 HTMLも残してください。',en:'Uses IndexedDB / OPFS. Keep an Archive Bundle / v15 HTML backup for important conversations.'},
  savedConversations:{ja:'保存済み会話',en:'Saved Conversations'},titleSearch:{ja:'Title',en:'Title'},fullTextSearch:{ja:'全文',en:'Full Text'},
  saveToLibrary:{ja:'ライブラリへ保存',en:'Save to Library'},quickCompact:{ja:'手軽に保存',en:'Quick'},verifyCompact:{ja:'完成保存',en:'Verify'},
  librarySearchPlaceholder:{ja:'タイトル・保存元を検索',en:'Search title / source'},libraryFullSearchPlaceholder:{ja:'全会話の本文を単語検索',en:'Search full text across all conversations'},
  quickTitle:{ja:'手軽に保存',en:'Quick Capture'},quickDesc:{ja:'v15 HTML / SingleFile HTML / JSONを読み込み、選択した会話をライブラリへ保存。',en:'Import v15 HTML / SingleFile HTML / JSON and save selected conversations to the library.'},
  verifiedTitle:{ja:'完成保存',en:'Verified Archive'},verifiedDesc:{ja:'OpenAI Exportを内部検査し、独立キャプチャとの本文・分岐差分まで照合。',en:'Inspect an OpenAI Export and compare body / branch differences against an independent capture.'},
  importSource:{ja:'資料を読み込む',en:'Import source'},tapOrDrop:{ja:'タップして選択 · Mac/PCはドラッグ＆ドロップ',en:'Tap to choose · drag & drop on Mac/PC'},
  saveExport:{ja:'保存・出力',en:'Save / Export'},saveLibrary:{ja:'Library',en:'Library'},saveLibraryDesc:{ja:'Webアプリ内へ保存',en:'Save in web app'},verification:{ja:'検証',en:'Verification'},dropArchive:{ja:'ライブラリからドロップ',en:'Drop from Library'},
  integrity:{ja:'内部完全性',en:'Internal integrity'},conversation:{ja:'会話',en:'Conversation'},compare:{ja:'本文・枝分かれ照合',en:'Body / branch comparison'},compareAction:{ja:'照合する',en:'Compare'},
  libraryHint:{ja:'会話をタップして開く · 検証時はA/Bへドラッグ',en:'Tap to open · drag to A/B for verification'},refresh:{ja:'更新',en:'Refresh'}
};
function savedUiLanguage(){try{const v=localStorage.getItem('ada-ui-language');return v==='en'?'en':'ja';}catch{return'ja';}}
function uiText(key){
  const pair=UI_TEXT[key];if(!pair)return key;
  if(state.uiLanguage==='en')return pair.en;
  return pair.ja;
}
function applyUiLanguage(){
  document.documentElement.lang=state.uiLanguage==='en'?'en':'ja';
  document.querySelectorAll('[data-i18n]').forEach(el=>{const key=el.dataset.i18n;if(UI_TEXT[key])el.textContent=uiText(key);});
  document.querySelectorAll('[data-ui-language]').forEach(btn=>btn.classList.toggle('active',btn.dataset.uiLanguage===state.uiLanguage));
  setLibrarySearchMode(state.librarySearchMode,true);
  syncHomeActionLabels();
}
function setUiLanguage(lang){
  state.uiLanguage=['ja','en'].includes(lang)?lang:'ja';
  try{localStorage.setItem('ada-ui-language',state.uiLanguage);}catch{}
  applyUiLanguage();renderLibrary();
}
function toggleHomePopover(id){
  const target=$(id);if(!target)return;
  for(const other of ['appSettingsPanel','appInfoPanel'])if(other!==id&&$(other))$(other).hidden=true;
  target.hidden=!target.hidden;
}
function setLibrarySearchMode(mode,skipRender=false){
  state.librarySearchMode=mode==='full'?'full':'title';
  const b=$('librarySearchModeBtn');if(b){b.textContent=state.librarySearchMode==='full'?uiText('fullTextSearch'):uiText('titleSearch');b.setAttribute('aria-label',state.librarySearchMode==='full'?'全文検索からTitle検索へ切替':'Title検索から全文検索へ切替');}
  const input=$('librarySearch');if(input)input.placeholder=state.librarySearchMode==='full'?uiText('libraryFullSearchPlaceholder'):uiText('librarySearchPlaceholder');
  if(!skipRender&&$('libraryList'))renderLibrary();
}
function syncHomeActionLabels(){
  const exportLabels={library:uiText('saveToLibrary'),bundle:'Archive Bundle',v15:'v15 HTML',report:'Verification Report'};
  if($('homeExportLabel'))$('homeExportLabel').textContent=exportLabels[state.homeExportAction]||exportLabels.library;
  document.querySelectorAll('[data-export-action]').forEach(btn=>{const check=btn.lastElementChild;if(check)check.textContent=btn.dataset.exportAction===state.homeExportAction?'✓':'';});
  if($('homeModeLabel'))$('homeModeLabel').textContent=state.mode==='verified'?uiText('verifyCompact'):uiText('quickCompact');
  document.querySelectorAll('[data-home-mode]').forEach(btn=>{const check=btn.lastElementChild;if(check)check.textContent=btn.dataset.homeMode===state.mode?'✓':'';});
}
function setHomeExportAction(action){
  state.homeExportAction=['library','bundle','v15','report'].includes(action)?action:'library';
  $('homeExportCtl')?.classList.remove('open');syncHomeActionLabels();
}
function executeHomeExportAction(){
  const action=state.homeExportAction;
  if(action==='bundle')return exportArchive();
  if(action==='v15')return exportV15();
  if(action==='report')return exportReport();
  return saveLocal();
}
function openFirstLibrarySearchResult(){const first=state.librarySearchResults?.[0];if(first?.id)openArchive(first.id);}

setup();

function setMode(mode){
  state.mode=mode;
  document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  syncHomeActionLabels();
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
    const ranked=originals.filter(o=>!sameSourceProvenance(cap,o)).map(o=>({o,score:bodyOverlapScore(cap.conv,o.conv)})).sort((a,b)=>b.score-a.score).slice(0,4).filter(x=>x.score>0);
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
    state.comparison={aKey:best.a.key,bKey:best.b.key,result:best.result,auto:true,independent:true};
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
    const reports=(s.integrity||[]).filter(Boolean);
    const err=reports.reduce((n,r)=>n+(r.errors||0),0), warn=reports.reduce((n,r)=>n+(r.warnings||0),0);
    const badge=!reports.length?'<span class="badge neutral">NO REPORT</span>':err?'<span class="badge bad">FAIL</span>':warn?'<span class="badge warn">PASS + WARN</span>':'<span class="badge ok">PASS</span>';
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

function sameSourceProvenance(A,B){
  if(!A||!B)return false;
  if(A.key&&B.key&&A.key===B.key)return true;
  if(Number.isInteger(A.si)&&Number.isInteger(B.si)&&A.si===B.si)return true;
  if(A.source&&B.source&&A.source===B.source)return true;
  const ah=A.source?.rawFileHash||A.rawFileHash||null,bh=B.source?.rawFileHash||B.rawFileHash||null;
  return Boolean(ah&&bh&&ah===bh);
}
function comparisonIndependenceReason(A,B){
  if(!A||!B)return '比較元が不足しています。';
  if(A.si===B.si&&A.ci===B.ci)return '同じ会話を自分自身とは照合できません。';
  if(A.si===B.si)return '同じ読み込み資料内の会話同士は独立資料として扱いません。';
  const ah=A.source?.rawFileHash||null,bh=B.source?.rawFileHash||null;
  if(ah&&bh&&ah===bh)return '同じ原本 SHA-256 を持つ資料は独立資料として扱いません。';
  return '';
}
function storedArchiveStatus(a){
  const status=a?.status||'UNVERIFIED';
  if((status.startsWith('GRAPH VERIFIED')||status.startsWith('PATH VERIFIED'))&&!a?.verificationEvidence?.independent){
    return a?.report?.errors?'INTERNAL FAIL':a?.report?'INTERNAL PASS · UNVERIFIED':'UNVERIFIED';
  }
  return status;
}

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
  const reason=comparisonIndependenceReason(A,B);
  if(reason){
    state.comparison={aKey:$('compareA').value,bKey:$('compareB').value,result:null,independent:false,reason};
    $('compareResult').className='compare-result';
    $('compareResult').innerHTML=`<div class="compare-head"><strong class="result warn">SAME SOURCE · NOT VERIFIED</strong><span class="badge warn">NO CROSS-SOURCE</span></div><div class="diff-item">${escapeHtml(reason)}</div>`;
    updateArchiveStatus();return;
  }
  $('compareResult').className='empty-state';$('compareResult').textContent='照合中…';
  await new Promise(r=>requestAnimationFrame(()=>r()));
  try{state.comparison={aKey:$('compareA').value,bKey:$('compareB').value,result:await compareConversations(A.conv,B.conv),independent:true};renderComparison();updateArchiveStatus();}
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
  const cmp=(state.comparison?.independent && (state.comparison.aKey===key || state.comparison.bKey===key)) ? state.comparison.result : null;
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
      verificationEvidence:(state.comparison?.independent&&(state.comparison.aKey===$('inspectSelect').value||state.comparison.bKey===$('inspectSelect').value)&&state.comparison.result)?{independent:true,aKey:state.comparison.aKey,bKey:state.comparison.bKey,label:state.comparison.result.label,graphVerified:Boolean(state.comparison.result.graphVerified),pathVerified:Boolean(state.comparison.result.verified),verifiedAt:now}:null,
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
  return {id:c.id,title:c.title,createTime:c.createTime,updateTime:c.updateTime,currentNode:c.currentNode,sourceFormat:c.sourceFormat,sourceName:c.sourceName,rootIds:c.rootIds,nodes,htmlFlavor:c.htmlFlavor??null,rawOriginalText:c.rawOriginalText??null,previewImages:c.previewImages??null,overview:c.overview??null,keywords:c.keywords??null,aiAnnotations:c.aiAnnotations??null,...(includeRaw?{rawObject:c.rawObject,htmlRaw:c.htmlRaw,visualHtml:c.visualHtml??null}: {})};
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

function archiveSearchText(archive){
  if(archive._searchTextCache)return archive._searchTextCache;
  const nodes=Object.values(archive.conversation?.nodes||{});
  const text=nodes.map(n=>String(n.text||'')).join('\n').normalize('NFKC');
  archive._searchTextCache=text;return text;
}
function countLiteralMatches(haystack,needle){
  if(!needle)return 0;const h=haystack.toLocaleLowerCase(),n=needle.toLocaleLowerCase();let count=0,pos=0;
  while((pos=h.indexOf(n,pos))!==-1){count++;pos+=Math.max(1,n.length);}return count;
}
function snippetAround(text,query,maxLen=118){
  if(!text||!query)return'';const lower=text.toLocaleLowerCase(),q=query.toLocaleLowerCase();const pos=lower.indexOf(q);if(pos<0)return'';
  const start=Math.max(0,pos-Math.floor((maxLen-query.length)/2));const end=Math.min(text.length,start+maxLen);
  return `${start>0?'…':''}${text.slice(start,end).replace(/\s+/g,' ').trim()}${end<text.length?'…':''}`;
}
function fullTextSnippets(archive,query,limit=2){
  if(!query)return[];const out=[];
  for(const node of Object.values(archive.conversation?.nodes||{})){
    const text=String(node.text||'');if(!text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))continue;
    const snippet=snippetAround(text,query);if(snippet)out.push({role:node.role||'unknown',text:snippet});if(out.length>=limit)break;
  }
  return out;
}
function highlightLibrarySnippet(text,query){
  const safe=escapeHtml(text);if(!query)return safe;
  const escaped=String(query).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  try{return safe.replace(new RegExp(escaped,'gi'),m=>`<mark>${m}</mark>`);}catch{return safe;}
}
function librarySearchRecord(archive,query,mode){
  if(!query)return{match:true,hits:0,snippets:[]};
  if(mode==='full'){
    const text=archiveSearchText(archive);const hits=countLiteralMatches(text,query);
    return{match:hits>0,hits,snippets:hits?fullTextSnippets(archive,query):[]};
  }
  const hay=`${archive.title||''} ${archive.source?.name||''} ${archive.status||''}`;
  return{match:hay.toLocaleLowerCase().includes(query.toLocaleLowerCase()),hits:0,snippets:[]};
}
function renderLibrary(){
  const list=$('libraryList');
  const q=($('librarySearch').value||'').trim();
  const records=state.library.map(a=>({archive:a,...librarySearchRecord(a,q,state.librarySearchMode)})).filter(x=>x.match);
  state.librarySearchResults=records.map(x=>x.archive);
  $('libraryCount').textContent=String(state.library.length);
  if($('librarySearchCount'))$('librarySearchCount').textContent=q?`${records.length} / ${state.library.length}`:`${state.library.length}`;
  if(!state.library.length){list.className='library-list empty-state';list.textContent=state.uiLanguage==='en'?'No saved conversations yet.':'まだ保存済み会話はありません。資料を読み込み、会話を選んで「ライブラリへ保存」を押してください。';return;}
  if(!records.length){list.className='library-list empty-state';list.textContent=state.uiLanguage==='en'?'No matching conversations.':'一致する保存済み会話はありません。';return;}
  list.className='library-list';
  list.innerHTML=records.map(({archive:a,hits,snippets})=>{
    const stats=a.stats||deriveStats(a.conversation||{});const effectiveStatus=storedArchiveStatus(a);const cls=statusClass(effectiveStatus);
    const hitLine=state.librarySearchMode==='full'&&q?`<span class="library-hit-count">${hits} hit${hits===1?'':'s'}</span>`:'';
    const snippetHtml=snippets.length?`<div class="library-snippets">${snippets.map(x=>`<div><b>${escapeHtml(x.role==='assistant'?'ChatGPT':x.role==='user'?'User':x.role)}</b>${highlightLibrarySnippet(x.text,q)}</div>`).join('')}</div>`:'';
    return `<article class="library-card" draggable="true" data-archive-id="${escapeHtml(a.id)}">
      <button class="library-card-open" data-open-archive="${escapeHtml(a.id)}" type="button">
        <span class="library-card-main"><strong>${escapeHtml(a.title||'(無題)')}</strong><small>${escapeHtml(a.source?.name||'Local Library')} · ${formatDate(a.updatedAt||a.savedAt)}</small><span class="library-card-stats">${stats.user||0} User · ${stats.assistant||0} ChatGPT · ${stats.branchPoints||0} Branches ${a.graphHash?`· ${escapeHtml(a.graphHash.slice(0,10))}…`:''}</span></span>
        <span class="library-card-side"><span class="badge ${cls}">${escapeHtml(shortStatus(effectiveStatus))}</span>${hitLine}</span>
      </button>
      ${snippetHtml}
      <div class="library-quick-actions"><button type="button" data-assign-archive="A" data-archive-id="${escapeHtml(a.id)}" aria-label="検証資料Aへ">A</button><button type="button" data-assign-archive="B" data-archive-id="${escapeHtml(a.id)}" aria-label="検証資料Bへ">B</button></div>
    </article>`;
  }).join('');
}


async function assignArchiveToVerification(archiveId,target){
  try{
    const archive=await getArchive(archiveId);if(!archive){toast('保存済み会話が見つかりません。');return;}
    let sourceIndex=state.sources.findIndex(s=>s._archiveId===archive.id);
    if(sourceIndex<0){
      const conv=deepClone(archive.conversation);
      const source={id:stableId('source'),_archiveId:archive.id,kind:'library-archive',name:`Library · ${archive.title}`,importedAt:new Date().toISOString(),rawFileHash:archive.source?.rawFileHash||null,rawSize:archive.source?.rawSize||0,entryNames:['local-library'],conversations:[conv],integrity:[archive.report||null],sourceFile:null};
      state.sources.push(source);sourceIndex=state.sources.length-1;renderSources();updateSelectors();
    }
    const key=`${sourceIndex}:0`;const selectId=target==='B'?'compareB':'compareA';
    $(selectId).value=key;if(!$('inspectSelect').value||target==='A')$('inspectSelect').value=key;
    const slot=$(target==='B'?'compareDropB':'compareDropA');
    if(slot){slot.classList.add('assigned');slot.querySelector('small').textContent=archive.title||'(無題)';}
    $('verificationWorkbench').open=true;renderIntegrity();updateArchiveStatus();
    toast(`検証資料${target}に設定しました。`);
  }catch(e){toast(`検証資料の読み込みに失敗: ${e.message}`);console.error(e);}
}

async function openArchive(id){
  try{
    const archive=await getArchive(id);if(!archive){toast('保存済み会話が見つかりません。');await loadLibrary();return;}
    state.viewerArchive=archive;
    state.viewerCurrentNode=archive.conversation?.currentNode||bestLeafFrom(archive.conversation,null);
    state.viewerLayer='visual';state.viewerMatches=[];state.viewerMatchIndex=-1;state.viewerImages=[];state.viewerImageMetaVisible=true;state.viewerSearchOrigin=null;state.viewerLastSearchQuery='';state.viewerSearchSnapshots=null;state.viewerPromptMatches=[];state.viewerPromptMatchIndex=-1;state.viewerPromptSearchSnapshots=null;state.viewerPromptLastSearchQuery='';
    $('viewerTitle').textContent=archive.title||'(無題)';
    $('viewerPreviewTitle').textContent=archive.title||'(無題)';
    $('viewerUpdatedAt').textContent=formatDate(archive.updatedAt||archive.savedAt);
    $('viewerSearch').value='';$('viewerActions').hidden=true;$('viewerHistoryPanel').hidden=true;$('viewerOverviewPanel').hidden=true;$('libraryViewer').classList.remove('overview-open');
    $('viewerPromptSearch').value='';$('viewerPromptMatchCount').textContent='0 / 0';$('viewerImagePromptsPanel').hidden=true;$('viewerImagePromptsBtn').textContent='Image Prompts';
    applySavedViewerTheme();
    $('libraryViewer').hidden=false;document.body.classList.add('viewer-open');
    $('libraryViewer').scrollTop=0;
    renderViewerMeta();renderViewerHeaderPanels();renderViewerTranscript();renderViewerSemantic();renderViewerRaw();setViewerLayer('visual');
    state.viewerImages=collectViewerImages();renderViewerPreview();
  }catch(e){toast(`会話を開けません: ${e.message}`);console.error(e);}
}

function closeViewer(){
  closeViewerPreview(false);
  $('libraryViewer').hidden=true;document.body.classList.remove('viewer-open');
  $('libraryViewer').classList.remove('overview-open');
  state.viewerArchive=null;state.viewerCurrentNode=null;state.viewerMatches=[];state.viewerMatchIndex=-1;state.viewerImages=[];state.viewerSearchOrigin=null;state.viewerLastSearchQuery='';state.viewerSearchSnapshots=null;state.viewerPromptMatches=[];state.viewerPromptMatchIndex=-1;state.viewerPromptSearchSnapshots=null;state.viewerPromptLastSearchQuery='';
}

function renderViewerMeta(){
  const a=state.viewerArchive;if(!a)return;
  const s=a.stats||deriveStats(a.conversation||{});
  $('viewerMeta').innerHTML=`<span>${s.user||0} User</span><span>${s.assistant||0} ChatGPT</span><span>${s.branchPoints||0} Branches</span>${a.graphHash?`<span class="viewer-hash">${escapeHtml(a.graphHash.slice(0,16))}…</span>`:''}`;
}

function renderViewerHeaderPanels(){
  const a=state.viewerArchive;if(!a)return;
  $('viewerHistoryPanel').innerHTML=`<div class="viewer-history-item"><strong>${escapeHtml(formatDate(a.updatedAt||a.savedAt))}</strong><span>ライブラリ保存済み会話 · ${escapeHtml(a.source?.name||'Local Library')}</span></div>`;
  const conv=a.conversation||{};
  const overview=conv.overview||a.overview||null;
  const storedKeywords=conv.keywords||a.keywords||null;
  const summaryText=typeof overview==='string'?overview:(overview?.summary||'保存済みOverviewはありません。');
  const localKeywords=deriveLocalKeywords(conv,24);
  const storedKeywordList=Array.isArray(storedKeywords)?storedKeywords:typeof storedKeywords==='string'?storedKeywords.split(/\s*[/,、]\s*/).filter(Boolean):[];
  const aiCandidates=conv.aiAnnotations?.keywords||conv.aiAnnotations?.keyConcepts||a.aiAnnotations?.keywords||a.aiAnnotations?.keyConcepts||overview?.aiKeywords||overview?.keyConcepts||null;
  const aiKeywordList=Array.isArray(aiCandidates)?aiCandidates:typeof aiCandidates==='string'?aiCandidates.split(/\s*[/,、]\s*/).filter(Boolean):[];
  const chips=(items,cls='')=>items.map(x=>`<span class="viewer-concept-chip ${cls}">${escapeHtml(String(x))}</span>`).join('');
  $('viewerOverviewPanel').innerHTML=`<section class="viewer-meaning-half viewer-meaning-summary"><div class="viewer-meaning-label">Summary</div><div class="viewer-overview-summary">${escapeHtml(summaryText)}</div></section><section class="viewer-meaning-half viewer-meaning-concepts"><div class="viewer-meaning-label">Key Concepts / Keywords</div><div class="viewer-concept-group"><span class="viewer-overview-source">LOCAL</span><div class="viewer-concept-cloud">${chips(localKeywords)}</div></div>${storedKeywordList.length?`<div class="viewer-concept-group"><span class="viewer-overview-source">SAVED</span><div class="viewer-concept-cloud">${chips(storedKeywordList,'saved')}</div></div>`:''}${aiKeywordList.length?`<div class="viewer-concept-group"><span class="viewer-overview-source">AI KEY CONCEPTS</span><div class="viewer-concept-cloud">${chips(aiKeywordList,'ai')}</div></div>`:''}</section>`;
}

function deriveLocalKeywords(conv,limit=12){
  const nodes=Object.values(conv?.nodes||{});
  if(!nodes.length)return[];
  const stop=new Set([
    'これ','それ','あれ','この','その','あの','ここ','そこ','どこ','どれ','ため','よう','もの','こと','ところ','とき','です','ます','でした','ました','いる','ある','なる','する','して','した','され','から','まで','より','ので','のに','なら','では','でも','また','そして','ただ','という','として','について','ような','ように','かなり','もっと','少し','今回','今後','現在','以前','自分','私','あなた','こちら','そこから','そのもの','つまり','だから','なので','だけ','あり','なし','ない','なく','って','てい','せん','できる','でき','できて','なっ','なり','よく','本当','普通','場合','感じ','思い','同じ','面白い','強い','必要','重要','可能性','近い','時間','人間','情報','考える','思う','言う','見る','分かる','わかる','使う','出る','入る','持つ','ユーザー','chatgpt','assistant','user',
    'the','and','that','this','with','from','have','has','for','not','are','was','were','will','would','can','could','into','about','your','you','our','but','its','than','then','also','just'
  ]);
  const freq=new Map(),spread=new Map(),roles=new Map();
  let segmenter=null;try{segmenter=new Intl.Segmenter('ja',{granularity:'word'});}catch{}
  const isHiraganaOnly=t=>/^[\p{Script=Hiragana}ー]+$/u.test(t);
  const quality=t=>{
    let q=0;if(/[\p{Script=Han}]/u.test(t))q+=1.25;if(/[\p{Script=Katakana}]/u.test(t))q+=1.05;if(/[A-Za-z]/.test(t))q+=.85;if(t.length>=3)q+=.35;if(t.length>=5)q+=.25;return q;
  };
  const tokenize=text=>{
    const norm=String(text||'').normalize('NFKC').toLowerCase();
    if(segmenter){
      const raw=[...segmenter.segment(norm)].filter(x=>x.isWordLike).map(x=>x.segment);
      const out=[];
      for(const part of raw){
        if(out.length&&['性','的','化','感','力','論','学','観','型','系'].includes(part))out[out.length-1]+=part;
        else out.push(part);
      }
      return out;
    }
    return norm.match(/[\p{L}\p{N}ー々]{2,}/gu)||[];
  };
  nodes.forEach(n=>{
    const seen=new Set();
    for(const raw of tokenize(n.text||'')){
      const token=raw.replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu,'');
      if(token.length<2||token.length>28||/^\d+(?:[.,]\d+)*$/.test(token)||stop.has(token)||isHiraganaOnly(token))continue;
      if(!/[\p{Script=Han}\p{Script=Katakana}A-Za-z]/u.test(token))continue;
      freq.set(token,(freq.get(token)||0)+1);
      if(!seen.has(token)){spread.set(token,(spread.get(token)||0)+1);seen.add(token);}
      if(!roles.has(token))roles.set(token,new Set());roles.get(token).add(n.role||'unknown');
    }
  });
  const title=String(conv.title||'').normalize('NFKC').toLowerCase();
  const corpus=state.library?.length?state.library.map(a=>archiveSearchText(a).toLocaleLowerCase()):[];
  return [...freq.keys()].map(token=>{
    const f=freq.get(token)||0,d=spread.get(token)||0,r=roles.get(token)?.size||1;
    const df=corpus.length?corpus.reduce((n,doc)=>n+(doc.includes(token)?1:0),0):0;
    const idf=corpus.length?Math.log((corpus.length+1)/(df+1))+1:1;
    const titleBoost=title.includes(token)?4.0:0;
    const score=(Math.log2(f+1)*1.9+Math.log2(d+1)*1.35+(r>1?.6:0)+quality(token)+titleBoost)*idf;
    return {token,score,f,d};
  }).filter(x=>x.f>=2||x.d>=2||title.includes(x.token))
    .sort((a,b)=>b.score-a.score||b.d-a.d||b.f-a.f||a.token.localeCompare(b.token,'ja'))
    .slice(0,limit).map(x=>({ai:'AI',ui:'UI',iq:'IQ',api:'API',html:'HTML',json:'JSON',svg:'SVG',css:'CSS',javascript:'JavaScript'}[x.token]||x.token));
}

function setViewerOverviewOpen(open){
  const p=$('viewerOverviewPanel'),viewer=$('libraryViewer');if(!p||!viewer)return;
  p.hidden=!open;viewer.classList.toggle('overview-open',open);
  $('viewerOverviewBtn').textContent='Overview & Key Concepts';
  if(open){
    const header=viewer.querySelector('.viewer-sticky-header');
    const bottom=header?.getBoundingClientRect().bottom||0;
    viewer.style.setProperty('--viewer-meaning-top',`${Math.ceil(bottom)}px`);
  }else viewer.style.removeProperty('--viewer-meaning-top');
}
function toggleViewerOverview(){setViewerOverviewOpen($('viewerOverviewPanel').hidden);}

function applySavedViewerTheme(){
  const dark=savedTheme()==='dark';
  $('libraryViewer').classList.toggle('dark-theme',dark);
  document.documentElement.classList.toggle('app-dark',dark);
  syncAppThemeControl();
  syncViewerThemeControls();
}
function toggleViewerTheme(){
  const dark=!$('libraryViewer').classList.contains('dark-theme');
  $('libraryViewer').classList.toggle('dark-theme',dark);
  document.documentElement.classList.toggle('app-dark',dark);
  try{localStorage.setItem('ada-theme',dark?'dark':'light');localStorage.setItem('ada-viewer-theme',dark?'dark':'light');}catch{}
  syncAppThemeControl();
  syncViewerThemeControls();
}
function syncViewerThemeControls(){
  const dark=$('libraryViewer').classList.contains('dark-theme');
  for(const id of ['viewerThemeBtn','viewerPreviewThemeBtn']){
    const b=$(id);if(!b)continue;
    b.setAttribute('aria-label',dark?'ライトモードへ':'ダークモードへ');
    b.title=dark?'ライトモードへ':'ダークモードへ';
  }
}
function viewerLayerRoot(layer=state.viewerLayer){
  return layer==='semantic'?$('viewerSemantic'):layer==='raw'?$('viewerRaw'):$('viewerTranscript');
}
function captureViewerReadingAnchor(layer=state.viewerLayer){
  const scroller=$('libraryViewer'),root=viewerLayerRoot(layer);if(!scroller||!root)return null;
  const header=$('libraryViewer').querySelector('.viewer-sticky-header');
  const top=(header?.getBoundingClientRect().bottom||scroller.getBoundingClientRect().top)+4;
  const bottom=scroller.getBoundingClientRect().bottom;
  const nodes=[...root.querySelectorAll('[data-node-id]')];
  let chosen=null,chosenIndex=-1;
  for(let i=0;i<nodes.length;i++){
    const el=nodes[i],r=el.getBoundingClientRect();
    if(r.bottom>top&&r.top<bottom){chosen=el;chosenIndex=i;break;}
  }
  if(!chosen)return {nodeId:null,nodeIndex:-1,messageFraction:0,scrollTop:scroller.scrollTop};
  const r=chosen.getBoundingClientRect();
  const messageFraction=Math.max(0,Math.min(1,(top-r.top)/Math.max(1,r.height)));
  return {nodeId:chosen.dataset.nodeId||null,nodeIndex:chosenIndex,messageFraction,scrollTop:scroller.scrollTop};
}
function restoreViewerReadingAnchor(anchor,{behavior='auto'}={}){
  if(!anchor)return;
  const scroller=$('libraryViewer'),root=viewerLayerRoot();if(!scroller||!root)return;
  if(!anchor.nodeId){scroller.scrollTo({top:anchor.scrollTop||0,behavior});return;}
  let target=root.querySelector(`[data-node-id="${cssEscape(anchor.nodeId)}"]`);
  if(!target&&Number.isInteger(anchor.nodeIndex)&&anchor.nodeIndex>=0){
    target=root.querySelectorAll('[data-node-id]')[anchor.nodeIndex]||null;
  }
  if(!target){scroller.scrollTo({top:anchor.scrollTop||0,behavior});return;}
  const header=$('libraryViewer').querySelector('.viewer-sticky-header');
  const top=(header?.getBoundingClientRect().bottom||scroller.getBoundingClientRect().top)+4;
  const r=target.getBoundingClientRect();
  const fraction=Number.isFinite(anchor.messageFraction)?anchor.messageFraction:(anchor.ratio||0);
  const delta=(r.top+fraction*Math.max(1,r.height))-top;
  scroller.scrollTo({top:Math.max(0,scroller.scrollTop+delta),behavior});
}

function setViewerLayer(layer,{preservePosition=true}={}){
  if(!['visual','semantic','raw'].includes(layer))layer='visual';
  const anchor=preservePosition?captureViewerReadingAnchor(state.viewerLayer):null;
  clearViewerHighlights();
  state.viewerLayer=layer;
  $('viewerTranscript').hidden=layer!=='visual';$('viewerSemantic').hidden=layer!=='semantic';$('viewerRaw').hidden=layer!=='raw';
  const labels={visual:'Visual Replica',semantic:'Semantic Transcript',raw:'Raw Original'};
  $('viewerLayerLabel').textContent=labels[layer];
  document.querySelectorAll('[data-viewer-layer]').forEach(b=>{const check=b.querySelector('span');if(check)check.textContent=b.dataset.viewerLayer===layer?'✓':'';});
  $('viewerLayerCtl').classList.remove('open');
  applyViewerSearch({resetIndex:true,showCurrent:false});
  if(anchor)requestAnimationFrame(()=>restoreViewerReadingAnchor(anchor));
}

function renderViewerTranscript(){
  const a=state.viewerArchive,box=$('viewerTranscript');if(!a)return;
  const conv=a.conversation||{},path=pathToNode(conv,state.viewerCurrentNode);
  const html=[];
  for(let i=0;i<path.length;i++){
    const id=path[i],n=conv.nodes?.[id];if(!n||!['user','assistant','system','tool'].includes(n.role))continue;
    if(!String(n.text||'').trim()&&!n.richHtml)continue;
    const role=n.role==='user'?'User':n.role==='assistant'?'ChatGPT':n.role;
    const rich=n.richHtml?sanitizeForDisplay(n.richHtml):escapeHtml(n.text||'').replace(/\n/g,'<br>');
    const children=(n.children||[]).filter(cid=>conv.nodes?.[cid]);
    const activeNext=path[i+1]||null;
    const branch=children.length>1?`<div class="viewer-branches"><span>分岐 ${children.length}</span>${children.map((cid,idx)=>{const child=conv.nodes[cid];const label=branchLabel(child,idx);return `<button class="branch-choice ${cid===activeNext?'active':''}" data-branch-child="${escapeHtml(cid)}">${escapeHtml(label)}</button>`;}).join('')}</div>`:'';
    html.push(`<article class="viewer-message ${escapeHtml(n.role)}" data-node-id="${escapeHtml(id)}"><div class="viewer-role">${escapeHtml(role)}</div><div class="viewer-body">${rich}</div>${branch}</article>`);
  }
  box.innerHTML=html.join('')||'<div class="empty-state">本文がありません。</div>';
  applyViewerSearch({jumpToFirst:false,resetIndex:true});
}

function renderViewerSemantic(){
  const a=state.viewerArchive,box=$('viewerSemantic');if(!a)return;
  const conv=a.conversation||{},path=pathToNode(conv,state.viewerCurrentNode);
  box.innerHTML=path.map(id=>({id,n:conv.nodes?.[id]})).filter(x=>x.n&&['user','assistant','system','tool'].includes(x.n.role)&&(String(x.n.text||'').trim()||x.n.richHtml)).map(({id,n})=>{
    const text=String(n.text||'').trim()||'[Image / attachment]';
    return `<section class="viewer-semantic-message" data-node-id="${escapeHtml(id)}"><div class="viewer-semantic-head">${escapeHtml(n.role==='assistant'?'ChatGPT':n.role==='user'?'User':n.role)}</div><pre>${escapeHtml(text)}</pre></section>`;
  }).join('')||'<div class="empty-state">Semantic Transcriptがありません。</div>';
}

function renderViewerRaw(){
  const a=state.viewerArchive,box=$('viewerRaw');if(!a)return;
  const conv=a.conversation||{},path=pathToNode(conv,state.viewerCurrentNode);
  const mapped=path.map(id=>({id,n:conv.nodes?.[id]})).filter(x=>x.n&&['user','assistant','system','tool'].includes(x.n.role)).map(({id,n})=>{
    let body='';
    if(n.raw!=null){try{body=typeof n.raw==='string'?n.raw:JSON.stringify(n.raw,null,2);}catch{body=String(n.raw);}}
    if(!body)body=String(n.text||'');
    return `<section class="viewer-raw-message" data-node-id="${escapeHtml(id)}"><div>${escapeHtml(n.role||'unknown')} · ${escapeHtml(n.id||id)}</div><pre>${escapeHtml(body)}</pre></section>`;
  }).join('');
  const raw=a.conversation?.rawOriginalText;
  const full=raw?`<details class="viewer-raw-source"><summary>Full Raw Original</summary><pre class="viewer-raw-text">${escapeHtml(raw)}</pre></details>`:'';
  box.innerHTML=full+(mapped||'<div class="empty-state">Raw Originalがありません。</div>');
}

function handleViewerTranscriptClick(e){
  const external=e.target.closest('[data-external-url]');
  if(external){const url=externalUrlFromGate(external);if(url)window.open(url,'_blank','noopener,noreferrer');return;}
  const b=e.target.closest('[data-branch-child]');if(!b||!state.viewerArchive)return;
  const activeQuery=String($('viewerSearch').value||'');
  if(activeQuery){
    restoreViewerSearchSnapshots();
    state.viewerSearchOrigin=null;state.viewerLastSearchQuery='';state.viewerMatches=[];state.viewerMatchIndex=-1;
    $('viewerSearch').value='';
  }
  state.viewerCurrentNode=bestLeafFrom(state.viewerArchive.conversation,b.dataset.branchChild);
  renderViewerTranscript();renderViewerSemantic();renderViewerRaw();
  if(activeQuery){
    $('viewerSearch').value=activeQuery;
    state.viewerSearchOrigin=captureViewerReadingAnchor();
    captureViewerSearchSnapshots();
    state.viewerLastSearchQuery=activeQuery.trim();
    applyViewerSearch({resetIndex:true,showCurrent:false});
  }
  requestAnimationFrame(()=>document.querySelector(`[data-node-id="${cssEscape(b.dataset.branchChild)}"]`)?.scrollIntoView({block:'center'}));
}

function activeViewerSearchRoot(){return viewerLayerRoot();}
function captureViewerSearchSnapshots(){
  if(state.viewerSearchSnapshots)return;
  state.viewerSearchSnapshots={
    visual:$('viewerTranscript').innerHTML,
    semantic:$('viewerSemantic').innerHTML,
    raw:$('viewerRaw').innerHTML,
  };
}
function restoreViewerSearchSnapshots({keep=false}={}){
  const snap=state.viewerSearchSnapshots;if(!snap)return false;
  $('viewerTranscript').innerHTML=snap.visual;
  $('viewerSemantic').innerHTML=snap.semantic;
  $('viewerRaw').innerHTML=snap.raw;
  state.viewerMatches=[];state.viewerMatchIndex=-1;
  if(!keep)state.viewerSearchSnapshots=null;
  return true;
}
function clearViewerHighlights(){
  if(restoreViewerSearchSnapshots({keep:true}))return;
  for(const root of [$('viewerTranscript'),$('viewerSemantic'),$('viewerRaw')]){
    root.querySelectorAll('mark.viewer-hit').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));
    root.normalize();root.querySelectorAll('.search-current,.search-match-current').forEach(x=>x.classList.remove('search-current','search-match-current'));
  }
  state.viewerMatches=[];state.viewerMatchIndex=-1;
}
function handleViewerSearchInput(){
  const q=String($('viewerSearch').value||'').trim();
  if(q&&!state.viewerLastSearchQuery){
    state.viewerSearchOrigin=captureViewerReadingAnchor();
    captureViewerSearchSnapshots();
  }
  if(!q){
    const origin=state.viewerSearchOrigin;
    restoreViewerSearchSnapshots();
    state.viewerMatches=[];state.viewerMatchIndex=-1;state.viewerLastSearchQuery='';state.viewerSearchOrigin=null;
    $('viewerMatchCount').textContent='0 / 0';
    if(origin)requestAnimationFrame(()=>restoreViewerReadingAnchor(origin));
    return;
  }
  state.viewerLastSearchQuery=q;
  applyViewerSearch({resetIndex:true,showCurrent:false});
}
function applyViewerSearch({jumpToFirst=false,resetIndex=false,showCurrent=false}={}){
  const q=String($('viewerSearch').value||'').trim();
  if(!q){$('viewerMatchCount').textContent='0 / 0';return;}
  captureViewerSearchSnapshots();
  restoreViewerSearchSnapshots({keep:true});
  const root=activeViewerSearchRoot();
  const needle=q.toLocaleLowerCase('ja');
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.nodeValue)return NodeFilter.FILTER_REJECT;
    if(node.parentElement?.closest('script,style,button,input,mark,summary'))return NodeFilter.FILTER_REJECT;
    return node.nodeValue.toLocaleLowerCase('ja').includes(needle)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
  }});
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    const raw=node.nodeValue,low=raw.toLocaleLowerCase('ja');let pos=0,at=low.indexOf(needle,pos);if(at<0)continue;
    const frag=document.createDocumentFragment();
    while(at>=0){if(at>pos)frag.append(document.createTextNode(raw.slice(pos,at)));const mark=document.createElement('mark');mark.className='viewer-hit';mark.textContent=raw.slice(at,at+q.length);frag.append(mark);state.viewerMatches.push(mark);pos=at+q.length;at=low.indexOf(needle,pos);}
    if(pos<raw.length)frag.append(document.createTextNode(raw.slice(pos)));node.replaceWith(frag);
  }
  if(!state.viewerMatches.length){state.viewerMatchIndex=-1;$('viewerMatchCount').textContent='0 / 0';return;}
  if(resetIndex)state.viewerMatchIndex=-1;
  else if(state.viewerMatchIndex>=state.viewerMatches.length)state.viewerMatchIndex=-1;
  $('viewerMatchCount').textContent=state.viewerMatchIndex>=0?`${state.viewerMatchIndex+1} / ${state.viewerMatches.length}`:`0 / ${state.viewerMatches.length}`;
  if(jumpToFirst){state.viewerMatchIndex=0;focusViewerMatch(true);}
  else if(showCurrent&&state.viewerMatchIndex>=0)focusViewerMatch(false);
}
function moveViewerMatch(delta){
  const q=String($('viewerSearch').value||'').trim();if(!q)return;
  if(!$('viewerOverviewPanel').hidden)setViewerOverviewOpen(false);
  if(!state.viewerMatches.length)applyViewerSearch({resetIndex:true,showCurrent:false});
  if(!state.viewerMatches.length)return;
  if(state.viewerMatchIndex<0)state.viewerMatchIndex=delta<0?state.viewerMatches.length-1:0;
  else state.viewerMatchIndex=(state.viewerMatchIndex+delta+state.viewerMatches.length)%state.viewerMatches.length;
  focusViewerMatch(true);
}
function focusViewerMatch(scroll){
  state.viewerMatches.forEach(m=>m.classList.remove('search-current'));
  const mark=state.viewerMatches[state.viewerMatchIndex];if(!mark){$('viewerMatchCount').textContent=`0 / ${state.viewerMatches.length}`;return;}
  mark.classList.add('search-current');$('viewerMatchCount').textContent=`${state.viewerMatchIndex+1} / ${state.viewerMatches.length}`;
  if(scroll)requestAnimationFrame(()=>mark.scrollIntoView({behavior:'smooth',block:'center'}));
}

function isViewerContentImage(img){
  if(!img)return false;
  if(img.closest('.math-vector,.math-block,.math-boxed-vector,.archive-svg-math,.katex,.MathJax,mjx-container,[data-source-latex],[data-math],[data-latex]'))return false;
  const signature=[img.getAttribute('class'),img.getAttribute('alt'),img.getAttribute('title'),img.getAttribute('role')].filter(Boolean).join(' ').toLowerCase();
  if(/formula|equation|latex|math|数式|avatar|emoji|reaction|toolbar|icon\b/.test(signature))return false;
  // Explicit conversation-media wrappers/labels take priority over generic size heuristics.
  if(img.closest('.message-image,.image-item,.attachment,[data-attachment]')||/添付画像|generated image|image attachment/.test(signature))return true;
  const w=Number(img.getAttribute('width')||img.getAttribute('data-width')||0);
  const h=Number(img.getAttribute('height')||img.getAttribute('data-height')||0);
  if(w>0&&h>0&&w<=64&&h<=64)return false;
  return true;
}

function collectViewerImages(){
  const a=state.viewerArchive;if(!a)return[];
  const conv=a.conversation||{},path=pathToNode(conv,state.viewerCurrentNode),out=[];
  const stored=Array.isArray(conv.previewImages)?conv.previewImages:[];
  const usedStored=new Set();
  let lastUserText='';
  const takeStored=id=>{
    let rec=stored.find(x=>x?.nodeId===id&&!usedStored.has(x.index));
    if(!rec)rec=stored.find(x=>!x?.nodeId&&!usedStored.has(x.index));
    if(rec)usedStored.add(rec.index);
    return rec||null;
  };
  for(const id of path){
    const n=conv.nodes?.[id];if(!n)continue;
    if(n.role==='user'&&String(n.text||'').trim())lastUserText=String(n.text).trim();
    if(!n.richHtml)continue;
    const doc=new DOMParser().parseFromString(`<div id="r">${n.richHtml}</div>`,'text/html');
    for(const img of doc.querySelectorAll('#r img')){
      if(!isViewerContentImage(img))continue;
      const src=img.getAttribute('src')||img.getAttribute('data-archiver-src')||'';
      if(!src)continue;
      const inline=/^(data:|blob:)/i.test(src);
      const meta=takeStored(id);
      const w=meta?.width||img.getAttribute('width')||img.getAttribute('data-width')||'';
      const h=meta?.height||img.getAttribute('height')||img.getAttribute('data-height')||'';
      const ownText=String(n.text||'').trim();
      const fallback=n.role==='user'?(ownText||'（テキストなし／画像のみのユーザーメッセージ）'):(lastUserText||'（プロンプト情報なし）');
      const prompt=String(meta?.prompt||fallback).trim()||fallback;
      out.push({index:out.length+1,storedIndex:meta?.index||null,nodeId:id,src:inline?src:'',externalUrl:inline?'':src,alt:meta?.alt||img.getAttribute('alt')||'',width:w,height:h,prompt});
    }
  }
  return out;
}

function imageSizeLabel(img){return img.width&&img.height?`${img.width} × ${img.height}`:'size unknown';}
function renderViewerPreview(){
  state.viewerPromptSearchSnapshots=null;state.viewerPromptMatches=[];state.viewerPromptMatchIndex=-1;state.viewerPromptLastSearchQuery='';if($('viewerPromptSearch'))$('viewerPromptSearch').value='';if($('viewerPromptMatchCount'))$('viewerPromptMatchCount').textContent='0 / 0';
  const imgs=state.viewerImages||[];$('viewerImageCount').textContent=`${imgs.length} ${imgs.length===1?'image':'images'}`;
  $('viewerPreviewGrid').classList.toggle('hide-meta',!state.viewerImageMetaVisible);
  $('viewerPreviewGrid').innerHTML=imgs.map(img=>`<article class="viewer-preview-item" data-preview-index="${img.index}"><button class="viewer-preview-number viewer-preview-jump" data-preview-jump="${escapeHtml(img.nodeId)}" aria-label="本文の画像 ${img.index} へ移動">${img.index}</button>${img.src?`<button class="viewer-preview-image-button" data-preview-open="${img.index}" aria-label="画像 ${img.index} を拡大"><img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt)}" data-preview-natural="${img.index}"></button>`:`<span class="viewer-preview-placeholder">External image<br><small>本文から明示的に開けます</small></span>`}<span class="viewer-preview-meta"><span class="viewer-preview-size" data-preview-size="${img.index}">${escapeHtml(imageSizeLabel(img))}</span><span class="viewer-preview-prompt">${escapeHtml(img.prompt)}</span></span></article>`).join('')||'<div class="empty-state">画像はありません。</div>';
  $('viewerImagePromptsPanel').innerHTML=imgs.map(img=>`<div class="viewer-prompt-row"><span class="viewer-preview-number">${img.index}</span><span class="viewer-prompt-size" data-prompt-size="${img.index}">${escapeHtml(imageSizeLabel(img))}</span><span class="viewer-prompt-text">${escapeHtml(img.prompt)}</span></div>`).join('')||'<div class="empty-state">画像プロンプトはありません。</div>';
  $('viewerPreviewGrid').querySelectorAll('img[data-preview-natural]').forEach(el=>{
    const update=()=>{const i=Number(el.dataset.previewNatural),rec=imgs[i-1];if(!rec||!el.naturalWidth||!el.naturalHeight)return;rec.width=String(el.naturalWidth);rec.height=String(el.naturalHeight);const label=imageSizeLabel(rec);document.querySelectorAll(`[data-preview-size="${i}"],[data-prompt-size="${i}"]`).forEach(x=>x.textContent=label);};
    if(el.complete)update();else el.addEventListener('load',update,{once:true});
  });
}
function handleViewerPreviewClick(e){
  const jump=e.target.closest('[data-preview-jump]');
  if(jump){
    const nodeId=jump.dataset.previewJump;if(!nodeId)return;
    closeViewerPreview(false);setViewerLayer('visual',{preservePosition:false});
    requestAnimationFrame(()=>document.querySelector(`[data-node-id="${cssEscape(nodeId)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}));
    return;
  }
  const open=e.target.closest('[data-preview-open]');
  if(open)openViewerImageLightbox(Number(open.dataset.previewOpen));
}
function openViewerImageLightbox(index){
  const rec=(state.viewerImages||[])[index-1];if(!rec?.src)return;
  $('viewerImageLightboxImg').src=rec.src;$('viewerImageLightboxImg').alt=rec.alt||`Image ${index}`;$('viewerImageLightbox').hidden=false;
}
function closeViewerImageLightbox(){
  $('viewerImageLightbox').hidden=true;$('viewerImageLightboxImg').removeAttribute('src');
}
function openViewerPreview(){
  state.viewerTranscriptScrollTop=$('libraryViewer').scrollTop;
  $('viewerPreviewOverlay').hidden=false;$('viewerPreviewOverlay').scrollTop=0;
}
function closeViewerPreview(restore=true){
  closeViewerImageLightbox();
  const overlay=$('viewerPreviewOverlay');if(!overlay)return;overlay.hidden=true;
  if(restore)requestAnimationFrame(()=>$('libraryViewer').scrollTo({top:state.viewerTranscriptScrollTop,behavior:'auto'}));
}
function toggleViewerImageMeta(){
  state.viewerImageMetaVisible=!state.viewerImageMetaVisible;
  $('viewerPreviewGrid').classList.toggle('hide-meta',!state.viewerImageMetaVisible);
}
function toggleViewerImagePrompts(){
  const p=$('viewerImagePromptsPanel');p.hidden=!p.hidden;
  $('viewerImagePromptsBtn').textContent='Image Prompts';
}


function captureViewerPromptSearchSnapshots(){
  if(state.viewerPromptSearchSnapshots)return;
  state.viewerPromptSearchSnapshots=$('viewerImagePromptsPanel').innerHTML;
}
function restoreViewerPromptSearchSnapshots({keep=false}={}){
  const snap=state.viewerPromptSearchSnapshots;if(snap==null)return false;
  $('viewerImagePromptsPanel').innerHTML=snap;
  state.viewerPromptMatches=[];state.viewerPromptMatchIndex=-1;
  if(!keep)state.viewerPromptSearchSnapshots=null;
  return true;
}
function handleViewerPromptSearchInput(){
  const q=String($('viewerPromptSearch').value||'').trim();
  if(!q){restoreViewerPromptSearchSnapshots();state.viewerPromptLastSearchQuery='';state.viewerPromptMatches=[];state.viewerPromptMatchIndex=-1;$('viewerPromptMatchCount').textContent='0 / 0';return;}
  if(!state.viewerPromptLastSearchQuery)captureViewerPromptSearchSnapshots();
  state.viewerPromptLastSearchQuery=q;applyViewerPromptSearch({resetIndex:true});
}
function applyViewerPromptSearch({resetIndex=false}={}){
  const q=String($('viewerPromptSearch').value||'').trim();if(!q){$('viewerPromptMatchCount').textContent='0 / 0';return;}
  captureViewerPromptSearchSnapshots();restoreViewerPromptSearchSnapshots({keep:true});
  const root=$('viewerImagePromptsPanel'),needle=q.toLocaleLowerCase('ja'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node){
    if(!node.nodeValue||!node.parentElement?.closest('.viewer-prompt-text'))return NodeFilter.FILTER_REJECT;
    return node.nodeValue.toLocaleLowerCase('ja').includes(needle)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
  }}),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  state.viewerPromptMatches=[];
  for(const node of nodes){
    const raw=node.nodeValue,low=raw.toLocaleLowerCase('ja');let pos=0,at=low.indexOf(needle,pos);const frag=document.createDocumentFragment();
    while(at>=0){if(at>pos)frag.append(document.createTextNode(raw.slice(pos,at)));const mark=document.createElement('mark');mark.className='viewer-hit viewer-prompt-hit';mark.textContent=raw.slice(at,at+q.length);frag.append(mark);state.viewerPromptMatches.push(mark);pos=at+q.length;at=low.indexOf(needle,pos);}
    if(pos<raw.length)frag.append(document.createTextNode(raw.slice(pos)));node.replaceWith(frag);
  }
  if(resetIndex)state.viewerPromptMatchIndex=-1;
  $('viewerPromptMatchCount').textContent=state.viewerPromptMatchIndex>=0?`${state.viewerPromptMatchIndex+1} / ${state.viewerPromptMatches.length}`:`0 / ${state.viewerPromptMatches.length}`;
}
function moveViewerPromptMatch(delta){
  const q=String($('viewerPromptSearch').value||'').trim();if(!q)return;
  if($('viewerImagePromptsPanel').hidden)$('viewerImagePromptsPanel').hidden=false;
  if(!state.viewerPromptMatches.length)applyViewerPromptSearch({resetIndex:true});
  if(!state.viewerPromptMatches.length)return;
  if(state.viewerPromptMatchIndex<0)state.viewerPromptMatchIndex=delta<0?state.viewerPromptMatches.length-1:0;
  else state.viewerPromptMatchIndex=(state.viewerPromptMatchIndex+delta+state.viewerPromptMatches.length)%state.viewerPromptMatches.length;
  state.viewerPromptMatches.forEach(m=>m.classList.remove('search-current'));
  const mark=state.viewerPromptMatches[state.viewerPromptMatchIndex];if(!mark)return;
  mark.classList.add('search-current');$('viewerPromptMatchCount').textContent=`${state.viewerPromptMatchIndex+1} / ${state.viewerPromptMatches.length}`;
  requestAnimationFrame(()=>mark.scrollIntoView({behavior:'smooth',block:'center'}));
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
  const html=buildV15Html(a.conversation,{status:storedArchiveStatus(a)});
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
