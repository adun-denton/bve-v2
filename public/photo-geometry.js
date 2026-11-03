// All geometry is relative to the rendered image itself, never the scroll viewport.
export function imagePoint(clientX,clientY,rect){
 if(!(rect.width>0&&rect.height>0))throw Error('Image is not ready');
 return {x:Math.min(1,Math.max(0,(clientX-rect.left)/rect.width)),y:Math.min(1,Math.max(0,(clientY-rect.top)/rect.height))};
}
export function imageRegion(a,b){
 return {space:'normalized-original',x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};
}
