// Shared pipeline helpers (cities/rdt-lib.mjs). Texts are shortened from real ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { endDay, plainWholeRule, tableForTextRate } from '../rdt-lib.mjs';

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

test('a register reservation goes only when the text plainly lets every car park and reserves nothing (sweep findings batch 6)', async () => {
  const { carsPermitted } = await import('../rdt-lib.mjs');
  const wrap = (s) => `Kommunen föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 maj 2026.`;
  // Jönköping Kapellgatan 0680 2024-473 (the replaced regulation's disabled bay was still on the line), Borgholm Verdandi gränd
  assert.equal(carsPermitted(wrap('1 § På östra sidan av Kapellgatan i Jönköping får fordon parkeras mot avgift. 2 § Avgiften är enligt Taxa 1.'), 'rörelsehindrade'), true);
  assert.equal(carsPermitted(wrap('1 § På Verdandi gränd i Borgholm, på uppmärkta platser får fordon parkeras. 2 § Tillåtelsen gäller inte parkeringsplatser för rörelsehindrade.'), 'rörelsehindrade'), true);
  // Ystad Västerleden, Lerum Hedeforsvägen, Mark Boråsvägen: cars are named among the vehicles
  assert.equal(carsPermitted(wrap('1 § På Västerleden i Ystad får endast personbil klass I och motorcykel parkeras.'), 'motorcykel'), true);
  assert.equal(carsPermitted(wrap('På markerad parkeringsyta vid Kastenhofsmotet får endast motorcykel och personbil parkeras.'), 'motorcykel'), true);
  assert.equal(carsPermitted(wrap('1 § Inom ett område som utgör parkeringsplatsen öster om Boråsvägen, utom på markerade bussplatser i nordöstra hörnet får endast personbil parkeras.'), 'buss'), true);
  // real bays stay
  assert.equal(carsPermitted(wrap('På Storgatan får endast sådant fordon parkeras som används för befordran av rörelsehindrad med parkeringstillstånd.'), 'rörelsehindrade'), false);
  assert.equal(carsPermitted(wrap('På Storgatan får fordon parkeras. Två platser är reserverade för rörelsehindrade med parkeringstillstånd.'), 'rörelsehindrade'), false);
  assert.equal(carsPermitted(wrap('På särskilt markerade platser på parkeringsplats enligt kartbild får fordon parkeras. Med fordon avses endast taxi.'), 'taxi'), false);
  assert.equal(carsPermitted(wrap('På Storgatan får endast personbil klass II parkeras.'), 'husbil'), false);
  assert.equal(carsPermitted(wrap('På Storgatan får motorcykel parkeras.'), 'motorcykel'), false);
  assert.equal(carsPermitted(wrap('På Storgatan får fordon inte parkeras.'), 'buss'), false);
});

