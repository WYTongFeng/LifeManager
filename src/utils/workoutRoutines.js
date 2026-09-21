// The training plan itself, as data.
//
// WHY THIS IS ITS OWN FILE
// The routines are the user's own programme, not something this app invented,
// and he redesigns it from time to time (this is the second full rewrite). The
// module renders whatever is here rather than inventing a plan of its own. Two
// shapes of the same four days:
//
//   GYM_ROUTINES   the real thing, machines and free weights
//   HOME_ROUTINES  the same four muscle groups with no equipment at all
//
// Both are tagged `place`, and the module shows one place at a time — the
// rotation ("last time was back, so today is legs") runs inside a place,
// because doing gym-back then home-legs is still legs day.
//
// EDITING THIS FILE IS NO LONGER HOW HE CHANGES HIS PLAN
// This used to be the only way to change a routine's exercises, rest times or
// notes — the in-app "新增菜单" form could only add a whole new routine from a
// bare list of names. SportsModule now has a real per-exercise editor (name,
// sets, reps, rest, notes, delete, add) on the plan screen, so a redesign like
// this one goes straight into the app instead of waiting on a code change.
// This file only supplies what the app ships with on first install.
//
// EVERY EXERCISE CARRIES ITS OWN REST TIME
// A flat 60 seconds for everything is wrong in both directions: not enough
// after a heavy compound lift, too much after a small isolation finisher. So
// `restSec` is part of the exercise, not a global default.

/** Warm-up before the working sets. Not logged as a set; it's part of the clock. */
export const WARMUP_MIN = 3;

/** Default reps per working set when an exercise doesn't state its own. */
export const DEFAULT_REPS = 12;

// `mode: 'time'` marks a hold rather than a rep count (wall sit, plank). Those
// log seconds instead of reps, and their calorie estimate uses the hold time
// directly — counting a 45-second wall sit as "12 reps x 4s" would be fiction.
//
// `reps` below is the LOW end of the rep range he actually trains (e.g. "3 x
// 6-10" becomes reps: 6) — the plan screen shows it as the starting target,
// and the full range lives in `note`. The progression rule is his own: once
// every set hits the top of the range, add weight and restart at the bottom.
export const GYM_ROUTINES = [
  {
    id: 1,
    block: 1,
    place: 'gym',
    name: 'Day 1 · 胸 + 三头',
    focus: '胸肌 + 三头肌',
    durationEst: '50–53 分钟',
    exercises: [
      { name: '上斜哑铃卧推', en: 'Incline Dumbbell Press', targetSets: 3, restSec: 120, reps: 6, note: '25–30 lb/手，大重量主攻，需要充分恢复' },
      { name: '坐姿推胸机', en: 'Chest Press Machine', targetSets: 3, restSec: 90, reps: 8, note: '30kg，固定轨迹快速充血' },
      { name: '蝴蝶机夹胸', en: 'Pec Deck Fly', targetSets: 3, restSec: 60, reps: 10, note: '30kg，孤立中缝' },
      { name: '绳索过头三头伸展', en: 'Overhead Cable Triceps Extension', targetSets: 3, restSec: 60, reps: 10, note: '30kg' },
      { name: '绳索三头下压', en: 'Cable Triceps Pushdown', targetSets: 2, restSec: 60, reps: 10, note: '25kg，收尾拉爆离场' },
    ],
  },
  {
    id: 2,
    block: 2,
    place: 'gym',
    name: 'Day 2 · 背 + 二头',
    focus: '背部 + 二头肌',
    durationEst: '50–53 分钟',
    exercises: [
      { name: '标准引体向上', en: 'Pull-up', targetSets: 3, restSec: 120, reps: 3, note: '自重，最多约5个；第一组不到3个就取消，Lat Pulldown 直接做 4 组 × 8–12' },
      { name: '杠铃（Smith）俯身划船', en: 'Barbell / Smith Row', targetSets: 3, restSec: 120, reps: 6, note: '30–35kg，复合大动作，护好腰' },
      { name: '高位下拉', en: 'Lat Pulldown', targetSets: 3, restSec: 90, reps: 8, note: '重量待测试' },
      { name: '坐姿划船', en: 'Seated Cable Row', targetSets: 2, restSec: 90, reps: 8, note: '30kg' },
      { name: '短杠弯举', en: 'Barbell Biceps Curl', targetSets: 3, restSec: 75, reps: 8, note: '10kg 杠片 + 杠' },
      { name: '哑铃锤式弯举', en: 'Dumbbell Hammer Curl', targetSets: 2, restSec: 60, reps: 10, note: '20lb/手，做完闪人' },
    ],
  },
  {
    id: 3,
    block: 3,
    place: 'gym',
    name: 'Day 3 · 腿',
    focus: '腿部',
    durationEst: '50–53 分钟',
    exercises: [
      { name: '坐姿腿推', en: 'Seated Leg Press', targetSets: 4, restSec: 120, reps: 8, note: '50kg' },
      { name: '卧姿腿弯举', en: 'Lying Leg Curl', targetSets: 3, restSec: 90, reps: 8, note: '25kg' },
      { name: '坐姿腿屈伸', en: 'Seated Leg Extension', targetSets: 3, restSec: 60, reps: 10, note: '机器坏了先用 Reverse Nordic 3×8–12 代替，修好换回来' },
      { name: 'Smith 小腿提踵', en: 'Smith Machine Calf Raise', targetSets: 3, restSec: 60, reps: 10, note: '重量待测试' },
      { name: '靠墙静蹲', en: 'Wall Sit', targetSets: 2, restSec: 45, mode: 'time', holdSec: 45, note: '自重，固化稳定性收尾' },
    ],
  },
  {
    id: 4,
    block: 4,
    place: 'gym',
    name: 'Day 4 · 肩 + 腹',
    focus: '肩膀 + 腹肌',
    durationEst: '45–50 分钟',
    exercises: [
      { name: '坐姿哑铃推肩', en: 'Dumbbell Shoulder Press', targetSets: 3, restSec: 90, reps: 6, note: '30lb/手' },
      { name: '哑铃侧平举', en: 'Dumbbell Lateral Raise', targetSets: 4, restSec: 60, reps: 12, note: '15lb/手，打造倒三角宽肩' },
      { name: '绳索面拉', en: 'Face Pull', targetSets: 3, restSec: 60, reps: 12, note: '25kg' },
      { name: '腹部卷腹机', en: 'Ab Crunch Machine', targetSets: 3, restSec: 60, reps: 8, note: '重量待测试' },
      { name: '悬垂抬膝', en: 'Hanging Knee Raise', targetSets: 3, restSec: 60, reps: 8, note: '自重' },
    ],
  },
];

// The same four days with nothing but a floor, a wall and body weight.
//
// Matched exercise-for-exercise to the gym version rather than being a generic
// "home workout": the point is that missing the gym doesn't break the
// rotation. Names now say "Day" to match the gym side after the September
// rewrite — the muscle groups per day didn't change, so the exercises below
// didn't need to.
export const HOME_ROUTINES = [
  {
    id: 101,
    block: 1,
    place: 'home',
    name: 'Day 1 · 胸 + 三头（徒手）',
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
    name: 'Day 2 · 背 + 二头（徒手）',
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
    name: 'Day 3 · 腿（徒手）',
    focus: '腿部',
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
    name: 'Day 4 · 肩 + 腹（徒手）',
    focus: '肩膀 + 腹肌',
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
