/**
 * Free 1-Day Trial Page — uses VPNresellers API as default provider.
 *
 * Flow:
 * 1. Check Firestore — if active trial exists → dashboard
 * 2. Check VPNresellers by stored account ID — if active → sync + dashboard
 * 3. Show confirm screen
 * 4. On confirm:
 *    a. findOrCreateAccount(email) → VPNresellers account
 *    b. setExpiry(id, tomorrow) → 24h window
 *    c. Store in vpn_trials with credentials + vpnrAccountId
 * 5. Show success screen + redirect to dashboard
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Check, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserTrial, createTrial, updateTrial } from '../lib/db-service';
import {
  createAccount,
  disableAccount,
  usernameFromEmail,
  generatePassword,
  getAccountByUsername,
  setExpiry,
} from '../lib/vpnresellers-api';
import { Button } from '../components/ui/button';
import type { VpnCredentials, VpnTrial } from '../types';
import toast from 'react-hot-toast';

type Stage = 'loading' | 'available' | 'used' | 'provisioning' | 'success' | 'error';

const TRIAL_PERKS = [
  'Full VPN access for 24 hours',
  'Global server access',
  'No credit card required',
  'One trial per account',
];


export function TrialPage() {
  const { firebaseUser, profile } = useAuth();
  const navigate = useNavigate();

  const [stage, setStage] = useState<Stage>('loading');
  const [credentials, setCredentials] = useState<VpnCredentials | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingTrialId, setPendingTrialId] = useState<string | null>(null);

  useEffect(() => {
    if (!firebaseUser) {
      navigate('/signup', { state: { from: { pathname: '/trial' } } });
      return;
    }

    const email = firebaseUser.email || '';
    const name = profile
      ? `${profile.firstname} ${profile.lastname}`.trim()
      : firebaseUser.displayName || 'VPN User';

    async function check() {
      let trial: VpnTrial | null = null;
      try { trial = await getUserTrial(firebaseUser!.uid); } catch { /* ignore */ }

      if (trial?.status === 'active') { navigate('/dashboard'); return; }
      if (trial?.status === 'expired') { setStage('used'); return; }
      if (trial?.id) setPendingTrialId(trial.id);

      setStage('available');
    }

    check();
  }, [firebaseUser, navigate, profile]);

  const handleStart = async () => {
    if (!firebaseUser) return;
    setStage('provisioning');

    let trialId: string | null = pendingTrialId;
    const email = firebaseUser.email || '';
    const name = profile
      ? `${profile.firstname} ${profile.lastname}`.trim()
      : firebaseUser.displayName || 'VPN User';

    try {
      if (!trialId) {
        trialId = await createTrial(firebaseUser.uid, {
          userEmail: email,
          userName: name,
          status: 'provisioning',
        });
      }

      // Derive username from email, ensure it's not already taken
      let username = usernameFromEmail(email);
      const existing = await getAccountByUsername(username);
      if (existing) {
        // Already have an account — reuse it (previous failed trial)
        const creds: VpnCredentials = {
          username: existing.username,
          vpnrAccountId: existing.id,
        };
        await updateTrial(trialId, {
          resellServiceId: existing.id,
          credentials: creds,
          status: 'active',
        });
        setCredentials(creds);
        setStage('success');
        toast.success('Your free trial is now active!');
        return;
      }

      // Create new account with generated password
      const password = generatePassword();
      const account = await createAccount(username, password);

      // Enforce 24h expiry on VPNresellers side (server-side safety net)
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      await setExpiry(account.id, tomorrow).catch(() => {});

      const creds: VpnCredentials = {
        username: account.username,
        password,
        vpnrAccountId: account.id,
        wgIp: account.wg_ip,
        wgPrivateKey: account.wg_private_key,
        wgPublicKey: account.wg_public_key,
      };

      await updateTrial(trialId, {
        resellServiceId: account.id,
        credentials: creds,
        status: 'active',
      });

      setCredentials(creds);
      setStage('success');
      toast.success('Your free trial is now active!');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      if (trialId) updateTrial(trialId, { status: 'failed' }).catch(() => {});
      setStage('error');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-md mx-auto px-4 py-16">

      {stage === 'available' && (
        <div className="flex flex-col gap-8">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-black rounded-2xl mb-4">
              <Shield className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-3xl font-bold">Try Ikamba VPN free</h1>
            <p className="text-gray-500 mt-2">No payment needed. One trial per account.</p>
          </div>

          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-gray-400" />
              <span className="font-semibold text-sm">What's included (24 hours)</span>
            </div>
            {TRIAL_PERKS.map((p) => (
              <div key={p} className="flex items-center gap-2 text-sm text-gray-700">
                <Check className="w-4 h-4 text-black shrink-0" />
                {p}
              </div>
            ))}
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-500 leading-relaxed">
            Your trial will automatically expire after 24 hours. Subscribe to keep access.
          </div>

          <Button onClick={handleStart} size="lg" className="w-full">
            Start 1-day free trial
          </Button>
        </div>
      )}

      {stage === 'provisioning' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 border-2 border-black border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-bold">Setting up your VPN…</h2>
          <p className="text-sm text-gray-500">This takes a few seconds.</p>
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

      {stage === 'success' && credentials && (
        <div className="flex flex-col gap-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-black rounded-2xl mb-4">
              <Check className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Trial is active!</h1>
            <p className="text-gray-500 mt-1 text-sm">You have 24 hours of full VPN access.</p>
          </div>

          <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-50">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">VPN credentials</p>
            </div>
            <div className="px-5 py-4 font-mono text-sm flex flex-col gap-2 bg-gray-50">
              {credentials.username && (
                <p><span className="text-gray-400">Username: </span>{credentials.username}</p>
              )}
              {credentials.password && (
                <p><span className="text-gray-400">Password: </span>{credentials.password}</p>
              )}
              {credentials.wgIp && (
                <p><span className="text-gray-400">WireGuard IP: </span>{credentials.wgIp}</p>
              )}
            </div>
          </div>

          <p className="text-sm text-gray-500 text-center">
            Full credentials and app downloads are on your dashboard.
          </p>
          <Button onClick={() => navigate('/dashboard')} className="w-full">
            Go to dashboard
          </Button>
        </div>
      )}
    </main>
  );
}

// Re-export for use in dashboard trial auto-deactivation
export { disableAccount };
