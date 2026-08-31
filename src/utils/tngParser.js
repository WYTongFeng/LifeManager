// Touch 'n Go eWallet notification parser.
//
// TNG notifications are generated from a small set of fixed templates — they're
// not free-form human writing — so plain pattern matching reads them reliably.
// No AI, no API key, no per-message cost, works offline, and it's testable.
//
// BILINGUAL. Real TNG notifications arrive in Chinese and English, often mixed
// inside a single message ("ALIPAY+ 付款" / "您已支付了PINDUODUO RM36.36"). An
// English-only pattern set silently fails on most of them, so every rule list
// below carries both languages.
//
// Every notification is sorted into exactly one of four buckets:
//
//   spend    money left the wallet — safe to log as an expense
//   income   reload / refund / received — money IN, never counted as spend
//   noise    promo, voucher, points, verification nag — discarded
//   unknown  matched nothing — handed back to the user rather than guessed at
//
// The safety property is that spend is a WHITELIST: a notification only counts
// as spend when it has BOTH an amount AND a spend verb. "车险从 RM300 起" (car
// insurance from RM300) carries an amount but no spend verb, so it can never be
// auto-logged. Anything unrecognised becomes `unknown` and waits for you — an
// unmatched message is never silently dropped and never silently logged.
//
// ORDER MATTERS: noise is tested before income, which is tested before spend.
// The points notification is why — "You've just earned 36 points! You've
// received 36 points…" contains "you've received", which would otherwise read
// as income. Marketing copy gets ruled out first, every time.
//
// MAINTENANCE: when a real notification lands in the wrong bucket, paste it into
// the reader in the Money tab, see the verdict, and add a line to the matching
// list here. That is the whole story — no retraining, no API.

export const CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Transportation',
  'Shopping',
  'Bills & Utilities',
  'Entertainment',
  'Health',
  'Personal Care',
  'Education',
  'Transfer to person',
  'Other',
];

// RM1,234.56 / RM 16.50 / RM 13.90 / MYR 4.20
const AMOUNT_RE = /(?:RM|MYR)\s*([\d,]+(?:\.\d{1,2})?)/i;

// Checked FIRST. Marketing copy routinely contains an amount ("RM5 off",
// "从 RM300 起"), so it has to be ruled out before anything else runs.
const NOISE_RE = [
  // English
  /\bvouchers?\b/i,
  /\bpromo(tion|tions)?\b/i,
  /\bdiscount/i,
  /\bdeals?\b/i,
  /\b\d+%\s*off\b/i,
  /\boff your next\b/i,
  /\bup to RM/i,
  /\bclaim (now|your)\b/i,
  /\blimited time\b/i,
  /\bdon'?t miss\b/i,
  /\bgiveaway\b/i,
  /\bwin (a|an|up|rm)\b/i,
  /\brefer a friend\b/i,
  /\bexpir(e|es|ing) soon\b/i,
  /\bsurvey\b/i,
  /\brate (us|your)\b/i,
  /\be-?KYC\b/i,
  /\bverify your\b/i,
  /\bupdate your app\b/i,
  /\bnew feature\b/i,
  // Loyalty points are not money. "You've just earned 36 points!" must never
  // reach the income or spend checks.
  /\bearn(ed|s)?\b[^.!]*\bpoints?\b/i,
  /\bpoints?\b[^.!]*\bredeem/i,
  /\bredeem\b/i,
  /\breward points\b/i,
  // Chinese
  /优惠(码|券)?/,      // discount / voucher / promo code
  /折扣/,              // discount
  /赢取|抽奖|中奖/,    // win / lucky draw
  /限时|限量/,         // limited time / limited quantity
  /立即(领取|购买|下载)/, // claim/buy/download now
  /免费/,              // free
  /积分/,              // loyalty points
  /从\s*(?:RM|MYR)\s*[\d,.]+\s*起/, // "from RM300" — an advertised price, not a charge
  // "资金支入成功 / 您已成功支入RMx到您的GO+账户" — TNG's own internal sweep into
  // its GO+ investment sub-account. It fires alongside a separate, more useful
  // notification for the same money ("您有一项支入 / 您已收到RMx 来自 <人名> 用于
  // <用途>") that actually carries who sent it and what for. Keeping both would
  // either double-count the same inflow or, since this one names no sender,
  // fall through to `unknown` and sit in the manual review queue for no reason.
  /支入.{0,20}GO\+\s*账户/,
];

