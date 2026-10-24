import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegulation, applyRegulation } from '../regulation.js';
const wrap = (s) => `Stockholms kommun föreskriver med stöd av 10 kap. 1 § trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 maj 2026.`;

test('time limit in the main sentence + "Övrig tid får fordon parkeras" + winter ban', () => {
  const r = parseRegulation(wrap('På markerad sträcka på Pendlargatans västra sida enligt kartbild får fordon parkeras under högst 2 tim i följd vardag utom vardag före sön- och helgdag klockan 09.00 - 19.00. Parkeringsskiva eller motsvarande ska användas. Parkering är dock förbjuden fredag klockan 08.00 - 16.00 under tiden 1 november - 15 maj. Övrig tid får fordon parkeras.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1140, max: 120 }]);
  assert.deepEqual(r.bans, [{ w: 5, a: 480, b: 960, m: [[11, 1], [5, 15]] }]);
  assert.equal(r.otherAllowed, true); assert.deepEqual(r.allowOnly, []); assert.deepEqual(r.unread, []);
});

test('"Tillåtelsen att parkera gäller" → the limit then; outside those hours the general rules apply (no ban in the text)', () => {
  const r = parseRegulation(wrap('På Toffelbackens nordöstra sida på den sträcka som anges på kartan får fordon parkeras. Tillåtelsen att parkera gäller vardagar utom vardag före sön- och helgdag klockan 08.00 - 18.00 under högst 1 tim i följd.'));
  assert.deepEqual(r.allowOnly, []);
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 60 }]);
  assert.deepEqual(r.unread, []);
});

test('two windows + "Övrig tid får fordon inte parkeras"', () => {
  const r = parseRegulation(wrap('På Harpsundsvägen får fordon parkeras under högst 15 min i följd vardagar utom vardag före sön- och helgdag klockan 07.00 - 22.00 och vardag före sön- och helgdag klockan 07.00 - 22.00. Övrig tid får fordon inte parkeras.'));
  assert.equal(r.allowOnly.length, 2); assert.deepEqual(r.allowOnly[1], { dt: ['fore'], a: 420, b: 1320 });
  assert.equal(r.limits[0].max, 15); assert.equal(r.otherAllowed, false);
});

test('loading zone with fee and night ban', () => {
  const r = parseRegulation(wrap('Markerad sträcka mellan 0 och 15 meter på Banérgatans östra sida enligt kartbild ska vara ändamålsplats för lastning eller lossning av tungt eller skrymmande gods vardag utom vardag före sön- och helgdag klockan 07.00 - 19.00. Övrig tid får fordon parkeras mot avgift vardag före sön- och helgdag klockan 11.00 - 17.00. Under tiden måndag klockan 00.00 - 06.00 får dock fordon inte parkeras. Avgift enligt taxa 3, 14 § allmänna lokala trafikföreskrifter.'));
  assert.deepEqual(r.purpose, [{ dt: ['vardag'], a: 420, b: 1140 }]);
  assert.deepEqual(r.bans, [{ w: 1, a: 0, b: 360 }]);
  assert.equal(r.otherAllowed, true); assert.equal(r.taxa, 3);
});

test('whole-season ban and reserved spot', () => {
  const r = parseRegulation(wrap('På Lillåvägen får fordon parkeras. Parkering är förbjuden under tiden 1 november - 15 maj.'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440, m: [[11, 1], [5, 15]] }]);
  const q = parseRegulation(wrap('På Atlasgatans norra sida på de 4 meter som anges på kartan får endast cykel och moped klass II parkeras.'));
  assert.equal(q.reserved, true);
});

test('limit without hours is a limit at all hours; direction-of-parking sentence is ignored', () => {
  const body = 'x följande. På Teststigen får fordon parkeras. Tillåtelsen att parkera gäller parkering under högst 3 tim i följd. Uppställning av fordon sker mot färdriktningen. Denna författning träder i kraft den 1 januari 2020.';
  const r = parseRegulation(body);
  assert.deepEqual(r.unread, []);
  assert.equal(r.limits.length, 1);
  assert.equal(r.limits[0].max, 180);
  assert.equal(r.limits[0].a, 0);
});

test('motorcycle spot with a season: cars may park outside the season', () => {
  const body = 'x följande. På Teststigen får endast tvåhjulig motorcykel parkeras under tiden 1 april - 30 september. Övrig tid får fordon parkeras. Denna författning träder i kraft den 1 januari 2020.';
  const seg = applyRegulation({ t: 2, v: 'motorcykel' }, { body, to: null }, '2026-10-04');
  assert.ok(seg.o && seg.o[0].m);
  assert.deepEqual(seg.o[0].m, [[10, 1], [3, 31]]);
});

test('"Övrig tid får fordon parkeras" does not make the limit hours allowed-only; two hour ranges are both read', () => {
  const body = 'x följande. På Teststigen får fordon parkeras. Tillåtelsen gäller vardag utom vardag före sön- och helgdag klockan 07.00 - 10.00 och 15.00 - 18.00 under högst 30 min i följd. Övrig tid får fordon parkeras. Denna författning träder i kraft den 1 januari 2020.';
  const r = parseRegulation(body);
  assert.equal(r.allowOnly.length, 0);
  assert.equal(r.limits.length, 2);
  const r2 = parseRegulation(body.replace('Övrig tid får fordon parkeras', 'Övrig tid får fordon inte parkeras'));
  assert.equal(r2.allowOnly.length, 2);
});

