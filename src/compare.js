import { normalizeText } from './core.js';

export async function compareConversations(a, b) {
  const graph = compareGraphBodies(a,b);
  const graphCheck = compareGraphStructure(a,b);
  const graphEquivalent = graphCheck.equivalent;
  const graphAmbiguous = graphCheck.ambiguous;
  const aPaths = rankedPaths(a,b,graphEquivalent ? 1 : 24);
  const bPaths = rankedPaths(b,a,graphEquivalent ? 1 : 24);
  const pairCandidates=[];
  for(const ap of aPaths) for(const bp of bPaths) pairCandidates.push({ap,bp,cheap:cheapPathOverlap(ap,bp,a,b)});
  pairCandidates.sort((x,y)=>y.cheap-x.cheap);
  const work = graphEquivalent ? pairCandidates.slice(0,1) : pairCandidates.slice(0,16);
  let best = null;
  for (const {ap,bp} of work) {
    const result = alignPath(ap, bp, a, b);
    if (!best || result.score > best.score) best = result;
  }
  if (!best) best = alignPath([],[],a,b);

  const sameConversationId = Boolean(a.id && b.id && a.id===b.id);
  const titleMatch = normalizeText(a.title) && normalizeText(a.title)===normalizeText(b.title);
  const roleMismatches = best.pairs.filter(([i,j]) => a.nodes[best.aIds[i]]?.role !== b.nodes[best.bIds[j]]?.role).length;
  const evidence = {
    sameConversationId,
    titleMatch,
    exactBodyMatches:graph.exact,
    normalizedBodyMatches:graph.normalized,
    commonAligned:best.matches,
    aAlignedLength:best.aIds.length,
    bAlignedLength:best.bIds.length,
    roleMismatches,
  };
  const denominator = Math.max(1, Math.min(best.aIds.length, best.bIds.length));
  const sequenceAgreement = best.matches / denominator;
  const uniqueCoverage = graph.normalized / Math.max(1, Math.min(Object.keys(a.nodes||{}).length,Object.keys(b.nodes||{}).length));
  const verified = sequenceAgreement === 1 && best.aIds.length===best.bIds.length && best.edits.length===0;
  return {
    evidence,
    sequenceAgreement,
    uniqueCoverage,
    verified,
    graphEquivalent,
    graphAmbiguous,
    graphVerified: graphEquivalent && !graphAmbiguous,
    label: graphEquivalent ? (graphAmbiguous ? 'CROSS-SOURCE: GRAPH MATCH · AMBIGUOUS DUPLICATES' : 'CROSS-SOURCE: GRAPH MATCH') : verified ? 'CROSS-SOURCE: EXACT PATH MATCH' : sequenceAgreement >= 0.95 ? 'CROSS-SOURCE: HIGH MATCH' : sequenceAgreement >= 0.7 ? 'CROSS-SOURCE: PARTIAL MATCH' : 'CROSS-SOURCE: LOW MATCH',
    bestPath: best,
    graph,
    branchSummary: buildBranchSummary(a,b,best),
  };
}

function rankedPaths(conv,target,max){
  const current=currentPath(conv);
  if(max===1 && current.length)return [current];
  const targetHashes=new Set(Object.values(target.nodes||{}).map(n=>n.normalizedTextHash));
  const paths=enumeratePaths(conv,256);
  const scored=paths.map(p=>({p,score:p.reduce((n,id)=>n+(targetHashes.has(conv.nodes[id]?.normalizedTextHash)?1:0),0)})).sort((x,y)=>y.score-x.score || y.p.length-x.p.length);
  const out=[]; const seen=new Set();
  const add=p=>{const k=p.join('\0');if(p.length&&!seen.has(k)){seen.add(k);out.push(p);}};
  add(current); for(const x of scored){if(out.length>=max)break;add(x.p);} return out.length?out:[[]];
}
function currentPath(conv){
  if(!conv.currentNode || !conv.nodes?.[conv.currentNode])return[];
  const out=[],seen=new Set();let id=conv.currentNode;
  while(id && conv.nodes[id] && !seen.has(id)){seen.add(id);out.push(id);id=conv.nodes[id].parent;}
  return out.reverse();
}
function cheapPathOverlap(ap,bp,a,b){
  const counts=new Map();for(const id of bp){const h=b.nodes[id]?.normalizedTextHash;if(h)counts.set(h,(counts.get(h)||0)+1);}let n=0;
  for(const id of ap){const h=a.nodes[id]?.normalizedTextHash,c=counts.get(h)||0;if(c){n++;counts.set(h,c-1);}}return n;
}

