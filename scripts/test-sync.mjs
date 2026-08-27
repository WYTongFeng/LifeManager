// Minimal localStorage so syncModel can run under Node.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
};
const M = await import('../src/utils/syncModel.js');
const { describeError } = await import('../src/utils/cloudSync.js');
const set = (k,v) => localStorage.setItem('lifemanager:'+k, JSON.stringify(v));
const get = k => JSON.parse(localStorage.getItem('lifemanager:'+k));
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`${ok?'PASS':'FAIL'}  ${name}`);
  if (!ok) console.log(`      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
};

// --- first push: everything is new ---
set('workouts', [{id:1,at:100,exercise:'Bench'},{id:2,at:200,exercise:'Squat'}]);
let d = M.diffCollection('workouts', 0);
check('first push sends both', d.upserts.map(r=>r.id), [1,2]);
check('first push deletes nothing', d.deletes, []);
M.setSyncedIds('workouts', d.allIds);

// --- nothing changed: incremental push sends nothing (the free-tier guard) ---
d = M.diffCollection('workouts', 300);
check('unchanged sends nothing', d.upserts.map(r=>r.id), []);

// --- edit one record ---
set('workouts', [{id:1,at:100,exercise:'Bench'},{id:2,at:999,exercise:'Squat',reps:5}]);
d = M.diffCollection('workouts', 300);
check('only the edited record is sent', d.upserts.map(r=>r.id), [2]);

// --- a REAL edit: `at` is the event time and never moves, `updatedAt` does ----
// The case above hand-bumps `at`, which no edit path in the app has ever done.
// This is the shape an actual edit produces, and it used to be pushed never.
set('workouts', [
  {id:1,at:100,exercise:'Bench'},
  {id:2,at:200,exercise:'Squat',reps:5,updatedAt:999},
]);
d = M.diffCollection('workouts', 300);
check('an edit with an untouched `at` is still sent', d.upserts.map(r=>r.id), [2]);
check('and the event time is left alone', d.upserts[0].at, 200);

set('workouts', [{id:1,at:100,exercise:'Bench'},{id:2,at:200,exercise:'Squat',updatedAt:250}]);
d = M.diffCollection('workouts', 300);
check('an edit older than the last push is not re-sent', d.upserts.map(r=>r.id), []);

// A remote edit must beat the local copy even though both share the same `at`.
// On `meals`, deliberately: the `workouts` tests below carry running state
// (synced ids) that this must not disturb.
set('meals', [{id:9,at:500,name:'local'}]);
M.mergeRemoteRecords('meals', [{id:9,at:500,name:'remote edit',updatedAt:900}]);
check('a remote edit wins on updatedAt, not on the shared `at`',
  get('meals')[0].name, 'remote edit');

M.mergeRemoteRecords('meals', [{id:9,at:500,name:'stale remote',updatedAt:400}]);
check('but a stale remote edit still loses', get('meals')[0].name, 'remote edit');

// --- delete one locally -> becomes an explicit delete ---
set('workouts', [{id:1,at:100,exercise:'Bench'}]);
d = M.diffCollection('workouts', 300);
check('local delete becomes a tombstone', d.deletes, [2]);
M.setSyncedIds('workouts', d.allIds);

// --- merge remote: new record, an update, and a tombstone ---
set('workouts', [{id:1,at:100,exercise:'Bench'}]);
M.mergeRemoteRecords('workouts', [
  {id:3,at:500,exercise:'Deadlift'},
  {id:1,at:700,exercise:'Bench',reps:12},
]);
check('remote add + update merged', get('workouts').map(r=>[r.id,r.reps??null]), [[3,null],[1,12]]);
M.mergeRemoteRecords('workouts', [{id:3,deleted:true,at:900}]);
check('remote tombstone removes it', get('workouts').map(r=>r.id), [1]);

// --- older remote must not overwrite newer local ---
set('workouts', [{id:1,at:1000,exercise:'NEWER LOCAL'}]);
M.mergeRemoteRecords('workouts', [{id:1,at:500,exercise:'older remote'}]);
check('older remote does not clobber newer local', get('workouts')[0].exercise, 'NEWER LOCAL');

// --- meta doc fingerprinting ---
set('dailyBudget', 80); set('calorieLimit', 2100);
const f1 = M.fingerprint(M.readMetaDoc('settings'));
const f2 = M.fingerprint(M.readMetaDoc('settings'));
check('fingerprint stable when unchanged', f1 === f2, true);
set('dailyBudget', 90);
check('fingerprint changes when edited', M.fingerprint(M.readMetaDoc('settings')) !== f1, true);

// --- module 1/2 keys are actually registered for sync now -------------------
// Regression guard for the exact gap the user caught: incomeSources/
// allocations (M16) and pendingRequests (M20) existed in localStorage for
// several milestones without ever being added to META_DOCS, so a second
// signed-in device would silently never receive them.
check('payday router keys are in META_DOCS', M.META_DOCS.payday, ['incomeSources', 'allocations']);
check('impulse sandbox key is in META_DOCS', M.META_DOCS.impulse, ['pendingRequests']);

set('incomeSources', [{ id: 1, label: 'Internship', amount: 1000, kind: 'income' }]);
set('allocations', [{ id: 2, label: 'Rent', amount: 500 }]);
check('payday meta doc round-trips both keys',
  M.readMetaDoc('payday'),
  { incomeSources: [{ id: 1, label: 'Internship', amount: 1000, kind: 'income' }], allocations: [{ id: 2, label: 'Rent', amount: 500 }] });

set('pendingRequests', [{ id: 3, label: 'Razer 键盘', amount: 150, createdAt: 12345 }]);
check('impulse meta doc round-trips',
  M.readMetaDoc('impulse'),
  { pendingRequests: [{ id: 3, label: 'Razer 键盘', amount: 150, createdAt: 12345 }] });

// A remote payday doc applies back onto local storage the same way settings does.
M.writeMetaDoc('payday', { incomeSources: [{ id: 9, label: 'From another device', amount: 500, kind: 'income' }], allocations: [] });
check('writeMetaDoc applies a remote payday doc locally',
  get('incomeSources'), [{ id: 9, label: 'From another device', amount: 500, kind: 'income' }]);

// --- the phone never saw the PC's data: four bugs, one symptom -------------
// Every check below stands for a way the two devices could report success and
// still never exchange anything. The first one is the fatal one.

// 1. THE TWO CLOCKS. The pull filtered remote documents on `at` — the EVENT
// time, always in the past — against a watermark that the PUSH also wrote. One
// push moved the watermark to "now", and every record from the other device
// then sorted as "older than the last sync" and was dropped by Firestore before
// it was ever downloaded. `syncedAt` is the upload time and is the only field a
// pull may filter on.
const { readFile } = await import('node:fs/promises');
// Comments stripped: the ones in cloudSync.js quote the old broken query on
// purpose, and a test that can't tell the explanation from the code would fail
// on the documentation of the very bug it guards.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = stripComments(await readFile('src/utils/cloudSync.js', 'utf8'));
check('the pull filters on the upload clock', /where\('syncedAt', '>'/.test(src), true);
check('and never on the event clock', /where\('at',/.test(src), false);
check('so the push has to stamp it on every document', /syncedAt: now/.test(src), true);
check('push and pull keep separate watermarks',
  /sync:lastPushedAt/.test(src) && /sync:lastPulledAt/.test(src), true);

// 2. THE FORCE FLAG THAT WASN'T. SyncPanel called `pushNow({ force: true })`
// for both 「立即上传」 and 「用这台覆盖」, against a `pushNow()` that declared no
// parameters — so the override silently did an ordinary incremental push, and
// pressing it when the device believed itself up to date uploaded nothing at
// all. If the panel passes options, the function must read them.
const panel = await readFile('src/components/SyncPanel.jsx', 'utf8');
for (const [fn, label] of [['pushNow', 'push'], ['pullNow', 'pull']]) {
  const passesOptions = new RegExp(`${fn}\\(\\{`).test(panel);
  const readsOptions = new RegExp(`function ${fn}\\(\\{`).test(src);
  check(`the ${label} button's options are actually read`, !passesOptions || readsOptions, true);
}

// 3. THE DOWNLOAD BUTTON THAT HID ITSELF. It only rendered inside the 「云端有
// 较新的资料」 banner — which the same watermark bug kept from ever appearing —
// leaving 「立即上传」 as the only button on screen. Upload can never bring the
// other device's data here, so it must not be the only thing pressable.
const handlers = [...panel.matchAll(/onClick=\{([^}]*)\}/g)].map(m => m[1]);
check('a pull is reachable without waiting for the banner',
  handlers.filter(h => h.includes('pullNow')).length >= 2, true);

// 4. META DOCUMENTS WERE REPLACED, NOT MERGED. `readMetaDoc` returns only the
// keys this device happens to have, and `set()` without merge replaces the
// whole document — so a phone that had never opened the accounts screen
// uploaded an empty `meta/accounts` and erased the PC's accounts from the
// cloud. The PC never re-sent them: its own fingerprint hadn't changed.
check('meta documents are merged, never replaced', /\{ merge: true \}/.test(src), true);
set('accounts', undefined);
store.delete('lifemanager:accounts');
check('a device with no accounts has nothing to send for that doc',
  Object.keys(M.readMetaDoc('accounts')).length, 0);

// The other half of the same rule, on the way down: a pull may only apply a
// meta document when this device has no unpushed edits of its own to lose.
store.delete('lifemanager:sync:fp:settings');
check('a device that never pushed settings takes the cloud copy',
  M.hasUnpushedMetaChanges('settings'), false);
set('sync:fp:settings', M.fingerprint(M.readMetaDoc('settings')));
check('...and still takes it when nothing has changed since its last push',
  M.hasUnpushedMetaChanges('settings'), false);
set('dailyBudget', 999);
check('...but keeps its own when there are edits the cloud has not got',
  M.hasUnpushedMetaChanges('settings'), true);

// A full re-pull of data this device already has must report "nothing changed"
// rather than reloading the page and claiming it loaded everything again.
set('meals', [{ id: 1, at: 100, name: 'Nasi Lemak', calories: 400 }]);
check('re-pulling identical records changes nothing',
  M.mergeRemoteRecords('meals', [{ calories: 400, name: 'Nasi Lemak', at: 100, id: 1 }]), 0);

// --- error messages: plain-language, not raw Firebase codes ----------------
// On the free Spark plan, hitting the daily quota must read as "safe, no
// charge, tries again tomorrow" — not a scary raw RESOURCE_EXHAUSTED string.
check('quota exceeded reads as reassuring, not a raw error code',
  /不会扣钱/.test(describeError({ code: 'resource-exhausted' })), true);
check('permission-denied points at the actual fix',
  /安全规则/.test(describeError({ code: 'permission-denied' })), true);
check('operation-not-allowed points at the sign-in-method toggle, not a raw code',
  /Sign-in method/.test(describeError({ code: 'auth/operation-not-allowed' })), true);

// Email/password sign-in. Firebase collapses "wrong password" and "no such
// account" into one `invalid-credential` on purpose (so an attacker can't
// enumerate which addresses exist), so the message must cover both — and in
// particular must point a first-time user at 注册, since "email or password is
// wrong" on an account that was never created is a dead end otherwise.
check('a bad credential tells a first-time user to register instead',
  /注册/.test(describeError({ code: 'auth/invalid-credential' })), true);
check('the legacy wrong-password code lands on the same message',
  describeError({ code: 'auth/wrong-password' }), describeError({ code: 'auth/invalid-credential' }));
check('the legacy user-not-found code lands on the same message',
  describeError({ code: 'auth/user-not-found' }), describeError({ code: 'auth/invalid-credential' }));
// The second device's most likely mistake: registering again instead of
// signing in. Firebase refuses, and the message has to say which to use —
// two accounts would mean two uids, which reads as "sync does nothing".
check('an already-registered email says to sign in, not register',
  /登入/.test(describeError({ code: 'auth/email-already-in-use' })), true);
// A Google-created account has no password, so "sign in instead" alone is a
// dead end — the reset link is the only way back to that uid (and therefore to
// any data already synced under it).
check('...and names the password reset, the only way into a Google-made account',
  /忘记密码/.test(describeError({ code: 'auth/email-already-in-use' })), true);
check('a weak password names the actual minimum',
  /6/.test(describeError({ code: 'auth/weak-password' })), true);
check('a malformed email is called out on its own',
  /格式/.test(describeError({ code: 'auth/invalid-email' })), true);
// Throttling clears by itself, so this must not read as a permanent lockout.
check('rate limiting reads as temporary',
  /等几分钟|暂时/.test(describeError({ code: 'auth/too-many-requests' })), true);

check('unconfigured is distinguishable from a real Firebase error',
  describeError({ message: 'NOT_CONFIGURED' }), '还没有设定 Firebase（见 .env.example）。');
check('unknown error falls back to its own message, not a blank string',
  describeError({ code: 'some-new-code', message: 'weird one' }), 'weird one');

console.log(`\n${fail===0 ? 'ALL PASS' : fail+' FAILED'}  (${pass} passed)`);

if (fail > 0) process.exit(1);
