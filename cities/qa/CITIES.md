# Weekly check of Stockholm, Göteborg and Malmö

Most people use Parky in these three cities. Their data is built every night on branch `main` (Stockholm from the
city's records completed with the official texts; Göteborg and Malmö from each city's open data), so the
national-register review (`DAILY.md`) never looks at it. Once a week a run reads 240 Stockholm regulations
(`cities/qa-city-sample.mjs`) and 60 segments each from Göteborg and Malmö against their sources, and fixes what is
wrong at its source through a pull request against `main`.

One line per week: date · per city the sample and the shares correct / stricter / looser / grey-ok / unsure ·
error patterns · what was fixed and merged (pull request numbers) · what is waiting for the owner.

Earlier: full comparison of all three cities on 13 Oct 2026 (Stockholm 2.8 % of segments wrong before the fixes of
that day, Göteborg 0.04 %, Malmö 0.2 %).


- 2026-11-22 · Stockholm 0 read: nothing unread is left (all 9,419 regulations with a text were read in the 20–21 Nov sweeps; 220 regulations / 260 lines have no text to read against); live data is still the 20 Nov build because the city's API has answered HTTP 500 to every nightly fetch since 21 Nov (4 runs, last 22 Nov 07:58 UTC), so the parser fixes of pull requests #8 and #9 are not in the app yet · Göteborg 60 lines (seed 20261122, against the raw layers committed 9 Nov; live file built 18 Nov): 100 % correct / 0 stricter / 0 looser / 0 grey-ok / 0 unsure · Malmö 60 lines: 98.3 % correct / 0 / 0 / 1.7 % grey-ok (commuter fee "Taxa Pendlar 1 kr/tim", no table) / 0 · no error pattern, nothing fixed, no pull request · leads for next week: (1) Göteborg has 39 lines that lie on another regulation's line (within 2 m for 80 % of their length), 24 of them with a different rule (0.5 % of lines; e.g. Kolonigatan 2021-02207 paid, under "Zon Landalahöjd" 2008-01778 free 2 h with a winter cleaning Wednesday; Molinsgatan 2016-00459 without and 2019-00056 with the Wednesday cleaning): the city's layers carry both records, the app draws both; check them against the regulation texts (which one is repealed) before changing the builder; (2) 74 Göteborg and 55 Malmö live lines have no record in the committed raw layers (raw 9 Nov, live 18 Nov) and were left out of the draw: the nightly should commit the raw layers it builds from · waiting for the owner: the Stockholm fetch failure (nothing to fix in the repo), and what the Stockholm part of this check should read now that everything is read (proposal: regulations whose line changed since they were read).
