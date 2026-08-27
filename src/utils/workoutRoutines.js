// The training plan itself, as data.
//
// WHY THIS IS ITS OWN FILE NOW
// These four splits used to be a hardcoded `DEFAULT_ROUTINES` array inside
// SportsModule.jsx that the app invented — four plausible-looking gym days that
// were not the user's actual programme. He has been training a real 4-day split
// for weeks and the app was quietly disagreeing with him about what he does.
//
// So the plan lives here, verbatim from what he handed over, and the module
// renders it rather than inventing it. Two shapes of the same four days:
//
//   GYM_ROUTINES   the real thing, machines and free weights
//   HOME_ROUTINES  the same four muscle groups with no equipment at all
//
// Both are tagged `place`, and the module shows one place at a time — the
// rotation ("last time was back, so today is legs") runs inside a place,
// because doing gym-back then home-legs is still legs day.
//
// EVERY EXERCISE CARRIES ITS REST TIME
// The rest timer was hardcoded to 60 seconds for everything, which is wrong in
// both directions: 60s is not enough after heavy incline press (needs 75) and
// too much after a triceps pushdown (45). The whole point of this programme is
// that it fits in 50 minutes, and it only fits if the rests are the ones
// written down. So `restSec` is part of the exercise, not a global default.

/** Warm-up before the working sets. Not logged as a set; it's part of the clock. */
export const WARMUP_MIN = 3;

/** Default reps per working set across this programme (~35s of work). */
export const DEFAULT_REPS = 12;

/**
 * Ceiling on how long changing exercise / finding a machine should take.
 * Shown in the session screen as a nudge, not enforced — the app can't know
 * someone else is on the pec deck.
 */
export const SWITCH_LIMIT_SEC = 60;

// `mode: 'time'` marks a hold rather than a rep count (wall sit, plank). Those
// log seconds instead of reps, and their calorie estimate uses the hold time
// directly — counting a 45-second wall sit as "12 reps x 4s" would be fiction.
export const GYM_ROUTINES = [
  {
    id: 1,
    block: 1,
    place: 'gym',
    name: '板块 1 · 胸 + 三头',
    focus: '胸肌 + 三头肌',
    durationEst: '45 分钟',
    exercises: [
      { name: '上斜哑铃卧推', en: 'Incline Dumbbell Press', targetSets: 4, restSec: 75, reps: 12, note: '大重量主攻，需要充分恢复' },
      { name: '推胸机', en: 'Chest Press Machine', targetSets: 4, restSec: 60, reps: 12, note: '固定轨迹，快速充血' },
      { name: '蝴蝶机夹胸', en: 'Pec Deck Fly', targetSets: 4, restSec: 60, reps: 12, note: '孤立中缝，保持泵感' },
      { name: '绳索过头臂屈伸', en: 'Overhead Cable Triceps Extension', targetSets: 4, restSec: 60, reps: 12 },
      { name: '绳索三头下压', en: 'Cable Triceps Pushdown', targetSets: 4, restSec: 45, reps: 12, note: '收尾孤立小肌群，拉爆离场' },
    ],
  },
  {
    id: 2,
    block: 2,
    place: 'gym',
    name: '板块 2 · 背 + 二头',
    focus: '背部 + 二头肌',
    durationEst: '46 分钟',
    exercises: [
      { name: '高位下拉', en: 'Lat Pulldown', targetSets: 4, restSec: 75, reps: 12 },
      { name: '俯身杠铃划船', en: 'Barbell Row', targetSets: 3, restSec: 90, reps: 12, note: '复合大动作，护好腰，给够休息' },
      { name: '坐姿绳索划船', en: 'Seated Cable Row', targetSets: 4, restSec: 60, reps: 12 },
      { name: '站姿杠铃弯举', en: 'Barbell Biceps Curl', targetSets: 4, restSec: 60, reps: 12 },
      { name: '哑铃锤式弯举', en: 'Dumbbell Hammer Curl', targetSets: 3, restSec: 45, reps: 12, note: '锤爆侧面，做完闪人' },
    ],
  },
  {
    id: 3,
    block: 3,
    place: 'gym',
    name: '板块 3 · 护膝强腿',
    focus: '特种兵护膝强腿',
    durationEst: '45 分钟',
    exercises: [
      { name: '卧姿腿弯举', en: 'Lying Leg Curl', targetSets: 4, restSec: 60, reps: 12, note: '预热大腿后侧与膝关节' },
      { name: '坐姿腿屈伸', en: 'Seated Leg Extension', targetSets: 4, restSec: 60, reps: 12, note: '顶峰停顿 1 秒，激活子弹肌' },
      { name: '坐姿倒蹬机', en: 'Seated Leg Press', targetSets: 4, restSec: 90, reps: 12, note: '大重量复合，蹬完深呼吸' },
      { name: '靠墙静蹲', en: 'Wall Sit', targetSets: 3, restSec: 45, mode: 'time', holdSec: 45, note: '固化稳定性收尾' },
    ],
  },
  {
    id: 4,
    block: 4,
    place: 'gym',
    name: '板块 4 · 肩 + 腹',
    focus: '肩膀 + 腹肌雕刻',
    durationEst: '47 分钟',
    exercises: [
      { name: '哑铃坐姿推肩', en: 'Dumbbell Shoulder Press', targetSets: 4, restSec: 75, reps: 12 },
      { name: '哑铃侧平举', en: 'Dumbbell Lateral Raise', targetSets: 4, restSec: 60, reps: 12, note: '打造倒三角宽肩' },
      { name: '绳索面拉 / 后束飞鸟', en: 'Face Pull / Rear Delt Fly', targetSets: 4, restSec: 60, reps: 12 },
      { name: '抬腿卷腹机', en: 'Ab Crunch / Leg Raise Machine', targetSets: 4, restSec: 45, reps: 12, note: '腹肌耐受力强，休息短效果好' },
      { name: '山羊挺身 / 平板支撑', en: 'Hyperextension / Plank', targetSets: 3, restSec: 45, mode: 'time', holdSec: 45, note: '护腰收尾' },
    ],
  },
];

