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
  Järfälla, Huddinge, Täby, Danderyd and Lidingö, 1,000 in Stockholm, 4 left over in group 1. Stockholm 98.9 % correct
  by lines. Towns: Järfälla 98.5, Huddinge 98.3, Lidingö 95.8, Danderyd 92.8, Sundbyberg 90.3, Nacka 70.8 and Täby
  58.2 (mostly grey: plain bans at turning areas, "vändplats", read right but flagged uncertain). Main patterns:
  turning-area bans greyed (Nacka, Täby); an all-day ban window `ov: 1` without `tb` (Sundbyberg) making the line NO at
  all hours; "Parkering är dock tillåten högst N tim … 08–21" not opening disabled bays; motorcycle bays reserved all
  year where winter is open with a fee (open window with a season but no hours); Järfälla "50 kr/dygn" shown as kr/h.

