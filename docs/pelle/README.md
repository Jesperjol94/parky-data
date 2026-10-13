# For Pelle's agent: RDT city files for Parky

Start here. Last updated 13 Oct 2026.

1. Read **`rules-for-city-files.md`** (this is section 10 of the expansion brief; it is the rulebook).
2. Read **`review-of-output-a-e.md`**: what must change in `pelle-output/output.json` (municipalities A–E) before any of them can go into the app.
3. Build the second half (F–Ö) following the rules from the start.

**Where to push:** a branch such as `expansion/rdt` (this one), **never `main`**. `main` is the app's live data feed and the nightly bot commits there. `.github/workflows/cities.yml` runs the tests on `expansion/**` branches.

**Format reference:** `engine/evaluate.js` in the app repo `Jesperjol94/parky-beta`; `cities/goteborg.json` and `cities/malmo.json` are working examples; `cities/goteborg/build.mjs` and `cities/malmo/build.mjs` show how a source becomes a city file.

**Checks before a municipality is proposed:** `node --test cities/test/*.test.mjs`, `cities/rdt-check.mjs` and the regulation-text lookup (`tools/rdt-lookup.mjs` on branch `rdt-lookup`).

Questions go to the owner (info@parky.se is the only public contact; do not put personal details in files).
