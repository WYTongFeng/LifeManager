import { parseTngNotification as p, worthSurfacing } from '../src/utils/tngParser.js';
// [text, kind, amount, merchant, needsPurpose, category]
const cases = [
  ["汇款成功\nRM 13.90已成功汇款到 KOH CHENG XUAN。", 'spend', 13.9, 'Koh Cheng Xuan', true, 'Transfer to person'],
  ["You've just earned 36 points!\nYou've received 36 points from your transaction! Use them now to redeem great rewards", 'noise', null, null, false, null],
  ["ALIPAY+ 付款\n您已支付了PINDUODUO RM36.36", 'spend', 36.36, 'Pinduoduo', false, 'Shopping'],
  ["车险从 RM300 起\nWONG ZI YEE, 通过 CarInsure 购买 (优惠码: BONANZA)。赢取 Samsung S26 Ultra", 'noise', null, null, false, null],
  // the ALIPAY+ rail must NOT leak a category onto an unknown shop
  ["ALIPAY+ 付款\n您已支付了 ABC TRADING ENTERPRISE RM20.00", 'spend', 20, 'Abc Trading Enterprise', true, 'Other'],
  // English regressions
  ["Payment successful. You have paid RM16.50 to RESTORAN NASI KANDAR PELITA on 11/08/2026.", 'spend', 16.5, 'Restoran Nasi Kandar Pelita', false, 'Food & Dining'],
  ["RM4.20 has been deducted for your transit fare at RAPIDKL KELANA JAYA.", 'spend', 4.2, 'Rapidkl Kelana Jaya', false, 'Transportation'],
  ["RM3.00 toll charge at PLUS Sungai Besi.", 'spend', 3, 'PLUS Sungai Besi', false, 'Transportation'],
  ["Reload successful! RM100.00 has been added to your TNG eWallet balance.", 'income', 100, null, false, null],
  ["Grab your RM5 voucher now! Limited time deal.", 'noise', null, null, false, null],
  ["Your TNG eWallet balance is RM23.10.", 'unknown', 23.1, null, false, null],
  ["充值成功\nRM50.00 已充值到您的钱包", 'income', 50, null, false, null],
  ["付款成功\n您已支付了 星巴克咖啡 RM18.90", 'spend', 18.9, '星巴克咖啡', false, 'Food & Dining'],
  ["转账成功\nRM 88.00已转账给 LIM AH MENG。", 'spend', 88, 'Lim Ah Meng', true, 'Transfer to person'],
  // Personal Care category
  ["Payment successful. You have paid RM45.00 to KL HAIR SALON on 12/08/2026.", 'spend', 45, 'Kl Hair Salon', false, 'Personal Care'],
  ["付款成功\n您已支付了 美甲工作室 RM60.00", 'spend', 60, '美甲工作室', false, 'Personal Care'],

  // --- Captured verbatim from the user's phone on 2026-08-19 --------------
  // All four arrived the same evening and NONE of them reached the expense
  // list. Three separate faults, one per line below; they are kept here in the
  // exact wording TNG sent so no future rule change can quietly undo the fix.

  // Subscription auto-charge. The payee sits after 给 on the title line, and
  // the old terminator required punctuation — a line break didn't count — so
  // the merchant came back null and the whole thing needed manual typing.
  // The reference number is stripped so next month's charge is the SAME
  // merchant and gets categorised from what was learned this month.
  ["已支付给 Google ChatGPT 650-2530000\nGoogle ChatGPT 650-2530000: 您的TNG 电子钱包已支出RM23.99 。交易参考编号: 356231490918916",
    'spend', 23.99, 'Google ChatGPT', true, 'Other'],

  // Parking. This one WAS logged — as a merchant literally named 了, because
  // 已支付了? gave up its optional 了 and captured it as the name.
  ["付款\n您已支付了RM4.00给EDISIJUTA PARKING SDN BHD。",
    'spend', 4, 'Edisijuta Parking', false, 'Transportation'],

  // Both of these were correctly ignored, and must stay that way — half the
  // job of this parser is NOT logging things.
  ["You've just earned 4 points!\nYou've received 4 points from your transaction! Use them now to redeem great rewards.",
    'noise', null, null, false, null],
  ["💚 Still time for self-care\nYour 5% off screenings & RM15 off Lovy Pharmacy are waiting. Tap to redeem before",
    'noise', null, null, false, null],

  // The Chinese deduction wording that started all this: 已 and 扣除 are not
  // adjacent in a real sentence, which the old /已扣(除|款)/ required.
  ["扣款通知\nRM6.00 已从您的 TNG eWallet 余额中扣除。", 'spend', 6, null, true, 'Other'],
  ["自动扣款成功\n您的订阅 RM9.90 已自动扣款。", 'spend', 9.9, null, true, 'Other'],
];
let bad=0;
console.log('     kind     amt     purpose  category            merchant');
console.log('-'.repeat(82));
for (const [txt,k,a,mer,pu,cat] of cases) {
  const r=p(txt);
  const ok = r.kind===k && (r.amount??null)===a && (r.merchant??null)===mer
    && r.needsPurpose===pu && (r.category??null)===cat;
  if(!ok) bad++;
  console.log(`${ok?'PASS':'FAIL'} ${r.kind.padEnd(8)} ${String(r.amount??'-').padEnd(7)} ${String(r.needsPurpose).padEnd(8)} ${String(r.category??'-').padEnd(19)} ${r.merchant??'-'}`);
  if(!ok) console.log(`     WANT ${k} amt=${a} purpose=${pu} cat=${cat} merchant=${mer}`);
}
// --- worthSurfacing: ClipboardWatch's decision on whether a background
// clipboard check should interrupt the user with the reader modal ----------
const surfacingCases = [
  ['a real payment surfaces', p("Payment successful. You have paid RM16.50 to RESTORAN NASI KANDAR PELITA on 11/08/2026."), true],
  ['money coming in surfaces', p("Reload successful! RM100.00 has been added to your TNG eWallet balance."), true],
  ['marketing noise does not surface', p("Grab your RM5 voucher now! Limited time deal."), false],
  ['unrecognised text WITH an amount still surfaces (worth a second look)', p("Your TNG eWallet balance is RM23.10."), true],
  ['unrelated copied text with no RM amount does not surface (not TNG-shaped at all)', p("just some random text I copied for something else"), false],
];
for (const [label, parsed, want] of surfacingCases) {
  const got = worthSurfacing(parsed);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'} worthSurfacing: ${label}`);
  if (!ok) console.log(`     WANT ${want} GOT ${got}`);
}

console.log(bad===0?'\nALL PASS':`\n${bad} FAILED`);

if (bad > 0) process.exit(1);