// The same four days with nothing but a floor, a wall and body weight.
//
// Matched exercise-for-exercise to the gym version rather than being a generic
// "home workout": the point is that missing the gym doesn't break the rotation.
// Set counts and rests stay the same, so the 45-50 minute shape of the session
// survives too.
export const HOME_ROUTINES = [
  {
    id: 101,
    block: 1,
    place: 'home',
    name: '板块 1 · 胸 + 三头（徒手）',
    focus: '胸肌 + 三头肌',
    durationEst: '42 分钟',
    exercises: [
      { name: '下斜俯卧撑（脚垫高）', en: 'Decline Push-up', targetSets: 4, restSec: 75, reps: 12, note: '脚放椅子上，代替上斜推胸' },
      { name: '标准俯卧撑', en: 'Push-up', targetSets: 4, restSec: 60, reps: 12 },
      { name: '宽距俯卧撑', en: 'Wide Push-up', targetSets: 4, restSec: 60, reps: 12, note: '手放宽，找夹胸的感觉' },
      { name: '椅子撑体', en: 'Bench Dip', targetSets: 4, restSec: 60, reps: 12, note: '代替过头臂屈伸' },
      { name: '钻石俯卧撑', en: 'Diamond Push-up', targetSets: 4, restSec: 45, reps: 12, note: '三头收尾' },
    ],
  },
  {
    id: 102,
    block: 2,
    place: 'home',
    name: '板块 2 · 背 + 二头（徒手）',
    focus: '背部 + 二头肌',
    durationEst: '43 分钟',
    exercises: [
      { name: '引体向上 / 弹力带下拉', en: 'Pull-up / Band Pulldown', targetSets: 4, restSec: 75, reps: 12 },
      { name: '桌下反向划船', en: 'Inverted Row', targetSets: 3, restSec: 90, reps: 12, note: '躺在桌子底下拉，代替杠铃划船' },
      { name: '弹力带坐姿划船', en: 'Band Seated Row', targetSets: 4, restSec: 60, reps: 12 },
      { name: '弹力带弯举', en: 'Band Biceps Curl', targetSets: 4, restSec: 60, reps: 12 },
      { name: '弹力带锤式弯举', en: 'Band Hammer Curl', targetSets: 3, restSec: 45, reps: 12 },
    ],
  },
  {
    id: 103,
    block: 3,
    place: 'home',
    name: '板块 3 · 护膝强腿（徒手）',
    focus: '特种兵护膝强腿',
    durationEst: '42 分钟',
    exercises: [
      { name: '臀桥 / 单腿臀桥', en: 'Glute Bridge', targetSets: 4, restSec: 60, reps: 12, note: '预热后侧链与膝关节' },
      { name: '西西里深蹲 / 徒手腿屈伸', en: 'Sissy Squat', targetSets: 4, restSec: 60, reps: 12, note: '顶峰停顿 1 秒' },
      { name: '保加利亚分腿蹲', en: 'Bulgarian Split Squat', targetSets: 4, restSec: 90, reps: 12, note: '代替倒蹬机，一边算一组' },
      { name: '靠墙静蹲', en: 'Wall Sit', targetSets: 3, restSec: 45, mode: 'time', holdSec: 45, note: '固化稳定性收尾' },
    ],
  },
  {
    id: 104,
    block: 4,
    place: 'home',
    name: '板块 4 · 肩 + 腹（徒手）',
    focus: '肩膀 + 腹肌雕刻',
    durationEst: '44 分钟',
    exercises: [
      { name: '派克俯卧撑', en: 'Pike Push-up', targetSets: 4, restSec: 75, reps: 12, note: '代替推肩' },
      { name: '弹力带 / 水瓶侧平举', en: 'Lateral Raise', targetSets: 4, restSec: 60, reps: 12 },
      { name: '俯身 W 字后束', en: 'Prone W Raise', targetSets: 4, restSec: 60, reps: 12, note: '趴着做，代替面拉' },
      { name: '躺姿抬腿', en: 'Lying Leg Raise', targetSets: 4, restSec: 45, reps: 12 },
      { name: '平板支撑', en: 'Plank', targetSets: 3, restSec: 45, mode: 'time', holdSec: 45, note: '护腰收尾' },
    ],
  },
];

/** Everything the app ships with. Order matters — it IS the rotation order. */
export const DEFAULT_ROUTINES = [...GYM_ROUTINES, ...HOME_ROUTINES];

/** The two places, for the toggle. */
export const PLACES = [
  { key: 'gym', label: '健身房', hint: '有器械' },
  { key: 'home', label: '徒手', hint: '没器械' },
];

/** Ids the app owns, so a migration can replace them without touching custom ones. */
export const STOCK_ROUTINE_IDS = DEFAULT_ROUTINES.map(r => r.id);
