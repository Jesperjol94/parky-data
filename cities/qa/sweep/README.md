# Sweeps: many regulations read at once

A sweep reads a large number of regulations against what the app shows, with many readers side by side. It only
reads. It changes no rules and no data. What it finds goes to a findings file, and the project runs
(`../PROJECTS.md`) turn the findings into general fixes, one pattern at a time, under the usual publish rule.

Started 20 Nov 2026 (the owner asked for as many streets as possible to be read): the first wave read every unread
regulation in Uppsala, Solna, Sollentuna and Upplands Väsby and 1,500 in Stockholm.

## One sweep

1. Draw the samples, each in ONE call so that no regulation is drawn twice:
   - national register: `node cities/rdt-qa-sample.mjs <count> <work>/rdt.json <seed> [--only a,b] [--boost a,b]`
   - Stockholm (live data on branch main): `node cities/qa-city-sample.mjs <count> <work>/sthlm.json <seed> --segments … --texts …`
     (its header says how to get the two files).
2. Make the sheets, 100 regulations each:
   `node cities/qa/sweep/sheets.mjs <work>/rdt.json <work>/t 100 --engine <parky-beta>/engine/evaluate.js`
   The engine is the app's own (repository parky-beta, private): each sheet shows what the app really answers at six
   instants. Sheets hold the operative text only; headings and signatures are cut, so they hold no names.
3. One reader per sheet, all at the same time. Each reader gets `READING.md` (this folder), its sheet
   `<work>/<sheet>.txt`, the file to write, `<work>/out/<sheet>.jsonl`, and today's date. Readers work alone and
   write one verdict per regulation: ok, loose, strict, grey (text clear or not), unsure.
4. Collect: `node cities/qa/sweep/collect.mjs <work> <name> --samples <work>/rdt.json,<work>/sthlm.json --write`
   - prints the result per town (by regulations and weighted by lines);
   - writes `findings/<name>.jsonl`: one line per regulation that was not "ok" (citation, town, lines, verdict, what
     the text says against what the app shows, the pattern, a short quote);
   - appends everything judged to `../reviewed.txt` (Stockholm: `../reviewed-cities.txt`), so nothing is read twice.
   A sheet whose reader failed is simply not marked as read; its regulations come back in a later draw.
5. Add one line to the log below and push.

A reader's verdict is a lead, not a decision. Before a finding changes anything, the regulation is read again by
whoever makes the fix, and the fix is a general one with a test (never a patch for one street).

No personal data in this folder: no names, e-mail addresses or number plates. Quotes are from the regulation's
operative text only.

## Log
- 2026-11-20 wave 1 (`findings/wave1-2026-11-20.jsonl`): 3,352 regulations, 4,948 lines, 34 sheets. Every unread
  regulation in Uppsala, Solna, Sollentuna and Upplands Väsby (1,852: these four towns are now read in full) and
  1,500 in Stockholm. Correct by lines 96.1 %, looser 0.5 %, stricter 1.2 %, grey with a clear text 1.3 %, grey
  unclear 0.1 %, parking disc not shown 0.8 % (Stockholm). By town: Stockholm 97.0, Sollentuna 99.0, Upplands Väsby
  97.4, Uppsala 94.4, Solna 93.4 (mostly grey: lines read right but flagged uncertain). 149 findings.
  The first 9 town sheets showed "PAID" at every hour for lines with a town fee table (the sheet tool did not load the
  table; fixed in sheets.mjs); readers judged those fee hours from the table.
- 2026-11-21 wave 2 (`findings/wave2-2026-11-21.jsonl`): 3,000 regulations, 30 sheets: 1,996 in Nacka, Sundbyberg,
  Järfälla, Huddinge, Täby, Danderyd and Lidingö, 1,000 in Stockholm, 4 left over in group 1. Stockholm 96.6 % correct (2.2 % more only lack the parking disc)
  by lines. Towns: Järfälla 98.5, Huddinge 98.3, Lidingö 95.8, Danderyd 92.8, Sundbyberg 90.3, Nacka 70.8 and Täby
  58.2 (mostly grey: plain bans at turning areas, "vändplats", read right but flagged uncertain). Main patterns:
  turning-area bans greyed (Nacka, Täby); an all-day ban window `ov: 1` without `tb` (Sundbyberg) making the line NO at
  all hours; "Parkering är dock tillåten högst N tim … 08–21" not opening disabled bays; motorcycle bays reserved all
  year where winter is open with a fee (open window with a season but no hours); Järfälla "50 kr/dygn" shown as kr/h.
