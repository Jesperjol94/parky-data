// Dates and temporary regulations (cities/rdt-temp.mjs). The texts are shortened from the real ones (Uppsala Österplan).
import test from 'node:test';
import assert from 'node:assert/strict';
import { temp, suspensions, sides, oppositeSides, cutLine } from '../rdt-temp.mjs';

const TODAY = '2026-11-20';
// a street running east: 1 m ≈ 0.0000179° of longitude at 59.86° N; `dy` moves the line north in metres
const line = (x0, x1, dy = 0) => [[17.64 + x0 * 0.0000179, 59.86 + dy * 0.00000904], [17.64 + x1 * 0.0000179, 59.86 + dy * 0.00000904]];
const city = (segments) => ({ city: 'uppsala', bounds: { w: 17.6, e: 17.7, s: 59.8, n: 59.9 }, segments });
const BAN = 'På den del av Österplan som anges i kartan får fordon inte stannas eller parkeras.';
const rec = (c, body, from, to = null, rubrik = 'Uppsala kommuns lokala trafikföreskrifter om parkering på Österplan') => ({ c, body, from, to, rubrik });
const seg = (i, c, g, more = {}) => ({ i, c, n: 'Österplan', g, t: 0, ...more });
const allDayBan = (s) => (s.f || []).some((w) => w.a === 0 && w.b === 1440);

test('a regulation that has ended is dropped: the line\'s end date or the text\'s', () => {
  const c = city([seg(1, '0380 2011-634', line(0, 50), { f: [{ dt: ['vardag'], a: 480, b: 1020 }] }), seg(2, '0380 2026-10', line(0, 50, 30), { to: '2026-10-31' }), seg(3, '0380 2026-11', line(0, 50, 60), { to: '2026-11-20' }), seg(4, '0380 2020-1', line(0, 50, 90))]);
  const st = temp(c, [rec('0380 2011-634', 'På södra sidan av Skolgatan får inte fordon parkeras.', '2011-08-08', '2011-08-26')], TODAY);
  assert.equal(st.ended, 2);
  assert.deepEqual(c.segments.map((s) => s.i), [3, 4]); // the one ending today still applies today
});

test('a regulation not yet in force is parked and comes back on its first day; a typed year 3010 is no start date', () => {
  const texts = [rec('0380 2026-600', 'På Österplan får fordon parkeras.', '2026-11-27'), rec('0380 2010-577', 'På Österplan får fordon parkeras.', '3010-03-10')];
  const c = city([seg(1, '0380 2026-600', line(0, 50)), seg(2, '0380 2010-577', line(0, 50, 30))]);
  assert.equal(temp(c, texts, TODAY).notYet, 1);
  assert.deepEqual(c.segments.map((s) => s.i), [2]); assert.equal(c.parked.length, 1);
  const st = temp(c, texts, '2026-11-27');
  assert.equal(st.back, 1); assert.deepEqual(c.segments.map((s) => s.i).sort(), [1, 2]); assert.equal(c.parked, undefined);
});

test('"ska inte tillämpas mellan …": the named regulation is parked while the temporary one applies', () => {
  const texts = [
    rec('0380 2024-534', 'På de delar av Österplan som anges i kartan får fordon parkeras.', '2024-10-09'),
    rec('0380 2024-598', `1 § ${BAN} 2 § Del av Uppsala kommuns lokala trafikföreskrifter (0380 2022:64) om ändamålsplats på Österplan ska inte tillämpas under perioden. Dessa föreskrifter träder i kraft den 27 november 2024 klockan 07:00 och upphör att gälla den 28 februari 2027 klockan 16:00. Uppsala kommuns lokala trafikföreskrifter (0380 2024:534) om parkering på Österplan ska inte tillämpas mellan 27 november 2024 klockan 07.00 och 28 februari 2027 klockan 16.00.`, '2024-11-27', '2027-02-28'),
    rec('0380 2022-64', 'På Österplan får endast fordon i taxitrafik parkeras.', '2022-02-23', null, 'Uppsala kommuns lokala trafikföreskrifter om ändamålsplats på Österplan'),
  ];
  const sus = suspensions(texts, TODAY);
  assert.deepEqual([...sus.keys()], ['0380 2024-534']); // "Del av … 2022:64" is a part only
  assert.deepEqual(sus.get('0380 2024-534'), { by: '0380 2024-598', until: '2027-02-28' });
  const c = city([seg(1, '0380 2024-534', line(0, 50, 200), { fu: 1 }), seg(2, '0380 2022-64', line(0, 50, 300))]);
  assert.equal(temp(c, texts, TODAY).suspended, 1);
  assert.deepEqual(c.segments.map((s) => s.i), [2]); assert.equal(c.parked[0].pk.why, 'suspended');
  const again = JSON.stringify(c); temp(c, texts, TODAY); assert.equal(JSON.stringify(c), again); // idempotent
  assert.equal(temp(c, texts, '2027-03-01').back, 1); // the period is over (the temporary text has ended too)
  assert.deepEqual(c.segments.map((s) => s.i).sort(), [1, 2]);
});

