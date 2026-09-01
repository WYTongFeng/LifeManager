import React, { useState, useEffect } from 'react';
import { ClipboardPaste, Copy, Plus, AlertTriangle, Sparkles, Flame, Trash2, Utensils } from '../utils/icons';
import confetti from 'canvas-confetti';
import { usePersistentState, useLiveJSON } from '../utils/storage';
import { num, sumBy, newId } from '../utils/num';
import {
  calcBMR, calcCalorieTarget, calcEnergyBalance, suggestMacros,
  ACTIVITY_LEVELS, DIET_GOALS, DEFAULT_ACTIVITY, DEFAULT_GOAL,
} from '../utils/calories';
import { lookupFood, searchFoods } from '../utils/foodDb';
import { estimateFoodFromText, sumItems, scaleItem } from '../utils/foodEstimate';
import { AI_FOOD_PROMPT, parsePastedFood } from '../utils/foodPaste';
import { nowTimeStr } from '../utils/datetime';

/** Guess the meal slot from the clock, so the user rarely has to change it. */
function currentMealCategory(now = new Date()) {
  const h = now.getHours();
  if (h < 11) return 'Breakfast';
  if (h < 15) return 'Lunch';
  if (h < 21) return 'Dinner';
  return 'Snacks';
}

export default function DietModule({ meals, setMeals, calorieLimit, setCalorieLimit, macroTargets, setMacroTargets, workouts = [] }) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [editingMealId, setEditingMealId] = useState(null);
  const [customFoodName, setCustomFoodName] = useState('');
  const [customCalories, setCustomCalories] = useState('');
  const [customCategory, setCustomCategory] = useState('Lunch');
  const [customProtein, setCustomProtein] = useState('');
  const [customCarbs, setCustomCarbs] = useState('');
  const [customFat, setCustomFat] = useState('');

  // Where the numbers in the form came from: 'local' | 'paste' | null (typed).
  // Shown to the user and stored on the meal, because an AI guess and a
  // hand-weighed figure deserve different levels of trust later. 'ai' still
  // appears on meals logged by builds that called the API directly.
  const [estimateSource, setEstimateSource] = useState(null);
  const [estimateNote, setEstimateNote] = useState('');
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState('');

  // The per-component breakdown behind the totals. For a mixed plate this is
  // where the accuracy actually comes from: the model gets the components
  // roughly right, and the user fixes portions in a couple of taps.
  const [items, setItems] = useState([]);
  const [confidence, setConfidence] = useState(null);
  const [newItemName, setNewItemName] = useState('');

  // The paste-from-an-outside-AI flow (see foodPaste.js). `promptCopied` is
  // the only feedback that the copy worked — on Android nothing else on screen
  // changes when the clipboard is written.
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  // Live suggestions from the offline table as the user types a name.
  const nameSuggestions = customFoodName.trim() && !estimateSource ? searchFoods(customFoodName, 4) : [];

  // Diet owns these two; the body profile below belongs to SportsModule, so it
  // is read through useLiveJSON — a second usePersistentState for the same key
  // would silently drift out of sync with the one writing it (see storage.js).
  const [activityLevel, setActivityLevel] = usePersistentState('activityLevel', DEFAULT_ACTIVITY);
  const [dietGoal, setDietGoal] = usePersistentState('dietGoal', DEFAULT_GOAL);
  const [autoCalorieTarget, setAutoCalorieTarget] = usePersistentState('autoCalorieTarget', false);

  const bodyWeightKg = useLiveJSON('bodyWeightKg', null);
  const heightCm = useLiveJSON('heightCm', null);
  const ageYears = useLiveJSON('ageYears', null);
  const sex = useLiveJSON('sex', null);

  // Calculate stats
  const totalCalories = sumBy(meals, m => m.calories);
  const totalProtein = sumBy(meals, m => m.protein);
  const totalCarbs = sumBy(meals, m => m.carbs);
  const totalFat = sumBy(meals, m => m.fat);

  // Energy out: resting burn scaled for daily life, plus what the gym actually
  // logged today. Workout calories are null when body weight is unset — sumBy
  // treats that as nothing rather than NaN.
  const workoutCalories = sumBy(workouts, w => w.calories);
  const bmr = calcBMR({ weightKg: bodyWeightKg, heightCm, age: ageYears, sex });
  const hasBodyProfile = bmr != null;

  const suggestedTarget = calcCalorieTarget({ bmr, activityLevel, goal: dietGoal, workoutCalories });
  const balance = calcEnergyBalance({ bmr, activityLevel, intake: totalCalories, workoutCalories });
  const suggestedMacros = suggestMacros({ calorieTarget: suggestedTarget, weightKg: bodyWeightKg, goal: dietGoal });

  // With auto on, the target tracks the profile AND today's training — log a
  // workout and the budget rises by what it actually cost.
  useEffect(() => {
    if (autoCalorieTarget && suggestedTarget != null && suggestedTarget !== calorieLimit) {
      setCalorieLimit(suggestedTarget);
    }
  }, [autoCalorieTarget, suggestedTarget, calorieLimit, setCalorieLimit]);

  // Floored at 0 as well as capped: `calorieLimit` comes out of storage and can
  // legitimately be 0 for a moment while the field is being retyped, which made
  // this Infinity — and `Math.min(Infinity, 150)` is 150, so the ring silently
  // rendered "over limit" on an empty day.
  const percentage = calorieLimit > 0
    ? Math.min(Math.round((totalCalories / calorieLimit) * 100), 150)
    : 0;
  const isOverLimit = calorieLimit > 0 && totalCalories > calorieLimit;
  const isNearLimit = calorieLimit > 0 && totalCalories >= calorieLimit * 0.85 && !isOverLimit;

  /** Drop an estimate (from the table, AI, or a photo) into the form fields. */
  const applyEstimate = (est) => {
    setCustomFoodName(est.name);
    setCustomCalories(String(est.kcal));
    setCustomProtein(String(est.p));
    setCustomCarbs(String(est.c));
    setCustomFat(String(est.f));
    setEstimateSource(est.source);
    // The badge already names the source; only carry a note that adds something
    // (the AI's assumption about portion/prep).
    setEstimateNote(est.note || '');
    setEstimateError('');
    setItems(est.items ?? []);
    setConfidence(est.confidence ?? null);
  };

  /** Re-total the form from the component list after any edit to it. */
  const syncTotalsFromItems = (next) => {
    setItems(next);
    const t = sumItems(next);
    setCustomCalories(String(t.kcal));
    setCustomProtein(String(t.p));
    setCustomCarbs(String(t.c));
    setCustomFat(String(t.f));
  };

  const handleScaleItem = (id, factor) =>
    syncTotalsFromItems(items.map((it) => (it.id === id ? scaleItem(it, factor) : it)));

  const handleRemoveItem = (id) =>
    syncTotalsFromItems(items.filter((it) => it.id !== id));

  /** Add a component the model missed, priced from the free local table. */
  const handleAddItem = () => {
    const name = newItemName.trim();
    if (!name) return;
    const hit = lookupFood(name);
    if (!hit) {
      setEstimateError(`本地资料库没有「${name}」，请直接改下面的总热量`);
      return;
    }
    setEstimateError('');
    setNewItemName('');
    syncTotalsFromItems([
      ...items,
      {
        id: `${Date.now()}-add`,
        name: hit.name,
        portion: hit.qty > 1 ? `${hit.qty} ${hit.unit}` : hit.unit,
        kcal: hit.kcal, p: hit.p, c: hit.c, f: hit.f,
      },
    ]);
  };

  /** Look up whatever the user typed in the offline table. Free, instant. */
  const handleEstimateFromText = () => {
    if (!customFoodName.trim() || estimating) return;
    setEstimating(true);
    setEstimateError('');
    try {
      applyEstimate(estimateFoodFromText(customFoodName));
    } catch (err) {
      setEstimateError(err.message);
    } finally {
      setEstimating(false);
    }
  };

  /** Hand the outside AI the exact prompt, so its reply parses on the way back. */
  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_FOOD_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2500);
    } catch {
      // Clipboard access can be refused outright in a WebView. Rather than a
      // dead button, select the prompt so a long-press copy still works — same
      // fallback as TextExportModal.
      setPasteError('复制不了 — 长按下面灰色框里的文字自己复制');
      const box = document.getElementById('food-prompt-text');
      if (box) {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  };

  /** Pasted reply -> component breakdown -> prefilled review form. */
  const handleParsePaste = () => {
    setPasteError('');
    try {
      // Straight into the edit form rather than the log: an estimate written by
      // a model that never saw the plate is a starting point to correct, not a
      // fact. Same rule the vision call followed before it was removed.
      applyEstimate(parsePastedFood(pasteText));
      setCustomCategory(currentMealCategory());
      setEditingMealId(null);
      setShowPasteModal(false);
      setPasteText('');
      setShowAddModal(true);
    } catch (err) {
      setPasteError(err.message);
    }
  };

  const handleManualAdd = (e) => {
    e.preventDefault();
    if (!customFoodName || !customCalories) return;

    // Resolved ONCE, and validated. `parseInt` was called inline at four points
    // below, each able to produce NaN independently — and the `!customCalories`
    // guard above only catches an empty string, not "abc" or a stray "-". A
    // meal saved with `calories: NaN` makes every calorie total in the app read
    // NaN, and at midnight that NaN is archived into `history`, where nothing
    // ever recomputes it. Rejecting the save is the only safe answer.
    const calories = parseInt(customCalories, 10);
    if (!Number.isFinite(calories) || calories < 0) return;

    const macros = {
      protein: num(parseInt(customProtein, 10)),
      carbs: num(parseInt(customCarbs, 10)),
      fat: num(parseInt(customFat, 10)),
    };

    // Only keep a breakdown that still adds up to the totals — once the user
    // hand-edits the total calories, the stale component list would contradict
    // it, and a breakdown that disagrees with its own sum is worse than none.
    const itemsMatchTotals = items.length > 0 && sumItems(items).kcal === calories;
    const breakdown = itemsMatchTotals ? items : undefined;

    if (editingMealId) {
      setMeals(meals.map(m => m.id === editingMealId
        // `updatedAt` is what tells cloud sync this record changed — `at` stays
        // put because it is when the meal was actually eaten. See syncModel.js.
        ? { ...m, name: customFoodName, calories, category: customCategory, ...macros, source: estimateSource, items: breakdown, updatedAt: Date.now() }
        : m
      ));
    } else {
      const newMeal = {
        id: newId(),
        name: customFoodName,
        calories,
        ...macros,
        category: customCategory,
        time: nowTimeStr(),
        // `source` records how the numbers were obtained; aiDetected stays for
        // meals logged by older builds that only had that flag — and a pasted
        // estimate IS an AI estimate as far as that flag ever meant anything.
        source: estimateSource,
        aiDetected: estimateSource === 'ai' || estimateSource === 'paste',
        items: breakdown,
      };
      setMeals([newMeal, ...meals]);
      confetti({ particleCount: 40, spread: 60, origin: { y: 0.8 } });
    }

    resetMealForm();
    setShowAddModal(false);
  };

  const resetMealForm = () => {
    setEditingMealId(null);
    setCustomFoodName('');
    setCustomCalories('');
    setCustomCategory(currentMealCategory());
    setCustomProtein('');
    setCustomCarbs('');
    setCustomFat('');
    setEstimateSource(null);
    setEstimateNote('');
    setEstimateError('');
    setItems([]);
    setConfidence(null);
    setNewItemName('');
    setPasteText('');
    setPasteError('');
  };

  const handleOpenAddModal = () => {
    resetMealForm();
    setShowAddModal(true);
  };

  const handleOpenEditModal = (meal) => {
    setEditingMealId(meal.id);
    setCustomFoodName(meal.name);
    setCustomCalories(String(meal.calories));
    setCustomCategory(meal.category);
    setCustomProtein(String(meal.protein ?? ''));
    setCustomCarbs(String(meal.carbs ?? ''));
    setCustomFat(String(meal.fat ?? ''));
    setEstimateSource(meal.source ?? (meal.aiDetected ? 'ai' : null));
    setEstimateNote('');
    setEstimateError('');
    // Breakdowns are stored with the meal, so reopening one is still editable
    // component by component rather than collapsing to a single total.
    setItems(meal.items ?? []);
    setConfidence(null);
    setNewItemName('');
    setShowAddModal(true);
  };

  const handleDeleteMeal = (id) => {
    setMeals(meals.filter(m => m.id !== id));
  };

  const handleMacroTargetChange = (key, value) => {
    setMacroTargets({ ...macroTargets, [key]: Number(value) || 1 });
  };

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Module Title Banner */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>Diet Control</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Food Log & Daily Budget</p>
        </div>
        <button
          onClick={() => setShowPasteModal(true)}
          style={{
            background: 'var(--color-diet)',
            color: 'var(--color-diet-ink)',
            border: 'none',
            padding: '8px 14px',
            fontSize: '0.82rem',
            fontWeight: '700',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <ClipboardPaste size={16} /> 贴 AI 结果
        </button>
      </div>

      {/* Warning Alert Banner when Over Calorie Limit */}
      {isOverLimit && (
        <div style={{
          background: 'var(--color-accent-red-soft)',
          border: '1px solid var(--color-accent-red)',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: 'var(--text-primary)'
        }}>
          <AlertTriangle size={24} color="var(--color-accent-red)" style={{ shrink: 0 }} />
          <div>
            <h4 style={{ fontSize: '0.9rem', color: 'var(--color-accent-red)', fontWeight: '700' }}>Calorie Target Exceeded!</h4>
            <p style={{ fontSize: '0.78rem' }}>
              You have consumed {totalCalories} kcal, which is <strong>{totalCalories - calorieLimit} kcal</strong> over your daily limit of {calorieLimit} kcal.
            </p>
          </div>
        </div>
      )}

      {/* Near Limit Warning */}
      {isNearLimit && (
        <div style={{
          background: 'var(--color-diet-soft)',
          border: '1px solid var(--color-diet)',
          borderRadius: 'var(--radius-md)',
          padding: '0.85rem 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--text-primary)'
        }}>
          <AlertTriangle size={20} color="var(--color-diet)" />
          <p style={{ fontSize: '0.78rem' }}>
            Warning: You are at <strong>{percentage}%</strong> of your daily calorie limit! ({calorieLimit - totalCalories} kcal remaining)
          </p>
        </div>
      )}

      {/* Main Calorie Budget Card */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Flame size={18} color={isOverLimit ? "var(--color-accent-red)" : "var(--color-diet)"} /> Daily Energy Gauge
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Target:
            <input
              type="number"
              value={calorieLimit}
              onChange={(e) => setCalorieLimit(Number(e.target.value) || 2000)}
              style={{
                width: '60px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border-glass)',
                color: 'white',
                borderRadius: 'var(--radius-sm)',
                padding: '2px 6px',
                textAlign: 'center',
                fontSize: '0.8rem'
              }}
            /> kcal
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '1rem' }}>
          {/* Circular Progress Gauge */}
          <div style={{ position: 'relative', width: '120px', height: '120px' }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border-glass)" strokeWidth="10" />
              <circle
                cx="60" cy="60" r="50" fill="none"
                stroke={isOverLimit ? "var(--color-accent-red)" : isNearLimit ? "var(--color-diet)" : "var(--color-diet)"}
                strokeWidth="10"
                strokeDasharray="314"
                strokeDashoffset={314 - (314 * Math.min(percentage, 100)) / 100}
                strokeLinecap="round"
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }}
              />
            </svg>
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center'
            }}>
              <span style={{ fontSize: '1.4rem', fontWeight: '800', color: isOverLimit ? 'var(--color-accent-red)' : 'white' }}>
                {totalCalories}
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>/ {calorieLimit} kcal</span>
            </div>
          </div>

          {/* Quick Metrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Remaining</span>
              <span style={{ fontWeight: '700', color: isOverLimit ? 'var(--color-accent-red)' : 'var(--color-money)' }}>
                {isOverLimit ? `+${totalCalories - calorieLimit} over` : `${calorieLimit - totalCalories} kcal`}
              </span>
            </div>

            {/* Macro bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  <span>Protein ({totalProtein}g)</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <input
                      type="number"
                      value={macroTargets.protein}
                      onChange={(e) => handleMacroTargetChange('protein', e.target.value)}
                      style={{ width: '38px', background: 'var(--bg-input)', border: '1px solid var(--border-glass)', color: 'white', borderRadius: 'var(--radius-sm)', padding: '1px 3px', textAlign: 'center', fontSize: '0.68rem' }}
                    />g target
                  </span>
                </div>
                <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', marginTop: '2px' }}>
                  <div style={{ height: '100%', width: `${Math.min((totalProtein / macroTargets.protein) * 100, 100)}%`, background: 'var(--color-sports)', borderRadius: 'var(--radius-sm)' }}></div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  <span>Carbs ({totalCarbs}g)</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <input
                      type="number"
                      value={macroTargets.carbs}
                      onChange={(e) => handleMacroTargetChange('carbs', e.target.value)}
                      style={{ width: '38px', background: 'var(--bg-input)', border: '1px solid var(--border-glass)', color: 'white', borderRadius: 'var(--radius-sm)', padding: '1px 3px', textAlign: 'center', fontSize: '0.68rem' }}
                    />g target
                  </span>
                </div>
                <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', marginTop: '2px' }}>
                  <div style={{ height: '100%', width: `${Math.min((totalCarbs / macroTargets.carbs) * 100, 100)}%`, background: 'var(--color-money)', borderRadius: 'var(--radius-sm)' }}></div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                  <span>Fat ({totalFat}g)</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                    <input
                      type="number"
                      value={macroTargets.fat}
                      onChange={(e) => handleMacroTargetChange('fat', e.target.value)}
                      style={{ width: '38px', background: 'var(--bg-input)', border: '1px solid var(--border-glass)', color: 'white', borderRadius: 'var(--radius-sm)', padding: '1px 3px', textAlign: 'center', fontSize: '0.68rem' }}
                    />g target
                  </span>
                </div>
                <div style={{ height: '5px', background: 'var(--border-glass)', borderRadius: 'var(--radius-sm)', marginTop: '2px' }}>
                  <div style={{ height: '100%', width: `${Math.min((totalFat / macroTargets.fat) * 100, 100)}%`, background: 'var(--color-diet)', borderRadius: 'var(--radius-sm)' }}></div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Energy Balance — intake vs burn. The whole point of logging both. */}
      <div className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Flame size={18} color="var(--color-sports)" /> 热量收支
          </span>
          {hasBodyProfile && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoCalorieTarget}
                onChange={(e) => setAutoCalorieTarget(e.target.checked)}
                style={{ accentColor: 'var(--color-diet)' }}
              />
              自动算额度
            </label>
          )}
        </div>

        {!hasBodyProfile ? (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            还算不出你的基础代谢 —— 需要体重、身高、年龄、性别四项。到{' '}
            <strong style={{ color: 'var(--color-sports)' }}>健身</strong> 页填一次就好，之后这里会自动算出你每天该吃多少、
            练完又能多吃多少。在那之前上面的目标值仍然是你手动输入的。
          </p>
        ) : (
          <>
            {/* In / out / net */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', textAlign: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--color-diet)' }}>{balance.intake}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>摄入</div>
              </div>
              <div style={{ fontSize: '1.05rem', color: 'var(--text-muted)', alignSelf: 'center' }}>−</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--color-sports)' }}>{balance.burn}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>消耗</div>
              </div>
              <div style={{ fontSize: '1.05rem', color: 'var(--text-muted)', alignSelf: 'center' }}>=</div>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '1.05rem', fontWeight: '800',
                  color: balance.net > 0 ? 'var(--color-accent-red)' : 'var(--color-money)'
                }}>
                  {balance.net > 0 ? `+${balance.net}` : balance.net}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                  {balance.net > 0 ? '盈余' : '赤字'}
                </div>
              </div>
            </div>

            {/* Where the burn number comes from — never a black box */}
            <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '8px', lineHeight: '1.5' }}>
              消耗 = 基础代谢 {bmr} × {ACTIVITY_LEVELS[activityLevel]?.label ?? ''}{' '}
              {(ACTIVITY_LEVELS[activityLevel]?.factor ?? 1.2).toFixed(2)}
              {workoutCalories > 0 && <> ＋ 今日训练 {workoutCalories}</>}
            </p>

            {/* Activity level */}
            <div style={{ marginTop: '0.85rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>
                日常活动量（不含健身，训练消耗另外加）
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {Object.entries(ACTIVITY_LEVELS).map(([key, { label, hint }]) => (
                  <button
                    key={key}
                    onClick={() => setActivityLevel(key)}
                    title={hint}
                    style={{
                      flex: 1,
                      padding: '7px 4px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.72rem',
                      fontWeight: activityLevel === key ? '700' : '400',
                      cursor: 'pointer',
                      background: activityLevel === key ? 'var(--color-diet-soft)' : 'var(--bg-card)',
                      border: `1px solid ${activityLevel === key ? 'var(--color-diet)' : 'var(--border-glass)'}`,
                      color: activityLevel === key ? 'var(--color-diet)' : 'var(--text-secondary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Goal */}
            <div style={{ marginTop: '0.7rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '5px' }}>目标</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {Object.entries(DIET_GOALS).map(([key, { label }]) => (
                  <button
                    key={key}
                    onClick={() => setDietGoal(key)}
                    style={{
                      flex: 1,
                      padding: '7px 4px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.72rem',
                      fontWeight: dietGoal === key ? '700' : '400',
                      cursor: 'pointer',
                      background: dietGoal === key ? 'var(--color-diet-soft)' : 'var(--bg-card)',
                      border: `1px solid ${dietGoal === key ? 'var(--color-diet)' : 'var(--border-glass)'}`,
                      color: dietGoal === key ? 'var(--color-diet)' : 'var(--text-secondary)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px' }}>
                {DIET_GOALS[dietGoal]?.hint}
              </p>
            </div>

            {/* Suggested target — only offered when it differs from what's set */}
            {suggestedTarget != null && !autoCalorieTarget && suggestedTarget !== calorieLimit && (
              <div style={{
                marginTop: '0.85rem', padding: '0.7rem 0.85rem',
                background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-md)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px'
              }}>
                <div>
                  <div style={{ fontSize: '0.78rem', fontWeight: '600' }}>建议目标 {suggestedTarget} kcal</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    现在设的是 {calorieLimit} kcal
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCalorieLimit(suggestedTarget);
                    if (suggestedMacros) setMacroTargets(suggestedMacros);
                  }}
                  style={{
                    background: 'var(--color-diet)', color: 'var(--color-diet-ink)',
                    border: 'none', padding: '7px 12px', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap'
                  }}
                >
                  套用
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Today's Meals Section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '700' }}>Today's Food Log</h3>
        <button
          onClick={handleOpenAddModal}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-glass)',
            color: 'var(--text-primary)',
            padding: '6px 12px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.75rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={14} /> Manual Log
        </button>
      </div>

      {/* Meals List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {meals.length === 0 ? (
          <div className="glass-card" style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-secondary)' }}>
            <p style={{ fontSize: '0.85rem' }}>No meals logged today yet.</p>
            <button
              onClick={() => setShowPasteModal(true)}
              className="btn-primary"
              style={{ margin: '1rem auto 0 auto', fontSize: '0.8rem' }}
            >
              <ClipboardPaste size={16} /> 问 AI · 贴结果
            </button>
          </div>
        ) : (
          meals.map((meal) => (
            <div
              key={meal.id}
              className="glass-card"
              onClick={() => handleOpenEditModal(meal)}
              style={{ padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px', height: '38px', borderRadius: 'var(--radius-sm)',
                  background: meal.aiDetected ? 'var(--color-diet-soft)' : 'var(--bg-card-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: meal.aiDetected ? 'var(--color-diet)' : 'var(--text-secondary)'
                }}>
                  {meal.aiDetected ? <Sparkles size={18} /> : <Utensils size={18} />}
                </div>
                <div>
                  <h4 style={{ fontSize: '0.88rem', fontWeight: '600' }}>{meal.name}</h4>
                  <div style={{ display: 'flex', gap: '8px', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    <span>{meal.category}</span>
                    <span>•</span>
                    <span>{meal.time}</span>
                    {/* 'ai' is the old in-app API call, 'paste' the outside chat.
                        Both are a model's guess, so both read the same here. */}
                    {['ai', 'paste'].includes(meal.source ?? (meal.aiDetected ? 'ai' : null)) && (
                      <span style={{ color: 'var(--color-diet)' }}>• AI 估算</span>
                    )}
                    {meal.source === 'local' && (
                      <span style={{ color: 'var(--color-money)' }}>• 资料库</span>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--color-diet)' }}>
                  {/* Coerced: a meal missing its number rendered a bare "+ kcal". */}
                  +{num(meal.calories)} <span style={{ fontSize: '0.68rem', fontWeight: '400' }}>kcal</span>
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteMeal(meal.id); }}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 问外面的 AI，把结果贴回来.
          This replaced a real vision API call. The app no longer pays anyone:
          the estimate is done by whichever free chat app is already on the
          phone, and all this screen does is hand over the right prompt and
          read the reply back. See foodPaste.js. */}
      {showPasteModal && (
        <div className="modal-overlay" onClick={() => setShowPasteModal(false)}>
          <div
            className="modal-content"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: '88vh', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ClipboardPaste size={20} color="var(--color-diet)" /> 问 AI · 贴结果
              </h3>
              <button
                onClick={() => setShowPasteModal(false)}
                style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}
              >✕</button>
            </div>

            <ol style={{
              fontSize: '0.76rem', color: 'var(--text-secondary)', lineHeight: '1.6',
              paddingLeft: '1.1rem', margin: '0 0 0.9rem 0', display: 'flex',
              flexDirection: 'column', gap: '3px'
            }}>
              <li>点下面「复制提示词」</li>
              <li>打开任何免费的 AI 聊天（ChatGPT、Gemini、DeepSeek 都行），把提示词<strong>连食物照片一起</strong>发过去</li>
              <li>它回一个表格 → 全选复制 → 贴到下面，点「读取」</li>
            </ol>

            <button
              type="button"
              onClick={handleCopyPrompt}
              style={{
                width: '100%', padding: '10px', border: 'none',
                borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: promptCopied ? 'var(--color-money)' : 'var(--color-diet)',
                color: promptCopied ? 'var(--color-money-ink, #000)' : 'var(--color-diet-ink)',
                fontSize: '0.85rem', fontWeight: '700',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              }}
            >
              <Copy size={15} /> {promptCopied ? '已复制 — 去 AI 那边贴上' : '复制提示词'}
            </button>

            {/* Kept on screen rather than hidden behind the button: when the
                clipboard is refused (it can be, in a WebView) this is the only
                way to get the text out, and it also lets him see what he is
                about to send before sending it. */}
            <pre
              id="food-prompt-text"
              style={{
                marginTop: '8px', maxHeight: '110px', overflowY: 'auto',
                background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                fontSize: '0.62rem', lineHeight: '1.5', color: 'var(--text-muted)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text',
              }}
            >{AI_FOOD_PROMPT}</pre>

            <div style={{ marginTop: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                把 AI 的回答贴在这里
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => { setPasteText(e.target.value); setPasteError(''); }}
                rows={6}
                placeholder={'白饭 | 一碗 | 200 | 4 | 45 | 0\n炸鸡 | 一块 | 250 | 20 | 8 | 16'}
                style={{
                  width: '100%', padding: '10px 12px', marginTop: '4px',
                  borderRadius: 'var(--radius-sm)', background: 'var(--bg-input)',
                  border: '1px solid var(--border-glass)', color: 'white',
                  fontSize: '0.8rem', lineHeight: '1.5', resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {pasteError && (
              <p style={{ fontSize: '0.72rem', color: 'var(--color-accent-red)', marginTop: '6px', lineHeight: '1.5' }}>
                {pasteError}
              </p>
            )}

            <button
              type="button"
              onClick={handleParsePaste}
              disabled={!pasteText.trim()}
              style={{
                width: '100%', marginTop: '10px', padding: '11px', border: 'none',
                borderRadius: 'var(--radius-sm)', background: 'var(--accent)',
                color: 'var(--accent-ink, #000)', fontSize: '0.88rem', fontWeight: '700',
                cursor: pasteText.trim() ? 'pointer' : 'default',
                opacity: pasteText.trim() ? 1 : 0.45,
              }}
            >
              读取 → 填进表单
            </button>

            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.9rem', lineHeight: '1.5' }}>
              读出来的每一项还可以改分量、删掉、补漏 —— 杂菜饭这种一盘好几道菜的，
              改比重问一次准得多。常见的马来西亚食物<strong>本地资料库里就有</strong>，
              直接用 Manual Log 打名字，连出去问都不用。
            </p>
          </div>
        </div>
      )}

      {/* Manual Add / Edit Meal Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '1rem' }}>{editingMealId ? 'Edit Meal' : 'Manual Meal Entry'}</h3>
            <form onSubmit={handleManualAdd} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>食物名称</label>
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <input
                    type="text"
                    placeholder="例：nasi lemak、2 roti canai、鸡胸肉"
                    value={customFoodName}
                    onChange={(e) => {
                      setCustomFoodName(e.target.value);
                      // Typing invalidates whatever estimate filled the fields.
                      setEstimateSource(null);
                      setEstimateNote('');
                      setEstimateError('');
                    }}
                    onKeyDown={(e) => {
                      // Enter looks the food up instead of submitting a half-filled form.
                      if (e.key === 'Enter' && !customCalories) {
                        e.preventDefault();
                        handleEstimateFromText();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-input)',
                      border: '1px solid var(--border-glass)',
                      color: 'white',
                    }}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleEstimateFromText()}
                    disabled={!customFoodName.trim() || estimating}
                    title="查本地资料库（免费、离线）"
                    style={{
                      background: 'var(--color-diet)', color: 'var(--color-diet-ink)',
                      border: 'none', padding: '0 14px', borderRadius: 'var(--radius-sm)',
                      fontSize: '0.78rem', fontWeight: '700', whiteSpace: 'nowrap',
                      cursor: (!customFoodName.trim() || estimating) ? 'default' : 'pointer',
                      opacity: (!customFoodName.trim() || estimating) ? 0.45 : 1,
                    }}
                  >
                    {estimating ? '查询中…' : '查热量'}
                  </button>
                </div>

                {/* Free offline suggestions while typing */}
                {nameSuggestions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '6px' }}>
                    {nameSuggestions.map((s) => (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() => applyEstimate({ ...lookupFood(s.name), source: 'local' })}
                        style={{
                          background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                          color: 'var(--text-secondary)', padding: '4px 9px',
                          borderRadius: 'var(--radius-sm)', fontSize: '0.7rem', cursor: 'pointer'
                        }}
                      >
                        {s.name} · {s.kcal}
                      </button>
                    ))}
                  </div>
                )}

                {/* Where the filled-in numbers came from */}
                {estimateSource && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: '8px', marginTop: '7px', flexWrap: 'wrap'
                  }}>
                    <span style={{
                      fontSize: '0.68rem', padding: '3px 8px', borderRadius: 'var(--radius-sm)',
                      background: estimateSource === 'local' ? 'var(--color-money-soft, var(--bg-card))' : 'var(--color-diet-soft)',
                      color: estimateSource === 'local' ? 'var(--color-money)' : 'var(--color-diet)',
                      border: `1px solid ${estimateSource === 'local' ? 'var(--color-money)' : 'var(--color-diet)'}`,
                    }}>
                      {estimateSource === 'local' ? '本地资料库 · 免费' : 'AI 估算 · 请核对'}
                      {estimateNote ? ` · ${estimateNote}` : ''}
                    </span>
                    {estimateSource === 'local' && (
                      <button
                        type="button"
                        onClick={() => { setPasteError(''); setShowPasteModal(true); }}
                        style={{
                          background: 'none', border: 'none', color: 'var(--text-muted)',
                          fontSize: '0.68rem', textDecoration: 'underline', cursor: 'pointer'
                        }}
                      >
                        分量不一样？问 AI
                      </button>
                    )}
                  </div>
                )}

                {estimateError && (
                  <p style={{ fontSize: '0.7rem', color: 'var(--color-accent-red)', marginTop: '6px' }}>
                    {estimateError}
                  </p>
                )}
              </div>

              {/* Component breakdown — the correction surface for mixed plates */}
              {items.length > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px' }}>
                    <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      分项明细（{items.length} 项）
                    </label>
                    {confidence && (
                      <span style={{
                        fontSize: '0.66rem', padding: '2px 7px', borderRadius: 'var(--radius-sm)',
                        color: confidence === 'low' ? 'var(--color-accent-red)' : 'var(--text-muted)',
                        border: `1px solid ${confidence === 'low' ? 'var(--color-accent-red)' : 'var(--border-glass)'}`,
                      }}>
                        {confidence === 'low' ? '把握低 · 请核对分量' : confidence === 'medium' ? '把握中等' : '把握较高'}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px' }}>
                    {items.map((it) => (
                      <div
                        key={it.id}
                        style={{
                          background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                          borderRadius: 'var(--radius-sm)', padding: '8px 10px',
                          display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ flex: 1, minWidth: '110px' }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: '600' }}>{it.name}</div>
                          <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                            {it.portion ? `${it.portion} · ` : ''}{it.kcal} kcal · P{it.p} C{it.c} F{it.f}
                          </div>
                        </div>

                        {/* Portion correction: the fastest fix for a misread serving */}
                        <div style={{ display: 'flex', gap: '3px' }}>
                          {[['½', 0.5], ['×2', 2]].map(([label, factor]) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() => handleScaleItem(it.id, factor)}
                              title="调整这一项的分量"
                              style={{
                                background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                                color: 'var(--text-secondary)', borderRadius: 'var(--radius-sm)',
                                fontSize: '0.7rem', padding: '3px 7px', cursor: 'pointer'
                              }}
                            >
                              {label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(it.id)}
                            title="这项认错了，删掉"
                            style={{
                              background: 'none', border: '1px solid var(--border-glass)',
                              color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
                              padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center'
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add what the model missed, priced from the free table */}
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                    <input
                      type="text"
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(); } }}
                      placeholder="漏了什么？例：鸡蛋、白饭"
                      style={{
                        flex: 1, padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                        background: 'var(--bg-input)', border: '1px solid var(--border-glass)',
                        color: 'white', fontSize: '0.75rem'
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddItem}
                      disabled={!newItemName.trim()}
                      style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border-glass)',
                        color: 'var(--text-primary)', padding: '0 12px',
                        borderRadius: 'var(--radius-sm)', fontSize: '0.75rem',
                        cursor: newItemName.trim() ? 'pointer' : 'default',
                        opacity: newItemName.trim() ? 1 : 0.45
                      }}
                    >
                      加一项
                    </button>
                  </div>

                  <p style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: '1.5' }}>
                    杂菜饭这类多菜的盘子，AI 只能认个大概 —— 改分量、删错项比重问一次准得多。
                    下面的总数会跟着这里自动更新。
                  </p>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Calories (kcal)</label>
                <input
                  type="number"
                  placeholder="e.g. 450"
                  value={customCalories}
                  onChange={(e) => setCustomCalories(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-glass)',
                    color: 'white',
                    marginTop: '4px'
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Macros (g) — optional</label>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  {[
                    { label: 'Protein', value: customProtein, set: setCustomProtein },
                    { label: 'Carbs', value: customCarbs, set: setCustomCarbs },
                    { label: 'Fat', value: customFat, set: setCustomFat },
                  ].map(({ label, value, set }) => (
                    <div key={label} style={{ flex: 1 }}>
                      <input
                        type="number"
                        placeholder={label}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-input)',
                          border: '1px solid var(--border-glass)',
                          color: 'white',
                          fontSize: '0.82rem'
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Category</label>
                <select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-glass)',
                    color: 'white',
                    marginTop: '4px'
                  }}
                >
                  <option value="Breakfast">Breakfast</option>
                  <option value="Lunch">Lunch</option>
                  <option value="Dinner">Dinner</option>
                  <option value="Snacks">Snacks</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
                <button type="button" onClick={() => { setShowAddModal(false); resetMealForm(); }} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>{editingMealId ? 'Save Changes' : 'Save Meal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
