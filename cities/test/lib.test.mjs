// Parsers for the rule texts used in city open data (real examples from Göteborg and Malmö, Oct 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLimitation, parseBan, parseCost, maxMinutes, wktLines, cleanLine, parseDayTimes } from '../lib.mjs';
import { cleaningWindows, taxaCode } from '../goteborg/build.mjs';

test('max times', () => {
  assert.equal(maxMinutes('30 min'), 30);
  assert.equal(maxMinutes('2 tim'), 120);
  assert.equal(maxMinutes('7 dygn'), 7 * 1440);
  assert.equal(maxMinutes('snart'), null);
});

test('day phrases and times', () => {
  assert.deepEqual(parseDayTimes('vardag utom dag före sön- och helgdag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 15.00'),
    [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 900 }]);
  assert.deepEqual(parseDayTimes('vardag klockan 00.00 - 07.00 och 21.00 - 24.00 och sön- och helgdag klockan 00.00 - 07.00 och 21.00 - 24.00'),
    [{ dt: ['vardag', 'fore'], a: 0, b: 420 }, { dt: ['vardag', 'fore'], a: 1260, b: 1440 }, { dt: ['helgdag'], a: 0, b: 420 }, { dt: ['helgdag'], a: 1260, b: 1440 }]);
  assert.equal(parseDayTimes('vardag klockan 09.00 - 18.00 utom juli'), null);
});

test('limitations', () => {
  assert.deepEqual(parseLimitation(null, '30 min'), { l: [{ a: 0, b: 1440, max: 30 }] });
  assert.deepEqual(parseLimitation('Tidsbegränsningen gäller vardag utom dag före sön- och helgdag klockan 00.00 - 24.00.', '24 tim'),
    { l: [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }] });
  assert.deepEqual(parseLimitation('Parkering är dock tillåten under högst 4 tim i följd vardag utom vardag före sön- och helgdag klockan 22.00 - 06.00.', '24 tim'),
    { l: [{ dt: ['vardag'], a: 1320, b: 360, max: 240 }] });
  assert.deepEqual(parseLimitation('Tidsbegränsningen gäller vardag klockan 10.00 - 19.00 och sön- och helgdag klockan 10.00 - 19.00 under tiden 1:a april - 30:e september.', '2 tim'),
    { l: [{ dt: ['vardag', 'fore'], a: 600, b: 1140, max: 120, m: [[4, 1], [9, 30]] }, { dt: ['helgdag'], a: 600, b: 1140, max: 120, m: [[4, 1], [9, 30]] }] });
  assert.deepEqual(parseLimitation('Tillåtelsen gäller vardag klockan 08.00 - 22.00.', '30 min'),
    { aw: [{ dt: ['vardag', 'fore'], a: 480, b: 1320 }], l: [{ a: 0, b: 1440, max: 30 }] });
  assert.deepEqual(parseLimitation('Tillåtelsen gäller 1:a januari - 10:e maj och 15:e juni - 15:e november.', '24 tim').aw,
    [{ a: 0, b: 1440, m: [[1, 1], [5, 10]] }, { a: 0, b: 1440, m: [[6, 15], [11, 15]] }]);
  assert.deepEqual(parseLimitation('Avgiftsplikten gäller under tiden 1:a maj - 30:e september.', '24 tim').feeSeason, [[5, 1], [9, 30]]);
  assert.equal(parseLimitation('Något helt annat.', '2 tim').u, true);
});

test('bans and cleaning texts', () => {
  assert.deepEqual(parseBan('P-förbud tisdagar klockan 09.00 - 12.00 jämna veckor under tiden 15:e mars - 30:e april.'),
    { s: [{ w: 2, a: 540, b: 720, m: [[3, 15], [4, 30]], p: 'even' }] });
  assert.deepEqual(parseBan('P-förbud torsdagar udda veckor klockan 09.00 - 12.00.'), { s: [{ w: 4, a: 540, b: 720, p: 'odd' }] });
  assert.deepEqual(parseBan('P-förbud onsdagar klockan 09.00 - 12.00 jämna veckor  1:a oktober - 30:e april.'), { s: [{ w: 3, a: 540, b: 720, m: [[10, 1], [4, 30]], p: 'even' }] });
  assert.deepEqual(parseBan('P-förbud klockan 07.00 - 18.00.'), { f: [{ a: 420, b: 1080 }] });
  assert.equal(parseBan('P-förbud måndagar - fredagar klockan 09.00 - 11.00.').s.length, 5);
  assert.equal(parseBan('P-förbud tisdagar klockan 08.00 - 10.00 udda datum.'), null);
  assert.deepEqual(parseBan('Fredag klockan 02.00 - 07.00 jämna veckor.'), { s: [{ w: 5, a: 120, b: 420, p: 'even' }] });
});

test('Göteborg cleaning zones: text and fields agree, text wins when it says more', () => {
  const z = { ActivePeriodText: 'Torsdag klockan 09.00 - 12.00 udda veckor under tiden 15:e mars - 30:e april.', WeekDay: 4, StartMonth: 3, StartDay: 15, StartHour: 9, EndMonth: 4, EndDay: 30, EndHour: 12, OnlyOddWeeks: true };
  assert.deepEqual(cleaningWindows(z), [{ w: 4, a: 540, b: 720, m: [[3, 15], [4, 30]], p: 'odd' }]);
  const multi = { ActivePeriodText: 'Måndag - fredag klockan 09.00 - 11.00.', WeekDay: 1, StartMonth: 1, StartDay: 1, StartHour: 9, EndMonth: 12, EndDay: 31, EndHour: 11 };
  assert.equal(cleaningWindows(multi).length, 5);
  const odd = { ActivePeriodText: 'Tisdag klockan 08.00 - 10.00 udda datum.', WeekDay: 2, StartMonth: 1, StartDay: 1, StartHour: 8, EndMonth: 12, EndDay: 31, EndHour: 10 };
  assert.deepEqual(cleaningWindows(odd), [{ w: 2, a: 480, b: 600 }]); // every Tuesday: stricter than "odd dates", never looser
  assert.equal(cleaningWindows({ ...z, WeekDay: 3 }), null); // disagreement → not trusted
});

test('fees', () => {
  assert.deepEqual(parseCost('34 kr/tim 8-22 alla dagar. Övrig tid: 2 kr/tim'),
    { periods: [{ days: ['vardag', 'fore', 'helgdag'], start: 480, end: 1320, price: 34 }], otherTime: 2 });
  assert.equal(parseCost('23 kr/30 min 8-22 alla dagar. Övrig tid: 2 kr/tim').periods[0].price, 46);
  assert.equal(parseCost('6 kr/tim 8-22 alla dagar, maxtaxa 30 kr/dag').dayCap, 30);
  assert.equal(taxaCode('Taxa 7'), 2007);
  assert.equal(taxaCode('Taxa A'), 2901);
});

test('geometry', () => {
  assert.deepEqual(wktLines('MULTILINESTRING ((1 2, 3 4), (5 6, 7 8))'), [[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
  assert.deepEqual(wktLines('GEOMETRYCOLLECTION (POLYGON ((1 1, 2 2, 1 2, 1 1)), LINESTRING (1 2, 3 4))'), [[[1, 2], [3, 4]]]);
  assert.equal(cleanLine([[11.9000001, 57.7], [11.9000002, 57.7]]), null); // collapses under 1 m
});
