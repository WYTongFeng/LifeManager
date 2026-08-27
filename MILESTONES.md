# LifeManager — Completion Milestones

Tracks progress toward turning the LifeManager mockup into a complete personal app. Updated as we go.

## M54 — Life Hub: notes, reminders and special days behind the centre button ✅ done

The brief in one line: **fewer app switches.** Writing a note, remembering a birthday, setting a
reminder — three things that were still sending the user out to other apps. The rule attached to it
was equally clear: no separate "Life Utilities" tab, and no Quick Add page in the middle. Another
navigation step to reach a convenience feature cancels out the convenience.

### The centre button stopped being an AI shortcut
The most reachable control on the screen — bottom centre, thumb height — opened one feature. It now
unfolds into four tiles (📝 记事本 · 🤖 AI · 🔔 提醒 · ⭐ 特别的日子), each going **straight to the
thing**: the Notes tile links to `/notes/new`, so one tap lands in an empty note with the cursor in
it, not on a list with an Add button. The assistant is unchanged and still has its Header entry too.

Four, deliberately. A launcher with eleven shortcuts is a menu, and a menu has to be read.

### Three real routes, not modals
`/notes/:id?`, `/reminders/:id?`, `/special/:id?`. Two consequences, both free:

- The Android back button already walks editor → list → wherever you came from, because M31's
  router migration made back mean `navigate(-1)`.
- Each screen keeps **one** mounted `usePersistentState` for its key. Splitting list and editor
  across two routes would mean two instances of the same hook drifting apart until one remounts —
  the failure storage.js exists to document.

### Reminders had to work with the app closed, which needed a native plugin
Nothing in the app could *post* a notification. `TngListenerService` only ever **reads** them. So
`@capacitor/local-notifications` went in — and two decisions came out of reading its source rather
than its README:

**A rolling 60-day window, re-synced on every app open — not an OS repeat.** `repeats: true` looks
like less work and can't do the job: a Special Day's "remind me 1 week before" is a date computed
from another date, which no `every:` value expresses; and an OS repeat is fire-and-forget, so
editing the wording leaves the system holding the old one. The window is topped up on resume, which
on Android is the normal event — the app is suspended for days, not closed.

**`isExactNotification: false`.** The plugin defaults it to TRUE, and on Android 12+ scheduling an
exact alarm without the permission makes it **launch the system "Alarms & reminders" settings
screen**. That would have fired on app open, unprompted, every time the window re-synced. Inexact
means `setAndAllowWhileIdle`: still wakes the device out of Doze, may be up to ~15 min late. Right
trade for "submit the document at 20:00"; wrong one for an alarm clock, which this is not.

**Notification ids are content-derived** (`occurrenceId` hashes kind + source + date + title + body).
That is what makes editing work: an untouched reminder keeps its id and the scheduler leaves it
alone, while a renamed one hashes to a NEW id — so the stale alarm falls out of the desired set and
is cancelled while the new text is scheduled. Keyed on identity alone, the OS would have kept firing
the old wording and the edit would have saved and then been silently ignored.

### The permission state is on the screen, not hidden
The worst version of this feature is one that looks like it works and never fires — you find out by
missing something. So `/reminders` says which of the four states it is in, and **asks for the
permission there**, in the one place where "let LifeManager notify you" obviously means something,
rather than at app start where the reflex is Deny. On web it says plainly that reminders won't
survive the tab closing.

### Reminder vs Special Day stayed separate
A reminder is a task with a deadline that you tick off. A birthday is neither. Merged, you would
have to explain why some rows have a checkbox. They share a notification pipe and nothing else.

The year in a Special Day's date is load-bearing: it is the only reason the app can say 「第 26 年」,
which is the one thing a paper calendar can't do. Feb 29 clamps to Feb 28 in common years — a
birthday skipped three years in four is worse than one a day early.

**The case that shaped `notificationsFor()`:** on 3 Sep, the "1 week before" moment for a 5 Sep
birthday is 29 Aug — already gone. Taking this year's occurrence and stopping would schedule
nothing, this year *and every year after*, because the app is opened inside that window every time.
It walks forward to next year's instead.

### Notes: a notebook, and the brief said so
No nesting, no backlinks, no rich text, no tags on top of categories — Notion and Obsidian were
ruled out by name. Auto-save with no Save button, debounced 400ms, which had two things to get
right: never fire on mount (opening a note and closing it would otherwise stamp a fresh `updatedAt`,
jump it to the top of 最近 and push it to the cloud — an edit that never happened), and always
flush on unmount (typing then immediately hitting back is exactly how this gets used).

A note with nothing in it is **deleted rather than stored**, so backing out of an accidental 新建
leaves no blank row. An untitled note takes its title from the first line of the body — a list of
rows all saying "Untitled" is useless.

Seven built-in categories plus the user's own. Deleting a custom category never deletes its notes;
they fall back to 杂项, and `countByCategory` files orphans there too so the counts still add up.

### Two bugs this surfaced, both pre-existing
- **The HUD banner was a hardcoded chain of four `activeTab === 'x' &&`.** Nothing about it said new
  routes had to be added, so `/notes` rendered the banner's frame with **nothing inside it**. Now a
  lookup table, and an unmatched route renders no banner rather than an empty one.
- **Android back navigated the route out from under an open modal.** The AI assistant has had this
  the whole time: back changed the page behind it and left the conversation floating on top of a
  screen you didn't ask for. `useBackDismiss` gives overlays first refusal, as a stack so layers
  peel one at a time. Fixed for the AI modal too, not just the new sheet.

### Dashboard
One `UP NEXT` card, three rows, no chart and no totals — and it renders **nothing** when nothing is
coming, the same rule 本周 follows. At most one row per source, or a daily reminder fills every slot.

### Coverage
158 new assertions across `test-notes`, `test-reminders`, `test-specialdays`, `test-upnext` —
the recurrence calendar (including 31st-of-the-month clamping in both directions and Feb 29),
the notification-id contract, and the "warning already passed" case above.

## M53 — 训练进度: the split you are actually following ✅ done

P1.2 of the same brief as M52, built second because it needed the audit's finding first.

**The constraint that shaped the whole thing.** The obvious design — a list of exercises with
weight charts — is mostly BLANK for this user. He logs most training days in one tap
(`type: 'session'`: routineBlock, setsPlanned, durationMin, and no exercise, weight or reps at
all), because the phone is in the locker while he trains. A per-exercise screen would have
quietly stopped working for the person it was built for. This was recorded after the M43
feedback round and is exactly the kind of thing the brief could not have known.

So `/sports/progress` has two tiers, and **the first one is the important one**:

### Tier 1 — 四分化轮换 (works with every record he actually creates)
`blockHistory()` keys on `routineBlock`, falling back to `routineName`, and counts one session
per BLOCK PER DAY — so a 20-set chest day logged set-by-set and the same day logged in one tap
score identically. Twenty records is not twenty sessions.

The screen merges in routines that have **never been trained**, which cannot come from the
workout log — the whole point is that there is no data for them — and sorts never-trained first,
then longest gap. On the seeded fixture the top row is 「板块 4 · 肩 + 腹 · 还没练过」, which is
the single most useful line on the screen and is invisible to any per-exercise view.

That line is also lifted onto the 健身 overview's new 进度 entry card, so the overview answers it
without a tap. `daysSince` is `null`, never a large number, when a block was never trained —
"never" and "999 days ago" are different statements.

### Tier 2 — 动作进展 (real strength data, honest about its coverage)
`exerciseSessions()` returns one row per DAY, not per set: three sets of bench on Monday are one
data point about Monday's bench. The day's number is the **top set**, not the average, because an
average moves when you add a warm-up or a back-off set — which is not a strength change.

`loggingMix()` exists so a thin list explains ITSELF: 「过去 4 周 10 次训练里，有 6 次是一键整场
记录 —— 那种记录不含每个动作的重量」. An explanation; an empty list is a bug report.

**No estimated 1RM**, deliberately — see M52. Sparse set data makes it a formula dressed as a
measurement.

### The defect the screen found in itself
`exerciseProgress` compares the latest session to the previous one and had four verdicts: `up`
(heavier), `reps` (same weight, more reps), `down` (lighter), `same`. Running it on real-shaped
data showed 绳索三头下压 going 27.5kg × 12 → 27.5kg × 10 and reporting **「持平」**.

That is the mirror of the case the file was written for. If 45kg × 9 after 45kg × 7 counts as
progress — and it does, it is the thing a weight-only view misses entirely — then 27.5kg × 10
after 27.5kg × 12 is not "no change". The reps moved, downward, and 持平 is a true-sounding claim
about a number that changed. Added `repsDown`, amber like `down`. Caught by looking at the
rendered screen, not by the 55 tests that were already green — the same way M52's two defects
were caught.

### Tests — 983 total (59 new in `test-workoutprogress.mjs`)
The one-tap-vs-set-by-set equivalence, the top-set-not-average rule, back-off sets not dragging
the top set down, holds (plank/wall sit) getting no weight verdict and contributing no volume,
renamed routines showing under their current name, the never-trained fallback, and the `repsDown`
case above.

Verified live against a fixture built to exercise the real cases (blocks 1 and 2 recent, block 3
17 days stale, block 4 never, four days logged set-by-set): every figure matched by hand —
板块 1 · 7 次 · 昨天 (3 one-tap days + 4 set-by-set days on the same block), 板块 3 · 17 天前,
卧推 45kg × 9 · +2 次 · 这次 765kg (45×9 + 45×8), and the logging-mix sentence reporting 6 of 10.
375px: no horizontal overflow, no card overflowing, mini-bars rendering.

## M52 — 本周回顾: the week the app could never answer for ✅ done

Came from a P1 product brief the user had written up with ChatGPT — four asks (unified Goals,
workout progress, weekly insights, cross-domain correlation) handed over with 「你看看自己取舍」.
The audit is most of the value here, because three of the four asks were wrong about what the
app already contains:

- **「Weight tracking」 does not exist.** `bodyWeightKg` is a single scalar in `meta/settings`,
  and `WeightTrendChart` is the per-EXERCISE barbell trend, not body weight. The brief's
  「体重 67.0 → 66.6kg」 was not a display problem, it was unanswerable — there was no history
  to draw. This turned out to be the cheapest high-value item in the whole document.
- **Weekly insights were half-built and then orphaned.** `weekStats.js` and its passing tests
  had been in the repo since M34/M41, and NOTHING imported them any more — the weekly card had
  fallen out of Dashboard at some point. Part of this milestone is un-deleting a regression.
- **Workout progress already exists**, inside a live session: PRs, `getPR()`, the trend chart,
  the recent-PR list.

**Goals were declined, and this is the part worth remembering.** The money module already IS
the financial goal system (debt payoff, the reserve bar, per-account `target`), and §13 of the
brief itself warned against a second calculation layer over money — a `Goal` object reading
financial data would have been exactly that, three weeks after M51 rebuilt it. Beyond that, a
goal needs manual upkeep, and [[real-use feedback]] has twice shown that features encoding a
workflow he does not follow simply go unused. Told him so and built the rest.

Also trimmed: **no estimated 1RM**. He logs whole sessions in one tap (`type: 'session'`,
carrying no exercise/weight/reps), so per-exercise strength maths is blank on most days — the
constraint recorded after the M43 feedback round, which the brief could not have known.

### `weekStats.js` — rewritten to read the RAW records
It summed `dailyStats`, which carries `totalCalories` but no protein and nothing about body
weight. The raw `meals`/`workouts`/`expenses` arrays carry every field, are never pruned (M13)
and are fully synced, so a week from four months ago now answers as well as this one.

- `computeWeekReview({meals, workouts, expenses, weightLog, week, throughDate})` — 饮食 / 训练 /
  消费 / 体重 for one window.
- Averages divide by days **LOGGED**, not by 7, and ship `daysLogged` alongside so the screen
  can state the denominator. Three logged days over a week would otherwise report 814 kcal/day
  for someone eating 1,900 — a true division producing a false statement.
- Training counts **days**, not records, so a 20-set chest day logged in one tap and the same
  day logged set-by-set score identically.
- 消费 uses `isDailySpend` from accounts.js rather than a filter written here. Nothing in the
  file touches the cycle, the spendable figure or net worth (§13).
- `computeWeekComparison` clamps the PREVIOUS week to the same number of elapsed days before
  anything is subtracted. On a Tuesday, this week has had two days to spend money in and last
  week had seven; without the clamp the app reports a saving that is really just the calendar.
  Same argument `grossSpentByDayIndex` settled for the monthly comparison in M23.
- `pickWeekHighlights` — two or three SENTENCES, rule-based, no model call. Every rule can
  decline to fire, and the thin-data caveat is stated first so it qualifies the averages under it.

### `bodyWeight.js` — new, and the honesty rule in it
`bodyWeightKg` is untouched and still means what it meant: the current weight every calorie
formula reads. The log is appended alongside from the body-profile modal.

**An unchanged number records nothing.** That modal also holds height, age and sex, so it is
saved for reasons unrelated to weight — and a reading deposited on every save is a measurement
nobody took, indistinguishable from a real one once stored. Also fixed while here: the kg input
had `step="1"`, which made the browser REJECT 66.6 on submit. Harmless while this was one
settings value; fatal for a trend.

### Two defects the work found in itself
- **An empty week produced a finding.** A week with nothing logged emitted 「这周还没记录任何
  饮食」 under a card already saying the week was blank. Now: no data, no claims. But a week you
  TRAINED in and logged no food in still earns that line — the silence is about the food log.
- **Comparability was one flag, and had to be per domain.** `hasData(previous)` was true if the
  previous week held anything in ANY domain, so a week containing one stray weigh-in and nothing
  else counted as comparable for training and money too. Caught in the browser, live: last
  week's card announced 「训练 3 天，比上周多 3 天」 and 「花了 RM261，比上周多 RM261」 — both
  arithmetically true against zero, both reading as a dramatic improvement when the previous
  week simply had not been logged. `comparableDomains()` now gates each domain on its own, and
  the same gate is applied to what the AI is handed.

### The AI Coach finally sees more than today
`buildSystemPrompt` was given TODAY and nothing else, so 「蛋白够不够」 could only be answered
about one day — the timescale on which the answer is meaningless. It now gets a `=== 本周 ===`
block of finished numbers from the same `computeWeekReview` the screen uses, so the two cannot
disagree. It is handed neither an incomparable comparison nor an average without its
denominator, and the comparison is labelled 「上周同期（前 N 天）」 so a partial week cannot be
described as a full one. No extra API call — same single request, more context.

### UI
- `WeekReview.jsx` — modal, week stepper (forward past this week blocked), the highlight
  sentences, six stats, and a footer stating what the arrows are measured against.
- Dashboard: a compact 本周 card above the day strip (higher-altitude question first), showing
  three numbers and the single most important sentence. Rendered only when the week has data.

### Tests — 928 total (49 new: 40 in `test-weekstats.mjs`, 32 in the new `test-bodyweight.mjs`,
replacing the 15 that covered the orphaned functions)
The partial-week clamp, the per-domain comparability case above, the "unchanged number records
nothing" rule, the baseline rule for weight (prefer the window's own first reading; reach back
only when the window cannot stand on its own), and every highlight rule's refusal to fire.

Verified live end-to-end against a hand-checked fixture (Tue 2026-08-25, so a 2-day week):
本周 card read 训练 2 天 · 蛋白 82g/天 · 花费 RM 49 — the RM49 confirming a RM450 rent bill, a
−RM800 arriving allowance and a RM200 transfer were all correctly excluded, while the modal's
六格 matched the hand calculation exactly (1025 kcal/天 over 2 天有记录, 24 组, 体重 67 → 66.6
↓0.4, ↑RM 9.00 against last week's CLAMPED RM40 rather than its full RM261). Stepping back a
week showed the per-domain fix working: the false comparisons gone, the arrows with them, the
footer explaining why, and every real number still present. The AI payload was captured with a
stubbed `fetch` — no API budget spent — and contained the week block verbatim.

## M51 — The money overhaul: five phases against a 14-point spec ✅ done

User handed over a 14-point rework of 记账, written up with ChatGPT, with
"大更新来的，好好检查". Checking it first was the right call: **four of his
complaints were already correct in the arithmetic and wrong only in how they
read**, and three problems he had not written down turned out to be worse than
the ones he had.

### Three bugs found while checking, none of them in the spec

**The repayment plan ignored every repayment.** `AccountsView` called
`getWaterfallOrder(accounts, debts, debtPlan)` — the fourth parameter,
`expenses`, was missing, so `debtOutstanding(d, [])` reported every debt at its
stated size. The 真实净值 card three lines above it *did* pass the ledger. Same
screen, same debt, two figures, and the waterfall's was always the larger one.
The function had taken that parameter and been tested on it since repayments
existed; only the call site lagged.

**Two separate 「每月还多少」, one of them decorative.** `debtPlan.monthly` (the
waterfall) fed `monthsToClear` and *nothing else* — typing in it changed no
budget and reserved no money. `debt.plan[cycleStart]` (本月) is the real one that
cycle.js holds back from the daily limit. Same words, same debt, and the one
that looked more prominent was the one that did nothing. Migration v5 folds the
decorative values into the real store.

**The app could read an instalment plan and could not create one.**
`buildSchedule` existed, was tested, and was called by nothing but its own test.
The debt form offered creditor / amount / note / due date — so every debt added
by hand became a flat lump sum, and the only schedule in the user's data got
there through a restored backup. Hence "SPayLater 不能只显示 RM1,864.28 然后叫我
一次还掉": it *is* an instalment plan, and the app had no way to say so.

### What was already right, and was only reading wrong

- PBE has never been counted as spendable — `computeNetPosition` excludes
  custodial balances by construction. What was missing was any screen leading
  with the number that *is* spendable.
- `grossSpentThisCycle` already excluded transfers, arrivals and repayments.
  The card just also printed `spentThisCycle` beside it, a *net* figure, so two
  different spend numbers sat side by side under similar labels.
- Debt repayments already fed the same `committed` total as rent. They were
  rendered in a separate section, which is why it didn't feel unified.

Reaching for a rewrite where the defect was a label would have been the
expensive way to make it worse.

### Phase 1 — 欠款 (points 3, 4, 10, 11)

`buildInstalments` / `rebuildSchedule` / `setInstalmentAmount` /
`removeInstalment` / `scheduleSummary` in `debts.js`; `buildSchedule` moved
there from `networth.js` (the waterfall now needs both it and
`remainingPlanThisCycle`, and a builder on the far side of that import would
have made the two files import each other). `buildSchedule` also gained
fortnightly/weekly stepping and month-length clamping — it rolled the 31st into
the next month four times a year, the same trap `recurring.js` documents.

The plan card splits 总欠款 from 本期应还 and labels how much choice each item
gives you (`分期·必须按期` / `你自己决定` / `补回储备金`). A scheduled debt gets
no "how much this month" input, because the amount and the date were set by
someone else.

**A destructive default caught in review:** the edit form first prefilled the
generator from the plan's next instalment — count 21, amount RM368.70 — which is
only coherent if every instalment is the same size. This user's are not. The
form opened previewing "21 期，总共 RM7,394.73" against a real debt of RM1,267.18,
and pressing 保存 without touching anything would have overwritten the true
schedule with that fiction. The generator fields now open empty and empty means
*leave the plan alone*; corrections happen in the row editor, which edits what
is actually there.

### Phase 2 — 现在能花 (points 5, 6, 7)

`computeSpendable`: own cash − this cycle's unpaid bills − this cycle's unpaid
debt. Deliberately **not** subtracted: custodial balances (never in `ownCash`),
the reserve shortfall (real, owed, and not due this month — folding it in parks
the figure permanently negative and teaches you to ignore it), a bill already
paid (the cash already moved), and a spread annual bill's monthly slice (this is
a cash figure; `charged`, not `budgeted`).

The reserve shortfall prints *beside* it, which was the user's own call when
asked: "两个都显示". 净值 survives as a footnote labelled as the all-in figure it
always was.

每日生存额度 demoted from a 2.2rem glowing card to a line — Module 1 of the
original firewall spec, and his verdict after living with it was "不要为了做一个
「看起来很专业」的数字，把系统搞复杂". Not deleted; it still stops one day eating
the month. It just stopped pretending to be the point.

### Phase 3 — 收入 and 固定月费 (points 1, 2)

`incomeSourceId` on an arrival joins 今天记收入 to 本月收入, which were two
systems that never met — you could log RM1,000 arriving and the month's income
would not move a sen. Per source: expect until something lands, then count what
actually landed. `Math.max` was the tempting rule and is wrong exactly where it
matters — an allowance RM200 short must shrink the month.

An arrival filed under nothing is **reported, not added**: it may well be the
salary already listed, and adding it would count the same ringgit twice. Naming
the gap is the fix; guessing at it is not.

`allocationId` on an expense says "this payment IS my rent" — and marks that
bill paid, because it is the same statement. It also closes a double-count that
had always been there: a logged bill payment was charged once as the
allocation's reservation and again as spending.

`essential: true|false` splits 固定开销 into 一定要付 and 可以砍, and 现在能花 says
what cutting the optional ones would free up. A flag nothing computes with is
decoration, and this module already had one of those.

### Phase 4 — 交易类型 (points 8, 9)

Six kinds — 支出 / 固定月费 / 还款 / 收入 / 别人还我 / 户口转账 — through one
classifier, `txType`, stored on the record by migration v6 and derived from the
old flags forever after (a record can arrive unstamped from an old backup or a
cloud merge long after any migration runs).

This is the fix for a *class* of bug rather than the next instance of it. The
kind of a record was previously re-derived at every call site from four optional
fields and the sign of the amount, and the sites drifted: 花掉的 excluded
repayments while the 钱去哪里了 chart did not (RM549.90 vs RM649.90 for the same
month, found while verifying Phase 1); the daily budget excluded transfers but
not arrivals and once handed out RM1,267.50 of headroom against an RM80 budget.

Three predicates, three questions, all stated on the one classifier:
`isRealSpend` (was this me buying something), `isDailySpend` (purchases and the
refunds that net against them — what a daily budget is about), `isSpendingRecord`
(did money leave my pocket, which includes bills and repayments).

### Phase 5 — 三个 Tab (point 13)

PBE appeared **four times** on one screen: as 代管·不能动 in the spendable card,
as its own account card with 目标/还差, as a 储备金进度 bar, and as 补回储备金 in
the plan. Debts appeared twice, in two lists with the same figures. The
standalone 储备金进度 section and the second debts list are gone — the plan's
rows *are* the debts list, each one opening its debt for editing.

### Tests — 63 new, 781 total, all passing

