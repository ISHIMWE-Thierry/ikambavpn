import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  getRedirectResult,
  User as FirebaseUser,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../lib/firebase';
import { getUser, createUser, updateUserLogin } from '../lib/db-service';
import type { UserProfile } from '../types';

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

function avatarCacheKey(uid: string) { return `ikamba_avatar_${uid}`; }

async function fetchAndCacheAvatar(uid: string, url: string): Promise<string | null> {
  try {
    const cached = localStorage.getItem(avatarCacheKey(uid));
    if (cached) return cached;
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    }).then((dataUrl) => {
      if (dataUrl) localStorage.setItem(avatarCacheKey(uid), dataUrl as string);
      return dataUrl as string | null;
    });
  } catch {
    return null;
  }
}

/**
 * Sync a Firebase user to a Firestore profile document.
 * Creates the document on first sign-in, updates last_login for returning users.
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
      // Returning user — update last_login timestamp
      try {
        await updateUserLogin(user.uid);
      } catch {
        // Non-critical
      }
    }
    return prof;
  } catch (err) {
    console.error('[AuthContext] syncProfile error:', err);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Process any pending Google redirect result (fire-and-forget).
    // getRedirectResult only resolves with a user when returning from
    // signInWithRedirect; it returns null otherwise.
    // We call it early so Firebase can resolve the credential before
    // onAuthStateChanged fires.  The actual user handling happens
    // inside onAuthStateChanged below — not here.
    getRedirectResult(auth).catch(() => {
      // Silently ignore — no pending redirect or redirect failed.
    });

    // Listen for auth state changes — this is the single source of truth.
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);

      if (user) {
        const prof = await syncProfile(user);
        setProfile(prof);
        // Load avatar from cache or fetch + cache it
        const avatarUrl = prof?.avatarUrl || user.photoURL;
        if (avatarUrl) {
          // Serve from cache immediately if available
          const cached = localStorage.getItem(avatarCacheKey(user.uid));
          if (cached) {
            setAvatarDataUrl(cached);
          } else {
            fetchAndCacheAvatar(user.uid, avatarUrl).then((dataUrl) => {
              if (dataUrl) setAvatarDataUrl(dataUrl);
            });
          }
        }
      } else {
        setProfile(null);
        setAvatarDataUrl(null);
      }

      setLoading(false);
    });

    return unsub;
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
    setAvatarDataUrl(null);
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      const prof = await getUser(firebaseUser.uid);
      setProfile(prof);
      const avatarUrl = prof?.avatarUrl || firebaseUser.photoURL;
      if (avatarUrl) {
        // Clear old cache and re-fetch in case avatar changed
        localStorage.removeItem(avatarCacheKey(firebaseUser.uid));
        fetchAndCacheAvatar(firebaseUser.uid, avatarUrl).then((dataUrl) => {
          if (dataUrl) setAvatarDataUrl(dataUrl);
        });
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
