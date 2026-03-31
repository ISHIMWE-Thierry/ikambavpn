import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendPasswordResetEmail } from 'firebase/auth';
import { Shield, ArrowLeft, Mail } from 'lucide-react';
import { auth } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    } catch {
      // Don't leak whether email exists
    }
    setSent(true);
    setLoading(false);
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12 min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-black rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            <Shield className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Reset password</h1>
          <p className="text-sm text-gray-500 mt-1">
            {sent ? 'Check your inbox' : 'Enter your email to get a reset link'}
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="w-14 h-14 bg-black rounded-full flex items-center justify-center">
              <Mail className="w-6 h-6 text-white" />
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              If <strong className="text-gray-900">{email}</strong> has an account, a password reset
              link has been sent. Check your spam folder too.
            </p>
            <Link to="/signin" className="w-full">
              <Button size="lg" className="w-full">
                Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
            <Button type="submit" size="lg" loading={loading} className="w-full">
              Send reset link
            </Button>
          </form>
        )}

        {!sent && (
          <div className="mt-8 text-center">
            <Link
              to="/signin"
              className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-black transition-colors"
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