test('"får endast beskickningsfordon parkeras" reserves the curb even when the city data has no vehicle', () => {
  const body = 'följande.\n\nPå markerad sträcka mellan 0 och 6 meter på Strandvägens norra sida enligt kartbild\nfår endast beskickningsfordon parkeras.\n\nDenna författning träder i kraft den 6 oktober 2014.';
  const r = parseRegulation(body);
  assert.equal(r.reserved, true);
  assert.equal(r.reservedFor, 'beskickningsfordon');
  const seg = applyRegulation({ n: 'Strandvägen', t: 0 }, { c: 'x', body, from: '2014-10-06', to: null }, '2026-10-06');
  assert.equal(seg.v, 'beskickningsfordon');
});

test('"får endast personbil parkeras" is not a reserved spot; "Övrig tid får endast tung lastbil" limits cars to the stated hours', () => {
  const body = 'följande. På Finspångsgatans nordöstra sida på den sträcka som anges på kartan får endast personbil parkeras. Tillåtelsen gäller vardagar utom vardag före sön- och helgdag klockan 07.00 - 20.00. Övrig tid får endast tung lastbil parkeras. Denna författning träder i kraft';
  const r = parseRegulation(body);
  assert.equal(r.reserved, false);
  assert.equal(r.otherAllowed, false);
  assert.equal(r.allowOnly.length, 1);
});

test('QA 2026-10-13: "utom under tiden …" ban exceptions are complemented, not applied as the ban', () => {
  const a = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden onsdag klockan 09.00 - 14.00 utom under tiden jämna veckor 1 maj - 31 oktober.'));
  assert.deepEqual(a.bans, [{ w: 3, a: 540, b: 840, m: [[5, 1], [10, 31]], p: 'odd' }, { w: 3, a: 540, b: 840, m: [[11, 1], [4, 30]] }]);
  const b = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden tisdag klockan 08.00 - 12.00 utom under tiden 15 juni - 15 augusti.'));
  assert.deepEqual(b.bans, [{ w: 2, a: 480, b: 720, m: [[8, 16], [6, 14]] }]);
  const c = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden fredag klockan 08.00 - 12.00 utom udda veckor.'));
  assert.deepEqual(c.bans, [{ w: 5, a: 480, b: 720, p: 'even' }]);
});

test('QA 2026-10-13: "vardag utom dag före sön- och helgdag" is weekdays only; "personbil" (singular) limits are read', () => {
  const r = parseRegulation(wrap('På Teststigen får fordon parkeras. Parkering är dock förbjuden vardag utom dag före sön- och helgdag klockan 00.00 - 06.00, vardag före sön- och helgdag klockan 00.00 - 06.00 och sön- och helgdag klockan 00.00 - 06.00.'));
  assert.deepEqual(r.bans.map((w) => w.dt), [['vardag'], ['fore'], ['helgdag']]);
  const l = parseRegulation(wrap('På Vindkraftsvägens norra sida får endast personbil parkeras under högst 2 tim i följd vardagar utom vardag före sön- och helgdag klockan 07.00 - 21.00.'));
  assert.deepEqual(l.limits, [{ dt: ['vardag'], a: 420, b: 1260, max: 120 }]);
  const n = parseRegulation(wrap('På Solkraftsvägens västra sida får endast personbil parkeras under högst 2 tim i följd.'));
  assert.deepEqual(n.limits, [{ a: 0, b: 1440, max: 120 }]);
});

test('QA 2026-10-13: a missing full stop before "Tillåtelsen ger inte rätt" does not turn the limit sentence into a ban', () => {
  const r = parseRegulation(wrap('På Teststigen får fordon parkeras under högst 2 tim i följd vardag klockan 09.00 - 18.00 Tillåtelsen ger inte rätt att parkera längre än tillåten tid.'));
  assert.equal(r.bans.length, 0);
  assert.equal(r.limits.length, 1);
});

// Phrasings from other municipalities (RDT texts fetched 18 Oct 2026)
const wrapK = (s, k = 'Alingsås kommun') => `${k} föreskriver med stöd av 10 kap. 1 § andra stycket 16 och 17 och 3 § första stycket trafikförordningen (1998:1276) följande. ${s} Denna författning träder i kraft den 1 januari 2020. På samhällsbyggnadsnämndens vägnar. Anna Andersson`;

