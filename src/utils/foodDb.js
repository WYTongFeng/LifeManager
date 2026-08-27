// Local food lookup — the free, offline, instant path for logging a meal.
//
// This exists so the common case never costs an API call: the user eats nasi
// lemak and teh tarik most days, and asking a model to price the same plate
// over and over is exactly the waste the project's "regex/lookup before LLM"
// rule is about. AI estimation (foodEstimate.js) is the FALLBACK, for food
// that isn't in here.
//
// Numbers are typical single-serving estimates for Malaysian portions, drawn
// from common nutrition references. They are estimates, not lab measurements —
// hawker portions vary a lot — and the UI labels them as such. Every entry is
// editable after it lands in the log.
//
// kcal / p(rotein) / c(arbs) / f(at) are per one serving of `unit`.

export const FOOD_DB = [
  // --- Malaysian mains -------------------------------------------------------
  { name: '椰浆饭 Nasi Lemak', kcal: 650, p: 18, c: 80, f: 28, unit: '份', aliases: ['nasi lemak', 'nasilemak', '椰浆饭', '椰浆饭'] },
  { name: '椰浆饭 + 炸鸡', kcal: 900, p: 38, c: 85, f: 45, unit: '份', aliases: ['nasi lemak ayam goreng', 'nasi lemak ayam', '椰浆饭炸鸡', 'nasi lemak chicken'] },
  { name: '炒饭 Nasi Goreng', kcal: 600, p: 20, c: 85, f: 20, unit: '盘', aliases: ['nasi goreng', 'fried rice', '炒饭', 'nasi goreng ayam'] },
  { name: '炒粿条 Char Kuey Teow', kcal: 740, p: 24, c: 76, f: 35, unit: '盘', aliases: ['char kuey teow', 'char koay teow', 'ckt', '炒粿条', 'kuey teow goreng'] },
  { name: '经济饭（两菜一肉）', kcal: 600, p: 25, c: 75, f: 22, unit: '份', aliases: ['nasi campur', 'economy rice', '经济饭', 'mixed rice', '杂饭'] },
  { name: '海南鸡饭', kcal: 600, p: 30, c: 75, f: 20, unit: '份', aliases: ['chicken rice', 'hainan chicken rice', '鸡饭', '海南鸡饭', 'nasi ayam'] },
  { name: '云吞面 Wantan Mee', kcal: 500, p: 22, c: 65, f: 16, unit: '碗', aliases: ['wantan mee', 'wanton mee', '云吞面', 'wan tan mee'] },
  { name: '咖喱面 Curry Mee', kcal: 550, p: 20, c: 60, f: 26, unit: '碗', aliases: ['curry mee', 'curry laksa', '咖喱面', 'kari mee'] },
  { name: '亚参叻沙 Asam Laksa', kcal: 400, p: 18, c: 62, f: 8, unit: '碗', aliases: ['asam laksa', 'assam laksa', '亚参叻沙', 'laksa'] },
  { name: '肉骨茶 Bak Kut Teh', kcal: 450, p: 32, c: 12, f: 30, unit: '份', aliases: ['bak kut teh', 'bkt', '肉骨茶'] },
  { name: '板面 Pan Mee', kcal: 500, p: 20, c: 68, f: 15, unit: '碗', aliases: ['pan mee', '板面', 'pan mien'] },
  { name: '酿豆腐（6 件 + 汤）', kcal: 350, p: 22, c: 28, f: 16, unit: '份', aliases: ['yong tau foo', 'ytf', '酿豆腐', 'yong tau fu'] },
  { name: '猪肠粉 Chee Cheong Fun', kcal: 350, p: 8, c: 60, f: 9, unit: '份', aliases: ['chee cheong fun', 'ccf', '猪肠粉', '肠粉'] },
  { name: '沙爹（每串）', kcal: 50, p: 4, c: 2, f: 3, unit: '串', aliases: ['satay', 'sate', '沙爹'] },
  { name: '罗惹 Rojak', kcal: 350, p: 8, c: 45, f: 16, unit: '份', aliases: ['rojak', '罗惹'] },
  { name: '薄饼 Popiah', kcal: 200, p: 6, c: 28, f: 7, unit: '条', aliases: ['popiah', '薄饼', 'poh piah'] },

  // --- Mamak / Indian --------------------------------------------------------
  { name: '印度煎饼 Roti Canai', kcal: 300, p: 6, c: 40, f: 13, unit: '片', aliases: ['roti canai', 'roti kosong', '印度煎饼', 'roti prata', 'canai'] },
  { name: '蛋煎饼 Roti Telur', kcal: 400, p: 12, c: 42, f: 20, unit: '片', aliases: ['roti telur', 'roti egg', '蛋煎饼'] },
  { name: '嘛嘛炒面 Mee Goreng Mamak', kcal: 660, p: 20, c: 85, f: 26, unit: '盘', aliases: ['mee goreng', 'mee goreng mamak', '炒面', 'mi goreng'] },
  { name: '炒美极面 Maggi Goreng', kcal: 600, p: 16, c: 78, f: 24, unit: '盘', aliases: ['maggi goreng', '美极炒面', 'mee maggi goreng'] },
  { name: '印度煎饼卷 Murtabak', kcal: 700, p: 28, c: 70, f: 34, unit: '份', aliases: ['murtabak', 'martabak'] },
  { name: '印度薄饼 Thosai', kcal: 180, p: 5, c: 32, f: 4, unit: '片', aliases: ['thosai', 'tosai', 'dosa', 'dosai'] },
  { name: '扁担饭 Nasi Kandar', kcal: 800, p: 32, c: 90, f: 34, unit: '份', aliases: ['nasi kandar', '扁担饭'] },
  { name: '蕉叶饭 Banana Leaf Rice', kcal: 750, p: 22, c: 105, f: 26, unit: '份', aliases: ['banana leaf rice', 'banana leaf', '蕉叶饭'] },
  { name: '咖喱角 Curry Puff', kcal: 130, p: 3, c: 15, f: 7, unit: '个', aliases: ['curry puff', 'karipap', '咖喱角'] },

  // --- Drinks ----------------------------------------------------------------
  { name: '拉茶 Teh Tarik', kcal: 130, p: 3, c: 22, f: 3, unit: '杯', aliases: ['teh tarik', '拉茶', 'teh'] },
  { name: '黑咖啡 Kopi O', kcal: 40, p: 0, c: 10, f: 0, unit: '杯', aliases: ['kopi o', 'kopi kosong', '黑咖啡', 'black coffee'] },
  { name: '咖啡（加奶） Kopi', kcal: 150, p: 3, c: 25, f: 4, unit: '杯', aliases: ['kopi', 'kopi peng', 'coffee', '咖啡', 'kopi ais'] },
  { name: '美禄冰 Milo Ais', kcal: 200, p: 6, c: 32, f: 6, unit: '杯', aliases: ['milo', 'milo ais', 'milo ping', '美禄'] },
  { name: '玫瑰奶 Sirap Bandung', kcal: 200, p: 3, c: 40, f: 4, unit: '杯', aliases: ['bandung', 'sirap bandung', '玫瑰奶'] },
  { name: '柠檬冰茶', kcal: 120, p: 0, c: 30, f: 0, unit: '杯', aliases: ['iced lemon tea', 'lemon tea', '柠檬茶', 'teh o ais limau'] },
  { name: '珍珠奶茶', kcal: 350, p: 6, c: 60, f: 10, unit: '杯', aliases: ['bubble tea', 'boba', 'pearl milk tea', '珍珠奶茶', 'milk tea', 'tealive'] },
  { name: '100 Plus', kcal: 90, p: 0, c: 22, f: 0, unit: '罐', aliases: ['100 plus', '100plus', 'isotonic'] },
  { name: '可乐（罐）', kcal: 139, p: 0, c: 35, f: 0, unit: '罐', aliases: ['coke', 'coca cola', '可乐', 'pepsi', 'soft drink'] },
  { name: '鲜橙汁', kcal: 110, p: 2, c: 26, f: 0, unit: '杯', aliases: ['orange juice', '橙汁', 'jus oren'] },
  { name: '豆浆', kcal: 130, p: 8, c: 15, f: 4, unit: '杯', aliases: ['soy milk', 'soya', '豆浆', 'soya bean'] },

  // --- Fast food -------------------------------------------------------------
  { name: 'Big Mac', kcal: 550, p: 25, c: 45, f: 30, unit: '个', aliases: ['big mac', 'bigmac', '巨无霸'] },
  { name: 'McChicken', kcal: 400, p: 14, c: 40, f: 21, unit: '个', aliases: ['mcchicken', 'mc chicken'] },
  { name: '麦当劳薯条（中）', kcal: 340, p: 4, c: 44, f: 16, unit: '份', aliases: ['fries', 'french fries', '薯条', 'mcd fries'] },
  { name: '麦乐鸡（6 块）', kcal: 270, p: 15, c: 16, f: 16, unit: '份', aliases: ['nuggets', 'mcnuggets', '麦乐鸡', 'chicken nuggets'] },
  { name: 'KFC 炸鸡（2 块）', kcal: 500, p: 38, c: 16, f: 32, unit: '份', aliases: ['kfc', 'fried chicken', '炸鸡', 'ayam goreng kfc'] },
  { name: '披萨（每片）', kcal: 285, p: 12, c: 36, f: 10, unit: '片', aliases: ['pizza', '披萨', '比萨'] },
  { name: 'Subway 六寸', kcal: 350, p: 20, c: 46, f: 9, unit: '个', aliases: ['subway', 'sub', '潜艇堡'] },
  { name: '汉堡（普通）', kcal: 400, p: 20, c: 38, f: 19, unit: '个', aliases: ['burger', '汉堡', 'hamburger'] },

  // --- Home staples ----------------------------------------------------------
  { name: '白饭（一碗）', kcal: 200, p: 4, c: 45, f: 0, unit: '碗', aliases: ['rice', 'white rice', '白饭', 'nasi putih', '饭'] },
  { name: '糙米饭（一碗）', kcal: 215, p: 5, c: 45, f: 2, unit: '碗', aliases: ['brown rice', '糙米饭', 'nasi perang'] },
  { name: '鸡胸肉 100g', kcal: 165, p: 31, c: 0, f: 4, unit: '100g', aliases: ['chicken breast', '鸡胸', '鸡胸肉', 'dada ayam'] },
  { name: '鸡蛋（一个）', kcal: 78, p: 6, c: 1, f: 5, unit: '个', aliases: ['egg', '鸡蛋', '蛋', 'telur'] },
  { name: '面包（一片）', kcal: 80, p: 3, c: 14, f: 1, unit: '片', aliases: ['bread', '面包', 'roti'] },
  { name: '烤面包 Roti Bakar', kcal: 250, p: 6, c: 30, f: 12, unit: '份', aliases: ['roti bakar', 'kaya toast', '烤面包', '咖椰面包'] },
  { name: '快熟面（一包）', kcal: 380, p: 8, c: 54, f: 14, unit: '包', aliases: ['instant noodles', 'maggi', '快熟面', '泡面', 'mee segera'] },
  { name: '燕麦 50g', kcal: 190, p: 7, c: 33, f: 4, unit: '份', aliases: ['oats', 'oatmeal', '燕麦', 'rolled oats'] },
  { name: '三文鱼 100g', kcal: 208, p: 20, c: 0, f: 13, unit: '100g', aliases: ['salmon', '三文鱼', 'ikan salmon'] },
  { name: '金枪鱼罐头', kcal: 130, p: 28, c: 0, f: 1, unit: '罐', aliases: ['tuna', '金枪鱼', '吞拿鱼'] },
  { name: '牛奶 250ml', kcal: 150, p: 8, c: 12, f: 8, unit: '杯', aliases: ['milk', '牛奶', 'susu'] },
  { name: '希腊酸奶 150g', kcal: 130, p: 15, c: 6, f: 4, unit: '盒', aliases: ['greek yogurt', 'yogurt', '酸奶', '优格'] },
  { name: '花生酱（一勺）', kcal: 95, p: 4, c: 3, f: 8, unit: '勺', aliases: ['peanut butter', '花生酱'] },

  // --- Fruit & snacks --------------------------------------------------------
  { name: '香蕉', kcal: 105, p: 1, c: 27, f: 0, unit: '根', aliases: ['banana', '香蕉', 'pisang'] },
  { name: '苹果', kcal: 95, p: 0, c: 25, f: 0, unit: '个', aliases: ['apple', '苹果', 'epal'] },
  { name: '炸香蕉 Pisang Goreng', kcal: 110, p: 1, c: 16, f: 5, unit: '个', aliases: ['pisang goreng', 'goreng pisang', '炸香蕉'] },
  { name: '煎蕊 Cendol', kcal: 250, p: 3, c: 45, f: 7, unit: '碗', aliases: ['cendol', 'chendol', '煎蕊'] },
  { name: '娘惹糕（每件）', kcal: 120, p: 2, c: 22, f: 3, unit: '件', aliases: ['kuih', 'kueh', '糕点', 'nyonya kuih'] },
  { name: '虾饼 Keropok', kcal: 150, p: 2, c: 18, f: 8, unit: '份', aliases: ['keropok', 'kerepek', '虾饼', 'prawn cracker'] },
  { name: '点心（每件）', kcal: 60, p: 3, c: 6, f: 2, unit: '件', aliases: ['dim sum', '点心', 'dimsum'] },

  // --- Gym -------------------------------------------------------------------
  { name: '乳清蛋白（一勺）', kcal: 120, p: 24, c: 3, f: 2, unit: '勺', aliases: ['whey', 'protein powder', 'whey protein', '蛋白粉', '乳清'] },
  { name: '蛋白奶昔（加牛奶）', kcal: 270, p: 32, c: 15, f: 10, unit: '杯', aliases: ['protein shake', '蛋白奶昔', 'protein drink'] },
];

