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

test('sweep wave 3: "utan avgift" in an "Övrig tid" sentence does not make a fee regulation free (Danderyd Brovägen)', async () => {
  const { dropOtherTimeFree } = await import('../rdt-lib.mjs');
  const body = 'får fordon parkeras under högst 4 tim i följd mot avgift. Avgiftsplikten gäller under tiden vardagar klockan 09.00 - 17.00. Övrig tid är parkering tillåten utan avgift och tidsbegränsning';
  assert.equal(/utan avgift/.test(dropOtherTimeFree(body)), false); assert.equal(/mot avgift/.test(dropOtherTimeFree(body)), true);
  assert.equal(/utan avgift/.test(dropOtherTimeFree('På Storgatan får fordon parkeras utan avgift under högst 2 tim i följd.')), true);
});

test('sweep wave 2: a ban\'s season that the register put on the time limit too (Järfälla Kopparvägen)', async () => {
  const { limitSeasonFromBan } = await import('../rdt-lib.mjs');
  const m = [[11, 1], [4, 30]];
  const text = { l: [{ a: 0, b: 1440, max: 180 }], f: [{ w: 4, a: 120, b: 300, m }] };
  assert.equal(limitSeasonFromBan(text, { l: [{ a: 0, b: 1440, max: 180, m }], f: [{ w: 4, a: 120, b: 300, m }] }), true);
  assert.equal(limitSeasonFromBan(text, { l: [{ a: 0, b: 1440, max: 180, m: [[5, 1], [9, 30]] }] }), false); // another season: not the ban's
  assert.equal(limitSeasonFromBan(text, { l: [{ a: 0, b: 1440, max: 120, m }] }), false); // another limit
  assert.equal(limitSeasonFromBan({ l: [{ a: 0, b: 1440, max: 180, m }], f: text.f }, { l: [{ a: 0, b: 1440, max: 180, m }] }), false); // the text has the season itself
});

test('day types from the text for windows with the same hours (sweep findings batch 4)', async () => {
  const { dayTypesFromText } = await import('../rdt-lib.mjs');
  // "vardagar och vardag före sön- och helgdag" held as Saturdays only (Kalmar Larmgatan)
  assert.deepEqual(dayTypesFromText([{ dt: ['fore'], a: 540, b: 1080, max: 15 }], [{ dt: ['vardag', 'fore'], a: 540, b: 1080, max: 15 }]), [{ dt: ['vardag', 'fore'], a: 540, b: 1080, max: 15 }]);
  // three day types with the same hours held as the last one (Burlöv Svenshögsvägen): every day
  assert.deepEqual(dayTypesFromText([{ dt: ['helgdag'], a: 480, b: 1080, max: 240 }], [{ dt: ['vardag'], a: 480, b: 1080, max: 240 }, { dt: ['fore'], a: 480, b: 1080, max: 240 }, { dt: ['helgdag'], a: 480, b: 1080, max: 240 }]), [{ a: 480, b: 1080, max: 240 }]);
  // "vardagar, dock ej dag före … 09–18 samt dag före … 09–15" held as Saturday twice (Hagfors Uddeholmsvägen), also for a text with two places
  assert.deepEqual(dayTypesFromText([{ dt: ['fore'], a: 540, b: 1080, max: 30 }, { dt: ['fore'], a: 540, b: 900, max: 30 }], [{ dt: ['vardag'], a: 540, b: 1080, max: 30 }, { dt: ['fore'], a: 540, b: 900, max: 30 }, { dt: ['vardag'], a: 540, b: 1080, max: 30 }, { dt: ['fore'], a: 540, b: 900, max: 30 }], true),
    [{ dt: ['vardag'], a: 540, b: 1080, max: 30 }, { dt: ['fore'], a: 540, b: 900, max: 30 }]);
  // never narrower, never other hours, never a named weekday or an overlay
  assert.equal(dayTypesFromText([{ dt: ['vardag', 'fore'], a: 540, b: 1080 }], [{ dt: ['vardag'], a: 540, b: 1080 }]), null);
  assert.equal(dayTypesFromText([{ dt: ['vardag'], a: 540, b: 1020 }], [{ dt: ['vardag', 'fore'], a: 540, b: 1080 }]), null);
  assert.equal(dayTypesFromText([{ a: 0, b: 1440, ov: 1 }, { w: 2, a: 0, b: 480 }], [{ dt: ['vardag', 'fore'], a: 0, b: 1440 }]), null);
  // a text window without day words does not widen a line when a sentence is unread (Vimmerby Nybblevägen: the unread sentence names the day)
  assert.equal(dayTypesFromText([{ dt: ['fore'], a: 0, b: 1440, max: 720 }], [{ a: 0, b: 1440, max: 720 }], false, true), null);
  // two places with different days for the same hours: not decided for a text with several places
  assert.equal(dayTypesFromText([{ dt: ['vardag'], a: 540, b: 1080, max: 60 }], [{ dt: ['vardag'], a: 540, b: 1080, max: 60 }, { dt: ['vardag', 'fore'], a: 540, b: 1080, max: 60 }], true), null);
});

test('a season on the limit that the text does not give it (sweep findings batch 4)', async () => {
  const { limitSeasonNotInText } = await import('../rdt-lib.mjs');
  const summer = [[6, 1], [8, 31]], text = { l: [{ a: 0, b: 1440, max: 1440 }] }, line = { l: [{ a: 0, b: 1440, max: 1440, m: summer }] };
  assert.equal(limitSeasonNotInText(text, line, [{ a: 600, b: 1080, m: summer }], true), true); // the fee's season (Båstad Havsbadsvägen)
  assert.equal(limitSeasonNotInText(text, line, null, false), true); // the text names no season at all (Sotenäs Köpmansgatan)
  assert.equal(limitSeasonNotInText(text, line, null, true), false); // a season somewhere in the text that is not the fee's: not decided
  assert.equal(limitSeasonNotInText({ l: text.l, f: [{ w: 2, a: 420, b: 960, m: [[10, 2], [6, 29]] }] }, { l: [{ a: 0, b: 1440, max: 1440, m: [[6, 30], [10, 1]] }] }, null, true), true); // the season the ban is lifted in (Kiruna Porfyrvägen)
  assert.equal(limitSeasonNotInText({ l: [{ a: 0, b: 1440, max: 120 }] }, line, null, false), false); // another limit: not the same windows
});

test('the weekly twin of an n-th weekday ban is dropped (sweep findings batch 5)', async () => {
  const { nthWeekdayFromText } = await import('../rdt-lib.mjs');
  const nth = { w: 2, nw: 1, a: 480, b: 720 }, weekly = { w: 2, a: 480, b: 720 };
  assert.deepEqual(nthWeekdayFromText([weekly, nth], [nth]), [nth]); // Hässleholm Torsgatan: every Tuesday → the first Tuesday of the month
  assert.equal(nthWeekdayFromText([weekly], [nth]), null); // the line lacks the n-th window: left alone
  assert.equal(nthWeekdayFromText([weekly, nth], [nth, weekly]), null); // the text bans every Tuesday too
  assert.equal(nthWeekdayFromText([{ ...weekly, ov: 2 }, nth], [nth]), null); // overlays are never touched
  assert.equal(nthWeekdayFromText([{ w: 3, a: 480, b: 720 }, nth], [nth]), null); // another weekday
});