export function enumeratePaths(conv, limit=2000) {
  const nodes=conv.nodes||{};
  const roots=Object.values(nodes).filter(n=>n.parent==null).map(n=>n.id);
  const paths=[];
  const stack=roots.map(id=>({id,path:[]}));
  while (stack.length && paths.length<limit) {
    const {id,path}=stack.pop(); const node=nodes[id]; if(!node) continue;
    const next=path.concat(id); const children=(node.children||[]).filter(c=>nodes[c]);
    if (!children.length) paths.push(next);
    else for (let i=children.length-1;i>=0;i--) stack.push({id:children[i],path:next});
  }
  if (!paths.length && Object.keys(nodes).length) paths.push(Object.keys(nodes));
  return paths;
}

function alignPath(aIds,bIds,a,b) {
  const A=aIds.filter(id=>meaningful(a.nodes[id])).map(id=>({id,key:a.nodes[id].normalizedTextHash,role:a.nodes[id].role,text:a.nodes[id].normalizedText}));
  const B=bIds.filter(id=>meaningful(b.nodes[id])).map(id=>({id,key:b.nodes[id].normalizedTextHash,role:b.nodes[id].role,text:b.nodes[id].normalizedText}));
  const pairs=huntPairs(A.map(x=>x.key),B.map(x=>x.key));
  const edits=deriveEdits(A,B,pairs);
  const matches=pairs.length;
  const score=matches*10 - edits.length + (A.length===B.length && matches===A.length ? 1000 : 0);
  return {score,matches,aIds:A.map(x=>x.id),bIds:B.map(x=>x.id),pairs,edits};
}

// Hunt–Szymanski style LCS reconstruction. Message hashes are usually highly
// distinctive, so this avoids the O(n*m) matrix used by a classic LCS DP.
function huntPairs(A,B){
  const pos=new Map();
  for(let j=0;j<B.length;j++){const arr=pos.get(B[j])||[];arr.push(j);pos.set(B[j],arr);}
  for(const arr of pos.values()) arr.reverse();
  const tails=[], tailNode=[], nodes=[];
  for(let i=0;i<A.length;i++){
    const arr=pos.get(A[i]); if(!arr) continue;
    for(const j of arr){
      let lo=0,hi=tails.length;
      while(lo<hi){const mid=(lo+hi)>>1;if(tails[mid]>=j)hi=mid;else lo=mid+1;}
      const k=lo, prev=k>0?tailNode[k-1]:-1;
      const ni=nodes.length;nodes.push({i,j,prev});
      if(k===tails.length){tails.push(j);tailNode.push(ni);}else{tails[k]=j;tailNode[k]=ni;}
    }
  }
  if(!tailNode.length)return[];
  const out=[];let ni=tailNode[tailNode.length-1];
  while(ni>=0){const n=nodes[ni];out.push([n.i,n.j]);ni=n.prev;}
  return out.reverse();
}

function meaningful(n){ return n && ['user','assistant'].includes(n.role) && Boolean(n.normalizedText); }

function deriveEdits(A,B,pairs){
  const edits=[]; let ai=0,bi=0;
  for(const [pa,pb] of [...pairs,[A.length,B.length]]){
    const aSeg=A.slice(ai,pa), bSeg=B.slice(bi,pb);
    if(aSeg.length||bSeg.length){
      if(aSeg.length===1&&bSeg.length===1&&aSeg[0].role===bSeg[0].role){ edits.push({type:'modified',a:aSeg[0],b:bSeg[0],diff:wordDiff(aSeg[0].text,bSeg[0].text)}); }
      else {
        aSeg.forEach(x=>edits.push({type:'removed',a:x}));
        bSeg.forEach(x=>edits.push({type:'added',b:x}));
      }
    }
    ai=pa+1;bi=pb+1;
  }
  return edits;
}