test('a suspension that names another place than the cited regulation is a mistyped number: left alone', () => {
  const texts = [rec('0380 2020-9', 'På Storgatan får fordon parkeras.', '2020-01-01', null, 'Uppsala kommuns lokala trafikföreskrifter om parkering på Storgatan'),
    rec('0380 2026-1', `${BAN} Uppsala kommuns lokala trafikföreskrifter (0380 2020:9) om parkering på Österplan ska inte tillämpas mellan 1 november 2026 och 28 februari 2027.`, '2026-11-01', '2027-02-28')];
  assert.equal(suspensions(texts, TODAY).size, 0);
});

test('roadworks: a temporary all-day ban is laid on the older lines along it, and lifted when it ends', () => {
  const texts = [rec('0380 2022-66', 'På Österplan norr om S:t Olofsgatan får fordon parkeras och mot avgift.', '2022-02-23'), rec('0380 2026-520', BAN, '2026-09-07', '2027-02-28', 'Uppsala kommuns föreskrifter om förbud att stanna eller parkera på Österplan')];
  const c = city([
    seg(1, '0380 2022-66', line(0, 100, 3), { fu: 1 }),   // 3 m beside the ban, all of it
    seg(2, '0380 2022-66', line(0, 100, 20), { fu: 1 }),  // 20 m away: another carriageway
    seg(3, '0380 2022-66', line(60, 160), { fu: 1 }),     // the ban covers its first 40 m
    seg(9, '0380 2026-520', line(0, 100), { f: [{ a: 0, b: 1440 }], sb: 1, to: '2027-02-28' }),
  ]);
  const st = temp(c, texts, TODAY);
  assert.equal(st.lines, 2); assert.equal(st.cut, 1);
  const by = (i) => c.segments.find((s) => s.i === i);
  assert.deepEqual(by(1).f, [{ a: 0, b: 1440, ov: 2, to: '2027-02-28' }]); assert.deepEqual(by(1).tb, ['0380 2026-520', '2027-02-28']);
  assert.equal(by(2).f, undefined);
  const pieces = c.segments.filter((s) => s.c === '0380 2022-66' && s.g[0][1] === 59.86).sort((a, b) => a.g[0][0] - b.g[0][0]);
  assert.equal(pieces.length, 2); assert.ok(allDayBan(pieces[0])); assert.ok(!allDayBan(pieces[1]));
  const cutAt = (pieces[0].g[1][0] - 17.64) / 0.0000179; assert.ok(cutAt >= 100 && cutAt < 108, `cut where the ban ends (100 m) or a few metres past it, never before: ${cutAt}`);
  assert.equal(new Set(c.segments.map((s) => s.i)).size, c.segments.length);
  const again = JSON.stringify(c); temp(c, texts, TODAY); assert.equal(JSON.stringify(c), again); // idempotent
  temp(c, texts, '2027-03-01'); // the ban has ended: its own line is gone and nothing stays banned
  assert.ok(c.segments.every((s) => s.c === '0380 2022-66' && !s.f && !s.tb));
});

