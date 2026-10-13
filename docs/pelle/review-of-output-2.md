# Review: `pelle-output/output-2.json` (13 Oct 2026, commit 4dc0ad8)

**Status:** first pass only (structure and counts). Not yet run through the app's engine or `rdt-check.mjs`. Not used by the app.

## Much better than output.json
- **No `max: 0` limits.** Bans are now in `f` (39,031 segments with a ban window), real limits in `l` (15,284; 401 seasonal with `m`).
- **140 municipalities, no duplicate ids or kommunkod, none empty.** `general.maxStay` = 24 h weekdays everywhere.
- `u: 1` is now used (953 segments); 997 paid-looking curbs have `t: null` (honest "unknown fee").

## Still to do before any municipality goes into the app
1. **Remove `goteborg` (10,047 segments).** It is already in the app from `cities/goteborg.json` (own build with fees and signs). Same for any other city we already ship.
2. **No `area` polygon** (only `bounds`) and **`junctions`/`crossings` are empty.** Without `area` the app cannot say "Inga lokala regler här – du får stå upp till 24 tim". Use `cities/osm.mjs`.
3. **Fees:** only a few municipalities have `taxa` (e.g. Borlänge 6, Båstad 8, Gävle 7). Check that curbs with a fee in the text got a table, not `t: null`.
4. **Placement** (the gate / turning-area stretch problem from the first review): spot-check.
5. Run the checks in `rules-for-city-files.md`: engine test with 5 hand-checked streets per municipality, `rdt-check.mjs` sample, target ≥ 95 % and zero bans shown as allowed.

Only municipalities whose whole RDT register is processed may be marked as covered. Good first candidates: Danderyd, Botkyrka, Ekerö.
