// Expansion probe (does NOT touch Stockholm's data): downloads Göteborg's and Malmö's open parking data
// and writes a coverage report to cities/probe-report.md. Raw downloads are saved gzipped in cities/raw/
// (expansion branches only) so importers can be developed and tested offline.
//   GOTEBORG_APPID=... node cities/probe.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
const save = (f, txt) => fs.writeFileSync(f + '.gz', zlib.gzipSync(txt, { level: 9 }));

const KEY = process.env.GOTEBORG_APPID;
fs.mkdirSync('cities/raw', { recursive: true });
const out = [`# City probe report`, ``, `Run: ${new Date().toISOString()}`, ``];
const mask = (s) => (KEY ? String(s).split(KEY).join('***') : String(s));

async function get(url, binary = false) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'Parky/2.0 (parkeringsapp; open data check)', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return binary ? Buffer.from(await r.arrayBuffer()) : r.text();
}

// Fill rate and a few distinct example values per field.
function profile(rows) {
  const fields = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (k === 'WKT' || k === 'geometry') continue;
    const f = (fields[k] ||= { n: 0, ex: new Set() });
    if (v !== null && v !== '' && v !== undefined) { f.n++; if (f.ex.size < 6) f.ex.add(String(v).slice(0, 70)); }
  }
  return Object.entries(fields).map(([k, f]) => `| ${k} | ${Math.round((100 * f.n) / rows.length)}% | ${[...f.ex].join(' · ').replace(/\|/g, '/')} |`);
}

// ---- Göteborg ParkingService v2.3
out.push('## Göteborg (data.goteborg.se ParkingService v2.3)', '');
if (!KEY) out.push('No GOTEBORG_APPID secret available – skipped.', '');
else {
  const ops = ['PublicTimeParkings', 'PublicTollParkings', 'ResidentialParkings', 'CleaningZones', 'HandicapParkings', 'MCParkings', 'TruckParkings', 'PrivateTollParkings'];
  for (const op of ops) {
    try {
      const txt = await get(`https://data.goteborg.se/ParkingService/v2.3/${op}/${KEY}?format=JSON`);
      save(`cities/raw/gbg-${op}.json`, txt);
      const rows = JSON.parse(txt);
      const geo = {};
      for (const r of rows) { const t = (r.WKT || 'none').match(/^[A-Z]+/)?.[0] || 'none'; geo[t] = (geo[t] || 0) + 1; }
      out.push(`### ${op}: ${rows.length} rows`, ``, `Geometry: ${Object.entries(geo).map(([k, v]) => `${k} ${v}`).join(', ')}`, ``,
        `| Field | Filled | Examples |`, `|---|---|---|`, ...profile(rows), ``);
      if (rows[0]?.WKT) out.push('Example WKT: `' + rows[0].WKT.slice(0, 160) + '…`', '');
    } catch (e) { out.push(`### ${op}: ERROR ${mask(e.message)}`, ''); }
  }
}

// ---- Malmö open data (CKAN)
out.push('## Malmö (opendata-api.malmo.se)', '');
const malmo = {
  miljoparkering: 'https://opendata-api.malmo.se/dataset/c3f1cdfd-fd67-4b3f-ba96-d97c00339b6a/resource/73490f00-0d71-4b17-903c-f77ab7664a53/download/miljoparkeringar.geojson',
  parkeringsavgifter: 'https://opendata-api.malmo.se/dataset/c06939a6-65b4-4078-9cb5-b49aa48b9140/resource/1a6bd68b-30ca-40a5-9d62-01e2a566982e/download/parkeringsavgifter.geojson',
};
for (const [name, url] of Object.entries(malmo)) {
  try {
    const txt = await get(url);
    save(`cities/raw/malmo-${name}.geojson`, txt);
    const fc = JSON.parse(txt);
    const geo = {};
    for (const f of fc.features) geo[f.geometry?.type || 'none'] = (geo[f.geometry?.type || 'none'] || 0) + 1;
    out.push(`### ${name}: ${fc.features.length} features`, ``, `Geometry: ${Object.entries(geo).map(([k, v]) => `${k} ${v}`).join(', ')}`, ``,
      `| Field | Filled | Examples |`, `|---|---|---|`, ...profile(fc.features.map((f) => f.properties || {})), ``);
  } catch (e) { out.push(`### ${name}: ERROR ${e.message}`, ''); }
}

fs.writeFileSync('cities/probe-report.md', mask(out.join('\n')) + '\n');
console.log(mask(out.join('\n')).slice(0, 20000));
