import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { Shield } from 'lucide-react';
import { auth } from '../lib/firebase';
import { createUser } from '../lib/db-service';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import toast from 'react-hot-toast';

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-().]/g, '');
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [tel, setTel] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const displayName = `${firstname} ${lastname}`.trim();
      await updateProfile(cred.user, { displayName });

      // Write user doc with Blink-1 field structure to shared `users` collection
      await createUser(cred.user.uid, {
        email,
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        tel: normalizePhone(tel),
      });

      toast.success('Account created!');
      navigate('/plans');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/email-already-in-use') {
        setError('This email is already registered. Sign in instead.');
      } else {
        setError('Failed to create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Shield className="w-8 h-8 mb-3" />
          <h1 className="text-2xl font-bold text-black">Create account</h1>
          <p className="text-sm text-gray-500 mt-1">Get started with Ikamba VPN</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
              required
              autoComplete="family-name"
            />
          </div>
          <Input
            label="Phone number"
            type="tel"
            value={tel}
            onChange={(e) => setTel(e.target.value)}
            placeholder="+250 7XX XXX XXX"
            autoComplete="tel"
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min. 8 characters"
            required
            autoComplete="new-password"
          />

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <Button type="submit" loading={loading} className="w-full mt-2">
            Create account
          </Button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-6">
          Already have an account?{' '}
          <Link to="/signin" className="text-black font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
