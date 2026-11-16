import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; vote?: boolean; token?: string }
    const id = String(body.id || '')
    const token = String(body.token || '')
    if (!UUID.test(id)) return json({ error: 'invalid id' }, 400)
    if (typeof body.vote !== 'boolean') return json({ error: 'invalid vote' }, 400)
    if (token.length < 8) return json({ error: 'invalid token' }, 400)

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const key =
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) return json({ error: 'not configured' }, 503)

    const tokenHash = createHash('sha256').update(`${id}:${token}`).digest('hex')
    const supabase = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(6000) }) },
    })

    const { data, error } = await supabase.rpc('increment_development_vote', {
      p_id: id,
      p_vote: body.vote,
      p_token: tokenHash,
    })

    if (error) {
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
        return json({ error: 'vote function missing. Run the development migration.' }, 503)
      }
      return json({ error: error.message }, 502)
    }

    const row = Array.isArray(data) ? data[0] : data
    return json({
      votes_true: Number(row?.true_votes) || 0,
      votes_false: Number(row?.false_votes) || 0,
    })
  } catch {
    return json({ error: 'vote failed' }, 500)
  }
}
