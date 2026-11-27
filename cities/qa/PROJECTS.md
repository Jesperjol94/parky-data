# Quality projects: the queue for the project runs

Why this file exists (20 Nov 2026): the daily random sample is a good thermometer but a slow broom. In three weeks the
share of correct lines stayed at 94–95 % while each run changed 15–100 of 114,000 lines. Two reports from the street
(Uppsala Österplan, Gävle Södra Rådmansgatan) led to fixes that changed 15,000 lines. So two of the three daily runs
now work through the known big groups below, one at a time, and the third keeps measuring.

How a project run uses this file:
1. Take the first project under "Queue" that is not ticked.
2. Do ONE batch of it as its entry says (normally: draw up to 240 regulations with the option given, have them read
   against the official text, fix the patterns found as general fixes with a test, apply, check, publish).
3. Add one dated line under the project's "Log" (what was read, how many were wrong and how, what was fixed, how many
   regulations the pool still holds). Add the usual line to DAILY.md too.
4. Tick the project when its pool is empty or its exit rule is met, and say so in the log line.

Draws use `node cities/rdt-qa-sample.mjs <count> <out.json> <seed> [--only a,b] [--check name] [--unread]`; its last
output line says how many unread regulations the pool still holds. Everything read is appended to `reviewed.txt`, so
no regulation is read twice, whichever run drew it.

No personal data in this file.

## Queue

### 0. [ ] Findings of the sweeps
A sweep (`sweep/README.md`) reads thousands of regulations with many readers at once and writes what it finds to
`sweep/findings/<name>.jsonl`: one line per regulation that a reader did not judge "ok" (verdict loose / strict / grey /
unsure, what the text says against what the app shows, a pattern, a short quote). A sweep fixes nothing. This project
turns its findings into fixes. While a findings file has open rows, this project comes first.

One batch:
1. Take the oldest findings file that is not listed as finished in the log below. Group its rows by pattern (the
   `pattern` and `what` fields; readers word the same thing differently, so group by meaning). Work the groups in this
   order: `loose` first (largest group first), then `grey` with `clear: true`, then `strict`, then `unsure`.
2. Take as many groups as one run can do well (normally 3–6). For each group, read the regulations again yourself
   against the text (`rdt/texts/<code>.jsonl.gz`, Stockholm: branch main `rdt/rdt.jsonl.gz`): a reader's verdict is a
   lead, not a decision. Where the reader was wrong, write that in the log and move on.
3. Fix the confirmed groups as general fixes with a test, exactly as in any project run (parser or pipeline step,
   never one street), apply, check, and publish under the publish rule. Rows from Stockholm (`"city": "stockholm"`)
   are fixed the way the weekly three-city check fixes Stockholm: a pull request against `main` with the same guard.
4. Log line: date, file, which groups (rows each) were confirmed and fixed, which were reader mistakes, how many rows
   of the file are still open. When every row of a file is fixed, refuted or written up as "cannot be settled from
   the text", write "finished: <file>" in the log.
Leads already grouped by the owner session (21 Nov), largest first; check each against the texts before fixing:
- (fixed 21 Nov, see the log) Turning-area bans greyed: plain all-day bans "På vändplatsen … får fordon inte (stannas eller) parkeras" / "I markerad
  vändplats …" whose line holds the right ban but carries `ut` (very short lines). About 330 regulations in Nacka, Täby,
  Södertälje (waves 2, 3, 5). The rule that greys short lines (rdt-tiny) should spare a line whose regulation is one
  plain all-day ban or reservation for the whole drawn area.
- Area-wide ban copied onto a cleaning street (`ov: 1` from rdt-overlay.mjs): an "on all roads in area X" ban is added
  to a street whose own regulation is a weekly or seasonal ban ("fredag 08–12, 1 nov–15 maj"). A cleaning ban only
  makes sense where parking is otherwise allowed, so the street is probably an exception to the area ban. About 15
  readers' flags (Sundbyberg, Nacka, Linköping, Björkhagsvägen, Eriksvägen, Villavägen …). This REMOVES bans: read the
  area regulation and five street texts first, and get the independent confirmation before publishing.
- "Parkering är dock tillåten under högst N tim … vardagar 08–21" on a disabled-only bay: the app keeps it reserved
  at all hours (about 15, Sundbyberg, Danderyd, Stockholm).
