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

