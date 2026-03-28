import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'ikamba-1c669.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ikamba-1c669',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'ikamba-1c669.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Shared with Blink-1 — same Firebase project (ikamba-1c669)
export const COLLECTIONS = {
  USERS: 'users',              // shared with Blink-1, same user records
  ORDERS: 'vpn_orders',
  PAYMENT_ACCOUNTS: 'vpn_payment_accounts',
  PLANS: 'vpn_plans',
  TRIALS: 'vpn_trials',
} as const;

/**
 * Base URL for Blink-1 Cloud Functions API.
 * Used for OTP-based password reset (same endpoints shared via same project).
 */
export function fnApiBase(): string {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ikamba-1c669';
  return `https://us-central1-${projectId}.cloudfunctions.net/api`;
}
