import {fixture,P} from './3djat/deterministic-fixture.mjs';
import {importPacket,commitPacket,png} from './3djat/import-fixture.mjs';
export function threePhotos(t){
 const w=fixture(t,null,{services:false});
 const stage=importPacket(w,png(),{filename:'third-authored.png',productId:P});
 const staged=w.success(w.k.assetCommand(w.c.human,stage));w.success(w.k.assetCommand(w.c.human,commitPacket(w,staged,stage)));
 const a=w.k.importReview(w.c.human,stage.input.importId).artifact;
 w.photos=[...w.originals.map(s=>s.artifact),{productId:P,artifactId:a.id,version:a.version,sha256:a.sha256,width:a.width,height:a.height}];
 return w;
}
