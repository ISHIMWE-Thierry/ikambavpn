import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, RefreshCw, Download, Copy, Check,
  Activity, Wifi, WifiOff, ChevronDown, ExternalLink,
  Clock, ArrowRight, Zap, AlertCircle, ChevronRight,
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
  appName: string; appUrl: string; appStore: string;
  steps: string[]; disconnectTip?: string; routingTip?: string;
}> = {
  ios:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951', appStore: 'App Store', steps: ['Open V2RayTun', 'Tap + → Import from clipboard', 'Tap Connect'], disconnectTip: 'Enable On-Demand in V2RayTun Settings to stay connected in background.', routingTip: 'Tap your config → Routing → Global.' },
  android: { appName: 'V2RayNG',  appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang', appStore: 'Google Play', steps: ['Open V2RayNG', 'Tap + → Import config from clipboard', 'Tap play to connect'], disconnectTip: 'Disable battery optimisation for V2RayNG in Android Settings.', routingTip: '⋮ → Settings → Routing → Global.' },
  mac:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951', appStore: 'App Store', steps: ['Open V2RayTun', 'Click + → Import from clipboard', 'Click Connect'], routingTip: 'Click config → Routing → Global.' },
  windows: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases', appStore: 'Download', steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'], routingTip: 'Settings → Routing → Block None.' },
  linux:   { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases', appStore: 'Download', steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'], routingTip: 'Settings → Routing → Block None.' },
  unknown: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases', appStore: 'Download', steps: ['Open your VPN app', 'Import from clipboard', 'Connect'] },
};

function getSubUrl(email: string) {
  const base = import.meta.env.DEV ? 'http://localhost:4000' : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
  return `${base}/xui-public/sub/${encodeURIComponent(email)}`;
}

