#!/usr/bin/env node
// Idempotent import of validated development records into public.development.
// Build the import first:  node scripts/build-development-import.mjs
// Then push:               node scripts/push-to-supabase.js
// The push uses the unique dedupe_key, so re-running never creates duplicates.
import {createHash} from 'node:crypto'
import {existsSync,readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createClient} from '@supabase/supabase-js'

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const BATCH_SIZE=1000
const CATEGORIES=new Set(['road','water','sanitation','housing','education','health','agriculture','community','other'])

function loadEnv(){
 for(const file of ['.env.local','.env.hosted','.env']){
  const full=path.join(ROOT,file)
  if(!existsSync(full))continue
  for(const line of readFileSync(full,'utf8').split(/\r?\n/)){
   const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
   if(!match||process.env[match[1]]!==undefined)continue
   let value=match[2]
   if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1)
   process.env[match[1]]=value
  }
 }
}

function readRecords(file){
 const text=readFileSync(file,'utf8').trim()
 if(!text)return []
 let parsed
 try{parsed=JSON.parse(text)}catch{parsed=undefined}
 if(parsed!==undefined){
  if(Array.isArray(parsed))return parsed
  if(Array.isArray(parsed.items))return parsed.items
  if(Array.isArray(parsed.data))return parsed.data
  throw new Error('JSON source has no array of records')
 }
 return text.split(/\r?\n/).filter(Boolean).map((line,index)=>{
  try{return JSON.parse(line)}catch{throw new Error(`Invalid JSON on line ${index+1}`)}
 })
}

function validUrl(value){
 try{
  const parsed=new URL(String(value??''))
  return parsed.protocol==='http:'||parsed.protocol==='https:'?parsed.href:null
 }catch{return null}
}

function isoDate(value){
 const text=String(value??'').trim()
 return /^\d{4}-\d{2}-\d{2}$/.test(text)?text:null
}

function nullableText(value,fallback=null){
 return value===undefined||value===null||value===''?fallback:String(value)
}

function normalize(row,index){
 if(!row||typeof row!=='object'||Array.isArray(row))throw new Error(`Record ${index+1} is not an object.`)
 const lat=Number(row.lat),lng=Number(row.lng)
 if(!Number.isFinite(lat)||lat<6||lat>38||!Number.isFinite(lng)||lng<66||lng>98)throw new Error(`Record ${index+1} has invalid India latitude/longitude.`)
 const title=nullableText(row.title)
 if(!title)throw new Error(`Record ${index+1} has no title.`)
 const category=CATEGORIES.has(String(row.category))?String(row.category):'other'
 const amount=Number(row.allocated)
 const hasAmount=Number.isFinite(amount)&&amount>0
 const dedupe=nullableText(row.dedupe_key)||createHash('sha256').update(JSON.stringify([title,lat,lng,row.source_link??'',row.date??''])).digest('hex')
 const extra=row.extra&&typeof row.extra==='object'&&!Array.isArray(row.extra)?row.extra:{}
 return {
  title,
  allocated:hasAmount?amount:null,
  amount_status:nullableText(row.amount_status,hasAmount?'reported':'not_published'),
  lat,
  lng,
  source_link:validUrl(row.source_link),
  photo_url:validUrl(row.photo_url),
  photo_url_2:validUrl(row.photo_url_2),
  photo_status:nullableText(row.photo_status,validUrl(row.photo_url)?'linked':'missing'),
  date:isoDate(row.date),
  problem_since:isoDate(row.problem_since)??isoDate(row.date),
  year:nullableText(row.year,'2026-2027'),
  reported_year:nullableText(row.reported_year),
  district:nullableText(row.district),
  state:nullableText(row.state),
  scheme:nullableText(row.scheme,'MGNREGA'),
  party:nullableText(row.party,'Not known'),
  mla:nullableText(row.mla,'Not known'),
  votes_true:Number(row.votes_true)||0,
  votes_false:Number(row.votes_false)||0,
  flagged_yellow:Boolean(row.flagged_yellow),
  credits:nullableText(row.credits,'GeoMGNREGA, Bhuvan/NRSC. GODL-India.'),
  dedupe_key:dedupe,
  category,
  issue_group:nullableText(row.issue_group),
  block:nullableText(row.block),
  gram_panchayat:nullableText(row.gram_panchayat),
  work_type:nullableText(row.work_type),
  source_dataset:nullableText(row.source_dataset,'GeoMGNREGA'),
  extra,
 }
}

async function main(){
 loadEnv()
 const args=process.argv.slice(2)
 const fileFlag=args.indexOf('--file')
 const fileArg=fileFlag>=0?args[fileFlag+1]:args.find(value=>!value.startsWith('--'))
 const file=path.resolve(ROOT,fileArg??(existsSync(path.join(ROOT,'tmp/development/import.jsonl'))?'tmp/development/import.jsonl':'og-gov-data.json'))
 if(!existsSync(file))throw new Error(`Import file not found: ${file}. Run node scripts/build-development-import.mjs first.`)
 const rows=readRecords(file).map(normalize)
 const withAmount=rows.filter(row=>row.allocated!==null).length
 const withPhoto=rows.filter(row=>row.photo_url).length
 console.log(`Validated ${rows.length.toLocaleString('en-IN')} records from ${path.relative(ROOT,file)} (${withAmount} with amounts, ${withPhoto} with photos).`)
 if(args.includes('--dry-run')){
  console.log('Dry run: no rows were sent to Supabase.')
  return
 }
 if(!rows.length){console.log('No rows to insert.');return}

 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL
 const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_KEY
 if(!url||!key)throw new Error('Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY in .env.local/.env.hosted.')

 const supabase=createClient(url,key,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal??AbortSignal.timeout(60000)})},
 })

 let inserted=0
 for(let start=0;start<rows.length;start+=BATCH_SIZE){
  const batch=rows.slice(start,start+BATCH_SIZE)
  const batchNumber=Math.floor(start/BATCH_SIZE)+1
  const {data,error}=await supabase.from('development').upsert(batch,{onConflict:'dedupe_key',ignoreDuplicates:true}).select('id')
  if(error)throw new Error(`Upsert batch ${batchNumber} failed (${start+1}-${start+batch.length}): ${error.message}`)
  inserted+=data?.length??0
  console.log(`Batch ${batchNumber}: sent ${start+batch.length}/${rows.length}, new ${inserted}`)
 }
 console.log(`Complete: ${inserted.toLocaleString('en-IN')} new rows in public.development (${rows.length-inserted} already present).`)
}

main().catch((error)=>{
 console.error(`Supabase import failed: ${error.message}`)
 process.exitCode=1
})
