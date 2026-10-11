// Raw city data was downloaded and parses (run by the Cities workflow after cities/probe.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

const read = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)));
for (const f of ['cities/raw/malmo-miljoparkering.geojson.gz', 'cities/raw/malmo-parkeringsavgifter.geojson.gz']) {
  test(`raw ${f}`, { skip: !fs.existsSync(f) && 'not downloaded' }, () => {
    const fc = read(f);
    assert.ok(fc.features.length > 500);
  });
}
