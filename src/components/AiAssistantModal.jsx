import React, { useMemo, useState } from 'react';
import { Sparkles, Send, Bot, X } from '../utils/icons';
import { isNativeAvailable } from '../utils/tngNative';
import { useBackDismiss } from '../hooks/useBackDismiss';
import { usePersistentState, useLiveJSON, getTodayString } from '../utils/storage';
import { newId, sumBy } from '../utils/num';
import { isAiConfigured, askAiCoach } from '../utils/aiCoach';
import { calcBMR, calcEnergyBalance, DEFAULT_ACTIVITY } from '../utils/calories';
import { getWeek, computeWeekComparison } from '../utils/weekStats';

// Every message carries an `id`, because `chats` is a synced RECORD_COLLECTION
// (see syncModel.js and SCHEMA.md, which specifies `chats/{id}`).
//
// It didn't, and that meant the collection silently never synced at all:
// `diffCollection` filters out any record with `id == null`, so the diff was
// permanently empty. No error, no warning — the schema said conversations
// follow you between phone and PC, and they simply didn't. A fixed id on the
// greeting so both devices agree it is the same message rather than each
// uploading their own copy.
const GREETING_ID = 'greeting';

const AI_GREETING = {
  id: GREETING_ID,
  sender: 'ai',
  text: "我能看到你今天记录的每一样食物、每一组训练和每一笔消费，也看得到这一周的总结（平均热量、蛋白、训练天数、体重变化、花费）—— 问我「我今天吃了什么」「这周过得怎么样」「蛋白够不够」都可以。",
};

const SCRIPTED_GREETING = {
  id: GREETING_ID,
  sender: 'ai',
  text: "Heads up: I'm not a real AI yet — I match keywords in your message against a handful of scripted replies, using your actual logged data. Ask about food, gym, or spending and I'll do my best.",
};

const GREETING = isAiConfigured() ? AI_GREETING : SCRIPTED_GREETING;

// Chat is unbounded, and old messages have little value. Capped so it can't
// grow forever in storage or in a sync payload. See SCHEMA.md.
const MAX_MESSAGES = 200;

