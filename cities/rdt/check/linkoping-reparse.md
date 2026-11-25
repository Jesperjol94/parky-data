# Linköping: published rules vs official regulation texts (re-read with the app's parser)

Run 2026-11-25. 6379 segments: 6379 with a text, 0 without a cached text, 0 fetch errors.
Fully read 6371, partly read 8. Verified equal 6331, filled from text 6, text stricter 0, disputed 1, expired 0, text without rules 21, multi-part texts (not compared) 0.

| Citation | Street | Change | Note |
|---|---|---|---|
| 0580 2018-00555 | Järnvägsgatan | uncertain → {"l":[{"a":0,"b":1440,"max":1440}],"v":"moped"} | filled from text |
| 0580 2021-00302 | Fågelsångsvägen | uncertain → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":240},{"dt":["fore"],"a":0,"b":1440,"max":240},{"dt":["helgdag"],"a":0,"b":1440,"max":240}],"v":"rörelsehindrade"} | filled from text |
| 0580 2021-00392 | anordnad parkeringsyta | uncertain → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":1440}]} | filled from text |
| 0580 2021-00393 | anordnad parkeringsyta | uncertain → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":1440}],"v":"rörelsehindrade"} | filled from text |
| 0580 2021-00405 | Namnlös väg | uncertain → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":1440}]} | filled from text |
| 0580 2021-00406 | Namnlös väg | uncertain → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":1440}]} | filled from text |
| 0580 2022-145 | Storgatan | {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":240}],"v":"motorcykel"} → {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":240},{"dt":["fore"],"a":0,"b":1440,"max":240},{"dt":["helgdag"],"a":0,"b":1440,"max":240}],"v":"cykel"} | text differs: text wins (owner's decision 18 Oct) |