test('roadworks: the opposite side of the street, a crossing street and an uncertain ban are left alone', () => {
  const texts = [rec('0764 2020-1', 'På östra sidan på Tingsgatan får fordon parkeras under högst 2 tim i följd.', '2020-06-09'), rec('0764 2026-35', 'På västra sidan på Tingsgatan får fordon inte parkeras.', '2026-06-09', '2027-06-08'),
    rec('0764 2019-2', 'På Storgatan får fordon parkeras.', '2019-01-01'), rec('0764 2026-40', 'På Kyrkogatan får fordon inte parkeras.', '2026-06-09', '2027-06-08')];
  const crossing = [[17.64 + 50 * 0.0000179, 59.86 - 50 * 0.00000904], [17.64 + 50 * 0.0000179, 59.86 + 50 * 0.00000904]];
  const c = city([seg(1, '0764 2020-1', line(0, 100, 2)), seg(2, '0764 2019-2', crossing), seg(3, '0764 2019-2', line(0, 100, 502)),
    seg(8, '0764 2026-35', line(0, 100), { f: [{ a: 0, b: 1440 }], to: '2027-06-08' }), seg(9, '0764 2026-40', line(0, 100, 500), { f: [{ a: 0, b: 1440 }], to: '2027-06-08', u: 1 })]);
  assert.equal(temp(c, texts, TODAY).lines, 0);
  assert.ok(c.segments.every((s) => !s.tb));
  assert.ok(oppositeSides(sides('På östra sidan av gatan'), sides('På västra gatusidan'))); // "östra": \b would miss the ö
  assert.ok(!oppositeSides(sides('På norra sidan'), sides('På nordöstra sidan'))); assert.ok(!oppositeSides(sides('På Storgatan'), sides('På södra sidan')));
});

test('roadworks: a regulation as new as the ban goes grey, one the ban names is banned, a newer temporary permission stays', () => {
  const texts = [rec('1880 2025-217', 'Inom rödmarkerad yta på Engelbrektsgatans norra sida får fordon parkeras.', '2025-04-14'), rec('1880 2025-79', 'Inom gulmarkerat område på Engelbrektsgatans norra sida får fordon inte stannas eller parkeras.', '2025-04-16', '2027-01-01'),
    rec('1880 2025-1310', 'På Lövstagatans östra sida får fordon parkeras.', '2026-09-01'), rec('1880 2026-1150', 'På Lövstagatans östra sida får fordon, med avvikelse från Örebro kommuns lokala trafikföreskrifter 1880 2025:01310 om parkering, inte stannas eller parkeras.', '2026-09-20', '2026-12-02'),
    rec('0380 2026-519', 'På den del av Österplan som anges i kartan får fordon parkeras.', '2026-09-07', '2027-02-28'), rec('0380 2024-599', BAN, '2024-11-27', '2027-02-28')];
  const c = city([seg(1, '1880 2025-217', line(0, 100, 2)), seg(7, '1880 2025-79', line(0, 100), { f: [{ a: 0, b: 1440 }], to: '2027-01-01' }),
    seg(2, '1880 2025-1310', line(0, 100, 202)), seg(8, '1880 2026-1150', line(0, 100, 200), { f: [{ a: 0, b: 1440 }], to: '2026-12-02' }),
    seg(3, '0380 2026-519', line(0, 100, 402), { to: '2027-02-28' }), seg(9, '0380 2024-599', line(0, 100, 400), { f: [{ a: 0, b: 1440 }], to: '2027-02-28' })]);
  const st = temp(c, texts, TODAY); const by = (i) => c.segments.find((s) => s.i === i);
  assert.equal(st.unsure, 1); assert.equal(by(1).u, 1); assert.deepEqual(by(1).tb, ['1880 2025-79', '2027-01-01', 'u']); assert.equal(by(1).f, undefined);
  assert.equal(st.lines, 1); assert.ok(allDayBan(by(2)));
  assert.equal(by(3).f, undefined); assert.equal(by(3).u, undefined);
  temp(c, texts, '2027-01-02'); assert.equal(by(1).u, undefined); // the grey goes when the ban has ended
});

test('cutLine cuts at distances along the line', () => {
  const g = [[0, 0], [0.001, 0], [0.002, 0]], pts = [[0, 0], [100, 0], [200, 0]];
  const parts = cutLine(g, pts, [50, 150]);
  assert.deepEqual(parts, [[[0, 0], [0.0005, 0]], [[0.0005, 0], [0.001, 0], [0.0015, 0]], [[0.0015, 0], [0.002, 0]]]);
});
