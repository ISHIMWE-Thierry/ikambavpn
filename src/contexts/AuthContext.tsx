import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import {
  onAuthStateChanged,
  User as FirebaseUser,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getUser, createUser, updateUserLogin } from '../lib/db-service';
import type { UserProfile } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** If Firebase auth doesn't respond within this time, show the app anyway. */
const AUTH_TIMEOUT_MS = 4_000;

/** localStorage keys for instant profile cache */
const PROFILE_CACHE_KEY = 'ikamba_vpn_profile';

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  avatarDataUrl: string | null;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  profile: null,
  loading: true,
  avatarDataUrl: null,
  signOut: async () => {},
  refreshProfile: async () => {},
});

// ── Avatar helpers ────────────────────────────────────────────────────────────

function avatarCacheKey(uid: string) { return `ikamba_avatar_${uid}`; }

function cacheAndReturnAvatar(uid: string, url: string): string {
  try { localStorage.setItem(avatarCacheKey(uid), url); } catch { /* storage full */ }
  return url;
}

function fetchAndCacheAvatar(uid: string, url: string): string {
  const cached = localStorage.getItem(avatarCacheKey(uid));
  if (cached) return cached;
  return cacheAndReturnAvatar(uid, url);
}

// ── Profile cache helpers ─────────────────────────────────────────────────────

function cacheProfile(prof: UserProfile): void {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(prof)); } catch { /* full */ }
}

function loadCachedProfile(uid: string): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const prof = JSON.parse(raw) as UserProfile;
    // Only use cache if it matches the current user
    return prof.id === uid ? prof : null;
  } catch {
    return null;
  }
}

function clearProfileCache(): void {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch { /* ignore */ }
}

// ── Sync logic ────────────────────────────────────────────────────────────────

/**
 * Sync a Firebase user to a Firestore profile document.
 * Creates the document on first sign-in, updates last_login for returning users.
 * `updateUserLogin` is fire-and-forget so it never blocks loading.
 */
async function syncProfile(user: FirebaseUser): Promise<UserProfile | null> {
  try {
    let prof = await getUser(user.uid);

    if (!prof) {
      // First sign-in — create user doc
      const displayName = user.displayName || '';
      const parts = displayName.trim().split(/\s+/);
      await createUser(user.uid, {
        email: user.email || '',
        firstname: parts[0] || '',
        lastname: parts.slice(1).join(' ') || '',
        tel: user.phoneNumber || '',
        avatarUrl: user.photoURL || undefined,
      });
      prof = await getUser(user.uid);
    } else {
      // Returning user — fire-and-forget last_login update (non-blocking)
      updateUserLogin(user.uid).catch(() => {});
    }
    return prof;
  } catch (err) {
    console.error('[AuthContext] syncProfile error:', err);
    return null;
  }
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const loadingResolvedRef = useRef(false);

  function resolveLoading() {
    if (!loadingResolvedRef.current) {
      loadingResolvedRef.current = true;
      setLoading(false);
    }
  }

  useEffect(() => {
    // Safety timeout — if Firebase auth hangs, show the app anyway.
    const authTimeout = setTimeout(() => {
      if (!loadingResolvedRef.current) {
        console.warn('[auth] Timeout reached — showing app without waiting for Firebase');
        resolveLoading();
      }
    }, AUTH_TIMEOUT_MS);

    // Listen for auth state changes — single source of truth.
    const unsub = onAuthStateChanged(auth, async (user) => {
      clearTimeout(authTimeout);
      setFirebaseUser(user);

      if (user) {
        // 1. Instant: use cached profile so loading spinner disappears immediately
        const cached = loadCachedProfile(user.uid);
        if (cached) {
          setProfile(cached);
          const cachedAvatar = cached.avatarUrl || user.photoURL;
          if (cachedAvatar) setAvatarDataUrl(fetchAndCacheAvatar(user.uid, cachedAvatar));
          resolveLoading(); // ← loading=false IMMEDIATELY for returning users
        }

        // 2. Background: fetch fresh profile from Firestore
        const prof = await syncProfile(user);
        if (prof) {
          setProfile(prof);
          cacheProfile(prof);
          const avatarUrl = prof.avatarUrl || user.photoURL;
          if (avatarUrl) setAvatarDataUrl(fetchAndCacheAvatar(user.uid, avatarUrl));
        }

        // If no cache was available, resolve loading now (first-time user path)
        resolveLoading();
      } else {
        setProfile(null);
        setAvatarDataUrl(null);
        clearProfileCache();
        resolveLoading();
      }
    });

    return () => {
      clearTimeout(authTimeout);
      unsub();
    };
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setAvatarDataUrl(null);
    clearProfileCache();
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      const prof = await getUser(firebaseUser.uid);
      if (prof) {
        setProfile(prof);
        cacheProfile(prof);
      }
      const avatarUrl = prof?.avatarUrl || firebaseUser.photoURL;
      if (avatarUrl) {
        localStorage.removeItem(avatarCacheKey(firebaseUser.uid));
        setAvatarDataUrl(cacheAndReturnAvatar(firebaseUser.uid, avatarUrl));
      }
    }
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading, avatarDataUrl, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
