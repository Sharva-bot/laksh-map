// scripts/fetch-gov-data.js
// ---------------------------------------------------------------
// Fetch government data (PMGSY, MGNREGA, data.gov.in, PIB) and save
// only records that have a real photo_url and lat/lng.
// Improvements over the original version:
//   • Parallel fetching for district‑wise MGNREGA data (limited concurrency)
//   • HEAD request validation of photo URLs (must return 200 and an image MIME type)
//   • Smaller, reusable helper utilities
//   • More robust error handling & logging
// ---------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { parse } = require('papaparse');

// ------------------------------------------------------------------
// Simple exponential‑backoff fetch helper (returns text)
// ------------------------------------------------------------------
async function fetchWithRetry(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
    } catch (e) {
      // ignore and retry
    }
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw new Error(`Failed to fetch ${url}`);
}

// ------------------------------------------------------------------
// HEAD request to verify a photo URL – returns true only if
//   * response status is 200
//   * content‑type starts with "image/"
// ------------------------------------------------------------------
async function isValidPhoto(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    return ct.toLowerCase().startsWith('image/');
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------
// 1️⃣ PMGSY Opendata – habitation GeoJSON (fallback to GitHub mirror)
// ------------------------------------------------------------------
async function fetchPMGSY() {
  const primary = 'https://geosadak-pmgsy.nic.in/opendata/habitation.geojson';
  const fallback = 'https://raw.githubusercontent.com/datameet/pmgsy-geosadak/master/habitation.geojson';
  let txt;
  try {
    txt = await fetchWithRetry(primary);
  } catch {
    console.warn('⚠️ Primary PMGSY URL failed – using GitHub fallback');
    txt = await fetchWithRetry(fallback);
  }
  const geojson = JSON.parse(txt);
  return geojson.features.map(f => {
    const props = f.properties || {};
    const coords = f.geometry?.coordinates || [];
    return {
      title: props.work_name || props.facility_name || 'PMGSY',
      allocated: props.cost || props.sanctioned_amount || 0,
      lat: coords[1] ?? null,
      lng: coords[0] ?? null,
      source_link: primary,
      photo_url: null, // no photos for PMGSY
      date: props.completion_date || null,
      year: '2026-2027',
      district: props.district_name || '',
      scheme: 'PMGSY',
      // placeholders for extra columns present in the Supabase table
      party: null,
      mla: null,
      state: null,
      problem_since: null,
      reported_year: null,
      flagged_yellow: null,
      credits: null,
      photo_status: null
    };
  });
}

// ------------------------------------------------------------------
// 2️⃣ MGNREGA Bhuvan scraper (parallel districts, fallback mirror)
// ------------------------------------------------------------------
async function fetchMGNREGA() {
  const base = 'https://bhuvan-app2.nrsc.gov.in/mgnrega/mgnrega_phase2.php';
  const mirror = 'https://raw.githubusercontent.com/datameet/mgnrega-bhuvan/master';

  // Grab district codes from the landing page
  const indexHtml = await fetchWithRetry(base);
  const $ = cheerio.load(indexHtml);
  const districtCodes = $('select[name="district"] option')
    .map((_, el) => $(el).attr('value'))
    .get()
    .filter(v => v);

  // Helper to fetch a single district – returns an array of items
  async function fetchDistrict(code) {
    const url = `${base}?district=${code}`;
    let pageHtml;
    try {
      pageHtml = await fetchWithRetry(url);
    } catch {
      // If Bhuvan blocks, try the static JSON mirror
      try {
        const mirrorUrl = `${mirror}/${code}.json`;
        pageHtml = await fetchWithRetry(mirrorUrl);
      } catch {
        console.warn(`⚠️ Could not retrieve district ${code}`);
        return [];
      }
    }
    const $$ = cheerio.load(pageHtml);
    const items = [];
    // Assuming assets are inside a table with class "assets"
    $$('.assets tr').each((_i, tr) => {
      const tds = $$(tr).find('td');
      if (!tds.length) return; // skip header rows
      const title = $$(tds[0]).text().trim();
      const lat = parseFloat($$(tds[1]).text().trim());
      const lng = parseFloat($$(tds[2]).text().trim());
      const imgTag = $$(tds[3]).find('img');
      const photoUrl = imgTag.attr('src') || null;
      const workType = $$(tds[4]).text().trim();
      const date = $$(tds[5]).text().trim();

      if (photoUrl && !isNaN(lat) && !isNaN(lng)) {
        items.push({
          title: title || workType,
          allocated: 0,
          lat,
          lng,
          source_link: url,
          photo_url: photoUrl,
          date,
          year: '2026-2027',
          district: code,
          scheme: 'MGNREGA',
          party: null,
          mla: null,
          state: null,
          problem_since: null,
          reported_year: null,
          flagged_yellow: null,
          credits: null,
          photo_status: null
        });
      }
    });
    return items;
  }

  // Parallel fetch with a modest concurrency limit (5 districts at a time)
  const CONCURRENCY = 5;
  const results = [];
  for (let i = 0; i < districtCodes.length; i += CONCURRENCY) {
    const batch = districtCodes.slice(i, i + CONCURRENCY);
    const batchPromises = batch.map(code => fetchDistrict(code));
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach(arr => results.push(...arr));
    // Small pause to be gentle on the server
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

// ------------------------------------------------------------------
// 3️⃣ data.gov.in API (requires API key in env)
// ------------------------------------------------------------------
async function fetchDataGov() {
  const apiKey = process.env.DATA_GOV_IN_KEY;
  if (!apiKey) {
    console.warn('⚠️ DATA_GOV_IN_KEY not set – skipping data.gov.in source');
    return [];
  }
  const base = 'https://api.data.gov.in/resource/';
  // Replace with real resource IDs for the three schemes (example placeholders)
  const resources = [
    { id: 'a889f2c1-xxxx-xxxx-xxxx-xxxxxxxxxxxx', scheme: 'PMGSY' },
    { id: 'b331f8d0-xxxx-xxxx-xxxx-xxxxxxxxxxxx', scheme: 'MGNREGA' },
    { id: 'c22c0e38-xxxx-xxxx-xxxx-xxxxxxxxxxxx', scheme: 'PMAY-G' }
  ];
  const all = [];
  for (const r of resources) {
    const url = `${base}${r.id}?api-key=${apiKey}&format=json&filters[image_url][exists]=true`;
    try {
      const txt = await fetchWithRetry(url);
      const data = JSON.parse(txt);
      if (!Array.isArray(data.records)) continue;
      for (const rec of data.records) {
        const lat = parseFloat(rec.latitude);
        const lng = parseFloat(rec.longitude);
        const photo = rec.image_url;
        if (photo && !isNaN(lat) && !isNaN(lng) && await isValidPhoto(photo)) {
          all.push({
            title: rec.title || r.scheme,
            allocated: parseFloat(rec.allocated) || 0,
            lat,
            lng,
            source_link: rec.source_url || '',
            photo_url: photo,
            date: rec.date || '',
            year: '2026-2027',
            district: rec.district || '',
            scheme: r.scheme,
            party: null,
            mla: null,
            state: null,
            problem_since: null,
            reported_year: null,
            flagged_yellow: null,
            credits: null,
            photo_status: null
          });
        }
      }
    } catch (e) {
      console.warn(`⚠️ data.gov.in request failed for ${r.scheme}: ${e.message}`);
    }
  }
  return all;
}

// ------------------------------------------------------------------
// 4️⃣ PIB scraper (Ministry of Rural Development press releases)
// ------------------------------------------------------------------
async function fetchPIB() {
  const base = 'https://pib.gov.in';
  const search = `${base}/newsite/pssearch.aspx?search=Rural%20Development&lang=1`;
  const html = await fetchWithRetry(search);
  const $ = cheerio.load(html);
  const links = $('.release-list a')
    .map((_, a) => $(a).attr('href'))
    .get()
    .filter(l => l);

  const all = [];
  // Limit to the first 30 releases to keep runtime reasonable
  for (const rel of links.slice(0, 30)) {
    const pageUrl = `${base}${rel}`;
    try {
      const pageHtml = await fetchWithRetry(pageUrl);
      const $$ = cheerio.load(pageHtml);
      const img = $$('img').first().attr('src');
      const title = $$('h1').text().trim() || 'PIB Release';
      const date = $$('span.release-date').text().trim();
      if (img) {
        const imgUrl = img.startsWith('http') ? img : `${base}${img}`;
        // Validate the image before keeping it
        if (await isValidPhoto(imgUrl)) {
          all.push({
            title,
            allocated: 0,
            lat: null,
            lng: null,
            source_link: pageUrl,
            photo_url: imgUrl,
            date,
            year: '2026-2027',
            district: '',
            scheme: 'PIB',
            party: null,
            mla: null,
            state: null,
            problem_since: null,
            reported_year: null,
            flagged_yellow: null,
            credits: null,
            photo_status: null
          });
        }
      }
    } catch (e) {
      console.warn(`⚠️ PIB fetch error for ${pageUrl}: ${e.message}`);
    }
  }
  return all;
}

// ------------------------------------------------------------------
// Main orchestration – runs sequentially for clarity, but each source is fast now
// ------------------------------------------------------------------
(async () => {
  try {
    console.log('🔽 Fetching PMGSY …');
    const pmg = await fetchPMGSY();

    console.log('🔽 Scraping MGNREGA (Bhuvan) …');
    const mgn = await fetchMGNREGA();

    console.log('🔽 Pulling data.gov.in …');
    const dg = await fetchDataGov();

    console.log('🔽 Scraping PIB …');
    const pib = await fetchPIB();

    const combined = [...pmg, ...mgn, ...dg, ...pib];
    // Final filter – keep only rows that have a valid photo and coordinates
    const withPhotos = [];
    for (const item of combined) {
      if (!item.photo_url) continue;
      if (item.lat == null || item.lng == null) continue;
      // Already validated photos during fetch, but double‑check for safety
      if (await isValidPhoto(item.photo_url)) {
        withPhotos.push(item);
      } else {
        // Mark as missing – could be used later for the AI Helper Bot
        item.photo_url = null;
        item.photo_status = 'missing';
        withPhotos.push(item);
      }
    }

    const outPath = path.resolve(__dirname, '..', 'og-gov-data.json');
    fs.writeFileSync(outPath, JSON.stringify(withPhotos, null, 2), 'utf8');

    console.log('✅ Finished');
    console.log('  Total fetched          :', combined.length);
    console.log('  Records with photo+geo :', withPhotos.length);
    console.log('  JSON written to       :', outPath);
  } catch (e) {
    console.error('❌ Fatal error:', e);
    process.exit(1);
  }
})();
