// Everything is stored and calculated in kg internally (calorie formulas,
// PRs, charts) — these two functions only exist for the display/input layer
// so a kg/lbs toggle never has to touch the numbers anything else depends on.

export function kgToLbs(kg) {
  return kg * 2.20462;
}

export function lbsToKg(lbs) {
  return lbs / 2.20462;
}

export function formatWeight(kg, unit) {
  if (!Number.isFinite(kg)) return unit === 'lbs' ? '0 lbs' : '0 kg';
  return unit === 'lbs' ? `${kgToLbs(kg).toFixed(1)} lbs` : `${Math.round(kg * 10) / 10} kg`;
}
