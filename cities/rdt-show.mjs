// Shows a regulation's text (from rdt/texts) and what the parser reads from it.
//   node cities/rdt-show.mjs "0581 2025-61" ["1290 2013-00023" …]   (from the repo root)
import zlib from 'node:zlib'; import fs from 'node:fs';
import { parseRegulation, ruleText } from '../engine/regulation.js';
const cache = {};
const body = (c) => { const k = c.slice(0, 4); cache[k] ||= zlib.gunzipSync(fs.readFileSync(`rdt/texts/${k}.jsonl.gz`)).toString().split('\n').filter(Boolean).map(JSON.parse); return cache[k].find((x) => x.c === c)?.body; };
for (const c of process.argv.slice(2)) { const b = body(c); if (!b) { console.log(c, 'no text'); continue; }
  const p = parseRegulation(b); const t = ruleText(b) || '';
  console.log('##', c, '\n ', t.replace(/^.*?följande\.?/s, '').slice(0, 420));
  console.log('  →', JSON.stringify({ taxa: p.taxa, limits: p.limits, bans: p.bans, allowOnly: p.allowOnly, dp: p.dp, reserved: p.reserved, unread: p.unread.map((u) => u.slice(0, 60)) })); }
