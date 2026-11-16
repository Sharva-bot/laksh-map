import { createClient } from '@supabase/supabase-js'
import { queryLocalDevelopment } from '@/lib/development-local'
import { developmentOverview, developmentSelection } from '@/lib/development'
import { readDevelopment } from '@/lib/development-db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CATEGORIES = new Set(['road', 'water', 'sanitation', 'housing', 'education', 'health', 'agriculture', 'community', 'other'])
const headers = { 'Cache-Control': 'no-store' }
const empty = () => Response.json({ data: [] }, { headers })

type Bounds = [number, number, number, number]

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null
  const parts = value.split(',').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
  const [west, south, east, north] = parts
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return null
  return [west, south, east, north]
}

function cellsForZoom(zoom: number) {
  return Math.trunc(Math.min(8192, Math.max(32, 2 ** (zoom + 3))))
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const year = params.get('year') || '2026-2027'
    const mode = params.get('mode') || 'list'
    const rawCategory = params.get('category') || 'all'
    if (rawCategory !== 'all' && !CATEGORIES.has(rawCategory)) {
      return Response.json({ error: 'Invalid category' }, { status: 400, headers })
    }
    const category = rawCategory === 'all' ? null : rawCategory
    const rawAge = Number(params.get('age'))
    const age = rawAge === 5 || rawAge === 10 ? rawAge : null
    const bounds = parseBounds(params.get('bbox'))
    if (params.get('bbox') && !bounds) return Response.json({ error: 'Invalid bounds' }, { status: 400, headers })
    const zoom = Number(params.get('zoom'))
    const query = (params.get('q') || '').trim().slice(0, 200)
    const local = () =>
      queryLocalDevelopment({
        mode: mode === 'clusters' || mode === 'points' ? mode : 'list',
        bounds,
        year,
        age,
        category,
        zoom: Number.isFinite(zoom) ? zoom : 6,
        query,
        limit: mode === 'clusters' ? 5000 : mode === 'points' ? 3000 : 5000,
      })

    const explicitMode = params.has('mode')
    if (!explicitMode && !bounds && !query) {
      try {
        const selection = developmentSelection(params)
        try {
          return Response.json(await readDevelopment(selection), { headers })
        } catch {
          return Response.json(
            {
              ...developmentOverview([], selection),
              warning: 'Reviewed funding evidence is unavailable; no local funding records are stored.',
            },
            { headers },
          )
        }
      } catch {
        return Response.json({ error: 'Invalid selection' }, { status: 400, headers })
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY
    if (!url || !key) {
      const result = local()
      return result
        ? Response.json({ ...result, warning: 'Supabase is not configured; using the validated local import.' }, { headers })
        : empty()
    }

    const supabase = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20000) }) },
    })

    if (mode === 'clusters' || mode === 'points') {
      if (!bounds) return Response.json({ error: 'Viewport bounds required' }, { status: 400, headers })
      const rpc = mode === 'clusters' ? 'development_map_clusters' : 'development_map_points'
      const args =
        mode === 'clusters'
          ? {
              p_west: bounds[0],
              p_south: bounds[1],
              p_east: bounds[2],
              p_north: bounds[3],
              p_year: year,
              p_category: category,
              p_cells: cellsForZoom(Number.isFinite(zoom) ? zoom : 6),
              p_limit: 5000,
            }
          : {
              p_west: bounds[0],
              p_south: bounds[1],
              p_east: bounds[2],
              p_north: bounds[3],
              p_year: year,
              p_category: category,
              p_limit: 3000,
            }
      const { data, error } = await supabase.rpc(rpc, args)
      if (error || !Array.isArray(data)) {
        const fallback = local()
        if (fallback) return Response.json({ ...fallback, warning: 'Supabase map functions are unavailable; using the validated local import.' }, { headers })
        if (error?.code === 'PGRST202' || /could not find the function/i.test(error?.message || '')) {
          return Response.json({ data: [], warning: 'Run the development map migration.' }, { headers })
        }
        return Response.json({ data: [], warning: 'Development map clusters unavailable.' }, { headers })
      }
      if (!data.length) {
        const fallback = local()
        if (fallback?.data.length) return Response.json({ ...fallback, warning: 'No published rows in this viewport; using the validated local import.' }, { headers })
      }
      if (mode === 'clusters') {
        const total = data.reduce((sum: number, row: { total?: number }) => sum + (Number(row.total) || 0), 0)
        return Response.json({ data, total, cells: cellsForZoom(Number.isFinite(zoom) ? zoom : 6) }, { headers })
      }
      return Response.json({ data, total: data.length }, { headers })
    }

    let select = supabase
      .from('development')
      .select(
        'id,title,allocated,amount_status,lat,lng,category,issue_group,source_link,photo_url,photo_url_2,photo_status,date,problem_since,year,reported_year,district,state,scheme,party,mla,votes_true,votes_false,flagged_yellow,credits,block,gram_panchayat,work_type'
      )
      .order('created_at', { ascending: false })
      .limit(5000)

    if (year !== 'all') select = select.eq('year', year)
    if (category) select = select.eq('category', category)
    if (bounds) {
      select = select
        .gte('lng', bounds[0])
        .lte('lng', bounds[2])
        .gte('lat', bounds[1])
        .lte('lat', bounds[3])
    }
    if (query) {
      const safe = query.replace(/[(),*]/g, ' ').trim()
      if (safe) select = select.or(`title.ilike.%${safe}%,district.ilike.%${safe}%,state.ilike.%${safe}%`)
    }

    const { data, error } = await select
    if (error || !Array.isArray(data) || !data.length) {
      const fallback = local()
      if (fallback) return Response.json({ ...fallback, warning: 'Supabase rows are unavailable; using the validated local import.' }, { headers })
    }
    if (error || !Array.isArray(data)) return empty()
    return Response.json({ data }, { headers })
  } catch {
    return empty()
  }
}
