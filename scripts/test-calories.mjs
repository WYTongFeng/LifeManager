import {
  calcBMR, calcCalorieTarget, calcEnergyBalance, suggestMacros,
  ACTIVITY_LEVELS, DIET_GOALS,
} from '../src/utils/calories.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// A reference person used throughout: 70kg, 175cm, 22y, male.
// Mifflin-St Jeor: 10*70 + 6.25*175 - 5*22 + 5 = 700 + 1093.75 - 110 + 5 = 1688.75 -> 1689
const REF = { weightKg: 70, heightCm: 175, age: 22, sex: 'male' };

// --- calcBMR -----------------------------------------------------------------
check('male BMR matches Mifflin-St Jeor by hand', calcBMR(REF), 1689);
check('female is 166 kcal lower than male at identical stats (-161 vs +5)',
  calcBMR({ ...REF, sex: 'female' }), 1689 - 166);

// The whole module's house rule: no invented stand-ins for missing inputs.
check('missing weight -> null, not a guess', calcBMR({ ...REF, weightKg: null }), null);
check('missing height -> null', calcBMR({ ...REF, heightCm: null }), null);
check('missing age -> null', calcBMR({ ...REF, age: null }), null);
check('missing sex -> null', calcBMR({ ...REF, sex: null }), null);
check('zero weight is missing data, not a real 0', calcBMR({ ...REF, weightKg: 0 }), null);

// --- calcCalorieTarget -------------------------------------------------------
const bmr = calcBMR(REF); // 1689

check('sedentary + maintain = BMR x 1.2, nothing else',
  calcCalorieTarget({ bmr, activityLevel: 'sedentary', goal: 'maintain' }),
  Math.round(1689 * 1.2)); // 2027

check('cut subtracts exactly 500 from the maintain figure',
  calcCalorieTarget({ bmr, activityLevel: 'sedentary', goal: 'cut' }),
  Math.round(1689 * 1.2) - 500);

check('bulk adds exactly 300',
  calcCalorieTarget({ bmr, activityLevel: 'sedentary', goal: 'bulk' }),
  Math.round(1689 * 1.2) + 300);

// The reason the activity factors were re-scoped to exclude exercise: logged
// workout calories are added on top, so they must not also be in the factor.
check('logged workout calories are added on top of the activity baseline',
  calcCalorieTarget({ bmr, activityLevel: 'sedentary', goal: 'maintain', workoutCalories: 400 }),
  Math.round(1689 * 1.2) + 400);

check('a heavier daily-activity level raises the target',
  calcCalorieTarget({ bmr, activityLevel: 'moderate', goal: 'maintain' }),
  Math.round(1689 * 1.5));

check('no BMR -> null target, so the UI keeps the manual number',
  calcCalorieTarget({ bmr: null, activityLevel: 'sedentary', goal: 'maintain' }), null);

check('unknown activity key falls back to sedentary rather than NaN',
  calcCalorieTarget({ bmr, activityLevel: 'bogus', goal: 'maintain' }),
  Math.round(1689 * 1.2));

check('unknown goal key falls back to maintain rather than NaN',
  calcCalorieTarget({ bmr, activityLevel: 'sedentary', goal: 'bogus' }),
  Math.round(1689 * 1.2));

// --- calcEnergyBalance -------------------------------------------------------
const restingBurn = Math.round(1689 * 1.2); // 2027

check('burn excludes the goal offset — net 0 means maintenance, not target hit',
  calcEnergyBalance({ bmr, activityLevel: 'sedentary', intake: restingBurn, workoutCalories: 0 }),
  { burn: restingBurn, intake: restingBurn, net: 0 });

check('eating over maintenance reads as a positive surplus',
  calcEnergyBalance({ bmr, activityLevel: 'sedentary', intake: restingBurn + 300 }).net, 300);

check('training pushes burn up, turning the same intake into a deficit',
  calcEnergyBalance({ bmr, activityLevel: 'sedentary', intake: restingBurn, workoutCalories: 500 }).net, -500);

check('no BMR -> null balance', calcEnergyBalance({ bmr: null, activityLevel: 'sedentary', intake: 2000 }), null);

// --- suggestMacros -----------------------------------------------------------
// 2000 kcal, 70kg, cut: protein 70*2.0 = 140g; fat 2000*0.25/9 = 55.6 -> 56g;
// carbs (2000 - 140*4 - 56*9) / 4 = (2000 - 560 - 504) / 4 = 234
check('cut anchors protein at 2.0g/kg and fat at 25% of energy',
  suggestMacros({ calorieTarget: 2000, weightKg: 70, goal: 'cut' }),
  { protein: 140, carbs: 234, fat: 56 });

check('maintain uses a lower 1.6g/kg protein floor',
  suggestMacros({ calorieTarget: 2000, weightKg: 70, goal: 'maintain' }).protein, 112);

check('no body weight -> null, since protein-per-kg is meaningless without it',
  suggestMacros({ calorieTarget: 2000, weightKg: null, goal: 'cut' }), null);

check('no target -> null', suggestMacros({ calorieTarget: null, weightKg: 70, goal: 'cut' }), null);

// A tiny target can drive the carb remainder negative; it must clamp, because a
// negative gram target would render as a nonsense progress bar.
check('carbs clamp at 0 instead of going negative on a very low target',
  suggestMacros({ calorieTarget: 800, weightKg: 90, goal: 'cut' }).carbs, 0);

// --- table sanity ------------------------------------------------------------
check('activity factors are ordered and none of them silently include exercise',
  Object.values(ACTIVITY_LEVELS).map(a => a.factor), [1.2, 1.35, 1.5]);
check('goal offsets are the documented ones',
  Object.values(DIET_GOALS).map(g => g.offset), [-500, 0, 300]);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
if (fail > 0) process.exit(1);
