import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createUserWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { Shield, Loader2, Eye, EyeOff } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { COLLECTIONS } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import toast from 'react-hot-toast';

// Google Icon Component
const GoogleIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 488 512" aria-hidden="true">
    <path
      fill="currentColor"
      d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"
    />
  </svg>
);

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, '');
}

/** Map firebase error codes to user-friendly messages */
function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/weak-password':
      return 'Password is too weak — use at least 6 characters.';
    case 'auth/operation-not-allowed':
      return 'Sign up is temporarily disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts — please try again later.';
    case 'auth/popup-closed-by-user':
      return 'Sign up cancelled.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function SignUpPage() {
  const { firebaseUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const hasRedirectedRef = useRef(false);

  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [tel, setTel] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Progressive disclosure: show more fields as user fills
  const step1Done = firstname.length > 1 && validateEmail(email);

  // Handle Google redirect result
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          toast.success('Account created!');
        }
      })
      .catch(() => { /* no pending redirect */ });
  }, []);

  // Redirect when signed in
  useEffect(() => {
    if (!authLoading && firebaseUser && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, firebaseUser, navigate]);

  const handleGoogleSignUp = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      // Use redirect instead of popup — works better on custom domains + mobile
      await signInWithRedirect(auth, provider);
      // Page will reload after Google redirects back
      // AuthContext.onAuthStateChanged will handle Firestore user doc creation
    } catch (err: any) {
      setError(friendlyError(err?.code));
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirst = firstname.trim();
    const trimmedLast = lastname.trim();

    if (!trimmedFirst || !trimmedEmail || !password) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!validateEmail(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const displayName = `${trimmedFirst} ${trimmedLast}`.trim();
      await updateProfile(cred.user, { displayName });

      // Write Firestore user doc (Blink-1 compatible structure)
      const ts = new Date().toISOString();
      await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), {
        email: trimmedEmail,
        firstname: trimmedFirst,
        lastname: trimmedLast,
        tel: normalizePhone(tel),
        displayName,
        role: 'user',
        emailVerified: 0,
        needsOtpVerification: false,
        paymentstatus: 'False',
        accountStatus: 'active',
        last_login: ts,
        createdAt: ts,
        updatedAt: ts,
        avatarUrl: null,
        loginCount: 1,
      });

      toast.success('Account created!');
      // Keep loading — redirect useEffect navigates.
    } catch (err: any) {
      setError(friendlyError(err?.code));
      setLoading(false);
    }
  };

  // Password strength indicator
  const passwordStrength = (() => {
    if (!password) return null;
    if (password.length < 6) return { label: 'Too short', color: 'bg-red-400', pct: 20 };
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 1) return { label: 'Weak', color: 'bg-orange-400', pct: 40 };
    if (score === 2) return { label: 'Fair', color: 'bg-yellow-400', pct: 60 };
    if (score === 3) return { label: 'Good', color: 'bg-green-400', pct: 80 };
    return { label: 'Strong', color: 'bg-green-600', pct: 100 };
  })();

  if (authLoading) {
    return (
      <main className="flex-1 flex items-center justify-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </main>
    );
  }

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create account</h1>
          <p className="text-sm text-gray-500 mt-1">Get started with Ikamba VPN</p>
        </div>

        {/* Google Sign Up */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full mb-3 text-sm font-medium"
          onClick={handleGoogleSignUp}
          loading={loading}
          disabled={loading}
        >
          <GoogleIcon />
          Continue with Google
        </Button>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-3 text-gray-400 font-medium">or</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Step 1: Name + Email (always visible) */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First name"
              type="text"
              value={firstname}
              onChange={(e) => setFirstname(e.target.value)}
              placeholder="John"
              required
              autoComplete="given-name"
            />
            <Input
              label="Last name"
              type="text"
              value={lastname}
              onChange={(e) => setLastname(e.target.value)}
              placeholder="Doe"
              autoComplete="family-name"
            />
          </div>

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />

          {/* Step 2: Phone + Password (appears after step 1 filled) */}
          <div
            className={`flex flex-col gap-4 overflow-hidden transition-all duration-300 ease-in-out ${
              step1Done ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <Input
              label="Phone (optional)"
              type="tel"
              value={tel}
              onChange={(e) => setTel(e.target.value)}
              placeholder="+250 7XX XXX XXX"
              autoComplete="tel"
            />

            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
                autoComplete="new-password"
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-[34px] text-gray-400 hover:text-gray-600 transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Password strength */}
            {passwordStrength && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${passwordStrength.color}`}
                    style={{ width: `${passwordStrength.pct}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400">{passwordStrength.label}</span>
              </div>
            )}

            <Input
              label="Confirm password"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
              autoComplete="new-password"
              error={
                confirmPassword && password !== confirmPassword
                  ? 'Passwords do not match'
                  : undefined
              }
            />

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <p className="text-sm text-red-600 text-center">{error}</p>
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} disabled={loading} className="w-full">
              Create account
            </Button>
          </div>
        </form>

        <p className="text-center text-sm text-gray-500 mt-8">
          Already have an account?{' '}
          <Link to="/signin" className="text-black font-semibold hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