`buildInstalments` across monthly/fortnightly/weekly, an uneven final
instalment, and the 31st clamping to 28/30. `rebuildSchedule` keeping paid rows
so `statedRemaining` cannot jump back up. 本期应还 vs 总欠款 with a part-paid
cycle. `computeSpendable` against a hand-checked scenario (RM1,000 cash, RM500
essential + RM55 optional bills, a spread annual bill charging nothing this
cycle, RM368.70 + RM50 of debt → RM26.30 spendable, RM81.30 if the optional
bill goes). Income landing short, landing over, landing in two payments, and
landing unfiled. The bill double-count, before and after.

Verified live end-to-end against a fixture shaped like the real data: PBE
RM12,672.09 against a RM15,269 target, a 21-instalment SPayLater, a flat LCF
debt, a stale `debtPlan.monthly` entry. Every rendered figure matched the hand
calculation — 净值 −3,569.19 = 450.90 − 4,020.09; SPayLater 本期 RM268.70 =
RM368.70 instalment − RM100 already repaid, 总欠 RM1,167.18 = RM1,267.18 − RM100;
the v5 migration moving `debt:101 → 50` into `plan['2026-08-10']` and leaving
`reserve:pbe` where it was; v6 stamping all six records with the right type; a
back-dated repayment reducing the total while correctly *not* counting as this
cycle's 已还. No console errors.

### Pre-release check: the double-count fix had opened an under-count

Verifying the three scenarios the user named before release turned up a hole on
the other side of Phase 3. `allocationId` keeps a logged bill payment out of
`spentThisCycle` because the allocation already reserved it — which is right
only while the allocation really claims that much this cycle. Three ordinary
ways it doesn't, all losing money, all in the reassuring direction:

- **paying early.** A quarterly premium set to 'spread' reserves RM200 a cycle
  and charges RM0 until November. Pay RM600 in August and the reservation claims
  RM200, the payment claims nothing: RM400 leaves the month's accounting.
- **a bill that came in higher.** RM120 reserved, RM180 paid, RM60 gone.
- **a bill deleted after being paid.** The reservation is gone entirely, so every
  payment ever made against it silently stops counting.

Fixed with the rule `reservedForCycle` already uses for debts: hold back the
LARGER of what was planned and what was actually paid, and fall back to ordinary
spending when the linked bill no longer exists. `computeSpendable` got the same
treatment — it now derives what has been paid from linked records rather than
trusting the `paidFor` tick alone, so a payment restored from a backup cannot be
subtracted twice.

Also added while verifying: `后续分期` on the plan row (「下一期 2026-08-10 · 之后
还有 20 期，最后一期 2028-04-10」), and `type` stamped at birth by the entry form
and the notification capture rather than only by transfers and repayments.

### The three scenarios, run against a real-shaped fixture

1. **RM300 arriving, filed under 妈妈生活费** — 现在能花 RM27.20 → RM327.20,
   exactly +300. PBE untouched. The RM1,000 *expected* from that same source,
   still unarrived, never entered the figure.
2. **SPayLater** — 「这个周期一定要还 RM268.70」 and 「总共还欠 RM3,764.09」 as
   separate headline figures; the row reads RM268.70 large, 总欠 RM1,167.18
   small, 下一期 2026-08-10 · 之后还有 20 期. No input box, because the amount
   is not his to choose.
3. **An auto-captured NETFLIX.COM RM55 marked as the Netflix bill** — before
   marking, 固定支出 RM423.70 *and* 本周期已花 RM55: the same RM55 twice. After
   marking, 本周期已花 RM0 and 固定支出 unchanged. 现在能花 returned to exactly
   RM327.20 — the value before the charge existed, because cash fell RM55 and
   the commitment fell RM55. Paying a bill you had already committed to changes
   nothing about what is free, which is the invariant that proves there is no
   double count in either direction.

Tests 808, all passing.

## M50 — The update banner offered a button that does nothing ✅ done

User: "我的apk又出之前的问题只有重新载入都没有下载地方让我去下载覆盖你妹的 ...
最后把这里弄好，给我安装包我自己去更新".

The phone announced 有新版本 v1.2.6 and the only button under it was 重新载入,
which inside Capacitor does **nothing at all** — the WebView loads local bundled
files, so there is no newer copy to re-fetch. Same visible symptom as M44b, a
completely different cause.

### The manifest went out with `apk: null`

`UpdateBanner` picks its button as `native && apkUrl ? 下载 : 重新载入`. The
`apkUrl` comes from the hosted manifest, and the hosted manifest had no APK
block. Two independent ways that happened, both on the same afternoon:

1. **A deploy landed mid-release.** `npm run release` is `vite build` (writes a
   placeholder manifest) → ~60s of Gradle → rewrite the manifest with the real
   APK. Deploying inside that window publishes the placeholder. The live
   `buildAt` was `06:00:10.248Z` — the web build's timestamp, with the release's
   own notes and APK missing, which dates it precisely.
2. **A later `vite build` wiped it again.** Vite empties `dist/`, taking
   `dist/downloads/` with it, and the placeholder overwrote the good manifest.
   This one came from a *different agent session* running a build in the same
   working tree at 14:03.

The root cause is not either accident. It is that `dist/` is deployable at every
moment of its life, and it spent most of its life describing an update it could
not deliver.

### The manifest is now derived, not staged

`scripts/manifest.mjs` is the single writer. Notes come from
`RELEASE_NOTES.json`; the APK block exists if and only if a built APK
**declaring this exact version** (read from Gradle's `output-metadata.json`, not
assumed from `package.json`) is on disk, and writing the manifest stages that
APK into `dist/downloads/`. So a plain `npm run build` now produces the same
complete, truthful manifest a release does — there is no placeholder state left
to publish.

`build-apk.mjs` clears `dist/downloads/` before `cap sync`, or the new APK would
embed the previous one — 4.5 MB of the last release riding inside every build.
It owns the `cap sync` call now so that clearing can't be bypassed.

### And the deploy itself refuses to publish a lie

`firebase.json` gained a `predeploy` hook: `scripts/check-release.mjs` blocks the
deploy when an APK for this version exists but the manifest doesn't name it,
when the manifest points at a file that isn't in `dist/`, or when the notes
vanished. Run against the broken tree that caused this milestone, it correctly
refuses.

### The app stops announcing updates it can't take

`evaluate()` now takes `native`, and a newer version with no `apkUrl` returns
`{ available: false, reason: 'no-apk' }` instead of an update. The banner's dead
fallback button is gone — on native it shows the download link or nothing.
'up-to-date' and 'no-apk' both carry the manifest now, which lets the settings
sheet host a **permanent 下载安装包 link**: the only way to get the APK used to be
a banner that appears on its own terms and hides itself again, which is exactly
what the user was asking for a way around.

## M49 — Sync said "已连线" and moved nothing: four bugs behind one symptom ✅ done

User: "那个资料互通还是很有问题 我电话永远没有我电脑的数据即使我按了立即上传 ...
是firebase的问题吗还是我的database structure有问题".

Neither. Firebase was fine, `firestore.rules` was fine, the Firestore layout was
fine. The sync engine was comparing two different clocks, and three smaller bugs
kept anyone from noticing which one was broken.

### 1. The pull filtered on the event clock (the fatal one)

```js
const q = s.query(collPath(s, name), s.where('at', '>', since));   // since = lastSyncedAt
```

`at` is the **event** time — when the meal was eaten, when the payment happened.
It is always in the past and it deliberately never moves. `lastSyncedAt` is wall
clock, and **both directions wrote it**: `pushNow` set it to `Date.now()` on
success. So the first push a device made moved its watermark to "now", and from
that moment Firestore filtered out every record the other device had ever
written — an expense from yesterday can never have an `at` greater than today.

`attachAuthListener` schedules a push 2.5s after sign-in, so the phone locked
itself out of the PC's data before the user could touch anything. Nothing threw.
The panel said 已连线. Edits were doubly invisible: an edit bumps `updatedAt` and
leaves `at` alone, so the query could not see one at all.

Fixed: every document now carries `syncedAt` (upload time), pulls filter on
that, and the two directions keep separate watermarks — `sync:lastPushedAt` and
`sync:lastPulledAt`.

### 2. `pushNow({ force: true })` — against a `pushNow()` that took no arguments

Both 立即上传 and 用这台覆盖 passed it. JavaScript accepted the call and dropped
the object on the floor, so the override had always been an ordinary incremental
push — and an incremental push with nothing to send returned early having
written nothing, updated nothing, and reported nothing. Pressing it repeatedly
was genuinely a no-op, exactly as it felt. `force` now exists.

### 3. The download button hid itself in the failure mode

载入云端 only rendered inside the 「云端有较新的资料」 banner, and that banner was
driven by the same broken watermark — plus a marker document that remembered
only the **last** writer, so the phone pushing after the PC made the phone read
its own device id and conclude "that was me, nothing to fetch". So the one
button that could have fixed it disappeared precisely when it was needed, and
立即上传 was the only thing left to press. The marker now keeps a last-push time
**per device**, and both directions are on screen at all times with the
direction written under each: 这台 → 云端 / 云端 → 这台.

### 4. Meta documents were replaced, not merged

`readMetaDoc()` returns only the keys the device actually has, and `set()`
without merge replaces the whole document. A phone that had never opened the
accounts screen therefore uploaded `meta/accounts` as `{}` and **deleted the
PC's accounts from the cloud** — after which the PC never re-sent them, because
its own fingerprint hadn't changed. Now merged on the way up, and on the way
down guarded by `hasUnpushedMetaChanges()` so a pull can't overwrite local edits
that haven't gone up yet.

### Migration

`SYNC_SCHEMA_VERSION = 2`. Documents already in the cloud have no `syncedAt`,
and a Firestore inequality filter silently **excludes** documents missing the
field — so the first pull after this update reads whole collections instead of a
filtered slice, and the first push re-uploads every record to stamp them. Both
are automatic, idempotent, and one-time.

`meta/*` documents are deliberately **not** swept up in that: a pull never
filters them on `syncedAt`, so there is nothing about them to migrate, and a
blanket resend would hand whichever device launched last the power to overwrite
the other's settings with an older copy. What the migration push does instead is
**repair**: it reads each meta document and re-sends only the keys the cloud has
lost — the fingerprint on a device holding the surviving copy never changed, so
that device would never otherwise offer it back. Launching the PC first is still
worth doing, since it holds the newer copy of most of them.

Also added: 全部重新同步 (force push then force pull) as a permanent escape
hatch, and a result line under the buttons — 已上传 N 项 / 这台没有新变动 — because
a push that silently did nothing was indistinguishable from one that failed.

`test-sync.mjs` grew a regression check per bug, including static ones asserting
that no pull filters on `at` and that options the panel passes are options the
function actually reads.


## M47 — Full-project audit before real use: four bugs that all failed quietly ✅ done

User: "认认真真仔仔细细的检查我整个project ... 我要开始使用了，我要他是成熟的".
A read-everything pass over `src/`, the sync layer, the build and the docs,
followed by driving the running app against a seeded dataset built specifically
to trip the paths under suspicion. Everything found had the same shape: **no
error, no crash, a plausible-looking number on screen, and the wrong answer.**
That is the only failure mode that matters in an app whose entire job is to be
believed about money.

### 1. An allowance landing made the app think you'd spent minus a thousand ringgit

The worst of them, and it was live. A refund and an arrival are both stored as a
negative `amount` — a refund because it must net against spending already
logged, an arrival (生活费, salary, a top-up) because it credits an account
balance. Only `isMoneyIn` separates them.

`cycle.js` argues this out at length and gets it right for the monthly budget.
The **daily** budget never got the same treatment: every "today's spend" site
filtered `isAccountTransfer` and stopped there. Seeded with a RM 1,200 allowance
and RM 12.50 of real spending against an RM 80 daily cap, the running app said:

```
今天花了 RM -1,187.50 · 还可以花 RM 1,267.50
```

RM 1,267.50 of headroom, from a spending firewall, on the day money arrives —
which is precisely the day it most needs to say stop. Four screens showed it
(Overview summary, Overview money card, 记账 → 今天, and CycleView's
「今天还可以花」), and the midnight rollover wrote the same figure into `history`,
which is never recomputed.

Fixed by naming the question once — `isSpendingRecord(e)` in `accounts.js` — and
using it at every site instead of each one hand-rolling the filter. `cycle.js`'s
`spentToday` had the same hole and is now derived from `realMovement`, which
also means a past cycle no longer reports today's spending as part of itself.

### 2. 「差额我自己记」 saved, displayed as saved, and did nothing

Shipped in 1.2.3. `AccountsView` wrote `autoShortfallDebt`, `networth.js` read
it — and `normalizeAccount()` deleted it in between, on every single read.

The flag was invisible for a subtle reason worth writing down: `normalizeAccount`
builds a new object field by field rather than spreading `...a`, which is the
right call (an unknown field from a future build must not reach the balance maths
pretending to be one of ours) but makes an omission completely undetectable. The
UI looked correct because the edit form reads raw storage, not the normalized
copy. And because every account edit writes the normalized list straight back,
the flag was destroyed on disk the first time any account was touched.

`test-networth.mjs` covered the feature and passed throughout — it calls
`computeNetPosition` with hand-built account objects that never go through
normalization. The new coverage in `test-accounts.mjs` goes through
`resolveAccounts`, which is the path every screen actually uses.

### 3. The app never noticed midnight

Three separate `useMemo(..., [])` calls froze the date at mount:

| where | what stopped moving |
|---|---|
| `Dashboard` | the 7-day strip, and which pill counts as 今天 |
| `CycleView` | the entire payday cycle, including `daysRemaining` — the divisor for the daily safe limit |
| `App.jsx` | the survival banner's 还有 N 天才发薪 |

On a desktop tab you would get away with it. This ships as an APK, where "the
app was never actually closed" is the normal state — the WebView is suspended and
resumed for days. `App.jsx`'s rollover already re-checked the date on a timer and
on `visibilitychange` for exactly this reason; these screens simply had no way to
hear about it. Left open across the 10th, CycleView kept budgeting the previous
cycle.

`useToday()` in `storage.js` now owns the question, using the same two signals.
It returns the identical string when nothing changed, so it can tick once a
minute forever without causing a render.

### 4. One malformed record turned every total into NaN — permanently

`reduce((s, x) => s + x.field, 0)` is the right shape for this app (it is why a
refund nets correctly everywhere without each call site knowing refunds exist),
but a single record with a missing number makes the **whole** total NaN, not just
its own contribution. A hand-edited row, a backup from an older build, or a cloud
merge from a device on a different version is enough.

It would be survivable as a display glitch. It isn't one: the midnight rollover
writes the day into `history`, `history` is never recomputed, and `computeLevel`
sums it — so `LV.NaN` also wedges levelling for good, since `level > lastSeenLevel`
is false forever.

`utils/num.js` (`num`, `sumBy`) now backs every summed figure and every rendered
amount. Verified against deliberately broken records: a meal with no `calories`
and an expense with no `amount` cost exactly themselves, and a legacy history row
with no fields at all renders `0 XP · 0 kcal · RM 0.00` instead of
`undefined kcal · RM NaN`.

### Sync: edits never left the device, and a restore made two devices invisible to each other

Both latent rather than live — sync is configured but not yet in daily two-device
use — and both would have bitten on first real use.

**Edits were pushed never.** Change detection was `(r.at ?? 0) > since`, and no
edit path in the app has ever touched `at`. A record was uploaded exactly once, at
creation; every later correction was invisible to the other device. `at` cannot
simply be bumped on edit — `movementSince()` compares it against an account's
reconcile watermark, so that would drag an old expense across the watermark and
subtract it from a balance that already accounted for it. Edits now stamp a
separate `updatedAt`, and `touchedAt()` takes the later of the two. The existing
test encoded the intended behaviour by hand-bumping `at`, which is why it passed.

**Export-on-PC, import-on-phone cloned the device id.** Exactly the flow SETUP.md
prescribes. `watchMarker()` skips a remote change whose `deviceId` matches its own
("that was me"), so two devices sharing an id permanently ignored each other: no
「云端有较新的资料」 prompt, ever, on either side. `deviceId`, `lastSyncedAt`,
`cloudSyncEnabled` and the `sync:*` bookkeeping are now skipped in both
directions.

**`chats` was declared a synced collection and had no ids**, so `diffCollection`
filtered every message out and the collection silently never synced at all.

### Smaller things, same character

- **Record ids could collide.** `Date.now()` twice in one millisecond gives two
  records one id — one delete button, one edit, and one Firestore document for
  both. `makeTransfer` already worked around this by hand with `at + 1`;
  `newId()` generalises it.
- **The backup nag ignored you.** `Header` read the staleness once per mount and
  never unmounts, so exporting left 「只存在这台 — 按我备份」 in warning orange
  for the rest of the session. Acting on a warning and having it ignore you is
  how a user learns to ignore it back.
- **「已花 RM -1,087.50」.** `spentSinceOpening` is net movement, not gross
  spending; the sign now picks the word.
- **「代管的钱没有算进净值 — 那不是你的。动用的。」** — a dangling sentence
  fragment, because the shortfall clause was optional in the middle of it. Now
  reachable in normal use, since an account can switch the shortfall off.
- **The Gemini model id was a bare constant.** Its correctness has an expiry date
  nobody here controls; when Google retires it, every AI feature dies at once
  behind `AI 请求失败 (404)` and a wall of JSON. Now overridable via
  `VITE_GEMINI_MODEL`, with 404/401/403 spelling out what to change — and those
  three refund the daily quota, since a misconfiguration used to eat all 40 calls
  in a few frustrated taps and then claim the budget was spent.
- **Dashboard parsed `new Date("2026-08-20")`** — UTC midnight read back through
  local getters. Correct at UTC+8, wrong by a day west of UTC, and the one place
  in the app not already careful about this.

### Startup weight: 922 KB → 579 KB

Recharts is ~400 KB, the largest single dependency, and it was in the main chunk
for one chart that renders only inside a live training session and only once the
same exercise has been logged on two different days. Split into
`WeightTrendChart.jsx` behind `React.lazy`. Verified loading and drawing on
demand. Also removed the one lint error in the repo (`process` in
`vite.config.js`) and a redundant dynamic import; `npm run lint` is now clean.

### What was checked and left alone

`tngParser.js`, `foodDb.js`, `workoutPlan.js`, `recurring.js`, `impulse.js`,
`streak.js`, `weekStats.js`, `updates.js` and the native capture path all read
correctly and are well covered. `firestore.rules` is default-deny and scoped to
`request.auth.uid`. The Firebase and Gemini keys in the bundle are client keys by
design — the rules and the API-key restrictions are what protect the data, not
secrecy of the config.

### Still needs the user

Nothing here can be verified from this machine: signing in for real, installing
the APK, and confirming a live notification capture end to end.

## M47 — Two kinds of debt, and one circle for the whole month ✅ done
User: "可以不要写每个月还吗就是改成我想还多少，但是可以记录下这个月我还了多少，
而spaylater就是每个月都扣那个数，除非我提早还... 本月还很粗糙，我希望本月有个
pie chart可以让我知道我的钱去哪里了".

### The model was forcing one shape onto two different things
A debt with an instalment plan (their real one: SPayLater, 21 instalments,
RM1,164.58 outstanding) and money owed to a person are not the same object. The
first has an amount decided FOR you; the second has no monthly figure at all
until you decide one, and next month you may decide differently. The app only
understood the first, so a flat debt could not record a partial repayment in any
way — the only route was hand-editing `amount` down, which destroys the fact
that a payment happened and makes "这个月我还了多少" unanswerable.

Now: `schedule` present = fixed, absent = flexible with a per-cycle `plan`
keyed by cycle start (the same shape a variable allocation's `actuals` uses, so
this month's decision says nothing about next month's). A repayment is an
ordinary expense carrying `repaysDebtId` — the decision projects.js already
made, for the same reason: account balances, history, sync and backup keep
working untouched, and outstanding becomes derived rather than stored.

### The part that had to be asked, not assumed
Whether a repayment eats the daily allowance. The answer was neither of the
options offered: "月头就先拿一笔钱还这个月的,然后再让我这个月的今天还能花多少
变少,是每一天花的钱变少". Reserve it at the top of the cycle and spread it thin
— which is exactly what `committed` already does for rent. So repayments join
that mechanism instead of getting a parallel one, and the direct consequence is
that the actual payment must be excluded from `spentThisCycle`: it was already
subtracted when it was reserved. Charging it again would subtract the same
ringgit twice, in the direction that makes paying off debt look like a blowout.

Verified end to end in the browser, not just in unit tests. Setting 阿明 to
RM200: 固定支出 1,338.30 → 1,538.30, daily allowance 78.30 → 68.77 (200 spread
over 21 remaining days). Then logging the RM200: allowance stayed 68.77, 本周期
已花 stayed 217.49, the debt dropped 500 → 300, TNG balance dropped by 200, and
总欠款 followed on the other screen.

`reserved` is max(planned, repaid), so paying MORE than planned — the only
lever a fixed schedule gives you — is reflected rather than under-counted.

### 钱去哪里了
The cycle screen already had a category breakdown, and it answered a narrower
question than anyone asks. Rent, bills and a SPayLater instalment are the
biggest things that happen to this user's month and they lived in a different
section, so a chart of "where did it all go" showed the small half.

One donut now covers the whole cycle's income: every fixed commitment, every
debt reserved, every category spent, and — the slice that makes the others
legible — what is still unspent. A pie of spending alone only ever says "100% of
what you spent", which is true every month and says nothing. Geometry verified
against the rendered SVG: nine arcs summing to exactly the circumference,
contiguous, no overlap.

## M46 — Auto-capture was catching everything and recording nothing ✅ done
User: "刚刚我有一笔自动扣钱他没记录", then a screenshot that settled it in one
look — **总共收到过 7 则通知 · 最后一则 4 分钟前**, sitting directly above a capture
log that read **还没收到过通知。** The first number is written natively, the second
by JavaScript, and the JS log records *every* capture including the ones judged
to be ads. Seven in, zero across. Not "unreliable" — nothing had ever made it.

### The listener was never the problem
Worth stating plainly because the user's own instinct was to make the app harder
to kill: **capture already worked with the app closed.** Those 7 arrived while it
was shut. `NotificationListenerService` is bound by the system and rebound after
a kill, so it does not need the app alive — which makes foreground services,
wake locks and battery-optimisation prompts all the wrong fix. What was broken
was the handoff, and it broke two ways at once.

**1. Capacitor drops events nobody is listening to.** `notifyListeners(name, data)`
returns early when the event has no registered listener unless the three-argument
form passes `retainUntilConsumed` (confirmed in `@capacitor/android`'s own
`Plugin.java`, not assumed). The JS listener lived inside `TngAutoCapture`, which
renders only on Money → 今天. Pay for something while looking at any other tab —
which is every time, because you are looking at your wallet app when you pay —
and the payment was captured, counted, and thrown away. The native side skipped
its own buffer in this case, because the plugin reference was non-null.

**2. The buffer was in RAM.** The path that did buffer used a static
`ArrayDeque` in the app's own process. Closing the app erased it, and so did any
OEM battery manager.

