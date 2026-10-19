// Candidate ceiling is opt-in private runtime metadata, never a request permission.
export const PNG_PIXELS = 16_000_000;
export const IMG20_PIXELS = 20_000_000;
export const IMG20_FEATURES = Object.freeze(['historical-import.v1','png20-experiment.v1']);
export function knownImageMarker(m) {
  return m?.format==='bve-v2' && (m.version===1 ||
    m.version===2 && JSON.stringify(m.features)==='["historical-import.v1"]' ||
    m.version===3 && JSON.stringify(m.features)===JSON.stringify(IMG20_FEATURES));
}
export function databasePixelLimit(db) {
  const row=db.prepare("SELECT doc FROM records WHERE kind='pngExperimentFormat' AND id='active'").get();
  if(!row)return PNG_PIXELS;
  const v=JSON.parse(row.doc);
  if(v.schemaVersion!=='bve.png20-experiment.v1'||v.version!==1||v.maxPixels!==IMG20_PIXELS)
    throw Object.assign(new Error('UNSUPPORTED_SCHEMA'),{code:'UNSUPPORTED_SCHEMA'});
  return IMG20_PIXELS;
}
