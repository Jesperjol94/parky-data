# Parky data

Parking rules for Stockholm, rebuilt every night for the [Parky](https://parky.se) app.

- `segments.json`: one entry per curb segment, with cleaning windows, time limits, fee zone and reserved spaces.
  Coordinates are WGS84 `[lon, lat]`. The format is documented in `engine/evaluate.js` in the app.
- `meta.json`: build statistics.

Sources:
- Stockholms stad, LTF-Tolken (lokala trafikföreskrifter), open data.
- Road junctions and pedestrian crossings © OpenStreetMap contributors (ODbL), used for the 10-metre rule.

The road signs on site always take precedence over this data.
