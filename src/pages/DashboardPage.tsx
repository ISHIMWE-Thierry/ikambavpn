import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Shield, AlertCircle, RefreshCw, ChevronRight, Download, Copy, Check, Activity, Wifi, WifiOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders } from '../lib/db-service';
import { provisionXuiAccount, getXuiStats, formatBytes, formatExpiry, checkVpnServerHealth, runDiagnostics } from '../lib/xui-api';
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

// ── VPN card ──────────────────────────────────────────────────────────────────

function VpnCard() {
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
    getXuiStats(firebaseUser.email).then((s) => {
      setStats(s);
      // Only start health polling once we know the user has an account
      runHealthCheck();
      healthInterval.current = setInterval(runHealthCheck, 60_000);
    }).catch(() => {
      // No account yet — don't poll, just show Activate button
    });
    return () => { if (healthInterval.current) clearInterval(healthInterval.current); };
  }, [firebaseUser?.email, runHealthCheck]);

  async function handleActivate() {
    if (!firebaseUser?.email) return;
    setLoading(true);
    setError(null);
    try {
      await provisionXuiAccount({ email: firebaseUser.email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 });
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
  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <h2 className="font-semibold">Ikamba VPN</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-500">Activate your free VPN — takes 10 seconds.</p>
            {error && <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
            <Button onClick={handleActivate} disabled={loading} className="w-full">
              {loading
                ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Activating…</>
                : 'Activate Ikamba VPN'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Activated ─────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <h2 className="font-semibold">Ikamba VPN</h2>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              serverOnline === null ? 'bg-gray-300' : serverOnline ? 'bg-green-400' : 'bg-red-400'
            }`} />
            <Badge variant="success">Active</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">

          {/* Server down warning */}
          {serverOnline === false && (
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
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
              className={`w-full flex items-center justify-between rounded-xl px-4 py-3.5 font-medium text-sm transition ${
                copied ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-black text-white hover:bg-gray-900'
              }`}
            >
              <span>{copied ? 'Copied to clipboard!' : 'Copy VPN link'}</span>
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
            {copied && <p className="text-xs text-gray-500 text-center">Now open the app below ↓</p>}
          </div>

          {/* Step 2 — App + instructions for this device */}
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

          {/* Usage */}
          <div className="flex items-center gap-3 text-xs text-gray-400 border-t border-gray-100 pt-3">
            <span>Used: {formatBytes(stats.total)}</span>
            <span>·</span>
            <span>Expires: {formatExpiry(stats.expiryTime)}</span>
          </div>

          {/* Troubleshoot */}
          <details className="group">
            <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600 transition select-none">
              Having issues? ▸
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {cfg.routingTip && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
                  <p className="font-semibold mb-0.5">Connected but sites still blocked?</p>
                  <p>{cfg.routingTip}</p>
                </div>
              )}
              {cfg.disconnectTip && (
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
                  <p className="font-semibold mb-0.5">VPN keeps disconnecting?</p>
                  <p>{cfg.disconnectTip}</p>
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Button onClick={handleRunDiagnostics} disabled={diagRunning} variant="secondary" size="sm">
                  {diagRunning
                    ? <><RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> Testing…</>
                    : <><Activity className="w-3 h-3 mr-1.5" /> Run connection test</>}
                </Button>
                {diagResult && (
                  <div className={`rounded-xl p-3 text-xs border ${
                    diagResult.verdict === 'healthy' ? 'bg-green-50 border-green-200 text-green-800'
                    : diagResult.verdict === 'degraded' ? 'bg-amber-50 border-amber-200 text-amber-800'
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
      </CardContent>
    </Card>
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
    <main className="flex-1 max-w-2xl mx-auto px-4 sm:px-6 py-10">

      {/* Header */}
      <div className="mb-8">
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
          <div className="grid sm:grid-cols-2 gap-3 pt-2">
            <Link to="/plans" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Browse plans</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
            <Link to="/account" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Account settings</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          </div>
        )}

      </div>
    </main>
  );
}
