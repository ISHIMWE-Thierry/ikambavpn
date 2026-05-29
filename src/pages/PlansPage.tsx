import { useNavigate } from 'react-router-dom';
import { Check, Shield, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { PageTransition } from '../components/PageTransition';

const FREE_FEATURES = [
  'Unlimited devices',
  'All servers (Spain, Finland, Sweden)',
  'No-logs policy',
  'No payment ever required',
  'Unlimited bandwidth',
  'Reality + WebSocket + XHTTP profiles included',
];

export function PlansPage() {
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();

  const cta = () => {
    if (firebaseUser) navigate('/dashboard');
    else navigate('/signup');
  };

  return (
    <PageTransition>
      <main className="flex-1 py-16 overflow-hidden">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 bg-black/5 rounded-full text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" /> Now 100% free
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-black mb-3">
              IkambaVPN is free.
            </h1>
            <p className="text-gray-500 max-w-md mx-auto text-lg">
              No plans, no charges, no payment. Sign up and use it.
            </p>
          </div>

          <div className="relative rounded-2xl border border-black shadow-lg bg-black text-white p-8 sm:p-10 mb-10">
            <div className="mb-6">
              <h2 className="text-2xl font-bold">Full access</h2>
              <p className="text-sm text-gray-400 mt-1">Everything included, forever.</p>
            </div>
            <div className="mb-8">
              <span className="text-5xl font-bold">Free</span>
              <span className="text-sm ml-2 text-gray-400">/ forever</span>
            </div>
            <ul className="flex flex-col gap-3 mb-8">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-200">
                  <Check className="w-4 h-4 text-white mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <button
              onClick={cta}
              className="w-full rounded-xl py-3 text-sm font-semibold bg-white text-black hover:bg-gray-100 transition-colors"
            >
              {firebaseUser ? 'Open dashboard' : 'Sign up — free'}
            </button>
          </div>

          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="font-semibold text-black">Already have an account?</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  Your existing account already has full free access — nothing to do.
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              className="shrink-0"
              onClick={() => navigate(firebaseUser ? '/dashboard' : '/signin')}
            >
              {firebaseUser ? 'Dashboard' : 'Sign in'}
            </Button>
          </div>

          <p className="text-center text-sm text-gray-400 mt-10">
            Questions?{' '}
            <a href="mailto:support@ikamba.com" className="underline hover:text-black">
              Contact support
            </a>
          </p>
        </div>
      </main>
    </PageTransition>
  );
}