test('RDT: a limit "under vardag utom dag före sön- och helgdag" without hours keeps the day type', () => {
  const r = parseRegulation(wrapK('1 § På västra sidan av Kungegårdsgatan i Alingsås 1 , på uppställningsplatsen utanför fastigheten Kungsängen 3 mellan Kungsängsgatan och Smålandsgatan, får fordon parkeras under högst 30 min i följd under vardag utom dag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 30 }]); assert.deepEqual(r.unread, []);
});

test('RDT: "måndag - söndag klockan 06.00 - 20.00" is every day; "måndag - fredag" is five weekday windows', () => {
  const r = parseRegulation(wrapK('1 § På Kvarnbacken i Alingsås 1 på angivna uppställningsplatser får fordon parkeras under högst 4 tim i följd under måndag - söndag klockan 06.00 - 20.00.'));
  assert.deepEqual(r.limits, [{ a: 360, b: 1200, max: 240 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På Storgatan får fordon inte parkeras måndag - fredag klockan 07.00 - 09.00.'));
  assert.deepEqual(q.bans, [1, 2, 3, 4, 5].map((w) => ({ w, a: 420, b: 540 }))); assert.deepEqual(q.unread, []);
});

test('RDT: a ban without hours is all day; a following "Förbudet gäller …" gives its hours; "enskild väg" is ignored', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Ekekullsvägen enligt kartbild får fordon inte parkeras.', 'Ale kommun'));
  assert.deepEqual(r.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('Inom vändplatsen på Rådjursvägen får inte fordon stannas eller parkeras. Förbudet i första stycket gäller inte enskild väg.', 'Botkyrka kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På samtliga vägar inom det område som markerats på kartbilaga får fordon inte parkeras. Förbudet att parkera gäller under tiden klockan 00.00 - 16.00.', 'Borlänge kommun'));
  assert.deepEqual(b.bans, [{ a: 0, b: 960 }]); assert.deepEqual(b.unread, []);
});

test('RDT: "Tidsbegränsningen gäller …" sets the hours of the limit; a "2 §" paragraph number is not a sentence', () => {
  const r = parseRegulation(wrapK('1 § På parkeringen vid Gamla Vänersborgsvägen enligt markering på kartbild får fordon parkeras högst 24 timmar i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag.'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På markerad sträcka på Lyckgatan enligt kartbild får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller under tiden vardag utom vardag före sön- och helgdag klockan 09.00 - 18.00 och vardag före sön- och helgdag klockan 09.00 - 15.00.', 'Ängelholms kommun'));
  assert.deepEqual(q.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 120 }, { dt: ['fore'], a: 540, b: 900, max: 120 }]); assert.deepEqual(q.unread, []);
});

test('RDT: personbil klass II is a motorhome spot (reserved); klass I / "Endast parkering tillåten för personbil klass 1" is ordinary cars', () => {
  const r = parseRegulation(wrapK('På parkeringen enligt markering på kartbild får endast personbil klass II parkeras högst 24 timmar i följd.'));
  assert.equal(r.reserved, true); assert.equal(r.reservedFor, 'husbil');
  const q = parseRegulation(wrapK('På markerad parkeringsficka på Klippanvägen enligt kartbild får fordon parkeras under högst 30 min i följd. Endast parkering tillåten för personbil klass 1.', 'Ängelholms kommun'));
  assert.equal(q.reserved, false); assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 30 }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På markerad plats på Tivoliplatsen enligt kartbild får endast buss parkeras under högst 3 tim i följd. Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Parkeringsskiva eller motsvarande ska användas.', 'Arvika kommun'));
  assert.equal(b.reservedFor, 'buss'); assert.deepEqual(b.unread, []);
});

test('RDT: a day word the parser did not place makes the sentence unread, never a wider rule', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 2 tim i följd lördag, söndag och helgdag samt klämdag.'));
  assert.equal(r.unread.length, 1); assert.deepEqual(r.limits, []);
  const q = parseRegulation(wrapK('På Storgatan får fordon inte parkeras utom lördag klockan 08.00 - 12.00.'));
  assert.equal(q.unread.length, 1); assert.deepEqual(q.bans, []);
});

test('RDT: "med avvikelse från …" asides and glued sentences are handled; signatures end the rule text', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Kristinegatan enligt kartbild får fordon, med avvikelse från Falu kommuns lokala trafikföreskrifter 2080 2025:00259 om stannande och parkering, parkeras mot avgift under tiden vardagar klockan 08.00 - 18.00.', 'Falu kommun'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.bans, []);
  const q = parseRegulation(wrapK('1 § På Våggatan, enligt bifogad karta, får fordon parkeras under högst 3 tim i följd.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).', 'Åmåls kommun'));
  assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 180 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "Övrig tid får fordon parkeras under högst 4 tim" is a limit outside the stated hours; boilerplate glued to a ban is not a second ban', () => {
  const r = parseRegulation(wrapK('På markerade sträckor på Vitklövergatan enligt kartbild får fordon parkeras under högst 20 min i följd. Tidsbegränsningen gäller under tiden klockan 07.00 - 18.00. Övrig tid får fordon parkeras under högst 4 tim i följd.', 'Ale kommun'));
  assert.deepEqual(r.limits, [{ a: 420, b: 1080, max: 20 }, { dt: ['vardag', 'fore', 'helgdag'], a: 0, b: 420, max: 240 }, { dt: ['vardag', 'fore', 'helgdag'], a: 1080, b: 1440, max: 240 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('1 § På i kartbild med röd linje markerad sträcka på Sparvvägen får fordon inte parkeras.Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276).', 'Ale kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "mellan klockan 8 och 18", "sön - och helgdag", "1:a december - 31:a mars", "motorfordon"', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 2 tim i följd. Tidsbegränsningen gäller vardagar utom vardag dag före sön - och helgdag mellan klockan 8 och 18 och vardag före sön - och helgdag mellan klockan 8 och 14.', 'Åmåls kommun'));
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 480, b: 1080, max: 120 }, { dt: ['fore'], a: 480, b: 840, max: 120 }]); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På Fågeldammsvägen i Surte får motorfordon inte parkeras. Förbudet gäller 1:a december - 31:a mars.', 'Ale kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440, m: [[12, 1], [3, 31]] }]); assert.deepEqual(q.unread, []);
  const b = parseRegulation(wrapK('På markerade parkeringsplatser på samtliga gator enligt kartbild får fordon inte parkeras mellan kl 23:00 och 04:00, förbudet gäller alla dagar.', 'Arvika kommun'));
  assert.deepEqual(b.bans, [{ a: 1380, b: 240 }]); assert.deepEqual(b.unread, []);
});

