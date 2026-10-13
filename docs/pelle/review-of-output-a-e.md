# Review: `pelle-output/output.json` (58 municipalities from RDT)

**From:** main development agent, 13 Oct 2026. **Input:** `pelle-output/output.json` in `Jesperjol94/parky-data` (commit 16c4584, Pelle Branden, 13 Oct 03:11).
**Status:** reviewed, **not used by the app** (the app only reads `segments.json` and `cities/<id>.json`). Promising volume, but not safe to ship yet. The rules for city files are in `rules-for-city-files.md`. Use that for the second half (F–Ö).

## What it is
- An array of 58 city files in Parky's city format (`v`, `city`, `bounds`, `taxa`, `segments` …), built from Transportstyrelsen's register (RDT).
- Municipalities A–E only (Ale … Eskilstuna). That's 50 municipalities with data after removing duplicates and empty files, about 17 % of Sweden's 290.
- 13,562 segments in total, from about 8,000 regulations.
- Largest files: Danderyd 1,350 segments, Botkyrka 1,300, Eskilstuna 1,120, Ängelholm 757, Borås 724.

## Blocking issues (must be fixed before any city goes into the app)
1. **`max: 0` time limits on 8,842 of 13,562 segments (65 %). These are parking bans** (confirmed against the official texts, see below).
   - The app treats `max: 0` as "no limit", so these curbs would show as allowed all day.
   - They must be written as ban windows in `f` (or `aw` for "only allowed then"), never as limits.
   - Showing a ban as "you can park here" is the worst error Parky can make.
2. **No "uncertain" flags at all.**
   - RDT has many texts that can't be read reliably.
   - Unclear texts should set `u: 1`, so the app greys them out instead of guessing.
3. **Duplicate municipalities** under two names, both included:
   - ängelholm / ängelholms, åstorp / åstorps, arvidsjaur / arvidsjaurs, arjeplog / arjeplogs, älmhult / älmhults.
   - Keep one id per municipality (the SCB name without genitive -s, plus `kommunkod`).

## Handled on Parky's side (no change needed in the converter)
4. **Fee numbers.** Each municipality numbers its fee tables 1, 2, 3 …, which is fine.
   - Today the app keeps one shared list of fee tables: Stockholm 1–15, Göteborg 2000+, Malmö 3000+. It ignores other cities' numbers below 1000, so a Danderyd street with fee table 1 (1 kr/h) would show Stockholm's table 1 (55 kr/h).
   - The app is being changed to give every city's fee tables their own range automatically when loaded (in progress in Parky Beta, week of 13 Oct).
   - Keep numbering from 1; no renumbering needed.

## Should be fixed
5. **`general: {}` everywhere.**
   - The national rule (24 h on weekdays except the day before a Sunday/holiday) applies unless the municipality has a local rule.
   - Göteborg and Malmö have `general.maxStay {dt: ['vardag'], max: 1440}`. Each municipality's general local regulation (if any) should be checked.
6. **No coverage area.** Add the municipality boundary as `area` (see `rules-for-city-files.md`, point 7). The app will then say "Inga lokala regler här – du får stå upp till 24 tim på vardagar" on unregulated streets inside a covered municipality, instead of showing an empty map.
7. **No `junctions`/`crossings`.** The 10-metre rule needs them. `cities/osm.mjs` in parky-data already builds them per city.
8. **1,458 paid-looking curbs have `t: null`** (unknown fee). That's fine as an honest "unknown", but worth reducing.
9. **Overlap with Stockholm:** Danderyd, Botkyrka and Ekerö fall inside the app's Stockholm bounding box. The app supports this, but these are the first non-Stockholm municipalities inside it, so test "Var står jag?" and search there specifically.
10. **Three files are empty:** Älvdalen, Åmål and Eda.

## Confirmed against the official texts (13 Oct 2026)
Fetched from Transportstyrelsen RDT with `tools/rdt-lookup.mjs` (branch `rdt-lookup` in parky-data; list the codes in `tools/rdt-lookup.txt` and push; results land in `tools/rdt-lookup-out.md`).
Every `max: 0` example checked is a ban:

| Regulation | Street | Official text | In output.json |
|---|---|---|---|
| 1489 2008-0097 | Rektorsgatan, Alingsås | "får inte fordon parkeras" weekdays 07–17 | limit max 0, weekdays 07–17 |
| 1489 2008-0136 | Skruvgatan, Alingsås | "får inte fordon stannas eller parkeras" weekdays 07–19 | limit max 0, weekdays 07–19 |
| 1440 2008-00081 | Fyrklövergatan, Ale | "får inte fordon parkeras" | limit max 0, all day |
| 0484 2010-069 | Vilstavägen, Eskilstuna | "får fordon inte parkeras" | limit max 0, all day |
| 1490 2010-2031 | Lidaholmsgatan, Borås | "får fordon inte parkeras" | limit max 0, all day |
| 0162 2000-1118 | Enebybergsvägen, Danderyd | stopping and parking banned (in front of a driveway gate) | limit max 0, all day |
| 0162 2013-00259 | Anundvägen, Danderyd | "får fordon inte parkeras" (turning area) | limit max 0, all day |

So `max: 0` = "parkering förbjuden" (and sometimes "stanna och parkera förbjudet"). Write these as ban windows in `f`.

- The real limits are encoded correctly. Example: 0162 2014-00068, Vendevägen, Danderyd, "högst 1 tim i följd" on weekdays, is in the file as a 60-minute weekday limit.
- The fix should be in the converter's handling of bans, not a rethink of the method.
- Placement still needs checking. Enebybergsvägen's ban applies only in front of a gate, but it may be drawn along the whole street.

## Process
- Please push work in progress to a branch such as `expansion/rdt` instead of `main`.
- `main` of parky-data is the app's live data feed, and the nightly bot commits there.
- `.github/workflows/cities.yml` already runs tests on `expansion/**` branches.
- Before a city can be considered, two checks need to pass:
  - **Engine test:** the existing test in `cities/test/engine.test.mjs`, where verdicts come from the app's own engine. Add a few hand-checked streets per municipality.
  - **RDT sample check:** `cities/rdt-check.mjs`, which compares a random sample against the official PDF text.
- **Good first candidates** once the above is fixed: Danderyd, Botkyrka and Ekerö. They're next to Stockholm, existing users drive there, and they're small enough to check by hand.
