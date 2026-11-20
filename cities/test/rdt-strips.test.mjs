// One parking strip, one line (cities/rdt-strips.mjs). Shapes are the ones in the register: Gävle Södra Rådmansgatan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { strips, ringAxis, pairDistance, freeParts } from '../rdt-strips.mjs';

// metres east/north of a corner in Gävle → lon/lat
const KX = 111320 * Math.cos(60.67 * Math.PI / 180), KY = 110574;
const P = (x, y) => [+(17.148 + x / KX).toFixed(7), +(60.67 + y / KY).toFixed(7)];
const M = (p) => [(p[0] - 17.148) * KX, (p[1] - 60.67) * KY];
const city = (segments) => ({ city: 'gavle', bounds: { w: 17.0, e: 17.3, s: 60.64, n: 60.70 }, segments });
const seg = (i, c, g, more = {}) => ({ i, c, n: 'Södra Rådmansgatan', g, t: 218000501, ...more });
const BAYS = 'På särskilt anordnade parkeringsplatser på östra sidan av Södra Rådmansgatan mellan Tullbomsgatan och Övre Bergsgatan får fordon parkeras.';

test('a thin ring becomes its centre line; a parking lot stays an outline', () => {
  const strip = [P(0, 0), P(45, 0), P(45, 6), P(0, 6), P(0, 0)], lot = [P(0, 100), P(40, 100), P(40, 130), P(0, 130), P(0, 100)];
  const c = city([seg(1, '2180 2026-180', strip), seg(2, '2180 2026-190', lot)]);
  const st = strips(c);
  assert.equal(st.rings, 1);
  const a = c.segments[0].g.map(M); assert.equal(a.length, 2); assert.equal(c.segments[0].sp, 1);
  assert.ok(Math.abs(a[0][1] - 3) < 0.3 && Math.abs(a[1][1] - 3) < 0.3, 'in the middle of the 6 m strip');
  assert.ok(Math.abs(Math.abs(a[1][0] - a[0][0]) - 45) < 1, 'as long as the strip');
  assert.equal(c.segments[1].g.length, 5); assert.equal(c.segments[1].sp, undefined);
  assert.equal(ringAxis([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]), null); // a square
  assert.equal(ringAxis([[0, 0], [50, 0], [50, 3]]), null);                    // not closed
});

test('the two long edges of a strip (out and back, or side by side) become the line between them', () => {
  const c = city([seg(705, '2180 2026-181', [P(36, 9), P(0, 9)]), seg(805, '2180 2026-181', [P(0, 4), P(36, 4)]),
    seg(10, '2180 2020-5', [P(0, 100), P(60, 100)], { t: 0 }), seg(11, '2180 2020-5', [P(0, 103), P(58, 103)], { t: 0 })]);
  const st = strips(c);
  assert.equal(st.pairs, 2); assert.equal(c.segments.length, 2);
  const a = c.segments.find((s) => s.c === '2180 2026-181'); assert.equal(a.sp, 1);
  for (const p of a.g.map(M)) assert.ok(Math.abs(p[1] - 6.5) < 0.3, `between the edges: ${p}`);
  assert.equal(c.segments.find((s) => s.c === '2180 2020-5').i, 10); // the longer line keeps its id
});

test('not a strip: other rules, another regulation, too far apart, or ends that do not meet', () => {
  const c = city([seg(1, '2180 2020-1', [P(0, 0), P(50, 0)]), seg(2, '2180 2020-1', [P(0, 4), P(50, 4)], { l: [{ a: 0, b: 1440, max: 120 }] }),
    seg(3, '2180 2020-2', [P(0, 4.5), P(50, 4.5)]), seg(4, '2180 2020-1', [P(0, 20), P(50, 20)]), seg(5, '2180 2020-1', [P(60, 3), P(110, 3)])]);
  assert.equal(strips(c).pairs, 0); assert.equal(c.segments.length, 5);
  assert.equal(pairDistance([[0, 0], [50, 0]], [[0, 12], [50, 12]]), null);
  assert.ok(Math.abs(pairDistance([[0, 0], [50, 0]], [[50, 5], [0, 5]]) - 5) < 0.01);
});

