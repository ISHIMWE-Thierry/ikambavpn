/**
 * Free Trial Page — provisions a VLESS+REALITY account via the same
 * 3X-UI system used by the dashboard. After activation the user is
 * redirected to the dashboard where they can copy their subscription link.
 *
 * Flow:
 * 1. Check Firestore — if active trial exists → dashboard
 * 2. Check Firestore — if expired trial exists → "Trial used" screen
 * 3. Show confirm screen
 * 4. On confirm:
 *    a. createTrial record (status: provisioning)
 *    b. provisionXuiAccount → 3X-UI panel creates VLESS+REALITY client
 *    c. updateTrial (status: active)
 * 5. Navigate to dashboard (canActivate = true, user copies their link there)
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Check, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserTrial, createTrial, updateTrial } from '../lib/db-service';
import { provisionXuiAccount } from '../lib/xui-api';
import { Button } from '../components/ui/button';
import { PageTransition } from '../components/PageTransition';
import toast from 'react-hot-toast';

type Stage = 'loading' | 'available' | 'used' | 'provisioning' | 'success' | 'error';

const TRIAL_PERKS = [
  'Full VPN access for 1 hour',
  'VLESS+REALITY — works in Russia & restricted regions',
  'Unlimited bandwidth',
  'No payment required',
];

export function TrialPage() {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingTrialId, setPendingTrialId] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) {
      navigate('/signup', { state: { from: { pathname: '/trial' } } });
      return;
    }

    async function check() {
      let trial = null;
      try { trial = await getUserTrial(firebaseUser!.uid); } catch { /* ignore */ }

      // Trial is only truly active if status='active' AND expiresAt is in the future
      const isTrialActive = trial?.status === 'active'
        && !!trial?.expiresAt
        && new Date(trial.expiresAt) > new Date();

      if (isTrialActive)  { navigate('/dashboard'); return; }
      // Treat as used if status is 'expired' OR if active but past expiresAt
      if (trial?.status === 'expired' || (trial?.status === 'active' && !isTrialActive)) {
        setStage('used'); return;
      }
      if (trial?.id) setPendingTrialId(trial.id);

      setStage('available');
    }

    check();
  }, [firebaseUser, navigate, profile]);

  const handleStart = async () => {
    if (!firebaseUser?.email) return;
    setStage('provisioning');

    const email = firebaseUser.email;
    const name = profile
      ? `${profile.firstname} ${profile.lastname}`.trim()
      : firebaseUser.displayName || 'VPN User';

    let trialId: string | null = pendingTrialId;

    try {
      // 1. Create trial record
      if (!trialId) {
        trialId = await createTrial(firebaseUser.uid, {
          userEmail: email,
          userName: name,
          status: 'provisioning',
        });
      }

      // 2. Provision VLESS+REALITY account — 1 hour expiry (1/24 of a day)
      await provisionXuiAccount({
        email,
        trafficLimitGB: 0,
        expiryDays: 1 / 24,
        maxConnections: 2,
      });

      // 3. Mark trial as active in Firestore
      await updateTrial(trialId, { status: 'active' });

      toast.success('Trial activated! Copy your VPN link on the dashboard.');
      setStage('success');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      if (trialId) updateTrial(trialId, { status: 'failed' }).catch(() => {});
      setStage('error');
    }
  };

  // Auto-redirect to dashboard after success
  useEffect(() => {
    if (stage === 'success') {
      const t = setTimeout(() => navigate('/dashboard'), 2000);
      return () => clearTimeout(t);
    }
  }, [stage, navigate]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <PageTransition>
    <main className="flex-1 max-w-md mx-auto px-4 py-16">

      {stage === 'available' && (
        <div className="flex flex-col gap-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-black rounded-2xl mb-4">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold">1 hour free trial</h1>
            <p className="text-gray-500 mt-2">No payment needed. One trial per account.</p>
          </div>

          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="font-semibold text-sm">What's included</span>
            </div>
            {TRIAL_PERKS.map((p) => (
              <div key={p} className="flex items-center gap-2 text-sm text-gray-700">
                <Check className="w-4 h-4 text-black shrink-0" />
                {p}
              </div>
            ))}
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-500 leading-relaxed">
            After activation you'll be taken to your dashboard where you can copy your personal VPN link and import it into <strong>V2RayTun</strong> (iOS/Mac) or <strong>V2RayNG</strong> (Android).
          </div>

          <Button onClick={handleStart} size="lg" className="w-full">
            Start free trial
          </Button>
        </div>
      )}

      {stage === 'provisioning' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 border-2 border-black border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-bold">Setting up your VPN…</h2>
          <p className="text-sm text-gray-500">Creating your VLESS account. This takes a few seconds.</p>
        </div>
      )}

      {stage === 'success' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-black rounded-2xl">
            <Check className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Trial is active!</h1>
          <p className="text-gray-500 max-w-xs">
            Taking you to the dashboard — tap <strong>Copy VPN Link</strong> then import it into your VPN app.
          </p>
          <div className="w-5 h-5 border-2 border-gray-300 border-t-black rounded-full animate-spin" />
        </div>
      )}

      {stage === 'used' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold">Trial already used</h2>
          <p className="text-gray-500 max-w-xs">
            You've already used your free trial. Subscribe to continue.
          </p>
          <Button onClick={() => navigate('/plans')} className="w-full max-w-xs">View plans</Button>
          <button onClick={() => navigate('/dashboard')} className="text-sm text-gray-400 hover:text-black">
            Go to dashboard
          </button>
        </div>
      )}

      {stage === 'error' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <h2 className="text-2xl font-bold">Provisioning failed</h2>
          <p className="text-sm text-gray-500 max-w-xs">{errorMsg}</p>
          <Button onClick={() => setStage('available')} variant="secondary" className="w-full max-w-xs">
            Try again
          </Button>
          <button onClick={() => navigate('/plans')} className="text-sm text-gray-400 hover:text-black">
            View paid plans instead
          </button>
        </div>
      )}
    </main>
    </PageTransition>
  );
}
