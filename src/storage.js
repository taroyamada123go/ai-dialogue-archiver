const DB_NAME='ai-dialogue-archiver'; const DB_VERSION=1; const STORE='projects';
function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
export async function saveProject(project){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(project);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}
export async function listProjects(){const db=await openDb();return new Promise((res,rej)=>{const r=db.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
export async function deleteProject(id){const db=await openDb();return new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error);});}

export async function saveProjectToOpfs(project,sources){
  if(!navigator.storage?.getDirectory) return {available:false,reason:'OPFS is not supported in this context'};
  let persisted=false;
  try{ if(navigator.storage.persist) persisted=await navigator.storage.persist(); }catch{}
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
