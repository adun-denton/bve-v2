// Human decisions remain operational records; file-owned product facts are unchanged.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validate} from './contracts/3djat.mjs';
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=x=>createHash('sha256').update(x).digest('hex');
const check=x=>{if(!x)throw Object.assign(Error('CONTENT_EVIDENCE_MISMATCH'),{status:409});};
export const artifactReference=a=>({productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
export const decisionReference=r=>({id:r.decisionId,revision:1,path:'Operational/candidate-decision/'+r.decisionId+'.json',sha256:hash(stable(r)+'\n')});
export function candidateAction(packet){
 const input=structuredClone(packet.input);delete input.humanActionReceipt;
 return {id:input.decisionId,schemaVersion:'bve.candidate-action.v1',principalId:'bve-human',productId:input.productId,
  commandSha256:hash(stable({...packet,input})),recordedAt:input.decidedAt};
}
export const candidateActionReference=packet=>{const a=candidateAction(packet);return {id:a.id,revision:1,path:'Operational/candidate-action/'+a.id+'.json',sha256:hash(stable(a)+'\n')};};
export function verifyContentDecisions(db){
 const size=db.prepare("SELECT count(*) AS n,coalesce(sum(length(CAST(doc AS BLOB))),0) AS bytes,coalesce(max(length(CAST(doc AS BLOB))),0) AS largest FROM records WHERE kind IN ('candidateDecision','candidateAction')").get();
 check(size.bytes<=16*1024**2&&size.largest<=1024**2);
 const rows=db.prepare("SELECT id,doc FROM records WHERE kind='candidateDecision'").all().map(x=>{const row=JSON.parse(x.doc);check(row.id===x.id);return row;}).sort((a,b)=>a.record.artifact.artifactId.localeCompare(b.record.artifact.artifactId)||a.sequence-b.sequence);
 check([...rows].sort((a,b)=>a.order-b.order).every((r,i)=>r.order===i+1));
 const tails=new Map(),actions=db.prepare("SELECT id,doc FROM records WHERE kind='candidateAction'").all();
 check(actions.length===rows.length);
 for(const r of rows){
  const previous=tails.get(r.record.artifact.artifactId);
  check(validate('candidate-decision',r.record).ok&&r.id===r.record.decisionId&&r.projectId===r.record.productId&&r.sequence===(previous?.sequence??0)+1);
  check(isDeepStrictEqual(r.reference,decisionReference(r.record))&&isDeepStrictEqual(r.record.supersedesDecision,previous?.reference??null));
  check(validate('command',r.packet).ok&&r.packet.operation==='candidate.decide'&&isDeepStrictEqual(r.packet.input,r.record)&&r.packet.expected.entityRevision===r.sequence-1);
  check(isDeepStrictEqual(r.record.humanActionReceipt,candidateActionReference(r.packet)));
  const action=actions.find(a=>a.id===r.id);check(action&&isDeepStrictEqual(JSON.parse(action.doc),candidateAction(r.packet)));
  const receipt=db.prepare("SELECT fingerprint,doc FROM receipts WHERE scope='candidate.decide:bve-human' AND key=?").get(r.packet.key);
  check(receipt&&receipt.fingerprint===hash(JSON.stringify(r.packet))&&isDeepStrictEqual(JSON.parse(receipt.doc),{reference:r.reference,sequence:r.sequence,order:r.order}));
  const artifact=db.prepare("SELECT doc FROM records WHERE kind='artifact' AND id=?").get(r.record.artifact.artifactId);
  check(artifact&&isDeepStrictEqual(artifactReference(JSON.parse(artifact.doc)),r.record.artifact));
  tails.set(r.record.artifact.artifactId,r);
 }
 return rows;
}
// Current approval is per exact artifact AND channel. Editing/favorites/legacy acceptance never enter it.
export function deriveContent(artifacts,decisions,jobs,rounds){
 const refs=new Map(artifacts.map(a=>[a.id,a])),latest=new Map();
 for(const d of [...decisions].sort((a,b)=>a.order-b.order))latest.set(d.record.artifact.artifactId+':'+(d.record.channel??''),d);
 const parents=a=>[...(a.sources??[]).map(s=>s.artifact?.artifactId),...(jobs.find(j=>j.id===a.jobId)?.specification.parentArtifacts??[]).map(s=>s.artifactId)].filter(Boolean);
 const descends=(a,id,seen=new Set())=>{if(seen.has(a.id))return false;seen.add(a.id);return parents(a).some(p=>p===id||refs.has(p)&&descends(refs.get(p),id,seen));};
 const approved=[...latest.values()].filter(d=>d.record.action==='approve-output');
 const entries=artifacts.map(a=>{
  const history=decisions.filter(d=>d.record.artifact.artifactId===a.id),editing=latest.get(a.id+':')??null;
  const channels=[...latest.values()].filter(d=>d.record.artifact.artifactId===a.id&&d.record.channel!==null).map(d=>{
   const supersededBy=approved.filter(n=>n.order>d.order&&n.record.channel===d.record.channel&&n.record.artifact.artifactId!==a.id&&descends(refs.get(n.record.artifact.artifactId),a.id)).map(n=>n.record.artifact.artifactId);
   return {channel:d.record.channel,action:d.record.action,decision:d.reference,current:d.record.action==='approve-output'&&!supersededBy.length,supersededBy};
  });
  const job=jobs.find(j=>j.id===a.jobId),round=rounds.find(r=>r.id===job?.roundId);
  return {artifact:a,editing:editing?{action:editing.record.action,decision:editing.reference}:null,channels,history,
   historicalImport:a.origin==='import',parents:parents(a),roundId:round?.id??null,outputRole:job?.specification.output?.role??null};
 });
 return {entries,approved:entries.flatMap(e=>e.channels.filter(c=>c.current).map(c=>({artifact:artifactReference(e.artifact),channel:c.channel,decision:c.decision})))};
}
