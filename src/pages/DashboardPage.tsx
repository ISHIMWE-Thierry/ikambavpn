import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, AlertCircle, RefreshCw, ChevronRight, Download, Copy, Check,
  Activity, Wifi, WifiOff, Settings, ExternalLink, Power,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders } from '../lib/db-service';
import {
  provisionXuiAccount, getXuiStats, formatBytes, formatExpiry,
  checkVpnServerHealth, runDiagnostics,
} from '../lib/xui-api';
import type { XuiClientStat, DiagnosticResult } from '../lib/xui-api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { formatDate, formatCurrency, daysUntilExpiry, isExpired } from '../lib/utils';
import type { VpnOrder, OrderStatus } from '../types';

// ── Device detection ──────────────────────────────────────────────────────────

type DeviceType = 'ios' | 'android' | 'mac' | 'windows' | 'linux' | 'unknown';

function detectDevice(): DeviceType {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua)) return 'mac';
  if (/Win/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
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
    steps: ['Open V2RayTun', 'Tap + → Import from clipboard', 'Tap Connect'],
    disconnectTip: 'V2RayTun → Settings → enable On-Demand to stay connected in background.',
    routingTip: 'Tap your config → Routing → select Global.',
  },
  android: {
    appName: 'V2RayNG',
    appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
    appStore: 'Google Play',
    steps: ['Open V2RayNG', 'Tap + → Import config from clipboard', 'Tap the play button to connect'],
    disconnectTip: 'Turn off battery optimisation for V2RayNG in Android Settings.',
    routingTip: '⋮ menu → Settings → Routing → select Global.',
  },
  mac: {
    appName: 'V2RayTun',
    appUrl: 'https://apps.apple.com/app/id6476628951',
    appStore: 'App Store',
    steps: ['Open V2RayTun', 'Click + → Import from clipboard', 'Click Connect'],
    routingTip: 'Click your config → Routing → select Global.',
  },
  windows: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],
    routingTip: 'Settings → Routing → Block None.',
  },
  linux: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],
    routingTip: 'Settings → Routing → Block None.',
  },
  unknown: {
    appName: 'Hiddify',
    appUrl: 'https://github.com/hiddify/hiddify-app/releases',
    appStore: 'Download',
    steps: ['Open your VPN app', 'Import from clipboard', 'Connect'],
  },
};

// ── Subscription URL ──────────────────────────────────────────────────────────

function getSubUrl(email: string): string {
  const base = import.meta.env.DEV
    ? 'http://localhost:4000'
    : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
  return `${base}/xui-public/sub/${encodeURIComponent(email)}`;
}

// ── VPN Connect Card ──────────────────────────────────────────────────────────

