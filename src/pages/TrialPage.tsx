/**
 * Free 1-Day Trial Page
 *
 * Flow:
 * 1. Check if user already used a trial → redirect to dashboard if so
 * 2. Show trial details + confirm button
 * 3. On confirm:
 *    a. Create ResellPortal client for the user
 *    b. Create VPN order → get service_id + vpn_credentials
 *    c. Store in vpn_trials collection with expiresAt = now + 24h
 * 4. Show success screen with credentials → redirect to dashboard
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Check, Clock, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserTrial, createTrial, updateTrial } from '../lib/db-service';
import { createClient, createVpnOrder, getClientByEmail } from '../lib/api';
import { Button } from '../components/ui/button';
import type { VpnCredentials } from '../types';
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

  useEffect(() => {
    if (!firebaseUser) {
      navigate('/signup', { state: { from: { pathname: '/trial' } } });
      return;
    }
    getUserTrial(firebaseUser.uid)
      .then((trial) => {
        if (trial) {
          setStage('used');
        } else {
          setStage('available');
        }
      })
      .catch(() => setStage('available'));
  }, [firebaseUser, navigate]);

  const handleStart = async () => {
    if (!firebaseUser) return;
    setStage('provisioning');

    let trialId: string | null = null;

    try {
      const name = profile
        ? `${profile.firstname} ${profile.lastname}`.trim()
        : firebaseUser.displayName || 'VPN User';
      const email = firebaseUser.email || '';

      // Create trial record early (status: provisioning) so we can update it even on partial failure
      trialId = await createTrial(firebaseUser.uid, {
        userEmail: email,
        userName: name,
        status: 'provisioning',
      });

      // Step 1 — create ResellPortal client (or reuse existing)
      let resellClientId: number;
      try {
        resellClientId = await createClient({ name, email });
      } catch {
        // Client already exists — look up by email
        const existing = await getClientByEmail(email);
        if (existing) {
          resellClientId = existing.id;
        } else {
          throw new Error('Could not create VPN account. Please contact support.');
        }
      }

      // Step 2 — create VPN order → receive credentials immediately
      const order = await createVpnOrder(resellClientId, 'monthly');

      if (!order.success || !order.service_id) {
        throw new Error(order.message || 'VPN provisioning failed. Please try again.');
      }

      // Credentials may be under vpn_credentials, client_credentials, or service_data
      const vc = order.vpn_credentials;
      const cc = order.client_credentials;
      const sd = order.service_data;

      const creds: VpnCredentials = {
        username: vc?.username || cc?.email || sd?.username,
        password: vc?.password || cc?.password || sd?.password,
        serverAddress: vc?.server || vc?.server_address || sd?.server || sd?.server_address,
      };

      // Step 3 — update trial record with real data
      await updateTrial(trialId, {
        resellClientId,
        resellServiceId: order.service_id,
        credentials: creds,
        status: 'active',
      });

      setCredentials(creds);
      setStage('success');
      toast.success('Your free trial is now active!');
    } catch (err: unknown) {
      const msg = (err as Error).message || 'Something went wrong. Please try again.';
      setErrorMsg(msg);
      // Mark trial as failed if we created a record
      if (trialId) {
        updateTrial(trialId, { status: 'failed' }).catch(() => {});
      }
      setStage('error');
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-md mx-auto px-4 py-16">

      {/* Available */}
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
            Your trial will automatically expire after 24 hours. To keep your VPN access, subscribe to one of our plans.
          </div>

          <Button onClick={handleStart} size="lg" className="w-full">
            Start 1-day free trial
          </Button>
        </div>
      )}

      {/* Provisioning */}
      {stage === 'provisioning' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 border-2 border-black border-t-transparent rounded-full animate-spin" />
          <h2 className="text-xl font-bold">Setting up your VPN…</h2>
          <p className="text-sm text-gray-500">Creating your account and provisioning a server. This takes a few seconds.</p>
        </div>
      )}

      {/* Already used */}
      {stage === 'used' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold">Trial already used</h2>
          <p className="text-gray-500 max-w-xs">
            You've already used your free trial. Subscribe to a plan to continue enjoying Ikamba VPN.
          </p>
          <Button onClick={() => navigate('/plans')} className="w-full max-w-xs">
            View plans
          </Button>
          <button
            onClick={() => navigate('/dashboard')}
            className="text-sm text-gray-400 hover:text-black"
          >
            Go to dashboard
          </button>
        </div>
      )}

      {/* Error */}
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
          <button
            onClick={() => navigate('/plans')}
            className="text-sm text-gray-400 hover:text-black"
          >
            View paid plans instead
          </button>
        </div>
      )}

      {/* Success */}
      {stage === 'success' && (
        <div className="flex flex-col gap-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-black rounded-2xl mb-4">
              <Check className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Trial is active!</h1>
            <p className="text-gray-500 mt-1 text-sm">You have 24 hours of full VPN access.</p>
          </div>

          {credentials && (
            <div className="border border-gray-100 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-50">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Your VPN credentials</p>
              </div>
              <div className="px-5 py-4 font-mono text-sm flex flex-col gap-2 bg-gray-50">
                {credentials.serverAddress && (
                  <p><span className="text-gray-400">Server: </span>{credentials.serverAddress}</p>
                )}
                {credentials.username && (
                  <p><span className="text-gray-400">Username: </span>{credentials.username}</p>
                )}
                {credentials.password && (
                  <p><span className="text-gray-400">Password: </span>{credentials.password}</p>
                )}
              </div>
            </div>
          )}

          <p className="text-sm text-gray-500 text-center">
            These credentials are also visible on your dashboard at any time.
          </p>

          <Button onClick={() => navigate('/dashboard')} className="w-full">
            Go to dashboard
          </Button>
        </div>
      )}
    </main>
  );
}
