'use client'
import { useEffect, useRef } from 'react'
import type { ExpressionSpecification } from 'maplibre-gl'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

type Row = {
  id?: string
  title?: string | null
  allocated?: number | string | null
  lat?: number | string | null
  lng?: number | string | null
  source_link?: string | null
  photo_url?: string | null
  date?: string | null
  year?: string | null
  district?: string | null
}

const YEAR = '2026-2027'
const CENTER: [number, number] = [20.59, 78.96]
const RAMP: ExpressionSpecification = ['interpolate', ['linear'], ['get', 'allocated'], 0, '#ffffff', 1000000, '#A05A3C']

async function fetchRows(): Promise<Row[]> {
  try {
    const response = await fetch(`/api/v1/development?year=${encodeURIComponent(YEAR)}`)
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload?.data) ? payload.data : []
  } catch {
    return []
  }
}

function validPoint(row: Row): [number, number] | null {
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return [lat, lng]
}

function pointColor(allocated: unknown) {
  const value = Number(allocated)
  if (!Number.isFinite(value) || value <= 0) return '#4c8dff'
  if (value >= 1000000) return '#A05A3C'
  const t = value / 1000000
  const r = Math.round(255 + (160 - 255) * t)
  const g = Math.round(255 + (90 - 255) * t)
  const b = Math.round(255 + (60 - 255) * t)
  return `rgb(${r}, ${g}, ${b})`
}

function popupContent(row: Row) {
  const box = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = row.title || 'Development record'
  const line = document.createElement('p')
  const place = row.district ? `${row.district}, ` : ''
  const amount = Number(row.allocated)
  line.textContent = `${place}${Number.isFinite(amount) ? amount.toLocaleString('en-IN') : 'Amount not published'}`
  box.append(title, line)
  return box
}

function mapLibreBounds(features: { geometry: { coordinates: number[] } }[]) {
  const bounds: [[number, number], [number, number]] = [[180, 90], [-180, -90]]
  for (const feature of features) {
    const [lng, lat] = feature.geometry.coordinates
    bounds[0][0] = Math.min(bounds[0][0], lng)
    bounds[0][1] = Math.min(bounds[0][1], lat)
    bounds[1][0] = Math.max(bounds[1][0], lng)
    bounds[1][1] = Math.max(bounds[1][1], lat)
  }
  return bounds
}

async function startLeaflet(node: HTMLElement, rows: Row[]) {
  const module = await import('leaflet')
  const L = module.default
  ;(window as unknown as { L: typeof L }).L = L
  await import('leaflet.markercluster').catch(() => null)
  const map = L.map(node, { center: CENTER, zoom: 4, minZoom: 3, maxZoom: 18 })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map)
  const group =
    typeof (L as unknown as { markerClusterGroup?: () => L.LayerGroup }).markerClusterGroup === 'function'
      ? (L as unknown as { markerClusterGroup: () => L.LayerGroup }).markerClusterGroup()
      : L.layerGroup()
  const points: [number, number][] = []
  for (const row of rows) {
    const point = validPoint(row)
    if (!point) continue
    const marker = L.circleMarker(point, {
      radius: 6,
      color: '#ffffff',
      weight: 1,
      fillColor: pointColor(row.allocated),
      fillOpacity: 0.9,
    })
    marker.bindPopup(() => popupContent(row))
    group.addLayer(marker)
    points.push(point)
  }
  group.addTo(map)
  if (points.length > 0) {
    try {
      map.fitBounds(L.latLngBounds(points).pad(0.15), { maxZoom: 9 })
    } catch {
      // Ignore canvas sizing failures.
    }
  }
  return () => map.remove()
}

async function startMapLibre(node: HTMLElement, rows: Row[]) {
  const maplibregl = await import('maplibre-gl')
  const features = rows.flatMap((row) => {
    const point = validPoint(row)
    if (!point) return []
    return [
      {
        type: 'Feature' as const,
        properties: { title: row.title, allocated: Number(row.allocated) || 0 },
        geometry: { type: 'Point' as const, coordinates: [point[1], point[0]] },
      },
    ]
  })
  const map = new maplibregl.Map({
    container: node,
    center: [CENTER[1], CENTER[0]],
    zoom: 4,
    style: {
      version: 8,
      glyphs: '/fonts/{fontstack}/{range}.pbf',
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        },
        development: {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        },
      },
      layers: [
        { id: 'osm', type: 'raster', source: 'osm' },
        { id: 'hisaab-india-clip', type: 'fill', source: 'development', paint: { 'fill-opacity': 0 } },
        {
          id: 'hisaab-funding-fill',
          type: 'fill',
          source: 'development',
          paint: { 'fill-color': RAMP, 'fill-opacity': 0.25 },
        },
        {
          id: 'development-points',
          type: 'circle',
          source: 'development',
          paint: {
            'circle-color': RAMP,
            'circle-radius': 6,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#ffffff',
          },
        },
      ],
    },
  })
  map.on('error', (event: { error?: { message?: string } }) => {
    const message = event?.error?.message ?? ''
    if (message.includes('fit within canvas') || /glyph/i.test(message)) return
  })
  map.on('load', () => {
    if (features.length === 0) return
    try {
      map.fitBounds(mapLibreBounds(features), { padding: 40, maxZoom: 9 })
    } catch {
      // Ignore canvas sizing failures.
    }
  })
  return () => map.remove()
}

export function EvidenceMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let cancelled = false
    let destroy = () => {}
    async function start() {
      const rows = await fetchRows()
      const node = mapRef.current
      if (cancelled || !node) return
      let cleanup: () => void
      try {
        cleanup = await startLeaflet(node, rows)
      } catch {
        try {
          cleanup = await startMapLibre(node, rows)
        } catch {
          return
        }
      }
      if (cancelled) {
        cleanup()
        return
      }
      destroy = cleanup
    }
    void start()
    return () => {
      cancelled = true
      destroy()
    }
  }, [])
  return <div ref={mapRef} style={{ width: '100%', height: '100vh' }} />
}