export default function AiAssistantModal({ onClose, meals, calorieLimit, macroTargets, workouts, expenses, dailyBudget }) {
  // Android back closes the modal instead of navigating the page behind it.
  // It used to do the latter: the route changed UNDERNEATH this, leaving the
  // conversation sitting on top of a screen you didn't ask for. See
  // hooks/useBackDismiss.js.
  useBackDismiss(true, onClose);

  // Answers about auto-detect differ by platform, and claiming it works in a
  // browser was one of the false statements this bot used to make.
  const nativeCapture = isNativeAvailable();
  // Persisted — this used to be plain useState, so the whole conversation was
  // thrown away the moment the modal closed.
  const [messages, setMessages] = usePersistentState('chats', [GREETING]);
  const [inputText, setInputText] = useState('');
  const [thinking, setThinking] = useState(false);

  // Same read-only route DietModule uses for the body profile SportsModule owns,
  // so the coach can talk about the deficit/surplus the diet tab shows.
  const activityLevel = useLiveJSON('activityLevel', DEFAULT_ACTIVITY);
  const bodyWeightKg = useLiveJSON('bodyWeightKg', null);
  const heightCm = useLiveJSON('heightCm', null);
  const ageYears = useLiveJSON('ageYears', null);
  const sex = useLiveJSON('sex', null);

  // --- 本周 ----------------------------------------------------------------
  //
  // The coach was handed TODAY and nothing else, which made it unable to answer
  // the questions a food and training log actually exists for — "am I eating
  // enough protein", "am I training enough" — because neither means anything
  // over one day.
  //
  // Read here through the same read-only route as the body profile above, and
  // summarised BEFORE the call: the model is given finished numbers to
  // interpret, never raw records to add up. See describeWeek in aiCoach.js.
  const allMeals = useLiveJSON('meals', []);
  const allWorkouts = useLiveJSON('workouts', []);
  const allExpenses = useLiveJSON('expenses', []);
  const weightLog = useLiveJSON('weightLog', []);
  const todayStr = getTodayString();
  const week = useMemo(() => computeWeekComparison({
    meals: allMeals, workouts: allWorkouts, expenses: allExpenses, weightLog,
    week: getWeek(), todayStr,
  }), [allMeals, allWorkouts, allExpenses, weightLog, todayStr]);

  const balance = calcEnergyBalance({
    bmr: calcBMR({ weightKg: bodyWeightKg, heightCm, age: ageYears, sex }),
    activityLevel,
    intake: sumBy(meals, m => m.calories),
    workoutCalories: sumBy(workouts, w => w.calories),
  });

  const quickPrompts = [
    "我今天吃了什么？蛋白够了吗？",
    "剩下的热量晚餐该怎么吃？",
    "今天各个户口花了多少?",
    // The week is the new thing the coach can actually answer about — a prompt
    // for it, since nobody discovers a capability that is never offered.
    "这周我过得怎么样？"
  ];

  const generateScriptedReply = (query) => {
    let aiReply = "I have analyzed your LifeManager data! Everything looks on track.";

    const lower = query.toLowerCase();
    if (lower.includes("eat") || lower.includes("dinner") || lower.includes("food")) {
      const totalCalories = sumBy(meals, m => m.calories);
      const rem = calorieLimit - totalCalories;
      if (rem > 0) {
        aiReply = `You have ${rem} kcal remaining today! I recommend a high-protein dinner like Grilled Salmon with Asparagus (380 kcal, 42g protein) or Chicken Breast Salad with olive oil dressing.`;
      } else {
        aiReply = `You are ${Math.abs(rem)} kcal over your target limit! Try a very light soup or green salad with lemon dressing, and stay hydrated with water.`;
      }
    } else if (lower.includes("gym") || lower.includes("workout") || lower.includes("exercise")) {
      if (workouts.length === 0) {
        aiReply = `You haven't logged any sets yet today. Head to the Sports tab and log your first set — I'll auto-start a rest timer for you.`;
      } else {
        const lastSet = workouts[0];
        aiReply = `Nice work — ${workouts.length} sets logged today, last one was ${lastSet.exercise} at ${lastSet.weightKg}kg x ${lastSet.reps} reps. For optimal hypertrophy, take a 90-second rest interval between sets. Stay hydrated!`;
      }
    } else if (lower.includes("tng") || lower.includes("spend") || lower.includes("money")) {
      const totalExp = sumBy(expenses, e => e.amount);
      const left = Number(dailyBudget || 0) - totalExp;
      aiReply = `You have spent RM ${totalExp.toFixed(2)} out of your RM ${Number(dailyBudget || 0).toFixed(2)} daily budget`
        + (left >= 0 ? `, so RM ${left.toFixed(2)} left.` : `, which is RM ${Math.abs(left).toFixed(2)} over.`)
        + (nativeCapture
          ? ` Auto-detect is running, so TNG payments are logged as their notifications arrive.`
          : ` In the browser nothing is captured automatically — paste a notification into the reader in the Money tab, or add the expense by hand.`);
    } else if (lower.includes("apk") || lower.includes("phone") || lower.includes("android")) {
      aiReply = `The Android app is what makes auto-detect possible: a web page can't read notifications, so the APK ships a NotificationListenerService (Java, in android/app/src/main/java/com/lifemanager/app/). Build it with \`npm run build && npx cap sync android\`, then open the android folder in Android Studio. After installing you have to switch on notification access yourself under Settings → Notifications → Notification access — Android doesn't let an app grant that to itself.`;
    }

    return aiReply;
  };

  const handleSend = async (textToSend) => {
    const query = textToSend || inputText;
    if (!query.trim()) return;

    // `stamp` backfills messages written by an older build, which have no id and
    // would otherwise stay unsyncable forever.
    const stamp = (m) => (m.id != null ? m : { ...m, id: newId(), at: m.at ?? Date.now() });
    const newMsgs = [
      ...messages.map(stamp),
      { id: newId(), sender: 'user', text: query, at: Date.now() },
    ].slice(-MAX_MESSAGES);
    setMessages(newMsgs);
    setInputText('');
    setThinking(true);

    let aiReply;
    if (isAiConfigured()) {
      try {
        aiReply = await askAiCoach(newMsgs, {
          meals, calorieLimit, macroTargets, workouts, expenses, dailyBudget, balance, week,
        });
      } catch (err) {
        aiReply = `AI Coach request failed (${err.message}). Falling back to the scripted reply: ${generateScriptedReply(query)}`;
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      aiReply = generateScriptedReply(query);
    }

    setMessages((prev) => [...prev, { id: newId(), sender: 'ai', text: aiReply, at: Date.now() }].slice(-MAX_MESSAGES));
    setThinking(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ height: '80vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'var(--accent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-ink)'
            }}>
              <Sparkles size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                LifeManager AI Coach
                {!isAiConfigured() && <span className="demo-badge">Demo</span>}
              </h3>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {isAiConfigured() ? '看得到你今天和这周的记录 · Gemini' : 'Scripted replies — not a real AI'}
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        {/* Message History */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{
              display: 'flex',
              justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              gap: '8px'
            }}>
              {msg.sender === 'ai' && (
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flexShrink: 0 }}>
                  <Bot size={16} />
                </div>
              )}
              <div style={{
                maxWidth: '80%',
                padding: '10px 14px',
                borderRadius: 'var(--radius-lg)',
                fontSize: '0.82rem',
                lineHeight: '1.4',
                background: msg.sender === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                color: msg.sender === 'user' ? 'var(--accent-ink)' : 'white',
                fontWeight: msg.sender === 'user' ? '600' : '400',
                border: msg.sender === 'ai' ? '1px solid var(--border-glass)' : 'none'
              }}>
                {msg.text}
              </div>
            </div>
          ))}

          {thinking && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                <Bot size={16} />
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--accent)' }}>Thinking...</div>
            </div>
          )}
        </div>

        {/* Quick Prompts */}
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '10px' }}>
          {quickPrompts.map((p, idx) => (
            <button
              key={idx}
              onClick={() => handleSend(p)}
              style={{
                whiteSpace: 'nowrap',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-glass)',
                color: 'var(--text-secondary)',
                padding: '6px 10px',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.72rem',
                cursor: 'pointer'
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div style={{ display: 'flex', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-glass)' }}>
          <input 
            type="text"
            placeholder="Ask AI anything about your diet, gym, or money..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--bg-input)',
              border: '1px solid var(--border-glass)',
              color: 'white',
              fontSize: '0.82rem'
            }}
          />
          <button
            onClick={() => handleSend()}
            style={{
              width: '40px', height: '40px', borderRadius: '50%',
              background: 'var(--accent)',
              border: 'none', color: 'var(--accent-ink)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer'
            }}
          >
            <Send size={18} />
          </button>
        </div>

      </div>
    </div>
  );
}
