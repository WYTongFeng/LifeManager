# Data schema

One shape, two places: `localStorage` on the device and Firestore in the cloud. Keeping them
identical is what makes sync, backup and restore all reuse the same code.

## The problem this replaces

The original model stored **"today's list"**, not **records**. Every midnight the rollover called
`setMeals([])` / `setWorkouts([])` / `setExpenses([])` and kept only a summary — so a set of
`Bench Press 80kg × 10` collapsed into the number `4`, and a `RM 16.50` at Pelita became an
anonymous total. There was no gym history, no spending history, and AI chat wasn't stored at all.

Records are now **append-only and date-stamped**. "Today" is a filter, not a container. The rollover
writes a summary and **deletes nothing**.

---

## Documents vs collections

The split is driven by one hard limit and one cost consideration.

**Firestore caps a single document at 1 MiB.** Anything that grows without bound must be a
collection, or the app breaks silently once it's full. A year of workouts, or a long chat history,
would get there.

**Reads are billed per document.** Things that are small, bounded, and always needed together are
cheaper as one document than as many.

| | Kind | Why |
|---|---|---|
| `meta/*` | **document** | Small, bounded, read together on startup — one read |
| `meals`, `workouts`, `expenses`, `notes`, `dailyStats` | **collection** | Grow forever; need date-range queries; per-item writes |

A collection has a per-record merge to fall back on; a `meta/*` document does not, and that
asymmetry has teeth in both directions:

* **Up** — a meta document is written with `{ merge: true }`, never a plain `set()`. `readMetaDoc()`
  returns only the keys the device actually has, and a plain `set()` replaces the whole document —
  so a phone that had never opened the accounts screen uploaded an empty `meta/accounts` and
  **deleted the accounts from the cloud**. The other device never noticed: its own fingerprint
  hadn't changed, so it had nothing to re-send.
* **Down** — a pull applies a meta document only when `hasUnpushedMetaChanges()` is false, i.e. the
  fingerprint written at push time still matches what's on disk. Otherwise the cloud copy would
  overwrite edits made here that haven't gone up yet.

---

## Layout