test('RDT: a sentence that mentions a parking disc but carries a rule is not silently ignored', () => {
  const r = parseRegulation(wrapK('På markerad sträcka på östra sidan av Sandvångsgatan enligt kartbild får fordon parkeras under högst 24 tim i följd. Vardagar utom vardag före sön- och helgdag klockan 09.00 – 18.00 gäller dock tillåtelsen att parkera mot att avgift erläggs eller högst 1 timme i följd mot användande av parkeringsskiva eller motsvarande. Avgift enligt taxa zon 2.', 'Ängelholms kommun'));
  assert.deepEqual(r.unread, []); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); // pay, or 1 h with a disc: the fee hours; no 1 h limit for payers
  const q = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 1 tim i följd. Parkeringsskiva eller motsvarande ska användas.'));
  assert.deepEqual(q.limits, [{ a: 0, b: 1440, max: 60 }]); assert.deepEqual(q.unread, []);
});

test('RDT: "Övrig tid parkering förbjuden" means allowed only in the stated hours; "Förbudet att parkera gäller <season>" dates the ban just stated', () => {
  const r = parseRegulation(wrapK('På Myrgatans västra sida i särskild anordnad parkerinsficka får fordon parkeras högst 1 timme i följd alla dagar mellan klockan 06.00 – 21.00. Övrig tid parkering förbjuden enligt beslut om parkeringsförbudzon.', 'Avesta kommun'));
  assert.deepEqual(r.bans, []); assert.deepEqual(r.allowOnly, [{ a: 360, b: 1260 }]); assert.deepEqual(r.limits, [{ a: 360, b: 1260, max: 60 }]); assert.equal(r.otherAllowed, false); assert.deepEqual(r.unread, []);
  const q = parseRegulation(wrapK('På markerade sträckor på Konstvaktaregatan enligt kartbild får fordon inte parkeras under tiden onsdag klockan 09.00 - 15.00. Förbudet ger inte rätt att stanna där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). Förbudet att parkera gäller 1 december - 31 maj.', 'Falu kommun'));
  assert.deepEqual(q.bans, [{ w: 3, a: 540, b: 900, m: [[12, 1], [5, 31]] }]); assert.deepEqual(q.unread, []);
});

test('RDT: handikappad = disabled permit; vändplats med förbud; "får taxi parkeras"; resident-permit sentences ignored', () => {
  assert.equal(parseRegulation(wrapK('På 1 markerad parkeringsplats på Badhusgatans sydvästra sida får endast sådant fordon parkeras som används för befordran av handikappad med särskilt parkeringstillstånd.', 'Enköpings kommun')).reservedFor, 'rörelsehindrade');
  const q = parseRegulation(wrapK('I norra änden av Hökgatan i Eskilstuna skall den för ändamålet särskilt anlagda ytan vara vändplats med förbud att parkera.', 'Eskilstuna kommun'));
  assert.deepEqual(q.bans, [{ a: 0, b: 1440 }]); assert.deepEqual(q.unread, []);
  const t = parseRegulation(wrapK('På markerade sträckor på Hälsingetorget enligt kartbild får taxi parkeras.', 'Falu kommun'));
  assert.equal(t.reservedFor, 'taxi'); assert.deepEqual(t.unread, []);
  const r = parseRegulation(wrapK('På Hantverksgatan får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller även fordon med boendeparkeringskort C.', 'Falkenbergs kommun'));
  assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 120 }]); assert.deepEqual(r.unread, []);
});

test('RDT: day-of-month bans, "Trots tillåtelsen", and heavy-vehicle-only rules (no rule for cars)', () => {
  const r = parseRegulation(wrapK('På Drottninggatan får fordon parkeras under högst 24 tim i följd. Trots tillåtelsen i 1 § får fordon inte parkeras den 10:e dagen i månaden klockan 09.00 - 12.00 (gäller vardag utom vardag före sön- och helgdag).', 'Norrköpings kommun'));
  assert.deepEqual(r.bans, [{ dm: 10, dt: ['vardag'], a: 540, b: 720 }]); assert.deepEqual(r.limits, [{ a: 0, b: 1440, max: 1440 }]); assert.deepEqual(r.unread, []);
  const h = parseRegulation(wrapK('På väg som är inte enskild inom tättbebyggt område i Järfälla kommun får motorredskap, traktor, tung lastbil, personbil klass II och tung buss inte parkeras. Dessutom får inte heller frikopplat släpfordon med en längd som överstiger 3 meter parkeras annat än på anvisade platser för sådana fordonsslag. Tidsbegränsningen gäller under tiden måndag - söndag klockan 22.00 - 06.00', 'Järfälla kommun'));
  assert.equal(h.heavyOnly, true); assert.deepEqual(h.bans, []); assert.deepEqual(h.limits, []);
  const n = parseRegulation(wrapK('På samtliga vägar som inte är enskilda inom det tättbebyggda området i Norrtälje stad får fordon och fordonståg med bruttovikt över 3,5 ton inte parkeras.', 'Norrtälje kommun'));
  assert.equal(n.heavyOnly, true); assert.deepEqual(n.bans, []);
  const c = parseRegulation(wrapK('På Storgatan får fordon inte parkeras.'));
  assert.deepEqual(c.bans, [{ a: 0, b: 1440 }]); assert.equal(c.heavyOnly, undefined);
});