/** Lowercase, strip punctuation and spaces — so "Nasi Lemak" == "nasi-lemak". */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

/**
 * Pull a leading quantity off the query: "2 roti canai" -> { qty: 2, rest: 'roti canai' }.
 * Also handles a trailing "x2" and Chinese "两个". Defaults to 1.
 */
export function parseQuantity(text) {
  const raw = String(text ?? '').trim();

  const leading = raw.match(/^(\d+(?:\.\d+)?)\s*(?:x|\*|个|份|杯|碗|片|条|串|包|块|件|根|盘|罐|勺)?\s*(.+)$/i);
  if (leading) return { qty: parseFloat(leading[1]), rest: leading[2].trim() };

  const trailing = raw.match(/^(.+?)\s*[x*]\s*(\d+(?:\.\d+)?)$/i);
  if (trailing) return { qty: parseFloat(trailing[2]), rest: trailing[1].trim() };

  const CN_NUM = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 半: 0.5 };
  const cn = raw.match(/^([一两二三四五六七八九十半])\s*(?:个|份|杯|碗|片|条|串|包|块|件|根|盘|罐|勺)?\s*(.+)$/);
  if (cn) return { qty: CN_NUM[cn[1]], rest: cn[2].trim() };

  return { qty: 1, rest: raw };
}

