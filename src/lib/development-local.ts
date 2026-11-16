import {existsSync,statSync} from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'

type Mode='clusters'|'points'|'list'
type Bounds=[number,number,number,number]

type QueryInput={mode:Mode;bounds:Bounds|null;year:string;age:number|null;category:string|null;zoom:number;query:string;limit:number}

type LocalResult={data:Record<string,unknown>[];total:number;source:string}|null

const CLUSTER_MIN_ZOOM=3
const CLUSTER_MAX_ZOOM=7

let connection:DatabaseSync|null=null
let stamp=0
let tables:Set<string>|null=null

const cache=new Map<string,{at:number;value:LocalResult}>()
const CACHE_TTL=120000
const CACHE_MAX=80

function queryLocalDevelopment(input:QueryInput):LocalResult{
 const key=cacheKey(input)
 const hit=cache.get(key)
 if(hit&&Date.now()-hit.at<CACHE_TTL)return hit.value
 const value=run(input)
 if(value){
  cache.set(key,{at:Date.now(),value})
  if(cache.size>CACHE_MAX)cache.delete(cache.keys().next().value as string)
 }
 return value
}

export {queryLocalDevelopment}

function cacheKey(input:QueryInput){
 const bounds=input.bounds?.map(value=>Math.round(value*1000)/1000)??null
 return JSON.stringify([input.mode,bounds,input.zoom,Math.round(input.zoom),input.year,input.age,input.category,input.query.trim().toLowerCase(),input.limit])
}

function db(){
 const file=path.join(process.cwd(),'data/acquisition/development/works.sqlite')
 if(!existsSync(file))return null
 const modified=statSync(file).mtimeMs
 if(!connection||stamp!==modified){
  connection?.close()
  connection=new DatabaseSync(file,{readOnly:true})
  stamp=modified
  tables=new Set((connection.prepare("select name from sqlite_master where type='table'").all() as {name:string}[]).map(row=>row.name))
 }
 return connection
}

function cellsForZoom(zoom:number){return Math.trunc(Math.min(8192,Math.max(32,2**(zoom+3))))}

function isSnapshotYear(year:string){return !year||year==='all'||year==='2026-2027'}

function dateFilter(input:QueryInput){
 if(!isSnapshotYear(input.year)){
  const [start,end]=input.year.split('-')
  if(/^\d{4}$/.test(start)&&/^\d{4}$/.test(end))return {start:`${start}-04-01`,end:`${end}-03-31`}
 }
 return null
}

function ageCutoff(age:number|null){
 if(!age)return null
 const cutoff=new Date()
 cutoff.setFullYear(cutoff.getFullYear()-age)
 return cutoff.toISOString().slice(0,10)
}

function fiscalYear(date:string){
 const year=Number(date.slice(0,4)),month=Number(date.slice(5,7))
 if(!Number.isFinite(year)||!Number.isFinite(month)||year<2000||year>2099||month<1||month>12)return null
 return month>=4?`${year}-${year+1}`:`${year-1}-${year}`
}

function ageFiscalYear(age:number|null){
 const cutoff=ageCutoff(age)
 return cutoff?fiscalYear(cutoff):null
}

function filters(input:QueryInput,bounded:boolean){
 const where:string[]=[],values:(number|string)[]=[]
 if(bounded&&input.bounds){
  where.push('lat between ? and ? and lng between ? and ?')
  values.push(input.bounds[1],input.bounds[3],input.bounds[0],input.bounds[2])
 }
 if(input.category){where.push('category = ?');values.push(input.category)}
 const dates=dateFilter(input)
 if(dates){where.push('date between ? and ?');values.push(dates.start,dates.end)}
 const cutoff=ageCutoff(input.age)
 if(cutoff){where.push('date is not null and date <= ?');values.push(cutoff)}
 const needle=input.query.trim()
 if(needle){const like=`%${needle}%`;where.push('(title like ? or district like ? or state like ?)');values.push(like,like,like)}
 return {sql:where.length?' where '+where.join(' and '):'',values}
}

function point(row:Record<string,unknown>,year:string){
 return {
  title:row.title,lat:row.lat,lng:row.lng,date:row.date,
  allocated:row.amount,amount_status:row.amount_status,
  category:row.category,issue_group:row.issue_group,
  block:row.block,gram_panchayat:row.gram_panchayat,work_type:row.work_type,
  reported_year:row.reported_year,photo_url:row.photo_url,photo_url_2:row.photo_url_2,
  photo_status:row.photo_url?'linked':'missing',source_link:row.source_link,
  district:row.district,state:row.state,scheme:row.scheme,credits:row.credits,
  address:row.address,problem_since:row.date,year:isSnapshotYear(year)?'2026-2027':year,party:null,mla:null,
  votes_true:0,votes_false:0,flagged_yellow:false,
 }
}

