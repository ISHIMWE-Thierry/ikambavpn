import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
} from 'firebase/auth';
import { Shield, Loader2, Eye, EyeOff } from 'lucide-react';
import { auth } from '../lib/firebase';
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

/** Map firebase error codes to user-friendly messages */
function friendlyError(code: string | undefined): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/too-many-requests':
      return 'Too many attempts — please try again later.';
    case 'auth/popup-closed-by-user':
      return 'Sign in cancelled.';
    case 'auth/popup-blocked':
      return 'Pop-up blocked — please allow pop-ups and try again.';
    default:
      return 'Sign in failed. Please try again.';
  }
}

export function SignInPage() {
  const { firebaseUser, profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: Location })?.from?.pathname || '/dashboard';
  const hasRedirectedRef = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Handle Google redirect result (fallback when popup is blocked)
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result?.user) {
          toast.success('Welcome back!');
        }
      })
      .catch(() => {
        /* no pending redirect */
      });
  }, []);

  // Redirect when signed in — single handler for all auth methods
  useEffect(() => {
    if (!authLoading && firebaseUser && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      if (profile?.role === 'admin' || profile?.role === 'agent') {
        navigate('/dashboard', { replace: true });
      } else {
        navigate(from, { replace: true });
      }
    }
  }, [authLoading, firebaseUser, profile, navigate, from]);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      // Use redirect instead of popup — works better on custom domains + mobile
      await signInWithRedirect(auth, provider);
      // Page will reload after Google redirects back
    } catch (err: any) {
      setError(friendlyError(err?.code));
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      toast.success('Welcome back!');
      // Keep loading — redirect useEffect navigates.
    } catch (err: any) {
      setError(friendlyError(err?.code));
      setLoading(false);
    }
  };

  // Show a loading spinner while AuthContext resolves
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
          <h1 className="text-2xl font-bold text-gray-900">Welcome back</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to Ikamba VPN</p>
        </div>

        {/* Google Sign In */}
        <Button
          variant="secondary"
          size="lg"
          className="w-full mb-3 text-sm font-medium"
          onClick={handleGoogleSignIn}
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

        {/* Email/Password Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
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

          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-sm text-gray-400 hover:text-black transition-colors"
            >
              Forgot password?
            </Link>
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
              <p className="text-sm text-red-600 text-center">{error}</p>
            </div>
          )}

          <Button type="submit" size="lg" loading={loading} disabled={loading} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-8">
          Don&apos;t have an account?{' '}
          <Link to="/signup" className="text-black font-semibold hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