// How much of a longer query an alias must cover before we treat it as a real
// match. Without this, "杂菜饭 白饭加炸鸡炒长豆和咖喱汁" matches the KFC entry on
// the two incidental characters 炸鸡 and prices a whole mixed plate as fried
// chicken — a confidently wrong number, which is worse than no match at all,
// because a miss correctly hands the query to the AI tier instead.
const MIN_ALIAS_COVERAGE = 0.5;

/**
 * Find the best local match for a food name.
 *
 * Exact alias hit wins; otherwise the LONGEST alias contained in the query
 * wins, so "nasi lemak ayam goreng" resolves to the fried-chicken entry rather
 * than plain nasi lemak. Returns null when nothing matches, which is the
 * signal for the caller to offer AI estimation instead.
 *
 * @returns {{name, kcal, p, c, f, unit, qty, source: 'local'} | null}
 */
export function lookupFood(query) {
  const { qty, rest } = parseQuantity(query);
  const q = normalize(rest);
  if (!q) return null;

  let best = null;
  let bestLen = 0;

  for (const item of FOOD_DB) {
    for (const alias of item.aliases) {
      const a = normalize(alias);
      if (!a) continue;

      if (a === q) {
        best = item;
        bestLen = Infinity; // exact match cannot be beaten
        break;
      }

      // The user typed a fragment of a longer name ("canai" -> roti canai).
      // Always fine: they typed less than the dish is called, not more.
      const isFragmentOfAlias = a.includes(q);

      // The alias appears inside a longer query. Only trust it when it covers
      // enough of what was typed — otherwise it is an incidental mention
      // inside a description of something bigger.
      const coversEnoughOfQuery = q.includes(a) && a.length / q.length >= MIN_ALIAS_COVERAGE;

      if ((isFragmentOfAlias || coversEnoughOfQuery) && a.length > bestLen) {
        best = item;
        bestLen = a.length;
      }
    }
    if (bestLen === Infinity) break;
  }

  if (!best) return null;

  return {
    name: best.name,
    kcal: Math.round(best.kcal * qty),
    p: Math.round(best.p * qty),
    c: Math.round(best.c * qty),
    f: Math.round(best.f * qty),
    unit: best.unit,
    qty,
    source: 'local',
  };
}

/** Type-ahead suggestions for the manual-entry box. */
export function searchFoods(query, limit = 6) {
  const q = normalize(query);
  if (!q) return [];

  const hits = [];
  for (const item of FOOD_DB) {
    const matched = item.aliases.some((a) => {
      const n = normalize(a);
      return n.includes(q) || q.includes(n);
    }) || normalize(item.name).includes(q);
    if (matched) hits.push(item);
    if (hits.length >= limit) break;
  }
  return hits;
}
