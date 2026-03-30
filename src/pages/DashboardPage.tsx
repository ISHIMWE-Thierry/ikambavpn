import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Clock, AlertCircle, RefreshCw, ChevronRight, Zap, Download, Copy, Check, Globe, Activity, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders, getUserTrial, updateTrial } from '../lib/db-service';
// VPNresellers API — kept for future use, not called on dashboard
// import { getAccount, disableAccount, listServers, getAccountByUsername, usernameFromEmail, changePassword, generatePassword } from '../lib/vpnresellers-api';
// import type { VpnrServer } from '../lib/vpnresellers-api';
import { provisionXuiAccount, getXuiLinks, getXuiStats, formatBytes, formatExpiry, checkVpnServerHealth, runDiagnostics } from '../lib/xui-api';
import type { XuiProvisionResult, XuiClientLinks, XuiClientStat, DiagnosticResult } from '../lib/xui-api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { formatDate, formatCurrency, daysUntilExpiry, isExpired } from '../lib/utils';
import type { VpnOrder, OrderStatus, VpnTrial } from '../types';

// ── Credentials block — VLESS only ───────────────────────────────────────────

/** Extract password from admin notes (stored as "Password: xyz" by ActivateForm). */
function extractPassword(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/^Password:\s*(.+)$/i);
  return match?.[1]?.trim();
}

function CredentialsBox({
  username, password, wgIp, wgPrivateKey, wgPublicKey,
}: {
  username?: string; password?: string;
  wgIp?: string; wgPrivateKey?: string; wgPublicKey?: string;
}) {
  // Old protocol props kept for backward compatibility but ignored — VLESS only now
  return <VlessTab />;
}

// ── Ikamba VPN tab ────────────────────────────────────────────────────────────

/** Derive the subscription URL from email — deterministic, never changes. */
function getSubUrl(email: string): string {
  const base = import.meta.env.DEV
    ? 'http://localhost:4000'
    : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
  return `${base}/xui-public/sub/${encodeURIComponent(email)}`;
}

type DeviceType = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'unknown';

function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios' as DeviceType;
  if (/Android/i.test(ua)) return 'android' as DeviceType;
  if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'mac' as DeviceType;
  if (/Win/i.test(ua)) return 'windows' as DeviceType;
  if (/Linux/i.test(ua)) return 'linux' as DeviceType;
  return 'unknown' as DeviceType;
}

const DEVICE_CONFIG: Record<DeviceType, {
  appName: string;
  appUrl: string;
  appStore: string;
  steps: string[];
  disconnectTip?: string;
  routingTip?: string;
}> = {
  ios: {
    appName: 'V2RayTun',
    appUrl: 'https://apps.apple.com/app/id6476628951',
    appStore: 'App Store',
    steps: [
      'Open V2RayTun',
      'Tap + → Import from clipboard',
      'Tap Connect',
    ],
    disconnectTip: 'Go to V2RayTun → Settings → enable On-Demand to stay connected in background.',
    routingTip: 'Tap your config → Routing → select Global.',
  },
  android: {
    appName: 'V2RayNG',
    appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
    appStore: 'Google Play',
    steps: [
      'Open V2RayNG',
      'Tap + → Import config from clipboard',
      'Tap the play button to connect',
    ],
    disconnectTip: 'Make sure battery optimisation is off for V2RayNG in Android Settings.',
    routingTip: '⋮ menu → Settings → Routing → select Global.',
  },
  mac: {
    appName: 'V2RayTun',
    appUrl: 'https://apps.apple.com/app/id6476628951',
    appStore: 'App Store',
    steps: [
      'Open V2RayTun',
      'Click + → Import from clipboard',
      'Click Connect',
    ],
    routingTip: 'Click your config → Routing → select Global.',
  },
  windows: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: [
      'Open Hiddify',
      'Click + → Add from clipboard',
      'Click Connect',
    ],
    routingTip: 'Settings → Routing → Block None.',
  },
  linux: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: [
      'Open Hiddify',
      'Click + → Add from clipboard',
      'Click Connect',
    ],
    routingTip: 'Settings → Routing → Block None.',
  },
  unknown: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: [
      'Open your VPN app',
      'Import from clipboard',
      'Connect',
    ],
  },
};

