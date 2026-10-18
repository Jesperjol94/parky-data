# Landskrona: published rules vs official regulation texts (re-read with the app's parser)

Run 2026-10-18. 1970 segments: 1970 with a text, 0 without a cached text, 0 fetch errors.
Fully read 1170, partly read 795. Verified equal 1108, filled from text 9, text stricter 30, disputed 4, expired 5, text without rules 18, multi-part texts (not compared) 1.

| Citation | Street | Change | Note |
|---|---|---|---|
| 1282 2010-00670 | Södra Långgatan | uncertain → {"v":"buss"} | filled from text |
| 1282 2010-01243 | Backvägen | {"f":[{"dt":["vardag"],"a":540,"b":1080,"m":[[5,15],[8,15]]}]} → {"f":[{"dt":["vardag"],"a":540,"b":1080,"m":[[5,15],[8,15]]},{"dt":["fore"],"a":540,"b":1080,"m":[[5,15],[8,15]]},{"dt":["helgdag"],"a":540,"b":1080,"m":[[5,15],[8,15]]}]} | text stricter: applied |
| 1282 2012-00058 | Norra Långgatan | uncertain → {"v":"utryckningsfordon"} | filled from text |
| 1282 2018-00081 | Hagastigen | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 1282 2019-00100 | Kungsgatan | {"l":[{"a":0,"b":1440,"max":20}],"v":"rörelsehindrade"} vs text {"l":[{"a":0,"b":1440,"max":20}]} | text more permissive: kept, flagged |
| 1282 2019-00180 | Östergatan | {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag"],"a":480,"b":1080,"max":20},{"dt":["fore"],"a":480,"b":840,"max":20}]} → {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag","fore"],"a":480,"b":1080,"max":20},{"w":6,"a":480,"b":840,"max":20}]} | text stricter: applied |
| 1282 2019-00180 | Östergatan | {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag"],"a":480,"b":1080,"max":20},{"dt":["fore"],"a":480,"b":840,"max":20}]} → {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag","fore"],"a":480,"b":1080,"max":20},{"w":6,"a":480,"b":840,"max":20}]} | text stricter: applied |
| 1282 2019-00180 | Östergatan | {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag"],"a":480,"b":1080,"max":20},{"dt":["fore"],"a":480,"b":840,"max":20}]} → {"f":[{"w":2,"a":540,"b":720}],"l":[{"dt":["vardag","fore"],"a":480,"b":1080,"max":20},{"w":6,"a":480,"b":840,"max":20}]} | text stricter: applied |
| 1282 2019-00204 | Tegelbruksgatan | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 1282 2020-00061 | Alfredsvägen | uncertain → {"f":[{"w":4,"a":540,"b":720}]} | filled from text |
| 1282 2020-00124 | Ålabodsvägen/Ålabodsstrandens parkering | {"v":"personbil"} → {"v":"husbil"} | text stricter: applied |
| 1282 2021-00159 | Lill-Olas väg | uncertain → {"v":"utryckningsfordon"} | filled from text |
| 1282 2021-00198 | Hamngatan | uncertain → {"v":"utryckningsfordon"} | filled from text |
| 1282 2021-00552 | Storgatan | {"f":[{"dt":["vardag"],"a":420,"b":1080}]} → {"f":[{"dt":["vardag"],"a":420,"b":1080},{"dt":["fore"],"a":420,"b":1080},{"dt":["helgdag"],"a":420,"b":1080}]} | text stricter: applied |
| 1282 2021-00552 | Storgatan | {"f":[{"dt":["vardag"],"a":420,"b":1080}]} → {"f":[{"dt":["vardag"],"a":420,"b":1080},{"dt":["fore"],"a":420,"b":1080},{"dt":["helgdag"],"a":420,"b":1080}]} | text stricter: applied |
| 1282 2022-00121 | Enoch Thulins väg | uncertain → {"f":[{"a":0,"b":1440}]} | filled from text |
| 1282 2022-00150 | Skeppsbrokajen | {"l":[{"dt":["vardag"],"a":480,"b":1080,"max":4320},{"dt":["fore"],"a":480,"b":840,"max":4320}],"v":"personbil"} → {"f":[{"a":0,"b":1440}],"l":[{"a":0,"b":1440,"max":4320}]} | "personbil" was not a reservation: applied |
| 1282 2022-00151 | Skeppsbrokajen | {"l":[{"dt":["vardag"],"a":480,"b":1080,"max":4320},{"dt":["fore"],"a":480,"b":840,"max":4320}]} → {"l":[{"a":0,"b":1440,"max":4320}]} | text stricter: applied |
| 1282 2023-00233 | Strandvägen | {"f":[{"a":0,"b":1440},{"w":1,"a":540,"b":720}]} vs text {"f":[{"w":1,"a":540,"b":720}]} | text more permissive: kept, flagged |
| 1282 2023-00233 | Strandvägen | {"f":[{"a":0,"b":1440},{"w":1,"a":540,"b":720}]} vs text {"f":[{"w":1,"a":540,"b":720}]} | text more permissive: kept, flagged |
| 1282 2023-00233 | Strandvägen | {"f":[{"a":0,"b":1440},{"w":1,"a":540,"b":720}]} vs text {"f":[{"w":1,"a":540,"b":720}]} | text more permissive: kept, flagged |
| 1282 2023-00240 | Kolgatan | {"l":[{"a":0,"b":1440,"max":10080}],"v":"personbil"} → {"f":[{"a":0,"b":1440}],"l":[{"a":0,"b":1440,"max":10080}]} | "personbil" was not a reservation: applied |
| 1282 2023-00240 | Kolgatan | {"l":[{"a":0,"b":1440,"max":10080}],"v":"personbil"} → {"f":[{"a":0,"b":1440}],"l":[{"a":0,"b":1440,"max":10080}]} | "personbil" was not a reservation: applied |
| 1282 2024-00063 | Nedre gatan | {"v":"personbil"} → {"f":[{"a":0,"b":1440}]} | "personbil" was not a reservation: applied |
| 1282 2024-00064 | Nedre gatan | {"v":"personbil"} → {"f":[{"a":0,"b":1440}]} | "personbil" was not a reservation: applied |
| 1282 2024-00064 | Nedre gatan | {"v":"personbil"} → {"f":[{"a":0,"b":1440}]} | "personbil" was not a reservation: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00075 | Rådhusgatan | {"f":[{"dt":["vardag"],"a":660,"b":360}]} → {"f":[{"dt":["vardag"],"a":660,"b":360},{"dt":["fore"],"a":660,"b":360},{"dt":["helgdag"],"a":660,"b":360}]} | text stricter: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00144 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00170 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2024-00170 | Selma Lagerlöfs väg | {"v":"personbil"} → {"f":[{"dt":["vardag"],"a":1320,"b":480},{"dt":["fore"],"a":1320,"b":480},{"dt":["helgdag"],"a":1320,"b":480}]} | "personbil" was not a reservation: applied |
| 1282 2025-00197 | Verkstadsgatan | {"l":[{"a":0,"b":1440,"max":10080}]} → {"v":"buss"} | text stricter: applied |
| 1282 2025-00199 | Karlslundsvägen | uncertain → {"v":"buss"} | filled from text |
| 1282 2026-00205 | Midhemsvägen | expired 2026-10-16 | now uncertain |
| 1282 2026-00205 | Midhemsvägen | expired 2026-10-16 | now uncertain |
| 1282 2026-00206 | Pilåkersgatan | expired 2026-10-16 | now uncertain |
| 1282 2026-00218 | Svarvaregatan och Vävaregatan | expired 2026-10-16 | now uncertain |
| 1282 2026-00218 | Svarvaregatan och Vävaregatan | expired 2026-10-16 | now uncertain |