Both are gone. Every capture is now written to SharedPreferences with `commit()`
the instant it arrives, and JavaScript pulls it through `drainPending()` — one
delivery path, which is also why there is no de-duplication problem to solve. The
live event is now a content-free ping; losing one costs nothing because the next
drain still finds the item. Draining happens on subscribe, on the ping, and on
app resume. Capture is wired up at the app root (`hooks/useTngCapture.js`), not
inside a screen.

### Three parser bugs, found by running the user's four real notifications
- `/已扣(除|款)/` required 已 and 扣 to be adjacent. Real Chinese puts the whole
  wallet between them — "已从您的 TNG eWallet 余额中扣除" is 19 characters of it —
  so **every Chinese auto-debit** fell through to `unknown`. The English
  equivalent had been covered all along.
- `已支付了?` could give up its optional 了 and capture 了 *itself* as the name, so
  an RM4.00 parking charge was logged to a merchant called 了.
- "已支付给 Google ChatGPT…" put the payee before a line break, and the terminator
  only accepted punctuation — merchant came back null, so a RM23.99 subscription
  needed typing in by hand.

All four notifications are now fixtures in `scripts/test-parser.mjs`, verbatim.

### The app now checks itself
The diagnosis came from comparing two numbers the app already had and never
compared. It compares them now: `capturedTotal` (what the phone gave us) minus
`deliveredTotal` (what JS took) minus `pendingCount` should be zero, and anything
else is stated in the UI as "手机收到 N 则，app 只拿到 M 则". Also fixed while in
there: unrecognised notifications carrying an amount now go to 待确认 instead of
only into a log behind a button, and a capture that has waited days is dated from
when it was paid, not from when the app got round to reading it.

## M48 — The repayment plan becomes the user's, and a wiring audit ✅ done
User: "还款方式给我自己自定义吧，可以给我提示什么的但是最后还是让我自己来吧" — and
separately, on PBE: "再设计过吧".

### The waterfall was presenting a suggestion as an answer
`getWaterfallOrder` hard-sorted smallest-first with no way to disagree. That
order was never a calculation of what's cheapest — it's the momentum argument
in the function's own header — so rendering it as *the* plan overstated it.

Now it takes an optional `plan`:
- **Custom order** wins; anything unranked keeps its suggested position and
  lands after the ranked items, so a debt added later can never silently drop
  off the plan or force a full re-ordering just to be seen.
- **`suggestedRank` rides on every item** so the UI can still show what the app
  would have picked — "建议排第 3" next to an overridden position. The hint
  survives the override instead of being replaced by it.
- **`monthsToClear`** from a per-item monthly amount the user types. The app
  divides; it does not propose a figure. Rounded **up**, because a final
  part-month is still a month you're paying in.
- `moveInOrder` seeds from the **rendered** list, not the stored order — a
  stored order can be empty or partial, and reordering from it would move an
  item relative to a list the user isn't looking at.

Fixed while here: the last item's `remainingAfter` rendered as `-RM 0.00`,
floats subtracted down from a float total.

### PBE: opting out of a derived debt
`autoShortfallDebt: false` on an account stops `target − balance` counting as
owed (and removes it from the repayment plan, or the plan would total more than
`totalOwed` says exists). Default stays true — nothing changes for an account
that hasn't asked.

The reason is that deriving debt from a balance only tells the truth when the
balance moves for one reason, and PBE's does not: an allowance of varying size
lands in it, rent leaves it, spendable money is transferred out, and a salary
parks there in transit. Against that, the shortfall swings meaninglessly — an
allowance arriving makes the reserve read 已经补满了 the day before RM 2,000 of
it goes to a landlord. Their words: "pbe很多我不能懂的钱我自己记录最好".

### Wiring audit — "有什么没关联的"
Scanned for exports nothing imports, persisted keys nothing registers, and
computed fields nothing reads. Most hits were false positives (used within
their own file). Three real findings:

1. **The sync-completeness scanner had a blind spot.** It matched only
   `usePersistentState`/`useLiveJSON`, but `saveJSON`/`loadJSON` is a real
   persistence path here — `useTngCapture.js` writes the capture log through it
   from outside React, where a hook can't run. A key introduced only that way
   would never have been checked. Nothing was actually unregistered (every such
   key is also read via `useLiveJSON`), but the gap pointed in exactly the
   direction this test exists to guard, which is how M27 happened. Pattern
   widened; still passes.
2. **`Dashboard.jsx` passed `[]` as its debt list** to `computeNetPosition`.
   Only `ownCash` is read there and that's debt-independent, so it was correct
   today — but every other field on the result was silently rosy, and reaching
   for `totalOwed` later would have looked entirely reasonable. Same shape as
   M46. Now passed the real debts.
3. **No catch-all route.** An unmatched hash rendered the shell with an empty
   content area — header and nav present, nothing between them. Reachable in
   the APK specifically, where the WebView restores the last hash across an
   upgrade, so a route removed in a new version drops a returning user onto
   what reads as a crash. Added `path="*"` → `/dashboard`, verified live.

Also removed `plannedMonthly` from the waterfall result: computed, read by
nothing, and a second copy of a value the form already owns.

### Tests — 8 new in `test-networth.mjs` (65 → 73, plus 12 earlier this session)
Order override, the suggestion surviving it, the staircase recomputing for the
new order, no-op at both ends, an unranked new debt still appearing, rounding
up, and — for the opt-out — that explicit `true` and absent behave identically,
so opening the edit form on an existing account can't silently change its debt
total.

## M47 — 进账: money arriving, without lying about your budget ✅ done
User: "你也需要给我一个手动可以写pbe进多少，还是其他银行进多少的地方". Their real
monthly flow turned out to be: dad's RM 2,500 allowance lands in **PBE**, RM 2,000
goes straight to the landlord, RM 500 moves PBE→TNG, the internship's RM 1,000
also lands in PBE, and five friends repay into TNG.

Nothing in the app could record any of the arrivals. The three existing paths
each answer a different question:
- **记一笔 / 我出的钱** — money leaving.
- **别人还我** — a refund. Stored negative so it credits the account, but it
  also **nets against `spentThisCycle`**, which raises the daily safe limit.
- **户口转账** — a linked pair between two accounts you already hold.

So the only way to credit PBE was 别人还我, and that is wrong in a way that
matters: logging the RM 1,000 salary landing in PBE would have told the user
they could spend RM 1,000 more this month — money sitting in a **custodial
account they cannot spend from at all**. The firewall would have loosened
itself by RM 3,500/month on inflows that never reach a spendable account.

### The flag, and why it is budget-neutral
`isMoneyIn` — stored negative like a refund, so account balances credit through
the same `derivedBalance` path with no new machinery. But `cycle.js` excludes it
from `spentThisCycle` *and* from `realMovement`.

The reasoning is the same one M21 used to keep one-off receipts out of
`incomeSources`, pointed the other way. A refund returns money from spending
**already counted in this cycle**, so netting it is right. An arrival is not
that — its budget effect is already owned by `incomeSources`, which is summed
into every cycle unconditionally. Letting it net would count the same ringgit
twice, once as income and once as negative spend.

### UI
"这笔钱怎么动的?" becomes three-way: 我出的钱 / 别人还我 / **钱进来了**. Held as
one `formDirection` enum rather than a second boolean, so "refund AND arrival"
is unrepresentable; `formRefund` is derived from it (`!== 'out'`) so every
existing incoming-side label kept working untouched. Reopening for edit reads
the flag, not the sign — both incoming kinds are negative, and an arrival
reopened as a refund would start netting on save. The project dropdown is
hidden for arrivals, which repay nothing.

### Tests — 6 new in `test-cycle.mjs` (48 → 54)
The load-bearing one compares daily safe limit with and without a RM 1,000
arrival and asserts they are **identical**. Plus a refund and an arrival on the
same day, since both are stored negative and only the flag separates them.

### A real defect this caught in the user's own setup file
Verifying live, PBE would not move. `openingAt` had been written as
`2026-08-20T00:00:00Z` — **08:00 Malaysia, six hours in the future**. Balances
only subtract expenses logged *after* that watermark, so everything recorded
before 8am today would have silently failed to move any balance. Re-stamped to
local midnight. Re-verified: PBE 12,803.29 → 15,303.29 on a RM 2,500 arrival,
reserve reads 已经补满了, net position −RM 1,436.38, and the survival banner
correctly stayed at RM 83.90.

## M46 — The survival banner was stuck on forever, and nobody could tell ✅ done
Found while rehearsing the user's real account import (2026-08-20). The banner
read **可动用现金只剩 RM 0.00** while the Money tab's own panel, on the same
screen, read **RM 83.90** from the same data.

`App.jsx` did `computeNetPosition(accounts, debts)` on `accounts` straight from
`useLiveJSON('accounts')` — the **raw stored** array. But `balance` is derived
and never persisted (rule 1 of the accounts model, `accounts.js`), so those
objects carry `openingBalance` and no `balance` at all. `computeNetPosition`
summed a column of `undefined` → `ownCash` was **exactly 0 on every render,
forever**, which pinned `inSurvivalMode` permanently true no matter how much
money was actually in the accounts.

**Why this was invisible.** It failed in the *alarming* direction, and the app
is supposed to be alarming — a red survival banner on a cash-strapped student's
budget app looks like the feature working. Nothing rendered an error, no test
covered the App-level wiring, and until now the seeded state was a single TNG
account at RM 0.00, where "0.00" happened to be the correct answer. The moment
real balances went in, the two figures disagreed on screen and gave it away.

It also means **module 3 of the firewall spec has never actually worked** —
`SurvivalBanner.jsx`'s own header promises it "only stops showing once
`ownCash` genuinely rises above SURVIVAL_THRESHOLD", and it could never stop
showing. An alert that is always on carries no information.

**Fix**: `resolveAccounts(accounts, allExpenses)` first, then
`computeNetPosition` on the resolved array.

### Tests — 5 new in `test-networth.mjs` (44 → 49)
Deliberately asserts the *wrong* behaviour too — raw accounts giving `ownCash: 0`
and a false survival flag on RM 800 of real cash — so the trap is documented
next to the fix rather than just silently corrected. Plus a spending case, to
prove `resolveAccounts` isn't merely echoing `openingBalance` back.

Verified live: banner now reads RM 83.90, matching the panel below it, and is
in survival mode for the real reason (83.90 < 300) rather than by accident.

**Not shipped yet** — this is source-only, so installed copies still show the
stuck banner. Rides with the next release alongside M45's `email-already-in-use`
message.

## M45 — Sync gets an account, and the two bugs that meant it never worked ✅ done
User: "云同步好像一直有问题你要不弄个用户出来吧". Cloud sync had been code-complete
since M25 and had still never once completed on a real device. Going looking for
why turned up **two independent bugs, either one fatal on its own** — so the
answer to "would this need changing a lot of things" was: barely anything, and
the account was only half the fix.

### Bug 1 — the auth listener was never attached on the first-ever sign-in
`onAuthStateChanged` was wired in exactly one place: `init()`. But `init()`
returns early when sync is switched off, which is the state of **every device
that has never signed in**. So the first sign-in succeeded at Firebase and then
landed nowhere — no listener meant `state.user` stayed `null`, so `watchMarker()`
and `schedulePush()` never ran, and the `CHANGE_EVENT` push handler (which tests
`state.user`) ignored every subsequent edit. The UI still showed the signed-out
button, as if nothing had happened. Sync only came alive after a manual reload,
by which point `cloudSyncEnabled` was true and `init()` no longer bailed.

The redirect sign-in path accidentally papered over this — it navigates away and
reloads — so it only ever bit the **popup** path, i.e. every desktop sign-in.
That is very likely the whole of "云同步好像一直有问题" on the PC side.

Fixed by extracting `attachAuthListener(s)`, idempotent via a module flag, and
calling it from `init()` **and** from every function that can authenticate.

### Bug 2 — Google sign-in cannot work inside the APK, at all
Two independent blockers, either one fatal:
1. Google refuses to serve its OAuth consent screen inside an embedded WebView
   (`disallowed_useragent`). That's a deliberate anti-phishing policy, not a
   bug, and no Capacitor flag turns it off — `signInWithPopup` is simply dead
   on Android.
2. The popup-blocked fallback, `signInWithRedirect`, then fails for a *separate*
   reason: the Capacitor shell runs on `https://localhost`, a different origin
   from the Firebase `authDomain` the redirect returns through, so the
   credential never makes it back into the app.

So the phone never had a working sign-in path — the button was decorative.
Fixing it *as Google* would mean a native auth plugin plus SHA-1 fingerprint
registration; a lot of moving parts for a single-user app.

### Email/password instead — and why it's a small change
`signInWithEmail` / `registerWithEmail` / `sendPasswordReset` in `cloudSync.js`.
Email/password is a plain HTTPS call to Firebase's identity endpoint: no browser
handoff, no second origin, nothing to mismatch, identical behaviour in the
WebView and on the desktop.

Everything downstream is untouched, which is the point — the sync engine and
`firestore.rules` only ever ask for `auth.currentUser.uid`, and an
email/password account has one in exactly the same shape as a Google account.
**Zero changes** to `firestore.rules`, `syncModel.js`, the push/pull engine, the
schema, or the avatar code (which already fell back to the first letter of the
email, since `photoURL`/`displayName` are null for this provider).

New shared `AuthForm.jsx`, used by both `LoginGate` (first launch) and
`SyncPanel` (备份 → Sync) — two entry points that had been drifting apart with
their own copies of a Google button.

**Google is kept on desktop, where it genuinely works, but hidden on native via
`isNativePlatform()`** rather than shown-and-broken. It's demoted to a small
secondary link for a reason beyond looks: two devices signing in through two
different providers get two different uids, and since the uid *is* the data
path, that reads to the user as "sync silently does nothing". Steering both
devices down the same path is what keeps them on one account.

Error messages are the other half of usability here. Firebase deliberately
collapses "wrong password" and "no such account" into one `invalid-credential`
(so nobody can probe which addresses exist), which means a first-time user
hitting a form gets "email or password is wrong" for an account that was never
created — a dead end. That message now points at 注册. Conversely
`email-already-in-use` points at 登入, because the second device registering
again would create a second uid, i.e. silent non-sync.

### Tests — 7 new in `test-sync.mjs` (20 → 27)
Every new error code, including that the two legacy codes collapse onto the same
message as `invalid-credential`, and that rate limiting reads as temporary
rather than as a permanent lockout.

Verified live end-to-end against the real Firebase project. A deliberately bogus
sign-in confirmed the whole chain — form → lazy SDK load → real network call →
`describeError` → rendered message — and surfaced a genuinely useful fact: the
**Email/Password provider is not enabled in the Firebase Console yet**, and the
error says exactly where to flip it. Bug 1's fix was proved decisively by
recording status transitions from a fresh page load with `cloudSyncEnabled`
null: `["off", "signed-out", "error"]` — that middle `signed-out` is
`onAuthStateChanged` firing, a transition that could not have existed before.
Also caught and fixed a duplicated footer paragraph rendering twice in the Sync
panel. Tests all pass, lint clean on changed files, build clean.

### Provider enabled, and this shipped inside someone else's release
The user enabled Email/Password in the console straight after. **Confirmed by
observation, not by taking it on trust**: the same bogus sign-in that had been
returning `auth/operation-not-allowed` now returns `auth/invalid-credential`,
which is what an *enabled* provider says about an account that doesn't exist.

A concurrent session was working in this same folder throughout (the TNG capture
fixes), and it bumped to 1.2.2, ran `npm run release` at 22:20 and deployed.
Because the auth work above landed at ~18:25, **it was already inside that build**
— so email/password sign-in is live on both the web app and the 1.2.2 APK
without a separate release. Verified directly rather than inferred from
timestamps: the deployed bundle and the APK's copy of it are the same file
(`index-qfw20uGs.js`), and it contains both the AuthForm string and
`signInWithEmailAndPassword`. 1.2.2's release notes don't mention any of it,
which is the one cosmetic cost of the overlap.

**Deliberately not re-released**: one late tweak (the `email-already-in-use`
message, below) is still only in source. Rebuilding 1.2.2 in place would ship an
APK that no installed copy would ever be offered — the update check compares
versions and would call it "already up to date" — so it rides along with
whatever ships next instead of forcing a redeploy for one string.

### The Google-account trap, closed
Firebase keeps one account per email address, so registering with an address
that has already signed in with Google is refused — and the obvious advice
("sign in instead") dead-ends too, because that account has no password. The
reset link is the only way in, and it attaches a password to the **same uid**,
which is what matters: the uid is the data path, so this recovers any data
already synced under that account instead of stranding it. The
`email-already-in-use` message now says so. (28 sync tests; the new one asserts
the message names 忘记密码, not just 登入.)

**Left for the user**: register once in the app — creating the account and
typing the password is theirs to do.

## M44 — The app can tell you there's a new version ✅ done
User: "能不能做成自动update，就我在我的app自动侦测有没有update".

### What auto-update can honestly mean here
The app ships as two things that update by completely different mechanisms, and
one banner pretending otherwise would have a button that does nothing on one of
them:

- **Web / PWA** — the service worker already downloads a new build in the
  background. By the time it reports ready, the new version is *on the device*;
  all that's left is swapping it in, which one tap does. This genuinely is
  automatic.
- **Android APK** — sideloaded, not from the Play Store, so nothing updates it
  by itself. Android also **will not** let an app silently replace itself; the
  package installer always asks, by design, and no permission unlocks that. So
  the honest feature is *detect automatically, download in one tap*, and let
  Android ask the last question. The UI says exactly that rather than implying a
  silent update it cannot deliver.

### `src/utils/updates.js` (new, pure, 41 tests)
Version compare, manifest parsing, what-to-show, and check throttling — all
pure, because every failure mode here is silent ("the app just never told me")
and only a test catches those.

- **`compareVersions` is segment-wise numeric.** A string compare puts `1.9.0`
  above `1.10.0`, which would hide every update for as long as the minor stayed
  in double digits. Tested against exactly that case, next to a demonstration of
  the wrong answer.
- **Dismissal is per-version.** Saying "later" to 1.2.0 must not also silence
  1.3.0 — that is how an update prompt quietly stops working forever.
- **A failed check is not news.** Never cached (so being offline once does not
  suppress checks for six hours) and never announced (so it cannot clear a
  banner a previous successful check correctly raised). Verified live by
  breaking `fetch` while an update was on screen: the banner survived.
- **A clock that jumped backwards** would otherwise park the last-check stamp in
  the future and wedge the checker permanently. Guarded.

### The bug the whole design is shaped around
The APK bundles all of `dist` — **including `version.json`**. A relative fetch
therefore reads the copy baked into the APK, which always matches the running
version, so the app would report "already up to date" forever no matter how many
releases shipped. Hence: an absolute manifest URL, `cache: 'no-store'` plus a
cache-busting param, `json` deliberately excluded from the service worker's
precache globs, and a `no-store` header on the hosting side. Four layers,
because every one of them fails in the silent direction.

### Release pipeline — hit a real wall mid-session, then the user removed it
The first version of this pipeline copied the APK into `dist/downloads/` for
Firebase Hosting to serve alongside `version.json`. The user then actually ran
`firebase deploy --only hosting` and it failed on real infrastructure, not in
theory:

```
Error: ... HTTP Error: 400, Executable files are forbidden on the Spark
billing plan. For more details, see
https://firebase.google.com/support/faq#hosting-exe-restrictions
```

Firebase Hosting's free (Spark) tier flatly refuses to serve a list of
executable file types — `.apk` included — to stop the platform being used to
distribute malware from a trusted-looking `*.web.app` domain.

**First fix, since reverted**: moved the APK to Firebase Storage (no such
restriction there) with a `storage.rules` grant and a manual per-release
drag-into-console step, since there's no CLI path to upload an object via
`firebase-tools` without a new service-account credential. Asked the user
Blaze-vs-stay-on-Spark; they upgraded to Blaze themselves and asked for
whichever design is best with cost minimized.

**On Blaze, the restriction doesn't apply at all**, so the Storage detour was
pure complexity with nothing to show for it — reverted back to the simpler
original design: the APK is served straight from Firebase Hosting alongside
`version.json`, one `firebase deploy --only hosting` publishes both, no manual
per-release upload step. `storage.rules` and the `storage` key in
`firebase.json` were removed entirely rather than left dormant.

Blaze is pay-as-you-go but keeps the same free-tier quotas Hosting has always
had (10 GB stored / 360 MB transferred per day) — a single-user personal app
checking for and occasionally downloading a ~5 MB APK will not come close to
generating a charge.

`npm run release` → web build → `cap sync` + APK → copy the APK into
`dist/downloads/` → rewrite `dist/version.json` with its real URL and size.
Then `firebase deploy --only hosting`, left to the user since it needs their
login.

Order matters and is enforced: the APK is built *from* `dist` and then copied
*into* it, so doing it the other way round would embed the previous release's
5 MB APK inside the new one — every release carrying the last one around with
it. `ignoreAssetsPattern = '…:!downloads'` in `android/app/build.gradle` is the
second line of defence, keeping `cap sync` from packaging that folder into the
next APK's own assets.

**`versionCode` now derives from `package.json`** (1.1.0 → 10100). Android
refuses to install an APK whose versionCode is not greater than the installed
one, failing with a bare "App not installed" that reads like a corrupt download
rather than a forgotten number — and that failure lands on the phone, not in the
build.

**Two build traps now fail loudly instead of silently.** `scripts/build-apk.mjs`
places the java agent at a space-free path (the JVM splits `JAVA_TOOL_OPTIONS`
on whitespace and no quoting survives — this project lives under a path with a
space in it), and checks the APK's **mtime** afterwards, because gradlew exits 0
even when the JVM never started. That exact failure produced a "successful"
build of nothing earlier in this session.

### Verified live
Served a fake manifest from the dev server and walked every path: the banner
appears for 9.9.9 with its release notes; dismissing it hides it and stores the
version; bumping to 9.9.10 prompts again (dismissal correctly scoped); the
manual 「检查更新」 in the backup sheet reports 有新版本 / 已经是最新版本 correctly.

Found and fixed a real inconsistency along the way — the manual check said
"已经是最新版本" while a stale "有新版本" banner sat above it, because the two kept
independent copies of the answer. Both now read one broadcast state
(`UPDATE_EVENT`), and the banner clears the instant a fresh check says
up-to-date, without a reload.

### The real deploy, and what actually went wrong
`firebase deploy --only hosting` failed exactly as designed once it hit a real
`.apk` in `dist/downloads/`:

```
HTTP Error: 400, Executable files are forbidden on the Spark billing plan.
```

