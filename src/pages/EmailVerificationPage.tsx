import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, signOut as firebaseSignOut } from 'firebase/auth';
import { Shield, Loader2, MailCheck, LogOut, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { generateAndSendOtp, verifyOtp } from '../lib/otp-service';
import toast from 'react-hot-toast';

export function EmailVerificationPage() {
  const navigate = useNavigate();
  const { firebaseUser, profile, refreshProfile } = useAuth();
  const auth = getAuth();

  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Redirect if already verified or doesn't need OTP
  useEffect(() => {
    if (!firebaseUser) {
      navigate('/signin', { replace: true });
      return;
    }
    if (profile && (profile.emailVerified === 1 || !profile.needsOtpVerification)) {
      navigate('/dashboard', { replace: true });
    }
  }, [firebaseUser, profile, navigate]);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) { clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleDigitChange = useCallback((index: number, value: string) => {
    if (value.length > 1) value = value.slice(-1);
    if (value && !/^\d$/.test(value)) return;

    setOtpCode((prev) => {
      const digits = prev.padEnd(6, ' ').split('');
      digits[index] = value || ' ';
      return digits.join('').replace(/ /g, '');
    });
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpCode[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [otpCode]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      setOtpCode(pasted);
      setError('');
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
  }, []);

  const handleVerify = useCallback(async () => {
    if (!firebaseUser?.uid || otpCode.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const result = await verifyOtp(firebaseUser.uid, otpCode);
      if (result.success) {
        setVerified(true);
        await refreshProfile();
        setTimeout(() => window.location.replace('/dashboard'), 1400);
      } else {
        setError(result.error || 'Verification failed. Please try again.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setVerifying(false);
    }
  }, [firebaseUser, otpCode, refreshProfile]);

  const handleResend = useCallback(async () => {
    if (!firebaseUser?.uid || !firebaseUser.email || cooldown > 0) return;
    setResending(true);
    setError('');
    try {
      await generateAndSendOtp(
        firebaseUser.uid,
        firebaseUser.email,
        profile?.displayName || firebaseUser.displayName || undefined,
      );
      setCooldown(60);
      toast.success('New code sent. Check your inbox.');
    } catch {
      setError('Failed to send a new code. Please try again.');
    } finally {
      setResending(false);
    }
  }, [firebaseUser, profile, cooldown]);

  const handleSignOut = async () => {
    await firebaseSignOut(auth).catch(() => {});
    navigate('/signin', { replace: true });
  };

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (otpCode.length === 6 && !verifying && !verified) {
      handleVerify();
    }
  }, [otpCode, verifying, verified, handleVerify]);

  if (verified) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 min-h-screen">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-xl font-bold">Email verified</h2>
          <p className="text-sm text-gray-500">Redirecting to your dashboard…</p>
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
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
          <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
          {firebaseUser?.email && (
            <p className="text-sm text-gray-500 mt-1">
              Code sent to <span className="font-medium text-black">{firebaseUser.email}</span>
            </p>
          )}
        </div>

        {/* OTP inputs */}
        <div className="flex justify-center gap-2 mb-5" onPaste={handlePaste}>
          {Array.from({ length: 6 }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={otpCode[i] || ''}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={verifying}
              autoFocus={i === 0}
              className="w-12 h-14 text-center text-xl font-bold border-2 border-gray-200 rounded-xl
                focus:border-black focus:outline-none transition-colors bg-white
                disabled:opacity-50"
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 mb-4">
            <p className="text-sm text-red-600 text-center">{error}</p>
          </div>
        )}

        {/* Verify button */}
        <Button
          className="w-full mb-3"
          size="lg"
          onClick={handleVerify}
          disabled={verifying || otpCode.length !== 6}
          loading={verifying}
        >
          {verifying ? 'Verifying…' : 'Verify email'}
        </Button>

        {/* Resend */}
        <Button
          variant="secondary"
          className="w-full mb-3"
          size="lg"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
          loading={resending}
        >
          <MailCheck className="w-4 h-4" />
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </Button>

        {/* Sign out */}
        <Button variant="ghost" className="w-full text-gray-400" size="lg" onClick={handleSignOut}>
          <LogOut className="w-4 h-4" />
          Sign out
        </Button>

        <p className="text-xs text-center text-gray-400 mt-6">
          Code expires in 10 minutes. Check your spam folder if needed.
        </p>
      </div>
    </main>
  );
}
