# User reports

Reports sent from the app's "Report a problem" form (parky-beta `tools/Report.ts` → parky.se `rapport.php` → info@parky.se).
The inbox task files each report here after checking it against the official text; the data quality review works the open
items first (a general fix in the parser or the pipeline, never a one-street patch) and ticks them off with what it found.

No personal data in this file: no names, e-mail addresses, number plates or free text copied from the person. Say what
they reported in a few words of your own.

Format, one line per report, newest last:

`- [ ] <date> · <municipality> · <street> · <citation> · line <id> · reported: <kind, and the point in your own words> · app showed: <answer> · text says: <what the regulation says> · assessment: <data error | app right | text and sign differ | unclear>`

Ticked off as: `- [x] … · done <date>: <what was changed, or why nothing was>`

## Open

## Done

- [x] 2026-11-19 · uppsala · Österplan · 0380 2022-66, 0380 2024-534 · reported by the owner: five green lines, card says "You can park here" · text says: 0380 2024-598 and 2026-520 ban stopping until 28 Feb 2027 and 2024-598 suspends 2024-534 · assessment: data error · done 2026-11-20: new step `cities/rdt-temp.mjs` (ended regulations dropped, suspended ones parked, temporary bans laid on the lines under them); see DAILY.md
