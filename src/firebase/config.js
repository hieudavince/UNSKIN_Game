import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { getFunctions } from 'firebase/functions';

// Fill in from your Firebase console (Project Settings > General)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL, // needed for Realtime DB
};

export const app = initializeApp(firebaseConfig);
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// NOTE on Steam auth: Firebase Auth has no built-in Steam provider.
// Standard pattern: run a small backend (Cloud Function/HTTP endpoint) that
// completes Steam OpenID login, verifies it server-side, then mints a
// Firebase custom token (admin.auth().createCustomToken(steamId)) which the
// client signs in with via signInWithCustomToken(auth, token).