```
users/{uid}/
  meta/settings        calorieLimit, macroTargets{protein,carbs,fat}, dailyBudget, userName,
                       clipboardWatchEnabled, bodyWeightKg, weightUnit,
                       ageYears, heightCm, sex              body profile — feeds calcBMR()
                       activityLevel, dietGoal,             'sedentary'|'light'|'moderate',
                       autoCalorieTarget                    'cut'|'maintain'|'bulk', boolean
                                                            (M45 energy balance, see below)
  meta/gamification    archivedXp, lastSeenLevel
  meta/merchants       { "<merchantKey>": "<category>" }   learned categories
  meta/accounts        [{ id, name, type, kind, countsToNetWorth,
                          openingBalance, openingAt, target, isDefault,
                          packages[], archived }]
  meta/debts           [{ id, creditor, amount, note, dueDate, accountId, schedule[], plan{} }]
                       `schedule[]` present = a FIXED debt (SPayLater): the amount is decided for
                       you and the cycle reserves whatever instalment falls inside it.
                       Absent = FLEXIBLE: no monthly figure exists until you set one, and
                       `plan` holds it per cycle — { '2026-08-10': 200 } — the same
                       cycle-keyed shape a variable allocation's `actuals` uses, so this
                       month's decision says nothing about next month's.
                       What is still owed is DERIVED, never stored: the stated figure minus
                       every expense carrying `repaysDebtId`. See src/utils/debts.js.
  meta/routines        [{ id, name, exercises: [{name, targetSets}], durationEst }]
                       (exercises used to be a bare string[] — old persisted
                       routines are normalized on read, see SportsModule.jsx's
                       normalizeExercise())
  meta/payday          incomeSources[], allocations[]           (module 1, M16)
                       allocation: { id, label, amount | (variable, estimate, actuals),
                                     frequency, dueDay, dueMonth, onceDate,
                                     accountId, costing, paidFor, startDate, endDate }
  meta/impulse         pendingRequests[]                        (module 2, M20)
  meta/body            weightLog[{ date, kg, at }]               body-weight readings (M52)
                       ONE reading per date; re-weighing the same day replaces it. `kg` is
                       stored to 1dp regardless of the display unit, like everything else.
                       Its own document, not a field on meta/settings: it is the only meta
                       value that grows, and a meta doc is pushed WHOLE — filing it under
                       settings would rewrite the entire weigh-in history every time the
                       calorie limit changed. Capped at MAX_ENTRIES (1000, ~3 years of daily
                       weigh-ins) so the 1 MiB document limit still holds. See bodyWeight.js.
                       `bodyWeightKg` stays in meta/settings and keeps its meaning: the
                       CURRENT weight that every calorie formula reads. This is the history,
                       and an unchanged number records nothing — see the note below.

  meta/notesMeta       noteCategories[{ id, emoji, label }]      user-made note categories (M54)
                       The seven built-in ones are code, not data — only what the user adds
                       lives here. `id` is a stable ASCII slug and every note stores the id,
                       never the label, so renaming a category doesn't orphan its notes.
  meta/reminders       reminders[]                               (M54)
                       { id, title, note, time: 'HH:MM', startDate: 'YYYY-MM-DD',
                         repeat: 'once'|'daily'|'weekly'|'monthly'|'yearly',
                         enabled, done, at, updatedAt }
                       `startDate` + `time` are the ONLY anchor. Weekday, day-of-month and
                       month are derived from it — storing `repeat:'weekly'` alongside a
                       separate `weekday` lets the two disagree, with nothing to say which
                       wins. `done` is meaningful only for 'once'; a repeating reminder is
                       never done, the next one is always coming. See reminders.js.
  meta/specialDays     specialDays[]                             (M54)
                       { id, title, emoji, date: 'YYYY-MM-DD', yearly,
                         remind: 'none'|'same'|'day'|'week', remindTime, at, updatedAt }
                       The YEAR in `date` is load-bearing: it's what lets the app say
                       「第 26 年」. Feb 29 clamps to Feb 28 in common years — a birthday the
                       app skips three years in four is worse than one day early.
                       THREE SEPARATE DOCUMENTS, not one meta/lifehub: a meta doc is pushed
                       and pulled whole, so sharing one would let a reminder edited on the
                       phone clobber a note category edited on the PC.

  meta/moneyCategories moneyCategoryPrefs { custom[], hidden[], renamed{} }        (M55)
                       The user's DELTAS only. The built-in 支出/支入 category lists ship in
                       code (moneyCategories.js) and are deliberately never synced — uploading
                       a copy of the app's own constants would let an old device's stale list
                       overwrite a newer one's.
                         custom   [{ id, label, emoji, kind: 'expense'|'income' }]
                         hidden   [categoryId] — taken out of the pickers, NOT deleted
                         renamed  { categoryId: label } — overrides a built-in's label
                       Expenses store a category ID, never a label, so a rename can't orphan
                       the records filed under it. A built-in can only be hidden, never
                       deleted, for the same reason: a year of 宠物 spending must keep
                       resolving to 宠物 after the category leaves the dropdown.
                       LEGACY: records written before M55 store the old English strings
                       ('Food & Dining'). Those are NOT migrated — LEGACY_ALIASES resolves
                       them on read, which also lands an old record in the SAME pie slice as
                       a new 餐饮 one instead of a second identically-named slice.

  meals/{id}           { date, name, calories, protein, carbs, fat, category, time, at }
                       + { source: 'local'|'ai'|null }    how the numbers were obtained (M45)
                       + { items[] }                      per-component breakdown (M45)
                       + { aiDetected }                   legacy flag, superseded by source
  workouts/{id}        strength: { date, type: 'strength', routineName, exercise, weightKg,
                                   reps, isNewPR, calories, time, at }
                       cardio:   { date, type: 'cardio', activity, durationMin, distanceKm,
                                   calories, time, at }
                       `calories` is null, not 0, when bodyWeightKg is unset — the MET
                       formulas refuse to invent a body weight. `type` is absent on sets
                       logged before M43; anything not 'cardio' reads as strength.
  expenses/{id}        { date, merchant, amount, category, note, source, accountId,
                         paymentMethod, time, at }
                       + { isProject, debtors[] }         money fronted for others
                       + { closedAt }                     project ended by hand (M55). Repayments
                                                          essentially never reach the full amount,
                                                          because whoever fronts the money is
                                                          usually one of the people eating — so a
                                                          project could never settle itself and sat
                                                          in 进行中的项目 showing a debt nobody
                                                          owed. Closing means "nothing more is
                                                          coming, the rest was mine"; that leftover
                                                          (myShare) is what the category breakdown
                                                          and the monthly circle then count.
                                                          Balances and every net total in cycle.js
                                                          are untouched — the money really did move.
                                                          Reversible: deleting the field reopens it.
                       + { repaysExpenseId }              a repayment against one
                       + { repaysDebtId }                 a repayment against a DEBT you owe
                                                          (note the direction: repaysExpenseId is
                                                          someone paying YOU back, repaysDebtId is
                                                          you paying a creditor). Excluded from
                                                          spentThisCycle — see debts.js.
                       + { isAccountTransfer, transferId } half of a transfer pair
  (chats/{id})         REMOVED. The in-app AI Coach called Gemini on prepaid credits that ran
                       out, so it was deleted and replaced by the plain-text export you paste
                       into a free AI chat yourself. Nothing writes this key any more and it is
                       no longer in RECORD_COLLECTIONS; documents already in Firestore are left
                       where they are rather than deleted.
  notes/{id}           { id, title, body, category, pinned, archived,
                         checklist[{ id, text, done }], date, at, updatedAt }
                       A COLLECTION, not a meta doc, for the 1 MiB reason above: notes are
                       the only Life Hub list with no natural ceiling. `title` may be empty —
                       the list falls back to the first line of `body`, because a screen of
                       rows all saying "Untitled" is useless. A note with no title, no body
                       and no checklist text is DELETED rather than stored, so backing out of
                       an accidental 新建 leaves nothing behind. See notes.js.
  dailyStats/{date}    { date, totalCalories, calorieLimit, mealsLogged,
                         totalSets, totalExpense, dailyBudget }
```

