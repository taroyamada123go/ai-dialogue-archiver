import { performance } from 'node:perf_hooks';
import { compareConversations } from '../src/compare.js';
function make(n,edit=-1){const nodes={};for(let i=0;i<n;i++){const body=i===edit?`edited-${i}`:`body-${i}`;nodes['n'+i]={id:'n'+i,parent:i?'n'+(i-1):null,children:i<n-1?['n'+(i+1)]:[],role:i%2?'assistant':'user',text:body,normalizedText:body,normalizedTextHash:body,rawTextHash:body,anchorHash:(i%2?'assistant':'user')+'|'+body};}return{id:null,title:'x',currentNode:'n'+(n-1),nodes};}
const a=make(5000),b=make(5000,2500);const t=performance.now();const r=await compareConversations(a,b);console.log({ms:Math.round(performance.now()-t),agreement:r.sequenceAgreement,edits:r.bestPath.edits.length,label:r.label});