function greet(name?: string) {
  const h = new Date().getHours();
  const t = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return name ? `${t}, ${name}` : t;
}

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success'|'warning'|'danger'|'muted'|'default' }> = {
    active:            { label: 'Active',         variant: 'success' },
    pending_payment:   { label: 'Pending',        variant: 'warning' },
    payment_submitted: { label: 'Under review',   variant: 'muted'   },
    expired:           { label: 'Expired',        variant: 'danger'  },
    cancelled:         { label: 'Cancelled',      variant: 'danger'  },
  };
  const s = map[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── VPN Hero Orb ─────────────────────────────────────────────────────────────
interface OrbProps {
  activated: boolean;
  loading: boolean;
  serverOnline: boolean | null;
  onActivate: () => void;
}

function VpnOrb({ activated, loading, serverOnline, onActivate }: OrbProps) {
  const isOnline = activated && serverOnline === true;
  const isPending = activated && serverOnline === null;

  return (
    <div className="relative flex items-center justify-center" style={{ width: 200, height: 200 }}>
      {/* Ripple rings — only when online */}
      {isOnline && (
        <>
          <div className="orb-ring orb-ring-1" style={{ position:'absolute', inset:0, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.15)' }} />
          <div className="orb-ring orb-ring-2" style={{ position:'absolute', inset:0, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.1)' }} />
          <div className="orb-ring orb-ring-3" style={{ position:'absolute', inset:0, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.07)' }} />
        </>
      )}

      {/* Outer track */}
      <div className={`absolute inset-0 rounded-full transition-all duration-700 ${
        isOnline ? 'bg-white/5 ring-1 ring-white/20' : 'bg-white/3 ring-1 ring-white/10'
      }`} />

      {/* Button */}
      <button
        onClick={!activated ? onActivate : undefined}
        disabled={loading || activated}
        className={`relative z-10 w-28 h-28 rounded-full flex flex-col items-center justify-center
          transition-all duration-500 cursor-default
          ${!activated ? 'cursor-pointer active:scale-95' : ''}
          ${isOnline
            ? 'bg-white orb-glow'
            : isPending
            ? 'bg-white/20'
            : activated
            ? 'bg-white/30'
            : 'bg-white/10 hover:bg-white/15'
          }`}
      >
        {loading ? (
          <RefreshCw className="w-8 h-8 text-white animate-spin" />
        ) : (
          <>
            <div className={`w-10 h-10 rounded-full border-[3px] flex items-center justify-center mb-1
              transition-colors duration-500
              ${isOnline ? 'border-black' : 'border-white/60'}`}>
              <div className={`w-4 h-0.5 rounded-full mb-[-1px] transition-colors duration-500
                ${isOnline ? 'bg-black' : 'bg-white/60'}`} />
              <div className={`absolute w-1.5 h-1.5 rounded-full transition-colors duration-500
                ${isOnline ? 'bg-black' : 'bg-white/60'}`}
                style={{ marginTop: -10 }} />
            </div>
            <span className={`text-[11px] font-semibold tracking-wide transition-colors duration-500
              ${isOnline ? 'text-black' : 'text-white/70'}`}>
              {isOnline ? 'ONLINE' : isPending ? '…' : activated ? 'READY' : 'TAP'}
            </span>
          </>
        )}
      </button>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();

  // VPN state
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [stats, setStats] = useState<XuiClientStat | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [diagResult, setDiagResult] = useState<DiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Orders state
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  const device = useMemo(() => detectDevice(), []);
  const cfg = DEVICE_CONFIG[device];
  const subUrl = firebaseUser?.email ? getSubUrl(firebaseUser.email) : null;
  const isAdmin = profile?.role === 'admin';

  const runHealth = useCallback(async () => {
    const { online } = await checkVpnServerHealth();
    setServerOnline(online);
  }, []);

  // Load VPN stats + orders
  useEffect(() => {
    if (!firebaseUser?.email) return;
    getXuiStats(firebaseUser.email).then((s) => {
      setStats(s); setActivated(true);
      runHealth();
      healthRef.current = setInterval(runHealth, 60_000);
    }).catch(() => {});
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [firebaseUser?.email, runHealth]);

  useEffect(() => {
    if (!firebaseUser) return;
    getUserOrders(firebaseUser.uid).then(setOrders).catch(() => {}).finally(() => setOrdersLoading(false));
  }, [firebaseUser]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) => o.status === 'pending_payment' || o.status === 'payment_submitted');
  const historyOrders = orders.filter((o) => o.status !== 'pending_payment' && o.status !== 'payment_submitted');
  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);
  const hasPlan = !!activeOrder && !expired;

  async function handleActivate() {
    if (!firebaseUser?.email) return;
    setActivating(true); setActivateError(null);
    try {
      await provisionXuiAccount({ email: firebaseUser.email, trafficLimitGB: 0, expiryDays: 0, maxConnections: 2 });
      setActivated(true);
      runHealth();
      healthRef.current = setInterval(runHealth, 60_000);
      getXuiStats(firebaseUser.email).then(setStats).catch(() => {});
    } catch (e: any) {
      setActivateError(e.message || 'Activation failed. Try again.');
    } finally {
      setActivating(false);
    }
  }

  function copyLink() {
    if (!subUrl) return;
    navigator.clipboard.writeText(subUrl);
    setCopied(true); setTimeout(() => setCopied(false), 3000);
  }

  async function copyBackup() {
    if (!firebaseUser?.email) return;
    const base = import.meta.env.DEV ? 'http://localhost:4000' : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');
    try {
      const res = await fetch(`${base}/xui-public/xhttp-link/${encodeURIComponent(firebaseUser.email)}`);
      const data = await res.json();
      if (data.ok && data.link) {
        await navigator.clipboard.writeText(data.link);
        setCopiedBackup(true); setTimeout(() => setCopiedBackup(false), 3000);
      }
    } catch {}
  }

  async function runDiag() {
    setDiagRunning(true); setDiagResult(null);
    try { const r = await runDiagnostics(); setDiagResult(r); setServerOnline(r.xrayRunning); }
    catch {} finally { setDiagRunning(false); }
  }

  const initials = (profile?.firstname?.[0] ?? firebaseUser?.email?.[0] ?? '?').toUpperCase();

  return (
    <main className="flex-1 flex flex-col min-h-screen bg-white">

      {/* ═══════════════════════════════════════════════════════════════════
          HERO — dark full-bleed section with orb
      ════════════════════════════════════════════════════════════════════ */}
      <div className="bg-[#0c0c0c] flex flex-col items-center pb-10 pt-6 px-5 relative overflow-hidden">

        {/* Subtle background gradient blob */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full
          bg-white/[0.03] blur-3xl pointer-events-none" />

        {/* Top bar */}
        <div className="w-full max-w-sm flex items-center justify-between mb-10 relative z-10">
          <div>
            <p className="text-white/40 text-xs font-medium tracking-wide">
              {greet(profile?.firstname)}
            </p>
            <p className="text-white text-sm font-semibold mt-0.5 truncate max-w-[200px]">
              {firebaseUser?.email}
            </p>
          </div>
          <Link to="/account">
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center
              text-white text-sm font-bold hover:bg-white/15 transition-colors">
              {initials}
            </div>
          </Link>
        </div>

        {/* Server status pill */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8
          transition-all duration-500 relative z-10 ${
          serverOnline === true
            ? 'bg-green-500/15 text-green-400'
            : serverOnline === false
            ? 'bg-red-500/15 text-red-400'
            : activated
            ? 'bg-white/8 text-white/40'
            : 'bg-white/5 text-white/30'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            serverOnline === true ? 'bg-green-400 animate-pulse'
            : serverOnline === false ? 'bg-red-400'
            : 'bg-white/20'
          }`} />
          {serverOnline === true ? 'Server online'
            : serverOnline === false ? 'Server unavailable'
            : activated ? 'Checking…'
            : 'Not activated'}
        </div>

        {/* THE ORB */}
        <div className="relative z-10 mb-8">
          <VpnOrb
            activated={activated}
            loading={activating}
            serverOnline={serverOnline}
            onActivate={handleActivate}
          />
        </div>

        {/* Activation error */}
        {activateError && (
          <p className="text-red-400 text-xs text-center mb-4 max-w-xs relative z-10">{activateError}</p>
        )}

        {/* Pre-activation — show both CTAs */}
        {!activated && !activating && (
          <div className="w-full max-w-sm flex flex-col gap-3 relative z-10">
            <button
              onClick={handleActivate}
              className="w-full bg-white text-black rounded-2xl py-4 text-sm font-semibold
                hover:bg-gray-100 active:scale-[0.98] transition-all duration-150 shadow-xl shadow-black/30"
            >
              Activate VPN
            </button>
            <Link to="/trial" className="w-full">
              <button className="w-full bg-white/8 text-white/80 rounded-2xl py-3.5 text-sm font-medium
                hover:bg-white/12 active:scale-[0.98] transition-all duration-150
                border border-white/10 flex items-center justify-center gap-2">
                <Clock className="w-4 h-4" />
                Get 1-hour free trial
              </button>
            </Link>
          </div>
        )}

        {/* Loading state */}
        {activating && (
          <p className="text-white/40 text-xs text-center relative z-10">Setting up your VPN…</p>
        )}

        {/* Post-activation — copy link as main CTA */}
        {activated && (
          <div className="w-full max-w-sm flex flex-col gap-3 relative z-10">
            <button
              onClick={copyLink}
              className={`w-full rounded-2xl py-4 text-sm font-semibold flex items-center justify-center gap-2.5
                active:scale-[0.98] transition-all duration-200 shadow-xl ${
                copied
                  ? 'bg-green-500 text-white shadow-green-500/20'
                  : 'bg-white text-black shadow-black/30 hover:bg-gray-100'
              }`}
            >
              {copied
                ? <><Check className="w-4 h-4" /> Copied to clipboard</>
                : <><Copy className="w-4 h-4" /> Copy VPN Link</>
              }
            </button>

            {copied && (
              <p className="text-white/50 text-xs text-center">
                Open <span className="text-white/80 font-medium">{cfg.appName}</span> → tap + → Import from clipboard
              </p>
            )}

            {/* Usage stats */}
            {stats && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                <div className="bg-white/6 rounded-xl px-4 py-3 text-center border border-white/6">
                  <p className="text-white text-base font-bold">{formatBytes(stats.total)}</p>
                  <p className="text-white/35 text-[11px] mt-0.5">Data used</p>
                </div>
                <div className="bg-white/6 rounded-xl px-4 py-3 text-center border border-white/6">
                  <p className="text-white text-base font-bold">{formatExpiry(stats.expiryTime)}</p>
                  <p className="text-white/35 text-[11px] mt-0.5">Expires</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          WHITE BODY
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 max-w-sm mx-auto w-full px-5 py-6 flex flex-col gap-4">

        {/* ── Plan / no-plan card ─────────────────────────────────── */}
        {!ordersLoading && (
          <>
            {hasPlan ? (
              /* Active plan */
              <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plan</p>
                  {statusBadge(activeOrder!.status)}
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-lg font-bold text-black">{activeOrder!.planName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{activeOrder!.planDuration}</p>
                  </div>
                  <p className="text-lg font-bold text-black">
                    {activeOrder!.currency === 'RUB'
                      ? `${activeOrder!.amount} ₽`
                      : formatCurrency(activeOrder!.amount, activeOrder!.currency)}
                  </p>
                </div>
                {activeOrder!.expiresAt && (
                  <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${
                    expired || (days !== null && days <= 5) ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    <Clock className="w-3.5 h-3.5" />
                    {expired ? 'Plan expired' : `Expires in ${days} day${days !== 1 ? 's' : ''}`}
                  </div>
                )}
                {(expired || (days !== null && days <= 7)) && (
                  <Link to="/plans" className="block mt-4">
                    <Button size="sm" className="w-full">Renew plan</Button>
                  </Link>
                )}
              </div>
            ) : pendingOrders.length === 0 ? (
              /* No plan — upsell */
              <div className="rounded-2xl bg-[#0c0c0c] p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Zap className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">No active plan</p>
                    <p className="text-white/45 text-xs mt-0.5 leading-relaxed">
                      Start with a free hour or pick a plan from 49 ₽/month.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link to="/trial">
                    <button className="w-full bg-white text-black rounded-xl py-2.5 text-xs font-semibold
                      hover:bg-gray-100 active:scale-95 transition-all flex items-center justify-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> 1 hr free
                    </button>
                  </Link>
                  <Link to="/plans">
                    <button className="w-full bg-white/10 text-white rounded-xl py-2.5 text-xs font-semibold
                      hover:bg-white/15 active:scale-95 transition-all border border-white/10
                      flex items-center justify-center gap-1.5">
                      View plans <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </Link>
                </div>
              </div>
            ) : null}

            {/* Pending orders */}
            {pendingOrders.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5 px-0.5">Pending</p>
                <div className="flex flex-col gap-2">
                  {pendingOrders.map((o) => (
                    <div key={o.id} className="rounded-2xl border border-gray-100 bg-white px-5 py-4
                      flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-black">{o.planName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{formatDate(o.createdAt)}</p>
                      </div>
                      {statusBadge(o.status)}
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 flex items-start gap-1.5 px-0.5 leading-relaxed">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Activated within a few hours after payment review.
                  </p>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── How to connect (collapsible) ────────────────────────── */}
        {activated && (
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowConnect(!showConnect)}
              className="w-full flex items-center justify-between px-5 py-4
                hover:bg-gray-50 transition-colors duration-150"
            >
              <span className="text-sm font-semibold text-black">How to connect</span>
              <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${showConnect ? 'rotate-180' : ''}`} />
            </button>

            {showConnect && (
              <div className="px-5 pb-5 border-t border-gray-50 pt-4 flex flex-col gap-4">
                {[
                  { n: '1', title: 'Copy your VPN link', sub: 'Tap "Copy VPN Link" above to copy your personal link' },
                  { n: '2', title: `Download ${cfg.appName}`, sub: null },
                  { n: '3', title: 'Import and connect', sub: cfg.steps.join(' → ') },
                ].map(({ n, title, sub }) => (
                  <div key={n} className="flex items-start gap-3">
                    <span className="w-6 h-6 rounded-full bg-black text-white text-[11px] font-bold
                      flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-black">{title}</p>
                      {n === '2' ? (
                        <a href={cfg.appUrl} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1 text-xs text-gray-400 hover:text-black underline underline-offset-2 transition-colors">
                          <Download className="w-3 h-3" />
                          {cfg.appStore === 'Download' ? 'Download free' : `Get on ${cfg.appStore}`}
                        </a>
                      ) : sub ? (
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{sub}</p>
                      ) : null}
                    </div>
                  </div>
                ))}

                {cfg.routingTip && (
                  <div className="ml-9 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-amber-800 mb-0.5">Set routing to Global</p>
                    <p className="text-xs text-amber-700">{cfg.routingTip}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Quick nav ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <Link to="/plans" className="rounded-2xl border border-gray-100 bg-white px-4 py-4
            hover:border-gray-300 hover:bg-gray-50/60 transition-all duration-150 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-black">Plans</p>
              <p className="text-xs text-gray-400 mt-0.5">from 49 ₽</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </Link>
          <Link to="/account" className="rounded-2xl border border-gray-100 bg-white px-4 py-4
            hover:border-gray-300 hover:bg-gray-50/60 transition-all duration-150 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-black">Account</p>
              <p className="text-xs text-gray-400 mt-0.5">Settings</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </Link>
        </div>

        {/* ── Settings (collapsible) ───────────────────────────────── */}
        {activated && (
          <div className="rounded-2xl border border-gray-100 overflow-hidden">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center justify-between px-5 py-4
                hover:bg-gray-50 transition-colors duration-150"
            >
              <span className="text-sm font-semibold text-black">Advanced settings</span>
              <ChevronDown className={`w-4 h-4 text-gray-300 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            {showSettings && (
              <div className="border-t border-gray-50 flex flex-col gap-3 p-5">

                {/* Backup link */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Blocked by your ISP?</p>
                  <p className="text-xs text-gray-400 mb-3 leading-relaxed">
                    Use this backup link — different transport, bypasses most ISP blocks.
                  </p>
                  <button
                    onClick={copyBackup}
                    className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5
                      text-sm font-semibold transition-all duration-150 ${
                      copiedBackup
                        ? 'bg-green-50 border border-green-200 text-green-700'
                        : 'bg-black text-white hover:bg-gray-800'
                    }`}
                  >
                    {copiedBackup ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy backup link</>}
                  </button>
                </div>

                {/* Disconnect tip */}
                {cfg.disconnectTip && (
                  <div className="bg-gray-50 rounded-xl px-4 py-3">
                    <p className="text-xs font-semibold text-gray-600 mb-1">VPN keeps disconnecting?</p>
                    <p className="text-xs text-gray-400 leading-relaxed">{cfg.disconnectTip}</p>
                  </div>
                )}

                {/* Diagnostics */}
                <Button onClick={runDiag} disabled={diagRunning} variant="secondary" size="sm" className="w-full">
                  {diagRunning
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Testing…</>
                    : <><Activity className="w-3 h-3" /> Run connection test</>}
                </Button>
                {diagResult && (
                  <div className={`rounded-xl p-3 text-xs border flex items-start gap-2 ${
                    diagResult.xrayRunning ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'
                  }`}>
                    {diagResult.xrayRunning ? <Wifi className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    <div>
                      <p className="font-semibold">{diagResult.verdict}</p>
                      {diagResult.suggestion && <p className="mt-0.5 opacity-80">{diagResult.suggestion}</p>}
                    </div>
                  </div>
                )}

                {/* Admin */}
                {isAdmin && (
                  <a href="https://194.76.217.4:2053/x7kQ9m/" target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3
                      hover:border-black transition-colors">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Shield className="w-4 h-4 text-gray-400" /> 3X-UI Panel
                    </span>
                    <ExternalLink className="w-4 h-4 text-gray-300" />
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Admin dashboard link */}
        {isAdmin && (
          <Link to="/admin" className="rounded-2xl border border-gray-100 bg-white px-5 py-4
            hover:border-black transition-colors flex items-center justify-between">
            <span className="flex items-center gap-2.5 font-semibold text-sm">
              <Shield className="w-4 h-4 text-gray-400" /> Admin Dashboard
            </span>
            <ChevronRight className="w-4 h-4 text-gray-300" />
          </Link>
        )}

        {/* Order history */}
        {historyOrders.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5 px-0.5">History</p>
            <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden divide-y divide-gray-50">
              {historyOrders.map((o) => (
                <div key={o.id} className="px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-black">{o.planName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(o.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      {o.currency === 'RUB' ? `${o.amount} ₽` : formatCurrency(o.amount, o.currency)}
                    </span>
                    {statusBadge(o.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    </main>
  );
}