function wordDiff(a,b){
  const A=tokenize(a),B=tokenize(b);
  // Long natural-language messages contain many repeated tokens. For very
  // large inputs use prefix/suffix framing instead of building a huge match set.
  if(A.length+B.length>5000){
    let p=0;while(p<A.length&&p<B.length&&A[p]===B[p])p++;
    let sa=A.length-1,sb=B.length-1;while(sa>=p&&sb>=p&&A[sa]===B[sb]){sa--;sb--;}
    return [
      ...A.slice(0,p).map(v=>({t:'same',v})),
      ...A.slice(p,sa+1).map(v=>({t:'del',v})),
      ...B.slice(p,sb+1).map(v=>({t:'add',v})),
      ...A.slice(sa+1).map(v=>({t:'same',v}))
    ];
  }
  const pairs=huntPairs(A,B),ops=[];let ai=0,bi=0;
  for(const [pa,pb] of [...pairs,[A.length,B.length]]){
    while(ai<pa)ops.push({t:'del',v:A[ai++]});
    while(bi<pb)ops.push({t:'add',v:B[bi++]});
    if(pa<A.length&&pb<B.length){ops.push({t:'same',v:A[pa]});ai=pa+1;bi=pb+1;}
  }
  return ops;
}
function tokenize(s){return String(s).match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)||[];}

function compareGraphBodies(a,b){
  const A=Object.values(a.nodes||{}).filter(meaningful),B=Object.values(b.nodes||{}).filter(meaningful);
  const raw=new Map(),norm=new Map();
  B.forEach(n=>{ raw.set(n.rawTextHash,(raw.get(n.rawTextHash)||0)+1); norm.set(n.normalizedTextHash,(norm.get(n.normalizedTextHash)||0)+1); });
  let exact=0,normalized=0;
  for(const n of A){if((raw.get(n.rawTextHash)||0)>0){exact++;raw.set(n.rawTextHash,raw.get(n.rawTextHash)-1);} if((norm.get(n.normalizedTextHash)||0)>0){normalized++;norm.set(n.normalizedTextHash,norm.get(n.normalizedTextHash)-1);}}
  return {exact,normalized,aNodes:A.length,bNodes:B.length};
}


function compareGraphStructure(a,b){
  const A=graphFingerprint(a),B=graphFingerprint(b);
  return {equivalent:A.nodes===B.nodes && A.edges===B.edges && A.neighborhoods===B.neighborhoods,ambiguous:A.ambiguous>0 || B.ambiguous>0,duplicateNeighborhoods:Math.max(A.ambiguous,B.ambiguous)};
}
function graphFingerprint(conv){
  const nodes=conv.nodes||{};
  const visible=Object.values(nodes).filter(meaningful);
  const nodeTokens=visible.map(n=>n.normalizedTextHash).sort();
  const edgeTokens=[];
  for(const n of visible){
    for(const next of nextVisibleChildren(n.id,nodes)){
      edgeTokens.push(`${n.normalizedTextHash}->${next.normalizedTextHash}`);
    }
  }
  edgeTokens.sort();
  const neighborhoods=visible.map(n=>{
    const p=previousVisibleParent(n.id,nodes);
    const kids=nextVisibleChildren(n.id,nodes).map(x=>x.normalizedTextHash).sort();
    return `${p?.normalizedTextHash||'ROOT'}>${n.normalizedTextHash}>${kids.join(',')}`;
  }).sort();
  const counts=new Map(); neighborhoods.forEach(x=>counts.set(x,(counts.get(x)||0)+1));
  const ambiguous=[...counts.values()].filter(n=>n>1).reduce((a,n)=>a+n,0);
  return {nodes:nodeTokens.join('|'),edges:edgeTokens.join('|'),neighborhoods:neighborhoods.join('|'),ambiguous};
}
function previousVisibleParent(id,nodes){
  const seen=new Set();let pid=nodes[id]?.parent;
  while(pid && nodes[pid] && !seen.has(pid)){seen.add(pid);const p=nodes[pid];if(meaningful(p))return p;pid=p.parent;}
  return null;
}
function nextVisibleChildren(id,nodes){
  const out=[],stack=[...(nodes[id]?.children||[])],seen=new Set();
  while(stack.length){const cid=stack.pop();if(seen.has(cid)||!nodes[cid])continue;seen.add(cid);const c=nodes[cid];if(meaningful(c))out.push(c);else stack.push(...(c.children||[]));}
  return out;
}

function buildBranchSummary(a,b,best){
  const A=new Set(best.aIds),B=new Set(best.bIds);
  return {
    aUnmatchedBranches:Object.values(a.nodes||{}).filter(n=>!A.has(n.id)&&meaningful(n)).map(n=>({id:n.id,role:n.role,text:n.text,parent:n.parent})),
    bUnmatchedBranches:Object.values(b.nodes||{}).filter(n=>!B.has(n.id)&&meaningful(n)).map(n=>({id:n.id,role:n.role,text:n.text,parent:n.parent})),
  };
}
