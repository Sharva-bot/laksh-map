#!/usr/bin/env node
// Build a nationwide, queryable work-point database from the two openly licensed
// government sources already preserved under data/raw/:
//   - GeoMGNREGA works (Bhuvan/NRSC, GODL-India) via tmp/development/import.jsonl
//   - PMGSY GeoSadak rural facilities (GODL-India) via the DataMeet mirror CSVs
// Output: data/acquisition/development/works.sqlite (local fallback for the map)
import {createHash} from 'node:crypto'
import {existsSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
import {buildClusters} from './build-development-clusters.mjs'

const root=process.cwd()
const outDir=path.join(root,'data/acquisition/development')
const dbFile=path.join(outDir,'works.sqlite')
const mgnrega=path.join(root,'tmp/development/import.jsonl')
const pmgsyDir=path.join(root,'data/raw/pmgsy')
const pmgsySource='https://github.com/pratapvardhan/rural-facilities-pmgsy'

const stateBboxes=loadStateBboxes(path.join(root,'public/geography/funding-states.geojson'))

function loadStateBboxes(file){
 if(!existsSync(file))return []
 const collection=JSON.parse(readFileSync(file,'utf8'))
 return (collection.features??[]).map(feature=>{
  const polygons=feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates:[feature.geometry.coordinates]
  let minLng=180,maxLng=-180,minLat=90,maxLat=-90
  for(const polygon of polygons)for(const ring of polygon)for(const [lng,lat] of ring){
   if(lng<minLng)minLng=lng;if(lng>maxLng)maxLng=lng;if(lat<minLat)minLat=lat;if(lat>maxLat)maxLat=lat
  }
  return [minLng-0.05,minLat-0.05,maxLng+0.05,maxLat+0.05]
 })
}

function insideIndia(lat,lng){
 if(!stateBboxes.length)return true
 return stateBboxes.some(([minLng,minLat,maxLng,maxLat])=>lng>=minLng&&lng<=maxLng&&lat>=minLat&&lat<=maxLat)
}

if(!existsSync(mgnrega)){console.error('Run node scripts/build-development-import.mjs first (MGNREGA import missing).');process.exit(1)}
mkdirSync(outDir,{recursive:true})
if(existsSync(dbFile))rmSync(dbFile)

function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false
 for(let i=0;i<text.length;i++){
  const c=text[i]
  if(quoted){
   if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else quoted=false}
   else field+=c
  }else if(c==='"')quoted=true
  else if(c===','){row.push(field);field=''}
  else if(c==='\n'){field=field.replace(/\r$/,'');row.push(field);field='';if(row.some(v=>v!==''))rows.push(row);row=[]}
  else field+=c
 }
 if(field!==''||row.length)rows.push([...row,field.replace(/\r$/,'')])
 return rows
}

function pmgsyCategory(category,subcategory){
 const cat=category.toLowerCase(),sub=subcategory.toLowerCase()
 if(cat.startsWith('educat'))return 'education'
 if(cat.startsWith('medic'))return 'health'
 if(cat.startsWith('agro'))return 'agriculture'
 if(sub.includes('bus stand'))return 'road'
 return 'community'
}

function isoDate(value){
 const text=String(value??'').trim()
 return /^\d{4}-\d{2}-\d{2}/.test(text)?text.slice(0,10):null
}

const db=new DatabaseSync(dbFile)
db.exec(`
 pragma journal_mode = off;
 pragma synchronous = off;
 pragma temp_store = memory;
 create table works (
  dedupe_key text primary key,
  title text not null,
  lat real not null,
  lng real not null,
  date text,
  amount real,
  amount_status text,
  category text not null,
  issue_group text,
  block text,
  gram_panchayat text,
  work_type text,
  reported_year text,
  photo_url text,
  photo_url_2 text,
  source_link text,
  district text,
  state text,
  scheme text not null,
  credits text,
  address text
 );
 create index works_geo_idx on works (lat, lng);
 create index works_category_idx on works (category);
 create index works_state_idx on works (state);
`)

