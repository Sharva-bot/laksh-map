#!/usr/bin/env node
// Precompute low-zoom cluster aggregates so map pans at zoom 3-7 do not scan
// the full 900k-row works table. Run after build-national-development.mjs.
import {existsSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {pathToFileURL} from 'node:url'
import path from 'node:path'

export const CLUSTER_MIN_ZOOM=3
export const CLUSTER_MAX_ZOOM=7

export function buildClusters(db){
 const built=[]
 const fy=`case when date is null or date='' or substr(date,1,4) not between '2000' and '2099' then '2026-2027'
  when cast(substr(date,6,2) as integer)>=4 then substr(date,1,4)||'-'||(cast(substr(date,1,4) as integer)+1)
  else (cast(substr(date,1,4) as integer)-1)||'-'||substr(date,1,4) end`
 for(let zoom=CLUSTER_MIN_ZOOM;zoom<=CLUSTER_MAX_ZOOM;zoom++){
  const cells=Math.trunc(Math.min(8192,Math.max(32,2**(zoom+3))))
  const table='clusters_z'+zoom
  const fyTable='clusters_fy_z'+zoom
  db.exec('drop table if exists '+table)
  db.exec('drop table if exists '+fyTable)
  db.exec(`create table ${table} as
   select round(avg(lat),5) as lat, round(avg(lng),5) as lng, category,
          count(*) as total,
          sum(case when amount is not null and amount > 0 then amount else 0 end) as amount_total,
          sum(case when issue_group is not null then 1 else 0 end) as issue_total
   from works
   group by cast((90.0 - lat) / 180.0 * ${cells} as integer),
            cast((lng + 180.0) / 360.0 * ${cells} as integer),
            category`)
  db.exec(`create index ${table}_geo_idx on ${table} (lat, lng)`)
  db.exec(`create table ${fyTable} as
   select round(avg(lat),5) as lat, round(avg(lng),5) as lng, category, ${fy} as fy,
          count(*) as total,
          sum(case when amount is not null and amount > 0 then amount else 0 end) as amount_total,
          sum(case when issue_group is not null then 1 else 0 end) as issue_total
   from works
   group by cast((90.0 - lat) / 180.0 * ${cells} as integer),
            cast((lng + 180.0) / 360.0 * ${cells} as integer),
            category, fy`)
  db.exec(`create index ${fyTable}_fy_idx on ${fyTable} (fy, lat, lng)`)
  const rows=db.prepare('select count(*) n from '+table).get().n
  const fyRows=db.prepare('select count(*) n from '+fyTable).get().n
  built.push({zoom,rows,fyRows})
 }
 return built
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const file=path.join(process.cwd(),'data/acquisition/development/works.sqlite')
 if(!existsSync(file)){console.error('Database missing. Run node scripts/build-national-development.mjs first.');process.exit(1)}
 const db=new DatabaseSync(file)
 const started=Date.now()
 const built=buildClusters(db)
 db.exec('analyze')
 db.close()
 console.log(`Precomputed ${built.map(item=>'z'+item.zoom+' '+item.rows.toLocaleString('en-IN')+'+'+item.fyRows.toLocaleString('en-IN')+'fy').join(', ')} cluster aggregates in ${((Date.now()-started)/1000).toFixed(1)}s.`)
}


