// Shared pipeline helpers (cities/rdt-lib.mjs). Texts are shortened from real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { endDay, plainWholeRule } from '../rdt-lib.mjs';

test('a regulation that ends at a clock time holds through that day: the line\'s end is the day after (sweep wave 1: Uppsala Geijersgatan)', () => {
  const body = 'På de delar av Geijersgatan som anges i kartan får fordon inte stannas eller\nparkeras.\n\nDessa föreskrifter träder i kraft den 5 oktober 2026 klockan 07:00 och upphör att gälla den 27\nnovember 2026 klockan 16:00.';
  assert.equal(endDay({ to: '2026-11-27', body }), '2026-11-28');
  assert.equal(endDay({ to: '2026-12-31', body: 'Dessa föreskrifter upphör att gälla den 31 december 2026 klockan 16.00.' }), '2027-01-01');
  // no clock time, midnight, or a date that is not the register's end date: the register's day
  assert.equal(endDay({ to: '2026-11-27', body: 'Dessa föreskrifter upphör att gälla den 27 november 2026.' }), '2026-11-27');
  assert.equal(endDay({ to: '2026-11-27', body: 'Dessa föreskrifter upphör att gälla den 27 november 2026 klockan 00:00.' }), '2026-11-27');
  assert.equal(endDay({ to: '2026-11-30', body: body }), '2026-11-30');
  assert.equal(endDay({ to: null, body }), null); assert.equal(endDay({ to: 'okänt', body }), null);
});

test('a tiny line is kept as fact only when its whole rule is one plain all-day ban or one plain reservation read from the text (sweep waves 1–5: turning-area bans)', () => {
  assert.equal(plainWholeRule({ rx: 1, t: 0, f: [{ a: 0, b: 1440 }] }), true); // "På vändplatsen … får fordon inte parkeras"
  assert.equal(plainWholeRule({ rx: 1, t: 0, sb: 1, f: [{ a: 0, b: 1440 }, { a: 0, b: 1440, ov: 2, to: '2027-02-28' }] }), true); // a laid-on roadworks ban does not count
  assert.equal(plainWholeRule({ rx: 1, t: 0, v: 'rörelsehindrade' }), true);
  assert.equal(plainWholeRule({ t: 0, f: [{ a: 0, b: 1440 }] }), false); // not read from the text
  assert.equal(plainWholeRule({ rx: 1, ux: 1, t: 0, f: [{ a: 0, b: 1440 }] }), false);
  assert.equal(plainWholeRule({ rx: 1, t: 0, f: [{ dt: ['vardag'], a: 0, b: 1440 }] }), false); // days
  assert.equal(plainWholeRule({ rx: 1, t: 0, f: [{ a: 0, b: 1440, m: [[11, 1], [4, 30]] }] }), false); // a season
  assert.equal(plainWholeRule({ rx: 1, t: 0, f: [{ a: 0, b: 1440 }, { w: 2, a: 480, b: 720 }] }), false);
  assert.equal(plainWholeRule({ rx: 1, t: 0, l: [{ a: 0, b: 1440, max: 15 }] }), false); // a limit
  assert.equal(plainWholeRule({ rx: 1, t: 0, v: 'motorcykel', o: [{ a: 0, b: 1440, m: [[10, 1], [3, 31]] }] }), false); // a seasonal bay
  assert.equal(plainWholeRule({ rx: 1, t: 0, v: 'rörelsehindrade', l: [{ a: 0, b: 1440, max: 180 }] }), false);
  assert.equal(plainWholeRule({ rx: 1, t: 184001, f: [{ a: 0, b: 1440 }] }), false); // a fee
  assert.equal(plainWholeRule({ rx: 1, t: null, fu: 1, v: 'rörelsehindrade' }), false);
});
