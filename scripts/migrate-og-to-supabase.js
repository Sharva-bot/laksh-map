#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const root = process.cwd()
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const manifestArg = args.find((value) => !value.startsWith('--'))
const manifestSource = manifestArg && /^https?:\/\//.test(manifestArg) ? manifestArg : resolve(root, manifestArg || 'src/data/HISAAB_GEOGRAPHY_MANIFEST.json')

function readEnv() {
  const values = {}
  for (const file of ['.env.local', '.env.hosted', '.env']) {
    const path = resolve(root, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match) continue
      if (values[match[1]]) continue
      values[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  }
  return values
}

async function loadFacts(source) {
  let text
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source)
    if (!response.ok) throw new Error(`Manifest fetch failed: HTTP ${response.status} for ${source}`)
    text = await response.text()
  } else {
    if (!existsSync(source)) throw new Error(`Manifest not found: ${source}`)
    text = readFileSync(source, 'utf8')
  }
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed
  for (const key of ['data', 'facts', 'items', 'records', 'locations', 'features']) {
    if (Array.isArray(parsed[key])) return parsed[key]
  }
  throw new Error('Manifest has no array of facts')
}

function first(source, keys) {
  for (const key of keys) {
    const value = source?.[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(String(value).replace(/[^0-9.eE+-]/g, ''))
  return Number.isFinite(number) ? number : null
}

function toDate(value) {
  if (!value) return null
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function normalize(fact, index) {
  const title = first(fact, ['name', 'title', 'project', 'project_name'])
  const allocated = toNumber(first(fact, ['amount', 'allocated', 'cost', 'value']))
  const lat = toNumber(first(fact, ['lat', 'latitude']))
  const lng = toNumber(first(fact, ['lon', 'lng', 'long', 'longitude']))
  const date = first(fact, ['date', 'published_at', 'published'])
  return {
    title: title === null ? `Record ${index + 1}` : String(title),
    allocated,
    lat,
    lng,
    source_link: first(fact, ['pib_link', 'source', 'source_link', 'url', 'link']),
    photo_url: first(fact, ['photo', 'photo_url', 'image', 'image_url']),
    date: toDate(date),
    year: String(first(fact, ['year', 'financial_year']) || '2026-2027'),
    district: first(fact, ['district', 'district_name']) === null ? null : String(first(fact, ['district', 'district_name'])),
  }
}

async function main() {
  const env = readEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_KEY || env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local')

  const facts = await loadFacts(manifestSource)
  console.log(`Manifest: ${manifestSource}`)
  console.log(`Facts: ${facts.length}`)
  console.log('Sample:', JSON.stringify(facts[0], null, 2))

  const rows = facts.map(normalize).filter((row) => row.lat !== null && row.lng !== null)
  console.log(`Rows with coordinates: ${rows.length}`)

  if (dryRun) {
    console.log('Dry run. First mapped row:', JSON.stringify(rows[0], null, 2))
    return
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const batchSize = 1000
  let inserted = 0
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const { error } = await supabase.from('development').insert(batch)
    if (error) throw new Error(`Batch ${start / batchSize + 1} failed: ${error.message}`)
    inserted += batch.length
    console.log(`Inserted ${inserted}/${rows.length}`)
  }
  console.log('Done. Inserted', inserted, 'rows into development.')
}

main().catch((error) => {
  console.error('Migration failed:', error.message)
  process.exit(1)
})