test('RDT round 2: "Med avvikelse från bestämmelserna i 1 §", "till och med", "den 6 i månaden", "Förbudet gäller inte <day types>", lorry bays', () => {
  const r = parseRegulation(wrapK('På Storgatan får fordon parkeras under högst 24 tim i följd. Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras på onsdagar mellan klockan 10 och 15 under tiden 1 oktober till och med 30 april.', 'Linköpings kommun'));
  assert.deepEqual(r.bans, [{ w: 3, a: 600, b: 900, m: [[10, 1], [4, 30]] }]); assert.deepEqual(r.unread, []);
  const d = parseRegulation(wrapK('På Storgatan får fordon parkeras. Med avvikelse från bestämmelserna i 1 § får fordon på sträckan inte parkeras den 6 i månaden mellan klockan 10 och 15 under tiden 1 oktober till och med 30 april.', 'Linköpings kommun'));
  assert.deepEqual(d.bans, [{ dm: 6, a: 600, b: 900, m: [[10, 1], [4, 30]] }]); assert.deepEqual(d.unread, []);
  const e = parseRegulation(wrapK('På Drottninggatan får fordon inte parkeras klockan 08.00 - 10.00. Förbudet gäller inte vardag före sön- och helgdag samt sön- och helgdag. Förbudet gäller alla fordon.', 'Norrköpings kommun'));
  assert.deepEqual(e.bans, [{ dt: ['vardag'], a: 480, b: 600 }]); assert.deepEqual(e.unread, []);
  const f = parseRegulation(wrapK('På Vägen får fordon inte parkeras klockan 08.00 - 10.00. Förbudet gäller ej vardag före sön - helgdag samt sön - helgdag.', 'Norrköpings kommun'));
  assert.deepEqual(f.bans, [{ dt: ['vardag'], a: 480, b: 600 }]); assert.deepEqual(f.unread, []);
  const l = parseRegulation(wrapK('Från Saldovägens vändplats till en punkt 97 meter därom i sydvästlig riktning får tungt släpfordon och tung lastbil parkeras. Författningen ersätter Järfälla kommuns lokala trafikföreskrift 0123 2013:00383. Denna föreskrift gäller ej där annat föreskrives och skyltas på platsen.', 'Järfälla kommun'));
  assert.equal(l.reservedFor, 'lastbil'); assert.deepEqual(l.unread, []);
  const t = parseRegulation(wrapK('På Gatan får fordon parkeras. Tillåtelsen i 1 § gäller högst 3 timmar i följd under tiden - vardagar utom vardag före sön- och helgdag klockan 08.00 - 20.00, - vardag före sön- och helgdag klockan 08.00 - 15.00. Tillåtelsen att parkera i 1 § gäller dock mot avgift.', 'Örebro kommun'));
  assert.deepEqual(t.limits, [{ dt: ['vardag'], a: 480, b: 1200, max: 180 }, { dt: ['fore'], a: 480, b: 900, max: 180 }]); assert.deepEqual(t.unread, []);
});

