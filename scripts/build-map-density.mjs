// Build zoom-adaptive location density files from real government source rows.
// Inputs (all gitignored under data/raw/):
//   data/raw/pmgsy/*.csv            PMGSY rural facilities, GODL-India (DataMeet mirror)
//   data/raw/mgnrega/og-gov-data.json  GeoMGNREGA + Bhuvan/NRSC works, GODL-India
// Output: public/geography/locations/density/<cells>.geojson (aggregated counts only)
// Every output point is a grid cell of real source points; no location is invented.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';

const root=process.cwd();
const pmgsyDir=path.join(root,'data/raw/pmgsy');
const mgnregaFile=path.join(root,'data/raw/mgnrega/og-gov-data.json');
const outDir=path.join(root,'public/geography/locations/density');
const kinds=['public','road','education','health','agriculture'];

function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){
   if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}
   else field+=c;
  }else if(c==='"')quoted=true;
  else if(c===','){row.push(field);field='';}
  else if(c==='\n'){field=field.replace(/\r$/,'');row.push(field);field='';if(row.some(v=>v!==''))rows.push(row);row=[];}
  else field+=c;
 }
 if(field!==''||row.length)rows.push([...row,field.replace(/\r$/,'')]);
 return rows;
}

function pmgsyKind(category){
 const value=category.toLowerCase();
 if(value.startsWith('educat'))return 'education';
 if(value.startsWith('medic'))return 'health';
 if(value.startsWith('agro'))return 'agriculture';
 return 'public';
}

function mgnregaKind(title){
 const value=title.toLowerCase();
 if(/road|culvert|bridge|path|approach|\brd\b|link/.test(value))return 'road';
 if(/pond|tank|well|check dam|water|canal|drain|bund|farm|irrigat/.test(value))return 'agriculture';
 if(/school|anganwadi|college|classroom/.test(value))return 'education';
 if(/health|hospital|phc|sub.?centre/.test(value))return 'health';
 return 'public';
}

const points=[],byKind=Object.fromEntries(kinds.map(k=>[k,0])),byState=new Map();
let rejected=0;

if(existsSync(pmgsyDir)){
 for(const file of readdirSync(pmgsyDir).filter(name=>name.endsWith('.csv'))){
  const rows=parseCsv(readFileSync(path.join(pmgsyDir,file),'utf8'));
  if(!rows.length)continue;
  const header=rows[0].map(name=>name.replace(/^\ufeff/,'').trim());
  const at=(name,fallback)=>header.indexOf(name)>=0?header.indexOf(name):fallback;
  const iState=at('State',0),iDistrict=at('District',1),iCategory=at('Facility Category',8),iLat=at('Lattitude',10),iLng=at('Longitude',11);
  for(let r=1;r<rows.length;r++){
   const row=rows[r];if(!row||row.length<5)continue;
   const lat=Number(row[iLat]),lng=Number(row[iLng]);
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<6||lat>38||lng<66||lng>98){rejected++;continue;}
   const kind=pmgsyKind((row[iCategory]??'').trim());
   const state=(row[iState]??'').trim()||file.replace('.csv','');
   points.push({lat,lng,kind});
   byKind[kind]++;
   byState.set(state,(byState.get(state)??0)+1);
   void iDistrict;
  }
 }
}else console.warn('No data/raw/pmgsy CSVs; run scripts/fetch-pmgsy-facilities.mjs first.');

if(existsSync(mgnregaFile)){
 const payload=JSON.parse(readFileSync(mgnregaFile,'utf8'));
 const items=Array.isArray(payload)?payload:payload.items??[];
 for(const item of items){
  const lat=Number(item.lat),lng=Number(item.lng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<6||lat>38||lng<66||lng>98){rejected++;continue;}
  const kind=mgnregaKind(String(item.title??''));
  points.push({lat,lng,kind});
  byKind[kind]++;
  byState.set(item.state??'Unknown',(byState.get(item.state??'Unknown')??0)+1);
 }
}else console.warn('No data/raw/mgnrega/og-gov-data.json; building PMGSY facilities only.');

if(!points.length)throw new Error('No real source points found');
const sourceKey=createHash('sha256').update(JSON.stringify({pmgsy:existsSync(pmgsyDir)?readdirSync(pmgsyDir).sort():[],mgnrega:existsSync(mgnregaFile)})).digest('hex');

mkdirSync(outDir,{recursive:true});
const levels=[512,1024,2048,4096],outputs=[];
for(const cells of levels){
 const groups=new Map();
 for(const point of points){
  const x=Math.floor((point.lng+180)/360*cells),y=Math.floor((1-Math.asinh(Math.tan(point.lat*Math.PI/180))/Math.PI)/2*cells),key=x+':'+y;
  let group=groups.get(key);
  if(!group){group={x,y,count:0,lng:0,lat:0,kinds:Object.fromEntries(kinds.map(k=>[k,0]))};groups.set(key,group);}
  group.count++;group.lng+=point.lng;group.lat+=point.lat;group.kinds[point.kind]++;
 }
 const features=[];
 for(const group of groups.values()){
  let dominant='public',best=-1;
  const counts={};for(const kind of kinds){const value=group.kinds[kind];if(value>best){best=value;dominant=kind;}if(value)counts[kind]=value;}
  features.push({type:'Feature',geometry:{type:'Point',coordinates:[Number((group.lng/group.count).toFixed(4)),Number((group.lat/group.count).toFixed(4))]},properties:{count:group.count,k:dominant,...counts}});
 }
 const total=features.reduce((sum,feature)=>sum+feature.properties.count,0);
 if(total!==points.length)throw new Error(`Density ${cells} lost records: ${total}/${points.length}`);
 const bytes=Buffer.from(JSON.stringify({type:'FeatureCollection',cells,count:points.length,spendingLinked:false,meaning:'Real PMGSY facility and MGNREGA work locations grouped into grid cells; not independently verified current condition',features}));
 writeFileSync(path.join(outDir,cells+'.geojson'),bytes);
 outputs.push({cells,features:features.length,bytes:bytes.length,gzipBytes:gzipSync(bytes).length,sha256:createHash('sha256').update(bytes).digest('hex')});
 console.log(`z ${cells}: ${features.length} cells, ${(bytes.length/1048576).toFixed(2)}MB (${(gzipSync(bytes).length/1024).toFixed(0)}KB gzip)`);
}

const summary={version:'hisaab-location-density/1',updatedOn:new Date().toISOString().slice(0,10),count:points.length,byKind,byState:Object.fromEntries([...byState].sort((a,b)=>b[1]-a[1])),rejectedRows:rejected,sourceKey,levels:outputs,
 credits:['PMGSY rural facilities, Ministry of Rural Development (GODL-India) via DataMeet mirror','GeoMGNREGA works, Bhuvan/NRSC (GODL-India)']};
writeFileSync(path.join(root,'data/locations-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(`Total real source points: ${points.length.toLocaleString('en-IN')} (${rejected} rejected)`);
