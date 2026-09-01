// The plain-text export: what it must always say, and what it must never say.
//
// This file exists to be pasted at a language model, which makes two failure
// modes much worse than they would be in a UI. A wrong number is repeated back
// as fact with total confidence. A missing section is invisible — the reader
// has no way to know a category was silently dropped.

import {
  buildMoneyReport, buildHealthReport, reportFilename, reportRanges,
} from '../src/utils/textExport.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};
const has = (name, text, needle) => check(name, text.includes(needle), true);
const lacks = (name, text, needle) => check(name, text.includes(needle), false);

const NOW = new Date(2026, 7, 25, 14, 30);

// A month with every awkward record shape in it at once.
const expenses = [
  { id: 1, merchant: 'Mixed Rice', amount: 9.5, category: 'Food', date: '2026-08-25', time: '12:40', accountId: 1, paymentMethod: 'TNG' },
  { id: 2, merchant: 'Shopee', amount: 189, category: 'Shopping', date: '2026-08-20', time: '10:30 PM', accountId: 1 },
  // Money arriving: stored NEGATIVE so it credits the account. Not spending.
  { id: 3, merchant: '生活费', amount: -1000, isMoneyIn: true, date: '2026-08-10', time: '09:00', accountId: 1 },
  // A refund against spending already logged. Also negative, different meaning.
  { id: 4, merchant: '退款', amount: -20, category: 'Shopping', date: '2026-08-21', time: '11:00', accountId: 1 },
  // Both halves of a transfer between the user's own accounts.
  { id: 5, merchant: '转去 Maybank', amount: 100, isAccountTransfer: true, transferId: 't1', date: '2026-08-19', time: '14:00', accountId: 1 },
  { id: 6, merchant: '从 TNG 转入', amount: -100, isAccountTransfer: true, transferId: 't1', date: '2026-08-19', time: '14:00', accountId: 2 },
  // A debt repayment: real money out, but reserved up front, not shopping.
  { id: 7, merchant: 'SPayLater', amount: 200, repaysDebtId: 9, date: '2026-08-18', time: '16:00', accountId: 1 },
];

const accounts = [
  { id: 1, name: "Touch 'n Go eWallet", type: 'ewallet', openingBalance: 2000, openingAt: 0 },
  { id: 2, name: 'Maybank', type: 'bank', openingBalance: 500, openingAt: 0 },
  { id: 3, name: '妈妈的钱', type: 'bank', kind: 'custodial', openingBalance: 5000, openingAt: 0 },
];

const money = buildMoneyReport({
  expenses, accounts,
  debts: [{ id: 9, creditor: 'SPayLater', amount: 800 }],
  incomeSources: [{ id: 1, label: '生活费', amount: 1000, kind: 'income' }],
  allocations: [{ id: 1, label: '房租', amount: 600, budgeted: 600, charged: 600 }],
  dailyBudget: 80,
  now: NOW,
});

// --- the header states what the numbers mean -------------------------------
// Without these the reader has to guess the currency and guess what a "month"
// here means, and the header says so outright.
has('says the currency', money, 'MYR');
has('says what a month means here', money, '日历月');
has('states the cycle dates', money, '2026-08-01 → 2026-09-01');
has('stamps when it was exported', money, '2026-08-25 14:30');

// --- the three kinds of negative record are never conflated ----------------
// A negative amount means a refund, an arrival, or half a transfer. Printing
// them identically is how a reader concludes the user earned RM1,120 this month.
has('an arrival is labelled as one', money, '进账');
has('a refund is labelled as one', money, '退款/别人还我');
has('a transfer out is labelled', money, '转出');
has('a transfer in is labelled', money, '转入');
has('a debt repayment is labelled', money, '还债');

// --- totals exclude what is not spending -----------------------------------
// 2026-08-19 is the transfer day: RM100 left one account and RM100 arrived in
// another. Nothing was spent. It must print 0.00, not 100.00.
const transferDay = money.split('\n').find(l => l.startsWith('2026-08-19'));
check('a pure transfer day counts as zero spending',
  /花了 RM 0\.00/.test(transferDay ?? ''), true);

// 2026-08-10 is the day the allowance landed — an arrival, not spending.
const arrivalDay = money.split('\n').find(l => l.startsWith('2026-08-10'));
check('the day money arrived is not counted as spending',
  /花了 RM 0\.00/.test(arrivalDay ?? ''), true);