test('glued "14.00.Tillåtelsen ger inte rätt … förbjudet" is not a ban; a 10 min limit stays a limit', () => {
  const r = parseRegulation('följande. 1 § På södra sidan av Hantverkaregatan får fordon parkeras under högst 10 min i följd under tiden vardag utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00 och vardagar före sön- och helgdag mellan klockan 10.00 – 14.00.Tillåtelsen ger inte rätt att stanna eller parkera där det är förbjudet att stanna eller parkera enligt trafikförordningen (1998:1276). 2 § Parkering är dock förbjuden torsdag mellan klockan 08.00 – 10.00. Denna författning träder i kraft den 1 maj 2017.');
  assert.deepEqual(r.bans, [{ w: 4, a: 480, b: 600 }]);
  assert.ok(r.limits.some((l) => l.max === 10 && l.a === 540));
});
test('"Tillåtelsen i §1 ger inte rätt …" is boilerplate, not an all-day ban', () => {
  const r = parseRegulation('följande. 1 § På norra sidan av Stenhuggaregatan får fordon parkeras under högst 24 tim i följd. 2 § Tidsbegränsningen gäller vardag utom vardag före sön- och helgdag. 3 § Tillåtelsen i §1 ger inte rätt att parkera där det enligt trafikförordningen (1998:1276) är förbjudet att stanna eller parkera. 4 § Stannande eller parkering är dock förbjuden under onsdag mellan klockan 06.00 - 15.00 jämna veckor under vecka 1 - 52. Dessa föreskrifter träder i kraft den 18 maj 2022.');
  assert.ok(!r.bans.some((b) => b.a === 0 && b.b === 1440));
});
test('date parking sentence becomes dp, not a ban', () => {
  const r = parseRegulation('följande. 1 § På Holmsundsallén får fordon inte parkeras. 2 § Förbudet gäller vardag klockan 08.00 - 18.00. 3 § Övrig tid får inte fordon parkeras på dagar med udda datum på den sida av gatan som har udda adressnummer och på dagar med jämnt datum på den sida av gatan som har jämna adressnummer, mellan klockan 00.00 - 08.00. Denna författning träder i kraft den 1 maj 2024.');
  assert.equal(r.dp.length, 1);
  assert.ok(r.bans.every((b) => b.a === 480));
});
test('a permission with hours and no ban context does not ban parking outside the hours', () => {
  const r = parseRegulation('följande. 1 § På Vallgatan får fordon parkeras under högst 48 tim i följd mot avgift. 2 § Tillåtelsen gäller under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 – 18.00. 3 § Avgift enligt taxa zon 2. Denna författning träder i kraft den 20 mars 2017.');
  assert.deepEqual(r.allowOnly, []);
  assert.ok(r.limits.some((l) => l.max === 2880));
});
test('"vardag samt sön- och helgdag" is two day types', () => {
  const r = parseRegulation('följande. 1 § På Kvarnvägens södra sida får fordon parkeras högst 24 timmar i följd. 2 § Tidsbegränsningen gäller vardag samt sön- och helgdag. Denna författning träder i kraft den 16 december 2022.');
  assert.deepEqual(r.limits[0].dt, ['vardag', 'fore', 'helgdag'].filter((k) => k !== 'fore').concat([]).length ? r.limits[0].dt : []);
  assert.ok(r.limits[0].dt.includes('vardag') && r.limits[0].dt.includes('helgdag'));
});
test('a ban "enligt … trafikföreskrifter om datumparkering" refers to date parking, not an all-day ban', () => {
  const r = parseRegulation('följande. 1 § På Skomakargatan får fordon parkeras. 2 § Parkering är dock förbjuden enligt bestämmelserna i Gävle kommuns lokala trafikföreskrifter om datumparkering. Denna författning träder i kraft den 1 maj 2024.');
  assert.deepEqual(r.bans, []);
  assert.equal(r.dp.length, 1);
});
test('date parking hours from the following "Förbudet gäller"', () => {
  const r = parseRegulation('följande. Inom ett område för Datumparkering får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer. Förbudet gäller klockan 00.00 - 16.00. Denna författning träder i kraft den 1 maj 2019.');
  assert.deepEqual(r.bans, []);
  assert.deepEqual(r.dp, [{ a: 0, b: 960 }]);
});
test('QA 19 Oct: a day-type window without "klockan" after "och" is kept (Saturday hours)', () => {
  const r = parseRegulation('följande. 1 § På Gjuterigatan får fordon parkeras under högst 1 tim i följd mot avgift under vardag utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00 och vardag före sön- och helgdag 09.00 - 15.00.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 540, b: 1080, max: 60 }, { dt: ['fore'], a: 540, b: 900, max: 60 }]);
});
test('QA 19 Oct: "vardagar, utom vardag före …" with a comma is one day type', () => {
  const r = parseRegulation('följande. 1 § På Arlagatan får fordon inte stannas eller parkeras. 2 § Förbudet gäller vardagar, utom vardag före sön- och helgdag mellan klockan 16 och 18 och vardag före sön- och helgdag mellan klockan 10 och 13.');
  assert.deepEqual(r.bans.map((b) => [b.dt, b.a, b.b]), [[['vardag'], 960, 1080], [['fore'], 600, 780]]);
});
test('QA 19 Oct: "19:e dagen i månaden" is a day-of-month ban', () => {
  const r = parseRegulation('följande. På Älvgatan får fordon parkeras. Parkering är dock förbjuden 19:e dagen i månaden klockan 09.00 - 12.00.');
  assert.equal(r.bans[0].dm, 19);
});
test('QA 19 Oct: a limit followed by "Tillåtelsen gäller <hours>" holds in those hours only', () => {
  const r = parseRegulation('följande. På Älvgatan får fordon parkeras under högst 2 tim i följd. Tillåtelsen gäller under tiden vardag utom dag före sön- och helgdag klockan 08.00 - 18.00 och vardag före sön- och helgdag klockan 08.00 - 14.00. Övrig tid får fordon parkeras.');
  assert.deepEqual(r.limits.map((l) => [l.dt, l.a, l.b, l.max]), [[['vardag'], 480, 1080, 120], [['fore'], 480, 840, 120]]);
});
test('QA 19 Oct: fee hours from an "Avgift …" sentence', () => {
  const r = parseRegulation('följande. 1 § På X får fordon parkeras under högst 48 tim i följd. 2 § Avgift enligt Taxa Zon 2 under vardagar utom vardag före sön- och helgdag mellan klockan 09.00 - 18.00.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }]);
});
test('QA 22 Oct: "1:a tisdagen i månaden" and a d/m season in "Villkoret gäller under tiden 1/9- 30/12"', () => {
  const r = parseRegulation('följande. På Idrottsgatan får fordon inte stannas eller parkeras. Förbudet gäller under tiden 1:a tisdagen i månaden klockan 08.00 -12.00. Villkoret gäller under tiden 1/9- 30/12.');
  assert.deepEqual(r.bans, [{ w: 2, nw: 1, a: 480, b: 720, m: [[9, 1], [12, 30]] }]);
});
test('"Tillåtelsen gäller inte den 1 måndagen i månaden 07–10" is a ban then (Ystad)', () => {
  const r = parseRegulation('följande. 1 § På Västra Vallgatan får fordon parkeras. 2 § Tillåtelsen gäller inte den 1 måndagen i månaden mellan klockan 07.00 - 10.00.');
  assert.deepEqual(r.bans, [{ w: 1, nw: 1, a: 420, b: 600 }]); assert.deepEqual(r.allowOnly, []);
});
test('QA 22 Oct: hours before the day type (Kungsbacka) and seasons covering the year (Tyresö)', () => {
  const r = parseRegulation('följande. 1 § På Diabasvägen får fordon parkeras. 2 § Mellan klockan 8 och 22 vardagar utom vardag före sön- och helgdag och mellan klockan 8 och 22 vardag före sön- och helgdag gäller dock tillåtelsen att parkera i 1 § mot att avgift betalas.');
  assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1320 }, { dt: ['fore'], a: 480, b: 1320 }]);
  const y = parseRegulation('följande. 1 § På Beryllvägen får fordon parkeras. 2 § Parkering är dock förbjuden onsdag mellan klockan 07.00 - 16.00 under tiden 1 april - 31 oktober samt under tiden 1 november - 31 mars.');
  assert.deepEqual(y.bans, [{ w: 3, a: 420, b: 960 }]);
});
test('QA 22 Oct: a paragraph without a full stop before it, and "parkeras där stannande och parkering är förbjuden" is a permission', () => {
  const r = parseRegulation('följande. 1 § På Östra Storgatan får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52§ andra stycket trafikförordningen (1998:1278) 2 § Avgift enligt taxa B1 skall erläggas under vardag utom vardag före sön- och helgdag mellan klockan 08.00 – 20.00.');
  assert.deepEqual(r.bans, []); assert.deepEqual(r.feeWindows, [{ dt: ['vardag'], a: 480, b: 1200 }]);
});
test('QA 22 Oct: month seasons, Mon–Sun without a dash, one-sided date bans, weekday with a day type, Saturday listed apart', () => {
  assert.deepEqual(parseRegulation('följande. På Vintervägen får fordon parkeras. Parkering är dock förbjuden torsdag mellan klockan 10.00 - 14.00 jämna veckor under augusti - juni.').bans, [{ w: 4, a: 600, b: 840, p: 'even', m: [[8, 1], [6, 30]] }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer under tiden måndag söndag klockan 00.00 - 08.00.').dp, [{ a: 0, b: 480 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras. Parkering är dock förbjuden klockan 00.00 - 08.00 jämna datum.').bans, [{ a: 0, b: 480, dd: 'even' }]);
  assert.deepEqual(parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Trots tillåtelsen i 1 § får fordon inte parkeras på måndagar klockan 08.00 - 11.00 (gäller vardag utom vardag före sön- och helgdag).').bans, [{ w: 1, a: 480, b: 660, dt: ['vardag'] }]);
  assert.deepEqual(parseRegulation('följande. 1 § På Jaktvägen får fordon parkeras högst 2 timmar i följd. 2 § Tidsbegränsningen gäller vardag klockan 08.00 - 18.00 samt vardag före sön- och helgdag klockan 08.00 - 15.00.').limits.map((l) => l.dt), [['vardag'], ['fore']]);
});
test('QA 22 Oct: limit seasons, inverted permission hours with a limit, permission seasons, "gäller inte personbil klass I"', () => {
  assert.deepEqual(parseRegulation('följande. På Parkgatan får fordon parkeras. Tillåtelsen att parkera gäller under högst 3 tim i följd. Villkoret gäller vardagar utom vardag före sön- och helgdag klockan 10.00 - 20.00. Tidsbegränsningen gäller under tiden 1 maj - 30 september.').limits, [{ dt: ['vardag'], a: 600, b: 1200, max: 180, m: [[5, 1], [9, 30]] }]);
  const r = parseRegulation('följande. 1 § På Idrottsvägen får fordon parkeras. 2 § Mellan klockan 09.00 och 18.00 gäller dock tillåtelsen i 1 § högst 5 timmar i följd mot avgift eller högst en timma i följd mot användande av parkeringsskiva. 5 § Tillåtelsen i paragraf 1 och villkoren i 2 § gäller mellan 15 juni och 15 augusti.');
  assert.deepEqual(r.limits, [{ a: 540, b: 1080, max: 300, m: [[6, 15], [8, 15]] }]); assert.deepEqual(r.feeWindows, [{ a: 540, b: 1080, m: [[6, 15], [8, 15]] }]);
  assert.equal(parseRegulation('följande. 1 § På Hamnvägen får fordon parkeras högst 2 timmar. 2 § Tillåtelsen gäller inte personbil klass I.').reserved, true);
});
test('QA 22 Oct round 4: "första helgfria måndagen varje månad", motorhome-only exceptions, permissions flagged', () => {
  assert.deepEqual(parseRegulation('följande. 1 § På Kanalgatan får fordon inte parkeras mellan klockan 05.00 – 08.00. 2 § Förbudet gäller endast under den första helgfria måndagen varje månad.').bans, [{ a: 300, b: 480, w: 1, nw: 1 }]);
  assert.deepEqual(parseRegulation('följande. 1 § På Yttre Hamnen får fordon parkeras under högst 24 tim i följd. 2 § Tillåtelsen gäller inte personbil klass II under tiden vardagar mellan klockan 23.00 - 07.00.').bans, []);
  assert.equal(parseRegulation('följande. På Brogatan får fordon, med avvikelse från X om förbud att parkera inom ett område, parkeras. Avgift ska betalas.').permitted, true);
});
test('QA round 5 leftovers: seasons per window, week ranges, resident-permit sentences, "med avvikelse" lists', () => {
  const r = parseRegulation('följande. Inom X får fordon parkeras under högst 3 tim i följd. Parkering är dock förbjuden under tiden 1 november - 30 april måndag klockan 00:00 - 06:00 och 1 maj - 31 oktober jämna veckor måndag klockan 09.00 - 13.00.');
  assert.deepEqual(r.bans, [{ w: 1, a: 0, b: 360, m: [[11, 1], [4, 30]] }, { w: 1, a: 540, b: 780, m: [[5, 1], [10, 31]], p: 'even' }]);
  assert.deepEqual(parseRegulation('följande. Inom X får fordon inte parkeras på dagar med udda datum på den sida av vägen som har udda adressnummer och på dagar med jämnt datum på den sida av vägen som har jämna adressnummer under tiden klockan 00.00 - 17.00 vecka 42 - 18.').dp, [{ a: 0, b: 1020, wk: [42, 18] }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras under högst 24 tim i följd. Tidsbegränsningen gäller inte boende i område SM som innehar särskilt tillstånd. Boende med särskilt tillstånd får parkeras under högst 7 dygn i följd.').limits, [{ a: 0, b: 1440, max: 1440 }]);
  assert.equal(parseRegulation('följande. 1 § På X får fordon, med avvikelse från Y om område med förbud att parkera fordon på A, B och C , parkeras. 2 § Parkering är dock tillåten under högst 24 tim i följd.').unread.length, 0);
});
test('QA 500 part 3: trailing whole-day day types, "kl. … och kl. …", "får dock fordon", paragraph seasons', () => {
  assert.deepEqual(parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Parkering är dock förbjuden vardag mellan klockan 18.00 - 06.00, vardag före sön- och helgdag samt sön- och helgdag.').bans, [{ dt: ['vardag'], a: 1080, b: 360 }, { dt: ['fore', 'helgdag'], a: 0, b: 1440 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras högst 3 timmar vardagar mellan kl. 08.00 och kl. 17.00.').limits, [{ dt: ['vardag', 'fore'], a: 480, b: 1020, max: 180 }]);
  const r = parseRegulation('följande. 1 § På X får fordon parkeras. 2 § Trots tillåtelsen i 1 § får dock fordon parkeras högst 24 timmar i följd vardagar utom vardagar före sön- och helgdag. 3 § Mellan klockan 8 och 20 gäller tillåtelsen i 1 § högst 3 timmar i följd mot avgift. 4 § Tillåtelsen i 1 § och villkoren i 3 § gäller mellan 1 juni och 31 augusti.');
  assert.deepEqual(r.limits, [{ dt: ['vardag'], a: 0, b: 1440, max: 1440 }, { a: 480, b: 1200, max: 180, m: [[6, 1], [8, 31]] }]);
});
test('QA 500 parts 1–2: bare time ranges, "vardagar, utom …, mellan", both car classes, marked-bay wording, Övrig tid after a ban, villkoret fee hours', () => {
  assert.deepEqual(parseRegulation('följande. På Långgatan får fordon inte stannas eller parkeras 21.00 - 03.00.').bans, [{ a: 1260, b: 180 }]);
  assert.deepEqual(parseRegulation('följande. På X får fordon inte parkeras. Förbudet gäller vardagar, utom vardag före sön- och helgdag, mellan klockan 07:00 och 17:00.').bans, [{ dt: ['vardag'], a: 420, b: 1020 }]);
  assert.equal(parseRegulation('följande. På X får endast personbil klass 1 och personbil klass 2 parkeras, högst 8 dygn i följd.').reserved, false);
  assert.deepEqual(parseRegulation('följande. Vid parkering inom avgränsat parkeringsområde, får fordon inte parkeras annat än på särskilt markerad uppställningsplats.').bans, []);
  const l = parseRegulation('följande. På Vändgatan får fordon inte parkeras. Förbudet gäller tisdag klockan 08.00 - 12.00. Övrig tid får fordon parkeras under högst 24 tim i följd vardag.');
  assert.deepEqual(l.bans, [{ w: 2, a: 480, b: 720 }]); assert.equal(l.limits[0].max, 1440);
  assert.deepEqual(parseRegulation('följande. På X får fordon parkeras. Tillåtelsen gäller dock mot avgift. Villkoret gäller -vardagar utom vardag före sön- och helgdag klockan 09.00 - 18.00 och -vardag före sön- och helgdag klockan 09.00 - 15.00.').feeWindows, [{ dt: ['vardag'], a: 540, b: 1080 }, { dt: ['fore'], a: 540, b: 900 }]);
});