const insert=db.prepare(`insert or ignore into works (
 dedupe_key,title,lat,lng,date,amount,amount_status,category,issue_group,block,gram_panchayat,work_type,reported_year,photo_url,photo_url_2,source_link,district,state,scheme,credits,address
) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

let mgnregaCount=0
db.exec('begin')
for(const line of readFileSync(mgnrega,'utf8').split(/\r?\n/)){
 if(!line.trim())continue
 const row=JSON.parse(line)
 const lat=Number(row.lat),lng=Number(row.lng)
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<6||lat>38||lng<66||lng>98||!insideIndia(lat,lng))continue
 insert.run(
  String(row.dedupe_key??createHash('sha256').update(line).digest('hex')),
  String(row.title??'MGNREGA work'),lat,lng,
  isoDate(row.date),null,row.amount_status??'not_published',String(row.category??'other'),
  row.issue_group??null,row.block??null,row.gram_panchayat??null,row.work_type??null,
  row.reported_year??null,row.photo_url??null,row.photo_url_2??null,row.source_link??null,
  row.district??null,row.state??null,'MGNREGA',row.credits??'GeoMGNREGA, Bhuvan/NRSC. GODL-India.',null
 )
 mgnregaCount++
}
db.exec('commit')

let pmgsyCount=0,pmgsyFiles=0,rejected=0
for(const file of readdirSync(pmgsyDir).filter(name=>name.endsWith('.csv'))){
 const rows=parseCsv(readFileSync(path.join(pmgsyDir,file),'utf8'))
 if(!rows.length)continue
 pmgsyFiles++
 const header=rows[0].map(name=>name.replace(/^\ufeff/,'').trim())
 const at=(name,fallback)=>header.indexOf(name)>=0?header.indexOf(name):fallback
 const iState=at('State',0),iDistrict=at('District',1),iBlock=at('Block',2),iHabitation=at('Habitation Name',3),iHabitationId=at('Habitation ID',4),iFacility=at('Facility Name',5),iAddress=at('Address',6),iDate=at('File Upload Date',7),iCategory=at('Facility Category',8),iSubcategory=at('Facility Subcategory',9),iLat=at('Lattitude',10),iLng=at('Longitude',11)
 db.exec('begin')
 for(let index=1;index<rows.length;index++){
  const row=rows[index]
  if(!row.length)continue
  const lat=Number(row[iLat]),lng=Number(row[iLng])
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<6||lat>38||lng<66||lng>98||!insideIndia(lat,lng)){rejected++;continue}
  const facility=String(row[iFacility]??'').trim(),subcategory=String(row[iSubcategory]??'').trim()
  if(!facility)continue
  const title=subcategory?`${facility} (${subcategory})`:facility
  const date=isoDate(row[iDate])
  const state=String(row[iState]??'').trim()||null,district=String(row[iDistrict]??'').trim()||null
  const key=createHash('sha256').update(['pmgsy',title,lat,lng,row[iHabitationId]??'',district??''].join('|')).digest('hex')
  insert.run(
   key,title,lat,lng,date,null,'not_published',
   pmgsyCategory(String(row[iCategory]??''),subcategory),
   null,String(row[iBlock]??'').trim()||null,String(row[iHabitation]??'').trim()||null,subcategory||null,
   null,null,null,pmgsySource,district,state,'PMGSY',
   'PMGSY GeoSadak rural facilities, GODL-India. DataMeet mirror.',
   String(row[iAddress]??'').trim()||null
  )
  pmgsyCount++
 }
 db.exec('commit')
}

db.exec('create index if not exists works_cluster_idx on works (lat, lng, category, amount, issue_group)')
const clusterLevels=buildClusters(db)
db.exec('pragma optimize;')
const total=db.prepare('select count(*) n from works').get().n
const byState=db.prepare('select state,count(*) n from works group by state order by n desc limit 8').all()
const size=(readFileSync(dbFile).length/1024/1024).toFixed(1)
db.close()
console.log(`Built ${total.toLocaleString('en-IN')} nationwide work points (${mgnregaCount.toLocaleString('en-IN')} MGNREGA from ${path.relative(root,mgnrega)}, ${pmgsyCount.toLocaleString('en-IN')} PMGSY from ${pmgsyFiles} state files; ${rejected} invalid coordinates).`)
console.log(`Database: ${path.relative(root,dbFile)} (${size} MB). Cluster aggregates: ${clusterLevels.map(item=>'z'+item.zoom+' '+item.rows.toLocaleString('en-IN')).join(', ')}. Top states: ${byState.map(row=>`${row.state ?? 'Unknown'} ${row.n.toLocaleString('en-IN')}`).join(', ')}`)