Confirmed against the official docs (not guessed): this restriction covers
**both Firebase Hosting and Cloud Storage for Firebase**, Spark-only, lifted on
Blaze. So the earlier plan — move the APK to Storage to dodge the Spark
restriction — would have hit the identical wall; good that it was reverted
before being relied on. Full citation now lives in
[SETUP.md §1](SETUP.md#1-deploy-the-web-app).

The user upgraded the project to Blaze. **The very next deploy attempt still
failed with the same Spark-plan error** — the billing upgrade had not
propagated instantly through Firebase's backend. A retry a short while later
succeeded outright. Worth remembering: don't treat "still fails right after
upgrading" as proof the upgrade didn't work; it can just be lag.

### Verified live, for real this time
`firebase deploy --only hosting` → `Deploy complete!`. Fetched both URLs
directly (not just eyeballed the CLI output):

```
GET https://life-manager-a390b.web.app/version.json         -> 200, correct JSON
GET https://life-manager-a390b.web.app/downloads/lifemanager-1.1.0.apk -> 200, 5,013,807 bytes
```

`version.json`'s `apk.url`/`apk.size` match the live file exactly. This is the
first time in the project's history anything has been reachable at the public
Hosting URL rather than only in a local `dist/` folder.

### A real bug the phone caught immediately: CORS blocked every check
v1.2.0 shipped and the user installed it. First thing they hit: the update
check reported "连不上网络" (can't reach network) — and then, when it happened
to succeed, "已经是最新版本" (already latest) — alternating, on every check,
never anything else. That pattern is exactly the update-checker's own two
non-error outcomes, which was the tell: this was never about the phone's actual
connectivity.

**Root cause**: `MANIFEST_URL` is absolute (`https://life-manager-a390b.web.app/version.json`)
by design (see the file header — otherwise the APK would read the manifest
baked into itself). But the Capacitor APK's WebView serves the bundled app from
`https://localhost` (capacitor.config.json's default `androidScheme`), a
DIFFERENT origin from where the manifest lives. `fetch()`ing across origins
without a CORS header doesn't throw anything that names CORS — the browser
silently refuses to let JS read the response, and `fetch()` rejects with a
generic "Failed to fetch", which reads identically to a real offline phone.
Firebase Hosting doesn't send `Access-Control-Allow-Origin` on anything by
default. So the check was failing on **every single call from inside the real
app**, deterministically — this had simply never been exercised from a real
device before, exactly the "not verified" gap flagged when M44 shipped.

**Fix**: `Access-Control-Allow-Origin: *` on `/version.json` in
`firebase.json` — safe, since that file is public non-sensitive version
metadata, not user data. Server-side only; no new APK needed, the
already-installed app picks it up on its next check.

**Verified for real, not just by inspecting headers**: reproduced the exact
failure with a genuine cross-origin `fetch()` from a different-origin browser
tab (`https://example.com` → the manifest URL) before deploying the fix
(blocked) and after (succeeded, returned the real `version: "1.2.0"`). Header
presence confirmed separately with `curl -H "Origin: https://localhost"`.

### Still not verified
The APK download-and-install tap itself. The URL is now confirmed reachable
cross-origin exactly as the app will fetch it, but whether tapping the anchor
on-device actually triggers Android's download → install-prompt flow has never
been observed — that part is a full-page navigation (not a `fetch`), so CORS
doesn't apply to it, but it's still unconfirmed on real hardware.

---

## M44b — Fixed the update banner itself: it couldn't tell it was on Android ✅ done
The CORS fix (above) worked — the user's phone started reporting real update
availability instead of a fake network error. But the very next thing they hit:
the banner offered **重新载入 (reload)**, not **下载 (download)** — useless in a
Capacitor WebView loading local bundled files, since there's nothing new to
fetch by reloading.

### Root cause: the wrong "am I native" check
`UpdateBanner.jsx` imported `isNativeAvailable()` from `tngNative.js` to decide
which button to show. That function does NOT mean "is this the Android app" —
its actual job, correct in its own file, is "is this Android **AND** is the TNG
notification plugin specifically compiled in", which `isStaleApk()` in the same
file explicitly documents can be false on a genuine Android install. A
different file borrowed it to answer an unrelated question and got the wrong
answer on the real phone.

### Fix: give the general question its own name
New `src/utils/platform.js`, one function: `isNativePlatform()` — just
`Capacitor.isNativePlatform()`, no plugin requirement. `tngNative.js`'s
`isNativeAvailable()` now composes on top of it rather than duplicating the
check. `UpdateBanner.jsx` (both the banner and `UpdateStatus`) switched to the
general check; `TngAutoCapture.jsx` and `MoneyModule.jsx` correctly keep the
TNG-scoped one, since they genuinely do need to know whether the plugin itself
is usable.

### Why this needed a real APK, not just a redeploy
Unlike the CORS fix, this is client-side JS baked into what's already installed
on the phone — Capacitor serves the bundled `assets/public/` locally, it
doesn't fetch the web app from Hosting. Redeploying Hosting alone would have
fixed the web/PWA path but left the already-installed APK showing the wrong
button forever, since ITS copy of `UpdateBanner.jsx` never changes without a
new install. Shipped as v1.2.1, sent directly rather than relying on the
still-buggy 1.2.0 build's own download button to fetch its own fix.

Verified live: `Capacitor.isNativePlatform()` on the deployed web build returns
`false` with `getPlatform() === 'web'` even though `window.Capacitor` itself is
present (Capacitor ships a web shim so the same code runs everywhere) —
confirms `isNativePlatform()` behaves correctly on both sides of the check.

---

## M43 — 健身: a session with a position, and a cardio screen that isn't a strength screen ✅ done
User: "力量里面那个菜单跟计时器这样真的不好啦，我觉得应该是按进去今天是做什么菜单，才有计时器…
顺序可以换，但是起码要提示什么把…就是固定13组把，里面的真的太草率了" and "有氧也是为什么里面又有
组件计时器，你根本在乱做嘛".

Both complaints are the same defect seen from two sides: the module had **controls but no state**. The
strength screen showed the routine picker, the rest timer, the exercise list and the logging form all
at once, none of them aware of each other — a set was something you typed into a form, and nothing
anywhere said what to do next or when you were finished. The rest timer was rendered above *both*
sections, so 有氧 got a between-sets countdown, which is meaningless for a run.

### The model: `src/utils/workoutPlan.js` (new, pure, 47 tests)
A session now has a **position**, which is the thing it was missing.

- **`TOTAL_SETS_TARGET = 13`** — a fixed daily volume, per the user's ask. The point isn't the number,
  it's that a day now has an *end*: "do some sets" can't be finished, "9 of 13" can.
- **`distributeSets(count)`** — splits 13 across the exercises, biggest share first, because the first
  exercise in a routine is the compound lift and an even split would hand the spare set to calf raises.
- **`normalizeRoutineSets()`** — applied on READ, not as a stored migration (same convention as the old
  `normalizeExercise`), so a routine saved before targets existed, or restored from a months-old
  backup, lands on the same plan as a fresh one. A routine whose targets already total 13 is left
  alone — someone who deliberately put 6 sets on squats and 2 on calves keeps that.
- **`buildPlan()` / `planProgress()`** — per-exercise done/target/remaining, plus `current` (first
  exercise still owing sets) and `next`. `next` skips anything already finished: being told to do an
  exercise you've completed is worse than being told nothing.
- **`lastSetFor()`** — prefills weight/reps from the last time that exercise was logged. The old form
  hardcoded 60kg × 10, which is wrong for every exercise but one and teaches you to ignore the field.
- **`suggestRoutine()`** — the rotation, lifted out of the component and tested: a session already
  started *today* outranks the rotation (reopening the app mid-workout must not switch what you're
  halfway through), and today's *cardio* must not pin the strength routine.

### The screens
`/sports/strength` and `/sports/strength/session` are now two different places, because a workout has
two phases: decide what you're doing, then do it.

- **`/sports/strength` — today's plan.** States the routine as an answer ("今天练 胸 & 三头 力量日") with
  the reason underneath, not as a row of cards to choose from; 换菜单 moved into a modal, because being
  told what today's menu IS is constant and changing it is occasional. Below it: the exercise order,
  reorderable with ▲▼, each with its own progress bar. **No rest timer** — you're not resting yet.
- **`/sports/strength/session` — training.** One exercise at a time: "第 1 / 4 个动作 · 卧推 · 这个动作
  3/4 组 · 还差 1 组", the day's 13-set bar, weight/reps prefilled from last time, and an explicit
  **做完接着 X** line so the order is a prompt rather than a memory test. The rest timer lives here and
  only here. Logging a set that completes an exercise auto-advances to the next one.
- **Its own URL**, so the Android back button leaves a session the way it leaves anything else
  (`/sports/:section?/:sub?`).
- **± adjusts targets by MOVING a set between exercises**, never by changing the day's total. Letting +
  drift the day to 17 would quietly undo the whole point of a fixed 13.

- **`/sports/cardio`** — the rest countdown is gone, replaced by a **count-up stopwatch** with
  start/pause/resume, whose "用这个时长（22 分钟）" button fills the duration field instead of the
  minutes being guessed after the fact. It deliberately does *not* log on stop: activity and distance
  still need saying, and a session that logged itself the instant you stopped would be impossible to
  correct. Activity is now tappable chips rather than a `<select>` — it's picked every single time.
  State lives in `App.jsx` alongside the rest timer, split into a paused accumulator plus a
  running-since stamp, so pausing at a traffic light doesn't lose the elapsed time and the clock is
  read off the wall clock rather than counted by an interval that stalls in a backgrounded WebView.

### Verified live
Seeded a part-finished session (3 × 卧推 today, a different routine two days ago). The session screen
correctly showed 第 1/4 动作 · 卧推 3/4 · 还剩 10 组, prefilled 65 kg × 6 from the last set with
"上次这个动作是 65 kg × 6，已经帮你填好了", and named 上斜哑铃卧推 as next. Logging the 4th set advanced
to 第 2/4 · 上斜哑铃卧推 0/3, moved the day to 4/13 · 还剩 9 组, re-pointed 做完接着 at 三头下压, and
started the 60s rest — all in one tap. Cardio stopwatch verified running (00:02 → 00:12) across a
`/money` round-trip, and pause/resume verified holding at 00:54 for 2s before continuing to 00:56.

---

## M42 — 记账: accounts become real, and the notification reader stops asking you to paste ✅ done
User: "tng notification reader好像不work…竟然是要我自己paste我之前理想是自动侦测手机的apk…expenses log
还是不够优秀，就是他到底是扣什么账户你要说清楚…有一些户口是可以记录，但是不算在总资产…现在固定月费也是
整个很奇怪就我不可以选几时扣钱？如果是每年的呢…也没分清楚要用什么户口的钱".

Four complaints, one root cause: **an account was not a thing the app had**. `accounts` was four
numbers on a screen nothing else read; every expense carried a hardcoded
`paymentMethod: "Touch 'n Go eWallet"` display string linked to nothing; and a "fixed monthly fee" was
a number with no date, no frequency and no account attached to it.

### Accounts are entities now — `src/utils/accounts.js` (new, 35 tests)
- **Every expense carries `accountId`.** The entry form asks with a chip picker that shows each
  balance at the moment of choosing (the whole point of a spending-firewall app); expense rows show
  the account's own colour and initials instead of a hardcoded "TNG" square on every single row.
- **Balances are DERIVED, not typed**: `openingBalance − everything spent on this account since
  `openingAt``. Logging a payment and moving the balance are now the same action.
- **`openingAt` is an epoch-ms watermark, not a date**, and an un-stamped account defaults to a
  session-constant "now" (`LEGACY_WATERMARK`). This is the one genuinely subtle part: a hand-typed
  balance was *already net of past spending*, so baselining it at t=0 would subtract the whole expense
  history from it a second time and open the app on a number that was never real. Guarded by a test.
- **Reconcile** ("the bank says RM 42.10") writes a *new* openingBalance/openingAt pair rather than
  editing history — the fix and the audit point are the same act.
- **`countsToNetWorth: false`** — the user's own ask: track it, spend from it, keep it out of "how much
  have I got". Modelled as a flag orthogonal to `kind: 'own' | 'custodial'`, not a third `kind` value,
  because "is this money mine" and "should this count as savings" genuinely come apart. Spending from
  such an account still records and still moves its balance; only the asset side is excluded, and
  `computeNetPosition` reports `excludedHeld`/`excludedCount` so the UI says so out loud rather than
  silently omitting a number.
- **Archive, never delete** — deleting an account would orphan every expense pointing at it, putting
  the log straight back to not knowing where the money came from.
- **TNG is seeded and default** (99% of this user's spending), adopting a pre-existing hand-made "TNG
  eWallet" account rather than duplicating it. Custodial accounts are never offered as the default.

### The notification reader — `TngAutoCapture` + the Java listener
The paste box wasn't broken; it was the *headline*, sitting above a one-line "permission granted ✓"
strip. On a phone where capture was working, the screen still read as "pasting IS the feature."

- **Auto-capture is now the headline card and the paste box is explicitly the fallback**, with
  different wording on Android ("漏掉的那一则，复制过来贴进去") and on web ("网页读不到手机通知 — 这是
  浏览器的限制，不是这个 app 少做了什么").
- **Evidence, not a claim.** `getStatus()` reports three facts that genuinely come apart: permission
  granted · listener *connected* · when something last arrived. Android silently drops a listener
  binding on app update or under memory pressure while leaving the permission switch on — previously
  indistinguishable from a quiet week, from inside the app.
- **A capture log** of the last 25 notifications *with the verdict the parser gave each one*, including
  the ones deliberately dropped. "It arrived and was read as a promo" and "nothing arrived" are
  different problems and this is the only way to tell them apart.
- **Discovery mode** binds other banks/wallets to accounts. Hardcoding a package name per Malaysian
  bank would be guesswork, and a wrong guess produces the worst outcome this feature has: an app
  saying "watching your Maybank" while watching nothing. Instead the listener temporarily reports the
  package of any notification containing an RM amount; you tap it and pick an account. Time-boxed
  natively (30s–15min, capped) so leaving the screen can't leave broad capture running, and it reports
  only the package name plus a 60-char sample.
- **The watch list moved to SharedPreferences**, pushed from JS whenever accounts change — the service
  starts at boot, long before any JavaScript exists to tell it anything. An empty list falls back to
  the TNG defaults rather than meaning "watch nothing forever".
- Every new plugin method is called through a `callSafe()` wrapper returning a safe default, because
  the APK on the phone and the web bundle it loads update separately — an older APK degrades to
  "no diagnostics" instead of throwing and taking the Money tab down.

### Recurring bills — `src/utils/recurring.js` (new, 41 tests)
A bill can now say **when** it comes out, **how often**, and **from which account**.

- monthly / quarterly / half-yearly / yearly / weekly / one-off, with a due day-of-month (or weekday),
  and an anchor month so a quarterly bill recurs Feb/May/Aug/Nov rather than Jan/Apr/Jul/Oct.
- **"The 31st" clamps to the last real day of the month** — rolling into the next month is how a bill
  silently jumps cycles four times a year.
- **A weekly bill lands 4–5 times in one cycle.** The old flat-amount model counted RM30/week as RM30
  a month.
- **Yearly bills get an explicit choice, because both answers are honest**: `'due'` charges the whole
  RM1,200 to the cycle it lands in (truthful about cash flow, brutal on that cycle) or `'spread'`
  reserves RM100 every cycle (truthful about what it really costs). Defaults to spread for anything
  longer than monthly — a firewall app exists to stop the RM1,200 surprise — and the option shows the
  actual ringgit figure, because "spread it" means nothing until you see what it turns into.
- **本期扣款日 Upcoming**: one date-ordered calendar merging bills *and* debt instalments, each with its
  account chip. They leave the same accounts on the same calendar; splitting them made the user do
  the merge in their head. Bills with no account named are called out, not silently tolerated.
- `computeCycleBudget` now sums a pre-resolved `budgeted` per allocation (falling back to the old
  resolver), so debt instalments flow through the same sum without `recurring.js` needing to know
  debts exist.

### Moving money between your own accounts
A hole that only opened up once balances became derived: an unrecorded transfer breaks **both**
accounts (the source keeps money it no longer has, the destination is missing money it does), and one
recorded as a plain expense reads as RM100 of spending — blowing the daily budget and landing in a
category breakdown.

`makeTransfer()` returns a **linked pair** sharing a `transferId`: a positive amount leaving the
source, a negative one arriving at the destination. The shape is the point — every balance in the app
is already a signed sum of `amount` per account, so the pair moves both correctly with no new
arithmetic anywhere, and because the two net to exactly zero, every whole-wallet total stays right
without knowing transfers exist. `isAccountTransfer` then marks them for the places that DO need to
know: gross spend, category breakdowns, the day recap, the archived daily summary. Named
`isAccountTransfer`, not `isTransfer`, because the parser already uses that for "a payment to a
person" — the opposite case. Deleting one row deletes both halves; a half-deleted pair leaves two
individually-plausible but wrong balances, which is the worst state a ledger can be in.

Verified live: TNG 50 − 16.50 + 100 = **RM 133.50**, Maybank 500 − 100 = **RM 400.00**, today's spend
still **RM 16.50**, category breakdown still 100% Food & Dining, and the movement shown as one row in
its own 户口之间转账 section marked 不算开销.

### Accounts are visible everywhere they're relevant
Balances strip on the Money tab's 今天 view and on Overview; per-account spend breakdown alongside the
category one ("RM 60 on food" and "RM 60 out of Maybank" are different questions); account chips on
every expense row, repayment row, bill row, debt row, impulse request and Overview day-detail line.
The impulse sandbox asks which account *when the request is created*, since choosing the pot is part
of deciding whether you can afford it — which is what the 48-hour wait is for.

### Migration (schema v3)
`assignAccounts()` files every existing expense against TNG **only when its `paymentMethod` says TNG
or is absent** — anything claiming another method is left unassigned rather than guessed at, because
an unassigned expense is visible and fixable while a wrongly assigned one silently corrupts a balance.
`baselineAccounts()` then stamps every account at the moment of upgrade. Order matters and is
commented: expenses are filed first, then accounts baselined, so nothing just filed is subtracted
from a balance that already accounted for it.

### Verified live
Seeded four accounts (TNG, Maybank, a `countsToNetWorth: false` card, a custodial PBE with a target)
and four expenses across three of them. Every derived balance matched by hand: TNG 180.22 − 16.50 −
12.40 = **151.32**, Maybank 420 − 89.90 = **330.10**, the excluded card 5000 − 45 = **4955.00** —
and 可动用 read **RM 481.42**, correctly excluding both the RM4,955 and the RM13,331.40. The cycle view
showed 房租 每月 15 号 · 27 天后扣 · Maybank, the RM1,200 yearly premium as **每期预留 RM 100.00** while
charging RM0 to a cycle it doesn't land in, and 本期扣款日 listing the SPayLater instalment alongside
the bills in date order. No console errors.

---

## M41 — Overview's weekly card can step back through past weeks ✅ done
Immediate follow-up to M40: user came back with "总览还是没变啊...现在最不满意是总览" (the overview
still hasn't changed... right now I'm least happy with the overview) — M40 added day-stepping to the
力量/有氧 log lists, but the overview's own weekly card (M39) was still pinned to a fixed "last 7 days
ending today" window with no way to look further back. With little test data logged, that card also
genuinely looked about as sparse as before M39 — not just a perception problem.

- **`weekWindowEnd` state** — the weekly card's `weeklyDays` now build the 7 days ending at this date
  instead of always ending "now"; stepping is by 7 days at a time via the same `shiftDate` helper M40
  added, reusing the `renderDateNav` stepper component (generalized to take a `step`/`label`/
  `isCurrent`/`jumpLabel` config so both the 1-day log steppers and this 7-day week stepper share one
  implementation instead of two copies).
- Header shows "近7天" for the current week, else the actual date range (`08-06 ~ 08-12`); "回到本周"
  jumps back, "›" disables once the window reaches today, same UX as M40's day stepper.
- The streak count itself deliberately stays tied to real "today" regardless of which week is being
  browsed — it's "current consecutive-day streak as of now," not something that makes sense to view
  historically.

**A real bug caught during verification, fixed before shipping**: `recentPRs` only bounded the
window's *start* date (`w.date >= cutoff`), never its end. Browsing an old week worked, but any PR hit
between that old week and today still leaked into the "近期突破" list — e.g. viewing a week from 9 days
ago still showed today's PR alongside that week's actual PR. Fixed by bounding both ends
(`weeklyDays[0].date` through `weeklyDays[weeklyDays.length-1].date`). Caught by seeding two separate
weeks of data with a PR in each and checking the browsed week only ever showed its own PR — worth
noting since the failure was silent (wrong data, not a crash) and would not have shown up without
deliberately testing two data points spanning more than the visible window.

Verified: seeded a current-week PR + session and a 9-days-back PR + session, stepped back and
confirmed the card's totals, bar strip, and PR list all switched to the older week's numbers (not a
blend of both), stepped/jumped forward and confirmed it returns cleanly to today's numbers.
`npm run build` and `test-sync-completeness.mjs` both clean.

## M40 — 力量/有氧 log lists can step back to past days ✅ done
User feedback right after M39: "不可以回去吗？只能看今天不能看几天前吗" (can't I go back — can I only
see today, not a few days ago?). The general cross-module History browser (`HistoryModal.jsx`, only
reachable from Dashboard) technically covered this, but it's a day-summary view of everything at
once, not somewhere you'd naturally look for "was there a set I did on Tuesday."

- **Per-section `‹ date ›` stepper** — `strengthViewDate`/`cardioViewDate`, each defaulting to today,
  independent per screen (matching the existing "力量/有氧 are fully separate, no shared switcher"
  design). "›" disables at today (no browsing into the future); a "回到今天" pill appears whenever
  you've stepped back, for a one-tap return.
- Past days read from `allWorkouts` (full history, never pruned) filtered by date, instead of the
  `workouts` prop which is only ever today's live slice (`useTodayRecords` in `App.jsx`) — that's
  also why a past day's rows hide their delete button (`renderLogRow`'s new `readOnly` param):
  `handleDeleteWorkout` filters against `workouts`, so calling it on a past-day id would silently
  no-op instead of actually deleting anything.

**A real seeding bug caught during verification, not shipped**: first test pass seeded localStorage
dates with `Date.prototype.toISOString().slice(0,10)` (UTC), while the app's `getTodayString()` uses
local date components — off by a day at this machine's UTC offset, made "today's" seeded workout
appear to vanish. Not a bug in the app; fixed the test script to build local-date strings the same
way `getTodayString()` does.

Verified: seeded 3 days of mixed strength/cardio records, confirmed stepping back/forward on both
screens shows the right day's records with delete hidden on past days and present on today, confirmed
"回到今天" and the disabled-at-today "›" both work, confirmed today's own log is still fully
editable/deletable exactly as before. `npm run build` and `test-sync-completeness.mjs` both clean —
no new persisted keys, so no `syncModel.js` registration needed.

## M39 — Sports overview landing screen made actually worth looking at ✅ done
User feedback: the overview (`/sports`, no section) was "过于简单，记录有跟没有一样" (too bare — the
record might as well not exist) — it only showed a streak strip of pass/fail dots plus two thin entry
cards, none of which reflected what was actually logged that week.

- **7-day bar strip replaces the old dot strip** — bar height now reflects that day's actual
  calories burned (falls back to raw set+session count when body weight isn't set yet, since a
  calorie number the module can't estimate shouldn't be faked into a bar height), not just a
  binary trained/untrained flag. Today stays outlined the same way the old highlighted dot was.
- **Weekly totals row** — 训练天数 (days trained /7), 组数+有氧次数, and 本周消耗 kcal (or "卡路里未知"
  when no body weight), computed from `allWorkouts` directly rather than the archived `history` used
  for the streak — `history` only ever kept a bare `totalSets` count per day with no calorie
  breakdown, so weekly kcal has to come from the raw per-set records, same source `getPR` and the
  M38 weight-progress chart already read.
- **"近期突破" (recent PRs) card** — any set flagged `isNewPR` within the visible 7-day window,
  newest first, capped at 3; only rendered when there's actually something to show.
- Removed `recentTrainingDays` from `streak.js` usage (the new bar strip replaces it); `streak.js`
  itself is untouched, still driving the streak count.

Verified by seeding `localStorage` directly (body weight + 2 strength sets + 1 cardio session for
today) since the in-tool body-profile modal's submit button was unreliable in this session's
automated browser (pre-existing tool flakiness, unrelated to this change) — confirmed weekly kcal
(202 = 12+10+180), set/session counts, PR card showing only the actual PR set (not the non-PR second
set), and per-day bar tooltips all computed correctly. `npm run build` clean, no console errors,
drilling into 力量/有氧 from the enriched overview still navigates correctly.

## M38 — Strength side deep content build-out (Stage 1 of 2) ✅ done
Follow-up to M36/M37: the sub-tab split and pixel polish still left 力量/有氧 feeling "简陋"
(crude) because the *content* was thin — a routine picker plus a bare weight/reps form. User asked
for a specific list (two rounds of clarifying questions): per-exercise weight-progress chart, PR
tracking, reorder exercises, kg/lbs toggle, no-equipment alternatives, calories more visible, and
richer routine menu (per-exercise target sets checked off as you log). This is Stage 1 (strength) of
a two-stage plan; cardio is Stage 2, not started yet.

Confirmed before building, not assumed: `recharts@3.10.1` was already a dependency, unused anywhere
in `src/` — this is its first real integration, not a new library. `allWorkouts` keeps every set
ever logged, forever, with full per-exercise weight/reps detail — PR tracking and progress charts
needed zero data-model change to that array. User explicitly chose up/down move buttons over adding
a drag-and-drop dependency.

- **`routines[].exercises`: `string[]` → `{name, targetSets}[]`** — `normalizeExercise()` in
  `SportsModule.jsx` accepts either shape, so routines saved before this change (bare strings) keep
  working with `targetSets: null` (no progress badge, not an error). New/edited routines write the
  richer shape going forward — a graceful, on-read normalization instead of a one-time migration.
- **Exercise list replaces the old `<select>`** — now doubles as the picker AND the management
  surface: tap to select, ▲/▼ to reorder (persisted via `setRoutines`), a "X/N 组" progress badge
  (counted live from today's `workouts`, turns green + ✓ at target) with its own −/+ stepper, and a
  "+ 设置目标" prompt for exercises with no target yet.
- **`getPR(allWorkouts, exerciseName)`** — heaviest weight ever logged for that exercise (not an
  estimated 1RM — matches how directly every other number in this module works). A logged set that
  beats the prior PR gets `isNewPR: true`, a 🏆 flash on that log entry, and a `canvas-confetti` burst
  (already a dependency, already used the same way for XP level-ups elsewhere in the app).
- **Weight-progress chart** — `recharts` `LineChart`, X = date, Y = that day's heaviest set for the
  selected exercise, last ~12 sessions, only rendered once there are ≥2 distinct dates of data (a
  single point isn't a trend).
- **kg/lbs toggle** — new `src/utils/units.js` (`kgToLbs`/`lbsToKg`/`formatWeight`). Everything
  stored and every calorie/PR/chart calculation stays in kg internally — the toggle only affects
  display and input parsing, so no existing formula needed to change. New persisted `weightUnit` key
  registered in `syncModel.js`/`SCHEMA.md`. Along the way, found and fixed a **pre-existing, unrelated
  gap**: `bodyWeightKg` had never been registered in `META_DOCS` either (`scripts/test-sync-
  completeness.mjs` was silently failing on it) — registered both together.
- **`EXERCISE_ALT`** — flat no-equipment-substitute lookup table, same no-LLM/table-driven
  convention as the module's existing `CARDIO_MET`/`STRENGTH_MET`. Silently absent for custom
  user-typed exercises not in the table, by design.
- **Per-exercise calorie subtotal** — today's `strengthCalories` sum for just the selected exercise,
  shown next to the per-set estimate.

**A real bug found and fixed during verification**: the chart's Y-axis showed raw kg tick values
even when the display unit was switched to lbs (only the tooltip had been unit-aware, not the axis
ticks) — added a `tickFormatter` so both match.

**A false alarm, investigated rather than assumed**: `ResponsiveContainer`'s chart never rendered in
this session's automated browser-preview tool. Traced it to the tool's `ResizeObserver` never firing
at all (confirmed directly — a plain manually-created test `<div>` with explicit dimensions got zero
callbacks), consistent with this same tool's earlier screenshot failures ("not displayed, so the page
is not compositing frames"). Verified the chart itself was correct by temporarily swapping in a
fixed-pixel-size `LineChart` with no `ResponsiveContainer` — real data rendered correctly (dots, line,
axes) — then reverted to the proper responsive version for production, since real browsers/the actual
Android WebView have a working `ResizeObserver`.

Verified: cleared/reinjected `localStorage` data to test both the old-string-routine backward-compat
path and a fresh multi-day dataset; confirmed reorder persists across reload, PR flash only fires on
a genuine beat (not the first-ever log), target-set badge counts real today-logged sets, unit toggle
converts body weight/input/PR/chart consistently, no-equipment hint tracks the selected exercise.
`npm run lint` clean, `test-sync-completeness.mjs` all-pass, no console errors, no horizontal overflow
at 375px across 力量/有氧/记录. Test data cleared from `localStorage` before finishing.

## M37 — Pixel icons + corner-radius consistency sweep + sub-tab sweep transition ✅ done
Follow-up to M36's Sports sub-tabs: user asked to push the pixel/HUD reskin (M35-era prototype)
further — replace the thin-line `lucide-react` icons with something that actually matches the pixel
aesthetic, clean up leftover hardcoded corner-radius magic numbers, and give the new Sports sub-tabs
a transition instead of an instant swap. Mid-implementation, re-verified the pixel prototype's actual
saved state (`getComputedStyle` in a live preview, not just memory) and found the corner-radius/
shadow/border squaring described from the earlier session was never actually saved to `index.css` —
cards are still 12px-rounded glassmorphism. Asked the user whether to now actually square everything
globally (a much bigger visual change) or keep the current rounded look; **user chose to keep
rounded corners** and scope this pass to consistency only.

- **`src/utils/icons.jsx`** (new) — re-exports [`pixelarticons`](https://pixelarticons.com) (MIT,
  1036 free icons as of the Aug 2026 update) under the exact names every component already imported
  from `lucide-react`, so the 17 files that use icons only needed their import source changed, not
  their call sites. pixelarticons React components don't have lucide's `size` prop, only raw
  `width`/`height`, so every icon is wrapped to translate `size` → `width`/`height`. Two icons
  (`Dumbbell`, `Utensils`) have no pixelarticons equivalent at all despite being the Sports/Diet
  bottom-nav icons — hand-drawn as small local SVGs on the same `viewBox="0 0 24 24"
  fill="currentColor"` flat-rect convention so they don't stand out. A handful of others
  (`CloudOff`→reuse `Cloud`, `ShieldAlert`/`AlertTriangle`→both `square-alert`, `HeartPulse`→`Heart`,
  etc.) reuse the closest available icon since pixelarticons doesn't have an exact match — all
  low-stakes, non-module-defining icons. `lucide-react` removed from `package.json` (fully unused
  now).
- **Corner-radius consistency sweep** — hardcoded `borderRadius`/`border-radius` px values across
  `src/components/*.jsx` and `index.css` (mostly progress-bar tracks, badges, chips, buttons) routed
  through the existing `var(--radius-sm/md/lg)` tokens instead of scattered magic numbers. Circles
  (`50%`) and `Header.jsx`'s already-square buttons left untouched — not part of this "keep the look,
  fix the code" scope. Caught and reverted one real regression before it shipped: the bulk sed pass
  initially also collapsed `.bottom-nav`'s standalone `24px` pill radius into the `16px` token, which
  — confirmed via `getComputedStyle` (nav height 64px) — measurably flattened its pill shape; restored
  to a literal `24px` since that one wasn't actually an inconsistency to begin with.
- **`.section-sweep-transition`** (`index.css`) — a one-shot version of the existing HUD banner's
  sweep language (reuses `tabFadeSlideIn` + a new one-shot `sweepOnce` keyframe, not the banner's
  `infinite` pulse) applied to `SportsModule.jsx`'s `activeSection` switch, which previously had zero
  animation at all (instant conditional-render swap). Required merging the routine-menu block and the
  strength-form block — both separately gated on `activeSection === 'strength'` — under one
  `key={activeSection}` wrapper so the whole section remounts and animates together, colored per tab
  (purple/cyan/neutral) via an accent sweep line at the top.

Verified live in a fresh preview tab (a stale/cached error from an intermediate edit briefly showed
a false-positive 500 in the tool's own log cache — confirmed via direct `fetch()` and a clean new tab
that the file was actually fine throughout). Clicked through all 4 bottom-nav modules, all 3 Sports
sub-tabs, History modal, Backup modal, Accounts/Cycle sub-views — 0 broken `<svg>` elements anywhere,
0 console errors. Confirmed the sweep-line color and the `tabFadeSlideIn` animation actually fire on
each Sports sub-tab switch. No horizontal overflow at 375px across all 4 modules. `npm run lint`
clean (only pre-existing Fast-Refresh advisory warnings on files that export multiple named
components, not errors).

## M36 — Sports module: three sub-tabs instead of one long stacked page ✅ done
User: "现在健身就是一页弄完我觉得太过简陋...就没必要所有东西挤在一起吧" (the fitness tab being one long
page feels too crude — no need to cram everything together).

- **`SportsModule.jsx`** — replaced the old "先练力量/先做有氧" buttons (which only scrolled to an
  anchor further down a page where the strength form, cardio form, and routine menu were all
  permanently stacked) with a real segmented tab bar: 力量 (routine menu + rest timer + strength
  form), 有氧 (cardio form only), 记录 (today's logged sets, with a live count badge). Each screen now
  only renders what's relevant to it — the routine menu and rest timer are hidden on the log screen,
  the cardio form no longer sits stacked underneath the strength form.
- Removed the now-unused scroll-to-anchor refs (`strengthSectionRef`/`cardioSectionRef`/`jumpTo`).

Verified live: logged a real set, confirmed it appears under 记录 with the badge count updating,
deleted it, confirmed the tab bar correctly hides/shows the routine menu and rest timer per section.
No console errors.

## M35 — A real login gate on first launch ✅ done
User: "不要按那个东西来login直接一开始先login...当然也要可以记住你的...但要有，然后新用户就全空咯" — wanted
sign-in to be a real front door, not a button buried three taps deep in Header → 备份 → Sync, but
confirmed (asked directly) it should be **skippable, not a hard requirement** — keeping the app usable
fully offline/without an account, per M11's original design.

- **`LoginGate.jsx`** — a full-screen first-launch view: "用 Google 登入" (reuses `signIn()` from
  `cloudSync.js`, M25 — no new auth logic) or "先不要，直接开始用" to skip. Renders only when Firebase
  is actually configured AND nobody is signed in — if Firebase isn't set up at all, this never shows
  and the app behaves exactly as it always has.
- **Shown once, not every launch** — `App.jsx`: `loginGateSeen` (persisted, device-local) is set the
  moment the gate is dismissed either way, so a returning user is never asked again. Placed as an
  early return in `App.jsx` *after* every hook has already run (never conditionally skipping a hook
  call — the timer/rollover effects etc. keep running regardless of which JSX branch renders).
  Deliberately does NOT reset on sign-out — that's a settings action, not a reason to replay
  first-launch onboarding.
- **New user starts empty**: nothing changed here — an unsigned-in device or a brand-new Google
  account both already start with zero data, exactly as the user expected ("新用户就全空咯").
- `loginGateSeen` registered as device-local in `syncModel.js` — a second device should still get to
  see the gate once, syncing this flag would silently skip that.

Verified live: fresh load shows the gate correctly; "先不要" dismisses straight into the real app
(confirmed the loaded survival-mode banner and real data were all still there underneath); reloading
afterward does NOT show the gate again (`loginGateSeen` persisted). Reset the flag and confirmed the
gate reappears. Clicked "用 Google 登入" and confirmed it genuinely reaches Google's real OAuth page
(popups are blocked in this sandbox, so it correctly fell back to `signInWithRedirect`) — **did not
proceed past that page**, since entering real Google credentials isn't something this session does.
`npm run build` compiles clean. No console errors, no horizontal overflow at 375px.

## M34 — Weekly stats on Overview: sports + money together, a week you can step through ✅ done
User: "overview都要有我的健身跟钱的记录，可以换时间，有个每周统计" (Overview should have both my fitness
and money records, switchable by time period, a weekly summary).

- **`src/utils/weekStats.js`**: `getWeek(now, offsetWeeks)` — a plain Monday-start calendar week,
  deliberately NOT the payday cycle from `cycle.js`. Those answer different questions (cycle.js is
  specifically about money-cycle budgeting resetting on the 10th; "how was my week" is a separate,
  more ordinary question) and conflating them would make neither answer what it's actually for.
  `computeWeekStats(history, week, todayStats, todayStr)` sums sets/spend/calories across the
  archived days that actually fall in the given week, plus today's live (unarchived) numbers **only
  when today is genuinely inside the viewed week** — a past week must not pick up today's numbers
  just because they're sitting in memory.
- **`Dashboard.jsx`**: a new 每周统计 card between the AI summary and the 7-Day Trend chart —
  training sets + days trained, total spend + average/day, total calories, with ‹ › buttons to step
  week by week. "Next week" is disabled once back at the current week — there's no data past today,
  so stepping forward can never go beyond "now".

### Tests — 195 total (19 new in `test-weekstats.mjs`)
`getWeek`: Monday-start boundaries, exclusive end, a Monday and the Sunday six days later landing in
the same week, a year rollover (a week starting in December for a January date). `computeWeekStats`:
correct summing against a fixture with days inside and outside the target week, `daysTrained` only
counting days with sets > 0 (not just any logged day), and — the one that would have been easy to get
wrong — today's live stats folding into the CURRENT week but never leaking into a PAST week just
because they exist.

Verified live: seeded two weeks of history, current week showed 12 sets/3 training days/RM120.00
spend/RM24.00 avg-per-day/7900 kcal, all matching hand math exactly and correctly excluding the prior
week's entries. Stepped back a week — recomputed to 7 sets/2 days/RM65.00/RM32.50 avg/3700 kcal,
matching a second hand calculation. Stepped forward back to the current week and confirmed "next
week" is disabled there. No horizontal overflow at 375px, no console errors.

### An operational finding while verifying this
Stopping and restarting the browser preview server between sessions **reset the browser's
localStorage**, not just paused it — the real account/debt data loaded earlier this session (M26,
used again in M33) was gone on the next `preview_start`. This confirms directly what the user was
already told: data living only in this session's ephemeral testing preview is not persisted anywhere
real, and the browser preview must not be treated as a stand-in for the user's actual device/browser
in future verification work — seed data for testing should be treated as fully disposable every time,
never as something worth preserving between preview sessions.

## M33 — Instalments could never actually be marked paid ✅ done
User: "为什么户口欠款还是有amount... 到底我的schema对吗" (why does the debt still show 'amount'... is my
schema even right). Traced to a real, confirmed gap: editing SPayLater (a scheduled debt) showed a
plain "金额 Amount" field pre-filled with the computed outstanding total — but for a scheduled debt,
`submitDebt` has always deliberately *ignored* that field on save (so the schedule can't be silently
flattened into one number). The field looked editable and did nothing, and — the bigger issue —
**`grep` across the whole codebase found zero writes to `schedule[i].paid` anywhere.** The field
existed in the schema and every reader used it (`debtOutstanding`, `nextInstalment`,
`instalmentsDueIn`, `getWaterfallOrder`, M26's waterfall), but there was no UI path to it at all — a
scheduled debt's outstanding total could only ever grow, never actually shrink as real payments
happened.

- **`networth.js`: `toggleInstalmentPaid(debts, debtId, due)`** — pure, flips one instalment by its
  `due` date (a stable per-instalment key already used everywhere else in this file), leaves every
  other debt and every other instalment untouched.
- **`AccountsView.jsx`**: a quick "✓ 标记下一期已付" button directly on the debt row (mirrors the
  pattern already used for recurring allocations in `CycleView`), and the edit-debt modal now shows a
  **real scrollable schedule editor** (every instalment, due date, amount, paid/未付 toggle) instead of
  the misleading flat Amount field — which is now only shown at all for genuinely flat (unscheduled)
  debts.
- **Fixed in passing**: `submitDebt`'s validation used to require `dAmount > 0` unconditionally, which
  would have blocked saving a creditor-name/note edit on a scheduled debt that happened to be fully
  paid off (outstanding = 0) — now skipped entirely for scheduled debts, where that field never
  applied in the first place.
- **A real race caught while manually testing the fix**: toggling two instalments in the same React
  batch (e.g. two rapid clicks before a re-render) had the second `setDebts(...)` overwrite the
  first's result, because the toggle handler captured `debts` from render closure instead of using a
  functional updater. Fixed (`setDebts(prev => ...)`) — very unlikely to affect a real user clicking
  two separate buttons at two separate moments, but cheap to close correctly.

### Tests — 176 total (7 new in `test-networth.mjs`)
The matching instalment flips, everything else (other instalments, other debts) is untouched,
outstanding drops by exactly the toggled amount, toggling again flips it back, and two defensive
cases: toggling a flat (unscheduled) debt is a no-op rather than a crash, and toggling a due date that
doesn't exist on the debt changes nothing.

Verified live against the user's real SPayLater data (loaded earlier this session): clicked "标记下一期已付"
on the debt row — outstanding dropped from RM1,164.58 to exactly RM865.28 (minus the September
instalment), "还剩 21 期" correctly became "还剩 20 期", and **every other figure in the app updated in
the same render** — net position, 总欠款, and the M26 debt waterfall all recomputed consistently, since
they all derive from the same `debtOutstanding()`. Opened the edit modal and confirmed the full
21-instalment schedule renders with correct paid/未付 states, toggled a second instalment from inside
the modal itself (also worked), then reverted both test toggles to restore the true real state (nothing
actually paid yet) before finishing. No horizontal overflow at 375px, no console errors.

## M32 — Workout streak: "did I train today" made visible ✅ done
User: "完善它，我要有每天都健身记录" (finish the sports module, I want daily workout records). The data
already existed — `history` (dailyStats, M13) already carries `totalSets` per day, and `HistoryModal`
(M17) can show it — but Sports itself had no consistency view at all, and the general History browser
buries "did I train every day" one tap and a day-list scroll away.

- **`src/utils/streak.js`**: `computeWorkoutStreak(history, todaySets, now)` — consecutive days
  trained, counting backward from yesterday, plus today if it already has a set logged. **Today
  deliberately never breaks the streak just for being empty so far** — it's still in progress; a day
  only counts against you once it's actually over (tomorrow, once it's archived into `history` as a
  real or M22-backfilled zero-day). `recentTrainingDays(history, todaySets, now, days)` — the last 7
  days (oldest first), each flagged trained/not, for a small visual strip. Both pure, both take `now`
  as a parameter for testability, matching every other date-math util in this app (`cycle.js`, etc.).
- **`SportsModule.jsx`**: a new card right under the header — "连续训练 N 天" plus a 7-day strip (filled
  square = trained that day, outlined = the ring around today). `App.jsx` now passes `history` down
  (previously only `workouts`, `setWorkouts`, `timer` — Sports had never needed cross-day data before).
- Today's contribution comes from the live, unarchived `workouts` array (`totalSetsLogged`), not
  `history` — same reason `runRollover` in `App.jsx` has to read the full record lists rather than the
  today-filtered view: today hasn't been archived yet, so `history` alone would always read one day
  behind.

### Tests — 171 total (11 new in `test-streak.mjs`)
Zero state, today-only, three-in-a-row plus today, a rest day in the middle correctly breaking the
count at that point, **a day missing from `history` entirely treated the same as an explicit zero-day**
(not an error, not silently skipped), and the strip's ordering/flags checked against a hand-built
fixture including a day with no history entry at all.

Verified live end-to-end: seeded a realistic week (trained Mon/Wed/Thu, rest Tue, weekend before that
absent from history) — streak correctly read "连续训练 2 天" before logging anything today (Wed+Thu,
broken by Tuesday's rest day), then updated live to "3 天" the moment a set was logged through the
real form, with the strip's dots and weekday labels matching by hand. No horizontal overflow at 375px,
no console errors. Test data cleaned up afterward — the user's real account/debt data (loaded earlier
this session) was left untouched throughout.

## M31 — A real debug APK, closing the caveat M12 left open ✅ done
User was explicit and forceful: the APK is the actual goal, not the web-only stand-ins (M30) built in
the meantime. M12 got the Android project compiling clean but never produced a real APK — blocked on
"the daemon requires a loopback socket this environment blocks." That blocker had never been
re-investigated since. This session did, properly, and got a real `app-debug.apk` out the other end.

**This took far too long — about 9 hours of back-and-forth — before the user stopped it and asked for
a time-boxed check-in instead.** Should have surfaced progress or asked for a time budget much
earlier once the investigation went past a first attempt or two, rather than continuing to dig
silently. Noted for next time this kind of deep environment debugging comes up.

### What was actually wrong (two separate problems, not one)
1. **Gradle couldn't even start.** Root-caused precisely, not just rediscovered: since JDK 17,
   `Selector.open()` on Windows — used internally by Gradle's own client/daemon socket handshake —
   prefers a Unix domain socket over TCP loopback (`sun.nio.ch.PipeImpl`). In this sandbox, binding
   that AF_UNIX socket succeeds but the immediate self-connect fails, and `PipeImpl` has no fallback
   for a *connect* failure (only for a *bind* failure). Reproduced as a 4-line standalone
   `Selector.open()` test, isolated from Gradle entirely, and confirmed present on every JDK 17+ build
   tried (17.0.1, 17.0.20, 21, 25) — not a later regression, not fixable by picking a different patch
   version. JDK 11 doesn't have the code path at all, but Gradle's Android plugin refuses to run on
   anything older than JDK 17.
2. **Once past that, a second, unrelated wall**: `capacitor-android` (Capacitor 8.x) compiles against
   Java 21 language level specifically — JDK 17 fails with `invalid source release: 21`. Needed
   `C:\AndroidStudio\jbr` (Android Studio's bundled JDK 21) as `JAVA_HOME`, which reintroduces problem
   1 and needed the same fix applied there too.

### The fix
`android/build-agent/DisableAfUnix.java` — `UnixDomainSockets.supported` is a native-probed
`static final boolean`, not backed by any system property, so it can't be toggled with a `-D` flag.
The agent force-flips it to `false` via `sun.misc.Unsafe` (reflection alone can't write a `static
final` field on modern JDKs — confirmed by hitting `IllegalAccessException` first) before any
`Selector` opens, so `PipeImpl` takes its normal, working TCP-loopback path instead. Applied via
`JAVA_TOOL_OPTIONS` rather than a `gradlew` flag — deliberately, since Gradle forks a single-use
daemon as a genuinely separate `java` process, and only an environment variable read by the JVM
itself at startup reaches that subprocess; a `-javaagent` flag passed to the wrapper script's own
JVM would not. Full recipe in `android/BUILD_NOTES.md`.

### Verified
`BUILD SUCCESSFUL` from a real `./gradlew assembleDebug`, not a mocked or partial run. The resulting
`android/app/build/outputs/apk/debug/app-debug.apk` (4.6 MB) was inspected directly: real
multi-file DEX bytecode, a real `AndroidManifest.xml`, and the actual built LifeManager web app
embedded under `assets/public/` (Capacitor's normal packaging). Sent to the user directly.

### Not verified
Never installed on a physical device — this environment has no phone or emulator attached, so the
native `TngListenerService` (M12) has still never actually received a real TNG notification. That
needs the user to install this APK (or a signed release build later) on their own phone and grant the
notification-access permission.

## M30 — Clipboard auto-detect: the web-only stand-in for real notification capture ✅ done
User pushback after several milestones of backend/infra work: "网页有什么用" (what's even the point of
the web version) — the real automatic capture (M12's Android `NotificationListenerService`) still
has no built APK, so every TNG notification still means manually copy → open reader → paste. Asked
to make the actual TNG features better instead, no AI. This closes most of that gap without Android
build tooling: copy a notification, switch back to LifeManager (already open), and it's caught the
moment the tab regains focus.

- **`ClipboardWatch.jsx`** — opt-in (off by default), a toggle in the Money tab next to the existing
  reader. When on, checks `navigator.clipboard.readText()` on `focus`/`visibilitychange`, and if the
  text is both NEW (differs from the last text already checked) and parses as something that could
  plausibly involve money, opens the same reader modal pre-filled — reusing 100% of the existing
  manual-paste UI and its confirmation/purpose-required flow, not a second path into the data.
- **No AI anywhere in this** — same constraint as the rest of `tngParser.js`. `ClipboardWatch` only
  decides *when* to run the existing regex-based parser, never adds a second way of reading text.
- **`tngParser.js`: new exported `worthSurfacing(parsed)`** — pulled out of the component into a
  testable pure function, matching how every other piece of decision logic in this app lives in
  `utils/*.js` with unit tests, not inline in a component. Noise (marketing/points) and genuinely
  unrelated copied text (no RM amount at all) don't interrupt; anything that could plausibly be money
  does — same bar the manual reader already uses.
- **Two new keys, both intentionally device-local** (`clipboardWatchEnabled` synced in
  `META_DOCS.settings`, `clipboardLastSeen` — the raw copied text — added to `LOCAL_ONLY_KEYS`,
  correctly caught and required by M28's completeness checker the moment it was added).
- Fails silently and gracefully when clipboard permission isn't granted or the API isn't supported —
  confirmed live: this sandboxed browser's automation context refuses clipboard access entirely
  (`Document is not focused`), and the toggle correctly shows "没有剪贴板权限" with zero console errors
  or crashes rather than failing loudly for what is, from the user's perspective, a background check.

### Tests — 165 total (5 new in `test-parser.mjs`)
`worthSurfacing` checked against a real payment (surfaces), a reload (surfaces), marketing noise
(does not), an unrecognised message that still found an RM amount (surfaces — worth a second look),
and genuinely unrelated copied text with no amount at all (does not — not TNG-shaped).

### Not fully verified
The actual "copy on phone, catch it on focus" loop — this sandboxed environment's browser automation
cannot grant clipboard-read permission at all (confirmed: `writeText` itself fails with "Document is
not focused" outside a real user session), so the happy path only exists as a code review + the unit
tests above, not a live capture. Confirmed instead: `npm run build` compiles clean, the toggle renders
and persists correctly, and the permission-denied path degrades gracefully rather than crashing. Needs
the user to actually try it on their phone: copy a real TNG notification, switch back to the installed
PWA, and confirm the reader pops up pre-filled.

## M29 — The signed-in Google account is now a recognised identity, not just a sync detail ✅ done
User: "我需要一个账号，就是user，让他可以记住我是谁" (I need an account — a user — that remembers who I
am), even though they're the only person using the app. Google Sign-In (M25) already existed but was
purely internal — it scoped Firestore paths and showed an email inside the Sync panel, with no
connection to anything the app actually displays. This wires the two together.

- **`cloudSync.js`**: the signed-in user object now also carries `photoURL` (was just `uid`/`email`/
  `name`), so there's a real avatar available, not just a name string.
- **`Dashboard.jsx`**: the greeting now falls back to the Google account's name when no manual
  `userName` has been set — `userName || sync.user?.name || ''` — **display-only, never written into
  `userName` itself**. A deliberately blank or deliberately different manual name always wins; this
  only fills the gap so "Hello there" becomes "Hello, {real name}" automatically once signed in,
  without the auto-fill-then-silently-overwrite complexity a written fallback would have needed. A
  small avatar (photo, or an initial-letter circle if no photo) sits next to the greeting when signed
  in, title-tooltipped with the account email.
- **`Header.jsx`**: the same avatar appears in the top bar, visible on every tab — not just Overview
  — since "remembering who I am" should hold everywhere, not just the one screen with the greeting.
  Tapping it opens the same Backup/Sync modal as the existing backup-status button.
- Deliberately does **not** gate the app behind login — this stays true to M11's offline-first PWA
  design. Signed out, or Firebase unconfigured entirely, everything behaves exactly as before: manual
  tap-to-edit name, "Hello there" default, no avatar rendered anywhere.

### Not fully verified
Confirmed via `npm run build` that both new JSX branches (Header's avatar button, Dashboard's
avatar + fallback name) compile cleanly, and confirmed live in the browser that the signed-out state
is pixel-for-pixel unchanged. **Could not exercise the actual signed-in rendering** — `cloudSync.js`
has no exported way to inject a fake authenticated user (correctly so — it's a real auth singleton,
not something to poke from outside), and entering real Google credentials is not something this
session does. This needs the user to actually sign in once and confirm the avatar/name appear as
designed.

### Found in passing, not fixed (flagged separately)
`SyncPanel.jsx` calls `pushNow({ force: true })` on both its "立即上传" and "用这台覆盖" buttons, but
`cloudSync.js`'s `pushNow()` takes no parameters and has no `force` behavior — both buttons currently
do the exact same incremental push (only records changed since `lastSyncedAt`). This means "用这台覆盖"
(override with this device) doesn't actually force-overwrite records that haven't changed locally but
differ on the remote, which is presumably the whole point of that button when `remoteNewer` is shown.
Not fixed here — unrelated to the account-identity feature this milestone was about, and changing
push semantics deserves its own dedicated pass with real sync-conflict testing.

## M28 — Automated sync-completeness check, so M27 can't quietly happen again ✅ done
Follow-up to M27. User pushed back on "why not real SQL — won't the data end up incomplete?", which
is a fair worry given M27 just happened. The honest answer: switching storage engines wouldn't have
prevented that specific bug — it was a hand-written replication list missing an entry, and you can
make that exact mistake with a SQL-backed sync layer too. What actually prevents it is an automated
check that fails loudly the moment a new persisted key isn't accounted for, so it doesn't require
anyone to remember, or to ask "what are the tables" for it to surface.

- **`scripts/test-sync-completeness.mjs`** — scans every `.js`/`.jsx` file under `src` for
  `usePersistentState('key', …)` / `useLiveJSON('key', …)` call sites, and cross-checks every key
  found against `syncModel.js`'s own registries. A key must be in `RECORD_COLLECTIONS`,
  `DAILY_STATS_LOCAL_KEY`, one of `META_DOCS`'s lists, or the new `LOCAL_ONLY_KEYS` — anything else
  fails the test by name and file path.
- **`syncModel.js`: new `LOCAL_ONLY_KEYS`** — the three keys that are genuinely meant to stay
  device-local (`lastActiveDate`: each device rolls over on its own midnight; `tngReviewQueue` /
  `tngAutoLoggedToday`: Android-only, only meaningful on the phone with the native listener), each
  with a one-line reason. This is what turns "not synced" from a silent omission into a visible,
  deliberate decision — the exact distinction the M27 bug lacked.
- **`DAILY_STATS_LOCAL_KEY` exported** and `cloudSync.js`'s two hardcoded `'history'` string literals
  replaced with it, so the completeness checker (and any future reader) has one place to look instead
  of a string that could silently drift from the real key name.
- **Verified the check actually catches a regression**, not just passing vacuously: temporarily
  emptied `impulse: []` in `META_DOCS`, ran the script, watched it fail with the exact offending key
  and file (`pendingRequests (\components\ImpulseSandbox.jsx)`), then restored it and confirmed clean.
- Wired into `npm test` — runs on every future change, not just when someone happens to ask what the
  database looks like.

### Tests — 160 total (4 new in `test-sync-completeness.mjs`)
Sanity-checks the scanner itself isn't silently finding nothing (asserts a realistic key count and
that two specific known keys are actually found), then the real assertion: no unregistered keys exist.

## M27 — Closed the sync gap: 3 keys were never registered for cloud sync ✅ done
User asked "tell me the current database tables" after M26, which surfaced a real bug: `SCHEMA.md`
was written at M14, before M16 (payday router) and M20 (impulse sandbox) existed, and the newer
`incomeSources`/`allocations`/`pendingRequests` localStorage keys were never added to
`syncModel.js`'s `META_DOCS`. Not a display bug — a real one: a second device signing in would never
receive these three, with no error anywhere, because there was nothing to fail loudly. This is the
concrete cost of not having a traditional SQL migration system (discussed with the user directly):
nothing forces a new persisted key to be registered with sync, so it just silently doesn't sync.

- **`syncModel.js`**: added `payday: ['incomeSources', 'allocations']` and
  `impulse: ['pendingRequests']` to `META_DOCS`. That's the entire fix — `cloudSync.js`'s push/pull
  loops already iterate `Object.keys(META_DOCS)` generically, so nothing else needed to change.
- **`SCHEMA.md`** updated to list the two new meta documents, plus a new explicit warning section:
  *"There is no schema enforcement — this file and `META_DOCS` ARE the schema"* — whenever a module
  gains a new persisted key, register it in the same change, not later.

### Tests — 156 total (5 new in `test-sync.mjs`)
Regression guard for the exact gap: both new `META_DOCS` entries exist with the right keys, both meta
docs round-trip through `readMetaDoc`, and a remote `payday` doc correctly applies back onto local
storage via `writeMetaDoc` (the same path a second device pulling changes would use).

Verified live: Backup modal / Sync panel still renders cleanly after the change (`cloudSync.js` is
lazy-loaded and untouched in shape, this only changed `syncModel.js`'s exported table), no console
errors.

## M26 — Debt waterfall + the RM 15,269 reserve progress bar ✅ done
Module 4 of the [[lifemanager-firewall-app-spec|firewall spec]]. Two pieces, both pure data already
sitting in `accounts`/`debts` — no new fields, no new storage keys.

- **`networth.js`: `getWaterfallOrder(accounts, debts)`** — every real debt AND every custodial
  account's shortfall against its target, merged into one list and sorted **smallest-outstanding-
  first**. That's the "snowball" method rather than "avalanche" (highest-interest-first): this app
  has no interest-rate field to rank by cost, but more to the point, smallest-first is the method
  literally built around the dopamine effect the whole firewall spec exists for — clearing a whole
  line off the list reads as a bigger win than a bigger dent in a bigger one. Each entry carries
  `remainingAfter` (everything still owed once *that* item alone is cleared — the staircase shrinking
  step by step) and, where derivable, `progressPct`: from a debt's schedule (paid vs unpaid
  instalments) or a reserve account's balance-over-target. A **flat, unscheduled debt deliberately
  gets `progress: null`** rather than a fabricated percentage — there's no tracked starting point for
  it, only whatever `amount` was last hand-edited to.
- **`AccountsView.jsx`** gained two read-only sections between the net-position card and the existing
  editable Accounts/Debts lists: **储备金进度 Reserve progress** (a big named-goal bar per custodial
  account with a target — the RM 15,269 figure from the spec, derived from real account data, never
  hardcoded per the M11 lesson) and **还款瀑布 Debt waterfall** (the ranked list, numbered, with a
  "下一个目标" badge on the smallest item). Neither has its own add/edit controls — they're a
  re-ordering of data owned by the sections below, not a third place to enter the same numbers.

### Tests — 151 total (9 new in `test-networth.mjs`)
Order is smallest-first against the real SPayLater/PBE fixture; a flat debt gets no progress figure;
`remainingAfter` is exactly 0 on the last item and exactly "everything else" on the first; a debt paid
off and a reserve fully met both drop out of the plan entirely rather than showing as a zero-progress
row; empty accounts/debts produces an empty plan, not an error.

Verified live end-to-end: seeded the real PBE/TNG/SPayLater/flat-debt shape via localStorage (the debt
form has no schedule-entry UI, so instalment debts are only ever built programmatically or via
backup-import — matches how the app already works). Reserve bar showed PBE 13,331.40/15,269.00 (87%,
差 1,937.60) exactly matching hand math. Waterfall ordered Ah Meng (RM50, flat, no progress bar,
"下一个目标") → SPayLater (RM1,164.58, 0% progress bar, 21 instalments unpaid) → PBE (RM1,937.60, 87%
progress bar, "清掉这项，全部还清"), with each row's `remainingAfter` matching a hand-computed running
total down to the cent. No horizontal overflow at 375px. No console errors.

## M25 — Cloud sync activated on a real Firebase project ✅ done (code + rules deployed; live sign-in not yet exercised)
Not one of the 5 firewall modules — this finishes what M12/M14 left deferred: "code complete, needs
the user's project." Turns out the user's project already existed and `.env.local` was already
filled in with real values from earlier, undocumented setup — this session's job was closing the gap
between "configured" and "actually working."

- **`firestore.rules` deployed to the live project** (`life-manager-a390b`) via `firebase deploy
  --only firestore:rules`. Added `firebase.json` + `.firebaserc` so the CLI (already logged in on
  this machine) knows where to point. The deploy only *tightens* access — default-deny, a signed-in
  user can touch only documents under their own `uid` — and does not touch existing data.
  **Deliberately not run automatically**: it's a change to a live cloud resource, so it went through
  an explicit user confirmation first, consistent with treating shared-infrastructure changes as
  requiring a check-in rather than just doing them.
- **Confirmed free-tier-safe.** The project is on Spark (no card attached) — exceeding the daily
  quota (50k reads / 20k writes / 20k deletes) can never bill anything; it just refuses further
  requests until the UTC midnight reset. Sized against this app's own numbers: `SCHEMA.md` estimates
  ~1–2 KB/day of records, so even a first-time backfill of 5 years of daily logging (~9,000 records)
  stays under the 20k/day write cap in a single day. Normal day-to-day sync afterward is incremental
  and estimated (M14) at ~0.2% of the daily allowance.
- **`cloudSync.js`'s `describeError()` exported and unit-tested**, with two new plain-language cases
  added instead of leaving them as raw Firebase error codes: `resource-exhausted` (Spark's daily cap
  — reassures explicitly that this is not a billing event and nothing local is lost) and
  `auth/operation-not-allowed` (Google sign-in not yet switched on in the console — names the exact
  Console path to fix it instead of failing cryptically).
- **Bug caught by this work**: `cloudSync.js` imported `./syncModel` and `./storage` without a `.js`
  extension. Vite resolves that fine, so it shipped unnoticed — but it breaks under plain Node's
  strict ESM resolution, which only got exercised once `describeError` needed a direct unit test.
  Fixed by adding the extensions explicitly.
- **Google Sign-In confirmed already enabled** on the project — verified live by clicking the actual
  "用 Google 登入" button in the running app and watching it redirect all the way to a genuine
  Google OAuth consent screen with a real, Firebase-provisioned client ID (this only happens once the
  provider is switched on in Firebase Console; an unconfigured provider fails before ever reaching
  Google). Stopped there deliberately — actually completing a sign-in requires entering real Google
  account credentials, which is not something this session does on the user's behalf.

### Tests — 143 total (3 new in `test-sync.mjs`)
`describeError` checked against fake error objects for the quota-exceeded, permission-denied, and
operation-not-allowed cases, plus the pre-existing unconfigured/unknown-error paths.

### Not yet verified
An actual end-to-end sync between two signed-in devices. Rules are live, the provider is live, the
code is unit-tested — what's left needs the user to sign in with their own Google account on two
devices and confirm data actually moves, since credential entry isn't something this session can do.

## M24 — Red-alert survival mode below RM 300 liquid ✅ done
Module 3 of the [[lifemanager-firewall-app-spec|firewall spec]]. "Liquid" means `ownCash` from
`networth.js` (M15) — own accounts only, custodial balances excluded, since PBE money isn't
spendable regardless of how the number looks.

- **`networth.js`**: `SURVIVAL_THRESHOLD = 300`, and `computeNetPosition` now returns
  `inSurvivalMode` (`ownCash < threshold`, overridable third argument for tests). Deliberately keyed
  on `ownCash` alone, not `netPosition` — being deep in overall debt (a big custodial shortfall,
  say) is a different problem from having almost no cash in hand *right now*; a test confirms
  RM50,000 of debt with RM500 in the wallet does **not** trip survival mode, and the empty state
  (no accounts configured at all) honestly does, since RM0 confirmed liquid is RM0.
- **`SurvivalBanner.jsx`** — a red bar rendered in `App.jsx` between the header and every tab's
  content, not just Money. **No dismiss button, by design**: a close button would let it be silenced
  without the number actually changing, which defeats the point of the module. It only stops
  showing once `ownCash` genuinely crosses back above RM300.
- **Bug this surfaced before it shipped**: the banner is rendered at the `App.jsx` level, which stays
  mounted across tab switches, but `accounts`/`debts` are owned by `AccountsView.jsx`, several
  components away — plain `usePersistentState` only syncs *its own* writes, so a second independent
  instance of it for the same key would have shown a stale figure until something forced a remount.
  Fixed with a new `useLiveJSON()` in `storage.js` that re-reads on the `CHANGE_EVENT` every write
  already fires (the same event cloud sync listens to). Verified live: edited an account balance
  while sitting on 户口欠款, watched the header-level banner's figure update in the same render pass
  with no tab switch or reload.
- **`AccountsView.jsx`** reinforced where the number actually lives: the net-position card's border
  and the "我的钱 Mine" figure turn red, plus an explicit warning line, whenever `inSurvivalMode` is
  true — using the same `pos` object the card already computes, no duplicate logic.

### Tests — 138 total (10 new in `test-networth.mjs`)
Boundary exactly at RM300 (not survival, strict `<`), one cent under (is), the overridable threshold
parameter, RM500 cash with RM50,000 of unrelated debt (not survival — confirms the "keyed on ownCash
alone" design), and the empty-state case.

Verified live end-to-end: fresh profile showed the banner immediately (RM0 liquid, no accounts
configured) on the Overview tab with no Money-tab visit needed. Added a TNG eWallet account at
RM120 — banner updated to RM120.00 live. Edited it up to RM500 — banner and the AccountsView warning
both disappeared in the same interaction, no reload. Deleted the account — banner reappeared at
RM0.00. No horizontal overflow at 375px (message wraps to two lines). No console errors throughout.

## M8 — Money module rebuild ✅ done
The module meant for tracking real ringgit could only be fed fake data: its three buttons all
injected one of 5 preset merchants, and there was no manual entry form at all. Rebuilt around a
real parser instead.

**`src/utils/tngParser.js` — reads TNG notifications with pattern matching, no AI.** TNG messages
are template-generated, not free-form writing, so regex reads them reliably at zero cost, offline.
Every notification is sorted into one of four buckets: `spend` (log it), `income` (reload/refund —
never counted as spending), `noise` (voucher/promo copy — discarded), `unknown` (matched nothing —
handed back to the user). Spend is a **whitelist**: it needs both an amount *and* a spend verb, so
"Grab RM5 off!" cannot be auto-logged, and anything unrecognised is never silently dropped or
silently logged. Verified against 12 cases including the reload, the promo, and a bare balance
notice — all correctly refused.

**Two kinds of memory, both plain lookup tables.** Patterns live in one file and get a new line
whenever a real notification isn't recognised. Separately, a merchant → category map (`merchantCategories`)
*learns*: correct a shop's category once and every future notification from them files itself.
Learned entries outrank the built-in keyword rules, and substring-match so "Tealive" also catches
"Tealive Bubble Tea SS15".

**Manual expense entry (add + edit).** The gap that mattered most — you can now log an actual
purchase. Tapping a logged expense opens a pre-filled edit form, matching Diet's behaviour.
Category is suggested as you type the shop name, but only while adding: during an edit you are
deliberately setting it, so it is never overridden.

**Removed the two fake flows** — "Auto TNG Detect" and the "Receipt AI Scanner". Both injected
random preset transactions into a budget that is supposed to reflect real spending, and neither
could ever become real in a web build. The ON/OFF listener toggle went with them, since it gated
only the simulation. The presets survive as parser test samples, deliberately including the reload
and the promo so the filter can be seen refusing them.

**Budget field snap-back fixed.** Clearing it to retype used to jump to 100 (not even the 80
default) mid-keystroke. It now holds a draft while you type and commits on blur or Enter, falling
back to the last good value if you leave it empty.

Still true after this pass: a web page cannot read your notifications by itself. The reader works
on pasted text today, and `parseTngNotification()` is the exact function a native Android listener
would call later — so none of it is throwaway.

### M8.1 — corrected against real notifications ✅ done
The first version was built against *invented English samples*. A screenshot of the user's actual
TNG notification tray showed all four were wrong: the real messages are **in Chinese**, and the
parser scored 0/4 — two genuine payments read as `unknown`, a loyalty-points promo read as `income`.
Rewritten bilingual, with the real four kept verbatim in `SAMPLE_NOTIFICATIONS` as the reference set.

- **Chinese patterns throughout.** 汇款/转账 (transfer), 已支付/付款成功 (paid), 已扣除 (deducted),
  充值/退款 (reload/refund), 优惠码/赢取/限时/积分 (promo/win/limited/points). Chinese word order
  puts the merchant in a different place — "已成功汇款到 KOH CHENG XUAN" has it *after* the verb,
  "您已支付了PINDUODUO RM36.36" has it *between* the verb and the amount — so merchant extraction
  needed its own pattern set, terminated by CJK punctuation (。，、).
- **Noise is checked before income, and that ordering is load-bearing.** The real points
  notification reads "You've just earned 36 points! You've received 36 points…" — the phrase
  "you've received" would otherwise classify a marketing message as money in.
- **`needsPurpose` — the "what was this for?" prompt.** A transfer to a person tells you the amount
  but not what it bought: "汇款到 KOH CHENG XUAN" could be dinner, rent or a carpool. Those, plus
  any merchant no rule recognises, now block the log button until you type a purpose, stored as
  `note` on the expense. Transfers ask *every time* and deliberately do **not** teach a category —
  the same person is dinner one week and rent the next, so a remembered guess would be wrong as
  often as right. An unrecognised shop asks once; giving it a category stops it asking.
- **Bug caught in testing: the payment rail leaked a category.** "ALIPAY+ 付款 … ABC TRADING
  ENTERPRISE" came back confidently marked *Shopping* and skipped the prompt, because the
  whole-message fallback matched `alipay` in the Shopping keyword list. ALIPAY+ is how the payment
  travelled, not what was bought. `alipay` is gone from the merchant rules, and the full-text
  fallback is now a deliberately tiny `CONTEXT_RULES` list of unambiguous purpose words
  (toll/parking/fare/过路费/停车) instead of the full rule set.

Verified against 14 cases — the four real notifications, the ALIPAY+ regression, Chinese and
English payments, reload, promo, toll, and a bare balance notice.

## M9 — Accounts & debts ✅ done
The Money tab only answered "what did I spend today". The user needed the other question — where do
I actually stand — so the tab now has two views: **今天 Today** (the existing spend tracker) and
**户口欠款 Accounts**.

- **Accounts with an "应有余额 / should be" field.** Each account holds a current balance and an
  optional target. Where the target is higher, the card shows the gap (`少了 RM x`). Opening figures
  as given on 2026-08-11: PBE 13,542 (应有 15,269 → 缺口 1,727), TNG 40.22, GX Bank 20, HLB 184.42.
  Cash total RM 13,786.64.
- **Debts** — creditor, amount, optional note and due date, sorted largest first.
- **Net position** = cash − debts. The account shortfall is displayed but deliberately **excluded**
  from net position: it's the same money seen from the account's side, and adding both would count
  it twice.
- Opening balances live in `OPENING_ACCOUNTS` in `AccountsView.jsx`. This is the user's own real
  data, not the fabricated demo data the honesty passes removed — with no backend, the first
  snapshot has to come from somewhere. Once a browser saves its own copy, the constant no longer
  affects it.

Verified in-browser: totals correct on load, add/edit/delete for both accounts and debts, shortfall
recalculating (PBE 15,000 → 缺口 269), no console errors.

## M10 — Backup & restore ✅ done
Real financial data (accounts, debts) now lives in the app, and it existed in exactly one browser
profile with no second copy. `src/utils/backup.js` + `BackupModal.jsx` fix that.

- **Export** writes one versioned JSON document holding the whole app state. Keys are discovered by
  `lifemanager:` prefix rather than hardcoded, so a feature added later is backed up automatically
  instead of being silently left out. Housekeeping flags (`demoHistoryPurged`) are skipped — they're
  migration state for one browser, not user data.
- **Import replaces, it does not merge.** Merging two devices' edits needs conflict resolution, and
  getting it wrong corrupts financial records silently. Restore is behind a confirm step showing a
  before/after count per data type, and the file's export timestamp.
- **Validation rejects** non-JSON, another app's file, a missing `data` block, a missing version, and
  any version newer than the app understands — each with a plain-language reason.
- **The nag is deliberate.** The header line doubles as the entry point: until an export has
  happened (or if the last one is over 7 days old) it reads "只存在这台 — 按我备份" in amber,
  reverting to the calm "Saved on this device only" afterwards.
- Doubles as **manual phone↔PC sync** today: export on one, import on the other. No account, no
  server, no network.

Verified in-browser: 13 keys captured, wipe → restore recovers everything including Chinese text,
all five rejection paths fire correctly, header warning flips after export, no console errors.

Next for this area: automatic cloud sync between phone and PC (user's stated requirement). The
backup JSON is the migration format, so this work carries over rather than being replaced.

## M11 — PWA (installable + offline) ✅ done
The app only ran on `localhost` on the PC, so the phone couldn't open it at all. Now it's a real
installable web app.

- `vite-plugin-pwa` generates the manifest and a Workbox service worker; **18 entries precached**
  (683 KB), so once installed it opens with no network.
- Google Fonts are the only external request — cached at runtime (CacheFirst) so a second, offline
  launch still renders in the right typeface instead of falling back to a system font.
- **Icons are generated, not committed as opaque binaries.** `npm run icons` rasterises
  `public/icon.svg` via sharp into 192/512/maskable-512/apple-touch. The maskable variant keeps "LM"
  inside the 80% safe zone so Android's circle crop doesn't cut it.
- `base: './'` and relative `start_url`/`scope`, so the build works from any sub-path (GitHub Pages
  project sites, preview URLs, or straight off the filesystem).
- iOS meta tags (it ignores the manifest), `theme-color`, and `viewport-fit=cover` plus
  `env(safe-area-inset-bottom)` on the bottom nav so it clears the home indicator on notched phones.

**Verified genuinely offline**: stopped the preview server outright, reloaded — the app rendered,
all four tabs worked, and the accounts view showed correct figures. A deliberate fetch to the dead
server confirmed `ERR_CONNECTION_REFUSED`, so it really was serving from cache.

### Real balances removed from source ⚠️
`OPENING_ACCOUNTS` in `AccountsView.jsx` held actual account figures. That was fine as a local
snapshot but **wrong for an app built to be hosted publicly** — anyone opening the deployed JS
bundle could read them. Now:
- `OPENING_ACCOUNTS` is empty; opening balances ship as `lifemanager-opening-balances.json`, loaded
  through 备份 → 汇入.
- Form placeholders no longer use the real figures either (they were minified into the bundle too —
  caught only by grepping the built output, not the source).
- `.gitignore` excludes `lifemanager-*.json` so backup files never get committed.
- Build output re-scanned for all four figures: clean.

Verified end-to-end: fresh profile → empty accounts view → import the file → correct totals restored.

## M12 — Cloud sync, Android APK, and the outstanding audit bugs ✅ done

### Firebase sync (code complete — needs the user's project)
Whole-state document sync on Firestore + Google sign-in, same shape as the backup file. Their data
is kilobytes, so per-collection sync would buy nothing and cost real conflict complexity.
- **Remote changes are never applied automatically.** When the cloud is ahead the UI names the
  device it came from and lets the user choose. A device older than the cloud also refuses to push,
  so a stale phone can't clobber a fresh PC on reconnect.
- **Lazy-loaded**: the 555 KB SDK is a separate chunk, downloaded only if sync is switched on.
  Verified — with sync unconfigured the chunk is never fetched and the app is unchanged.
- Config comes from `.env.local` (gitignored); `firestore.rules` is the actual protection, since
  Firebase web config is public by design.
- Degrades to a plain "未设定" notice when unconfigured. Verified in both states.

### Android APK — real TNG auto-detect
The one feature that genuinely cannot exist in a web build. Capacitor + a native
`NotificationListenerService`.
- Filters to the TNG packages **before reading anything**; other apps' notifications are never
  touched. Prefers `EXTRA_BIG_TEXT` — `EXTRA_TEXT` is ellipsised and can cut the amount off.
- Native code classifies nothing; it forwards raw text to the same `parseTngNotification()` the
  paste box uses, so there is one set of rules and it stays testable without a phone.
- Buffers up to 50 notifications that arrive while the web view isn't running.
- Auto-logs only unambiguous payments; transfers and unknown shops go to a **待确认** queue.
- **Verification (corrected 2026-08-12).** The original claim here — "no Android SDK on this
  machine, the Java has never been compiled" — was wrong. Android Studio 2025.2.1 *is* installed, at
  the non-standard `C:\AndroidStudio`, with a full SDK at `C:\android` (platforms 34/36, build-tools
  35.0.0/36.1.0) and a bundled JDK 21. The first check only looked at `ANDROID_HOME` and the default
  `%LOCALAPPDATA%\Android\Sdk`, and concluded too much from their absence.

  With the real SDK found: `TngListenerService` **compiles clean against `android.jar` (API 36)** —
  every Android API resolves. Every Capacitor API used was checked against the actual signatures in
  `node_modules/@capacitor/android`, including that `notifyListeners` is `protected` (so it can only
  be called from within the plugin, which is how it is used) and that `JSObject extends JSONObject`
  (so `JSONArray.put(JSObject)` is valid).

  Still not verified: a full Gradle build. The daemon requires a loopback socket this environment
  blocks, so no APK has been produced and nothing has run on a device. `android/local.properties`
  now points Gradle at `C:\android` so the build works in Android Studio.

### Audit bugs fixed
- **XP regression (audit #2).** Total XP was recomputed by summing a 30-day window, so on day 31 the
  oldest day's XP vanished and Level went *backwards*. Dropped days' XP is now banked into
  `archivedXp` at the moment they leave the window. Verified: seeded 31 days at 85 XP, one aged out,
  `archivedXp` became exactly 85 and Level held at 27.
- **Midnight rollover (audit #4).** Ran once on mount, so a phone left open overnight never archived
  the day. Now re-checked on `visibilitychange` and a 60s interval, reading state through a ref
  (a timer closure would have captured stale values) and guarded by the date already rolled to.
- **Stopwatch measured the wrong thing (audit #5).** "Total Session" was incremented inside the
  rest-timer interval, so it counted *resting* and froze between rests. Now driven by the wall clock
  from session start, with a reset control.
- **Sticky rest alert (audit #6).** Had no time component, so it sat in the bell forever. Now
  expires after two minutes.
- **AI Coach still lied (audit #3).** It claimed "TNG notification listener is active and
  automatically logging" and "integrated into the Kotlin native manifest". Both replaced with
  platform-aware, accurate answers.
- **Error boundary (audit #12)** with an emergency export button — it reads localStorage directly,
  so it still works when React is broken. It immediately earned its keep by catching a real
  `computeDayXP is not defined` crash during this work instead of showing a white screen.
- **Lint was missing undefined variables.** `no-undef` wasn't enabled, which is why that crash got
  past a clean lint run. Now enabled and confirmed to catch that exact bug.

## M13 — Records stop being deleted ✅ done
Asked to make everything storable (gym records, AI chat) ahead of cloud sync. Investigating that
turned up something worse than a missing feature: **the app was destroying data every midnight.**

`setMeals([]) / setWorkouts([]) / setExpenses([])` in the rollover kept only a summary, so
`Bench Press 80kg × 10` collapsed into the number `4`, and `RM 16.50 at Pelita` became an anonymous
total. There was no gym history and no spending history — only counts. AI chat wasn't stored at all;
it was `useState` in the modal and vanished on close.

Syncing that model would only have synced the deletion, so the schema came first. See
[SCHEMA.md](SCHEMA.md).

- **Records are now append-only and date-stamped.** "Today" is a filter, not a container. The
  rollover writes a summary and deletes nothing.
- **Modules were not rewritten.** `useTodayRecords()` hands each module today's slice plus a setter
  that splices the result back into the full list — so a module can only ever affect today, by
  construction, and code like `setMeals([newMeal, ...meals])` still works unchanged.
- **Migration** stamps pre-v2 records with `lastActiveDate` — the day they were logged, *not* today,
  which would have refiled yesterday's dinner as this morning's.
- **History uncapped.** ~100 bytes/day ≈ 36 KB/year. The 30-day cap was what made Level go
  backwards; `archivedXp` is now read-only, kept so existing users don't lose their level.
- **Chat persisted**, capped at 200 messages.
- Documents vs collections in the Firestore layout is driven by the **1 MiB per-document limit** —
  anything unbounded (meals, workouts, expenses, chats, dailyStats) must be a collection or the app
  breaks silently once full.

**Bug caught in testing:** the first version summarised the *today-filtered* view, but by the time
the rollover runs that filter has already moved to the new day — so it wrote a day of zeros over
real activity. The rollover now holds the full lists and filters by `lastActiveDate`.

Verified: seeded old-schema undated records with `lastActiveDate` = yesterday → migration dated them
correctly, summary recorded 680 kcal / 2 sets / RM 16.50, **the detail survived**, today's views were
correctly empty, logging today left yesterday untouched, chat survived close/reopen, all five views
render, no console errors.

## M14 — Per-collection incremental sync + a test suite ✅ done (code); live sync untested

Rewrote sync from whole-document snapshot to the schema in SCHEMA.md.

**Staying inside the free tier was the design driver.** Spark gives ~50k reads/day. Re-reading
everything on launch would be a few thousand documents per open — ten opens across two devices could
exhaust it within a year of data. So:
- Pulls are incremental: `where('at', '>', lastSyncedAt)`.
- Change detection watches **one marker document**, not the collections, so an idle app costs
  nothing and a remote change costs one read.
- Firestore `persistentLocalCache` serves repeat reads unbilled and keeps the app working offline.
- Meta documents are fingerprinted and skipped when unchanged.
- Writes are chunked at 400 (Firestore's cap is 500 per batch).

Estimated real usage: **~0.2% of the free allowance**. No paid feature is used anywhere.

**Deletes.** A local delete leaves nothing to push, so `syncModel` keeps the id set last seen in the
cloud; a disappearance becomes an explicit soft-delete (`deleted: true`) that other devices apply.
Without this a deleted record silently returns on the next pull.

**Conflicts** are resolved per record on `at`, so two devices editing *different* records both
survive — the old whole-blob approach made that a whole-device clobber.

### Tests — `npm test`
24 tests, and they exit non-zero on failure (verified by deliberately breaking one).
- 14 parser cases, including the four real notifications from the user's phone.
- 10 sync cases: incremental push sends nothing when unchanged, only edited records are sent, local
  deletes become tombstones, remote tombstones apply, **an older remote record cannot clobber a
  newer local one**, and meta fingerprints are stable.

### Not verified
Live sync against a real Firebase project. The diff/merge logic is unit-tested and the app is
verified to run untouched with Firebase unconfigured (the 555 KB SDK chunk is never even fetched),
but no data has actually moved between two devices. That needs the user's project.

## M15 — Custodial accounts, instalment debts, and the monthly cycle ✅ done

The user supplied a product brief (originally written for Flutter; **staying on React** — see
memory) plus real figures. Two of those answers invalidated existing behaviour.

### The net-worth number was comfortingly wrong
PBE is **custodial** — the money isn't his, and anything taken out must be restored. The old model
summed every balance and reported **+RM 13,786**. Honest position: **−RM 2,857.54**. An app whose
purpose is to make overspending harder was displaying the single most reassuring possible number.

`src/utils/networth.js` gives an account a `kind`:
- `own` — balance is an asset; a target below balance is a **savings goal**, not a debt.
- `custodial` — balance is **excluded** from net worth, and the shortfall against target **is** a
  debt, because it has to be paid back.

Real position now: own cash RM 244.64 (TNG + GX + HLB), owed RM 3,102.18 (RM 1,937.60 back to PBE +
RM 1,164.58 SPayLater), held-not-owned RM 13,331.40.

### Instalment debts
SPayLater isn't a flat number — Sep 299.30, Oct 246.06, Nov 246.08, then 18 × 20.73 from December:
**21 instalments, RM 1,164.58, ending 2028-05-10**. Debts now carry an optional `schedule`, so the
outstanding total is derived rather than typed, and Module 4's waterfall has real data. Editing a
scheduled debt deliberately does not flatten its instalments.

### Monthly cycle (`src/utils/cycle.js`)
The month starts on **payday, the 10th** — not the 1st. Everything in modules 1–3 depends on it.
The trap: a date before the 10th belongs to the *previous* month's cycle; getting that backwards
resets the budget nine days early, every month.

Income sources carry a `kind` too, because the pass-through question can't be inferred: flagging the
friends' rent share as `passthrough` versus `income` moves spendable money by RM 1,300.

### Tests — 75 total
Parser 14, sync 10, cycle 30, net position 21. Cycle tests cover the pre-payday boundary, year
rollover, February and leap years, never returning zero days remaining, and a floor at zero so an
overspent cycle can't produce a negative daily allowance. Net-position tests include an explicit
regression asserting the old model's wrong answer.

Deferred at the user's request: the LLM "toxic manager" (module 5).

## M16 — Payday router UI (Module 1) ✅ done
`CycleView.jsx` — the screen `cycle.js` and `networth.js` existed to feed. Third tab in Money,
alongside 今天 and 户口欠款.

- **Daily safe limit is the headline number**, derived every render from
  `computeCycleBudget()` — never a value the user types. Shows spendable income, committed
  outgoings, this cycle's spend, what's left, and the split across the days remaining, plus today's
  spend against today's share.
- **Income sources carry the `kind` flag** (真收入 / 代收代付) from `cycle.js`, surfaced as a plain
  select with the pass-through consequence spelled out inline, since the wrong choice silently
  moves RM 1,300 of spendable money either way.
- **SPayLater's instalments are pulled from the debt schedule automatically** for any due date
  landing inside the current cycle — not re-entered as a manual allocation. Auto-imported rows are
  visually distinct and carry no edit/delete controls, specifically to stop them drifting out of
  sync with the schedule that is the source of truth. Verified live: adding a due date inside the
  real current cycle made a "SPayLater 分期" row appear automatically and the committed total
  updated correctly (250 + 400 + 55.50 = 705.50).
- **"Paid" is stamped per cycle** (`paidFor: cycle.start`), not a permanent flag — so a fixed cost
  marked paid this month reads as unpaid again next month without any manual reset, and a stale
  "paid" from three cycles ago can't be mistaken for current.
- Fixed costs count toward the limit **whether or not they're marked paid** — an unpaid bill is
  still owed, and the daily figure has to reflect that.

Verified live against the real accounts/debts/income data: RM 1,500 spendable, RM 650 committed,
daily limit RM 29.31 on day 3 of 31. Toggling an allocation's paid state, adding/editing/deleting
income sources, and the auto-instalment pull were all exercised in the running app, not just unit
tests. No horizontal overflow on a 375px viewport with three tabs. No console errors.

## M17 — History browser + variable-amount bills ✅ done
User asked two direct questions that exposed a real gap and a real limitation.

### The data was there; there was nowhere to look at it
Every meal/workout/expense has carried a `date` since the M13 schema change, and the rollover stopped
deleting them — but the only place in the UI showing anything beyond today was the Dashboard's 7-day
chart. Older days were fully recorded and completely unreachable.

`HistoryModal.jsx` — opened from a new "历史" button next to the trend chart. Two-step flow in one
modal: a reverse-chronological day list (merging `history` summaries with today if it has unarchived
activity) showing kcal/sets/spend/XP per day, then tapping a day shows every individual meal, set,
and expense logged on it. Required threading `allMeals`/`allWorkouts`/`allExpenses` — the *unfiltered*
record arrays — down to Dashboard, which previously only received the today-filtered views.

### Fixed vs variable bills
"固定支出" only ever held one flat `amount`. That's correct for rent or a subscription, wrong for
electricity or water — bills that genuinely change and usually aren't known until they arrive.
Forcing one number onto both meant a variable bill sat wrong all cycle, or had to be re-created as a
new allocation every month with its history lost.

`cycle.js` gained `resolveAllocationAmount()` and `isEstimated()`. A variable allocation carries an
`estimate` (so the daily limit is computable from day one) and an `actuals` map keyed by
`cycle.start` — filled in via a dedicated small modal (separate from editing the allocation itself,
since confirming a bill is a far more frequent action than renaming it) once the real figure is
known. Nothing is overwritten across cycles; a running actuals history is a free byproduct. Rows
running on an estimate are shown dashed with a "预估金额" label so it's visually obvious the number
isn't final yet.

Also fixed in passing: a Dashboard quick-action still read "TNG Auto Test", a name orphaned since M8
removed that simulated feature — the button worked, the label was just wrong.

### Tests — 84 total (9 new)
9 new cycle.js cases: falls back to estimate with no actual yet, actual for this cycle overrides the
estimate, **a different cycle's confirmed actual does not leak into this one**, fixed allocations are
untouched by any of the machinery, and a variable allocation's actual flows through
`computeCycleBudget()` the same as a fixed amount.

Verified live end-to-end, not just via unit tests: added a variable "TNB 电费" allocation with a
RM 120 estimate, confirmed via the modal at RM 143.20, watched the row switch from dashed/预估 to the
confirmed figure, and watched the overspent warning correctly total RM 147.40 (143.20 + a seeded
RM 4.20 expense) against zero seeded income. History list sorted correctly across multiple seeded
days, day-detail showed the right meals/workout/expense for the selected date, and the back button
returned to the list. No horizontal overflow at 375px. No console errors.

## M18 — Recurring bills vs debt, and reimbursements ✅ done
User raised two more precise distinctions.

### Recurring bill ≠ debt
"月付是一定的除非取消，欠款是下个月一定要还的" — a subscription has no end date and keeps recurring
until you cancel it; a debt instalment counts down to zero on its own. The underlying data already
kept these separate (`allocations` = manual, open-ended; `debts[].schedule` = finite, auto-pulled),
but the UI showed both mixed into one "固定支出 Fixed" list with no visual distinction — the exact
complaint. Split into two sections in `CycleView.jsx`:
- **固定月费 Recurring** — manual allocations, subtitle reads "未付 · 除非取消，每期都会算".
- **欠款分期 Debt** — auto-pulled from debt schedules, subtitle reads "还完就不会再出现", no
  edit/delete here (redirects to 户口欠款, the actual source of truth), only shown when at least one
  instalment falls in the current cycle. `Section`'s "新增" button is now optional — a button that
  did nothing would have been worse than no button.

### Reimbursements ("我还钱朋友才转我")
Fronting a group dinner then getting paid back is a **reimbursement**, not new income. Logging the
payback as income would double-count the money: once as the original expense, again as "new" income.

Modelled as a **negative expense amount** rather than touching every summation site individually.
Verified first that this is safe: every total in the app (`totalTodaySpend`, `spentThisCycle`,
`computeDayXP`'s totalExpense, the Overview card, the AI chat reply) is a plain `sum + item.amount`
reduction, so a negative entry nets against the spend it reimburses automatically, everywhere,
without each site needing to know refunds exist — confirmed by grepping every `.amount` summation
in the codebase before writing a line of UI.

- Manual entry form gained a **我出的钱 / 别人还我** toggle. The amount field always takes a positive
  magnitude (kept the existing `min="0.01"` validation); the toggle decides the stored sign.
- **Category breakdown explicitly excludes refunds** — a −RM75 "Food & Dining" slice reads as
  confusing, not informative — and its percentage denominator is the positive-only subtotal, not the
  signed total, so percentages can't go negative or over 100%.
- Expense rows (today's log and History's day-detail) show refunds with a **"退" badge, "退款" tag,
  and green "+RM"** instead of the default red "-RM" — fixed a related display bug where a naive
  `- RM {amount}` on a negative amount would have rendered as "- RM -75.00".
- The budget progress bar width is now floored at 0 in addition to capped at 100 — a net-refund day
  driving `totalTodaySpend` negative would otherwise have passed a negative width straight into CSS.

### Tests — 86 total (2 new)
`reimbursement nets against the original spend` and `available reflects net cost, not gross spend`,
added to the same fixture already used for in/out-of-cycle spending so the comparison is exact.

Verified live end-to-end: logged a RM100 "Group Dinner", then RM75 back from "Ah Meng" via the
refund toggle — today's headline correctly dropped to RM 25.00 net, category breakdown showed
"Other RM 100.00 (100%)" (refund excluded, not diluting the percentage), the expense row showed the
退/退款/green-plus treatment, editing the refund entry correctly prefilled the toggle and showed the
magnitude as positive, and 本月 cycle view's "本周期已花" also read RM 25.00 — confirming the netting
reaches all the way from a single form submission up through the cycle budget. Also seeded a debt
instalment inside the current cycle and confirmed 固定月费/欠款分期 render as two visually and
textually distinct sections. No horizontal overflow at 375px. No console errors.

## M19 — Projects: tracking who still owes you ✅ done
Extends M18's reimbursement mechanism: "假设我还了100块...我想要可以之后好像朋友还钱了，就把他归类
为这个项目底下" — front money once, then file every later repayment (however many, however late)
under that same original expense, and see who specifically hasn't paid yet.

### Not a new collection
A project is an expense with `isProject: true`; a repayment is the existing refund mechanism (a
negative expense, M18) carrying `repaysExpenseId` pointing back at it. `src/utils/projects.js`:
- `getProjects(expenses)` — every project, with `repaidAmount`/`outstanding`/`isSettled` derived by
  summing linked repayments. Nothing is stored redundantly; a project's status is always computed
  fresh from the ledger, so it can't drift out of sync with the expenses that back it.
- `getOpenProjects` — unsettled only, feeds the repayment dropdown.
- `getDebtorStatus(project, expenses)` — optional per-person breakdown. A project can carry
  `debtors: [{name, share}]`; repayments are matched to a debtor by name (trimmed, case-insensitive).
  Entirely additive — a project with no debtor list still works, just without a "who owes" view.

Because repayments can land on a day after the original expense (someone pays back next week), every
one of these functions takes the FULL expense list, never the today-filtered view — this is the same
lesson from the History browser's own construction (M17): scoping to "today" for anything that must
persist across days silently truncates it.

### UI
- Marking an expense as a project (我出的钱 side only) reveals an optional debtor editor — dynamic
  name+share rows, add/remove. Shares don't have to sum to the total; names can be left blank (the
  project still tracks an aggregate total, just without per-person status).
- Repaying (别人还我 side) gains an optional "还哪个项目" dropdown of open projects. Selecting one
  shows quick-select chips for each unpaid debtor — tapping one autofills the exact spelling on the
  debtor list, because matching is by name string and a typo would silently fail to mark that person
  paid.
- A **进行中的项目** section sits above the expense log, deliberately NOT scoped to today — a project
  created days ago must keep showing here with live progress until settled, or there'd be nowhere
  left to see it once its original expense ages out of "today"'s view. Shows aggregate progress plus
  a chip per debtor (✓ or "还差 RMx").
- The expense log itself shows inline project progress on the fronting row, and "还「X」的钱" on
  linked repayments. History's day-detail carries the same treatment, computed from the full ledger
  so a project's progress reflects *today's* true state even when looking back at the day it started.

### Bug caught by this work, unrelated to projects directly
History's "does today have anything to show" check tested `todayStats.totalExpense > 0` — a day
where spend and reimbursement net to exactly zero (front RM90, get all RM90 back same day) made a day
with **four real transactions** evaluate as empty and vanish from the History list entirely. Fixed by
checking whether any expense record exists for today, not whether the signed total is non-zero.
Verified live: the exact RM90-fronted-and-fully-repaid-same-day scenario now correctly appears in
History with all four records visible.

### Tests — 108 total (19 new in `test-projects.mjs`)
Covers: repayment aggregation excludes unrelated projects and unrelated refunds; overpayment floors
outstanding at zero and marks settled; a settled project drops out of `getOpenProjects`; per-debtor
status splits a payment across two different days and mismatched case and still sums correctly; an
unmatched repayment (from a name off the debtor list) still counts toward the project total but is
never mis-attributed to someone else; a project with no debtor list degrades to an empty array rather
than throwing; overpaying one person's share floors their `owing` at zero.

Verified live end-to-end: created "Group Dinner" RM90 with three named debtors at RM30 each, watched
all three appear as owing chips, repaid Ah Meng via the quick-select chip (correctly linked
`repaysExpenseId`, chip flipped to ✓, project progress updated to 30/90), repaid the remaining two,
watched the project disappear from 进行中的项目 once settled and the fronting row switch to
"已结清 · 收回 RM90.00", and confirmed today's net spend correctly read RM0.00 (90 − 30 − 30 − 30).
No horizontal overflow at 375px. No console errors from the app itself.

## Audit pass (after M0–M6) ✅ done
A deliberate hunt for things that *looked* finished but weren't. Found and fixed three real bugs:
1. **Rest timer died on tab switch.** `SportsModule` unmounts when you navigate away, taking the timer with it — so checking your calories mid-workout silently killed your rest countdown and session stopwatch. Timer state now lives in `App.jsx` and keeps running across tabs. The Overview "Gym Rest Timer" quick action now actually starts a 60s timer instead of only switching tabs.
2. **The TNG listener ON/OFF toggle was a lie.** It only changed colors and label text — auto-detect still fired when "OFF". It now genuinely gates both auto-detect buttons (manual receipt scan stays available, since OCR doesn't depend on the notification listener) and persists across refreshes.
3. **Manual meal entry fabricated macros.** Every manually logged meal was hardcoded to 15g protein / 35g carbs / 10g fat regardless of what you ate — which quietly corrupted the (now user-configurable) macro bars. Manual entry and edit now take real macro values.

Also: `npm run lint` is clean (zero warnings) and `npm run build` succeeds.

## Honesty pass ✅ done
The app was overstating itself. Two fixes:

**Removed the fake seed history.** Six fabricated days shipped in `App.jsx` to make the trend chart look populated on first load. They also fed the XP formula — measured on real storage, **450 of 530 XP (85%) came from days the user never logged**, inflating the badge to "Level 6". Seed is deleted; `purgeDemoHistory()` runs at module load (not in an effect — that would race Dashboard reading `lastSeenLevel` during render) to strip it from existing storage and reset the level high-water mark so confetti isn't suppressed. Level now reflects only real activity; a fresh user starts at Level 1. Chart shows an honest empty state until there's a real day to plot.

**Marked simulated features as Demo.** `.demo-badge` / `.demo-note` styles in `index.css`, applied to the meal scanner, TNG interceptor, receipt OCR, and AI Coach — each with a plain-language note saying what it actually does. Also rewrote the misleading copy: "Listening for com.touchngo.ewallet alerts" → "Simulated — needs a native Android app to be real"; "Upload TNG Payment Screenshot" → "Tap to simulate a receipt scan"; the AI Coach's opening line now discloses it's keyword-matched.

What is *not* fixed by this pass: the simulations are still simulations. Real meal/receipt scanning needs M5's API key; real TNG interception needs a native Android app and is not achievable in a web build at all.

## Honesty pass, round 2 ✅ done
**Seeded "today" data removed.** Same bug as the seed history, missed on the first pass: a brand-new user's first screen showed 3 meals, 3 gym sets, and RM 30.20 they never logged — worth 80 XP. Verified by clearing storage and reloading. Defaults are now empty; a new user starts at Level 1 with 0 XP and zeroes across the board.

**Multi-day rollover gap fixed.** Skipping days used to leave no trace, so the chart drew a straight line across an absence — reading as "no change" instead of "you logged nothing". Skipped days now backfill as explicit zero-days (`datesBetween`, capped at 30). First attempt had a bug caught in testing: the backfill duplicated a date that already had real data. Now it skips existing dates and sorts by date, since the chart reads history positionally.

**Remaining hardcoded fakery replaced with real behavior:**
- `Hello, Alex` → tap-to-edit name, persisted as `userName`; unset shows "Hello there"
- Notification bell (permanently "You're all caught up!") → real alerts computed from today's data: over calorie limit, approaching limit, over budget, rest complete. Red count badge. Verified by forcing limits below actuals — badge showed 2 with correct figures.
- `Personal Pro Edition` (a tier that does not exist) → "Saved on this device only", which is true and tells the user something useful
- `N kcal Burned` → `~N kcal est.`, with a code comment stating the formula is a placeholder not based on body metrics

## M20 — Impulse sandbox: a 48-hour cooldown on non-essential spending ✅ done
Module 2 of the [[lifemanager-firewall-app-spec|firewall spec]]: a non-essential purchase (game
skins, a gadget, a big meal out) doesn't get logged straight into expenses. It becomes a pending
request that sits in a mandatory 48-hour freeze, and can only become a real expense once that time
has actually elapsed on the wall clock.

**`src/utils/impulse.js` — pure functions, no UI, no mocked clock needed to test them.**
`hoursRemaining`/`isUnlocked`/`formatRemaining` all take an explicit `now` parameter and derive
everything from a request's fixed `createdAt` timestamp — never from a counter that ticks down only
while the app happens to be open, so closing and reopening the app doesn't reset the wait, and the
countdown survives a page reload.

**No early-approve path exists.** `ImpulseSandbox.jsx` renders exactly two actions on a locked
request — wait, or cancel. The "确认购买" (confirm purchase) button is only rendered once `unlocked`
is true; there's no hidden override, because approving early is exactly what this module exists to
prevent, and cancelling early is the *wanted* outcome (an impulse that faded is a win, not a loss).

**The spending-impact preview shows throughout the cooldown, not just at the end** — seeing what the
purchase would do to the daily safe limit (via `projectImpact` from M16's cycle engine) repeatedly
during the 48 hours is part of the friction, not a one-time gate at approval time.

Wired into `CycleView`, sitting right after the daily-limit headline. Approving converts a request
into a real expense dated *today* (the day it's actually confirmed), tagged with a
`冲动沙盒 · 等满 48 小时后确认` source note so it's visibly distinguishable from an ordinary manual entry
in the expense log and History.

### Tests — 121 total (13 new in `test-impulse.mjs`)
Covers both boundaries exactly: a fresh request has the full 48h and is locked; a request exactly
48h old is unlocked with nothing left to count down; remaining time never goes negative for an old
request; the minutes-only display doesn't misrender as "0 小时 X 分" near the end. Also verified that
repeatedly checking an in-progress request only ever advances the countdown, never resets it.

Verified live end-to-end: submitted "Razer 键盘" RM150 with no income configured — impact preview
correctly read "会超支 RM150" (goes negative) since the daily safe limit had nothing to divide.
Confirmed the locked state shows only 不买了/no confirm button. Backdated the request's timestamp
past 48h and confirmed the UI flipped to "冷却结束 — 可以决定了" with 确认购买 now visible; clicking it
cleared the sandbox back to its empty state and the RM150 appeared in 今天's expense log with the
sandbox source note, correctly pushing the daily total to RM150 / RM80 (RM70 over). No console
errors. One lint warning (unused `hoursRemaining` import in `ImpulseSandbox.jsx`) fixed before
verification.

## M21 — Personal Care category, and TNG income no longer a dead end ✅ done
From a design discussion: the TNG parser's `income` bucket (reload/refund/received wording) only
ever answered "is this spend or not" — once it decided "not spend", it stopped, and the money just
vanished from the app whether it was your own top-up or a friend paying you back. That's an
asymmetry against `needsPurpose`, which already interrogates every outgoing transfer for what it
was for.

**Two additions, kept deliberately small — not the 20+ categories of a Mint-style taxonomy, since
this is a single-user budget, not a household finance product:**

- **`Personal Care` category** (`tngParser.js`) — salons, barbers, nails, spa/massage, laundry/dry
  clean. Real gap: these were all falling into `Other`, which exists specifically to *provoke* a
  question about unrecognised spending (M8.1), so burying real recurring self-care spend there was
  diluting that signal. Keyword rules placed next to `Health` in `CATEGORY_RULES` (`salon`, `barber`,
  `dobi`, `按摩`, `洗衣`, etc.) — no ordering conflicts, the terms don't collide with any other list.

- **TNG "money in" now routes instead of dead-ending.** `MoneyModule.jsx` renders two buttons under
  an `income` verdict: **自己转的钱 · 不用记** (your own money moving accounts — dismiss, nothing
  logged, matches today's behaviour but now an explicit acknowledgement instead of silent) and
  **别人给的钱 · 去记一笔** (someone else's money — opens the Add Expense modal pre-filled into
  **refund mode** with the parsed amount).

**Why refund mode, not a new income-source entry.** This was the actual design decision, and it
corrects something floated during planning. `incomeSources` (M16's payday router) is summed into
*every future cycle unconditionally* — it models a recurring source like a monthly allowance, not a
one-off event. A single "received RM100" notification is not evidence of a repeating income; filing
it there would have the app silently re-counting today's one-off gift as spendable money every month
forever. The refund mechanism (M18) is exactly the right shape instead: a negative expense, scoped
to the current cycle only, nets against `spentThisCycle`, optionally linkable to a project but not
required to be. So both "friend repaid a specific fronted expense" and "friend just gave me money"
correctly land in the same place — the only real distinction (whether a project exists to link it
to) was already handled.

### Tests — 123 total (2 new in `test-parser.mjs`)
Two Personal Care cases (English salon payment, Chinese 美甲工作室) confirming the merchant keyword
rule fires and the category shows up correctly.

Verified live end-to-end: pasted the Reload sample notification, confirmed the new prompt rendered
with both buttons instead of the old dead-end message; clicked 别人给的钱 and confirmed the Add
Expense modal opened already in 别人还我 mode with RM100 pre-filled in the amount field and
`Personal Care` present in the category dropdown; submitted it and confirmed today's log showed it
under "收到的款项" with the 退 badge and green `+RM 100.00`, and the daily totals netted correctly
(RM -100.00 spent, RM 180.00 remaining against an RM80 cap). Separately pasted a reload notification
and clicked 自己转的钱 · 不用记, confirmed the reader closed and nothing new appeared in the log — the
existing RM100 entry from the first test was unchanged. No console errors either time.

## M22 — 本月's income/spend totals no longer hide behind setup ✅ done
User's complaint: 本月 could show a real income source with zero spending visible anywhere on the
tab — "本月还有收入，却没有消费记录不是很奇怪吗". Root cause: the only place totals lived was inside
the daily-safe-limit card, and that whole card is gated behind `hasSetup` (at least one income
source or allocation configured) because computing a *daily limit* genuinely requires both numbers.
But "how much came in and how much went out this cycle" doesn't need that setup — it's answerable
straight from the expense log — so gating it behind the same condition hid real data for no reason.

**`cycle.js`** — `computeCycleBudget` now also returns `grossSpentThisCycle` and `receivedThisCycle`,
split out from the existing `spentThisCycle` because that figure is a *net* (a refund's negative
amount already cancels part of it out) and can't answer "how much actually left the wallet" or "how
much came back in" on its own — this is exactly the M21 discussion's conclusion made visible:
ad-hoc money in (refunds, repayments, gifts) shows as `receivedThisCycle`, separate from
`spendableIncome`'s recurring sources, never merged into one number.

**`CycleView.jsx`** — a new summary card renders unconditionally at the top of 本月, above the
daily-limit card: **本月总收入** (`spendableIncome`, plus a note for `receivedThisCycle` when
non-zero) and **本月总支出** (`grossSpentThisCycle`). Visible from the very first expense, with or
without any income/allocation setup.

### Tests — 125 total (2 new in `test-cycle.mjs`)
Reused the existing fronted-dinner-then-refund fixture and added checks that `grossSpentThisCycle`
stays at the full RM100 (not netted down to RM25) and `receivedThisCycle` reports the RM75 refund as
a positive figure.

Verified live end-to-end: seeded a RM100 expense and a RM75 refund with **no income sources and no
allocations configured** — confirmed the new card still rendered (本月总收入 RM0.00 with "另外收到
RM75.00" note, 本月总支出 RM100.00) while the daily-limit card below correctly still showed "—" since
that calculation genuinely can't run yet. Then added an Internship income source and confirmed 本月总收入
updated to RM1,000.00, the RM75 note stayed separate, 本月总支出 stayed at the gross RM100.00, and the
daily-limit card came alive (RM34.82/day) with its own existing breakdown unaffected. No console errors.

## M23 — 本月总览 four ways: category, progress, pace, and vs last cycle ✅ done
Follow-up to M22: two flat numbers ("still not detailed enough, look at what mature software does")
wasn't the finished job. Picked four Mint/YNAB-style additions, all four requested at once. Before
building, confirmed with the user this costs nothing extra against Firebase — every one of these is
a pure client-side computation over `expenses`/`incomeSources`, already fully synced locally with no
query limits (M13/M14), so there are no new documents, reads, or writes anywhere in this milestone.

- **`cycle.js`**: two new pure functions. `getPreviousCycle(cycle)` — the cycle immediately before
  this one, handling the year rollover the same way `getCycle` already does. `grossSpentByDayIndex`
  — gross spend (positive only) in a cycle *up to and including* a given day index. This exists
  specifically so "vs last cycle" compares fairly: comparing today's partial cycle (day 4 of 31)
  against last cycle's *final* total would always look artificially good, since an unfinished cycle
  can't have spent as much as one that ran its full length. The comparison is same-day-index vs
  same-day-index.
- **收支进度条** — % of `spendableIncome` spent so far (`grossSpentThisCycle / spendableIncome`),
  same floor/cap/color pattern as the existing daily-budget bar. Only rendered when income is
  actually configured — a bar dividing by RM0 is not a percentage.
- **每日平均 Avg/day** — `grossSpentThisCycle / (dayIndex + 1)`, always computable, no gate needed.
- **跟上个周期比** — only rendered when `expenses` actually has a record predating this cycle's
  start; otherwise "spent RM0 less than last cycle" would read as an achievement when really there's
  just no history yet to compare against.
- **本月分类明细** — a cycle-scoped twin of the existing "Spend by Category" card (which only ever
  covered today). Same exclude-refunds-from-both-slices-and-denominator rule as M18's daily version,
  for the same reason: a negative slice reads as confusing, not informative.

### Tests — 129 total (5 new in `test-cycle.mjs`)
`getPreviousCycle` checked across a normal month and a year rollover. `grossSpentByDayIndex` checked
against a fixture with entries before, on, and after the cutoff day (only before/on count) and a
separate fixture confirming a refund is excluded rather than netted against the gross figure.

Verified live end-to-end with a hand-checked fixture: RM1,000 income, four positive expenses this
cycle (RM50/20/30/45 across Food & Dining/Transportation/Personal Care) plus a RM10 refund, and three
prior-cycle expenses landing on/before day-index 3 (RM40/60/20) plus one past the cutoff (RM500,
correctly excluded). Every rendered number matched the hand calculation exactly: 本月总支出 RM145.00
(gross, unaffected by the refund), 另外收到 RM10.00, 进度条 14% of RM1,000, 每日平均 RM36.25 (145÷4),
跟上个周期比 "多花 RM25.00" (145 − 120), and the category breakdown (Food & Dining RM80/55%, Personal
Care RM45/31%, Transportation RM20/14%) summing to exactly RM145 with the refund correctly absent
from every slice. The existing 本周期已花 (net RM135) and daily-limit numbers below were unaffected by
any of this — the two live side by side, gross above for "how much did I actually spend" and net
below for the budget math that needs the refund netted in. No console errors.

## M0 — Shared data foundation ✅ done
- `localStorage` persistence for meals, workouts, expenses, budget, calorie limit (`src/utils/storage.js`)
- Daily history log (`history`) with day-rollover archiving in `App.jsx`
- Real Level/XP gamification engine (`src/utils/gamification.js`), shared by every module since they all read/write the same persisted state

## M1 — Overview (Dashboard) ✅ done
- Removed the decorative fake phone status bar
- Real Level/XP badge (was hardcoded "Level 8")
- 7-Day Trend chart (calories/spend/sets vs. daily target)

## M2 — Diet module ✅ done
- Meals are now editable (click a logged meal to open a pre-filled edit form) — was add/delete only
- Macro targets (protein/carbs/fat) are now editable inline instead of hardcoded 140g/220g/65g
- Bonus: fixed a real bug found while testing — the day-rollover effect in `App.jsx` could double-archive a day under React StrictMode's dev double-invoke; guarded with a ref

## M3 — Sports module ✅ done
- Logged sets can now be deleted (parity with Diet/Money)
- Routines are now persisted and manageable — add a custom routine (name + comma-separated exercises), delete any routine (always keeps at least one; active routine falls back sanely if deleted)
- "Calories burned" formula left as-is — a rough estimate is inherent without real biometric input, not something to "complete"

## M4 — Money module ✅ done
- Added a "Spend by Category" breakdown (sorted highest first, with % bars), shown whenever there are logged expenses

## M5 — AI Assistant (deferred — needs credentials)
Currently a keyword-matching canned-response bot, not a real LLM. Decided approach when this resumes: a local Node backend holding an Anthropic API key (model: Haiku 4.5, chosen for cost) plus Google Drive daily backup via OAuth. Blocked on:
- An Anthropic API key (console.anthropic.com) — not yet obtained
- Google Cloud OAuth credentials for Drive (Cloud Console: project + Drive API + OAuth consent screen + client ID/secret) — not yet obtained
Resume once both exist. Until then, AI Coach stays the simulated keyword-response bot.

## M6 — Cross-cutting polish ✅ done
- `README.md` rewritten to describe the actual app instead of Vite boilerplate
- Removed the now-unused `.status-bar` CSS rule left behind in `index.css`
- Manual QA pass across all 4 tabs in a fresh browser tab — no console errors, all module interactions verified end-to-end

## M7 — Mobile packaging + cloud backup (deferred)
- Capacitor/Android wrapper
- Google Drive backup — only makes sense once there's a native shell to authenticate from