test('sweep findings batch 7: a plain permission stays plain beside words that only look like conditions', async () => {
  const { plainPermit } = await import('../rdt-lib.mjs');
  const wrap = (s) => `Kommunen föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 maj 2026.`;
  // "Kl" in a place name is not "kl" (Svedala ×22, Uppsala Klövergatan, Mölndal Kläppegatan)
  assert.equal(plainPermit(wrap('På Lindesborgsvägens östra sida i Klågerup, på särskilt anordnad parkeringsplats, 30 platser, får fordon parkeras.')), true);
  // where to stand (Lund ×12, Skurup, Sala, Sölvesborg, Eslöv)
  assert.equal(plainPermit(wrap('På Postiljonsgatan får fordon parkeras endast på särskilt markerade platser. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).')), true);
  assert.equal(plainPermit(wrap('På östra sidan av Stattenagatan enligt kartbild får fordon parkeras. Parkering är endast tillåten inom markerade platser.')), true);
  assert.equal(plainPermit(wrap('1 § På östra sidan av Östra Storgatan får fordon parkeras 2 § Tillåtelsen gäller endast på markerade platser.')), true);
  assert.equal(plainPermit(wrap('Inom ett område som definieras som Karlsrobadets parkering enligt kartbilaga, och endast på markerade platser får fordon parkeras.')), true);
  // "endast mot avgift" is a fee (Trelleborg ×35)
  assert.equal(plainPermit(wrap('1 § På norra sidan av Hamngatan i Trelleborg ( enligt kartbilaga ) får fordon parkeras endast mot avgift. 2 § Avgift ska betalas för parkering enligt röd taxa. Avgiftsplikten gäller vardagar klockan 09.00 - 18.00.')), true);
  // the boilerplate glued to the permission, "3 kap." as a sentence end, other regulations' and properties' numbers (Söderköping, Åstorp, Eskilstuna, Mariestad)
  assert.equal(plainPermit(wrap('1 § På markerade parkeringsplatser mitt emot Storängsparken 7 får fordon stannas eller parkeras Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).')), true);
  assert.equal(plainPermit(wrap('På norra sidan av Västra Storgatan på särskilt anordnad parkeringsplats får fordon med avvikelse från 3 kap. 55 § 3 trafikförordningen (1998:1276) parkeras.')), true);
  assert.equal(plainPermit(wrap('1 § På östra sidan av Törnerosgatan (i särskilt anlagda fickor, med avvikelse från 3 kap. 52§ trafikförordningen (1998:1276) och kommunens lokala trafikföreskrifter 0484 2008:0408) får fordon parkeras.')), true);
  assert.equal(plainPermit(wrap('På markerad parkeringsyta på fastigheten MARIESTAD FÅGELÖ 4:13 enligt kartbild får fordon parkeras mot avgift.')), true);
  assert.equal(plainPermit(wrap('1 § På den del av Stenkilsgatan som anges i kartan får fordon parkeras. Tillåtelsen gäller även parkering närmare korsningen med Lagmansgatan än vad som annars inte är tillåtet enligt 3 kap. 53 § trafikförordningen.')), true);
  assert.equal(plainPermit(wrap('1 § På den del av Råbyvägen som anges i kartan parkeras.')), true);
  // real conditions keep the line grey: hours, a length without "högst", a group, a permit, a real clock time, a ban
  assert.equal(plainPermit(wrap('På de delar av Långnäsvägen som anges i kartan får fordon parkeras mellan klockan 05.00 - 23.00.')), false);
  assert.equal(plainPermit(wrap('På Allbotorget får fordon parkeras 24 tim i följd.')), false);
  assert.equal(plainPermit(wrap('På Vikingagatan enligt kartbild får fordon parkeras. Tillåtelsen gäller endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats.')), false);
  assert.equal(plainPermit(wrap('1 § På Östra Esplanaden får fordon parkeras. 2 § Tillstånd erfordras under vardagar 8.00-16.00.')), false);
  assert.equal(plainPermit(wrap('På Storgatan får fordon parkeras endast på markerade platser och endast vardagar.')), false);
  assert.equal(plainPermit(wrap('På Storgatan får endast personbilar parkeras.')), false);
  assert.equal(plainPermit(wrap('På Storgatan får fordon inte parkeras.')), false);
  assert.equal(plainPermit(wrap('På Klågerupsvägen får fordon parkeras kl 8-18.')), false);
});

// ---- sweep findings batch 8 (26 Nov 2026) ----
import { stoppingBan, reservedBesideUnread, ownBans } from '../rdt-lib.mjs';
import { parseRegulation as parseB8, ruleText as ruleTextB8 } from '../../engine/regulation.js';
const wrapB8 = (s, title = '') => `Gävle kommuns lokala trafikföreskrifter ${title};\nbeslutade den 1 december 2023.\nGävle kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande.\n${s}\nDenna författning träder i kraft den 14 december 2023 då Gävle kommuns lokala trafikföreskrifter (2180 2023:17) om förbud mot att stanna eller parkera på en del av Glaciärvägen ska upphöra att gälla.`;

test('sweep findings batch 8: a stopping ban is judged on the operative text, not on the title or the repealed regulation', () => {
  const sb = (s, title) => { const b = wrapB8(s, title); return stoppingBan(b, ruleTextB8(b)); };
  // Gävle Glaciärvägen, Eskilstuna Munktellsgatan: plain parking bans under a "stanna eller parkera" title
  assert.equal(sb('1 § På Glaciärvägens Södra sida framför sopstationen enligt markering på kartbild får fordon inte parkeras.', 'om förbud att stanna eller parkera på Glaciärvägen'), false);
  assert.equal(sb('På Torbornavägen enligt markeringar i kartbild får fordon inte parkeras. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).'), false);
  // the boilerplate in other wordings (Helsingborg, Hedemora)
  assert.equal(sb('På nordvästra sidan av Domaregatan får fordon inte parkeras under tiden vardag klockan 07.00 - 18.00. Föreskriften innebär inte tillåtelse att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen.'), false);
  assert.equal(sb('1 § På samtliga gator inom det område som anges i kartbilaga får fordon inte parkeras. Förbudet ger inte rätt stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).'), false);
  // the title of the regulation a permission departs from (Falun, Sigtuna)
  assert.equal(sb('På markerade platser får personbil, med avvikelse från kommunens lokala trafikföreskrifter 0114 2015-00019 om förbud att stanna och parkera, parkeras mot avgift. Parkering är dock förbjuden under tiden onsdag klockan 08.00 - 12.00.'), false);
  // real stopping bans
  assert.equal(sb('1 § På Linnégatan i Växjö, västra körbanan, från Sandgärdsgatan till Norra Järnvägsgatan får inte fordon stannas.'), true);
  assert.equal(sb('På Flädervägen får fordon parkeras mot avgift. Stannande eller parkering är dock förbjuden under tiden onsdag klockan 08.00 - 16.00.'), true);
  assert.equal(sb('På Lyckebyvägen i Lyckeby får fordon inte stannas eller parkeras.'), true);
  // no operative text to cut out: the whole body decides, as before
  assert.equal(stoppingBan('På X-gatan får fordon inte stannas eller parkeras.', null), true);
});

