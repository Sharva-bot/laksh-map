#!/usr/bin/env node
// Compact the validated development import for fast local map queries.
// Input:  tmp/development/import.jsonl
// Output: tmp/development/map.json (array of compact rows, no web copy required)
import {createReadStream,existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {createInterface} from 'node:readline'
import path from 'node:path'

const root=process.cwd()
const input=path.join(root,'tmp/development/import.jsonl')
const output=path.join(root,'tmp/development/map.json')
if(!existsSync(input)){console.error('Run node scripts/build-development-import.mjs first.');process.exit(1)}

const rows=[]
const reader=createInterface({input:createReadStream(input,'utf8'),crlfDelay:Infinity})
for await (const line of reader){
 if(!line.trim())continue
 const row=JSON.parse(line)
 const lat=Number(row.lat),lng=Number(row.lng)
 if(!Number.isFinite(lat)||!Number.isFinite(lng))continue
 rows.push([
  String(row.title??''),
  lat,
  lng,
  row.date??null,
  Number.isFinite(Number(row.allocated))&&Number(row.allocated)>0?Number(row.allocated):null,
  row.category??null,
  row.block??null,
  row.gram_panchayat??null,
  row.work_type??null,
  row.reported_year??null,
  row.photo_url??null,
  row.photo_url_2??null,
  row.source_link??null,
  row.district??null,
  row.state??null,
  row.dedupe_key??String(rows.length),
  row.amount_status??null,
  row.issue_group??null,
 ])
}
mkdirSync(path.dirname(output),{recursive:true})
const text=JSON.stringify(rows)
writeFileSync(output,text)
console.log(`Wrote ${rows.length.toLocaleString('en-IN')} compact rows to ${path.relative(root,output)} (${(Buffer.byteLength(text)/1024/1024).toFixed(1)} MB).`)
