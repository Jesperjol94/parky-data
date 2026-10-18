# Sigtuna: published rules vs official regulation texts (re-read with the app's parser)

Run 2026-10-18. 785 segments: 785 with a text, 0 without a cached text, 0 fetch errors.
Fully read 727, partly read 58. Verified equal 665, filled from text 10, text stricter 39, disputed 9, expired 0, text without rules 2, multi-part texts (not compared) 2.

| Citation | Street | Change | Note |
|---|---|---|---|
| 0191 2013-00011 | Björkgatan | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2015-00115 | Mjölnergatan | {"l":[{"a":0,"b":360,"max":120}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":120}]} | text stricter: applied |
| 0191 2016-00036 | Stationsgatans södra lokalgata | {"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} → {"f":[{"dt":["vardag"],"a":180,"b":420},{"dt":["fore"],"a":180,"b":420},{"dt":["helgdag"],"a":180,"b":420}],"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} | text stricter: applied |
| 0191 2016-00036 | Stationsgatans södra lokalgata | {"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} → {"f":[{"dt":["vardag"],"a":180,"b":420},{"dt":["fore"],"a":180,"b":420},{"dt":["helgdag"],"a":180,"b":420}],"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} | text stricter: applied |
| 0191 2016-00065 | Manfred Björkquists Allé | {"l":[{"a":0,"b":1440,"max":1440}],"v":"personbil"} → {"v":"motorcykel"} | text stricter: applied |
| 0191 2016-00075 | Tornvägen | {"l":[{"a":0,"b":1440,"max":15}]} → {"v":"buss"} | text stricter: applied |
| 0191 2016-00139 | Söderbyvägen | {"v":"lastbil"} vs text {"v":"buss"} | text differs: kept, flagged |
| 0191 2016-00221 | Uppsalavägen | {"l":[{"a":0,"b":1440,"max":720}]} → {"v":"buss"} | text stricter: applied |
| 0191 2016-00237 | Hammargatan | {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":120}]} → {"f":[{"dt":["vardag"],"a":0,"b":360},{"dt":["fore"],"a":0,"b":360},{"dt":["helgdag"],"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":120}]} | text stricter: applied |
| 0191 2016-00290 | Porsgrunnsgatan | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2017-00037 | Väg I 116 | {"l":[{"a":0,"b":1440,"max":180}]} → {"l":[{"a":0,"b":1440,"max":180}],"v":"beskickningsfordon"} | text stricter: applied |
| 0191 2017-00042 | Atletvägen | {"f":[{"a":0,"b":1440}]} vs text {"f":[{"dt":["vardag","fore"],"a":1380,"b":300},{"dt":["fore"],"a":1380,"b":300},{"dt":["helgdag"],"a":1380,"b":300}]} | text more permissive: kept, flagged |
| 0191 2017-00078 | förbindelsevägen mellan Prästängsvägen och skolområdet | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2017-00082 | Lindberghs gata | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2018-00079 | Hammargatan | {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":120}]} → {"f":[{"dt":["vardag"],"a":0,"b":360},{"dt":["fore"],"a":0,"b":360},{"dt":["helgdag"],"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":120}]} | text stricter: applied |
| 0191 2018-00093 | Steninge allé | {"l":[{"a":0,"b":1440,"max":720}],"v":"personbil"} → {"v":"husbil"} | text stricter: applied |
| 0191 2019-00033 | Bristagatan | {"l":[{"dt":["vardag"],"a":0,"b":180,"max":240},{"dt":["fore"],"a":0,"b":180,"max":240},{"dt":["helgdag"],"a":0,"b":180,"max":240}]} → {"f":[{"dt":["vardag"],"a":0,"b":180},{"dt":["fore"],"a":0,"b":180},{"dt":["helgdag"],"a":0,"b":180}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2019-00062 | Steninge allé | {"l":[{"dt":["vardag"],"a":0,"b":180,"max":240},{"dt":["fore"],"a":0,"b":180,"max":240},{"dt":["helgdag"],"a":0,"b":180,"max":240}]} → {"f":[{"dt":["vardag"],"a":0,"b":180},{"dt":["fore"],"a":0,"b":180},{"dt":["helgdag"],"a":0,"b":180}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2019-00069 | Tallbacksgatan | {"l":[{"dt":["vardag"],"a":360,"b":1080,"max":120}],"v":"lastbil"} vs text {"v":"buss"} | text differs: kept, flagged |
| 0191 2019-00132 | Maskingatan | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2019-00136 | Väg I 105 | {"l":[{"a":0,"b":1440,"max":15}]} → {"v":"buss"} | text stricter: applied |
| 0191 2019-00136 | Väg I 105 | {"l":[{"a":0,"b":1440,"max":15}]} → {"v":"buss"} | text stricter: applied |
| 0191 2020-00022 | Lupinvägen | {"l":[{"dt":["vardag"],"a":360,"b":960,"max":30}]} → {"f":[{"dt":["vardag"],"a":0,"b":360},{"dt":["fore"],"a":0,"b":360},{"dt":["helgdag"],"a":0,"b":360}],"l":[{"dt":["vardag"],"a":360,"b":960,"max":30}]} | text stricter: applied |
| 0191 2020-00074 | Brobyvägen | {"l":[{"dt":["vardag"],"a":0,"b":1440,"max":2880}],"v":"personbil"} → {"v":"motorcykel"} | text stricter: applied |
| 0191 2020-00111 | Lupinvägen | uncertain → {"f":[{"dt":["vardag"],"a":0,"b":360},{"dt":["fore"],"a":0,"b":360},{"dt":["helgdag"],"a":0,"b":360}]} | filled from text |
| 0191 2020-00112 | Lupinvägen | {"f":[{"a":0,"b":1440}]} → {"f":[{"dt":["vardag"],"a":0,"b":360},{"dt":["fore"],"a":0,"b":360},{"dt":["helgdag"],"a":0,"b":360}],"v":"rörelsehindrade"} | text stricter: applied |
| 0191 2020-00142 | Aspvägen | {"f":[{"w":5,"a":540,"b":1020}],"l":[{"a":0,"b":1440,"max":720}]} → {"f":[{"w":5,"a":540,"b":1020,"p":"odd"},{"a":0,"b":1440}],"l":[{"a":0,"b":1440,"max":720}]} | text stricter: applied |
| 0191 2020-00142 | Aspvägen | {"f":[{"w":5,"a":540,"b":1020}],"l":[{"a":0,"b":1440,"max":720}]} → {"f":[{"w":5,"a":540,"b":1020,"p":"odd"},{"a":0,"b":1440}],"l":[{"a":0,"b":1440,"max":720}]} | text stricter: applied |
| 0191 2021-00036 | Stora gatan | {"l":[{"dt":["vardag"],"a":660,"b":1080,"max":60},{"dt":["fore"],"a":540,"b":900,"max":60},{"dt":["vardag"],"a":360,"b":660,"max":60}]} → {"f":[{"dt":["vardag"],"a":360,"b":660}],"l":[{"dt":["vardag"],"a":660,"b":1080,"max":60},{"dt":["fore"],"a":540,"b":900,"max":60}]} | text stricter: applied |
| 0191 2021-00069 | Mistralleden | {"l":[{"a":0,"b":1440,"max":15}]} → {"v":"buss"} | text stricter: applied |
| 0191 2021-00156 | Stadsängsgatan | {"f":[{"a":0,"b":1440}]} → {"f":[{"dt":["vardag"],"a":60,"b":240},{"dt":["fore"],"a":60,"b":300},{"dt":["helgdag"],"a":60,"b":300}],"v":"motorcykel"} | text stricter: applied |
| 0191 2021-00159 | Fältvägen | {"f":[{"dt":["vardag"],"a":150,"b":240}]} → {"f":[{"dt":["vardag"],"a":150,"b":240},{"dt":["fore"],"a":180,"b":240},{"dt":["helgdag"],"a":180,"b":240}],"v":"motorcykel"} | text stricter: applied |
| 0191 2021-00159 | Fältvägen | {"f":[{"dt":["vardag"],"a":150,"b":240}]} → {"f":[{"dt":["vardag"],"a":150,"b":240},{"dt":["fore"],"a":180,"b":240},{"dt":["helgdag"],"a":180,"b":240}],"v":"motorcykel"} | text stricter: applied |
| 0191 2021-00159 | Fältvägen | {"f":[{"dt":["vardag"],"a":150,"b":240}]} → {"f":[{"dt":["vardag"],"a":150,"b":240},{"dt":["fore"],"a":180,"b":240},{"dt":["helgdag"],"a":180,"b":240}],"v":"motorcykel"} | text stricter: applied |
| 0191 2021-00159 | Fältvägen | {"f":[{"dt":["vardag"],"a":150,"b":240}]} → {"f":[{"dt":["vardag"],"a":150,"b":240},{"dt":["fore"],"a":180,"b":240},{"dt":["helgdag"],"a":180,"b":240}],"v":"motorcykel"} | text stricter: applied |
| 0191 2021-00215 | Väg U 11 | {"v":"taxi"} vs text {"f":[{"a":0,"b":1440}]} | text more permissive: kept, flagged |
| 0191 2021-00215 | Väg U 11 | {"v":"taxi"} vs text {"f":[{"a":0,"b":1440}]} | text more permissive: kept, flagged |
| 0191 2021-00215 | Väg U 11 | {"v":"taxi"} vs text {"f":[{"a":0,"b":1440}]} | text more permissive: kept, flagged |
| 0191 2021-00215 | Väg U 11 | {"v":"taxi"} vs text {"f":[{"a":0,"b":1440}]} | text more permissive: kept, flagged |
| 0191 2021-00216 | Nordanleden | {"v":"taxi"} vs text {"f":[{"a":0,"b":1440}]} | text more permissive: kept, flagged |
| 0191 2022-00018 | Metallvägen | {"l":[{"dt":["vardag"],"a":360,"b":1080,"max":120}],"v":"lastbil"} vs text {"v":"buss"} | text differs: kept, flagged |
| 0191 2022-00109 | Oriongatan | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2022-00172 | Slånbärsvägen | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2022-00172 | Slånbärsvägen | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2022-00172 | Slånbärsvägen | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 0191 2023-00016 | John Åkerlunds väg | {"l":[{"a":0,"b":1440,"max":1440}],"v":"personbil"} → {"v":"husbil"} | text stricter: applied |
| 0191 2023-00016 | John Åkerlunds väg | {"l":[{"a":0,"b":1440,"max":1440}],"v":"personbil"} → {"v":"husbil"} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2024-00005 | Kyrkstigen | {"l":[{"dt":["helgdag"],"a":0,"b":1440,"max":240}]} → {"f":[{"a":0,"b":360}],"l":[{"a":0,"b":1440,"max":240}]} | text stricter: applied |
| 0191 2025-00014 | Torsgatan | {"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540},{"dt":["vardag"],"a":120,"b":360,"max":540}]} → {"f":[{"dt":["vardag"],"a":120,"b":360}],"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540}]} | text stricter: applied |
| 0191 2025-00014 | Torsgatan | {"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540},{"dt":["vardag"],"a":120,"b":360,"max":540}]} → {"f":[{"dt":["vardag"],"a":120,"b":360}],"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540}]} | text stricter: applied |
| 0191 2025-00014 | Torsgatan | {"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540},{"dt":["vardag"],"a":120,"b":360,"max":540}]} → {"f":[{"dt":["vardag"],"a":120,"b":360}],"l":[{"dt":["vardag"],"a":360,"b":1200,"max":540}]} | text stricter: applied |
| 0191 2025-00026 | Diagonalen | {"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} → {"f":[{"dt":["vardag"],"a":180,"b":420},{"dt":["fore"],"a":180,"b":420},{"dt":["helgdag"],"a":180,"b":420}],"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} | text stricter: applied |
| 0191 2025-00026 | Diagonalen | {"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} → {"f":[{"dt":["vardag"],"a":180,"b":420},{"dt":["fore"],"a":180,"b":420},{"dt":["helgdag"],"a":180,"b":420}],"l":[{"dt":["vardag"],"a":540,"b":1080,"max":120},{"dt":["fore"],"a":540,"b":900,"max":120}]} | text stricter: applied |