// --- balances --------------------------------------------------------------
has('every account is listed', money, "Touch 'n Go eWallet");
has('...including the custodial one', money, '妈妈的钱');
has('...marked as not spendable', money, '代管，不可花');
// RM2,000 + RM1,000 in − 9.50 − 189 + 20 − 100 out − 200 = RM2,521.50
has('a derived balance is printed, not a typed one', money, 'RM 2521.50');
// Spendable total must EXCLUDE the custodial account: 2521.50 + 600 = 3121.50
has('the spendable total leaves out custodial money', money, '可动用合计');
lacks('...so the RM5,000 that is not his is not in the total', money, 'RM 8121.50');

// --- old locale timestamps still read -------------------------------------
has('a legacy "10:30 PM" prints as 22:30', money, '22:30');

// --- a deficit is stated as a deficit --------------------------------------
const deficit = buildMoneyReport({
  expenses, accounts,
  incomeSources: [{ id: 1, label: '生活费', amount: 300, kind: 'income' }],
  allocations: [{ id: 1, label: '房租', amount: 600, budgeted: 600, charged: 600 }],
  now: NOW,
});
has('a losing month says it lost', deficit, '本周期亏损');
has('...and marks it', deficit, '← 超支');
lacks('...and does not also claim there is money left', deficit, '还可以花');

// --- empty state -----------------------------------------------------------
const empty = buildMoneyReport({ now: NOW });
has('an empty export still says what it is', empty, 'LifeManager 记账资料');
has('...and says there is nothing rather than printing an empty table', empty, '还没有任何记录');
// The app synthesises a default TNG account when none is configured
// (resolveAccounts), and the money screen shows it at RM 0.00 — so the export
// showing the same thing is consistent, not invented. What it must NOT do is
// print a balance nobody has.
has('the app default account appears, matching what the screen shows', empty, '【户口余额】');
has('...at zero', empty, 'RM 0.00');
lacks('...and invents no debts', empty, '【欠款】');
lacks('...and invents no fixed costs', empty, '【固定月费】');

// --- health ----------------------------------------------------------------
const health = buildHealthReport({
  meals: [
    { id: 1, name: '鸡饭', calories: 650, protein: 35, carbs: 80, fat: 18, date: '2026-08-25', time: '12:30' },
    { id: 2, name: '炒粉', calories: 700, date: '2026-08-24', time: '19:00' },
  ],
  workouts: [
    { id: 10, type: 'session', routineName: '板块 1 · 胸 + 三头', durationMin: 43, setsPlanned: 20, intensity: 'moderate', calories: 200, date: '2026-08-25', time: '18:30' },
    { id: 11, type: 'strength', exercise: '上斜哑铃卧推', weightKg: 30, reps: 12, calories: 8, isNewPR: true, date: '2026-08-24', time: '18:05' },
    { id: 12, type: 'strength', exercise: '靠墙静蹲', mode: 'time', holdSec: 45, calories: 7, date: '2026-08-24', time: '18:40' },
    { id: 13, type: 'cardio', activity: '跑步', durationMin: 30, distanceKm: 5, calories: 260, date: '2026-08-24', time: '07:00' },
  ],
  bodyWeightKg: 70, heightCm: 172, ageYears: 25, sex: 'male', bmr: 1655, calorieLimit: 2100,
  now: NOW,
});

has('body profile is stated, because every kcal figure depends on it', health, '体重          70 kg');
has('BMR is labelled as resting only', health, '静息，不含活动');
// The three record types read differently and must not be collapsed.
has('a whole session says so', health, '整场');
has('...with its planned volume', health, '20 组');
has('a logged set shows weight x reps', health, '30kg × 12');
has('a hold shows seconds, never reps', health, '45 秒');
lacks('...and never renders a hold as a rep count', health, '× 45');
has('cardio shows distance', health, '5 km');
has('a PR is flagged', health, '← 新纪录');
// 20 (session) + 1 + 1 (two logged sets) — cardio contributes none.
has('the day total counts a session as its planned sets', health, '20 组');
check('cardio does not inflate the set count',
  /2026-08-24.*\s2 组/.test(health), true);

const noProfile = buildHealthReport({ meals: [], workouts: [], now: NOW });
has('with no body profile it says so rather than guessing one',
  noProfile, '还没填体重');
lacks('...and prints no invented BMR', noProfile, 'kcal/天');

check('filename', reportFilename('money', NOW), 'lifemanager-money-2026-08-25-1430.txt');
check('...and carries the range when there is one, so two exports are tellable apart',
  reportFilename('money', NOW, 'prev'), 'lifemanager-money-prev-2026-08-25-1430.txt');