function VlessTab() {
  const { firebaseUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<XuiClientStat | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const device = useMemo(() => detectDevice(), []);
  const cfg = DEVICE_CONFIG[device];

  const subscriptionUrl = firebaseUser?.email ? getSubUrl(firebaseUser.email) : null;

  const runHealthCheck = useCallback(async () => {
    setHealthChecking(true);
    const { online } = await checkVpnServerHealth();
    setServerOnline(online);
    setHealthChecking(false);
  }, []);

  useEffect(() => {
    if (!firebaseUser?.email) return;
    // Only check stats if user has already activated (stats cached in panel)
    // This avoids noisy 404s in console for users who haven't provisioned yet
    getXuiStats(firebaseUser.email)
      .then((s) => setStats(s))
      .catch(() => { /* no account yet — expected */ });
    runHealthCheck();
    healthInterval.current = setInterval(runHealthCheck, 60_000);
    return () => { if (healthInterval.current) clearInterval(healthInterval.current); };
  }, [firebaseUser?.email, runHealthCheck]);

  async function handleActivate() {
    if (!firebaseUser?.email) return;
    setLoading(true);
    setError(null);
    try {
      await provisionXuiAccount({
        email: firebaseUser.email,
        trafficLimitGB: 0,
        expiryDays: 0,
        maxConnections: 2,
      });
      getXuiStats(firebaseUser.email).then(setStats).catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Failed to activate. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRunDiagnostics() {
    setDiagRunning(true);
    setDiagResult(null);
    try {
      const result = await runDiagnostics();
      setDiagResult(result);
      setServerOnline(result.xrayRunning);
    } catch {
      setDiagResult(null);
    } finally {
      setDiagRunning(false);
    }
  }

  function copyLink() {
    if (!subscriptionUrl) return;
    navigator.clipboard.writeText(subscriptionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  // ── Not yet activated ─────────────────────────────────────────────────────
  if (!stats) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Get started</h2>
          <p className="text-sm text-gray-500">Activate your free VPN — takes 10 seconds.</p>
        </div>
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}
        <Button onClick={handleActivate} disabled={loading} className="w-full">
          {loading
            ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Activating…</>
            : 'Activate Ikamba VPN — Free'}
        </Button>
        <p className="text-xs text-center text-gray-400">No credit card required</p>
      </div>
    );
  }

  // ── Activated ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-5">

      {/* Server status — only show if something is wrong */}
      {serverOnline === false && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
          <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
          Server may be down.
          <button onClick={runHealthCheck} disabled={healthChecking} className="underline ml-1 disabled:opacity-50">
            {healthChecking ? 'Checking…' : 'Retry'}
          </button>
        </div>
      )}

      {/* Step 1 — Copy link */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Step 1 — Copy your link</p>
        <button
          onClick={copyLink}
          className={`w-full flex items-center justify-between rounded-xl px-4 py-3.5 transition font-medium text-sm ${
            copied
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-black text-white hover:bg-gray-900'
          }`}
        >
          <span>{copied ? 'Copied to clipboard!' : 'Copy VPN link'}</span>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
        {copied && (
          <p className="text-xs text-gray-500 text-center">Now go to step 2 ↓</p>
        )}
      </div>

      {/* Step 2 — Download & connect */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Step 2 — Open the app</p>
        <a
          href={cfg.appUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-3 hover:border-black transition"
        >
          <div>
            <p className="text-sm font-semibold">{cfg.appName}</p>
            <p className="text-xs text-gray-400">{cfg.appStore}</p>
          </div>
          <Download className="w-4 h-4 text-gray-400" />
        </a>
        <ol className="flex flex-col gap-1.5 mt-1">
          {cfg.steps.map((step: string, i: number) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-gray-700">
              <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Usage stats — subtle */}
      <div className="flex items-center gap-3 text-xs text-gray-400 border-t border-gray-100 pt-3">
        <span>Used: {formatBytes(stats.total)}</span>
        <span>·</span>
        <span>Expires: {formatExpiry(stats.expiryTime)}</span>
        <span className={`ml-auto w-2 h-2 rounded-full shrink-0 ${
          serverOnline === null ? 'bg-gray-300' : serverOnline ? 'bg-green-400' : 'bg-red-400'
        }`} />
      </div>

      {/* Troubleshoot — collapsed by default */}
      <details className="group">
        <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 transition select-none">
          Having issues? ▸
        </summary>
        <div className="mt-3 flex flex-col gap-3">

          {/* VPN on but sites still blocked */}
          {cfg.routingTip && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
              <p className="font-semibold mb-0.5">Connected but sites still blocked?</p>
              <p>{cfg.routingTip}</p>
            </div>
          )}

          {/* Keeps disconnecting */}
          {cfg.disconnectTip && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
              <p className="font-semibold mb-0.5">VPN keeps disconnecting?</p>
              <p>{cfg.disconnectTip}</p>
            </div>
          )}

          {/* Diagnose */}
          <div className="flex flex-col gap-2">
            <Button onClick={handleRunDiagnostics} disabled={diagRunning} variant="secondary" size="sm">
              {diagRunning
                ? <><RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> Testing…</>
                : <><Activity className="w-3 h-3 mr-1.5" /> Run connection test</>}
            </Button>
            {diagResult && (
              <div className={`rounded-xl p-3 text-xs border ${
                diagResult.verdict === 'healthy'
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : diagResult.verdict === 'degraded'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                  {diagResult.verdict === 'healthy' ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                  {diagResult.verdict === 'healthy' ? 'All good' : diagResult.verdict === 'degraded' ? 'Server degraded' : 'Server issue'}
                </div>
                <p>{diagResult.suggestion}</p>
              </div>
            )}
          </div>

        </div>
      </details>

    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'default' }> = {
    active: { label: 'Active', variant: 'success' },
    pending_payment: { label: 'Pending payment', variant: 'warning' },
    payment_submitted: { label: 'Under review', variant: 'muted' },
    expired: { label: 'Expired', variant: 'danger' },
    cancelled: { label: 'Cancelled', variant: 'danger' },
  };
  const s = map[status] ?? { label: status, variant: 'muted' };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<VpnTrial | null>(null);
  const [trialTimeLeft, setTrialTimeLeft] = useState('');

  const fetchOrders = () => {
    if (!firebaseUser) return;
    setLoading(true);
    getUserOrders(firebaseUser.uid)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchOrders, [firebaseUser]);

  // Fetch trial record
  useEffect(() => {
    if (!firebaseUser) return;
    getUserTrial(firebaseUser.uid)
      .then(setTrial)
      .catch((err) => {
        console.warn('Failed to fetch trial record:', err?.message || err);
      });
  }, [firebaseUser]);

  // Live countdown + auto-deactivate when trial expires
  useEffect(() => {
    if (!trial || trial.status !== 'active') return;

    const tick = () => {
      const ms = new Date(trial.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setTrialTimeLeft('Expired');
        updateTrial(trial.id, { status: 'expired' }).catch(() => {});
        setTrial((t) => (t ? { ...t, status: 'expired' } : t));
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setTrialTimeLeft(`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [trial]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) =>
    o.status === 'pending_payment' || o.status === 'payment_submitted'
  );
  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);

  // User has an active VPN in any form
  const hasActiveVpn = !!activeOrder || trial?.status === 'active';

  // Is the user on a free trial (not a paid plan)?
  const isTrialUser = trial?.status === 'active' && !activeOrder;

  return (
    <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-black">
            {profile?.firstname ? `Hi, ${profile.firstname}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{firebaseUser?.email}</p>
        </div>
        <button onClick={fetchOrders} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
          <RefreshCw className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-6">
          {/* Skeleton — main service card */}
          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col gap-4 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gray-100 rounded" />
                <div className="w-36 h-4 bg-gray-100 rounded" />
              </div>
              <div className="w-16 h-5 bg-gray-100 rounded-full" />
            </div>
            <div className="w-full h-20 bg-gray-50 rounded-xl" />
            <div className="w-32 h-8 bg-gray-100 rounded-xl" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {/* ── Ikamba VPN — always show for any active user ── */}
          {hasActiveVpn && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <h2 className="font-semibold">Ikamba VPN</h2>
                  </div>
                  <Badge variant="success">Active</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <CredentialsBox />
              </CardContent>
            </Card>
          )}

          {/* ── Paid active order (Firestore) ── */}
          {activeOrder && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <h2 className="font-semibold">Active VPN plan</h2>
                  </div>
                  {statusBadge(activeOrder.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-6 mb-4">
                  <Stat label="Plan" value={`${activeOrder.planName} — ${activeOrder.planDuration}`} />
                  <Stat label="Amount paid" value={formatCurrency(activeOrder.amount, activeOrder.currency)} />
                  {activeOrder.expiresAt && (
                    <Stat
                      label="Expires"
                      value={expired ? 'Expired' : `${days} days left`}
                      alert={expired || (days !== null && days <= 5)}
                    />
                  )}
                </div>

                {activeOrder.credentials && (
                  <>
                    <p className="text-sm font-medium mb-3 border-t border-gray-100 pt-5">VPN credentials</p>
                    <CredentialsBox
                      username={activeOrder.credentials.username}
                      password={activeOrder.credentials.password ?? extractPassword(activeOrder.credentials.notes)}
                      wgIp={activeOrder.credentials.wgIp}
                      wgPrivateKey={activeOrder.credentials.wgPrivateKey}
                      wgPublicKey={activeOrder.credentials.wgPublicKey}
                    />
                  </>
                )}

                {(expired || (days !== null && days <= 7)) && (
                  <div className="mt-5">
                    <Link to="/plans"><Button variant="secondary" size="sm">Renew service</Button></Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Free trial ── */}
          {trial?.status === 'active' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    <h2 className="font-semibold">Free 1-day trial</h2>
                  </div>
                  <Badge variant="success">Trial active</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-mono font-semibold">{trialTimeLeft} remaining</span>
                </div>
                <CredentialsBox />
                <div className="mt-5">
                  <Link to="/plans"><Button variant="secondary" size="sm">Upgrade to paid plan</Button></Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Russia / DPI-bypass recommendation card (always visible for active users) ── */}
          {hasActiveVpn && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  <h2 className="font-semibold">For users in Russia &amp; restricted countries</h2>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 mb-4">
                  <p className="text-sm font-medium text-blue-900 mb-1">
                    Standard protocols are blocked in Russia.
                  </p>
                  <p className="text-xs text-blue-700">
                    <strong>Ikamba VPN</strong> looks like normal HTTPS — undetectable. Works on all devices.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link to="/russia-guide">
                    <Button variant="secondary" size="sm">
                      Russia setup guide
                    </Button>
                  </Link>
                  <a href="https://t.me/ikambavpn" target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary" size="sm">
                      Telegram support
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Switch to the <strong>Ikamba VPN</strong> tab above to get started.
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Trial expired ── */}
          {trial?.status === 'expired' && !activeOrder && (
            <Card>
              <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-gray-300" />
                <p className="font-medium text-gray-700">Your free trial has ended</p>
                <p className="text-sm text-gray-400 max-w-xs">Subscribe to keep your VPN access.</p>
                <Link to="/plans"><Button size="sm">View plans</Button></Link>
              </CardContent>
            </Card>
          )}

          {/* ── No service at all ── */}
          {!activeOrder && !isTrialUser && trial?.status !== 'active' && trial?.status !== 'expired' && (
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
                <Shield className="w-10 h-10 text-gray-300" />
                <p className="font-medium text-gray-700">No active VPN service</p>
                <p className="text-sm text-gray-400 max-w-xs">Browse our plans or try free for 1 day.</p>
                <div className="flex gap-2">
                  <Link to="/plans"><Button>Browse plans</Button></Link>
                  {!trial && <Link to="/trial"><Button variant="secondary">Try free</Button></Link>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Offer trial link (subtle) ── */}
          {!trial && !activeOrder && (
            <Link
              to="/trial"
              className="flex items-center justify-between border border-dashed border-gray-200 rounded-2xl px-5 py-4 hover:border-black transition"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">Try Ikamba VPN free for 1 day</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          )}

          {/* ── Pending orders ── */}
          {pendingOrders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Pending orders</h2>
              <div className="flex flex-col gap-3">
                {pendingOrders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium">{order.planName} — {order.planDuration}</p>
                          <p className="text-xs text-gray-400">Submitted {formatDate(order.createdAt)}</p>
                        </div>
                      </div>
                      {statusBadge(order.status)}
                    </CardContent>
                  </Card>
                ))}
                <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Orders are typically activated within a few hours after payment review.
                </p>
              </div>
            </div>
          )}

          {/* ── Order history ── */}
          {orders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Order history</h2>
              <Card>
                <div className="divide-y divide-gray-50">
                  {orders.map((order) => (
                    <div key={order.id} className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{order.planName}</p>
                        <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600">{formatCurrency(order.amount, order.currency)}</span>
                        {statusBadge(order.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ── Quick links ── */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link to="/plans" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Browse plans</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
            <Link to="/account" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Account settings</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-semibold text-sm ${alert ? 'text-red-500' : 'text-black'}`}>{value}</p>
    </div>
  );
}
