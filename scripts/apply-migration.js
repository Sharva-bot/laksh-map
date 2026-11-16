#!/usr/bin/env node
'use strict'

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)

function arg(name, fallback) {
  const i = args.indexOf('--' + name)
  if (i === -1) return fallback
  const value = args[i + 1]
  return value && !value.startsWith('--') ? value : true
}

function loadEnv() {
  const env = {}
  for (const file of ['.env.local', '.env.hosted', '.env']) {
    const full = path.join(process.cwd(), file)
    if (!fs.existsSync(full)) continue
    for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      if (!env[match[1]]) env[match[1]] = value
    }
  }
  return env
}

async function main() {
  const env = loadEnv()
  const token = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  if (!token) {
    console.error('Missing SUPABASE_ACCESS_TOKEN.')
    console.error('Create one at https://supabase.com/dashboard/account/tokens')
    console.error('Then add this line to .env.local: SUPABASE_ACCESS_TOKEN=sbp_...')
    process.exitCode = 1
    return
  }
  if (!url) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL in .env.local')
    process.exitCode = 1
    return
  }

  const ref = new URL(url).hostname.split('.')[0]
  const inline = arg('sql', '')
  const file = path.resolve(
    process.cwd(),
    String(arg('file', 'supabase/migrations/20261103120000_development_map.sql'))
  )
  const sql = inline ? String(inline) : fs.readFileSync(file, 'utf8')

  console.log(`Project: ${ref}`)
  console.log(`SQL: ${inline ? 'inline' : file}`)

  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, read_only: false }),
    signal: AbortSignal.timeout(180000),
  })

  const body = await response.text()
  console.log(`Migration response: ${response.status} ${body.slice(0, 2000)}`)
  if (!response.ok) {
    process.exitCode = 1
    return
  }

  const check = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query:
        "select table_name from information_schema.tables where table_schema = 'public' and table_name in ('development','development_vote_tokens') order by 1",
      read_only: true,
    }),
    signal: AbortSignal.timeout(60000),
  })
  console.log(`Verify response: ${check.status} ${(await check.text()).slice(0, 2000)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
