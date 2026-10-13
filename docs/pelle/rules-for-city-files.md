# Status and rules for city files (13 Oct 2026, read this before building)

**Status:**
- **Göteborg:** in App Store version 2.1.0 (submitted for review 13 Oct).
- **Malmö:** in Parky Beta only.
- **Pelle's RDT batch:** `pelle-output/output.json`, municipalities A–E, reviewed in `review-of-output-a-e.md`. Read that review; it lists what must change before any of those municipalities can go into the app. The second half (F–Ö) should follow the rules below from the start.

**Where to put work:** push to a branch such as `expansion/rdt` in `parky-data`, never to `main`. `main` is the app's live data feed, and the nightly bot commits there. `.github/workflows/cities.yml` runs the tests on `expansion/**` branches.

**City file format.** The one the app reads is `cities/<id>.json`. The format is documented in `engine/evaluate.js` in parky-beta, and Göteborg/Malmö are working examples.
1. **One file per municipality.** `city` is a stable id: the SCB municipality name in lowercase ASCII without genitive -s (`angelholm`, not `angelholms`), and `kommunkod` is the 4-digit SCB code. No duplicates.
2. **Bans are bans.** "får inte parkeras" / "får inte stannas eller parkeras" become ban windows in `f` (`{dt, a, b}` or `{w, a, b}`), and "får parkeras endast …" becomes `aw`. **Never write a time limit of 0** (`max: 0`). The app reads it as "no limit", which turns a ban into "you can park here".
3. **Time limits:** `l: [{dt, a, b, max}]` with `max` in minutes > 0 ("högst 1 tim i följd" → `max: 60`). These are already correct in the RDT batch.
4. **Fees:** put the municipality's fee tables in `taxa`, numbered 1, 2, 3 … within the file, with `periods` plus `otherTime` (see Göteborg). Parky gives each city's fee numbers their own range when it loads them; this change is in progress in Parky Beta in the week of 13 Oct, so numbering from 1 is fine. A street with a fee but no known price gets `t: null` (shown as "unknown fee"), never a guessed number.
5. **Uncertain = grey.** If a text can't be read with confidence (scans, maps only, "enligt kartbild" without coordinates, contradictory times), set `u: 1`. The app shows "Osäker regel" rather than guess.
6. **General rule:** `general.maxStay = {dt: ['vardag'], max: 1440}` (the national 24 h weekday rule), unless the municipality's general local regulation says otherwise, in which case cite it.
7. **Coverage area:** include the municipality boundary as `area` (GeoJSON polygon, simplified to about 20 m). Accurate `bounds` alone are the fallback. The app will use it to say **"Inga lokala regler här – du får stå upp till 24 tim på vardagar. Skyltar på plats gäller alltid."** on streets inside a covered municipality that have no regulation. So only municipalities whose whole RDT register has been processed may be marked as covered.
8. **10-metre rule:** include `junctions`/`crossings` from OSM (`cities/osm.mjs`).
9. **Placement:** put the rule on the stretch the text describes ("framför grindarna", "vändplatsområdet", "mellan X och Y"), not on the whole street. If the stretch can't be placed, set `u: 1` or leave it out.

**Seasonal signs:** a limit that only applies part of the year carries `m: [[startMonth, startDay], [endMonth, endDay]]` (see Göteborg, Långedragsvägen: 60 min, 1 Apr–30 Sep). Outside the season the general rule applies, so a seasonal limit must never be written as an all-year limit.

**Checks before a municipality is proposed for the app:**
- `cities/test/engine.test.mjs`, with at least 5 hand-checked streets per municipality (a ban, a limit, a fee) run through the app's own engine.
- `cities/rdt-check.mjs` sample against the official texts, and `tools/rdt-lookup.mjs` (branch `rdt-lookup`) to fetch any regulation text by number.
- Target ≥ 95 % agreement, zero bans shown as allowed.
- A short handoff note per batch with the counts and the spot checks.