function run(input:QueryInput):LocalResult{
 const database=db()
 if(!database)return null

 if(input.mode==='points'||input.mode==='list'){
  const filter=filters(input,true)
  let total=input.limit
  if(input.mode==='points'){
   try{total=Number((database.prepare(`select count(*) n from works${filter.sql}`).get(...filter.values) as {n:number}).n)||0}catch{total=input.limit}
  }
  const rows=database.prepare(`select title,lat,lng,date,amount,amount_status,category,issue_group,block,gram_panchayat,work_type,reported_year,photo_url,photo_url_2,source_link,district,state,scheme,credits,address from works${filter.sql} order by (date is null), date desc limit ?`).all(...filter.values,input.limit) as Record<string,unknown>[]
  return {data:rows.map(row=>point(row,input.year)),total:input.mode==='list'?rows.length:total,source:'local_national_database'}
 }

 const level=Math.trunc(Math.min(CLUSTER_MAX_ZOOM,Math.max(CLUSTER_MIN_ZOOM,input.zoom)))
 const table='clusters_z'+level
 const fyTable='clusters_fy_z'+level
 const pastYear=!isSnapshotYear(input.year)
 const dated=Boolean(pastYear||input.age)
 if(!input.query.trim()&&dated&&tables?.has(fyTable))return clustersFromFyTable(database,fyTable,input)
 const dynamic=Boolean(input.query.trim()||dateFilter(input)||ageCutoff(input.age))
 if(!dynamic&&tables?.has(table))return clustersFromTable(database,table,input)

 return clustersFromWorks(database,input)
}

function clustersFromTable(database:DatabaseSync,table:string,input:QueryInput){
 const where:string[]=['lat between ? and ?','lng between ? and ?']
 const values:(number|string)[]=[input.bounds?input.bounds[1]:-90,input.bounds?input.bounds[3]:90,input.bounds?input.bounds[0]:-180,input.bounds?input.bounds[2]:180]
 if(input.category){where.push('category = ?');values.push(input.category)}
 const clause=' where '+where.join(' and ')
 const rows=database.prepare(`select lat,lng,category,total,amount_total,issue_total from ${table}${clause} order by total desc limit ?`).all(...values,input.limit) as {lat:number;lng:number;category:string|null;total:number;amount_total:number;issue_total:number}[]
 const sum=database.prepare(`select coalesce(sum(total),0) n from ${table}${clause}`).get(...values) as {n:number}
 return {
  data:rows.map(row=>({lat:row.lat,lng:row.lng,total:row.total,amount_total:row.amount_total>0?row.amount_total:null,issue_total:row.issue_total,category:row.category})),
  total:Number(sum.n)||0,
  source:'local_national_database',
 }
}

function clustersFromFyTable(database:DatabaseSync,table:string,input:QueryInput){
 const where:string[]=['lat between ? and ?','lng between ? and ?']
 const values:(number|string)[]=[input.bounds?input.bounds[1]:-90,input.bounds?input.bounds[3]:90,input.bounds?input.bounds[0]:-180,input.bounds?input.bounds[2]:180]
 if(input.category){where.push('category = ?');values.push(input.category)}
 if(dateFilter(input)){where.push('fy = ?');values.push(input.year)}
 const cutoffFy=ageFiscalYear(input.age)
 if(input.age&&cutoffFy){where.push('fy < ?');values.push(cutoffFy)}
 const clause=' where '+where.join(' and ')
 const rows=database.prepare(`select lat,lng,category,sum(total) as total,sum(amount_total) as amount_total,sum(issue_total) as issue_total from ${table}${clause} group by lat,lng,category order by total desc limit ?`).all(...values,input.limit) as {lat:number;lng:number;category:string|null;total:number;amount_total:number;issue_total:number}[]
 const sum=database.prepare(`select coalesce(sum(total),0) n from ${table}${clause}`).get(...values) as {n:number}
 return {
  data:rows.map(row=>({lat:row.lat,lng:row.lng,total:row.total,amount_total:row.amount_total>0?row.amount_total:null,issue_total:row.issue_total,category:row.category})),
  total:Number(sum.n)||0,
  source:'local_national_database',
 }
}

function clustersFromWorks(database:DatabaseSync,input:QueryInput){
 const filter=filters(input,true)
 const cells=cellsForZoom(input.zoom)
 const rows=database.prepare(`
  select cast((lng + 180.0) / 360.0 * ? as integer) as cx,
         cast((90.0 - lat) / 180.0 * ? as integer) as cy,
         category,count(*) as total,avg(lng) as lng,avg(lat) as lat,
         sum(case when amount is not null and amount > 0 then amount else 0 end) as amount_total,
         sum(case when issue_group is not null then 1 else 0 end) as issue_total
  from works${filter.sql} group by cx, cy, category
 `).all(cells,cells,...filter.values) as {cx:number;cy:number;category:string|null;total:number;lng:number;lat:number;amount_total:number;issue_total:number}[]

 const groups=new Map<string,{sumLng:number;sumLat:number;total:number;amount:number;issues:number;category:string|null;best:number}>()
 let totalWorks=0
 for(const row of rows){
  const key=row.cx+':'+row.cy
  let group=groups.get(key)
  if(!group){group={sumLng:0,sumLat:0,total:0,amount:0,issues:0,category:null,best:-1};groups.set(key,group)}
  group.sumLng+=row.lng*row.total;group.sumLat+=row.lat*row.total;group.total+=row.total
  group.amount+=row.amount_total;group.issues+=row.issue_total
  if(row.total>group.best){group.best=row.total;group.category=row.category}
  totalWorks+=row.total
 }
 const clusters=[...groups.values()].map(group=>({
  lng:group.sumLng/group.total,lat:group.sumLat/group.total,total:group.total,
  amount_total:group.amount>0?group.amount:null,issue_total:group.issues,category:group.category,
 })).sort((a,b)=>b.total-a.total).slice(0,input.limit)
 return {data:clusters,total:totalWorks,source:'local_national_database'}
}
