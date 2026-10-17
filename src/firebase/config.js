import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getDatabase, onValue, ref } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { publicConfig } from './publicConfig';

const env = import.meta.env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || publicConfig.apiKey,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || publicConfig.authDomain,
  projectId: env.VITE_FIREBASE_PROJECT_ID || publicConfig.projectId,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || publicConfig.storageBucket,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || publicConfig.messagingSenderId,
  appId: env.VITE_FIREBASE_APP_ID || publicConfig.appId,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL || publicConfig.databaseURL,
};

export const firebaseReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
export const app = firebaseReady ? (getApps()[0] || initializeApp(firebaseConfig)) : null;
export const firestore = app ? getFirestore(app) : null;
export const rtdb = app && firebaseConfig.databaseURL ? getDatabase(app) : null;
export const auth = app ? getAuth(app) : null;

let serverOffset = 0;
if (rtdb) {
  onValue(ref(rtdb, '.info/serverTimeOffset'), (snap) => {
    serverOffset = Number(snap.val()) || 0;
  });
}

// Server-aligned clock so every client agrees on phase timers.
export function serverNow() {
  return Date.now() + serverOffset;
}