test('sweep findings batch 8: a bay read as reserved is added beside an unread sentence, unless that sentence may open the place', () => {
  const w = (s) => parseB8(`Ängelholms kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 maj 2024.`);
  // Ängelholm Klittervägen and Valhallsvägen (motorhome bays), Kungsbacka Parkeringshus Linden (charging bays)
  for (const t of ['På rödmarkerad sträcka på Klittervägens parkeringsplatsmarkerade enligt kartbild får personbil klass II parkeras under högst 24 tim i följd. Dygnstaxa avläggs om 150 kr alla dagar i veckan. De 3 första parkeringstimmarna är avgifsfria med parkeringsskiva eller motsvarande.',
    'På markerad sträcka på Valhallsvägen enligt kartbild får endast personbil klass II parkeras. Avgift enligt taxa zon 4. Tillåtelsen att parkera sker mot att avgift erläggs eller högst 3 timmar i följd mot användande av parkeringsskiva eller motsvarande.',
    '1 § Särskilt uppmärkta parkeringsplatser på plan 2 och plan 3 i Parkeringshus Linden skall vara laddplats. 2 § Mellan klockan 8 och 22 på vardagar är det tillåtet att parkera mot att avgift betalas.']) {
    const r = w(t); assert.ok(r.unread.length > 0, t); assert.equal(reservedBesideUnread(r), true, t);
  }
  // fully read: nothing to add here (the ordinary comparison handles it); a seasonal bay, or an unread sentence about other hours or other parking: left alone
  assert.equal(reservedBesideUnread(w('På markerad sträcka på Valhallsvägen enligt kartbild får endast personbil klass II parkeras.')), false);
  assert.equal(reservedBesideUnread({ reserved: true, reservedFor: 'husbil', unread: ['För övrig parkering gäller ingen tidsbegränsning.'], purpose: [], reservedWindows: [], bans: [], allowOnly: [] }), false);
  assert.equal(reservedBesideUnread({ reserved: true, reservedFor: 'buss', unread: ['Övrig tid får fordon parkeras under högst 2 tim i följd.'], purpose: [], reservedWindows: [], bans: [], allowOnly: [] }), false);
  assert.equal(reservedBesideUnread({ reserved: true, reservedFor: 'buss', reservedSeason: [[6, 1], [8, 31]], unread: ['Avgift tas ut.'], purpose: [], reservedWindows: [], bans: [], allowOnly: [] }), false);
  assert.equal(reservedBesideUnread({ reserved: true, reservedFor: 'laddning', permitted: true, unread: ['Avgift tas ut.'], purpose: [], reservedWindows: [], bans: [], allowOnly: [] }), false);
});

test('sweep findings batch 8: bans laid on a line from roadworks or an area regulation are not the line\'s own rule set', () => {
  // Västervik Skeppsbron: two of ten lines carried a roadworks ban, so the text counted as "several rule sets" and its 10-day limit was never applied
  assert.deepEqual(ownBans({ f: [{ a: 0, b: 1440, ov: 2, to: '2027-05-20' }] }), []);
  assert.deepEqual(ownBans({ f: [{ w: 4, a: 420, b: 960 }, { a: 0, b: 1440, ov: 1 }] }), [{ w: 4, a: 420, b: 960 }]);
  assert.deepEqual(ownBans({}), []);
});

test('sweep findings batch 8: a text whose every part is a plain permission is a plain permission (Svedala\'s car parks stayed grey)', async () => {
  const { plainPermit } = await import('../rdt-lib.mjs');
  const w = (s) => `Svedala kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 juli 2008.`;
  const two = w('På Vinbärsgatans norra sida vid Värbyvägen, på särskilt anordnad parkeringsplats, 18 platser, får fordon parkeras. 2 § På Vinbärsgatans södra sida, på särskilt anordnad parkeringsplats, 13 platser, får fordon parkeras.');
  assert.equal(plainPermit(two), true);
  const r = parseB8(two); assert.equal(!!r.permitted, true); assert.deepEqual([r.bans, r.limits, r.allowOnly, r.unread], [[], [], [], []]); assert.equal(r.reserved, false);
  // one part with hours or a limit: not plain, stays grey
  assert.equal(plainPermit(w('På Vinbärsgatans norra sida får fordon parkeras. 2 § På Vinbärsgatans södra sida får fordon parkeras vardagar klockan 08.00 - 18.00.')), false);
});

