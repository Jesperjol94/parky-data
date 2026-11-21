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
- Växjö fee texts with fee hours given but `t` null + `fu`: PAID at all hours (Norra Esplanaden and others). Stricter.
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
- (wave 9) Vehicle words: "får taxi i tjänst parkeras" read as open to all (Växjö, looser); "gäller endast lätt
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
