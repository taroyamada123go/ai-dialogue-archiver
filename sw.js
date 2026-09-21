const CACHE='ai-dialogue-archiver-v0.5.4';
const ASSETS=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./vendor/jszip.min.js','./src/core.js','./src/importers.js','./src/integrity.js','./src/compare.js','./src/storage.js','./src/v15.js','./src/network-policy.js','./icons/icon-180.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  if(url.origin!==location.origin)return;
  e.respondWith((async()=>{
    try{
      const resp=await fetch(e.request,{cache:'no-store'});
      if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
      return resp;
    }catch{
      return (await caches.match(e.request))||(e.request.mode==='navigate'?await caches.match('./index.html'):Response.error());
    }
  })());
});
