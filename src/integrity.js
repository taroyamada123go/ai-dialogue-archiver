import { canonicalize, sha256 } from './core.js';

export async function inspectConversation(conv) {
  const nodes = conv.nodes || {};
  const list = Object.values(nodes);
  const issues = [];
  const stats = {
    nodes:list.length, messages:list.filter(n=>n.raw?.message || conv.sourceFormat==='html-capture').length,
    user:list.filter(n=>n.role==='user').length,
    assistant:list.filter(n=>n.role==='assistant').length,
    system:list.filter(n=>n.role==='system').length,
    tool:list.filter(n=>n.role==='tool').length,
    roots:0, leaves:0, branchPoints:0, references:0, missingAssetRefs:0, logicalAssetRefs:0,
  };

  const msgIds = new Map();
  for (const n of list) {
    if (n.mappingKey && n.mappingKey !== n.id) issues.push(issue('warning','NODE_KEY_MISMATCH',n.id,`mapping key (${n.mappingKey}) と node.id (${n.id}) が異なります。`));
    if (n.messageId) {
      const arr=msgIds.get(n.messageId)||[]; arr.push(n.id); msgIds.set(n.messageId,arr);
    }
    if (n.parent == null) stats.roots++;
    else if (!nodes[n.parent]) issues.push(issue('error','MISSING_PARENT',n.id,`親ノード ${n.parent} が存在しません。`));
    const childSet = new Set();
    for (const c of n.children || []) {
      if (childSet.has(c)) issues.push(issue('warning','DUPLICATE_CHILD',n.id,`children に ${c} が重複しています。`));
      childSet.add(c);
      if (!nodes[c]) issues.push(issue('error','MISSING_CHILD',n.id,`子ノード ${c} が存在しません。`));
      else if (nodes[c].parent !== n.id) issues.push(issue('error','NON_RECIPROCAL_EDGE',n.id,`${c} の parent が ${n.id} ではありません。`));
    }
    if (!(n.children || []).length) stats.leaves++;
    if ((n.children || []).length > 1) stats.branchPoints++;
    for (const r of n.references || []) {
      stats.references++;
      if (r.resolved==='missing') { stats.missingAssetRefs++; issues.push(issue('error','MISSING_ASSET',n.id,`参照 ${r.value} に対応するファイルがZIP内で見つかりません。`)); }
      if (r.resolved==='logical') stats.logicalAssetRefs++;
    }
  }
  for (const [mid, ids] of msgIds) if (ids.length>1) issues.push(issue('error','DUPLICATE_MESSAGE_ID',ids[0],`message.id ${mid} が ${ids.length} 回出現します。`));
  if (!list.length) issues.push(issue('error','NO_NODES',null,'会話ノードがありません。'));
  if (stats.roots===0 && list.length) issues.push(issue('error','NO_ROOT',null,'ルートノードがありません。'));
  if (stats.roots>1) issues.push(issue('warning','MULTIPLE_ROOTS',null,`ルートが ${stats.roots} 個あります。枝分かれ以外の複数ルートか確認してください。`));
  if (conv.currentNode && !nodes[conv.currentNode]) issues.push(issue('error','MISSING_CURRENT_NODE',null,`current_node ${conv.currentNode} が存在しません。`));

  const cycleNodes = detectCycles(nodes);
  for (const id of cycleNodes) issues.push(issue('error','CYCLE',id,'親子関係に循環があります。'));

  const reachable = new Set();
  const stack = Object.values(nodes).filter(n=>n.parent==null).map(n=>n.id);
  while (stack.length) {
    const id=stack.pop(); if (reachable.has(id) || !nodes[id]) continue;
    reachable.add(id); stack.push(...(nodes[id].children||[]));
  }
  for (const n of list) if (!reachable.has(n.id)) issues.push(issue('error','UNREACHABLE_NODE',n.id,'どのルートからも到達できません。'));

  const errors = issues.filter(i=>i.severity==='error').length;
  const warnings = issues.filter(i=>i.severity==='warning').length;
  const canonical = canonicalConversation(conv);
  const graphHash = await sha256(canonical);
  return {
    level: errors ? 'fail' : warnings ? 'pass-with-warnings' : 'pass',
    label: errors ? 'INTERNAL INTEGRITY: FAIL' : warnings ? 'INTERNAL INTEGRITY: PASS WITH WARNINGS' : 'INTERNAL INTEGRITY: PASS',
    errors, warnings, stats, issues, graphHash,
  };
}

function issue(severity, code, nodeId, message) { return {severity, code, nodeId, message}; }

function detectCycles(nodes) {
  const visiting=new Set(), visited=new Set(), cycles=new Set();
  function dfs(id) {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (visited.has(id) || !nodes[id]) return;
    visiting.add(id);
    for (const c of nodes[id].children || []) dfs(c);
    visiting.delete(id); visited.add(id);
  }
  Object.keys(nodes).forEach(dfs);
  return cycles;
}

function canonicalConversation(conv) {
  const nodeList = Object.values(conv.nodes||{}).map(n=>(
    {id:n.id,parent:n.parent,children:[...(n.children||[])].sort(),role:n.role,text:n.text,messageId:n.messageId,contentType:n.contentType}
  )).sort((a,b)=>a.id.localeCompare(b.id));
  return canonicalize({id:conv.id,title:conv.title,currentNode:conv.currentNode,nodes:nodeList});
}

export async function inspectSource(source, onProgress=()=>{}) {
  const results=[];
  for (let i=0;i<source.conversations.length;i++) {
    onProgress({current:i+1,total:source.conversations.length,title:source.conversations[i].title});
    results.push(await inspectConversation(source.conversations[i]));
  }
  return results;
}
