// Shared public handlers. HTTP transport supplies authenticated credentials and bounded JSON.
export function operationUIHandler(kernel,credential,{method,path,query={},input}){
 try{
 if(method==='GET'&&path==='/api/calibration')return kernel.calibration(credential,{action:'view',key:'read-only',input:{productId:query.productId}});
 if(method==='POST'&&path==='/api/calibration')return kernel.calibration(credential,input);
 if(method==='GET'&&path==='/api/content-review')return kernel.contentReview(credential,query);
 if(method==='POST'&&path==='/api/candidate-action-reference')return kernel.candidateActionReference(credential,input);
 if(method==='POST'&&path==='/api/candidate-decision')return kernel.candidateDecide(credential,input);
 if((method==='POST'||method==='GET')&&path==='/api/operation-preparation')return kernel.operationPreparation(credential,method==='GET'?{...query,branded:query.branded==='true',brandTemplateId:query.brandTemplateId||null}:input);
 if(method==='POST'&&path==='/api/operation-request')return kernel.operationRequest(credential,input);
 throw Object.assign(Error('Not found'),{status:404});
 }catch(e){
  if(method==='POST'&&path==='/api/calibration'){try{e.noEffect=kernel.calibrationActionAbsent(credential,input);}catch{}}
  // A refused replay can still have an earlier committed effect. Only the exact
  // authenticated key's receipt absence proves this original action had none.
  if(method==='POST'&&['/api/operation-request','/api/candidate-decision'].includes(path)){
   try{e.noEffect=kernel.operationActionAbsent(credential,path==='/api/operation-request'?'operation.request':'candidate.decide',input?.key);}catch{}
  }
  throw e;
 }
}

export function operationUIFailure(e,path){
 const safe=['REVISION_CONFLICT','INVALID_SCOPE','INVALID_VALUE','INVALID_TYPE','OUT_OF_BOUNDS','UNKNOWN_FIELD','MISSING_SOURCE','INVALID_SELECTION','BRAND_SETUP_NEEDED','EVIDENCE_MISMATCH','IDEMPOTENCY_CONFLICT'];
 const narrow=['/api/calibration','/api/operation-request','/api/candidate-decision'].includes(path);
 return {error:e.code??e.message,...(narrow&&safe.includes(e.code)&&e.noEffect===true?{noEffect:true}:{})};
}
