/**
 * Forgot Password — mirrors Blink-1's 3-step OTP flow exactly.
 *
 * Step 1: Enter email → POST /auth/request-otp
 * Step 2: Enter 6-digit OTP from email → POST /auth/verify-otp → returns resetToken
 * Step 3: Enter new password → POST /auth/reset-password-otp
 *
 * Uses the same Blink-1 Cloud Functions endpoints (shared Firebase project).
 */
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft } from 'lucide-react';
import { fnApiBase } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import toast from 'react-hot-toast';

type Step = 'email' | 'otp' | 'password' | 'done';

export function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  // 60-second resend cooldown
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // ── Step 1: request OTP ───────────────────────────────────────────────────

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${fnApiBase()}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || 'Failed to send code.');
      }
      toast.success('Code sent! Check your email.');
      setCountdown(60);
      setStep('otp');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${fnApiBase()}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) throw new Error('Failed to resend.');
      toast.success('New code sent!');
      setCountdown(60);
    } catch {
      setError('Failed to resend code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: verify OTP ────────────────────────────────────────────────────

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (otp.length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${fnApiBase()}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Invalid or expired code.');
      setResetToken(data.resetToken || data.token || '');
      setStep('password');
    } catch (err: unknown) {
      setError((err as Error).message || 'Invalid or expired code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: reset password ────────────────────────────────────────────────

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${fnApiBase()}/auth/reset-password-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          resetToken,
          newPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || data.message || 'Failed to reset password.');
      setStep('done');
    } catch (err: unknown) {
      setError((err as Error).message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-8 h-8 mb-3" />
          <h1 className="text-2xl font-bold text-black">Reset password</h1>
          <p className="text-sm text-gray-500 mt-1">
            {step === 'email' && 'Enter your email to receive a reset code'}
            {step === 'otp' && `Code sent to ${email}`}
            {step === 'password' && 'Choose a new password'}
            {step === 'done' && 'Password updated'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 justify-center mb-8">
          {(['email', 'otp', 'password'] as Step[]).map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  step === s
                    ? 'bg-black text-white'
                    : isStepDone(step, s)
                    ? 'bg-gray-200 text-gray-500'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {i + 1}
              </span>
              {i < 2 && <span className="text-gray-200 text-xs">──</span>}
            </span>
          ))}
        </div>

        {/* Step 1: Email */}
        {step === 'email' && (
          <form onSubmit={handleRequestOtp} className="flex flex-col gap-4">
            <Input
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              autoFocus
            />
            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              Send reset code
            </Button>
          </form>
        )}

        {/* Step 2: OTP */}
        {step === 'otp' && (
          <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4">
            <Input
              label="6-digit code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              required
              autoFocus
            />
            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              Verify code
            </Button>
            <button
              type="button"
              onClick={handleResend}
              disabled={countdown > 0}
              className="text-sm text-center text-gray-400 hover:text-black transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
            </button>
          </form>
        )}

        {/* Step 3: New password */}
        {step === 'password' && (
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
            <Input
              label="New password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min. 8 characters"
              required
              autoComplete="new-password"
              autoFocus
            />
            <Input
              label="Confirm password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              required
              autoComplete="new-password"
            />
            {error && <p className="text-sm text-red-500 text-center">{error}</p>}
            <Button type="submit" loading={loading} className="w-full">
              Set new password
            </Button>
          </form>
        )}

        {/* Done */}
        {step === 'done' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-600 text-sm">Your password has been updated. You can now sign in.</p>
            <Link to="/signin" className="w-full">
              <Button className="w-full">Sign in</Button>
            </Link>
          </div>
        )}

        {step !== 'done' && (
          <div className="mt-6 text-center">
            <Link
              to="/signin"
              className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-black transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function isStepDone(current: Step, target: Step): boolean {
  const order: Step[] = ['email', 'otp', 'password', 'done'];
  return order.indexOf(current) > order.indexOf(target);
}