`accounts` and `debts` stay as arrays inside one document rather than collections: they're a handful
of items, always read together, and edited as a set. If either ever grows past a few dozen entries,
promote it to a collection.

### Account balances are DERIVED, never stored

`accounts[i].balance` is not a field. It's computed on read as

    openingBalance − (every expense with this accountId, logged after openingAt)

so logging a payment and moving a balance are the same action. `resolveAccounts()` in
`src/utils/accounts.js` folds the result in under the name `balance` for the several consumers
(`computeNetPosition`, the survival banner, the waterfall) that already read it — but nothing may ever
write it back. `stripDerived()` exists at every write site precisely because a persisted stale copy
would outrank the live derivation on the next load.

**`openingAt` is epoch milliseconds, not a date, and 0 is not a safe default.** A balance typed by
hand was already net of past spending; baselining it at t=0 subtracts the entire expense history from
it a second time. An account with no `openingAt` therefore falls back to a session-constant "now"
(`LEGACY_WATERMARK`), which reproduces the pre-accounts behaviour exactly, and the v3 migration
stamps a real one. Correcting a balance later is a **reconcile**: a new `openingBalance`/`openingAt`
pair, never an edit to history.

### A meal's `items[]` is a breakdown, and it must agree with its own totals

A meal logged from a photo or an AI text estimate carries the per-component list the
estimate came from:

```
items: [{ id, name, portion, kcal, p, c, f }, …]
```

It exists because a single number for a mixed plate (杂菜饭 — rice plus three dishes)
is a guess the user can neither check nor correct, while a list can be fixed in a
couple of taps. The UI scales, deletes and appends components and recomputes
`calories`/`protein`/`carbs`/`fat` from the list on every edit.

**The invariant: if `items` is present, its sum EQUALS the meal's totals.** When the
user hand-edits the total instead, `DietModule` drops `items` rather than storing a
breakdown that contradicts its own sum — a disagreeing breakdown is worse than none,
because both numbers then look authoritative. Anything reading `items` may assume the
sum matches; anything writing it must preserve that or drop the field.