- Overnight fee windows split at midnight charge Monday 00–06 (Haninge taxa C, Södertälje).
- (fixed 21 Nov, see the log) A temporary ban that ends at a clock time ("… 28 februari 2027 klockan 16:00") ends at midnight before (`to` date).
- Järfälla taxa A: fee table "50 kr/dygn" is shown as 50 kr/h (display; check the table's unit).
- Seasonal fee paragraph not read ("taxa 9 … 1 juni – 31 augusti", Stockholm beach roads: Bredängs Badväg, Flatenvägen,
  Ålstens Skogsväg): FREE in summer where the text charges.
- Stockholm: an extra street-cleaning window in `s` from the ban day 16:00 to the next day 08:00 beside the text's
  08–16 ban (Bergviksvägen, Erik Tegels väg, Terriergränd, Bågvägen, Rissnavägen, Kummelvägen …): NO on the evening
  and night after. Likely from the city's servicetid record; compare with the text before trusting `s`.
- A date-parking line (`dp`, "datumparkering 02–16") answered FREE on both dates inside the window (Gävle, wave 6):
  check whether this is the both-sides rule in dpDay or a data fault.
- Stockholm loading zones: the limit in "Övrig tid får fordon parkeras under högst N tim i följd …" after the loading
  hours is not read, so the app shows unlimited parking outside them (Hans Werthéns gata, Skogsnävegränd,
  Ångermannagatan, Götalandsvägen, Ester Ellqvists Väg, Mäster Samuelsgatan …). Looser: high priority.
- A ban for some vehicles only ("cykel och moped klass II", Helsingborg Kungstorget) read as a ban for everyone.
- n-th weekday bans with "helgfria" ("1:a helgfria onsdagen") are kept as the plain n-th weekday (Jönköping, Örebro).
- Karlstad: the fee table shows "4 kr/tim" where the text names "taxa 4": check that the price is not the taxa number.
- A regulation's future end date ("upphör att gälla den 1 december 2026") is not copied to the line's `to` (Stockholm).
- The engine ignores a window's own `to` (temporary overlays `ov: 2`); harmless while the nightly build drops expired
  overlays, but the end is at 00:00 of the end date even when the text ends at a clock time.
- (22 lines fixed 21 Nov, see the log; check the rest) Bus-only (or other single-vehicle) bays where the text's hours belong to the time limit ("får endast buss parkeras
  … Tidsbegränsningen gäller 07–19"): the app reserves only in those hours and lets cars park the rest of the day
  (Linköping S:t Larsgatan, Västerås, Växjö, Helsingborg, Danderyd). Looser.
- A permission for one vehicle type read as a rule for every car ("får buss parkeras högst 5 min", motorcycle-only
  summer season turned into a summer ban for everyone; Helsingborg/Örebro "får endast personbilar parkeras" as a ban).
- (fixed 21 Nov batch 2, see the log) Växjö fee texts with fee hours given but `t` null + `fu`: PAID at all hours (Norra Esplanaden and others). Stricter.
  Measured 21 Nov: 47 lines of 27 regulations in cities/rdt/vaxjo.json; old texts "parkeras högst N dygn i följd mot
  avgift, zon X, vardagar kl 09–18 samt dag före helgdag kl 09–14" (the hours go to the limit only). Confirmed in
  waves 9–12 about 15 times: high priority.
- A stated start year typo ("3010-03-10") read literally: the ban never starts (Gävle 2180 2010-577).
- (wave 9) Stockholm: a ban sentence after a missing full stop is not read ("… 17.00 Under tiden torsdag klockan
  08–16 … får fordon inte parkeras"; Arkadvägen, Mariebergsgatan, 0180 2018-04057): FREE or PAID while the text bans.
  Looser. The same sentence with the full stop is read correctly.
- (wave 9) Stockholm "Parkering är dock tillåten …" exceptions: not read at all (ban shown at all hours), or a list of
  day types after it keeps only the first (Frejgatan: weekends shown reserved). About 6 rows. Stricter.
- (wave 9) Helsingborg: plain bans and limits on "markerat område" / "blå markerad sträcka" carry `ut` and are grey
  (about 7). Same family as the turning-area fix: extend that rule to plain all-day bans on marked areas.
- (wave 9) Västerås: "får endast fordon som används av boende i området med särskilt tillstånd parkeras" with fee
  hours is grey (6). The text says nothing about other hours; decide whether that is "reserved" or stays grey.
- (taxi, emergency vehicles, buses in regular service, chargeable cars and "Tillåtelsen gäller buss" fixed 21 Nov batch 2; the Västerås truck case is open) (wave 9) Vehicle words: "får taxi i tjänst parkeras" read as open to all (Växjö, looser); "gäller endast lätt
  lastbil och personbil" read as reserved for trucks (Västerås, stricter); "Tillåtelsen gäller buss" in its own
  paragraph not read (Sundsvall, looser).
- (wave 9) Växjö "utom dag före helgdag och helgdag" read as adding helgdag (stricter); Stockholm fee "taxa 10 kr/tim"
  with free first hours not read (looser).
- (wave 10) Typos in the text break the reading: Örebro "onddag" (the ban loses its day and applies every day,
  stricter) and "tmmar" (5 § and 6 § dropped: limit and Wednesday ban missing, looser). Tolerate common misspellings
  of day names and "timmar".
- (wave 10) A rule of the regulation this one replaced is still on the line (Arenastaden 4 h limit, Kapellgatan
  disabled-only). Stricter. Check how replaced ("upphävs") regulations are dropped.
- (wave 10) Night fee tables priced like the day table (Taxa B at the Taxa A price; Taxa D and B both 2 kr/h):
  check the fee-table prices in those towns.
- (wave 10) "får lastbil / motorcykel … parkeras" without "endast" read as a reservation (stricter); the opposite
  cases (taxi, buses) read as open. Settle the rule and apply it both ways.
- (wave 10, confirmed in the engine) The extra Stockholm servicetid window from 16:00 to 08:00 next day in `s` makes the
  app answer NO on its own (evaluate.js reads `s` as a ban), so those lines are stricter on that evening and night.
- (wave 11, confirmed in the engine) "1:a helgfria onsdagen": evaluate.js counts the plain n-th weekday (`nw`) and
  never skips a holiday. First real miss: Wednesday 6 Jan 2027 (Trettondedag jul) gets a ban that belongs to 13 Jan
  (Jönköping, Örebro). Fix before 6 Jan: a holiday-free flag on the window, read in the engine (app code: beta first).
- (wave 11) Night fee tables: Linköping 58000201 and 58000103 price every period, Taxa B 22–08 included, at the Taxa A
  price (10 and 2 kr/h). Check the town's Taxa B before changing; same question in Växjö and Norrköping notes.
- (wave 11) Dates written "15:april" drop the season (Eskilstuna Årbygatan: winter ban shown all year).
- (wave 11) Stockholm "Parkering är dock tillåten" windows stored in `s` (Rålambsvägen): part of the `s` problem above.
- (wave 13, rest of the country) A one-off dated ban held as a yearly season with no year (Piteå 20–28 July 2026,
  Linköping 28 Oct–15 Nov 2024): it comes back every year. Stricter. Carry the year into `fr`/`to`.
- (wave 13) Hours or seasons dropped so a ban or reservation holds at all times: school-day bans 07/08–16 (Forshaga,
  school yards), overnight stopping bans 20–02 (Dorotea), "1 maj – 30 november tillåtelse, övrig tid förbjuden"
  (Sundsvall), seasonal stopping bans, driving-school bays Mon–Fri. Stricter; the largest group outside the big towns.
- (wave 13) "Avgift behöver inte erläggas de N första timmarna" / free first hour with a parking disc: the app charges
  from the first minute (several towns). Stricter.
- (wave 13) Two paragraphs for different spots or sides merged into one line, so the stricter rule shows everywhere.
- (wave 13) Karlskoga and a few others: texts come through garbled; the line follows the title only (unsure).
- (wave 14) Time-limit hours read as the only hours parking is allowed (`aw`): NO in the evening and at weekends where
  the text allows free parking (Hudiksvall, several). Stricter.
- (wave 14) Per-day fees shown as per hour ("20 kr/dygn" answered 20 kr/h: Ystad, Järfälla and others). Fix in the
  fee-table unit for every town at once.
- ("laddbara fordon" fixed 21 Nov batch 2; "resande med tåg eller buss" and "endast släpvagnar" open) (wave 14) Spots for one purpose shown open to all cars: "får laddbara fordon parkeras", "resande med tåg eller buss",
  motorcycle-only, "endast släpvagnar". Looser: high priority.
- (wave 14) "enligt taxa N får fordon parkeras" not read as a fee (shown free; Lidköping and others). Looser.
- (wave 14, reading question) "Parkering är dock tillåten under högst N tim …" on a disabled bay: readers differ on
  whether it opens the bay to all cars or limits permit holders. Settle this with the independent reviewer before
  the disabled-bay fix above changes anything; until then the app keeps those bays reserved.
- (wave 15) Summer-only fees: the season is in the fee table's label ("15 kr/tim 1 juni–31 aug") but not in its
  periods, so the app charges all year (Vaxholm and about 6 others). Stricter. Skövde (1496): texts say 5 kr/h
  (40 kr/dygn), the generic table charges 20 kr/h (4 lines). Fix both in the fee tables.
- (wave 15) "torsdagar som infaller vardagar" read as `vardag` only: a Thursday before a holiday loses its ban
  (Skellefteå 2482, twice). Looser. It means vardag + fore.
- (wave 15) A ban sentence at the end of the text not read (a 21–05 stopping ban), and loading-exception hours read as
  the ban's hours (free at night under an all-day ban). Looser.
- (wave 16) Karlskoga (1883): 191 of 299 texts in rdt/texts/1883.jsonl.gz look garbled (PDF font encoding), so their
  lines follow the title only and cannot be checked. Re-extract those PDFs (another text layer or OCR), then re-read.
- (wave 16) "betala eller högst 1 tim med parkeringsskiva": only the fee is shown, the free disc hour is not (about a
  dozen across waves 13–16; Ängelholm and others). Stricter; drivers may pay when they need not.
- (wave 16) Written-out or week-number seasons not read ("mellan första november och 31 mars", "lördagen vecka 27 –
  söndagen vecka 28"); short day forms ("8-18 på vardagar och 8-15 på lördagar", Svedala) read as Mon–Fri all day.
Done: seasonal motorcycle bays without hours in the open window (main PR #8, 21 Nov). Stockholm's live data still
predates it: the city's API answered HTTP 500 on 21 Nov (nightly and a rerun), so the fix reaches the app with the
next nightly that can fetch. Sweep flags of this kind in Stockholm until then are already fixed.

Exit: every findings file is finished and no sweep is scheduled.

Log:
- 2026-11-21 · `wave1-2026-11-20.jsonl` (149 rows), first batch, with the same patterns in waves 2–8 · confirmed and fixed:
  (1) tiny lines greyed (56 grey rows here, about 600 over all waves): rdt-tiny now keeps a lone tiny line as fact when its whole rule,
  read from the text, is one plain all-day ban or one plain reservation (`plainWholeRule` in rdt-lib.mjs): 1,568 lines un-greyed (1,139 bans,
  423 reservations checked one by one against their parse; Nacka 256, Helsingborg 107, Höör 88, Södertälje 86, Mölndal 79, Täby 68); 434
  of the 664 grey findings outside Stockholm are now shown as fact; tiny lines with hours, limits or fees (664) stay grey by design.
  (2) end date with a clock time (4 loose rows, Uppsala): "upphör att gälla den 27 november 2026 klockan 16:00" now ends the line the day
  after (`endDay`), 120 lines; before, the app showed FREE on the whole last day. (3) Bus, truck and motorcycle bays whose hours belong to
  the time limit ("får endast buss parkeras högst 3 tim … Tidsbegränsningen gäller vardag 09-19", Sollentuna Kung Agnes väg, Linköping
  S:t Larsgatan: also the lead "Bus-only bays" above): stale open hours `o` removed, 22 lines reserved at all hours again. (4) "Övrig tid
  råder parkeringsförbud" after a limit on named weekdays (Solna Kristinelundsvägen): banned at night and at weekends. (5) "Förbudet gäller
  inte vid lastning och lossning (av gods)" / "för på- och avstigning" is an exemption, not an unread rule: Solna Gustav III:s boulevard
  "vardag" 09–12 now Saturdays too, Danderyd Studievägen and Skolgårdsvägen get their 07.30–08.30 stopping ban. (6) Stockholm loading
  zones, "Övrig tid får fordon parkeras under högst N tim" (5 loose rows here, the lead above): read as a limit outside the loading hours
  (13 Stockholm texts, Västerås Västra Ringvägen in the register); in main PR #9, NOT merged yet (see DAILY.md).
  Reader mistakes: 17 Uppsala rows "PAID at every hour" (fee tables 380xxxxx hold Mon–Sat 08–24 and the app is free outside them: the
  sheet tool had not loaded the table); 9 Stockholm motorcycle-season rows were fixed by main PR #8 before this run.
  Cannot be fixed here (told the owner 21 Nov, do not repeat): Stockholm's build ignores the fee hours the parser reads (taxa 9 beach
  roads, 3 loose rows: `applyRegulation` only fills `t` when it is empty) and adds the inverted 16–08 cleaning windows in `s` (5 strict
  rows): both are in main's build, outside the parser. 29 "parking disc not shown" rows are display only.
  Still open in wave 1 (about 35 rows): one-off wordings (Uppsala 2024-500 and 2025-83 "får fordon" missing, Upplands Väsby 2023-2
  "Stannande- och parkeringsförbud gäller dock …", Sollentuna 2018-440 utryckningsfordon, Uppsala 2019-646 bicycle garage shown as car
  parking, Solna "uddda veckor", Solna overnight fee hours per day type 2015-00049/-00055, Uppsala 2014-00032/2011-00021 fee days) and
  the grey Solna fee-plus-cleaning lines that are tiny. Next batch: these singles, then wave 2's loose rows.
- 2026-11-21 batch 2 · `wave1-2026-11-20.jsonl` singles, the loose rows of waves 2–3 and the same shapes in waves 9–14 · every row read again
  against its text; confirmed and fixed (parser, each with a test; 95 lines of 77 regulations in 33 municipalities changed):
  (1) a place followed straight by "parkeras" has lost "får fordon" ("På den del av X som anges i kartan parkeras under högst 4 tim"): 20 texts
  now read (Uppsala, Nacka Kvarnholmsvägen, Burlöv, Vadstena, Kumla); with "Tillåtelsen gäller 1 april - 31 oktober. Övrig tid får fordon inte
  parkeras" the rest of the year is banned (Uppsala Eriksbergsvägen, Söderhamn ×2 were free in winter). (2) "Parkeringsförbud övrig tid" /
  "Parkeringsförbud gäller övrig tid" / "Stannande- och parkeringsförbud gäller dock måndagar - fredagar …" (Täby Djursholmsvägen free 22–07,
  Nacka Diligensvägen free outside Wednesdays, Upplands Väsby 2023-2 had the ban hours as fee hours). (3) a permission for one kind of vehicle
  without "endast" is a bay for it: "får utryckningsfordon / taxi i tjänst / taxifordon / buss i linjetrafik / laddbara fordon parkeras",
  "Tillåtelsen gäller buss i linjetrafik", "Gäller alla bussar …" (Sollentuna Tingsvägen, Växjö Drottninggatan, Eslöv, Sundsvall Hamngatan, Värmdö,
  Alvesta gave every car the bay's limit; 6 grey lines became reserved). (4) a plain stopping ban "får inte fordon stannas." and "råder förbud mot
  att stanna eller parkera fordon" were never read (about 280 texts; nearly all lines already held the ban from the register, now verified), and
  "Förbudet gäller inte vid taxi i tjänst / för skolbuss och taxi / ej buss i linjetrafik" is an exemption: 10 lines the register showed as
  taxi-only at all hours now show the text's ban hours (Bräcke, Kristianstad ×3, Landskrona ×3, Markaryd, Mjölby, Solna). (5) second hour range
  keeps the weekdays of the first ("måndag - fredag 08-10 och 15-17", "klockan 7-10 samt 15-18": Upplands Väsby Ryttargatan, Lidingö Kalvhagsvägen,
  Södertälje Högåsavägen, Herrljunga). (6) hours first with their day types after a comma ("klockan 18.00 - 07.00, vardag utom …, klockan 00.00 -
  24.00, vardag före … och sön- och helgdag": Solna night-fee streets ×7 charged Mon–Fri around the clock). (7) Växjö "mot avgift, zon 2, vardagar
  utom dag före helgdag kl 09-18 samt dag före helgdag kl 09-14": the fee hours (19 texts, the lead above; fee "see the sign" in those hours,
  free outside). (8) small shapes: "uddda veckor", "högst15 min", "Övrig tid är parkeringen tillåten under högst 5 minuter" (Uppsala Götgatan),
  limit hours keep the day type the limit was stated with (Upplands Väsby Holmvägen, Hässleholm), "Övrig tid är parkering tillåten utan avgift och
  tidsbegränsning" (Danderyd Brovägen: fee and limit 09–17 only; it was shown free), a ban's season the register had put on the limit too
  (Järfälla Kopparvägen, Botkyrka Lagmansbacken ×6: `limitSeasonFromBan` in rdt-lib), Haninge Rudsjöterrassen bus bay.
  Reader mistakes or already right: Danderyd 2003-1860/-1862 (ban and limit both on the line), Täby 2015-00165 (fixed in batch 1), Solna 2022-2
  (parking is banned at all hours as the text says; one stopping flag per line). Cannot be settled from the text: Uppsala 2014-00032 / 2011-00021
  (fee days not named), Nacka 2025-00118 (text cut off). Still open in waves 1–3: Uppsala 2019-646 bicycle garage shown as car parking, Solna
  2020-00763 (fee 19–07 only, two fee tables in one sentence), Haninge 2026-319 (fee by named weekday: the fee table has no weekdays),
  Örnsköldsvik 2284 2026-00094, Alvesta 0764 2016-19 "resande med tåg eller buss", Täby multi-part 2021-00137 / 2022-98, Danderyd 2001-1310,
  and motorhome bays whose "högst N tim" hours are read as the hours the bay is reserved (Varberg 1383 2014-00190, grey: a first try gave 49
  bays a limit and broke the 20 Nov caravan test, taken out). Independent check: 60 changed lines (every one that lost or narrowed a ban, limit,
  fee or reservation), 59 confirmed; the one not confirmed (Varberg, an open-hours flap on a grey line, not from this batch) was restored.
  Next batch: the open rows above, then the strict and grey-clear rows of waves 2–3.
- 2026-11-22 batch 3 · the loose rows of ALL waves outside Stockholm (291) and the strict rows of waves 1–15 (189): 480 regulations / 678 lines read again
  against today's lines by 8 readers, then each fixed group by hand against its text · on today's data: 103 correct (44 of the loose rows and 59 of the strict
  rows were already fixed or reader mistakes), 248 looser, 121 stricter, 8 unsure · confirmed and fixed, each with a test (295 lines of 195 regulations in
  55 municipalities changed): (1) bays for one kind of vehicle or a named group that showed as a limit for every car (73 lines newly reserved, 20 of them
  were grey): "får endast släpvagn(ar) / fordon klass II / motorfordon över 3,5 ton … / personbil med tillkopplat släpvagn / båttrailer parkeras", vehicle
  lists without "endast" ("får motorcykel och moped klass I, parkeras", "får moped klass I och moped klass II", "får bussar / turistbussar (stannas eller)
  parkeras", "får elbilar"), "ska vara laddplats" as the whole sentence, "får endast fordon med tillstånd / besökare till … / fordon för
  biblioteksverksamhet parkeras", "Tillåtelsen gäller (dock) endast (för) besökare / personal …", disabled bays worded "endast sådant fordon … rörelshindrad",
  "får - under högst 2 timmar - endast sådant fordon", "får fordon parkeras högst 2 timmar för rörelsehindrade personer med tillstånd", a glued "helgdag.2 §";
  a visitors' bay with hours and "Övrig tid får fordon parkeras" is open outside them (Orust ×2); inside an area parking ban a bay's hours no longer open the
  other hours (Hudiksvall). Not touched: "motor- och släpfordon under 3,5 ton" (ordinary cars), residents' permits. (2) "Övrig tid 24 timmar." / "Övrigt tid
  2 timmar" / "Övrig tid gäller parkering max 24 timmar." / "Övrig tid är parkering tillåten under 24 timmar i följd" / "Övrig tid får fordon parkeras 24 tim":
  a second limit outside the stated hours or season (Gnesta ×3, Tanum ×2, Ronneby, Partille, Laholm, Mariestad). (3) a limit of a day or more before "mot
  avgift <hours>" ("högst 10 dygn i följd och mot avgift vardagar … 09–18", "högst 24 timmar i följd mot avgift, zon 1, …") holds at all hours, the hours are
  the fee's: 96 texts, about 180 lines (Västervik, Växjö, Kalmar, Södertälje, Borlänge, Ystad). (4) exemptions: "Förbudet gäller inte under tiden onsdag
  klockan 08–16" after an all-day ban = parking only then (Nyköping); an exemption for loading, boarding, refuse trucks or school transport with its own
  terms leaves the ban standing (Gnesta, Vetlanda, Töreboda showed N minutes of free parking; Mönsterås, Hudiksvall a ban by day only); an unread dated or
  timed exemption where the register had made the exemption's hours the ban's is grey (rdt-reparse `unreadExemptionOnly`, 7 lines: Helsingborg F M Franzéns
  gata ×3 "3:e måndagen i månaden", Borlänge Musikanten, Ovanåker, Laxå). (5) day types and small shapes: "vardagar utom sön- och helgdagar" = Mon–Sat
  (Västervik), "vardag rore sön-" (Gotland), "Förbudet gäller vardagar, mellan klockan …" (Vilhelmina), "får motordrivet fordon / motorfordon / bil parkeras"
  (Bjuv ×12, Kiruna, Mönsterås, Ulricehamn, Värnamo), Degerfors' "får fordon 3 kap. 48 § trafikförordningen (1998:1276) parkeras" and "Tidsbegränsningen och
  gäller" (17 texts), "Tidsregleringen gäller …" (Mölndal, Karlskrona, Helsingborg), "enligt kartbild och enligt taxa 1 får fordon parkeras" is a fee
  (Lidköping ×9, were free: now "fee – see the sign").
  Reader mistakes or not errors: Alvesta 0764 2016-19 "fordon med resande med tåg eller buss" (commuter parking, any car), Mjölby ×6 and Karlskrona 2015-70 (a
  stopping ban shown as a parking ban: display of `sb`, no car is let in).
  Still open among the loose rows (165 regulations, next batch, largest first): plain "vardag(ar)" kept as the register's Mon–Fri where the sentence is
  unread for another reason (Ydre, Gnosjö, Finspång, Svedala ×5 "8-18 på vardagar och 8-15 på lördagar", Burlöv, Eslöv); Mölndal "Avgiftsplikten gäller vardag
  samt sön- och helgdag" ×7 (the fee hours are in the town's taxa regulation, not in the text); "Datumparkering gäller på denna plats" (Sandviken ×5, Kiruna,
  Ludvika ×2, Upplands-Bro); seasons bound to the wrong rule (Sotenäs ×5, Orust ×4, Båstad, Lysekil, Kiruna, Luleå); "Parkering är dock förbjuden …" /
  "Fordon får dock inte parkeras onsdag …" bans not read (Borgholm ×2, Vaxholm ×2, Karlshamn, Öckerö, Karlskrona); "N:e helgfria <weekday>" (Jönköping ×3,
  app side); week-number bans (Vellinge ×2, Rättvik); exemptions with a bay limit (Lekeberg, Rättvik, Tanum 2024-4); single texts (Uppsala 2019-646 bicycle
  garage, Täby 2021-00137 / 2022-98, Haninge 2026-319, Gävle 2010-577 year 3010, Örebro 2026-01257 two periods, Kungsbacka ×4). The 121 stricter rows are
  untouched: "Parkering är dock tillåten under högst N tim" on disabled bays (about 25, the reading question above), "dock tillåten" exceptions cut out of bans,
  seasons and school days dropped, two sides merged.
  Independent check: every line that lost or narrowed a ban, limit, fee or reservation, every un-greyed line, and 28 others (62 lines): 61 confirmed, 1 not
  (Orust Södra Strandvägen was reserved around the clock on the first pass: the open hours were not carried over; fixed in rdt-reparse and confirmed on a second
  check). Rows of the files still open: about 165 loose, 563 strict (189 of them read today, 59 already right), 324 unsure, 1,328 grey outside Stockholm; Stockholm 45 loose, 69 strict.
- 2026-11-24 batch 4 · the 175 loose rows outside Stockholm whose lines had not changed since the sweep, read again by hand against their texts, largest groups first ·
  confirmed and fixed, each with a test (138 lines of 87 regulations in 45 municipalities changed; 53 of the 175 rows now differ from the swept line):
  (1) day types (about 25 rows): where the parser reads a window and the line holds the same hours, the text's wider day types replace the register's, also when
  another sentence is unread (`dayTypesFromText` in rdt-lib: plain "vardagar" = Mon–Sat, "vardagar och vardag före sön- och helgdag", three day types listed, Hagfors'
  "vardagar, dock ej dag före …" held as Saturdays; never narrower, never on a text window without day words); parser: "torsdagar som infaller vardagar" includes a
  Thursday before a holiday (Skellefteå ×5), "samt helgdag kl 00–24" is Sunday (Växjö), hours before ", vardagar och vardagar före sön- och helgdag" (Hässleholm),
  "Bestämmelserna gäller vardagar och helger samt dag före helg" (Partille), school-transport bays and plain bans worded "får inte annat fordon än skolskjuts parkeras",
  "råder parkeringsförbud vardagar kl …", "Förbud att parkera skall gälla vardagar …" (Åsele, Sunne, Ydre, Gnosjö: Saturdays were free; Sunne was banned on Saturdays
  only). (2) ban sentences not read: a ban with its own hours is now added when the only unread sentence is about the permission (Borgholm ×4 lines, Öckerö ×3 had no
  morning/night ban); "Förbud att stanna och parkera på X gäller mellan 21-05 alla dagar" (Karlshamn), "Parkeringsförbud på sträckan råder under tiden …, med undantag
  för varutransporter" (Falun), "melllan" (Vaxholm ×2: Wednesday ban Nov–May), ", under övrig tid får fordon inte parkeras" in the same sentence (Österåker),
  "Övrig tid parkeringsförbud" after "Villkoret gäller <season>" (Karlshamn), a taxi stand outside the limit's hours ("Övrig tid … ändamålsplats för … taxitrafik",
  "Övrig tid gäller Taxiplats": Kungsbacka, Skövde, Jönköping were free at night). (3) second periods: "Förbudet gäller under tiden 14 september - 5 oktober och 30
  november - 21 december" (Örebro Kungsgatan: the ban from 30 Nov was missing), "klockan … 20 augusti - 23 december samt klockan … 7 januari - 14 juni" (Stenungsund),
  "00.00 - 07.00, 09.00 - 14.00 och 17.00 - 24.00" (Kungsbacka), "16,30" (Vellinge), "8-18 på vardagar och 8-15 på lördagar" (Svedala ×5), two limits each with its
  season (Karlshamn). (4) date parking by reference: "Datumparkering gäller på denna plats", "Övrig tid gäller datumparkering", "På X gäller gatuparkering enligt
  datumparkering" (Sandviken ×8, Ludvika ×2, Upplands-Bro, Gävle: `dp` with `ref`); Kiruna's "dock längst 30 minuter" is the limit and the 00–08 hours are date parking's.
  (5) a season on the limit that the text does not give it (`limitSeasonNotInText`: the fee's season, the season a ban is lifted in, or no season in the text):
  the limit holds all year (Båstad ×2, Orust ×11 lines, Lysekil ×7, Kiruna Porfyrvägen ×4, Sotenäs Köpmansgatan); Luleå Rundgatan is banned Nov–May.
  Reader mistakes or not errors: Mjölby ×6, Trelleborg, Falun 2020-00179, Karlskrona 2015-70 (stopping ban shown as a parking ban: no car is let in), Alvesta 2016-19.
  Independent check: all 15 regulations (35 lines) where a ban, a limit or grey was narrowed or lifted: 15 confirmed. Of 12 stricter ones checked as well, 8 confirmed;
  the reviewer's 4 remarks are about wording, not about letting a car in (a taxi stand shown as "no parking" ×2, Österåker's parking ban at night flagged as a stopping
  ban, Örnsköldsvik "… klockan 02.00- 08.00 och udda datum" may also mean every day): kept, all four are stricter than the old line.
  Still open among the loose rows (122 unchanged lines; some are right already): permissions that hold only in stated hours or a season as an exception from an area ban
  (Gävle 2026-211/-213, Vimmerby, Örebro 2024-00321, Örnsköldsvik ×2, Östersund, Sotenäs 2025-15, Lysekil 2022-10, Sundsvall ×2, Laholm, Gislaved); Sotenäs 2025-34/-42/-44/-45
  (seasons of "villkoren i 2 §/3 §" swapped: the paragraph count does not line up); Mölndal fee days ×7 (not in the text); motorhome bays "personbil klass II" with a
  day fee (Ängelholm ×3, Karlstad); residents-only (Kalmar ×3, Uddevalla, Vaxholm, Orust 2022-4); "N:e helgfria" (app side); week-number bans (Vellinge ×2, Rättvik);
  Strömstad Ångbåtskajen (heavy-vehicle ban plus "Övrig tid får fordon inte parkeras": inverted on the line); Eslöv 2021-16, Ljusdal, Nybro and Ulricehamn (garbled day
  lists), Lerum and Tanum 2025-33 "Övrig tid … 24 tim" with a trailing word; singles from batch 3's list. Then the 512 strict rows whose lines are unchanged.
- 2026-11-24 batch 5 · the strict rows outside Stockholm (563), grouped by pattern and the five largest groups that the parser can settle read again by hand against their
  texts (about 260 rows) · confirmed and fixed, each with a test (145 lines of 93 regulations in 38 municipalities changed; 82 strict rows now differ from the swept line):
  (1) a limit's hours taken as the only hours parking is allowed (`aw`, 72 lines): "… får fordon, med avvikelse från … parkeringsförbudszon, parkeras. Tillåtelsen att
  parkera i 1 § gäller dock högst 1 tim i följd. villkoret gäller under tiden vardagar … 09.00 - 16.00" and "… gäller dock högst 24 timmar i följd, vardagar utom …": the
  permission has no hours, "dock högst N" only limits it (Hudiksvall, 33 regulations answered NO every evening and weekend: the open question of 25 Oct, settled by the
  wording "villkoret gäller"); the title of the regulation a text replaces ("… träder i kraft …, då … om förbud att parkera på X ska upphöra att gälla") no longer
  counts as a ban context (Perstorp Bryggaregatan, Burlöv Hamngatan, Linköping Hedborns gata). (2) "får fordon inte parkeras (under) längre tid än N / i längre följd än N"
  is a limit, and a "Förbudet gäller <hours>" after it, or after "parkeras under högst N" in a text that bans nothing, gives the limit's hours (Sollefteå ×3, Vilhelmina ×2,
  Laxå ×2, Lund, Filipstad, Hallstahammar, Lycksele, Tingsryd, Lomma, Salem: 19 lines were drawn as bans). (3) exceptions to an all-day ban: "Parkering är dock tillåten
  april - november" leaves a winter ban (Ulricehamn ×6); "Parkering är dock tillåten under högst 2 tim mellan klockan 06.00 – 22.00" = allowed then with the limit, banned
  outside (Värnamo), without hours a plain limit (Forshaga). Not when the exception is for marked bays, for loading, or on one named weekday. (4) a bay for one kind of
  vehicle with "endast" and its own hours or season, no limit, fee, ban or area ban in the text, is open at other times (12 lines: Simrishamn ×3, Vänersborg ×2, Varberg,
  Upplands-Bro, Söderköping, Sigtuna, Mjölby, Trelleborg, Årjäng; rdt-reparse now writes the off-season `o` window as the engine does for Stockholm). (5) hours and seasons
  of a ban that were dropped: "den 15 maj t.o.m. 15 september", "30:april", "mellan kl 18.00 – kl 02.00", hours straight after a season, "får fordon under tiden … inte
  parkeras", "får fordon på tisdagar inte parkeras …", "Förbudet gäller på dagar med jämna datum …" beside its own plain ban (Bollnäs ×3), "Tillåtelsen gäller 1 maj - 30
  november. Övrig tid är parkering förbjuden" (Sundsvall ×2: winter ban only), "Tidsbegränsningen gäller alla dagar" after the hours (Huddinge), date parking's season
  (Kiruna); pipeline: the register's weekly twin of an n-th weekday ban is dropped (`nthWeekdayFromText`: Hässleholm ×5 were banned every Tuesday, not one a month).
  Left as they are, on purpose: "Parkering är dock tillåten under högst N tim" on disabled bays (about 25 rows: the bay stays reserved, the rule of this project);
  an all-day ban with "Under tiden onsdag klockan 08.00 - 16.00 får dock fordon parkeras" or "… dock tillåten 4 tisdagen i månaden 08.00 - 18.00" (Borlänge ×12,
  Nyköping ×5, Helsingborg ×9: read literally parking is allowed only on the cleaning day, which looks like the register's form filled in backwards; the lines stay banned,
  the safe side: the sign decides); exceptions for marked bays on a banned street (Mjölby, Katrineholm, Båstad, Vallentuna: the line is the street).
  Independent check of all 97 distinct changed lines by a reviewer who did not write the fixes: 95 confirmed, 2 not: Kalmar Gustaf Adolfs väg 0880 2025-51 ("Tillåtelsen
  gäller vardagar utom … under högst 24 tim" without "dock", inside an area ban: weekends stay closed) and Tanum Sjövägen 1435 2017-46 ("dock tillåten under högst 5
  minuter för i och urlastning": the ban stays). Both readings were taken out of the parser (with tests), the data rebuilt from the last commit; nothing unconfirmed is in.
  Still open among the strict rows (481 unchanged; many are not parser errors): disabled bays with hours and an explicit "Övrig tid får fordon parkeras" (Söderhamn ×3,
  Laholm, Sundbyberg 2025-00018, Karlskrona 2010-0833: reserved around the clock, next batch); fee or free disc time (Kungsbacka ×13, Ängelholm ×5, Tanum, Sotenäs),
  free first hours (Skellefteå ×3, Nyköping) and per-day prices: display, app side; fee seasons missing in the fee table (Vaxholm ×12, Borgholm ×8, Landskrona ×2, Båstad,
  Lysekil, Vellinge, Ystad) and Skövde's prices (×8): fee tables; vehicle-class bans read as general (bicycles, motorhomes, heavy vehicles: about 20); area-ban overlays
  `ov: 1` on streets with their own rule (about 17, removes bans: needs the area texts); multi-part texts merged (Norrtälje ×12, Säter ×4); school days and school terms;
  week numbers; one-off dates kept as yearly seasons; stopping flag from the title (display).
- 2026-11-25 batch 6 · the 452 strict and 157 loose rows outside Stockholm whose lines had not changed, grouped again; six groups read by hand against their texts (about 190 rows) ·
  confirmed and fixed, each with a test (132 lines of 74 regulations in 48 municipalities changed; every fix measured on all 70,817 texts: 99 parse differently, none in Stockholm):
  (1) bans and bays that are for other vehicles (41 lines now "no rule for cars", `hv`): bicycles and mopeds ("får cykel och moped klass II inte parkeras", "får cyklar inte parkeras
  utanför … cykelställ", "… endast parkeras i särskilt anordnade cykelställ": Linköping Resecentrum ×12, Helsingborg Kungstorget, Konsul Perssons plats, Lund Västra Stationstorget,
  Örebro Köpmangatan, Varberg resecentrum ×5 was a motorcycle bay), "Förbudet gäller endast (för) husbilar / lastbil / lastbil, tung lastbil, fordonståg och släpfordon" (Borgholm ×4,
  Kiruna ×4, Mariestad ×3, Mora ×2: the parser dropped the ban but the register's stayed), "får personbil klass II och släpvagn inte stannas eller parkeras" read as a motorhome BAY
  (Falkenberg, Karlshamn, Båstad), "Tillåtelsen gäller inte husvagn och husbil … 20–06" (Höganäs), detached trailers (Krokom), "Parkering är förbjuden utanför markerad plats" is
  where to stand (Karlskrona ×2). (2) reservations the register held but the text does not give (38 lines): "Tillåtelsen gäller endast lätt lastbil och personbil klass I" is no
  truck bay (Västerås ×12, Köping ×3); a new pipeline rule (`carsPermitted` in rdt-lib) drops a register reservation when the fully read text plainly lets every car park and
  reserves nothing ("får fordon parkeras mot avgift": Jönköping Kapellgatan, the lead of wave 10; "får endast personbil klass I och motorcykel parkeras": Ystad ×5, Simrishamn, Lerum,
  Helsingborg; Mark Boråsvägen; Borgholm Verdandi gränd ×4); what permit holders get on top of a permission for every car is read as that ("Rörelsehindrad person med
  parkeringstillstånd … får parkera under högst 3 tim": Visby ×10 lines were "disabled only", Falkenberg Storgatan ×2). (3) disabled bays reserved at stated hours whose text says
  "Övrig tid får fordon parkeras" / "övrig tid är det allmän parkering" (the group named for this batch): open to all outside those hours (`o`, 12 lines: Söderhamn ×3, Laholm ×4,
  Sundbyberg ×3, Karlskrona). Bays with "Parkering är dock tillåten under högst N tim" or with hours and nothing about other times stay reserved, as before. (4) permissions inside
  an area parking ban ("med avvikelse från … om förbud att parkera …"), the loose rows: the permission's own hours are allowed-only hours (Örebro Almbyvägen was open at night), a
  seasonal permission leaves the area ban the rest of the year ("… under högst 8 dygn i följd mot avgift under tiden 15 juni - 15 augusti": Lysekil ×4; "Tillåtelsen att parkera gäller
  under tiden 1 oktober - 31 maj": Östersund; "Tillåtelsen gäller endast under perioden …": Örnsköldsvik; "Tillåtelsen i 1 § och villkoren i 2-4 §§ gäller mellan 1 juni och
  31augusti": Sotenäs Skolgatan ×2): bans added on 9 lines. (5) hours and seasons that slips of the pen had hidden: "07 0ch 16" (Simrishamn), "(Tidsbegränsningen gäller" (Sollefteå),
  "mellan klockan 03:00 och klockan 05:00" (Kumla ×2: banned around the clock), "från klockan 19:00 till påföljande dag klockan 01:00" (Jokkmokk ×2), "15 oktober till 15:april"
  (Eskilstuna), "15oktober-15 maj" (Värmdö ×2), "perioden I november" (Lycksele), "under augusti" (Orust), "Förbudet gäller ej juli månad" (Tidaholm, Jönköping Gärdesvägen), "den 1
  varje månad" (Eslöv), "Undantag från §1 på vardagar … då parkeringsförbud gäller" (Nynäshamn), hours before a paragraph with no full stop (Nynäshamn Järnvägsgatan), "sön- eller
  helgdag" read as Mon–Sat (Norrtälje ×2, parser only). (6) limits: days in the sentence after the hours ("… högst 2 tim i följd vardag klockan 08.00 - 18.00. Tidsbegränsningen gäller
  vardag utom dag före …": Tingsryd ×2), the limit's season kept when its hours follow (Askersund ×6, Vaxholm Hamngatan); exemptions and notes that kept a text half-read are ignored
  ("Förbudet gäller inte varutransporter": Vellinge Hamnvägen's summer ban held all year; "Parkeringen avser besökande": Salem; "Under samma tid ska föreskrifter … inte tillämpas":
  Katrineholm kept the register's daily twin of a first-Wednesday ban).
  Read and left: Uddevalla Brattgatan and Ludvika ("endast personbil med tillkopplad släpkärra": stay trailer bays), Karlshamn Stationsvägen ("Med fordon avses endast taxi": stays a
  taxi bay), Halmstad Norra Badvägen ("Parkering är dock tillåten under högst 1 tim … 1 juni - 31 augusti": only limits the summer, no winter ban), Orust Hamnvägen 2019-6 ("parkeras 1
  tim i följd" without "högst": not read as allowed-only hours), "får fordon parkeras <hours>. Tillåtelsen gäller högst N" (Tanum Nestorsvägen, Ulricehamn Tingshusgatan, Oskarshamn:
  the limit stays around the clock, the safe side), Vänersborg Bojortskajen ("Denna föreskrift gäller under tiden 1 oktober - 30 april": what holds in summer is not in the text),
  Gävle Slottstorget ×2 and Vimmerby Norrtullsgatan (hours before "får fordon" / without "klockan": still open at night, next batch), Ystad "den 15 varje månad" after the hours,
  heavy-vehicle 24 h limits shown for cars (Åstorp ×4, stricter only), "får lastbil / motorcykel parkeras" without "endast" (stays a bay: the rule of batch 2).
  Independent check: all 73 distinct changed lines (131 lines; every line that lost or narrowed a ban, limit, fee or reservation is among them) by a reviewer who saw only the texts
  and the old and new lines: 73 confirmed, 0 not. Its remarks, kept: Vaxholm Hamngatan's 2 h limit now holds 1 Sep–31 Mar only, as "Tillåtelsen gäller årligen 1 september - 31 mars"
  says (summer is probably another regulation's); the off-season bans in (4) assume the area ban holds all day; Båstad Italienska vägen's derived summer fee table lost its day cap
  (60 kr/dygn, display: fix in the fee-table step next batch).
  Still open (about 420 strict and 110 loose rows with unchanged lines; many are not parser errors): fee seasons and prices in the fee tables (Vaxholm ×12, Borgholm ×8, Skövde ×8),
  fee or free disc time and free first hours (display, app side), area-ban overlays `ov: 1` on streets with their own rule (about 17, needs the area texts), multi-part texts merged
  (Norrtälje ×12, Säter ×4, Härnösand's all-day twin of a limit), residents-only places (Kalmar ×3, Uddevalla, Vaxholm, Orust), school days and terms, week numbers, one-off dates kept
  as yearly seasons (Piteå, Strängnäs ×2, Huddinge), "N:e helgfria" (app side, before 6 Jan), disabled bays with "Parkering är dock tillåten" (about 25, left on purpose).
- 2026-11-25 batch 7 · the grey rows with a clear text (1,240 rows outside Stockholm, the next group in the order after the loose rows): 465 were shown as fact already, 487 are tiny lines with hours,
  limits or fees (grey by design), 287 regulations / 872 lines were grey for another reason. Every grey line in the country was sorted by why it stays grey (1,691 lines with a text: tiny 744, an unread
  sentence 257, a permission with conditions 246, residents' places 239, several places in one text 139, a slip in the text 45, beside roadworks 12, a season only 7), and the two largest groups the
  text settles were read by hand · confirmed and fixed, each with a test (282 lines of 154 regulations in 35 municipalities changed; the parser reads 55 of 61,211 texts differently, none of Stockholm's):
  (1) plain permissions kept grey by words that only look like conditions (105 regulations, 175 lines now "parking allowed", with the fee where the text has one): the recogniser `plainPermit`
  (moved to rdt-lib.mjs) took "Kl" in "Klågerup", "Klövergatan", "Kläppegatan" for "kl" (Svedala ×22, Uppsala, Mölndal: \b is ASCII-only), "endast mot avgift" for a reservation (Trelleborg ×35),
  "endast på (särskilt) markerade platser" / "Parkering är endast tillåten inom markerade platser" for a condition (Lund ×12, Skurup, Sala, Sölvesborg, Eslöv), the boilerplate about other bans when it is
  glued to the permission (Söderköping, Jönköping, Norrköping), "3 kap." for a sentence end (Åstorp, Kumla, Mjölby, Säffle, Karlstad), other regulations' and properties' numbers for clock times
  (Eskilstuna ×3, Mariestad, Sala), a colophon line mixed into the rules (Nyköping ×18, Östersund), "Tillåtelsen gäller även parkering närmare korsningen …" (Uppsala). Hours, a length without "högst",
  a group, a permit or a ban on the permission keep the line grey, as before (tested). (2) places the text gives to residents or permit holders ONLY are reserved (36 regulations, 65 lines, 59 of them
  were grey): "får endast fordon som används av boende i området och för vilka särskilt tillstånd utfärdats parkeras", "får endast sådana fordon parkeras för vars ägare särskilt
  boendeparkeringstillstånd utfärdats", "Tillåtelsen gäller endast fordon som används av boende …", "… endast boende med särskilt parkeringstillstånd", "Tillåtelsen gäller endast fordon med särskilt
  tillstånd" (Lysekil, Orust, Sotenäs, Vaxholm, Danderyd, Mölndal, Uddevalla, Ronneby, Upplands Väsby, Arboga, Valdemarsvik). This replaces batch 3's "residents' permits stay with the register": the
  register holds no resident zones outside the three big cities, so those lines could only be grey; the old test is changed and says so. Orust Kvarnvägen is reserved 15 May–15 Sep and open the rest of
  the year as its 2 § says. (3) bicycle racks ("i särskilt anordnade cykelställ … får cykel parkeras", "får cykel och moped klass II parkeras under högst 24 tim"): a bay for bicycles, no place for a car
  (8 regulations, 35 lines: Uppsala's central racks ×19, Oxelösund, Laholm, Tanum, Linköping Resecentrum). Not when another sentence of the text lets cars park (Härnösand Trädgårdsgatan).
  Read and left grey on purpose: Västerås' 60 resident regulations (about 140 lines) "får fordon som används av boende i området med särskilt tillstånd parkeras mot avgift … 09–18" WITHOUT "endast":
  the same bays have a second regulation for every car (Källgatan 2021-00324 beside 2024-00041, Knutsgatan 2024-00036 beside 2024-00037), so "reserved" would be wrong and the text says nothing about
  other cars; the resident line is a twin of the general one and belongs to project 5 (two regulations on one stretch). Also left: permissions with hours only ("får fordon parkeras mellan klockan
  05.00 - 23.00": Bollnäs, Helsingborg Halalid, Oxelösund, Salem; what holds outside is not in the text), "parkeras 24 tim i följd" without "högst" (Alvesta, Timrå, Säter), "Tillstånd erfordras
  vardagar 8–16" (Arvika, Stenungsund), Norrköping's limits whose length stands only in the title (×8).
  Independent check by a reviewer who saw only texts and old and new lines: 93 distinct changes (all 50 that are not plain permissions, 43 of the 109 plain ones drawn at random, at most 4 per town):
  92 confirmed, 1 not: Orust 1421 2026-48 was open from 16 September where the text says 17 (the day after the reserved season instead of the season the text names); fixed in the parser
  (`openSeason`), rebuilt, and confirmed on a second check. No line lost a ban, a limit, a fee or a reservation. Its remark, kept: Nyköping's new fee streets give the first hour free once a day
  with digital registration; the line shows the fee only (display, app side).
  Still open: 185 grey regulations with a clear text that are not tiny (unread one-off sentences, texts with several places, slips), about 420 strict and 110 loose rows with unchanged lines as
  listed under batch 6.
- 2026-11-26 batch 8 · the rows outside Stockholm whose lines had not changed since the sweep (1,057 regulations: 148 loose, 214 grey with a clear text and not tiny, 391 strict, 304 unsure), 480 of them
  read again against today's lines by eight readers: all 148 loose, all 214 grey, 118 strict drawn at random (seed 81126). The first round was unusable for five of the eight sheets (readers wrote
  sentences that are not in the item's text; found by checking every quoted sentence against the text), so those 300 were read again on shorter sheets with a machine-checked quote per item. Readers'
  verdicts on today's data, as leads: 76 correct, 109 looser, 90 stricter, 147 grey with a clear text, 52 grey-ok, 6 unsure. Every lead used below was read again by hand with rdt-show ·
  confirmed and fixed, each with a test (98 lines of 49 regulations in 24 municipalities changed rules; the stopping flag changed on 243 lines in 41; the parser reads 35 of 61,211 texts differently,
  none of Stockholm's 9,606):
  (1) an exemption for dropping off or fetching people leaves the ban standing ("Förbudet gäller inte vid lämnande och hämtning av barn …, då parkering tillåts i högst 10 minuter", "Förbudet i 1 §
  tillåter av och påstigning i max 15 minuter", "Förbudet gäller inte fordon parkerade för upphämtning av passagerare … max 30 min"): Lekeberg Dammgatan, Tanum Solhöjdsvägen, Rättvik Thunbergs gata
  showed 10–30 minutes of free parking where the text bans (7 lines, bans added). (2) motorcycle bays worded "får tvåhjulig motorcykel och moped kl. 1 utan sidvagn, med avvikelse från … om förbud
  att parkera inom område …, parkeras": Sundsvall Kyrkogatan ×2 held the register's ban in the bay's season and was free for cars the rest of the year, inside an area ban (now a motorcycle bay all
  year); Eskilstuna ×2 (were bans), Sigtuna Hamngatan ×2 (were grey). (3) bays for travellers ("får fordon med resande med tåg eller buss, parkeras", "Endast resenärer … får parkera": Alvesta
  Moheda, Gällivare station), for a named owner or errand ("får endast fordon tillhörande polismyndigheten / som tillhör a named company / som används av distriktsköterskor / som har ärende till
  förskolan / med Farligt gods / i linjetrafik parkeras": Osby ×2, Hultsfred, Karlskrona, Kil ×2, Mönsterås, Partille, Lidingö, Valdemarsvik) and for police cars, ambulances and special transport
  without "endast" (Söderköping, Tanum, Burlöv ×2): reserved; 22 of these lines were grey. (4) new pipeline rule `reservedBesideUnread`: a bay the parser read as reserved at all hours is added
  although another sentence is unread (a fee detail, the bay worded twice), as read bans already are; never when the unread sentence may open the place ("Övrig tid …", "För övrig parkering …", "får
  fordon parkeras", residents) or the text also lets every car park: Ängelholm's motorhome bays on Klittervägen and Valhallsvägen, Kungsbacka's charging bays in Parkeringshus Linden ×2, Gotland
  Polhemslunden (lorries and buses) gave every car the bay's limit (7 lines). (5) bans laid on a line by roadworks or an area regulation (`ov`) no longer make a one-place text "several rule sets"
  (`ownBans`): Västervik Skeppsbron's 10-day limit holds at all hours, not only in the fee hours (10 lines). (6) every part of a multi-part text is a plain permission ("… 18 platser, får fordon
  parkeras. 2 § … 13 platser, får fordon parkeras"): the grey line is answered "parking allowed" (Svedala's car parks: 14 regulations, 35 lines). (7) "Parkeringstiden övervakas med s.k P-skiva" is
  no rule (Haparanda Storgatan ×3: grey, now 2 h). (8) the stopping flag `sb` is judged on the operative text (`stoppingBan`): the title ("… om förbud att stanna eller parkera på X"), the repealed
  regulation's title and the boilerplate in odd wordings had made plain parking bans stopping bans (149 lines cleared: Gävle, Eskilstuna, Skellefteå, Nynäshamn, Helsingborg …), and "får inte fordon
  stannas" (Mjölby ×23), "Stannande eller parkering är dock förbjuden …" (Falun, Nacka, Trelleborg, Växjö) and "får fordon inte Stannande eller parkering" (Karlskrona) were not seen as stopping
  bans (94 lines set). Not "får fordon parkeras där stannande och parkering är förbjuden enligt 3 kap. 52 §" (a permission: Örebro, Eskilstuna). (9) parser only: a car park where only caravans
  have a limit ("får husvagnar parkeras måndagar - fredagar högst 24 timmar i följd. För övrig parkering gäller ingen tidsbegränsning": Kiruna's lay-bys ×4) is no caravan bay; the lines keep the
  register's 24 h Mon–Fri for every car (stricter than the text; lifting a limit is left for a pipeline rule).
  Also changed by the rebuild, from the text: Kungsbacka Gymnasiegatan's 15 min limit gained its 09–14 window (3 lines).
  Independent check by a reviewer who saw only the texts and the old and new lines: one line of each of the 49 changed regulations (every line whose ban became a reservation: Eskilstuna ×2,
  Sundsvall ×2, Kil; every un-greyed regulation) and 24 stopping-flag changes drawn at random (14 cleared, 10 set, at most 2 per town): 73 confirmed, 0 not; every quote it gave is in the text.
  Its remarks, kept: Växjö Skiftesvägen 0780 2026-219 forbids stopping 07.30–08.30 and only parking 08.30–18.00, the flag is per line (stricter); Rättvik Thunbergs gata is a stopping ban where
  picking up passengers is allowed for 30 minutes; Ängelholm Klittervägen's day fee (150 kr, three hours free with a disc) is not in the data.
  Reader leads read by hand and left open (next batches): "Avgiftsplikten gäller vardag(ar) samt/och sön- och helgdag(ar)" with no hours, where the fee table charges Mon–Sat 08–18 only and Sundays
  are free (Mölndal, 8 regulations and 14 lines: Frälsegårdsgatan, Fredåsgatan, Kryssgatan …; the hours are not in the text, so this belongs to project 4, fee tables); Sotenäs' summer fee "1 juni -
  31 augusti mellan klockan 8 och 20 gäller tillåtelsen i 1 § mot avgift eller högst 1 timme …" beside a 24 h limit for 1 Sep–31 May (4 regulations, 11 lines: the limit sits in the wrong season, the
  fee has no season); a day-long limit tied to the fee hours after "Övrig tid" or "Parkering är dock tillåten" (Karlskrona Alamedan, Kalmar Skeppsbrogatan) and residents' "högst 7 dygn … endast
  mot avgift vardag och vardag före …" held on Saturdays only (Kalmar ×3); a list of all three day types read as Saturday (Ljusdal Lantmätargatan, Kristinehamn Byggmästaregatan: no rule text
  found); Gävle Slottstorget ×2 and Vimmerby ("mellan klockan 05-23 … får fordon", "alla dagar mellan 16 - 09": open at night inside an area ban); Tanum Prästgårdsvägen (goods vehicles, buses in
  service and lorries), Mariestad Torsö (vehicles with a trailer), Ronneby Karlskronagatan (motorcycles "med avvikelse från …" before the verb), Karlstad Bjurbäcksgatan (motorhomes May–Aug), Hylte
  ("2 pl för taxi"); Jönköping's "1 helgfria onsdagen": the parser carries `nh` since 25 Nov but no line holds it (0 of 141 n-th weekday windows in jonkoping.json), because the comparison that
  copies conditions to the line does not look at `nh`; the app must read it first (app side, before 6 Jan).
  Still open: about 330 strict, 100 loose and 300 unsure rows with unchanged lines, about 160 grey regulations with a clear text that are not tiny (Västerås' residents' bays ×12 left on purpose,
  expired dated bans in Kalix ×3, Karlskrona ×2, Helsingborg, Simrishamn, Västervik that are grey and should be dropped, limits without "högst").
- 2026-11-26 batch 9 · the 92 loose rows outside Stockholm whose lines had not changed since the sweep, read again by hand against their texts (text, parse and today's line side by
  side), grouped by meaning; five groups worked · confirmed and fixed, each with a test (49 lines of 33 regulations in 21 municipalities changed; the parser reads 39 of 61,211 texts
  differently, none of Stockholm's 9,606; 27 of the 92 rows now differ from the swept line, 65 are left):
  (1) permissions inside an area ban that hold only at stated hours or every other week: hours written before the place ("…, mellan klockan 05-23 på Slottstorgets parkeringsplats
  får fordon, med avvikelse från … om område med förbud att stanna och parkera fordon, parkeras": Gävle Slottstorget ×2, 6 lines were open at night; "område med förbud att stanna
  och parkera" now counts as an area ban), "Tillåtelsen gäller udda veckor" / "jämna veckor" (Falun Hyttgatan's two sides: banned in the weeks between), "Villkoret gäller ej
  15 december - 30 april Tisdagar 09:00-15:00" without "mellan datumen" (Falun Rostvändaregatan: the winter cleaning ban was missing), "2 § Övrig tid får fordon inte stannas"
  standing before the hours it refers to (Gislaved Smålandsstenar held the permission's hours as a ban and was free at night: now allowed-only hours), "Tillåtelsen gäller endast
  fordon med giltigt parkeringsbiljett som hämtas från fastighet …" is a permit (Laholm Stationsgatan was a ban 09–18 and free at night: now reserved), "Tillåtelsen att parkera
  gäller husbil under tiden 17 maj- 30 september" (Sundsvall Heffners Allé, Industrigatan ×2, Stuvarvägen: a summer ban and free in winter, or open to all; now motorhome bays).
  (2) a place the text gives to another vehicle in a season or at stated hours is a ban for cars then, the rest of the text as it stands: "Under tiden 15 juni- 15 aug gäller
  tillåtelsen endast buss" (Lysekil Verkstadsgatan), "Mellan den 1 maj - 31 augusti får endast personbil klass II parkeras" (Karlstad Bjurbäcksgatan), "Tillåtelsen gäller för
  buss mot avgift … Det gäller för vardag före sön- och helgdag kl 14:00-24:00 samt sön- och helgdag" (Mölndal Göteborgsvägen), "får endast släpvagn parkeras … under tiden maj –
  oktober. Övrig tid får endast personbil klass I parkeras under högst 24 tim" (Eslöv Göingevägen). (3) vehicle bays whose wording hid the vehicle: "får enbart personbil klass II
  parkera under högst 24 timmar i föjd" with the place named twice (Ängelholm Helsingborgsvägen, Hässleholm Österåsgatan 2023-00115: motorhome bays shown as 24 h for all; with
  "peronbil klass I" Hässleholm 2026-00013 gets its 24 h limit), "motordrivet fordon med tillkopplad släpvagn annat än påhängsvagn eller enaxlig släpvagn" (Mariestad Torsö),
  "får godstransporter, fordon i linjetrafik och lastbil parkeras" (Tanum Prästgårdsvägen), "får motorcykel med avvikelse från … parkeras … Övrig tid får motorcykel parkeras under
  högst 24 tim" (Ronneby Karlskronagatan). (4) limits: "Övrig tid får fordon parkeras 24 tim.." without "högst" (Tanum Halsviksvägen), "… under högst 4 tim i följd under tiden
  måndag-söndag" (Orust Hamntorget ×4), "Övrig tid får fordon parkeras under högst 7 dygn i följd och mot avgift under tiden …" after a cleaning ban (Karlskrona Alamedan: the hours
  are the fee's), "Fordon får parkera högst under 2 tim" (Nacka Järla östra skolväg), "Följande inskränkningar gäller: Parkering högst 2 timmar i följd …" (Växjö Värnamovägen: 24 h
  always and 2 h by day), "En tidsbegränsning om att parkera fordon under högst 2 timmar gäller vardagar, vardag före sön- och helgdag, samt sön- och helgdag" (Ljusdal
  Lantmätargatan: every day, was Saturdays), a third hour range after "samt" without day words is Sundays (Sundsvall Tullgatan), "Parkeringen gäller 5 platser" is no rule
  (Söderhamn Åsgatan: the 24 h limit now covers Sunday 10–15). (5) slips: "den första helgfria måndagen varje månad 08-00-12.00" (Eslöv Palmgatan: cleaning ban added, `nh` set),
  "Förbudet gäller inte Mölndals stads renhållningsfordon" is an exemption (Knarrhögsgatan: Thursday's ban was missing), "07-00- 09.00", "1:a nov", "15 aug" (parser only:
  Sollentuna, Olofström, Örebro).
  Independent check by a reviewer who saw only the texts and the old and new lines: all 34 distinct changes: 33 confirmed, 1 not: Lerum Almekärrsvägen 1441 2011-00283 ("Övrig tid
  får fordon parkeras 24 tim i följd vardagar utom vardag före sön- och helgdag" inside an area ban: the first reading gave weekends a 24 h permission the text does not give).
  That reading was taken out of the parser (test says so), the data rebuilt from the last commit: the line is as it was. Its remark, kept: Ängelholm's 150 kr day fee is not in the data.
  Read and left (next batches): Vimmerby Norrtullsgatan ("högst 1 timme i följd alla dagar mellan 16 - 09": limit hours or permission hours, the text does not say), Åstorp
  Esplanaden 2019-16 (no place sentence), Valdemarsvik Borgsområdet ("Särskilt tillstånd erfordras under perioden 15 juni-15 augusti": the line holds the 24 h limit in that season
  only), Sotenäs ×4 (seasons of 2 § and 3 §), Kalmar Proviantgatan and the residents' places ×3 ("högst 24 tim i följd endast mot avgift … Övrig tid får fordon parkeras": kept as
  the test of 22 Nov reads it), Kalmar Skeppsbrogatan 2022-45 (1 § has lost "får fordon"), Nybro and Ulricehamn (the same day type twice), Lidköping Kylandersgatan, Strömstad
  Ångbåtskajen, Växjö Norra Esplanaden 2010-00001 ("alla dagar utom måndagar och torsdagar 06.00-08.00"), Norrtälje and Täby multi-part texts, Mölndal's fee days ×9 and
  Finspång's Saturday fee (fee tables: project 4), Haninge ×2 and Uddevalla ×2 (fee tables), Jönköping "helgfria" ×3 (app side, before 6 Jan), Umeå date parking (engine), Tanum
  Sjövägen ("gäller i och urlastning"), Hylte ("2 pl för taxi", only in a parenthesis).
  Still open: 65 loose, 357 strict and 300 unsure rows with unchanged lines; about 160 grey regulations with a clear text that are not tiny.
- 2026-11-27 batch 10 · the 346 strict and 161 grey-with-a-clear-text rows outside Stockholm whose lines had not changed since the sweep (lines compared with the commit that added
  each findings file), grouped by meaning; six groups read by hand against their texts (text, parse and today's line side by side, about 110 rows) · confirmed and fixed, each with a
  test (150 lines of 89 regulations in 39 municipalities changed; the parser reads 73 of 61,211 texts differently, none of Stockholm's 9,606; 68 strict rows now differ from the swept line):
  (1) the fee's season and days (53 lines, `t`): "För parkering på X ska avgift erläggas årligen under perioden 1 juni - 31 augusti" (Vaxholm ×9: the fee hours now hold in summer only;
  Lägergatan's 5-day limit holds all year as the text says), "Avgiften … är 15 kronor per timme under tiden 1 juni - 31 augusti" (Borgholm ×8), "Avgiftsplikten gäller under 1 maj – 30
  september" (Landskrona Skeppsbrokajen ×2, Vellinge Hamnvägen), "Parkering är dock tillåten endast mot avgift under tiden 1 april - 15 september" (Ystad Västerleden), "Parkering är dock
  tillåten under högst 4 tim i följd mot avgift under 15 juni – 15 augusti" beside the fee hours (Lysekil Carlavägen): derived fee tables with the season, free outside it;
  "Avgiftsplikten gäller under vardagar utom vardag före sön- och helgdag." with no hours anywhere (Knivsta ×6, Sigtuna Brobyvägen: "fee – see the sign" Mon–Fri, free at weekends),
  "Avgiften i är enligt Taxa 1, vardag utom …" (Värnamo ×4). "Avgiftsplikten gäller vardag före sön- och helgdag." alone (Mölndal Dalgångsgatan, Saturdays only) looks like a slip and is not read.
  (2) dated one-off bans that are over are dropped instead of staying grey or coming back every year (28 lines of 17 regulations): the reparse gives a line whose text is only a ban for
  dated days in the past its last day as `to`, and rdt-temp drops it ("Förbudet gäller 18 juli 2019 – 21 juli 2019": Kalix ×3, Helsingborg Folkskolegatan, Västervik, Simrishamn, Höör
  ×6; "gäller 20 juli - 28 juli 2026": Piteå Kyrkparkeringen ×4); new `oneOffEnd` in rdt-lib: named weekdays and dates without a year that are those very weekdays in the regulation's own
  year ("Förbudet gäller fredag 11 december - 11 december" in 0126 2020-105; Strängnäs ×7, Nacka Gillevägen ×3, Huddinge). Not when the text also gives a permission, a limit, a fee or a bay
  (Solna Jungfrudansen keeps its grey fee line).
  (3) limit hours and days (51 lines, `l`): new pipeline rule `limitsFromText`: when the text has one limit length, the line holds only that length and every window of the text lies inside a
  window of the line, the text's windows replace the line's: all-day twins beside the read windows (Vellinge Stortorget, Härnösand Storgatan ×4, Norrtälje Minervavägen, Rodengatan and
  Stegelbäcksgatan, Täby Vaktgränd, Kalmar Storgatan), windows without their day type (Sjöbo Gamla Torg ×4, Gällivare, Burlöv, Sotenäs ×2), days without hours (Timrå Källvägen ×5); parser:
  "Tidsbegränsning gäller … 09.00 - 19.00. under högst 60 min i följd och … under högst 60 min i följd" (Degerfors ×3), "alla dagar 08 och 18" (Lund), "15 juni - 15 augusti samt 08.00 - 18.00"
  (Tanum ×2), "Övrig tid parkering tillåten högst 10 min" outside the stated hours only (Partille), "klockaan" (Nybro), "Övrig tid är parkering ej tidsbegränsad" (Gällivare), and no-rule
  sentences that kept texts half-read ("Tillåtelsen gäller inom markerade platser", "… inte på laddplats").
  (4) a longest stay for other vehicles only is no rule for cars (12 lines, `hv`): "får motordrivet fordon med totalvikt över 3,5 ton samt traktor, motorredskap och släpfordon parkeras under
  högst 24 timmar" (Åstorp ×5), "får husvagnar parkeras måndagar - fredagar högst 24 timmar i följd. För övrig parkering gäller ingen tidsbegränsning" (Kiruna's lay-bys ×4, open since batch 8).
  (5) ban days and seasons (19 lines, `f`): days in their own paragraph after the hours ("… inte parkeras under tiden mellan klockan 23.00 – 04.00. 2 § Förbudet gäller under vardag utom
  …": Upplands-Bro was banned all day Mon–Fri), school days are Mon–Fri at most ("Förbudet gäller skoldagar 08-16", "under skoldagar", "får under skoldagen mellan klockan 08.00 – 16.00
  fordon inte parkeras": Tanum ×3, Forshaga ×2, Vilhelmina's school yards ×11 were banned at weekends or around the clock; school holidays have no form in the data), "mellan första november
  och 31 mars" (Grums), "Förbudet gäller inte fordon i taxitrafik" is an exemption (Norrköping Drottninggatan: the parser now reads 00–05; the line keeps its area ban).
  Independent check by two reviewers who saw only the texts and the old and new lines (every quote checked by machine against the text): all 93 distinct changes of the first build: 89
  confirmed, 4 not: Lysekil Fiskebäckskil 1484 2021-9, 2021-12, 2022-10 and Strömstad Kilegatan 1486 2025-9 ("får … parkeras under högst 7 dygn i följd mot avgift under tiden 15 juni - 31
  augusti": the permission itself is seasonal, a seasonal fee table would show the rest of the year as free). That reading was taken out of the parser (test says so) and the data rebuilt
  from the last commit: those lines are as they were. Its remark, kept: Borgholm Byxelkrok's day cap text says "1 juni- 3 augusti" (display).
  Read and left: Hässleholm ×11 and Oskarshamn ×2 (the same day type twice with different hours: a slip the register copies too, grey), Västerås' residents' places ×15 and Lysekil's
  "fordon som används av boende … parkeras" without "endast" ×5 (project 5), disabled bays with a limit for permit holders (grey by `ux`: Ånge, Arvika, Avesta, Svedala), Borlänge ×13,
  Nyköping ×5 and Helsingborg ×9 exceptions on the cleaning day (left on purpose, batch 5), "får fordon parkeras <hours>. Tillåtelsen gäller högst N" (Tanum Nestorsvägen, Ulricehamn,
  Oskarshamn Kungsgatan: the limit stays around the clock), Västervik "vecka 28" ×2 and Ystad "den 15 varje månad" ×2 (no ban form for one week / weekday plus day of month yet), Robertsfors
  and Värmdö Viks skolväg (garbled), Ljusdal "under skoltermin", Norrtälje's and Säter's texts for several places, area-ban overlays `ov: 1` (about 17: needs the area texts), Uppsala's
  "fee – see the sign" lines with the fee hours in the table (×17: check whether `fu` hides the table in the app), Nacka's fee only in the exception windows ×5, Haninge's overnight fee windows ×5.
  Still open: 64 loose, 278 strict and 292 unsure rows with unchanged lines; about 155 grey regulations with a clear text that are not tiny.
- 2026-11-27 batch 11 · the 278 strict rows outside Stockholm whose lines had not changed since the sweep, grouped by meaning; the largest group not yet worked (area-wide bans laid on
  streets with their own rule, 22 rows) and about 45 single wordings read by hand against their texts (text, parse and today's line side by side) · confirmed and fixed, each with a
  test (55 lines of 47 regulations in 25 municipalities changed; the parser reads 113 of 61,211 texts differently, most of them only in the wording of an unread sentence, none of
  Stockholm's 9,606; 29 strict rows now differ from the swept line):
  (1) area-wide bans on streets that permit parking (24 lines of 24 regulations, `ov: 1` dropped): new rule `permitsWithTimedBans` in rdt-lib, used by rdt-overlay: a street regulation
  that itself permits parking and bans it only at stated times ("På markerad sträcka på Eriksvägens sydvästra sida får fordon parkeras. Parkering är dock förbjuden under tiden fredag
  klockan 08.00 - 12.00 under tiden 1 november - 15 maj", with or without "med avvikelse från … om förbud att parkera område") gets no copy of the area ban, exactly as curbs with a limit
  or a fee already did: Sundbyberg ×10 (Eriksvägen, Björkhagsvägen, Villavägen, Oskarsvägen …), Falkenberg ×3 regulations / 6 lines, Nacka ×3, Sigtuna ×2, Falun Magasinsgatan, Örebro
  Överstegatan, Täby Helgavägen answered NO at all hours. Fully read texts only, never a text with an all-day ban of its own. The timed STOPPING bans under an area ban (Linköping
  Storgatan ×7, Nacka Kadettvägen, Norrköping Kungsgatan) are reader mistakes: both rules hold, the lines are right.
  (2) permissions the register held as bans (9 lines): "Med avvikelse från (…) om stannande och parkering inom parkeringsförbudzon får fordon parkera på Pumpbacksgatan …" (Härnösand),
  "På … Pärlgränd …, med avvikelse från (…), parkeras." with "får fordon" lost (Laholm; the same shape reads Kalmar Skeppsbrogatan 2022-45 and Storgatan 2022-88, open since batch 9:
  24 h limit at all hours, Saturday 3 h without a fee), sentences that are no rule and kept texts unread ("Vid parkering skall personbilar uppställas …": Eskilstuna Bynäsvägen;
  "Parkerat fordon får delvis stå utanför körbanan": Huddinge Yrkesvägen and Månvägen had the fee hours as a ban; "Tillåtelsen att parkera gäller.": Falun Köpmansgränd, the same;
  "Parkeringstiden bevakas med en s.k P-skiva": Haparanda Torggatan ×2 were a ban and grey, now 2 h), and Kungsbacka Klockaregatan (fee Mon–Sat 08–22 instead of around the clock).
  (3) bans for vehicles over 3.5 tonnes only ("får fordon över 3,5 ton inte parkeras": Burlöv Bernstorpsvägen, Österåker Skrakvägen ×2 lines: `hv`).
  (4) ban hours, days and seasons hidden by slips or headings (7 lines): "måndagtorsdag klockan 17-21 … 23 april - 11 oktober" (Lidingö Marsvägen was banned every evening all year),
  "får på onsdagar klockan 7-14 fordon inte stannas eller parkeras för annat ändamål än lastning" (Lidingö Fregattvägen), "får inte fordon stanna mellan 20:00 -- 02:00" (Dorotea),
  a ban written as a heading with its season ("Förbud mot att stanna och parkera fordon på följande vägsträckor …: … Förbudet gäller 1 juni - 31 augusti": Ekerö Stockbybadet;
  "Parkeringsförbud på Dalgatans östra sida … Att förbudet skall gälla fr om 15 oktober t om 15 april": Övertorneå; Osby's four "Förbud att parkera fordon på …" are now verified),
  the season of the whole regulation ("Denna föreskrift gäller under perioden 1 maj - 31 augusti": Sigtuna Sjudargårdsvägen; "Föreskriften gäller under tiden 1 november - 31 mars":
  Mölndal Tulebovägen, grey; "Föreskriften gäller årligen tiderna 1 maj - 30 september": Piteå Storgatan's motorcycle bay is open to all in winter). A plain permission with a limit and
  such a season (Vänersborg Fisktorget) is left unread on purpose: the text says nothing about the rest of the year.
  (5) limit hours: "Tidbegräsningen gäller under tiden 07-18 under högst 30 min i följd.Övrig tid 3 timmar" (Järfälla Fornvägen: 30 min by day, 3 h otherwise).
  Stricter from the same rebuild: Karlskrona Norra Smedjegatan (1 h at all hours, Friday 08–10 ban, Saturday fee 10–14), Norrtälje's fee tables on three car parks (Saturday 09–13).
  Independent check by a reviewer who saw only the texts and the old and new lines (every quote checked by machine against the text): all 53 distinct changes of the first build: 51
  confirmed, 2 not: Håbo Simhallsparkeringen 0305 2025-00009 (places in three colours with a rule each: the line stays grey) and Hedemora Hökargatan 2083 2026-2 ("… under högst 12 tim
  i följd. 2 § Tillåtelsen att parkera i paragraf gäller dock högst 12 tim i följd. Villkoret gäller … 07.00 - 22.00": the all-day limit stays). Both readings were taken out of the
  parser (tests say so) and the data rebuilt from the last commit: those lines are as they were. Its remarks, kept: fee prices are not in the texts (only the periods were judged).
  Read and left: disabled bays with "Parkering är dock tillåten under högst N tim" (about 45 rows: reserved, the rule of this project) and with hours in "Tillåtelsen gäller" (Arvika,
  Bengtsfors, Helsingborg ×2, Varberg ×2, Vänersborg, Rättvik ×2: the text is silent on other hours), fee or free disc time and free first hours (Kungsbacka ×15, Ängelholm ×5,
  Skellefteå ×3, Söderhamn ×3: app side), Uppsala's "fee – see the sign" lines ×17 (reader mistakes: the table holds Mon–Sat 08–24 and the engine answers free outside it), limits or
  reservations the register holds and the text does not give (Växjö Arenastaden and Västra Esplanaden, Vellinge Falsterbovägen, Ystad Hamngatan, Täby Attundagränd, Åstorp, Kristinehamn
  Nya Kyrkogatan's repeal: lifting them needs the replaced regulations read first), Säter Vasagatan (two sides with limits, line a ban), Eskilstuna Östergatan 2016-182 (a comma lost
  before "parkeras"), Vimmerby Nybbleparkeringen ("Tidsbegräsningen gäller vardag före sön- och helgdag" alone: looks like a slip), Värmdö Viks skolväg and Heby Kyrkvägen (garbled),
  overlaid roadworks bans whose `to` the engine ignores (harmless while rdt-temp runs daily), end dates with a clock time (by design the day after).
  Still open: 62 loose, 249 strict and 284 unsure rows with unchanged lines; about 155 grey regulations with a clear text that are not tiny.

### 1. [ ] The app allows more than the sign: flagged lines
The audit's "looser" leads, smallest and most harmful first. One batch per check, in this order:
`--check limitMissing` (text has "högst N tim", the line has no limit; 189 regulations on 20 Nov),
`--check weekdayBanMissing` (text names a weekday, the line has no ban that day),
`--check feeMissing`, `--check feeHoursUnread`, `--check banButPermission`.
A check's count is a lead, not an error count: many rows are right once the text is read (the weekday is an exception,
the limit belongs to another paragraph). Fix the sentence shapes behind the real ones.
Exit: every check above has an empty pool (run `node cities/rdt-audit.mjs` first so `audit.json` is current).

Log:

### 2. [ ] Read every regulation in the towns where people use the app
Outside Stockholm, Göteborg and Malmö the live users are few and concentrated, so these towns can be read completely.
Batches of 240 with `--only`, one group at a time, in this order:
1. `uppsala,solna,sollentuna,upplands-vasby` (1,875 unread regulations on 20 Nov; read in full by sweep wave 1, 20 Nov)
2. `nacka,sundbyberg,jarfalla,huddinge,taby,danderyd,lidingo`
3. `haninge,tyreso,botkyrka,sodertalje,varmdo`
4. `vasteras,orebro,linkoping,norrkoping,helsingborg,jonkoping,lund,umea,gavle,eskilstuna,karlstad,vaxjo,halmstad,sundsvall`
The daily measuring run re-ranks this order once a week from where street taps come from; follow the order written
here when the run starts. A group is finished when its pool is empty; say so in the log with the group's result
(correct / stricter / looser / grey over all its batches).
Exit: groups 1–3 finished. Group 4 is worked only when nothing else in the queue is open.

Log:

### 3. [ ] Sentences the parser does not read
Regulations whose text has a sentence shape the parser skips (their register data is shown unverified):
`--unread` (1,833 unread regulations on 20 Nov). Before drawing, run `node cities/rdt-unread-scan.mjs` and note the
most common shapes: teach the parser the common ones first, then draw. A shape the parser cannot settle goes grey,
never a guess.
Exit: the pool is empty, or two batches in a row teach the parser nothing new (then the rest is one-off wording).

Log:

### 4. [ ] Fee around the clock
`--check feeAllDay` (2,006 lines in 43 municipalities, 750 unread regulations on 20 Nov). Most texts give fee hours,
or point to a fee table ("taxa") whose hours are in another regulation of the same municipality. Find the general
rule per municipality (where its fee hours are written) rather than line by line. When the hours cannot be found in
any text, the line keeps "fee – see the sign" (`fu`), never a guessed table.
Exit: the pool is empty.

Log:

### 5. [ ] Two regulations on one stretch
The audit's `conflict` (a ban line and a permission line from different regulations on the same stretch, 3,039 lines)
and `dup` (the same line drawn twice from different regulations, 2,288 lines). The map shows one line and a tap
answers with either regulation. This project is design first, then small safe steps:
- Batch 1: no fixes. Draw 120 pairs from `audit.json` (`checks.conflict.rows`, `checks.dup.rows`), read BOTH texts
  of each pair, and sort them: (a) the older regulation is replaced by the newer one for the same stretch and side,
  (b) the two sides of the street, (c) a street ban plus a permission for marked bays (the permission is right where
  the bays are: usually nothing to fix), (d) a temporary and a permanent regulation (rdt-temp's job), (e) other.
  Write the shares and five examples per class here, and a short plan for the largest safe class.
- Later batches: one class per batch, as a pipeline step with tests (like `rdt-strips.mjs` and `rdt-temp.mjs`).
  For (b): move each line a few metres to its own side only when the text names the side ("norra sidan", house
  numbers on one side) and the line's direction makes the side unambiguous; otherwise leave it. For (a): drop the
  older line only when the newer text repeals it by name or covers the same stretch, side and kind of rule.
  After applying, read 30 changed pairs against both texts; under 95 % confirmed, revert and write why.
- What only the app can solve (showing both answers for one tap) is written up for the owner, not built here.
Exit: classes (a) and (b) handled or shown unsafe, with the counts before and after.

Log:

## Done
