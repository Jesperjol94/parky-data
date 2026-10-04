// Downloads Stockholm's "parkering tillåten" layer (LTF-Tolken, open data) to raw/ptillaten.json.gz.
// Needs STOCKHOLM_API_KEY; the key is never written to disk or logs.
import fs from 'node:fs';
import zlib from 'node:zlib';
const KEY = process.env.STOCKHOLM_API_KEY;
if (!KEY) { console.error('STOCKHOLM_API_KEY missing'); process.exit(1); }
const url = `https://openparking.stockholm.se/LTF-Tolken/v1/ptillaten/wfs?apiKey=${KEY}&service=WFS&version=1.1.0&request=GetFeature&typeName=ltfr:LTFR_P_TILLATEN&outputFormat=json`;
const redact = (s) => String(s).split(KEY).join('***');
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
    const text = await r.text();
    if (r.status !== 200) throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`);
    const j = JSON.parse(text);
    const n = (j.features || []).length;
    const layer = String(j.features?.[0]?.id || '').split('.')[0];
    if (n < 10000 || !layer.endsWith('LTFR_P_TILLATEN')) throw new Error(`unexpected answer: ${n} features, layer ${layer}`);
    fs.mkdirSync('raw', { recursive: true });
    fs.writeFileSync('raw/ptillaten.json.gz', zlib.gzipSync(text));
    console.log('ptillaten', n, 'features');
    process.exit(0);
  } catch (e) {
    console.log(`attempt ${attempt}: ${redact(e.message)}`);
    await new Promise((res) => setTimeout(res, 20000));
  }
}
process.exit(1);