function VpnCard() {
  const { firebaseUser, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<XuiClientStat | null>(null);
  const [activated, setActivated] = useState(false);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);
  const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const healthInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const device = useMemo(() => detectDevice(), []);
  const cfg = DEVICE_CONFIG[device];
  const subscriptionUrl = firebaseUser?.email ? getSubUrl(firebaseUser.email) : null;
  const isAdmin = profile?.role === 'admin';

  const runHealthCheck = useCallback(async () => {
    setHealthChecking(true);
    const { online } = await checkVpnServerHealth();
    setServerOnline(online);
    setHealthChecking(false);
  }, []);

  useEffect(() => {
    if (!firebaseUser?.email) return;
    getXuiStats(firebaseUser.email).then((s) => {
      setStats(s);
      setActivated(true);
      runHealthCheck();
      healthInterval.current = setInterval(runHealthCheck, 60_000);
    }).catch(() => {
      // No account yet — show pre-activation UI
    });
    return () => { if (healthInterval.current) clearInterval(healthInterval.current); };
  }, [firebaseUser?.email, runHealthCheck]);

  async function handleActivate() {
    if (!firebaseUser?.email) return;
    setLoading(true);
    setError(null);
    try {
      await provisionXuiAccount({ email: firebaseUser.email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 });
      // Show connected UI immediately — don't wait for stats to propagate
      setActivated(true);
      runHealthCheck();
      healthInterval.current = setInterval(runHealthCheck, 60_000);
      getXuiStats(firebaseUser.email).then(setStats).catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Activation failed. Please try again.');
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
  if (!activated) {
    return (
      <div className="flex flex-col gap-5">
        {/* Big activation card */}
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center text-center gap-5">
              <div className="w-16 h-16 rounded-full bg-black flex items-center justify-center">
                <Power className="w-7 h-7 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-black">Get connected</h2>
                <p className="text-sm text-gray-500 mt-1">One tap to activate your VPN account</p>
              </div>

              {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2 w-full">{error}</p>}

              <Button onClick={handleActivate} disabled={loading} size="lg" className="w-full max-w-xs">
                {loading
                  ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Activating…</>
                  : 'Activate VPN'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Download app */}
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">You'll also need the app</p>
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
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Activated — Main view ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* ====== BIG CONNECT BUTTON ====== */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center text-center gap-4">
            {/* Status indicator */}
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                serverOnline === null ? 'bg-gray-300' : serverOnline ? 'bg-green-400 animate-pulse' : 'bg-red-400'
              }`} />
              <span className="text-sm font-medium text-gray-600">
                {serverOnline === null ? 'Checking server…' : serverOnline ? 'Server online' : 'Server may be down'}
              </span>
            </div>

            {/* Copy VLESS link — the main action */}
            <button
              onClick={copyLink}
              className={`w-full max-w-sm flex items-center justify-center gap-3 rounded-2xl px-6 py-4 font-semibold text-base transition-all ${
                copied
                  ? 'bg-green-50 border-2 border-green-300 text-green-700 scale-[0.98]'
                  : 'bg-black text-white hover:bg-gray-800 active:scale-[0.98] shadow-lg shadow-black/10'
              }`}
            >
              {copied ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
              <span>{copied ? 'Copied!' : 'Copy VPN Link'}</span>
            </button>

            {copied && (
              <p className="text-sm text-green-600 font-medium">
                Now open <strong>{cfg.appName}</strong> and import from clipboard
              </p>
            )}

            {/* Server down warning */}
            {serverOnline === false && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 w-full max-w-sm">
                Server may be down.
                <button onClick={runHealthCheck} disabled={healthChecking} className="underline ml-1 disabled:opacity-50">
                  {healthChecking ? 'Checking…' : 'Retry'}
                </button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ====== INSTRUCTIONS ====== */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-sm">How to connect</h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* Step 1 — Copy */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-sm font-medium text-black">Copy your VPN link</p>
                <p className="text-xs text-gray-500">Tap the button above to copy your personal VLESS link</p>
              </div>
            </div>

            {/* Step 2 — Open app */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-black">Open {cfg.appName}</p>
                <a
                  href={cfg.appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-1 text-xs text-blue-600 hover:underline"
                >
                  <Download className="w-3 h-3" />
                  {cfg.appStore === 'Download' ? 'Download here' : `Get on ${cfg.appStore}`}
                </a>
              </div>
            </div>

            {/* Step 3 — Import & connect */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-sm font-medium text-black">Import and connect</p>
                <ol className="mt-1 flex flex-col gap-0.5">
                  {cfg.steps.map((step: string, i: number) => (
                    <li key={i} className="text-xs text-gray-500">{step}</li>
                  ))}
                </ol>
              </div>
            </div>

            {/* Routing tip — important for Russia users */}
            {cfg.routingTip && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800 ml-9">
                <p className="font-semibold mb-0.5">💡 Important: Set routing to Global</p>
                <p>{cfg.routingTip}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ====== SETTINGS (collapsible) ====== */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-gray-300 transition bg-white"
      >
        <span className="flex items-center gap-2 font-medium text-sm text-gray-700">
          <Settings className="w-4 h-4 text-gray-400" />
          Settings & diagnostics
        </span>
        <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${showSettings ? 'rotate-90' : ''}`} />
      </button>

      {showSettings && (
        <div className="flex flex-col gap-3">
          {/* Usage stats */}
          {stats && (
            <Card>
              <CardContent className="py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Usage</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-lg font-bold text-black">{formatBytes(stats.total)}</p>
                    <p className="text-xs text-gray-500">Data used</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-black">{formatExpiry(stats.expiryTime)}</p>
                    <p className="text-xs text-gray-500">Expires</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Troubleshoot */}
          <Card>
            <CardContent className="py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Troubleshoot</p>
              <div className="flex flex-col gap-3">
                {cfg.disconnectTip && (
                  <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
                    <p className="font-semibold mb-0.5">VPN keeps disconnecting?</p>
                    <p>{cfg.disconnectTip}</p>
                  </div>
                )}
                <Button onClick={handleRunDiagnostics} disabled={diagRunning} variant="secondary" size="sm" className="w-full">
                  {diagRunning
                    ? <><RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> Testing…</>
                    : <><Activity className="w-3 h-3 mr-1.5" /> Run connection test</>}
                </Button>
                {diagResult && (
                  <div className={`rounded-xl p-3 text-xs border ${
                    diagResult.xrayRunning ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                      {diagResult.xrayRunning ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                      {diagResult.verdict}
                    </div>
                    {diagResult.suggestion && <p className="mt-1">{diagResult.suggestion}</p>}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Admin — control panel link */}
          {isAdmin && (
            <a
              href="https://194.76.217.4:2053/x7kQ9m/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition bg-white"
            >
              <span className="flex items-center gap-2 font-medium text-sm">
                <Shield className="w-4 h-4 text-gray-500" />
                3X-UI Control Panel
              </span>
              <ExternalLink className="w-4 h-4 text-gray-400" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'default' }> = {
    active:            { label: 'Active',          variant: 'success' },
    pending_payment:   { label: 'Pending payment', variant: 'warning' },
    payment_submitted: { label: 'Under review',    variant: 'muted'   },
    expired:           { label: 'Expired',         variant: 'danger'  },
    cancelled:         { label: 'Cancelled',       variant: 'danger'  },
  };
  const s = map[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!firebaseUser) return;
    setLoading(true);
    getUserOrders(firebaseUser.uid)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [firebaseUser]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) =>
    o.status === 'pending_payment' || o.status === 'payment_submitted'
  );
  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);

  return (
    <main className="flex-1 max-w-lg mx-auto px-4 sm:px-6 py-8">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-black">
          {profile?.firstname ? `Hi, ${profile.firstname}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">{firebaseUser?.email}</p>
      </div>

      <div className="flex flex-col gap-5">

        {/* VPN card — always shown */}
        <VpnCard />

        {/* Active paid plan info */}
        {activeOrder && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">Plan</h2>
                {statusBadge(activeOrder.status)}
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-1 text-sm text-gray-600">
                <p>{activeOrder.planName} — {activeOrder.planDuration}</p>
                <p>{formatCurrency(activeOrder.amount, activeOrder.currency)}</p>
                {activeOrder.expiresAt && (
                  <p className={expired || (days !== null && days <= 5) ? 'text-red-500 font-medium' : ''}>
                    {expired ? 'Expired' : `Expires in ${days} days`}
                  </p>
                )}
              </div>
              {(expired || (days !== null && days <= 7)) && (
                <div className="mt-4">
                  <Link to="/plans"><Button variant="secondary" size="sm">Renew</Button></Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Pending orders */}
        {pendingOrders.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pending orders</p>
            <div className="flex flex-col gap-2">
              {pendingOrders.map((order) => (
                <Card key={order.id}>
                  <CardContent className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{order.planName}</p>
                      <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                    </div>
                    {statusBadge(order.status)}
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Orders are typically activated within a few hours after payment review.
              </p>
            </div>
          </div>
        )}

        {/* Order history */}
        {orders.filter(o => o.status !== 'pending_payment' && o.status !== 'payment_submitted').length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Order history</p>
            <Card>
              <div className="divide-y divide-gray-50">
                {orders
                  .filter(o => o.status !== 'pending_payment' && o.status !== 'payment_submitted')
                  .map((order) => (
                    <div key={order.id} className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{order.planName}</p>
                        <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-500">{formatCurrency(order.amount, order.currency)}</span>
                        {statusBadge(order.status)}
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          </div>
        )}

        {/* Quick links */}
        {!loading && (
          <div className="flex flex-col gap-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <Link to="/plans" className="flex items-center justify-between border border-gray-100 rounded-2xl px-4 py-3.5 hover:border-black transition">
                <span className="font-medium text-sm">Plans</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link to="/account" className="flex items-center justify-between border border-gray-100 rounded-2xl px-4 py-3.5 hover:border-black transition">
                <span className="font-medium text-sm">Account</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
            </div>
            {isAdmin && (
              <Link to="/admin" className="flex items-center justify-between border border-gray-100 rounded-2xl px-4 py-3.5 hover:border-black transition">
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Shield className="w-4 h-4 text-gray-500" />
                  Admin Dashboard
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
            )}
          </div>
        )}

      </div>
    </main>
  );
}