`source` says where the numbers came from: `'local'` (offline table, free), `'ai'`
(model estimate), or absent/null (typed by hand). It is shown in the log and fed to
the AI Coach, because an estimate and a weighed figure deserve different trust.

### A weigh-in means someone stood on a scale (M52)

`weightLog` is appended from exactly one place: saving the body-profile modal in 健身. That
modal also holds height, age and sex, so it gets opened and saved for reasons that have
nothing to do with weight — and if every save deposited a reading, the log would fill with
entries nobody measured. A fabricated reading is indistinguishable from a real one once
stored, and the trend drawn through it would be presented as observation.

So `recordWeight` ignores a value equal to the latest reading. The cost is that a genuine
re-weigh at exactly the same number is not recorded; the benefit is that every point on the
curve is a real measurement. Weighing again on the same DATE replaces that date's entry
rather than appending, so "start → end" is never ambiguous.

The same honesty runs through what is computed from it: `changeKg` is `null`, never `0`,
when there is nothing to compare against — "no change" and "we never checked" look identical
as a number and are completely different as a statement.

### The AI spend counter is deliberately NOT in this schema

`ai_call_log` in `localStorage` (raw key, no `lifemanager:` prefix) holds
`{ date, count }` for the shared daily Gemini call cap. It is intentionally outside
`META_DOCS`, `LOCAL_ONLY_KEYS` and this layout: it is a per-device spend guard, not
user data. Syncing it would let one device's usage lock out another, and it has no
business in a backup. It is not written through `usePersistentState`, so
`test-sync-completeness.mjs` never sees it — which is why it is written down here.

### Transfers are a linked pair, not a record type

Moving money between your own accounts is stored as **two** expense records sharing a `transferId`:

```
{ amount: +100, accountId: <from>, isAccountTransfer: true, transferId: <at> }
{ amount: -100, accountId: <to>,   isAccountTransfer: true, transferId: <at> }
```

