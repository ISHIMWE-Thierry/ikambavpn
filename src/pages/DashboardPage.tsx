import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, AlertCircle, RefreshCw, ChevronRight, Download, Copy, Check,
  Activity, Wifi, WifiOff, Settings, ExternalLink, Power, Clock,
  Zap, ArrowRight,
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
    disconnectTip: 'Enable On-Demand in V2RayTun → Settings to stay connected in background.',
    routingTip: 'Tap your config → Routing → select Global.',
  },
  android: {
    appName: 'V2RayNG',
    appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
    appStore: 'Google Play',
    steps: ['Open V2RayNG', 'Tap + → Import config from clipboard', 'Tap play to connect'],
    disconnectTip: 'Disable battery optimisation for V2RayNG in Android Settings.',
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSubUrl(email: string): string {
  const base = import.meta.env.DEV
    ? 'http://localhost:4000'
    : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
  return `${base}/xui-public/sub/${encodeURIComponent(email)}`;
}

function greet(name?: string): string {
  const h = new Date().getHours();
  const time = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${time}, ${name}` : time;
}

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'default' }> = {
    active:            { label: 'Active',         variant: 'success' },
    pending_payment:   { label: 'Pending payment', variant: 'warning' },
    payment_submitted: { label: 'Under review',   variant: 'muted'   },
    expired:           { label: 'Expired',        variant: 'danger'  },
    cancelled:         { label: 'Cancelled',      variant: 'danger'  },
  };
  const s = map[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── No-plan urge banner ───────────────────────────────────────────────────────

function NoPlanBanner() {
  return (
    <div
      className="rounded-2xl border border-black/8 bg-gradient-to-br from-gray-900 to-black
        p-6 text-white anim-up"
      style={{ animationDelay: '200ms' }}
    >
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white">No active plan</p>
          <p className="text-sm text-white/60 mt-0.5 leading-relaxed">
            Your VPN is set up. Add a plan to unlock full access.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Link to="/trial" className="flex-1">
              <button className="w-full flex items-center justify-center gap-2 bg-white text-black
                rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-gray-100
                transition-colors duration-150">
                <Clock className="w-4 h-4" />
                1-hour free trial
              </button>
            </Link>
            <Link to="/plans" className="flex-1">
              <button className="w-full flex items-center justify-center gap-2 bg-white/10 text-white
                rounded-xl px-4 py-2.5 text-sm font-semibold hover:bg-white/20
                transition-colors duration-150 border border-white/10">
                View plans
                <ArrowRight className="w-4 h-4" />
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── VPN Connect Card ──────────────────────────────────────────────────────────

interface VpnCardProps {
  hasActivePlan: boolean;
}

function VpnCard({ hasActivePlan }: VpnCardProps) {
  const { firebaseUser, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
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
    }).catch(() => {});
    return () => { if (healthInterval.current) clearInterval(healthInterval.current); };
  }, [firebaseUser?.email, runHealthCheck]);

  async function handleActivate() {
    if (!firebaseUser?.email) return;
    setLoading(true);
    setError(null);
    try {
      await provisionXuiAccount({ email: firebaseUser.email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 });
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

  async function copyBackupLink() {
    if (!firebaseUser?.email) return;
    const base = import.meta.env.DEV
      ? 'http://localhost:4000'
      : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
    try {
      const res = await fetch(`${base}/xui-public/xhttp-link/${encodeURIComponent(firebaseUser.email)}`);
      const data = await res.json();
      if (data.ok && data.link) {
        await navigator.clipboard.writeText(data.link);
        setCopiedBackup(true);
        setTimeout(() => setCopiedBackup(false), 3000);
      }
    } catch { /* silently fail */ }
  }

  // ── Pre-activation ────────────────────────────────────────────────────────
  if (!activated) {
    return (
      <div
        className="rounded-2xl border border-gray-100 bg-white p-7 flex flex-col items-center
          text-center gap-6 shadow-sm anim-scale"
        style={{ animationDelay: '120ms' }}
      >
        {/* Animated shield */}
        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-black/5 animate-ping" style={{ animationDuration: '2.4s' }} />
          <div className="w-20 h-20 rounded-full bg-black flex items-center justify-center relative z-10">
            <Power className="w-8 h-8 text-white" />
          </div>
        </div>

        <div>
          <h2 className="text-xl font-bold text-black">Activate your VPN</h2>
          <p className="text-sm text-gray-400 mt-1.5 leading-relaxed max-w-xs">
            One tap to generate your personal VPN link. Works with any V2Ray app.
          </p>
        </div>

        {error && (
          <div className="w-full bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <Button onClick={handleActivate} disabled={loading} size="lg" className="w-full max-w-xs">
          {loading
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Activating…</>
            : 'Activate VPN'}
        </Button>

        {/* App download */}
        <a
          href={cfg.appUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 border border-gray-100 rounded-xl px-4 py-3
            hover:border-gray-300 hover:bg-gray-50 transition-all duration-150 w-full max-w-xs"
        >
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
            <Download className="w-4 h-4 text-gray-600" />
          </div>
          <div className="text-left flex-1">
            <p className="text-sm font-semibold text-black">{cfg.appName}</p>
            <p className="text-xs text-gray-400">{cfg.appStore}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-300" />
        </a>
      </div>
    );
  }

  // ── Activated ─────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">

      {/* Main VPN hero card */}
      <div
        className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm anim-scale"
        style={{ animationDelay: '120ms' }}
      >
        {/* Status bar */}
        <div className={`px-5 py-2.5 flex items-center justify-between text-xs font-medium transition-colors ${
          serverOnline === true
            ? 'bg-green-50 text-green-700 border-b border-green-100'
            : serverOnline === false
            ? 'bg-red-50 text-red-600 border-b border-red-100'
            : 'bg-gray-50 text-gray-400 border-b border-gray-100'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`relative w-2 h-2 rounded-full shrink-0 ${
              serverOnline === true ? 'bg-green-500' : serverOnline === false ? 'bg-red-500' : 'bg-gray-300'
            }`}>
              {serverOnline === true && (
                <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75" />
              )}
            </span>
            {serverOnline === null ? 'Checking server…' : serverOnline ? 'Server online' : 'Server may be unavailable'}
          </div>
          {serverOnline === false && (
            <button
              onClick={runHealthCheck}
              disabled={healthChecking}
              className="underline disabled:opacity-50"
            >
              {healthChecking ? 'Checking…' : 'Retry'}
            </button>
          )}
        </div>

        <div className="p-6 flex flex-col items-center gap-5">
          {/* Copy link — primary action */}
          <button
            onClick={copyLink}
            className={`relative w-full rounded-2xl px-6 py-5 flex items-center justify-center gap-3
              font-semibold text-base transition-all duration-200 active:scale-[0.97] ${
              copied
                ? 'bg-green-50 border-2 border-green-300 text-green-700'
                : 'bg-black text-white hover:bg-gray-800 shadow-lg shadow-black/10'
            }`}
          >
            {copied
              ? <><Check className="w-5 h-5" /> Copied to clipboard</>
              : <><Copy className="w-5 h-5" /> Copy VPN Link</>
            }
          </button>

          {/* Paste instruction */}
          <p className={`text-xs text-center transition-all duration-300 ${
            copied ? 'text-green-600 font-medium' : 'text-gray-400'
          }`}>
            {copied
              ? `Open ${cfg.appName} and import from clipboard`
              : 'Paste the link into your VPN app to connect'
            }
          </p>

          {/* Usage stats — if available */}
          {stats && (
            <div className="w-full grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                <p className="text-base font-bold text-black">{formatBytes(stats.total)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Used</p>
              </div>
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-center">
                <p className="text-base font-bold text-black">{formatExpiry(stats.expiryTime)}</p>
                <p className="text-xs text-gray-400 mt-0.5">Expires</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* How to connect */}
      <div
        className="rounded-2xl border border-gray-100 bg-white overflow-hidden anim-up"
        style={{ animationDelay: '200ms' }}
      >
        <div className="px-5 pt-5 pb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            How to connect
          </p>
          <div className="flex flex-col gap-4">
            {/* Step 1 */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold
                flex items-center justify-center shrink-0 mt-0.5">1</span>
              <div>
                <p className="text-sm font-medium text-black">Copy your VPN link above</p>
                <p className="text-xs text-gray-400 mt-0.5">Your personal VLESS link is unique to your account</p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold
                flex items-center justify-center shrink-0 mt-0.5">2</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-black">Download {cfg.appName}</p>
                <a
                  href={cfg.appUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500
                    hover:text-black transition-colors underline underline-offset-2"
                >
                  <Download className="w-3 h-3" />
                  {cfg.appStore === 'Download' ? 'Download for free' : `Get on ${cfg.appStore}`}
                </a>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold
                flex items-center justify-center shrink-0 mt-0.5">3</span>
              <div>
                <p className="text-sm font-medium text-black">Import and connect</p>
                <ol className="mt-1.5 flex flex-col gap-0.5">
                  {cfg.steps.map((step, i) => (
                    <li key={i} className="text-xs text-gray-400">{step}</li>
                  ))}
                </ol>
              </div>
            </div>

            {/* Routing tip */}
            {cfg.routingTip && (
              <div className="ml-9 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <p className="text-xs font-semibold text-amber-800 mb-0.5">Set routing to Global</p>
                <p className="text-xs text-amber-700">{cfg.routingTip}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings & diagnostics (collapsible) */}
      <button
        onClick={() => setShowSettings(!showSettings)}
        className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white
          px-5 py-4 hover:border-gray-300 hover:bg-gray-50/50 transition-all duration-150"
      >
        <span className="flex items-center gap-2.5 font-medium text-sm text-gray-600">
          <Settings className="w-4 h-4 text-gray-400" />
          Settings & diagnostics
        </span>
        <ChevronRight className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${showSettings ? 'rotate-90' : ''}`} />
      </button>

      {showSettings && (
        <div className="flex flex-col gap-3 anim-up" style={{ animationDelay: '0ms' }}>

          {/* Backup link */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Blocked by your ISP?
            </p>
            <p className="text-xs text-gray-500 mb-3 leading-relaxed">
              Copy your backup link — it uses a different transport that bypasses most ISP blocks.
            </p>
            <button
              onClick={copyBackupLink}
              className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5
                text-sm font-semibold transition-all duration-150 ${
                copiedBackup
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-black text-white hover:bg-gray-800'
              }`}
            >
              {copiedBackup
                ? <><Check className="w-4 h-4" /> Copied</>
                : <><Copy className="w-4 h-4" /> Copy backup link</>
              }
            </button>
            {copiedBackup && (
              <p className="text-xs text-center text-green-600 mt-2">
                Open {cfg.appName} → + → Import from clipboard
              </p>
            )}
          </div>

          {/* Disconnect tip */}
          {cfg.disconnectTip && (
            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
              <p className="text-xs font-semibold text-gray-600 mb-1">VPN keeps disconnecting?</p>
              <p className="text-xs text-gray-400 leading-relaxed">{cfg.disconnectTip}</p>
            </div>
          )}

          {/* Connection test */}
          <div className="rounded-2xl border border-gray-100 bg-white p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Connection test
            </p>
            <Button
              onClick={handleRunDiagnostics}
              disabled={diagRunning}
              variant="secondary"
              size="sm"
              className="w-full"
            >
              {diagRunning
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Running test…</>
                : <><Activity className="w-3 h-3" /> Run test</>
              }
            </Button>
            {diagResult && (
              <div className={`mt-3 rounded-xl p-3 text-xs border flex items-start gap-2 ${
                diagResult.xrayRunning
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}>
                {diagResult.xrayRunning
                  ? <Wifi className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  : <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                }
                <div>
                  <p className="font-semibold">{diagResult.verdict}</p>
                  {diagResult.suggestion && <p className="mt-0.5 opacity-80">{diagResult.suggestion}</p>}
                </div>
              </div>
            )}
          </div>

          {/* Admin link */}
          {isAdmin && (
            <a
              href="https://194.76.217.4:2053/x7kQ9m/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white
                px-5 py-4 hover:border-black transition-colors duration-150"
            >
              <span className="flex items-center gap-2.5 font-medium text-sm">
                <Shield className="w-4 h-4 text-gray-400" />
                3X-UI Control Panel
              </span>
              <ExternalLink className="w-4 h-4 text-gray-300" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    if (!firebaseUser) return;
    setOrdersLoading(true);
    getUserOrders(firebaseUser.uid)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, [firebaseUser]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter(
    (o) => o.status === 'pending_payment' || o.status === 'payment_submitted',
  );
  const historyOrders = orders.filter(
    (o) => o.status !== 'pending_payment' && o.status !== 'payment_submitted',
  );
  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);
  const hasActivePlan = !!activeOrder && !expired;

  return (
    <main className="flex-1 max-w-lg mx-auto px-4 sm:px-6 py-8">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-7 anim-up" style={{ animationDelay: '0ms' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-black flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">
              {profile?.firstname?.[0]?.toUpperCase() ?? firebaseUser?.email?.[0]?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-black leading-tight">
              {greet(profile?.firstname)}
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">{firebaseUser?.email}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">

        {/* ── VPN control card ────────────────────────────────────────── */}
        <VpnCard hasActivePlan={hasActivePlan} />

        {/* ── No plan — urge to get one ────────────────────────────── */}
        {!ordersLoading && !activeOrder && pendingOrders.length === 0 && (
          <NoPlanBanner />
        )}

        {/* ── Active plan card ─────────────────────────────────────── */}
        {activeOrder && (
          <div
            className="rounded-2xl border border-gray-100 bg-white overflow-hidden shadow-sm anim-up"
            style={{ animationDelay: '280ms' }}
          >
            <div className="px-5 pt-5 pb-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  Current plan
                </p>
                {statusBadge(activeOrder.status)}
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-black text-lg leading-tight">{activeOrder.planName}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{activeOrder.planDuration}</p>
                </div>
                <p className="text-lg font-bold text-black shrink-0">
                  {activeOrder.currency === 'RUB'
                    ? `${activeOrder.amount} ₽`
                    : formatCurrency(activeOrder.amount, activeOrder.currency)
                  }
                </p>
              </div>

              {activeOrder.expiresAt && (
                <div className={`mt-4 flex items-center gap-2 text-xs font-medium ${
                  expired || (days !== null && days <= 5) ? 'text-red-500' : 'text-gray-400'
                }`}>
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  {expired ? 'Plan expired' : `Expires in ${days} day${days !== 1 ? 's' : ''}`}
                </div>
              )}

              {(expired || (days !== null && days <= 7)) && (
                <div className="mt-4">
                  <Link to="/plans">
                    <Button size="sm" className="w-full">
                      Renew plan
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Pending orders ───────────────────────────────────────── */}
        {pendingOrders.length > 0 && (
          <div className="anim-up" style={{ animationDelay: '300ms' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
              Pending orders
            </p>
            <div className="flex flex-col gap-2">
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-2xl border border-gray-100 bg-white px-5 py-4
                    flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-black">{order.planName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.createdAt)}</p>
                  </div>
                  {statusBadge(order.status)}
                </div>
              ))}
              <p className="text-xs text-gray-400 flex items-start gap-1.5 px-1 pt-1 leading-relaxed">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Orders are typically activated within a few hours after payment review.
              </p>
            </div>
          </div>
        )}

        {/* ── Quick nav ────────────────────────────────────────────── */}
        {!ordersLoading && (
          <div className="grid grid-cols-2 gap-3 anim-up" style={{ animationDelay: '340ms' }}>
            <Link
              to="/plans"
              className="flex items-center justify-between rounded-2xl border border-gray-100
                bg-white px-4 py-4 hover:border-gray-300 hover:bg-gray-50/60
                transition-all duration-150"
            >
              <div>
                <p className="text-sm font-semibold text-black">Plans</p>
                <p className="text-xs text-gray-400 mt-0.5">49–99 ₽/mo</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
            <Link
              to="/account"
              className="flex items-center justify-between rounded-2xl border border-gray-100
                bg-white px-4 py-4 hover:border-gray-300 hover:bg-gray-50/60
                transition-all duration-150"
            >
              <div>
                <p className="text-sm font-semibold text-black">Account</p>
                <p className="text-xs text-gray-400 mt-0.5">Settings</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </div>
        )}

        {/* ── Admin link ───────────────────────────────────────────── */}
        {isAdmin && !ordersLoading && (
          <Link
            to="/admin"
            className="flex items-center justify-between rounded-2xl border border-gray-100
              bg-white px-5 py-4 hover:border-black transition-colors duration-150
              anim-up"
            style={{ animationDelay: '380ms' }}
          >
            <span className="flex items-center gap-2.5 font-semibold text-sm">
              <Shield className="w-4 h-4 text-gray-400" />
              Admin Dashboard
            </span>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </Link>
        )}

        {/* ── Order history ────────────────────────────────────────── */}
        {historyOrders.length > 0 && (
          <div className="anim-up" style={{ animationDelay: '400ms' }}>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 px-1">
              Order history
            </p>
            <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
              {historyOrders.map((order) => (
                <div key={order.id} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-black">{order.planName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(order.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      {order.currency === 'RUB'
                        ? `${order.amount} ₽`
                        : formatCurrency(order.amount, order.currency)
                      }
                    </span>
                    {statusBadge(order.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </main>
  );
}
