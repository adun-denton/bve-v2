// Bounded calibration helpers; SQLite and the existing domain writer remain authority.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {validate} from './contracts/3djat.mjs';
export const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
export const digest=v=>createHash('sha256').update(stable(v)).digest('hex');
export const ref=(kind,row,revision=1)=>({id:row.id,revision,path:`Operational/${kind}/${row.id}/${revision}.json`,sha256:digest(row)});
export const artifact=a=>({productId:a.projectId,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height});
export function check(ok,code='EVIDENCE_MISMATCH'){if(!ok)throw Object.assign(Error(code),{code,status:409});}
export function shape(kind,row){const v=validate(kind,row);check(v.ok,v.errors[0]?.code);return row;}
export function fields(row,keys){check(row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).length===keys.length&&keys.every(k=>Object.hasOwn(row,k)),'INVALID_VALUE');}
export function words(s,max=20000){check(typeof s==='string'&&s.trim()&&s.length<=max,'INVALID_VALUE');return s;}
export const same=isDeepStrictEqual;
// Full expected pre-commission specification; subsequent kernel-owned fields are checked separately.
export function specifications(plan){return plan.templates.map((t,n)=>({
 directionId:'calibration-'+n,label:t.record.title+' · revision '+t.reference.revision,
 difference:plan.record.changedDimension+' · '+n,
 prompt:plan.record.commonIntent+'\nVariant '+n+': '+t.record.instructions,
 brief:plan.record.commonIntent,output:{format:'image/png',role:'candidate'},
 sources:plan.sources.map(s=>({...s.artifact,role:s.role,regions:s.regions})),attachments:[],parentArtifacts:[],parentRoundId:null,
 preferences:[],hardLimits:{maxBytes:24*1024*1024,maxPixels:16000000},
 calibration:{experimentId:plan.id,planSha256:digest(plan),variant:t.reference,
 settings:plan.record.commonSettings,seed:plan.record.seed,executorId:plan.record.executorId,executorVersion:plan.record.executorVersion,
 operation:plan.preparation.operation.reference,brand:plan.preparation.brand?.reference??null,product:plan.preparation.product.reference,applicability:plan.scope}
}));}
export function frozenSpecification(plan,job,index){
 const expected=specifications(plan)[index],s=job.specification;
 for(const [k,v] of Object.entries(expected))if(k!=='sources')check(same(s[k],v));
 check(same(s.sources.map(x=>({artifactId:x.artifactId,version:x.version,sha256:x.sha256,width:x.width,height:x.height,role:x.role,regions:x.regions})),
 plan.sources.map(x=>({artifactId:x.artifact.artifactId,version:x.artifact.version,sha256:x.artifact.sha256,width:x.artifact.width,height:x.artifact.height,role:x.role,regions:x.regions}))));
 check(s.direction==='Fresh'&&s.brand===(plan.preparation.brand?.record.instructions??null)&&same(s.allowance,{primaryAttempts:1,maxRetries:0}));
}