Every balance is already a signed sum of `amount` per account, so the pair moves both accounts
correctly with no new arithmetic anywhere — and since the two net to exactly zero, every whole-wallet
total (today's spend, the cycle's net spend, an archived day's summary) stays right without knowing
transfers exist at all.

`isAccountTransfer` exists for the places that *do* need to know: anything counting **gross** movement
or building a category breakdown, where an unfiltered +RM100 would read as a purchase. Those are
`grossSpentThisCycle` / `receivedThisCycle` / `grossSpentByDayIndex` (cycle.js), `spendByAccount`
(accounts.js), the Money tab's expense lists and category card, CycleView's category card, and the
Dashboard recap.

The flag is deliberately **not** called `isTransfer`: `tngParser.js` already uses that name for "a
payment to a person", which is the opposite situation — money genuinely leaving your hands.

### Three kinds of negative amount

A negative `amount` means three different things, and confusing them is the most expensive mistake
this schema can make, because two of them look identical on disk:

| shape | meaning | counts as spending? |
|---|---|---|
| `amount < 0` | a **refund** — money back from spending already logged | **yes**, it nets against the total. That is why refunds are stored negative at all. |
| `amount < 0`, `isMoneyIn: true` | an **arrival** — allowance, salary, top-up from outside | **no.** Its budget effect is already owned by `incomeSources`. |
| `amount < 0`, `isAccountTransfer: true` | the incoming half of a transfer pair | **no.** See above. |

Since v6 these are three of the six values of `type` (next section) — read them through `txType`
rather than by inspecting the sign. Use the right predicate of the three below at every "how much
have I spent" site rather than hand-rolling the filter. The daily-budget sites each rolled their own and all of them checked only
`isAccountTransfer`, so on the day an allowance landed the app computed today's spend as a large
negative number and offered its full value as extra headroom — RM 1,267.50 of "budget left" against
an RM 80 budget, on the screens whose only job is to say stop. It also went into the midnight
rollover, which writes that day into `dailyStats` permanently.

### Every record has a `type` (schema v6)

Six kinds, and until v6 none of them was stored — each was re-derived at every call site from four
optional fields plus the sign of `amount`. The call sites drifted, repeatedly and in the reassuring
direction. `type` is stamped on write and read through **`txType(e)`** (`accounts.js`), which falls
back to deriving from the flags **permanently** — a record can arrive unstamped from an old backup
file or a cloud merge from a device on a different version long after any migration has run.

| `type` | how it is recognised without the field | positive or negative |
|---|---|---|
| `transfer` | `isAccountTransfer: true` | either half of a linked pair |
| `income` | `isMoneyIn: true` | negative (it credits an account) |
| `repayment` | `repaysDebtId != null` | positive |
| `bill` | `allocationId != null` | positive |
| `refund` | `amount < 0` and none of the above | negative |
| `expense` | everything else | positive |

Order matters and is not arbitrary: the cases overlap on disk. A transfer half carries a sign like a
refund; an arrival carries a negative amount for the same reason it credits a balance; a repayment
and a bill payment are both positive amounts leaving an account, indistinguishable from shopping
without their link.

**Three predicates, three different questions.** Reaching for the wrong one is the bug this section
exists to prevent, so pick by the question you are actually asking:

| predicate | question | includes |
|---|---|---|
| `isRealSpend` | was this me buying something? | `expense` |
| `isDailySpend` | what a daily budget is about | `expense`, `refund` |
| `isSpendingRecord` | did money leave my pocket? | `expense`, `refund`, `bill`, `repayment` |

A refund is in the middle one because it has to net against the spend it reimburses — otherwise
returning yesterday's RM40 shirt leaves the RM40 in today's total forever. Bills and repayments are
in the last one only: they are real ringgit out, but they were budgeted months ago and are reported
under their own names, so charging them to the day's food money reads as a spree.

### Two links that stop the same ringgit being counted twice

Both were added in schema v6 and both close a double-count that had always been there:

- **`incomeSourceId`** on an arrival — files it under an `incomeSources` entry. That entry's
  `amount` is an *expectation*: it counts until something lands against it, and then the real figure
  counts instead. An arrival filed under **nothing** is reported as 未归类进账 and deliberately does
  **not** move the budget — it may well be the salary already listed, and adding it would count the
  same money twice.
- **`allocationId`** on an expense — says "this payment IS my rent". The allocation already reserved
  that money in `committed` at the top of the cycle, so without the link a logged bill payment was
  charged once as the reservation and again as spending. Setting it also stamps the allocation's
  `paidFor`, because those are the same statement.

### Four independent account flags

| field | question it answers |
|---|---|
| `kind: 'own' \| 'custodial'` | is this money mine at all |
| `countsToNetWorth: boolean` | should the balance count toward savings |
| `autoShortfallDebt: boolean` | should `target − balance` be derived as a debt automatically |
| `type: 'ewallet' \| 'bank' \| …` | what it is — icons and grouping only |

They compose; none replaces another. An account can be entirely yours (`own`) and still be excluded
from savings (`countsToNetWorth: false`) — spending from it still records, its debts still count, only
the asset side is excluded. Folding that into `kind` would have been wrong.

> **Every one of these must be listed explicitly in `normalizeAccount()`.** It builds a new object
> field by field rather than spreading `...a` — which is correct (an unknown field from a future
> build must not reach the balance maths pretending to be one of ours) but makes an omission
> completely invisible. `autoShortfallDebt` was omitted for a whole release: the UI wrote it, the UI
> read it back from raw storage so it *looked* saved, `networth.js` looked for it — and
> `resolveAccounts()` deleted it in between, on every read. Worse, any account edit writes the
> normalized list back, so the flag was destroyed on disk too. `test-accounts.mjs` now covers each
> flag **through `resolveAccounts`**, not by passing hand-built objects to `computeNetPosition`,
> which is exactly how the original tests missed it.

`packages[]` holds the Android notification package names bound to this account. It lives on the
account rather than in a separate mapping table so backup, sync and restore carry it for free.

### There is no schema enforcement — this file and `META_DOCS` ARE the schema
There's no migration system that fails loudly when a new `usePersistentState('someNewKey', …)` is
added somewhere without also registering it in `syncModel.js`'s `META_DOCS` (or `RECORD_COLLECTIONS`
for anything unbounded). It just silently never syncs — which is exactly what happened to
`incomeSources`/`allocations`/`pendingRequests` for several milestones after M16/M20 introduced them,
caught only when the user asked what tables actually exist. **Whenever a module gains a new persisted
key, add it to `META_DOCS` (or `RECORD_COLLECTIONS`) and this file in the same change**, not later.

