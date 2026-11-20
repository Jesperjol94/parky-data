# Quality projects: the queue for the project runs

Why this file exists (20 Nov 2026): the daily random sample is a good thermometer but a slow broom. In three weeks the
share of correct lines stayed at 94–95 % while each run changed 15–100 of 114,000 lines. Two reports from the street
(Uppsala Österplan, Gävle Södra Rådmansgatan) led to fixes that changed 15,000 lines. So two of the three daily runs
now work through the known big groups below, one at a time, and the third keeps measuring.

How a project run uses this file:
1. Take the first project under "Queue" that is not ticked.
2. Do ONE batch of it as its entry says (normally: draw up to 240 regulations with the option given, have them read
   against the official text, fix the patterns found as general fixes with a test, apply, check, publish).
3. Add one dated line under the project's "Log" (what was read, how many were wrong and how, what was fixed, how many
   regulations the pool still holds). Add the usual line to DAILY.md too.
4. Tick the project when its pool is empty or its exit rule is met, and say so in the log line.

Draws use `node cities/rdt-qa-sample.mjs <count> <out.json> <seed> [--only a,b] [--check name] [--unread]`; its last
output line says how many unread regulations the pool still holds. Everything read is appended to `reviewed.txt`, so
no regulation is read twice, whichever run drew it.

No personal data in this file.

## Queue

### 1. [ ] The app allows more than the sign: flagged lines
The audit's "looser" leads, smallest and most harmful first. One batch per check, in this order:
`--check limitMissing` (text has "högst N tim", the line has no limit; 189 regulations on 20 Nov),
`--check weekdayBanMissing` (text names a weekday, the line has no ban that day),
`--check feeMissing`, `--check feeHoursUnread`, `--check banButPermission`.
A check's count is a lead, not an error count: many rows are right once the text is read (the weekday is an exception,
the limit belongs to another paragraph). Fix the sentence shapes behind the real ones.
Exit: every check above has an empty pool (run `node cities/rdt-audit.mjs` first so `audit.json` is current).

Log:

### 2. [ ] Read every regulation in the towns where people use the app
Outside Stockholm, Göteborg and Malmö the live users are few and concentrated, so these towns can be read completely.
Batches of 240 with `--only`, one group at a time, in this order:
1. `uppsala,solna,sollentuna,upplands-vasby` (1,875 unread regulations on 20 Nov)
2. `nacka,sundbyberg,jarfalla,huddinge,taby,danderyd,lidingo`
3. `haninge,tyreso,botkyrka,sodertalje,varmdo`
4. `vasteras,orebro,linkoping,norrkoping,helsingborg,jonkoping,lund,umea,gavle,eskilstuna,karlstad,vaxjo,halmstad,sundsvall`
The daily measuring run re-ranks this order once a week from where street taps come from; follow the order written
here when the run starts. A group is finished when its pool is empty; say so in the log with the group's result
(correct / stricter / looser / grey over all its batches).
Exit: groups 1–3 finished. Group 4 is worked only when nothing else in the queue is open.

Log:

### 3. [ ] Sentences the parser does not read
Regulations whose text has a sentence shape the parser skips (their register data is shown unverified):
`--unread` (1,833 unread regulations on 20 Nov). Before drawing, run `node cities/rdt-unread-scan.mjs` and note the
most common shapes: teach the parser the common ones first, then draw. A shape the parser cannot settle goes grey,
never a guess.
Exit: the pool is empty, or two batches in a row teach the parser nothing new (then the rest is one-off wording).

Log:

### 4. [ ] Fee around the clock
`--check feeAllDay` (2,006 lines in 43 municipalities, 750 unread regulations on 20 Nov). Most texts give fee hours,
or point to a fee table ("taxa") whose hours are in another regulation of the same municipality. Find the general
rule per municipality (where its fee hours are written) rather than line by line. When the hours cannot be found in
any text, the line keeps "fee – see the sign" (`fu`), never a guessed table.
Exit: the pool is empty.

Log:

### 5. [ ] Two regulations on one stretch
The audit's `conflict` (a ban line and a permission line from different regulations on the same stretch, 3,039 lines)
and `dup` (the same line drawn twice from different regulations, 2,288 lines). The map shows one line and a tap
answers with either regulation. This project is design first, then small safe steps:
- Batch 1: no fixes. Draw 120 pairs from `audit.json` (`checks.conflict.rows`, `checks.dup.rows`), read BOTH texts
  of each pair, and sort them: (a) the older regulation is replaced by the newer one for the same stretch and side,
  (b) the two sides of the street, (c) a street ban plus a permission for marked bays (the permission is right where
  the bays are: usually nothing to fix), (d) a temporary and a permanent regulation (rdt-temp's job), (e) other.
  Write the shares and five examples per class here, and a short plan for the largest safe class.
- Later batches: one class per batch, as a pipeline step with tests (like `rdt-strips.mjs` and `rdt-temp.mjs`).
  For (b): move each line a few metres to its own side only when the text names the side ("norra sidan", house
  numbers on one side) and the line's direction makes the side unambiguous; otherwise leave it. For (a): drop the
  older line only when the newer text repeals it by name or covers the same stretch, side and kind of rule.
  After applying, read 30 changed pairs against both texts; under 95 % confirmed, revert and write why.
- What only the app can solve (showing both answers for one tap) is written up for the owner, not built here.
Exit: classes (a) and (b) handled or shown unsafe, with the counts before and after.

Log:

## Done
