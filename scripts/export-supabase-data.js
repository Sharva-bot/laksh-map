// scripts/export-supabase-data.js
// ---------------------------------------------------------------
// Pulls all rows from the Supabase `development` table and writes
// them to `supabase-data.json` in the project root.
// ---------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('❌ Supabase URL or service key missing in .env.local');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: { fetch: (i, o) => fetch(i, { ...o, signal: AbortSignal.timeout(15000) }) }
});

(async () => {
  try {
    const { data, error } = await supabase.from('development').select('*');
    if (error) throw error;
    const outPath = path.resolve(__dirname, '..', 'supabase-data.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`✅ Exported ${data.length} rows to ${outPath}`);
  } catch (e) {
    console.error('❌ Failed to fetch data:', e);
    process.exit(1);
  }
})();