// --- exporting a whole month -----------------------------------------------
//
// "整个月" in this app is the calendar month. A rolling 30-day
// window — which is what this used to offer — reaches back into the previous
// month on every day but the 1st, and silently mixes two budgets together.
const ranges = reportRanges(NOW);
const byKey = Object.fromEntries(ranges.map(r => [r.key, r]));

check('本月 is the calendar month',
  [byKey.cycle.from, byKey.cycle.to], ['2026-08-01', '2026-09-01']);
check('上个月 is the cycle before it',
  [byKey.prev.from, byKey.prev.to], ['2026-07-01', '2026-08-01']);
// The seam between them is the single most likely place for an off-by-one, and
// a day counted twice is a day of spending invented out of nothing.
check('the two months tile exactly — no gap, no overlap',
  byKey.prev.to, byKey.cycle.from);
check('全部 has no bounds at all', [byKey.all.from, byKey.all.to], [null, null]);
check('every option states the dates it covers',
  ranges.every(r => typeof r.hint === 'string' && r.hint.length > 0), true);

// Records straddling the month boundary: one on the last day of last month,
// one on the 1st. Exactly one belongs to each month.
const straddling = [
  { id: 90, merchant: '上个月最后一天', amount: 50, category: 'Food', date: '2026-07-31', time: '23:59' },
  { id: 91, merchant: '月头第一天', amount: 60, category: 'Food', date: '2026-08-01', time: '00:01' },
];
const thisMonth = buildMoneyReport({ expenses: straddling, ...byKey.cycle, now: NOW });
const lastMonth = buildMoneyReport({ expenses: straddling, ...byKey.prev, now: NOW });

has('the 1st belongs to the new month', thisMonth, '月头第一天');
lacks('...and the 31st does not', thisMonth, '上个月最后一天');
has('the 31st belongs to the old month', lastMonth, '上个月最后一天');
lacks('...and the 1st does not', lastMonth, '月头第一天');

// The budget block must describe the month being exported, not whichever one
// happens to be current — printing this month's income above last month's
// transactions is the kind of wrong that reads as right.
has('exporting 上个月 reports on the July cycle', lastMonth, '2026-07-01 → 2026-08-01');
has('...and says that cycle is over', lastMonth, '已结束');
has('exporting 本月 says the cycle is still running', thisMonth, '还没过完');
// The position in the cycle comes from TODAY, not from where the window opens.
// Deriving it from the window's start date gave "第 1 / 31 天，还剩 31 天" on
// the 25th — the right cycle, the wrong place in it.
has('...at TODAY position in the cycle, not day one', thisMonth, '第 25 / 31 天');
// A window spanning several cycles still reports the CURRENT one, because
// "how am I doing" is a question about now.
const threeMonths = buildMoneyReport({ expenses: straddling, ...byKey.three, now: NOW });
has('a multi-month window still reports this cycle', threeMonths, '第 25 / 31 天');
has('...and includes records from the older months', threeMonths, '上个月最后一天');

// A month's export must not be silently truncated to "the most recent N days".
const longMonth = buildMoneyReport({
  expenses: Array.from({ length: 31 }, (_, i) => ({
    id: 200 + i, merchant: `第${i + 1}天`, amount: 5, category: 'Food',
    date: `2026-08-${String(10 + i).padStart(2, '0')}`, time: '12:00',
  })).filter(e => e.date <= '2026-09-09'),
  ...byKey.cycle, now: NOW,
});
check('every day of the month is present, not just the recent ones',
  longMonth.includes('第1天') && longMonth.includes('第31天'), true);

// Balances are history-wide even when the window is one month — a balance is
// the running result of everything ever logged, not of August.
const scoped = buildMoneyReport({
  expenses, accounts, ...byKey.cycle, now: NOW,
});
has('the balance still reflects every record ever logged', scoped, 'RM 2521.50');
has('...and the export says what window it covers', scoped, '这份涵盖');

// The health side takes the same window, so the two reports line up by date.
const monthHealth = buildHealthReport({
  meals: [
    { id: 80, name: '上个月的饭', calories: 500, date: '2026-07-31', time: '12:00' },
    { id: 81, name: '这个月的饭', calories: 600, date: '2026-08-01', time: '12:00' },
  ],
  workouts: [], ...byKey.cycle, now: NOW,
});
has('health uses the same month boundary', monthHealth, '这个月的饭');
lacks('...so the two reports can be read side by side', monthHealth, '上个月的饭');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