// Money coming IN. Checked before spend because reload messages also contain
// words like "successful" / "成功".
const INCOME_RE = [
  // English
  /\breload (is |was )?success/i,
  /\breload of\b/i,
  /\btop[- ]?up\b/i,
  /\bhas been added to your\b/i,
  /\byou('ve| have) received\b/i,
  /\breceived RM/i,
  /\brefund(ed)?\b/i,
  /\bcashback of\b/i,
  /\bcredited to your\b/i,
  /\bcash ?in\b/i,
  // Chinese
  /充值(成功)?/,       // reload (successful)
  /已存入|已入账/,     // deposited / credited
  /退款/,              // refund
  /收到了?\s*(?:RM|MYR)/, // received RMx
  /返现/,              // cashback
];

// "您有一项支入 / 您已收到RM 10.88 来自 YAP LEE CHIN 用于 ❤心早餐。" — the one
// income notification that actually names who sent the money and what it was
// for, unlike the generic "reload successful" / "已存入" messages. Only this
// shape carries both, so it gets its own extraction instead of overloading the
// spend-side merchant patterns above.
const INCOME_SENDER_RE = /来自\s*([^\n。，,、；]+?)\s*(?:用于|[。，,、；]|$)/;
const INCOME_PURPOSE_RE = /用于\s*([^\n。]+?)\s*(?:[。\n]|$)/;

function extractIncomeSender(text) {
  const m = text.match(INCOME_SENDER_RE);
  const candidate = m ? m[1].trim() : null;
  return candidate && !NOT_A_MERCHANT_RE.test(candidate) ? candidate : null;
}

function extractIncomePurpose(text) {
  const m = text.match(INCOME_PURPOSE_RE);
  return m ? m[1].trim() : null;
}

// Money going OUT, and it is a transfer to a person rather than a shop.
// Split out because who you paid says nothing about what it was for — these
// always ask you to describe the purpose. See needsPurpose below.
const TRANSFER_RE = [
  /汇款(成功|到|至)?/,  // remittance / transfer
  /转账(到|至|给)?/,    // transfer
  /\btransfer(red)? (of )?RM/i,
  /\bDuitNow\b/i,
  /\bsent RM\b/i,
  /\bmoney sent\b/i,
];

// Money going OUT. One of these plus an amount is what authorises a log.
const SPEND_RE = [
  ...TRANSFER_RE,
  // English
  /\byou('ve| have) paid\b/i,
  /\bpayment (of|to|is|was|success)/i,
  /\bpaid RM/i,
  /\bhas been (auto-?)?deducted\b/i,
  /\bdeducted from your\b/i,
  /\bdebited\b/i,
  /\bauto[- ]?debit(ed)?\b/i,
  /\bpurchase (of|at|success)/i,
  /\byou spent\b/i,
  /\btoll\b/i,
  /\bparking\b/i,
  /\btransit fare\b/i,
  /\bfare charged\b/i,
  /\bhas been charged\b/i,
  // Chinese
  /(您|你)?已支付(了)?/, // you have paid
  /付款(成功)?/,         // payment (successful)
  /支付成功/,            // payment successful
  /已支出/,              // "您的TNG 电子钱包已支出RM23.99" — the subscription wording
  /消费(了)?/,           // spent
  /已付款/,
  // DEDUCTION. These used to be one pattern, /已扣(除|款)/, which required 已
  // and 扣 to be adjacent — and real Chinese sentences put the source wallet
  // between them ("RM6.00 已从您的 TNG eWallet 余额中扣除"), so every auto-debit
  // notification fell through to `unknown` and was never logged. The English
  // equivalent ("has been deducted") was covered; the Chinese one was not.
  // The gap is generous because what sits between 已 and 扣除 is the whole
  // source wallet: "已从您的 TNG eWallet 余额中扣除" is 19 characters of it.
  /已[^。！\n]{0,24}扣(除|款|费)/, // 已扣除 / 已从…余额中扣除
  /自动扣(款|费|除)/,             // recurring charges: subscriptions, autopay
  /扣(款|费)(成功|通知)/,         // qualified, so "免扣费" in an ad can't match
];

// --- Merchant extraction -----------------------------------------------------
// English: the name follows "to" / "at" and runs until a connector word
// ("on 11/08/2026", "via TNG eWallet") or punctuation.
const EN_STOP = '(?:\\s+(?:on|at|via|using|with|for|is|was|has|successful|success)\\b|[.,;!\\n]|$)';
const EN_MERCHANT_RE = [
  new RegExp(`\\bto\\s+([A-Za-z0-9][^.,;!\\n]*?)${EN_STOP}`, 'i'),
  new RegExp(`\\bat\\s+([A-Za-z0-9][^.,;!\\n]*?)${EN_STOP}`, 'i'),
];

// Chinese word order puts the name in three different places depending on the
// verb, and all three are real:
//   "RM 13.90已成功汇款到 KOH CHENG XUAN。"       -> name AFTER 汇款到
//   "您已支付了RM4.00给EDISIJUTA PARKING SDN BHD。" -> name AFTER the amount, via 给
//   "您已支付了PINDUODUO RM36.36"                 -> name BETWEEN 支付了 and RM
// Chinese punctuation (。，、) terminates the name, as does a following amount
// or the end of the line.
const ZH_MERCHANT_RE = [
  // A line break ends the name just as much as a full stop does — the title is
  // its own line ("已支付给 Google ChatGPT 650-2530000\n…"), and without \n in
  // the terminator this matched nothing at all and the payer came back null.
  /(?:汇款|转账|付款|支付|转)(?:到|至|给)\s*([^。，,、；\n]+?)\s*(?:[。，,、；]|通过|\n|$)/,
  // Amount first, name after: "已支付了RM4.00给<SHOP>". Must be tried before the
  // 支付了…RM rule below, which reads this shape backwards.
  /(?:RM|MYR)\s*[\d,.]+\s*(?:给|至|到)\s*([^。，,、；\n]+?)(?=[。，,、；\n]|$)/i,
  /(?:已支付了?|支付了|付款给)\s*([^。，,、；\n]+?)\s*(?:RM|MYR)\s*[\d]/i,
  /(?:已支付了?|支付了)\s*([^。，,、；\n]+?)(?:\s*(?:。|，|,|、|；|$))/,
];

// "to your TNG eWallet" is the wallet itself, not a shop it was spent at.
//
// The bare-particle rule is not cosmetic. In "您已支付了RM4.00给SHOP。" the rule
// above can match 已支付 with the optional 了 given up, leaving 了 itself as the
// captured name — and a real RM4.00 expense was logged to a merchant literally
// called 了. Anything that is only grammar is not a name.
const NOT_A_MERCHANT_RE = /^(your|the)\b|wallet|account|balance|钱包|余额|账户|^tng$|touch ?'?n ?go|^[了的给和与至到把从]+$/i;

// Merchant keyword -> category. Order matters: the first list whose keyword
// appears in the merchant name wins, so specific lists sit above general ones.
const CATEGORY_RULES = [
  ['Transportation', ['rapidkl', 'rapid kl', ' lrt', 'lrt ', 'mrt', 'ktm', 'monorail', 'komuter',
    'grab', 'myteksi', 'toll', 'tol ', 'plus highway', 'smarttag', 'smart tag', 'parking', 'parkir',
    'petronas', 'shell', 'caltex', 'bhpetrol', 'petron', 'petrol', 'transit', 'airasia', 'aeroline',
    '交通', '停车', '过路费', '油站']],
  ['Groceries', ['grocer', 'tesco', 'lotus', 'giant', 'aeon', 'mydin', 'econsave', 'speedmart',
    'hero market', 'supermarket', 'sundry', 'family mart', 'familymart', '7-eleven', '7 eleven',
    'kk super', 'kk mart', 'mynews', 'cold storage', '超市', '杂货']],
  ['Health', ['clinic', 'klinik', 'pharmacy', 'farmasi', 'hospital', 'dental', 'pergigian',
    'caring', 'big pharmacy', 'alpro', 'poliklinik', '诊所', '药房', '医院']],
  ['Personal Care', ['salon', 'hair studio', 'hairdresser', 'barber', 'haircut', 'nail',
    'spa', 'massage', 'reflexology', 'laundry', 'dobi', 'dry clean', 'beauty', 'cosmetic',
    'skincare', 'sephora', '理发', '发廊', '美发', '美容', '美甲', '按摩', '洗衣', '干洗']],
  ['Bills & Utilities', ['tnb', 'tenaga', 'syabas', 'air selangor', 'indah water', 'unifi',
    'maxis', 'celcom', 'digi', 'u mobile', 'umobile', 'yes 4g', 'astro', 'time internet',
    'telekom', 'bill payment', 'prepaid reload', '账单', '水电', '话费']],
  ['Entertainment', ['gsc', 'golden screen', 'tgv', 'mbo cinema', 'cinema', 'netflix', 'spotify',
    'steam', 'playstation', 'karaoke', 'redbox', 'bowling', '电影', '戏院']],
  ['Shopping', ['shopee', 'lazada', 'zalora', 'uniqlo', 'h&m', 'padini', 'brands outlet',
    'watsons', 'guardian', 'mr diy', 'mr. diy', 'decathlon', 'popular book', 'ikea', 'courts',
    // NB: no 'alipay' here. ALIPAY+ is the payment rail the notification came
    // over, like "paid by Visa" — it appears on purchases of every kind and
    // says nothing about what was bought.
    'pinduoduo', 'taobao', 'tmall', 'aliexpress', 'temu', '拼多多', '淘宝', '天猫',
    '购物', '商城']],
  ['Education', ['tuition', 'sekolah', 'school', 'university', 'universiti', 'kolej', 'college',
    'academy', 'akademi', '学校', '大学', '补习']],
  ['Food & Dining', ['restoran', 'restaurant', 'cafe', 'kafe', 'kopitiam', 'mamak', 'warung',
    'mcdonald', 'kfc', 'pizza', 'subway', 'burger', 'starbucks', 'tealive', 'zus coffee',
    'chatime', 'boost juice', 'bubble', 'secret recipe', 'nasi', 'mee ', 'char kuey',
    'chicken rice', 'bakery', 'bake', 'dessert', 'ice cream', 'bistro', 'eatery', 'food court',
    'foodcourt', 'catering', 'coffee', 'tea house', 'sushi', 'ramen', 'steamboat',
    '餐厅', '茶室', '咖啡', '美食', '饮食']],
];

// Keywords that reveal the purpose from the message body rather than the shop
// name — "RM3.00 toll charge at PLUS Sungai Besi" only says Transportation
// through the word "toll". Deliberately tiny: scanning the whole notification
// with the full rule list matches app names and payment rails ("ALIPAY+") and
// invents a confident, wrong category. Only unambiguous purpose words belong here.
const CONTEXT_RULES = [
  ['Transportation', [/\btoll\b/i, /\bparking\b/i, /\btransit fare\b/i, /\bfare\b/i,
    /过路费/, /停车/, /车费/]],
];

function categoriseByContext(text) {
  for (const [category, patterns] of CONTEXT_RULES) {
    if (patterns.some(re => re.test(text))) return category;
  }
  return 'Other';
}

function toAmount(text) {
  const m = text.match(AMOUNT_RE);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function matchesAny(patterns, text) {
  return patterns.some(re => re.test(text));
}

// TNG sends merchant names in ALL CAPS. Left as-is they shout in the expense
// list, so an all-caps Latin name gets title-cased. Chinese text is untouched.
function tidyMerchant(raw) {
  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/\s*(sdn\.? bhd\.?|bhd\.?)$/i, '')
    // Card-style descriptors carry a merchant reference number that is noise in
    // an expense list and, worse, differs per charge — "Google ChatGPT
    // 650-2530000" and "Google ChatGPT 650-2530001" would be learned as two
    // separate merchants and each ask for a category again.
    .replace(/\s+\d[\d-]{4,}$/, '')
    .trim();

  if (!/[a-z]/i.test(cleaned) || cleaned !== cleaned.toUpperCase()) return cleaned;
  return cleaned.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

function extractMerchant(text) {
  for (const re of [...ZH_MERCHANT_RE, ...EN_MERCHANT_RE]) {
    const m = text.match(re);
    if (!m) continue;
    const candidate = (m[1] || '').trim();
    if (!candidate || NOT_A_MERCHANT_RE.test(candidate)) continue;
    return tidyMerchant(candidate);
  }
  return null;
}

// Normalised lookup key so "TEALIVE  Bubble Tea" and "tealive bubble tea" are
// remembered as the same merchant. Chinese characters are preserved.
export function merchantKey(merchant) {
  return (merchant || '')
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .trim();
}

// Keyword rules only, no learned map — safe to run against a whole
// notification, where a learned merchant name could otherwise false-match.
function categoriseByRules(text) {
  const key = merchantKey(text);
  if (!key) return 'Other';
  for (const [category, keywords] of CATEGORY_RULES) {
    if (keywords.some(word => key.includes(word.trim()))) return category;
  }
  return 'Other';
}

/**
 * Pick a category for a merchant.
 * `learned` is your own merchant -> category map, and it always wins over the
 * built-in rules — correcting a category once teaches it permanently.
 */
export function categorise(merchant, learned = {}) {
  const key = merchantKey(merchant);
  if (!key) return 'Other';

  if (learned[key]) return learned[key];
  // A remembered merchant may be a substring of the notification's version of
  // the name (or vice versa), e.g. "tealive" vs "tealive bubble tea ss15".
  for (const [savedKey, category] of Object.entries(learned)) {
    if (savedKey && (key.includes(savedKey) || savedKey.includes(key))) return category;
  }

  return categoriseByRules(key);
}

/**
 * Read one Touch 'n Go notification.
 *
 * @param {string} text     raw notification title + body
 * @param {object} learned  merchant -> category map (see categorise)
 * @returns {{kind: 'spend'|'income'|'noise'|'unknown', amount: number|null,
 *            merchant: string|null, category: string|null, isTransfer: boolean,
 *            needsPurpose: boolean, reason: string}}
 *
 *          `needsPurpose` is the important one: true when the notification says
 *          how much left the wallet but not what it bought. Two cases —
 *          a transfer to a person ("汇款到 KOH CHENG XUAN" could be dinner, rent
 *          or a carpool), or a merchant no rule recognises. The UI must ask you
 *          to type what it was for instead of filing it as "Other" and moving on.
 *
 *          `reason` explains the verdict in plain language so the UI can show
 *          why something was skipped rather than just ignoring it.
 */
export function parseTngNotification(text, learned = {}) {
  const raw = (text || '').trim();
  const base = { amount: null, merchant: null, category: null, isTransfer: false, needsPurpose: false };

  if (!raw) {
    return { ...base, kind: 'unknown', reason: 'Nothing to read.' };
  }

  const amount = toAmount(raw);

  if (matchesAny(NOISE_RE, raw)) {
    return {
      ...base, kind: 'noise',
      reason: 'Reads as marketing or loyalty points, not a transaction.',
    };
  }

  if (matchesAny(INCOME_RE, raw)) {
    const sender = extractIncomeSender(raw);
    const purpose = extractIncomePurpose(raw);
    let reason;
    if (amount && sender) {
      reason = `Money coming in (RM ${amount.toFixed(2)}) from ${sender}${purpose ? ` for ${purpose}` : ''} — not counted as spending.`;
    } else if (amount) {
      reason = `Money coming in (RM ${amount.toFixed(2)}) — reloads and refunds are not spending, so this is not added to your budget.`;
    } else {
      reason = 'Money coming in — not counted as spending.';
    }
    return {
      ...base, kind: 'income', amount, merchant: sender, reason,
    };
  }

  if (matchesAny(SPEND_RE, raw)) {
    if (amount === null) {
      return {
        ...base, kind: 'unknown', merchant: extractMerchant(raw),
        reason: 'Looks like a payment but no RM amount was found, so nothing was logged.',
      };
    }

    const merchant = extractMerchant(raw);
    const isTransfer = matchesAny(TRANSFER_RE, raw);

    // The merchant name is the primary signal. Only if it says nothing do we
    // look at the message body, and then only for unambiguous purpose words —
    // see CONTEXT_RULES for why this isn't the full rule list.
    let category = categorise(merchant, learned);
    if (category === 'Other') category = categoriseByContext(raw);

    // A transfer always asks, even to someone you've paid before — the same
    // person can be dinner one week and rent the next. A merchant that matched
    // no rule asks once; teaching it a category stops it asking again.
    const needsPurpose = isTransfer || category === 'Other';
    if (isTransfer && category === 'Other') category = 'Transfer to person';

    let reason;
    if (isTransfer) {
      reason = merchant
        ? `Transfer of RM ${amount.toFixed(2)} to ${merchant}. A name doesn't say what it was for — add a note below.`
        : `Transfer of RM ${amount.toFixed(2)} out of your wallet. Add a note saying what it was for.`;
    } else if (!merchant) {
      reason = `Payment of RM ${amount.toFixed(2)} — could not tell who was paid, so fill in the shop yourself.`;
    } else if (needsPurpose) {
      reason = `Payment of RM ${amount.toFixed(2)} to ${merchant}. Not a shop I recognise — pick a category and note what it was for.`;
    } else {
      reason = `Payment of RM ${amount.toFixed(2)} to ${merchant}.`;
    }

    return { kind: 'spend', amount, merchant, category, isTransfer, needsPurpose, reason };
  }

  return {
    ...base,
    kind: 'unknown',
    amount,
    merchant: extractMerchant(raw),
    reason: amount
      ? `Found RM ${amount.toFixed(2)} but no wording that says money was spent, so it was not logged. Check it and decide.`
      : 'This does not match any known Touch \'n Go message. Nothing was logged.',
  };
}

/**
 * Is a parsed result worth interrupting the user for? Used by ClipboardWatch
 * to decide whether to pop the reader open automatically on a background
 * clipboard check — noise (marketing/points) and genuinely unrelated copied
 * text (no RM amount at all) are not worth interrupting for; anything that
 * could plausibly involve real money is, exactly matching what the manual
 * paste-into-the-reader flow already shows.
 */
export function worthSurfacing(parsed) {
  return parsed.kind === 'spend' || parsed.kind === 'income'
    || (parsed.kind === 'unknown' && parsed.amount != null);
}

// Real notifications captured from the user's phone on 2026-08-11, kept verbatim
// as the reference set. Two of the four must NOT become expenses — the points
// message and the insurance ad — because the point is to prove the filter works.
export const SAMPLE_NOTIFICATIONS = [
  {
    label: 'Transfer to a person (asks what it was for)',
    text: '汇款成功\nRM 13.90已成功汇款到 KOH CHENG XUAN。',
  },
  {
    label: 'ALIPAY+ payment to a shop',
    text: 'ALIPAY+ 付款\n您已支付了PINDUODUO RM36.36',
  },
  {
    label: 'Loyalty points (must be ignored)',
    text: "You've just earned 36 points!\nYou've received 36 points from your transaction! Use them now to redeem great rewards",
  },
  {
    label: 'Insurance ad (must be ignored)',
    text: '车险从 RM300 起\nWONG ZI YEE, 通过 CarInsure 购买 (优惠码: BONANZA)。赢取 Samsung S26 Ultra 及其他奖品',
  },
  {
    label: 'English payment to a restaurant',
    text: "Touch 'n Go eWallet\nPayment successful. You have paid RM16.50 to RESTORAN NASI KANDAR PELITA on 11/08/2026.",
  },
  {
    label: 'Reload (money IN — not spending)',
    text: "Touch 'n Go eWallet\nReload successful! RM100.00 has been added to your TNG eWallet balance.",
  },
  {
    label: 'GO+ internal sweep (must be ignored — duplicate of the transfer below)',
    text: '资金支入成功\n您已成功支入RM10.88到您的GO+账户',
  },
  {
    label: 'Received a transfer with sender + purpose (money IN — not spending)',
    text: '您有一项支入\n您已收到RM 10.88 来自 YAP LEE CHIN 用于 ❤心早餐。',
  },
];
