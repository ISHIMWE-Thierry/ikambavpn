import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
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
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  firebaseUser: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

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
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const redirectChecked = useRef(false);

  // 1) Process any pending Google redirect BEFORE listening to auth state.
  //    This ensures the redirect user is available to onAuthStateChanged.
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Resolve any pending redirect (e.g. returning from Google sign-in).
      // This MUST complete before we rely on onAuthStateChanged, because
      // Firebase may not fire onAuthStateChanged with the redirect user
      // until getRedirectResult has been called.
      try {
        await getRedirectResult(auth);
      } catch {
        // No pending redirect or redirect error — both are fine.
      }

      if (cancelled) return;
      redirectChecked.current = true;

      // 2) Now listen for auth state changes.
      const unsub = onAuthStateChanged(auth, async (user) => {
        if (cancelled) return;
        setFirebaseUser(user);

        if (user) {
          const prof = await syncProfile(user);
          if (!cancelled) setProfile(prof);
        } else {
          setProfile(null);
        }

        if (!cancelled) setLoading(false);
      });

      // Cleanup listener on unmount
      return unsub;
    }

    let unsub: (() => void) | undefined;
    init().then((u) => {
      unsub = u;
    });

    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const signOut = async () => {
    await firebaseSignOut(auth);
    setProfile(null);
  };

  const refreshProfile = async () => {
    if (firebaseUser) {
      const prof = await getUser(firebaseUser.uid);
      setProfile(prof);
    }
  };

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