## Field conventions

- **`date`** — `YYYY-MM-DD` in **local** time, never UTC. `getTodayString()` builds it from
  `getFullYear/getMonth/getDate`; `toISOString()` would shift the day near midnight and file an
  11pm meal under tomorrow.
- **`at`** — epoch milliseconds. The **event** time: when the meal was eaten, when the payment
  happened. It does **not** move when a record is edited, and several things depend on that:
  `movementSince()` compares it against an account's reconcile watermark, and `migrate.js` treats
  `id` as the original `at`. Bumping it on an edit would drag an old expense across a watermark and
  silently subtract it from a balance that already accounted for it.
- **`updatedAt`** — epoch milliseconds, present only on records that have been edited. This is what
  sync compares (`touchedAt()` in `syncModel.js` takes the later of the two), because `at` is
  deliberately frozen. Sync used to key off `at` alone, which meant a record was pushed exactly once,
  at creation — every later edit was invisible to the other device, with no error.
- **`syncedAt`** — epoch milliseconds, written by `pushNow()` on **every** document (records,
  `dailyStats` and `meta/*` alike) at the moment it is uploaded. Cloud-only bookkeeping: it is
  stripped again on the way down and never stored locally. It exists because a pull needs to ask
  "what has been uploaded since I last looked", and **`at` cannot answer that** — `at` is when the
  meal was eaten, always in the past. Filtering the pull on `at` against a watermark the push also
  moved is what made a device stop receiving the other one's data entirely, the moment it pushed
  anything of its own. **A pull may only ever filter on `syncedAt`.**
- **`time`** — a pre-formatted display string (`"11:50 PM"`). Kept because it's what the user saw
  when they logged it; `at` is the machine-readable one.
- **`id`** — epoch milliseconds, and the Firestore document id. Generated by `newId()` in
  `src/utils/num.js`, **not** by a bare `Date.now()`: two records created in the same millisecond
  would otherwise share an id, which means one delete button, one edit, and one Firestore document
  for both. `newId()` returns `previous + 1` on a collision, so ids stay unique and still read as
  timestamps.
- **Numbers that get summed** — every total goes through `num()`/`sumBy()` (`src/utils/num.js`). A
  bare `reduce((s, x) => s + x.field, 0)` turns the **whole** total into `NaN` when one record is
  malformed, and the midnight rollover writes that NaN into `dailyStats`, which is never recomputed.
- **`dailyStats/{date}`** — keyed by the date itself, so a re-run of the rollover overwrites rather
  than duplicating.

## Why dailyStats exists when records are kept

It looks redundant — totals could be recomputed from the records. It isn't, because it captures the
targets **as they were that day**. `calorieLimit` and `dailyBudget` change over time; recomputing
"was I under budget on 3 March" against today's budget would silently rewrite history. The chart and
the XP calculation both depend on that being stable.

## Retention

| Data | Kept |
|---|---|
| meals, workouts, expenses | Everything. ~1–2 KB/day — years fit comfortably. |
| dailyStats | Everything. ~100 bytes/day ≈ 36 KB/year. |

`archivedXp` in `meta/gamification` is now vestigial — history is no longer capped at 30 days, so
nothing ages out. It's still read so that anyone who already accumulated a value keeps their level.

## Migration from the old shape

**v2** — records saved before the dated model have no `date`. They're stamped with `lastActiveDate`
(the day they were logged), not today, which would misfile them.

**v3** — accounts became real (M42). Two steps, and the order matters:

1. `assignAccounts()` files existing expenses against the TNG account, but **only** where
   `paymentMethod` says TNG or is absent. Anything claiming a different method is left unassigned
   rather than guessed at: an unassigned expense renders as a visible 未指定户口 chip and can be
   fixed in one tap, while a wrongly assigned one silently corrupts a balance forever.
2. `baselineAccounts()` then stamps every account with `openingBalance`/`openingAt` at the moment of
   upgrade — after step 1, so nothing just filed is subtracted from a balance that already included it.

Migrations run once at module load, before any component reads storage.
