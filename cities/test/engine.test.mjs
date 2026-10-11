// End-to-end: the built city files read through the APP's own rule engine (parky-beta/engine), checked against
// the city's texts. Needs a checkout of parky-beta: PARKY_ENGINE=/path/to/parky-beta/engine (skipped otherwise).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.PARKY_ENGINE || path.resolve('../parky-beta/engine');
const have = fs.existsSync(path.join(dir, 'evaluate.js'));
const engine = have ? await import(path.join(dir, 'evaluate.js')) : null;
const taxa = have ? await import(path.join(dir, 'taxa.js')) : null;
const time = have ? await import(path.join(dir, 'time.js')) : null;
const load = (c) => (fs.existsSync(`cities/out/${c}.json`) ? JSON.parse(fs.readFileSync(`cities/out/${c}.json`)) : null);

// Local Swedish time → instant. 2026-10-13 is a Tuesday in ISO week 42 (even), 2026-10-20 week 43 (odd).
const at = (y, m, d, hh, mm = 0) => time.instant({ y, m, d }, hh * 60 + mm);
function city(c) {
  const f = load(c);
  if (f) Object.assign(taxa.TAXA, f.taxa); // what the app will do when it loads a city file
  return f;
}
const seg = (f, name, cit) => {
  const s = f.segments.find((x) => x.n === name && (!cit || x.c === cit));
  assert.ok(s, `${name} not in the file`);
  return s;
};
const state = (s, t) => engine.stateAt(s, t);

const gbg = have ? city('goteborg') : null;
test('Göteborg through the app engine', { skip: (!have && 'no parky-beta engine') || (!gbg && 'no build') }, () => {
  // Godhemsgatan (1480 2005-00518): free, max 30 min every day 07–23
  const god = seg(gbg, 'Godhemsgatan', '1480 2005-00518');
  assert.deepEqual(state(god, at(2026, 10, 13, 10)), { state: 'free', price: 0, max: 30, reason: null });
  assert.equal(state(god, at(2026, 10, 13, 23, 30)).max, null); // limit ends 23:00
  // Carnegiegatan (1480 2006-00358): cleaning Tuesday 09–12 odd weeks
  const car = seg(gbg, 'Carnegiegatan', '1480 2006-00358');
  assert.equal(state(car, at(2026, 10, 20, 10)).state, 'forbidden');
  assert.equal(state(car, at(2026, 10, 20, 10)).reason, 'Gatustädning (servicetid)');
  assert.equal(state(car, at(2026, 10, 13, 10)).state, 'free'); // even week
  // Sten Sturegatan (1480 2006-00908): Taxa 1 = 34 kr/h 8–22 every day, 2 kr/h other time; cleaning Friday 02–07
  const ste = seg(gbg, 'Sten Sturegatan', '1480 2006-00908');
  assert.equal(state(ste, at(2026, 10, 14, 12)).price, 34);
  assert.equal(state(ste, at(2026, 10, 18, 12)).price, 34); // Sunday too ("alla dagar")
  assert.equal(state(ste, at(2026, 10, 14, 23)).price, 2);
  assert.equal(state(ste, at(2026, 10, 16, 3)).state, 'forbidden');
  // Sannaplan (1480 2006-00254): cleaning Friday 09–12 even weeks, 1 Oct – 30 Apr only
  const san = seg(gbg, 'Sannaplan', '1480 2006-00254');
  assert.equal(state(san, at(2026, 10, 16, 10)).state, 'forbidden'); // week 42, October
  assert.equal(state(san, at(2027, 5, 21, 10)).state, 'free'); // week 20 (even), but May: out of season
  // Storgatan (1480 2024-02985): parking allowed only weekdays incl. Saturday 08–22, max 30 min
  const sto = seg(gbg, 'Storgatan', '1480 2024-02985');
  assert.equal(state(sto, at(2026, 10, 18, 10)).state, 'forbidden'); // Sunday
  assert.deepEqual(state(sto, at(2026, 10, 19, 10)), { state: 'free', price: 0, max: 30, reason: null });
  // Handicap spot: reserved
  assert.equal(state(seg(gbg, 'Änggårdsplatsen', '1480 2006-00780'), at(2026, 10, 13, 10)).state, 'reserved');
  // The answer card works end to end (must leave by the 30-minute limit)
  const a = engine.answer(god, at(2026, 10, 13, 10));
  assert.equal(a.mustLeave, at(2026, 10, 13, 10, 30));
});

const mal = have ? city('malmo') : null;
const byStart = (f, x, y) => { const s = f.segments.find((q) => q.g[0][0] === x && q.g[0][1] === y); assert.ok(s, `no curb starting at ${x},${y}`); return s; };
test('Malmö through the app engine', { skip: (!have && 'no parky-beta engine') || (!mal && 'no build') }, () => {
  // Curb in residents' area GK-Å: miljöparkering the 7th of every month 08–12, Taxa E (10 kr/h 8–20 (8–20), other time 2 kr/h)
  const e = byStart(mal, 12.93216, 55.5828);
  assert.equal(state(e, at(2026, 11, 7, 9)).state, 'forbidden'); // a Saturday: the ban applies every day
  assert.equal(state(e, at(2026, 11, 7, 12, 30)).price, 10); // ban over at 12, Saturday is "(8–20)"
  assert.equal(state(e, at(2026, 12, 7, 11, 59)).state, 'forbidden');
  assert.equal(state(e, at(2026, 11, 9, 9)).price, 10); // Monday
  assert.equal(state(e, at(2026, 11, 15, 9)).price, 2); // Sunday: other-time rate
  assert.equal(state(e, at(2026, 11, 9, 21)).price, 2);
  const a = engine.answer(e, at(2026, 11, 6, 20)); // Friday evening: must move by 08:00 the 7th
  assert.equal(a.until, at(2026, 11, 7, 8));
  // Once a year: 16 October 08–12 (Taxa D)
  const y = byStart(mal, 12.97773, 55.5914);
  assert.equal(state(y, at(2026, 10, 16, 9)).state, 'forbidden');
  assert.equal(state(y, at(2026, 11, 16, 9)).price, 15);
});
