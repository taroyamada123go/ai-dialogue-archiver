const DB_NAME='ai-dialogue-archiver';
const DB_VERSION=2;
const PROJECTS='projects';
const ARCHIVES='archives';

function openDb(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS,{keyPath:'id'});
      if(!db.objectStoreNames.contains(ARCHIVES)) db.createObjectStore(ARCHIVES,{keyPath:'id'});
    };
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}

function txRequest(store,mode,fn){
  return openDb().then(db=>new Promise((res,rej)=>{
    const tx=db.transaction(store,mode);
    const os=tx.objectStore(store);
    let result;
    try{result=fn(os);}catch(e){rej(e);return;}
    tx.oncomplete=()=>res(result?.result);
    tx.onerror=()=>rej(tx.error||result?.error);
    tx.onabort=()=>rej(tx.error||new Error('IndexedDB transaction aborted'));
  }));
}

export async function saveProject(project){return txRequest(PROJECTS,'readwrite',s=>s.put(project));}
export async function listProjects(){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(PROJECTS).objectStore(PROJECTS).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
export async function deleteProject(id){return txRequest(PROJECTS,'readwrite',s=>s.delete(id));}

export async function saveArchive(archive){return txRequest(ARCHIVES,'readwrite',s=>s.put(archive));}
export async function getArchive(id){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(ARCHIVES).objectStore(ARCHIVES).get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
export async function listArchives(){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(ARCHIVES).objectStore(ARCHIVES).getAll();r.onsuccess=()=>res((r.result||[]).sort((a,b)=>String(b.updatedAt||b.savedAt||'').localeCompare(String(a.updatedAt||a.savedAt||''))));r.onerror=()=>rej(r.error);});}
export async function deleteArchive(id){return txRequest(ARCHIVES,'readwrite',s=>s.delete(id));}

export async function requestPersistentStorage(){
  let persisted=false;
  try{
    if(navigator.storage?.persisted && await navigator.storage.persisted()) return true;
    if(navigator.storage?.persist) persisted=await navigator.storage.persist();
  }catch{}
  return persisted;
}

export async function saveArchiveOriginalToOpfs(archiveId,sourceFile,sourceName){
  if(!sourceFile || !navigator.storage?.getDirectory) return {available:false};
  await requestPersistentStorage();
  const root=await navigator.storage.getDirectory();
  const base=await root.getDirectoryHandle('ai-dialogue-archiver',{create:true});
  const archives=await base.getDirectoryHandle('archives',{create:true});
  const dir=await archives.getDirectoryHandle(archiveId,{create:true});
  const originals=await dir.getDirectoryHandle('originals',{create:true});
  const name=sanitize(sourceName||sourceFile.name||'source');
  const handle=await originals.getFileHandle(name,{create:true});
  const writable=await handle.createWritable();
  await writable.write(sourceFile);
  await writable.close();
  return {available:true,path:`archives/${archiveId}/originals/${name}`};
}

export async function saveProjectToOpfs(project,sources){
  if(!navigator.storage?.getDirectory) return {available:false,reason:'OPFS is not supported in this context'};
  const persisted=await requestPersistentStorage();
  const root=await navigator.storage.getDirectory();
  const base=await root.getDirectoryHandle('ai-dialogue-archiver',{create:true});
  const dir=await base.getDirectoryHandle(project.id,{create:true});
  const originals=await dir.getDirectoryHandle('originals',{create:true});
  const saved=[];
  for(let i=0;i<sources.length;i++){
    const s=sources[i]; if(!s.sourceFile) continue;
    const name=`${String(i+1).padStart(3,'0')}-${sanitize(s.name)}`;
    const handle=await originals.getFileHandle(name,{create:true});
    const writable=await handle.createWritable();
    await writable.write(s.sourceFile); await writable.close(); saved.push(`originals/${name}`);
  }
  await writeText(dir,'normalized-project.json',JSON.stringify(project,null,2));
  const manifest={id:project.id,createdAt:project.createdAt,version:project.version,files:saved,sources:project.sources.map(s=>({name:s.name,sha256:s.rawFileHash,size:s.rawSize}))};
  await writeText(dir,'manifest.json',JSON.stringify(manifest,null,2));
  let estimate=null;try{estimate=await navigator.storage.estimate();}catch{}
  return {available:true,persisted,files:saved,estimate};
}

async function writeText(dir,name,text){const h=await dir.getFileHandle(name,{create:true});const w=await h.createWritable();await w.write(text);await w.close();}
function sanitize(s){return String(s||'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,120);}