- 2026-11-21 wave 3 (`findings/wave3-2026-11-21.jsonl`): 2,000 regulations, 20 sheets: the rest of group 2 (982) and
  Haninge, Tyresö, Botkyrka, Södertälje, Värmdö (1,018). Correct by lines 89.4 %, looser 0.2 %, stricter 0.9 %, grey
  with a clear text 8.7 %. Nacka 54 %, Täby 63 % and Södertälje 83 % are almost all the same grey pattern: plain
  all-day bans at turning areas ("vändplats", "I markerad vändplats … får inte fordon parkeras") whose line holds the
  right ban but carries `ut` (very short lines). Groups 2 and 3 are now read in full. Biggest single fix in the
  findings so far: un-grey those lines (about 330 regulations over waves 2–3).
- 2026-11-21 wave 4 (`findings/wave4-2026-11-21.jsonl`): 1,000 in Stockholm. 94.8 % correct by lines, looser 0.7 %,
  stricter 0.9 %, parking disc not shown 3.4 %. Fixed the same day: seasonal motorcycle bays had an open window
  without hours and answered "reserved" all winter (engine/regulation.js, main PR #8 and expansion/rdt; 37 lines).
- 2026-11-21 wave 5 (`findings/wave5-2026-11-21.jsonl`): 1,000: the last 330 of group 3 and 670 of the big towns
  (group 4). 93.2 % correct by lines, looser 0.7 %, stricter 1.4 %, grey with a clear text 3.9 %.
- Running total 21 Nov: 10,352 regulations read in five waves (Stockholm 3,500).
- 2026-11-21 wave 6 (`findings/wave6-2026-11-21.jsonl`): 1,000 in Stockholm and 1,000 in the big towns (group 4).
  Stockholm's motorcycle-bay flags in this wave were read against data built before main PR #8.
- 2026-11-21 wave 7 (`findings/wave7-2026-11-21.jsonl`): 1,000 in Stockholm and 1,000 in the big towns (group 4).
- Running total: 14,352 regulations in seven waves (Stockholm 6,500).
- 2026-11-21 wave 8 (`findings/wave8-2026-11-21.jsonl`): 1,000 in Stockholm and 1,000 in the big towns (group 4).
- Running total: 16,352 regulations in eight waves (Stockholm 7,500).
- 2026-11-21 wave 9 (`findings/wave9-2026-11-21.jsonl`): 1,000 in Stockholm and 1,000 in the big towns (group 4).
  95.5 % correct by lines, looser 0.7 %, stricter 0.9 %, grey with a clear text 1.1 %, parking disc not shown 1.2 %.
  Stockholm 95.8 %, Örebro and Umeå 100, Västerås 75.7 (resident-permit streets grey). New: a ban sentence after a
  missing full stop not read (Stockholm); "Parkering är dock tillåten" day-type lists cut to the first.
- Running total: 18,352 regulations in nine waves (Stockholm 8,500).
- 2026-11-21 wave 10 (`findings/wave10-2026-11-21.jsonl`): 1,000 in Stockholm and 1,000 in the big towns (group 4).
  96.8 % correct by lines, looser 0.4 %, stricter 1.0 %, grey with a clear text 0.5 %. Stockholm 96.1 %.
- Running total: 20,352 regulations in ten waves (Stockholm 9,500).
- 2026-11-21 wave 11 (`findings/wave11-2026-11-21.jsonl`): the last 919 Stockholm regulations of the 20 Nov data and
  1,081 in the big towns (group 4). 97.5 % correct by lines, looser 0.2 %, stricter 0.4 %. Stockholm 97.1 %.
  Every Stockholm regulation in the live data has now been read once.
- Running total: 22,352 regulations in eleven waves (Stockholm 10,419).
- 2026-11-21 wave 12 (`findings/wave12-2026-11-21.jsonl`): 2,000 in the big towns (group 4). 97.7 % correct by lines,
  looser 0.1 %, stricter 1.0 % (Växjö 5.7 %: fee at all hours), grey with a clear text 0.8 % (Västerås residents).
- Running total: 24,352 regulations in twelve waves (Stockholm 10,419).
- 2026-11-21 wave 13 (`findings/wave13-2026-11-21.jsonl`): the last 306 of group 4 (the big towns are now read in
  full) and 1,688 from the rest of the country (66 towns with findings). 94.6 % correct by lines, looser 1.1 %,
  stricter 1.4 %, grey with a clear text 1.5 %. Outside the big towns the reading is less tuned: more hours and seasons
  dropped, one-off dates repeated yearly, free first hours not shown.
- Running total: 26,346 regulations in thirteen waves (Stockholm 10,419).
- 2026-11-21 wave 14 (`findings/wave14-2026-11-21.jsonl`): 2,000 from the rest of the country. 94.1 % correct by
  lines, looser 0.6 %, stricter 1.8 %, grey with a clear text 1.7 %.
- Running total: 28,346 regulations in fourteen waves (Stockholm 10,419).
