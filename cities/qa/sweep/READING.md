# Reading a sheet: does the Parky app show what the regulation says?

Parky is a parking app for Sweden. Each line on its map comes from one official local traffic regulation ("lokal
trafikföreskrift", in Swedish). Your job is to read one sheet of regulations and say, for each, whether the line the
app holds agrees with the text. You only read and judge. You change no data and no code.

## Your sheet

You were given a sheet name, for example `t-07`, and the full paths of its two files:

- `t-07.txt`: the regulations, numbered. About 100 of them, about 2,000 lines of text.
- `out/t-07.jsonl`: where you write, one JSON object per regulation, one per line.

Read the sheet in slices of about 20 regulations (the Read tool with `offset` and `limit`, about 400 lines at a
time). After each slice, append that slice's verdicts to the out file before reading on. Judge every regulation;
skip none. Do not start other agents. Do not use the network. Do not edit any other file, and do not read other
readers' files: every sheet is judged on its own.

## One regulation on the sheet

```
=== 12 · 0380 2022-4 · uppsala · street: Österleden · lines with this regulation: 4
TITLE: the regulation's title
TEXT:  the operative text (the heading, legal basis and signatures are cut away)
APP LINE: the line as the app holds it (fields below)
FEE TABLE: the fee table the line points to, when it has one
APP ANSWERS: what the app answers an ordinary car at six instants, computed with the app's own engine
OTHER LINES OF THE SAME REGULATION WITH DIFFERENT RULES: up to two
```

`APP ANSWERS` is the app's real behaviour, so judge mainly by it, and use `APP LINE` to see the hours and days in
between. FREE = park without limit or fee. PAID = fee applies then. NO = parking forbidden then. NO, RESERVED = only
for the named users. GREY/UNKNOWN = the app shows the line grey and says "see the sign". "at most N min" = time limit.

## Fields of APP LINE

Times are minutes from midnight: 480 = 08:00, 1020 = 17:00, 1440 = midnight. A window with a > b runs past midnight
and belongs to the day it starts on.

Day types (`dt`): `vardag` = Monday–Friday that are not the day before a holiday. `fore` = Saturday (and any day before
a holiday). `helgdag` = Sunday and holidays. No `dt` = every day. In the Swedish text: "vardag" alone = Monday–Saturday
(= `vardag` + `fore`). "vardag utom vardag före sön- och helgdag" = Monday–Friday (= `vardag`). "vardag före sön- och
helgdag" = Saturday (= `fore`). "sön- och helgdag" = `helgdag`.

Other window conditions: `w` weekday (1 = Monday … 7 = Sunday), `m` season [[month, day], [month, day]], `p` even/odd
week, `wk` week numbers, `dd` even/odd dates, `dm` day of the month, `nw` n-th weekday of the month, `to` until a date.

- `t`: fee. 0 = free of charge. A number = a fee table. Missing = fee not known.
- `fu`: 1 = "fee, see the sign": a fee applies but the app does not know the hours or the price. `pv`: the price is a range.
- `f`: windows when parking is forbidden (from the text). `ov: 2` inside one = a temporary ban laid over from another
  regulation, named in `tb` (roadworks and the like): not this text's doing, ignore it when judging.
- `s`: street-cleaning hours ("servicetid", Stockholm): parking forbidden then. Usually the same window is also in `f`.
- `sb`: 1 = the ban is a stopping ban ("får inte stannas"), stricter than a parking ban.
- `aw`: parking is allowed only in these windows, forbidden at other times.
- `l`: time limits. `max` = minutes, inside the window. Outside the window there is no limit.
- `v`: reserved for these users or vehicles (rörelsehindrade, buss, taxi, lastbil, motorcykel, laddning …). An ordinary
  car may not park, except in the windows of `o` if present.
- `k` / `ko`: loading-zone style purpose hours; reserved then.
- `dp`: date parking (datumparkering): the odd/even date rule applies in these windows.
- `ps`: parking disc needed. `r`: 1 = residents' permits are valid here. `z`: the residents' zone.
- `u`: 1 = the app shows the line grey ("uncertain"). `ux`, `ut`, `ex` say why (`ex` = the regulation has expired).
- `fr` / `to`: the line applies from / until a date.
- `rx`, `ru`, `sp`, `an`, `n`, `d`, `c`: bookkeeping and names. Not rules.

A line with `t: 0` and none of `f`, `s`, `aw`, `l`, `v`, `dp`, `u` means: park here freely, always.

## How to judge

Ask: would an ordinary car driver who trusts the app do the right thing here, at every hour of the week and in every
season? Compare who may park, when it is forbidden, the time limit and its hours, and whether a fee applies and when.

Things to know about the texts:

1. "får inte parkeras" = parking ban. "får inte stannas" = stopping ban. Both are NO for the app.
2. A permission with a time limit and hours ("får fordon parkeras under högst 2 timmar i följd vardagar klockan
   08–18") is a time limit during those hours. Outside those hours parking is allowed without the limit. That is
   correct, not looser. "Tillåtelsen gäller [days and hours] under högst N min" is the same thing.
3. "får endast … parkeras" / "ändamålsplats" / "parkeringstillstånd för rörelsehindrade" = reserved (`v`).
4. Fee: "mot avgift", "avgift ska betalas". When the text gives fee hours, the app should charge in those hours only
   and be free outside them. When the text only points to a fee table elsewhere ("enligt taxa …") the app can only
   know what its FEE TABLE or `fu` says: accept that as correct unless the text itself gives hours that disagree.
   For Stockholm the fee table number in the text ("taxa 4") should equal the line's `t`.
5. The text says the regulation "upphör att gälla" on a date that has passed (you were told today's date), and the app still
   shows its rule as in force: that is an error.
6. Many texts point to a map ("enligt kartbild", "markerad sträcka"). You cannot check where the line is drawn. Judge
   the rules only.
7. Many texts cover several stretches with different rules (several paragraphs, or "östra sidan … västra sidan …").
   The line is one stretch. The street name and OTHER LINES help you see which. If the line's rules equal one
   paragraph of the text exactly, it is `ok` (say "multi-part" in the note). If they equal none, flag it.
8. Stockholm lines come from the city's own records and are completed from the text. The residents' zone (`r`, `z`)
   cannot be checked against the text: ignore it. City-wide rules that are not in this text are not your concern.
9. Parking disc: the text says "Parkeringsskiva eller motsvarande ska användas" and the line has no `ps`. When
   everything else agrees, the verdict is `ok` with `"note": "disc missing"` (it is collected and fixed, but it is not
   a wrong answer about where and when to park).
10. Exceptions for other users ("gäller inte buss", "gäller inte rörelsehindrade med tillstånd") do not change the
   answer for an ordinary car: ignore them.

## Verdicts

- `ok`: the app agrees with the text for an ordinary car. Small differences that never change what a driver should do
  still count as ok.
- `loose`: the app allows more than the text. Examples: a ban's hours or days are missing or shorter, a time limit is
  missing or longer, free where the text charges, open to all where the text reserves, a rule shown that has expired
  and whose end makes parking forbidden.
- `strict`: the app forbids, limits or charges where the text does not.
- `grey`: the app shows the line grey/unknown. Add `"clear": true` if the text is clear enough for a definite answer
  (the app could be taught to read it), `"clear": false` if the text really cannot be settled without the map or sign.
- `unsure`: you cannot decide. Say what you would need.

Mark `loose` or `strict` only when you are confident. When in doubt, `unsure` with a note. Every flagged row is read
again by someone else before anything is changed, so a clear note matters more than a bold verdict.

## What to write

One line per regulation in `out/<sheet>.jsonl`, in sheet order:

```
{"k": 12, "c": "0380 2022-4", "v": "ok"}
{"k": 13, "c": "0380 2019-51", "v": "loose", "what": "Text bans parking Mon-Fri 08-17; the app has the ban Mon-Fri 08-12 only", "pattern": "second hour range after 'samt' not read", "quote": "klockan 08.00 - 12.00 samt 13.00 - 17.00"}
{"k": 14, "c": "0380 2020-7", "v": "grey", "clear": true, "what": "Text is a plain 2 h limit weekdays 9-18; app shows unknown", "pattern": "limit sentence starts with 'Fordon får parkeras högst'"}
```

- `k` = the number after `===`, `c` = the citation, exactly as on the sheet.
- For every verdict other than `ok`: `what` (English, at most 30 words: what the text says and what the app shows),
  `pattern` (at most 12 words: the sentence shape or cause, so that equal cases can be grouped), and `quote` (at most
  20 words of the Swedish text that matter).
- For `ok` nothing more is needed. Add a short `note` only when something is worth knowing (for example "multi-part").
- Never write a person's name. The file is public.
- Valid JSON on every line, no trailing commas, no line breaks inside a string.

## When you are done

Check that the out file has exactly as many lines as the sheet has regulations (`grep -c '^=== ' <sheet>.txt` and
`wc -l out/<sheet>.jsonl`) and that every line parses as JSON
(`node -e "require('fs').readFileSync(process.argv[1],'utf8').trim().split('\n').forEach(JSON.parse)" out/<sheet>.jsonl`).
Fix what is missing. Then answer in at most five lines: how many of each verdict, and the two or three most common
patterns. Nothing else.
