import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);

      if (user) {
        try {
          let prof = await getUser(user.uid);

          if (!prof) {
            // First sign-in — create user doc with Blink-1 field structure
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

          setProfile(prof);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }

      setLoading(false);
    });

    return unsub;
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