test('the road line of the same regulation is cut away beside the strip; a line that only bans is left whole', () => {
  const lines = (c, road, more = {}) => [seg(706, c, road, more), seg(705, c, [P(36, 9), P(0, 9)], more), seg(805, c, [P(0, 4), P(36, 4)], more)];
  // Gävle 2180 2026-181: the road's own line is hardly longer than the row of bays: one line is left
  const short = city(lines('2180 2026-181', [P(-5, 0), P(41, 0)])); const st = strips(short);
  assert.equal(st.beside, 1); assert.deepEqual(short.segments.map((s) => s.i), [705]);
  // a long street with one polygon keeps its line on both sides of the strip
  const long = city(lines('1489 2014-53', [P(-200, 0), P(240, 0)])); strips(long);
  const rest = long.segments.filter((s) => !s.sp).map((s) => s.g.map(M)).sort((a, b) => a[0][0] - b[0][0]);
  assert.equal(rest.length, 2); assert.equal(new Set(long.segments.map((s) => s.i)).size, 3);
  assert.ok(Math.abs(rest[0][0][0] + 200) < 0.5 && Math.abs(rest[0][1][0] + 2) < 2.5, `left part ends where the strip begins: ${rest[0]}`);
  assert.ok(Math.abs(rest[1][0][0] - 38) < 2.5 && Math.abs(rest[1][1][0] - 240) < 0.5, `right part starts where the strip ends: ${rest[1]}`);
  // "får inte parkeras": nothing is cut
  const ban = city(lines('2180 2026-9', [P(-5, 0), P(41, 0)], { t: 0, f: [{ a: 0, b: 1440 }] })); assert.equal(strips(ban).beside, 0);
  assert.deepEqual(ban.segments.map((s) => s.i).sort(), [705, 706]);
});

test('beside means alongside: a crossing line, a line 20 m away and a parking lot of the same regulation stay', () => {
  const lot = [P(0, 60), P(40, 60), P(40, 90), P(0, 90), P(0, 60)];
  const c = city([seg(1, '2180 2020-1', [P(0, 0), P(50, 0)]), seg(2, '2180 2020-1', [P(50, 3), P(0, 3)]), seg(3, '2180 2020-1', [P(25, -40), P(25, 40)]), seg(4, '2180 2020-1', [P(0, 22), P(50, 22)]), seg(5, '2180 2020-1', lot)]);
  const st = strips(c); assert.equal(st.pairs, 1); assert.equal(st.beside, 0); assert.equal(c.segments.length, 4);
  assert.deepEqual(freeParts([[0, 0], [100, 0]], [[[30, 5], [60, 5]]]).map(([a, b]) => [Math.round(a / 2) * 2, Math.round(b / 2) * 2]), [[0, 28], [64, 100]]);
});

test('a second run changes nothing: strips on both sides of a street stay two lines', () => {
  const c = city([seg(1, '2180 2020-1', [P(0, 0), P(50, 0)]), seg(2, '2180 2020-1', [P(50, 2), P(0, 2)]), seg(3, '2180 2020-1', [P(0, 9), P(50, 9)]), seg(4, '2180 2020-1', [P(50, 11), P(0, 11)])]);
  assert.equal(strips(c).pairs, 2); assert.equal(c.segments.length, 2);
  const once = JSON.stringify(c); const st = strips(c); assert.equal(st.pairs + st.rings + st.beside, 0); assert.equal(JSON.stringify(c), once);
  const ys = c.segments.map((s) => M(s.g[0])[1]).sort((a, b) => a - b); assert.ok(Math.abs(ys[0] - 1) < 0.3 && Math.abs(ys[1] - 10) < 0.3);
});

test('the two edges of a strip cut up differently: the short pieces beside the long line go', () => {
  const c = city([seg(1, '1481 2023-120', [P(0, 0), P(100, 0)]), seg(2, '1481 2023-120', [P(30, 3), P(0, 3)]), seg(3, '1481 2023-120', [P(35, 3), P(60, 3)]), seg(4, '1481 2023-120', [P(100, 3), P(65, 3)]),
    seg(5, '1481 2023-120', [P(100, 3), P(140, 3)])]); // continues past the long line: that part stays
  const st = strips(c); assert.equal(st.pairs, 0); assert.ok(st.beside >= 3);
  assert.deepEqual(c.segments.map((s) => s.i).sort((a, b) => a - b), [1, 5]);
  const tail = c.segments.find((s) => s.i === 5).g.map(M); assert.ok(tail[0][0] >= 100 && tail[0][0] < 105 && Math.abs(tail[1][0] - 140) < 0.5, `${tail}`);
  const once = JSON.stringify(c); strips(c); assert.equal(JSON.stringify(c), once);
});
