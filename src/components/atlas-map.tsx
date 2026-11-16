'use client';
import {useEffect,useRef,useState} from 'react';
import 'leaflet/dist/leaflet.css';
import type * as maplibregl from 'maplibre-gl';
import type {Work} from '@/lib/model';
import type {AssetDetail} from '@/lib/asset-geography';
import type {FundingOverview} from '@/lib/funding';
import type {MapPreview} from './asset-visual';

export type MapAction={sequence:number;type:'in'|'out'|'north'|'india'|'terrain'|'satellite'|'streets'|'day'|'dusk'|'night'|'perspective'}|{sequence:number;type:'focus';center:[number,number];zoom:number};

const INDIA:[number,number][]=[[6.5,67.8],[37.2,97.5]];
const PALETTE:{key:string;color:string}[]=[{key:'public',color:'#4c8dff'},{key:'road',color:'#f0a35e'},{key:'education',color:'#b58cff'},{key:'health',color:'#ff6b81'},{key:'agriculture',color:'#7ad37a'}];
const DENSITY_CELLS=[512,1024,2048,4096];
function densityCells(zoom:number){return zoom<=4?DENSITY_CELLS[0]:zoom<=6?DENSITY_CELLS[1]:zoom<=8?DENSITY_CELLS[2]:DENSITY_CELLS[3];}
function kindColor(kind:unknown){return PALETTE.find(entry=>entry.key===kind)?.color??'#4c8dff';}
const CATEGORY_META:[string,string,string][]=[['all','All works','#94a3b8'],['road','Roads','#f0a35e'],['water','Water','#4c8dff'],['sanitation','Sanitation','#63d3c4'],['housing','Housing','#c084fc'],['education','Education','#b58cff'],['health','Health','#ff6b81'],['agriculture','Agriculture','#7ad37a'],['community','Community','#f5c542'],['other','Other','#94a3b8']];
const CATEGORY_LABEL=new Map(CATEGORY_META.map(([key,label])=>[key,label]));
function categoryColor(category:unknown){return CATEGORY_META.find(([key])=>key===category)?.[2]??'#4c8dff';}

type Leaflet=typeof import('leaflet');
type LeafletMap=import('leaflet').Map;

