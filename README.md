# LifeManager

A personal life-management app: diet & calorie tracking, gym workout logging with a rest timer, a
Touch 'n Go eWallet expense tracker, and account/debt balances — summarised on an Overview dashboard
with a level/XP system and a 7-day trend chart.

React + Vite. Installable as a phone app (PWA) and buildable as an Android APK. Data lives in the
browser via `localStorage`, with file backup/restore and optional Firebase sync between devices.

See [SETUP.md](SETUP.md) for the parts that need an account (deploy, Firebase, APK) and
[MILESTONES.md](MILESTONES.md) for what's done.

## Modules

- **Overview** — daily summary, Level/XP, 7-day trend across all modules
- **Diet** — calorie gauge, editable macro targets, manual meal entry *(photo scanning is a
  simulation, clearly marked)*
- **Sports** — rest timer that survives tab switches, custom routines, set logging
- **Money** — two views:
  - **今天** — daily spend, manual entry, and a Touch 'n Go notification reader
  - **户口欠款** — account balances with an "应有余额" shortfall, debts, and net position
- **AI Coach** — a keyword-matching bot, labelled as such. Not an LLM.

The centre button of the bottom bar is the **Life Hub**: it unfolds into four actions rather than
being a shortcut to one feature. Each goes straight to the thing — there is no intermediate
"quick add" screen, because another navigation step cancels out the convenience these exist for.

- **📝 记事本** — a notebook, not a knowledge base. Auto-save with no Save button, pin, search,
  categories (seven built in, add your own), archive.
- **🤖 AI 助手** — the assistant, unchanged.
- **🔔 提醒** — one-off / daily / weekly / monthly / yearly. Delivered by real OS notifications on
  Android, so they fire with the app closed. In a browser they can't, and the screen says so.
- **⭐ 特别的日子** — birthdays and anniversaries. Yearly by default, optional reminder on the day
  / 1 day / 1 week before. Kept separate from 提醒 on purpose: a birthday is not a task with a
  checkbox.

## Touch 'n Go notification reading

TNG notifications come from fixed templates, so they're read with pattern matching — **no AI, no API
key, no per-message cost**, and it works offline. See [`src/utils/tngParser.js`](src/utils/tngParser.js).

Every notification lands in one of four buckets:

| Bucket | Example | Result |
|---|---|---|
| `spend` | 您已支付了PINDUODUO RM36.36 | Logged |
| `income` | 充值成功 RM100.00 | Shown, never counted as spending |
| `noise` | 车险从 RM300 起 (优惠码) | Discarded |
| `unknown` | anything else | Handed to you — never guessed |

Spend is a **whitelist**: it needs both an amount *and* a spend verb, so "RM5 off!" can't be
auto-logged, and an unrecognised message is never silently dropped or silently logged.

Bilingual (Chinese + English) — real notifications are mostly Chinese. When one is misread, paste it
into the reader, see the verdict, add a line to the rules.

**"What was this for?"** — a transfer to a person tells you the amount but not what it bought, so
those (and unrecognised shops) require a note before they can be logged. Transfers ask every time;
an unknown shop asks once, then remembers its category.

In the browser you paste notifications in. On Android, the APK captures them automatically.

## Data & backup

Everything is stored locally. **Export regularly** — the header line is the entry point and nags
until you do.

- **Export/import** — one versioned JSON file. Also works as manual phone↔PC sync.
- **Cloud sync** *(optional)* — Firebase; auto-uploads changes, never applies remote changes without
  asking. See [SETUP.md](SETUP.md).
- Import **replaces** rather than merges — merging needs conflict resolution, and getting it wrong
  corrupts financial records silently.

> Account balances and debts are never stored in source code, and `.gitignore` excludes
> `lifemanager-*.json`. The app is meant to be hosted publicly.

## Development

```sh
npm install
npm run dev
```

```sh
npm run build    # production build
npm run lint     # oxlint
npm test         # every *.test logic module (400+ cases, no framework needed)
npm run icons    # regenerate PNG icons from public/icon.svg
```

Android:

```sh
npm run build && npx cap sync android && npx cap open android
```

Shipping a real update to the deployed app (web + APK, with the in-app update check picking it up
automatically) — see [SETUP.md §1](SETUP.md#1-deploy-the-web-app) for the Blaze-plan requirement:

```sh
npm run release && firebase deploy --only hosting
```