test('tableForTextRate: the rate the text states picks the register table with that rate and day cap (QA 27 Nov: Skövde)', () => {
  const taxa = { 1496001: { periods: [{ start: 0, end: 1440, price: 20 }] }, 1496002: { periods: [{ start: 480, end: 1080, price: 5 }], dayCap: 40 }, 1496005: { periods: [{ start: 480, end: 1080, price: 5 }] }, 149600101: { periods: [{ start: 480, end: 1080, price: 20 }] } };
  const body = 'Avgift ska betalas för parkering enligt beslutad taxa 5kr/timme och 40kr/dygn. Avgiftsplikten gäller …';
  assert.equal(tableForTextRate(body, taxa, 149600101), 1496002);
  assert.equal(tableForTextRate('Avgift enligt taxa 5 kr/timme.', taxa, 1496001), 1496005);
  assert.equal(tableForTextRate(body, taxa, 1496002), null); // already that rate
  assert.equal(tableForTextRate('Avgift enligt taxa 3.', taxa, 1496001), null); // no rate in the text
  assert.equal(tableForTextRate('Avgift enligt taxa 7 kr/timme.', taxa, 1496001), null); // no table with that rate
});

test('sweep findings batch 10: a ban on named weekdays and dates of the regulation\'s own year is a one-off', async () => {
  const { oneOffEnd } = await import('../rdt-lib.mjs');
  assert.equal(oneOffEnd('0126 2020-105', [{ w: 5, a: 0, b: 1440, m: [[12, 11], [12, 11]] }]), '2020-12-11'); // Friday 11 December 2020
  assert.equal(oneOffEnd('0486 2025-180', [{ w: 4, a: 1140, b: 360, m: [[9, 18], [9, 19]] }, { w: 5, a: 1140, b: 360, m: [[9, 18], [9, 19]] }]), '2025-09-19');
  assert.equal(oneOffEnd('0486 2024-1', [{ w: 3, a: 0, b: 1440, m: [[11, 1], [11, 7]] }]), null); // every Wednesday in a week-long season: not a one-off
  assert.equal(oneOffEnd('0486 2025-1', [{ w: 5, a: 480, b: 720, m: [[11, 1], [5, 15]] }]), null); // a winter cleaning day
  assert.equal(oneOffEnd('0486 2025-1', [{ w: 1, a: 0, b: 1440, m: [[9, 18], [9, 18]] }]), null); // 18 Sep 2025 and 2026 are no Mondays
  assert.equal(oneOffEnd('0486 2025-1', [{ a: 0, b: 1440, m: [[9, 18], [9, 18]] }]), null); // no weekday named: read as that date every year
});

test('sweep findings batch 10: the text\'s hours and days replace a wider copy of the same limit, never a different one', async () => {
  const { limitsFromText } = await import('../rdt-lib.mjs');
  const text = [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 900, max: 120 }];
  // an all-day twin beside the windows (Vellinge Stortorget)
  assert.deepEqual(limitsFromText([{ a: 0, b: 1440, max: 120 }, ...text], text), text);
  // a window without its day type (Sjöbo Gamla Torg)
  assert.deepEqual(limitsFromText([{ a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 900, max: 120 }], text), text);
  // the days without the hours (Timrå Källvägen)
  assert.deepEqual(limitsFromText([{ dt: ['vardag'], a: 0, b: 1440, max: 120 }], [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }]), [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }]);
  // the same already, another length on the line, two lengths in the text, an all-day limit in the text, a text window the line does not cover, another season
  assert.equal(limitsFromText(text, text), null);
  assert.equal(limitsFromText([{ a: 0, b: 1440, max: 60 }, ...text], text), null);
  assert.equal(limitsFromText([{ a: 0, b: 1440, max: 120 }], [...text, { a: 0, b: 1440, max: 1440 }]), null);
  assert.equal(limitsFromText([{ a: 0, b: 1440, max: 120 }, ...text], [...text, { a: 0, b: 1440, max: 120 }]), null);
  assert.equal(limitsFromText([{ dt: ['vardag'], a: 540, b: 1020, max: 120 }], [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }]), null);
  assert.equal(limitsFromText([{ a: 0, b: 1440, max: 120 }], [{ a: 480, b: 1080, max: 120, m: [[6, 1], [8, 31]] }]), null);
  // the text's window twice is one window
  assert.deepEqual(limitsFromText([{ a: 0, b: 1440, max: 60 }], [{ a: 360, b: 1320, max: 60 }, { a: 360, b: 1320, max: 60 }]), [{ a: 360, b: 1320, max: 60 }]);
});