function ageText(since:string|null|undefined){
 const start=since?new Date(since):null;
 if(!start||Number.isNaN(start.getTime()))return 'Age not known';
 const ms=Math.max(0,Date.now()-start.getTime());
 const days=Math.floor(ms/86400000);
 const years=Math.floor(days/365.25);
 const remDays=Math.floor(days-years*365.25);
 const hours=Math.floor((ms%86400000)/3600000);
 const minutes=Math.floor((ms%3600000)/60000);
 const seconds=Math.floor((ms%60000)/1000);
 const clock=`${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
 return years>0?`${years}y ${remDays}d ${clock}`:`${days}d ${clock}`;
}
function voterToken(){
 try{
  const key='hisaab:voter-token';
  const existing=localStorage.getItem(key);
  if(existing)return existing;
  const next=typeof crypto!=='undefined'&&'randomUUID' in crypto?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36);
  localStorage.setItem(key,next);
  return next;
 }catch{
  return Math.random().toString(36).slice(2)+Date.now().toString(36);
 }
}
function voteLabel(button:HTMLButtonElement,count:number){button.textContent=`${button.dataset.label??'Vote'} (${Number.isFinite(count)?count:0})`;}
function developmentPopup(row:Record<string,unknown>,L:Leaflet){
 const box=document.createElement('div');box.className='dev-popup';
 const title=document.createElement('strong');title.className='dev-title';title.textContent=String(row.title||'Development record');
 box.append(title);
 const meta=document.createElement('p');meta.className='dev-meta';
 const scheme=row.scheme?String(row.scheme):'Scheme not published';
 const district=row.district?String(row.district):'District not published';
 meta.textContent=scheme+' | '+district;box.append(meta);
 const photoWrap=document.createElement('div');photoWrap.className='dev-photo-wrap';
 const photo=typeof row.photo_url==='string'?row.photo_url:'';
 if(photo){
  const image=document.createElement('img');image.className='dev-photo';image.src=photo;image.alt='Government photo of this work';image.loading='lazy';image.referrerPolicy='no-referrer';
  image.onerror=()=>{image.remove();const missing=document.createElement('div');missing.className='dev-photo-missing';missing.textContent='Photo link is broken. The source record is kept.';photoWrap.append(missing);box.classList.add('dev-yellow');};
  photoWrap.append(image);
 }else{
  const missing=document.createElement('div');missing.className='dev-photo-missing';missing.textContent='No photo published for this record.';photoWrap.append(missing);
 }
 const second=typeof row.photo_url_2==='string'?row.photo_url_2:'';
 if(second){const link=document.createElement('a');link.className='dev-photo-link';link.href=second;link.target='_blank';link.rel='noreferrer';link.textContent='Second photo';photoWrap.append(link);}
 box.append(photoWrap);
 const amount=Number(row.allocated);
 const facts=document.createElement('div');facts.className='dev-facts';
 const money=document.createElement('p');money.textContent='Budget allocated: '+(Number.isFinite(amount)&&amount>0?'Rs '+amount.toLocaleString('en-IN'):'not published in this source');facts.append(money);
 const since=(typeof row.problem_since==='string'&&row.problem_since)||(typeof row.date==='string'&&row.date)||'';
 if(typeof row.date==='string'&&row.date){const recorded=document.createElement('p');recorded.textContent='Recorded on: '+row.date;facts.append(recorded);}
 if(since){const age=document.createElement('p');age.className='dev-age';age.dataset.since=since;age.textContent='Time since recorded: '+ageText(since);facts.append(age);}
 const reported=row.reported_year?String(row.reported_year):'';
 if(reported){const year=document.createElement('p');year.textContent='Work year: '+reported;facts.append(year);}
 const category=row.category?CATEGORY_LABEL.get(String(row.category)):null;
 if(category){const line=document.createElement('p');line.textContent='Work category: '+category;facts.append(line);}
 const partyLine=row.party&&String(row.party)!=='Not known'?String(row.party):'not in this work record';
 const party=document.createElement('p');party.textContent='Political party: '+partyLine;facts.append(party);
 const mlaLine=row.mla&&String(row.mla)!=='Not known'?String(row.mla):'not in this work record';
 const mla=document.createElement('p');mla.textContent='MLA: '+mlaLine;facts.append(mla);
 const pmgsy=String(row.scheme||'')==='PMGSY';
 for(const [label,value] of [['Block',row.block],[pmgsy?'Habitation':'Gram panchayat',row.gram_panchayat],[pmgsy?'Facility type':'Work type',row.work_type],['Address',pmgsy?row.address:null]] as const){
  if(value){const line=document.createElement('p');line.textContent=label+': '+String(value);facts.append(line);}
 }
 box.append(facts);
 if(row.id){
  const votes=document.createElement('div');votes.className='dev-votes';
  const yes=document.createElement('button');yes.type='button';yes.className='dev-vote';yes.dataset.label='Working';voteLabel(yes,Number(row.votes_true)||0);
  const no=document.createElement('button');no.type='button';no.className='dev-vote';no.dataset.label='Not working';voteLabel(no,Number(row.votes_false)||0);
  const note=document.createElement('span');note.className='dev-vote-note';
  const send=async(vote:boolean)=>{
   yes.disabled=true;no.disabled=true;note.textContent='Saving...';
   try{
    const response=await fetch('/api/v1/development/vote',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id,vote,token:voterToken()})});
    const payload=await response.json().catch(()=>({})) as {votes_true?:number;votes_false?:number;error?:string};
    if(!response.ok)throw new Error(payload.error||'Vote not saved');
    voteLabel(yes,Number(payload.votes_true)||0);voteLabel(no,Number(payload.votes_false)||0);
    note.textContent='Vote recorded. One vote per browser.';
   }catch(error){note.textContent=error instanceof Error?error.message:'Vote not saved';}
   finally{yes.disabled=false;no.disabled=false;}
  };
  yes.onclick=()=>void send(true);no.onclick=()=>void send(false);
  votes.append(yes,no,note);box.append(votes);
 }else{
  const note=document.createElement('p');note.className='dev-vote-note';note.textContent='Community votes open after this record is published to the shared database.';box.append(note);
 }
 if(row.source_link){const source=document.createElement('a');source.className='dev-source';source.href=String(row.source_link);source.target='_blank';source.rel='noreferrer';source.textContent=pmgsy?'Open source dataset':'Open government record';box.append(source);}
 const credit=document.createElement('p');credit.className='dev-credit';credit.textContent=row.credits?String(row.credits):'GODL-India';box.append(credit);
 return box;
}

export function AtlasMap({exploring,states,state,year,purpose,query,layers,workCategory,workAge,onWorkCategory,onWorkAge,onState,onAsset,onWork,onExplore,onViewport,action,asset,work,locationSelected=false,theme='dark',onPreview,onMapReady,onProjectStatus,onAssetStatus,cameraControlled=false,contentMode=false,contentFrame='screen',dataReady=true}:{exploring:boolean;states:FundingOverview['states'];state:string|null;year:string;purpose:string;query:string;layers:{funding:boolean;projects:boolean;historical:boolean};workCategory:string;workAge:number|null;onWorkCategory:(category:string)=>void;onWorkAge:(age:number|null)=>void;onState:(code:string)=>void;onAsset:(asset:AssetDetail)=>void;onWork:(work:Work)=>void;onExplore:()=>void;onViewport:(bounds:number[])=>void;action:MapAction|null;asset:AssetDetail|null;work:Work|null;locationSelected?:boolean;theme?:'light'|'dark';onPreview:(p:MapPreview|null)=>void;onMapReady?:(m:maplibregl.Map|null)=>void;onProjectStatus?:(status:string)=>void;onAssetStatus?:(status:string)=>void;cameraControlled?:boolean;contentMode?:boolean;contentFrame?:string;dataReady?:boolean}) {
 const node=useRef<HTMLDivElement>(null);
 const map=useRef<LeafletMap|null>(null);
 const leaflet=useRef<Leaflet|null>(null);
 const [ready,setReady]=useState(false);
 const [error,setError]=useState('');
 const [viewport,setViewport]=useState<[number,number,number,number]|null>(null);
 const devLayer=useRef<import('leaflet').LayerGroup|null>(null);
 const devMarkers=useRef<Map<string,import('leaflet').CircleMarker>>(new Map());
 const callbacks=useRef({onExplore,onWork,onViewport,onState});
 callbacks.current={onExplore,onWork,onViewport,onState};
 const notify=useRef(onMapReady);notify.current=onMapReady;
 const report=useRef(onProjectStatus);report.current=onProjectStatus;
 const activeWork=useRef(work);activeWork.current=work;
 const activeAsset=useRef(asset);activeAsset.current=asset;

 useEffect(()=>{
  let disposed=false;
  void import('leaflet').then(module=>{
   if(disposed||!node.current)return;
   const L=module.default;
   leaflet.current=L;
   const instance=L.map(node.current,{center:[22,80],zoom:4,minZoom:3,maxZoom:16,zoomControl:true,attributionControl:true,worldCopyJump:false,maxBounds:[[-15,40],[60,130]],maxBoundsViscosity:1,preferCanvas:true,fadeAnimation:false,markerZoomAnimation:false});
   instance.attributionControl.setPrefix('');
   instance.getContainer().style.background='#0b1a14';
   L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',{maxZoom:16,attribution:'Tiles &copy; Esri'}).addTo(instance);
   const sync=()=>{
    if(!instance)return;
    const b=instance.getBounds();
    const next:[number,number,number,number]=[b.getWest(),b.getSouth(),b.getEast(),b.getNorth()];
    setViewport(next);callbacks.current.onViewport(next);
    if(instance.getZoom()>=6)callbacks.current.onExplore();
   };
   instance.on('moveend',sync);
   instance.fitBounds(INDIA,{padding:[20,20],animate:false});
   map.current=instance;setReady(true);sync();
   notify.current?.(instance as unknown as maplibregl.Map);
  }).catch(()=>{if(!disposed)setError('The map could not start. The evidence lists remain available.');});
  return ()=>{disposed=true;notify.current?.(null);map.current?.remove();map.current=null;};
 },[]);

 useEffect(()=>{
  const instance=map.current;if(!instance||!action)return;
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:.4;
  if(action.type==='in')instance.zoomIn(1,{animate:duration>0});
  else if(action.type==='out')instance.zoomOut(1,{animate:duration>0});
  else if(action.type==='india')instance.flyToBounds(INDIA,{padding:[20,20],duration});
  else if(action.type==='focus')instance.flyTo(action.center,action.zoom,{duration});
  else if(action.type==='north'||action.type==='perspective')instance.flyTo(instance.getCenter(),instance.getZoom(),{duration});
 },[action,ready]);

 useEffect(()=>{
  const instance=map.current;const L=leaflet.current;
  if(!instance||!L||!ready||!viewport)return;
  const controller=new AbortController();
  const timer=window.setTimeout(()=>{
   const zoom=Math.round(instance.getZoom());
   const mode=zoom>=10?'points':'clusters';
    const params=new URLSearchParams({mode,bbox:viewport.join(','),zoom:String(zoom),year});
    if(workCategory!=='all')params.set('category',workCategory);
    if(workAge)params.set('age',String(workAge));
   const load=async()=>{
    const response=await fetch('/api/v1/development?'+params,{signal:controller.signal});
    if(!response.ok)return;
    const payload=await response.json();
    const rows:Record<string,unknown>[]=Array.isArray(payload?.data)?payload.data:[];
    if(controller.signal.aborted)return;
    const layer=devLayer.current??L.layerGroup().addTo(instance);
    devLayer.current=layer;
    const seen=new Set<string>();
    if(mode==='clusters'){
     for(const row of rows){
      const lat=Number(row.lat),lng=Number(row.lng),count=Number(row.total)||0;
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)continue;
      const key='c:'+lat.toFixed(5)+':'+lng.toFixed(5);
      const radius=Math.max(6,Math.min(26,5+Math.log10(count+1)*6));
      const color=categoryColor(row.category);
      const existing=devMarkers.current.get(key);
      if(existing){
       existing.setLatLng([lat,lng]);
       existing.setRadius(radius);
       existing.setStyle({fillColor:color});
      }else{
       const marker=L.circleMarker([lat,lng],{radius,color:'#0b1a14',weight:1,fillColor:color,fillOpacity:.78});
       const box=document.createElement('div');box.className='dev-popup';
       const title=document.createElement('strong');title.className='dev-title';title.textContent=count.toLocaleString('en-IN')+' real works here';
       const meta=document.createElement('p');meta.className='dev-meta';meta.textContent=CATEGORY_LABEL.get(String(row.category))??'Development works';
       box.append(title,meta);
       const amount=Number(row.amount_total);
       if(Number.isFinite(amount)&&amount>0){const fact=document.createElement('p');fact.textContent='Published allocation: Rs '+amount.toLocaleString('en-IN');box.append(fact);}
       const samples=Array.isArray(row.samples)?row.samples as {title?:string;date?:string|null}[]:[];
       if(samples.length){
        const lead=document.createElement('p');lead.textContent='Sample records:';box.append(lead);
        const list=document.createElement('ul');list.style.margin='2px 0 7px';list.style.paddingLeft='14px';
        for(const sample of samples){const item=document.createElement('li');item.textContent=String(sample.title||'Work record')+(sample.date?' ('+sample.date+')':'');list.append(item);}
        box.append(list);
       }
       const zoomButton=document.createElement('button');zoomButton.type='button';zoomButton.className='dev-vote';zoomButton.textContent='Zoom to these works';
       zoomButton.onclick=()=>{marker.closePopup();instance.flyTo([lat,lng],Math.min(14,instance.getZoom()+2),{duration:.45});};
       box.append(zoomButton);
       marker.bindPopup(box,{maxWidth:300,minWidth:230});
       layer.addLayer(marker);devMarkers.current.set(key,marker);
      }
      seen.add(key);
     }
    }else{
     for(const row of rows){
      const lat=Number(row.lat),lng=Number(row.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)continue;
      const key='p:'+lat.toFixed(6)+':'+lng.toFixed(6)+':'+String(row.title??'');
      const fill=row.flagged_yellow?'#f5c542':categoryColor(row.category);
      const existing=devMarkers.current.get(key);
      if(existing){
       existing.setLatLng([lat,lng]);
       existing.setStyle({fillColor:fill});
      }else{
       const marker=L.circleMarker([lat,lng],{radius:6,color:'#ffffff',weight:1,fillColor:fill,fillOpacity:.9});
       const box=developmentPopup(row,L);
       const timerRef:{value:number|null}={value:null};
       marker.bindPopup(box,{maxWidth:380,minWidth:300});
       marker.on('popupopen',()=>{
        const age=box.querySelector<HTMLElement>('.dev-age');
        if(!age?.dataset.since)return;
        const tick=()=>{age.textContent='Time since recorded: '+ageText(age.dataset.since);};
        if(timerRef.value)window.clearInterval(timerRef.value);
        tick();timerRef.value=window.setInterval(tick,1000);
       });
       marker.on('popupclose',()=>{if(timerRef.value){window.clearInterval(timerRef.value);timerRef.value=null;}});
       layer.addLayer(marker);devMarkers.current.set(key,marker);
      }
      seen.add(key);
     }
    }
    for(const [key,marker] of devMarkers.current){
     if(seen.has(key))continue;
     layer.removeLayer(marker);devMarkers.current.delete(key);
    }
    const total=Number(payload?.total);
    if(rows.length){
     report.current?.(mode==='clusters'
      ?rows.length+' development clusters, '+(Number.isFinite(total)?total.toLocaleString('en-IN'):'?')+' works in view'
      :rows.length+' development records in view');
    }
   };
   void load().catch(e=>{if(e.name!=='AbortError')report.current?.(e.message);});
  },220);
  return ()=>{window.clearTimeout(timer);controller.abort();};
 },[ready,year,viewport,workCategory,workAge]);

 useEffect(()=>()=>{devMarkers.current.clear();devLayer.current?.remove();devLayer.current=null;},[]);



 useEffect(()=>{
  const instance=map.current;const L=leaflet.current;
  if(!instance||!L||!ready||!layers.historical)return;
  let disposed=false,currentLevel=-1,request=0;
  const cache=new Map<number,{geometry?:{coordinates?:number[]};properties?:Record<string,unknown>}[]>();
  let group=L.layerGroup().addTo(instance);
  const draw=async(force=false)=>{
   const level=densityCells(instance.getZoom());
   if(level===currentLevel&&!force)return;
   const version=++request;
   let rows=cache.get(level);
   if(!rows){
    try{
     const response=await fetch(`/geography/locations/density/${level}.geojson`,{cache:'force-cache'});
     if(!response.ok)return;
     const loaded:{geometry?:{coordinates?:number[]};properties?:Record<string,unknown>}[]=(await response.json()).features??[];
     cache.set(level,loaded);rows=loaded;
    }catch{return;}
   }
   if(!rows||disposed||version!==request)return;
   const bounds=instance.getBounds().pad(0.4),next=L.layerGroup(),radius=Math.max(1.7,3.4-Math.log2(level/512)*0.45);
   for(const feature of rows){
    const [lng,lat]=feature.geometry?.coordinates??[];
    if(!Number.isFinite(lng)||!Number.isFinite(lat)||!bounds.contains([lat,lng]))continue;
    const properties=feature.properties??{},count=Number(properties.count)||1;
    const dot=L.circleMarker([lat,lng],{radius:Math.min(radius+Math.log10(count)*0.7,5),stroke:false,fillColor:kindColor(properties.k),fillOpacity:.62});
    dot.on('click',()=>instance.flyTo([lat,lng],Math.min(14,instance.getZoom()+2),{duration:.45}));
    next.addLayer(dot);
   }
   group.remove();group=next.addTo(instance);currentLevel=level;
  };
  const sync=()=>{void draw();};
  const redraw=()=>{void draw(true);};
  instance.on('zoomend',sync);
  instance.on('moveend',redraw);
  void draw();
  return ()=>{disposed=true;instance.off('zoomend',sync);instance.off('moveend',redraw);group.remove();};
 },[ready,layers.historical]);

 useEffect(()=>{
  const instance=map.current;const L=leaflet.current;
  if(!instance||!L||!ready||!exploring||!layers.projects)return;
  const controller=new AbortController();
  let markers:import('leaflet').LayerGroup|null=null;
  const install=(features:{id:string;title?:string;geometry:{type:string;coordinates:[number,number]}}[])=>{
   if(controller.signal.aborted)return;
   markers?.remove();
   markers=L.layerGroup();
   for(const feature of features){
    if(feature.geometry?.type!=='Point')continue;
    const [lng,lat]=feature.geometry.coordinates;
    if(!Number.isFinite(lat)||!Number.isFinite(lng))continue;
    const dot=L.circleMarker([lat,lng],{radius:5,color:'#3977ff',weight:1.5,fillColor:'#3977ff',fillOpacity:.9});
    dot.on('click',()=>{void fetch('/api/v1/works/'+encodeURIComponent(feature.id)).then(async response=>{if(!response.ok)throw new Error('Project unavailable');callbacks.current.onWork((await response.json()).work);}).catch(e=>report.current?.(e.message));});
    markers!.addLayer(dot);
   }
   markers.addTo(instance);
  };
  const load=async()=>{
   report.current?.('Loading reviewed project locations...');
   const raw=viewport??[-180,-90,180,90];
   const bbox=[Math.max(-180,Math.min(180,raw[0])),Math.max(-90,Math.min(90,raw[1])),Math.max(-180,Math.min(180,raw[2])),Math.max(-90,Math.min(90,raw[3]))];
   if(bbox[0]>=bbox[2]||bbox[1]>=bbox[3])return;
   const params=new URLSearchParams({mode:'points',bbox:bbox.join(','),year,q:query,offset:'0'});
   if(purpose!=='All')params.set('purpose',purpose);
   if(state)params.set('state',state);
   const response=await fetch('/api/v1/map/works?'+params,{signal:controller.signal});
   if(!response.ok)throw new Error('Project locations are unavailable.');
   const result=await response.json();
   install(result.features??[]);
   report.current?.((result.total??0).toLocaleString('en-IN')+' reviewed project locations in view');
  };
  void load().catch(e=>{if(e.name!=='AbortError')report.current?.(e.message);});
  return ()=>{controller.abort();markers?.remove();};
 },[ready,exploring,layers.projects,viewport,year,purpose,query,state]);

 useEffect(()=>{
  const instance=map.current;const L=leaflet.current;
  if(!instance||!L||!ready)return;
  const location=work?.location??asset?.location;if(!location)return;
  const marker=L.circleMarker([location[1],location[0]],{radius:9,color:'#fff',weight:3,fillColor:'#b3ef52',fillOpacity:1}).addTo(instance);
  instance.flyTo([location[1],location[0]],Math.max(instance.getZoom(),9),{duration:matchMedia('(prefers-reduced-motion: reduce)').matches?0:.5});
  return ()=>{marker.remove();};
 },[work?.id,asset?.id,ready]);

 return <div className="atlas-map" data-map-provider="leaflet">
  <div className="map-canvas" ref={node}/>
  {ready&&<div className="atlas-dev-legend" role="group" aria-label="Development work filters">
   <span className="atlas-dev-legend-title">Development works</span>
   {year!=='2026-2027'&&year!=='all'&&<small className="atlas-dev-year">FY {year.slice(0,4)}–{year.slice(-2)} work records</small>}
   <div className="atlas-dev-row" role="group" aria-label="Work category">
    {CATEGORY_META.map(([key,label,color])=>
     <button key={key} type="button" className={workCategory===key?'is-active':''} aria-pressed={workCategory===key} onClick={()=>onWorkCategory(key)}>
      <i style={{background:color}} aria-hidden="true"/>{label}
     </button>
    )}
   </div>
   <div className="atlas-dev-row atlas-dev-ages" role="group" aria-label="Recorded age">
    {([[null,'Any age'],[5,'5+ years ago'],[10,'10+ years ago']] as const).map(([value,label])=>
     <button key={String(value)} type="button" className={workAge===value?'is-active':''} aria-pressed={workAge===value} onClick={()=>onWorkAge(value)}>{label}</button>
    )}
   </div>
   <small className="atlas-dev-note">Source work records do not publish MLA, political party or budget. Missing amounts are unknown, not zero.</small>
  </div>}
  {ready&&<div className="atlas-dev-key" role="region" aria-label="Map colour key">
   <span className="atlas-dev-key-title">Key</span>
   {CATEGORY_META.map(([key,label,color])=>
    <span key={key} className="atlas-dev-key-chip"><i style={{background:color}} aria-hidden="true"/>{label}</span>
   )}
   <span className="atlas-dev-key-note">Bigger circle · more works at that spot</span>
  </div>}
  <div className="atlas-art" aria-hidden="true"><div className="atlas-orbit orbit-one"/><div className="atlas-orbit orbit-two"/><div className="atlas-orbit orbit-three"/></div>
  {!ready&&!error&&<p className="atlas-map-loading" role="status">Preparing India's landscape...</p>}
  {ready&&dataReady===false&&!error&&<p className="atlas-map-loading" role="status">Loading reviewed funding layer...</p>}
  {error&&<div className="atlas-map-error" role="status">{error}</div>}
  <div className="atlas-data-credit">Data: GeoMGNREGA/Bhuvan, PMGSY GeoSadak Â· GODL-India</div>
 </div>;
}

