// Build a validated development import from real, openly licensed government works.
// Input:  data/raw/mgnrega/og-gov-data.json (GeoMGNREGA, Bhuvan/NRSC, GODL-India)
// Output: tmp/development/import.jsonl        (500-row-safe JSON Lines import file)
//         data/development-summary.json       (public aggregate counts only)
// Every output row keeps its original source link, photo links and receipt fields.
// Work categories and road-condition flags are transparent text classifications;
// they are not independent physical verification and no amount is invented.
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const input=path.resolve(root,process.argv[2]??'data/raw/mgnrega/og-gov-data.json');
const outDir=path.join(root,'tmp/development');
const outFile=path.join(outDir,'import.jsonl');
const summaryFile=path.join(root,'data/development-summary.json');

const categories=['road','water','sanitation','housing','education','health','agriculture','community','other'];
const ORDER=[
 ['road',/pothole|pot hole|pot-hole|road|culvert|bridge|approach|path|link|\bmrl\b|\bmdr\b|wbm|cc road|retaining wall|shoulder/],
 ['water',/pond|tank|well|check dam|water|canal|drain|bund|irrigat|fishery|borewell|hand ?pump|tube ?well|percolation/],
 ['sanitation',/toilet|soak pit|sanitation|sewage|compost|waste|vermi|drainage/],
 ['housing',/house|housing|\biay\b|awas|dwelling|residence/],
 ['education',/school|anganwadi|college|classroom|library|balwadi/],
 ['health',/health|hospital|\bphc\b|sub.?centre|medical|dispensary|clinic/],
 ['agriculture',/plantation|horticulture|\bfarm\b|agriculture|livestock|piggery|poultry|dairy|goat|duck|sericulture|orchard|kitchen garden/],
 ['community',/shed|building|community|panchayat|playground|stadium|chabutra|crematorium|cattle/],
];

function classify(title){
 const value=String(title??'').toLowerCase();
 if(/pothole|pot hole|pot-hole/.test(value))return {category:'road',issueGroup:'pothole_repair'};
 for(const [category,pattern] of ORDER){
  if(pattern.test(value))return {category,issueGroup:category==='road'&&/repair|maintenance|patch|resurfac/.test(value)?'road_repair':null};
 }
 return {category:'other',issueGroup:null};
}

function validUrl(value){
 try{
  const parsed=new URL(String(value??''));
  return parsed.protocol==='http:'||parsed.protocol==='https:'?parsed.href:null;
 }catch{return null;}
}

function isoDate(value){
 const text=String(value??'').trim();
 return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:null;
}

function jsonObject(value){
 if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 if(typeof value==='string'&&value.trim().startsWith('{')){
  try{
   const parsed=JSON.parse(value);
   return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return {};}
 }
 return {};
}

if(!existsSync(input))throw new Error(`Source file not found: ${input}`);
const payload=JSON.parse(readFileSync(input,'utf8'));
const items=Array.isArray(payload)?payload:Array.isArray(payload.items)?payload.items:null;
if(!items)throw new Error('Source file has no items array');
if(!items.length)throw new Error('Source file has no records');

const byCategory=Object.fromEntries(categories.map(category=>[category,0]));
const byIssue={pothole_repair:0,road_repair:0};
const byState=new Map();
const seen=new Set();
let rejected=0,duplicates=0,withAmounts=0,photoVerified=0;

mkdirSync(outDir,{recursive:true});
const lines=[];

for(const item of items){
 const lat=Number(item.lat),lng=Number(item.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<6||lat>38||lng<66||lng>98){rejected++;continue;}
 const title=String(item.title??'').trim();
 if(!title){rejected++;continue;}
 const extra=jsonObject(item.extra);
 const {category,issueGroup}=classify(title);
 const amount=Number(item.allocated);
 const hasAmount=Number.isFinite(amount)&&amount>0;
 const dedupe=typeof item.dedupe_key==='string'&&item.dedupe_key
  ? item.dedupe_key
  : createHash('sha256').update(JSON.stringify([title,lat,lng,item.source_link??'',item.date??''])).digest('hex');
 if(seen.has(dedupe)){duplicates++;continue;}
 seen.add(dedupe);

 const photo=validUrl(item.photo_url);
 const photo2=validUrl(item.photo_url_2);
 const state=String(item.state??extra.state??'').trim()||null;

 lines.push(JSON.stringify({
  title,
  allocated:hasAmount?amount:null,
  amount_status:hasAmount?'reported':'not_published',
  lat,
  lng,
  source_link:validUrl(item.source_link),
  photo_url:photo,
  photo_url_2:photo2,
  photo_status:photo?(item.photo_status??'linked'):'missing',
  date:isoDate(item.date),
  problem_since:isoDate(item.problem_since)??isoDate(item.date),
  year:String(item.year??'2026-2027'),
  reported_year:item.reported_year?String(item.reported_year):null,
  district:item.district?String(item.district):null,
  state,
  scheme:item.scheme?String(item.scheme):'MGNREGA',
  party:item.party?String(item.party):'Not known',
  mla:item.mla?String(item.mla):'Not known',
  votes_true:Number(item.votes_true)||0,
  votes_false:Number(item.votes_false)||0,
  flagged_yellow:Boolean(item.flagged_yellow),
  credits:item.credits?String(item.credits):'GeoMGNREGA, Bhuvan/NRSC. GODL-India.',
  dedupe_key:dedupe,
  category,
  issue_group:issueGroup,
  block:extra.block?String(extra.block):null,
  gram_panchayat:extra.gram_panchayat?String(extra.gram_panchayat):null,
  work_type:extra.work_type?String(extra.work_type):null,
  source_dataset:'GeoMGNREGA',
  extra,
 }));

 byCategory[category]++;
 if(issueGroup)byIssue[issueGroup]++;
 if(state)byState.set(state,(byState.get(state)??0)+1);
 if(hasAmount)withAmounts++;
 if(photoVerified<1&&photo)photoVerified=1;
}

writeFileSync(outFile,lines.join('\n')+'\n');
const summary={
 version:'hisaab-development-import/1',
 generatedOn:new Date().toISOString().slice(0,10),
 source:input.replace(root+path.sep,'').replaceAll('\\','/'),
 sourceDataset:'GeoMGNREGA works, Bhuvan/NRSC (GODL-India)',
 count:lines.length,
 rejected,
 duplicates,
 withAmounts,
 withPhotos:lines.reduce((total,line)=>total+(JSON.parse(line).photo_url?1:0),0),
 byCategory,
 byIssue,
 byState:Object.fromEntries([...byState].sort((a,b)=>b[1]-a[1])),
 notes:[
  'Categories and road-condition flags are text classifications of official work titles.',
  'Missing amounts are not zero; they remain unpublished.',
  'A photo link is source evidence, not independent physical verification.',
 ],
};
writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n');
console.log(`Validated ${lines.length.toLocaleString('en-IN')} rows (${rejected} rejected, ${duplicates} duplicates)`);
console.log('By category:',JSON.stringify(byCategory));
console.log('Road-condition flags:',JSON.stringify(byIssue));
console.log('Written:',path.relative(root,outFile));
console.log('Summary:',path.relative(root,summaryFile));
