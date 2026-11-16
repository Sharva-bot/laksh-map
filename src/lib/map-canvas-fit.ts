import type * as maplibregl from 'maplibre-gl';
type Padding=Required<NonNullable<maplibregl.FitBoundsOptions>['padding']>;
type PaddingInput=number|{top?:number;right?:number;bottom?:number;left?:number}|undefined;

function clampPadding(pad:PaddingInput,m:maplibregl.Map):{top:number;right:number;bottom:number;left:number}{
 const p:Padding=typeof pad==='number'||pad===undefined?{top:pad??0,right:pad??0,bottom:pad??0,left:pad??0}:{top:pad.top??0,right:pad.right??0,bottom:pad.bottom??0,left:pad.left??0};
 const el=m.getContainer(),width=el?.clientWidth??0,height=el?.clientHeight??0;
 if(width<=0||height<=0)return{top:0,right:0,bottom:0,left:0};
 const verticalLimit=height*.6,horizontalLimit=width*.6;
 const vertScale=Math.min(1,verticalLimit/(p.top+p.bottom||1)),horizontalScale=Math.min(1,horizontalLimit/(p.left+p.right||1));
 return{top:p.top*vertScale,right:p.right*horizontalScale,bottom:p.bottom*vertScale,left:p.left*horizontalScale};
}

export function fitBoundsSafe(m:maplibregl.Map,bounds:[[number,number],[number,number]],options:maplibregl.FitBoundsOptions&{padding?:PaddingInput}={}):boolean{
 try{
  const zoom=options.maxZoom!==undefined?Math.min(options.maxZoom,m.getMaxZoom()):undefined;
  m.fitBounds(bounds,{...options,maxZoom:zoom,padding:clampPadding(options.padding,m)});
  return true;
 }catch{
  try{const [[x1,y1],[x2,y2]]=bounds;m.easeTo({center:[(x1+x2)/2,(y1+y2)/2],duration:options.duration??0});}catch{/* ignore */}
  return false;
 }
}

export function flyToSafe(m:maplibregl.Map,options:(maplibregl.FlyToOptions&{padding?:PaddingInput})={}):void{
 try{m.flyTo({...options,padding:clampPadding(options.padding,m)} as maplibregl.FlyToOptions);}
 catch{try{if(options.center)m.easeTo({center:options.center,zoom:Math.min(options.zoom??0,m.getMaxZoom()),duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:300});}catch{/* ignore */}}
}

export function cameraForBoundsSafe(m:maplibregl.Map,bounds:[[number,number],[number,number]],options:maplibregl.CameraForBoundsOptions&{padding?:PaddingInput}={}):ReturnType<maplibregl.Map['cameraForBounds']>|undefined{
 try{
  const el=m.getContainer(),width=el?.clientWidth??0,height=el?.clientHeight??0;
  if(width<=0||height<=0)return undefined;
  return m.cameraForBounds(bounds,{...options,padding:clampPadding(options.padding,m)});
 }catch{
  return undefined;
 }
}
