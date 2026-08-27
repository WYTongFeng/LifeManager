// Firebase settings, read from Vite env vars at build time.
//
// Put the real values in `.env.local` (see `.env.example`). That file is
// gitignored via the `*.local` rule, so the keys stay out of the repo.
//
// These values are NOT secrets — Firebase web config is designed to ship in the
// client, and everyone who loads the page can read it. What actually protects
// your data is the Firestore security rules in `firestore.rules`, which allow a
// signed-in user to touch only their own document. Deploy those rules before
// putting anything real in the database.

import { ENV } from './env.js';

const cfg = {
  apiKey: ENV.VITE_FIREBASE_API_KEY,
  authDomain: ENV.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: ENV.VITE_FIREBASE_PROJECT_ID,
  storageBucket: ENV.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: ENV.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: ENV.VITE_FIREBASE_APP_ID,
};

/** True only when every required field is present, so a half-filled .env.local
 *  disables sync cleanly instead of failing at runtime with a cryptic error. */
export function isFirebaseConfigured() {
  return Boolean(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId);
}

export function getFirebaseConfig() {
  return cfg;
}
