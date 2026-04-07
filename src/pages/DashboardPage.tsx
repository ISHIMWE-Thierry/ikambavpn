import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Power, Copy, Check, Wifi, WifiOff, Shield, Zap, Clock,
  ChevronDown, Download, RefreshCw, Activity, ExternalLink,
  ChevronRight, AlertCircle, ArrowRight,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders, getUserTrial } from '../lib/db-service';
import {
  provisionXuiAccount, getXuiStats, formatBytes, formatExpiry,
  checkVpnServerHealth, runDiagnostics,
} from '../lib/xui-api';
import type { XuiClientStat, DiagnosticResult } from '../lib/xui-api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { formatDate, formatCurrency, daysUntilExpiry, isExpired } from '../lib/utils';
import type { VpnOrder, OrderStatus, VpnTrial } from '../types';

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
  steps: string[]; disconnectTip?: string; routingTip?: string; persistTip?: string;
}> = {
  ios:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951',                              appStore: 'App Store',   steps: ['Open V2RayTun', 'Tap + → Import from clipboard', 'Tap Connect'],             disconnectTip: 'Enable On-Demand in V2RayTun Settings to stay connected in background.', routingTip: 'Tap config → Routing → Global.',          persistTip: 'iPhone Settings → VPN → tap V2RayTun → enable "Connect On Demand". VPN will auto-reconnect whenever you have internet.' },
  android: { appName: 'V2RayNG',  appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',         appStore: 'Google Play', steps: ['Open V2RayNG', 'Tap + → Import config from clipboard', 'Tap play'],           disconnectTip: 'Disable battery optimisation for V2RayNG in Android Settings.',           routingTip: '⋮ → Settings → Routing → Global.',       persistTip: 'Android Settings → Network → VPN → V2RayNG → enable "Always-on VPN". Then disable battery optimization for V2RayNG in Battery settings.' },
  mac:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951',                              appStore: 'App Store',   steps: ['Open V2RayTun', 'Click + → Import from clipboard', 'Click Connect'],          routingTip: 'Click config → Routing → Global.',        persistTip: 'V2RayTun menu bar → Preferences → General → enable "Launch at Login" and "Auto-connect on startup".' },
  windows: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],              routingTip: 'Settings → Routing → Block None.',        persistTip: 'Hiddify → Settings → General → enable "Auto-connect" and "Start on boot". VPN reconnects automatically after any interruption.' },
  linux:   { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],              routingTip: 'Settings → Routing → Block None.',        persistTip: 'Hiddify → Settings → General → enable "Auto-connect". Add Hiddify to your session autostart apps for startup persistence.' },
  unknown: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open VPN app', 'Import from clipboard', 'Connect'],                                                                                  persistTip: 'Enable "Always-on VPN" or "Auto-connect" in your VPN app settings to reconnect automatically.' },
};

function getSubUrl(email: string) {
  const base = import.meta.env.DEV ? 'http://localhost:4000' : 'https://ikambavpn.duckdns.org:4443';
  return `${base}/xui-public/sub/${encodeURIComponent(email)}`;
}

function greet(name?: string) {
  const h = new Date().getHours();
  const t = h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
  return name ? `${t}, ${name}` : t;
}

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success'|'warning'|'danger'|'muted'|'default' }> = {
    active:            { label: 'Active',       variant: 'success' },
    pending_payment:   { label: 'Pending',      variant: 'warning' },
    payment_submitted: { label: 'Under review', variant: 'success' },
    expired:           { label: 'Expired',      variant: 'danger'  },
    cancelled:         { label: 'Cancelled',    variant: 'danger'  },
  };
  const s = map[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── Animation variants ────────────────────────────────────────────────────────
const container: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.05 } },
};

const card: Variants = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } },
};

// ── Countdown hook & display ──────────────────────────────────────────────────
function useCountdown(targetEpochMs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!targetEpochMs || targetEpochMs <= 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetEpochMs]);

  if (!targetEpochMs || targetEpochMs <= 0) return null;
  const diff = Math.max(0, targetEpochMs - now);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return { days, hours, minutes, seconds, total: diff, expired: diff === 0 };
}

function CountdownDisplay({ targetEpochMs, label, variant = 'default' }: {
  targetEpochMs: number | null;
  label: string;
  variant?: 'default' | 'trial' | 'urgent';
}) {
  const cd = useCountdown(targetEpochMs);
  if (!cd) return null;

  const isUrgent = variant === 'urgent' || cd.days === 0;
  const isTrial = variant === 'trial';
  const bgClass = cd.expired
    ? 'bg-red-50 border-red-200'
    : isUrgent
    ? 'bg-amber-50 border-amber-200'
    : isTrial
    ? 'bg-blue-50 border-blue-200'
    : 'bg-gray-50 border-gray-100';
  const textClass = cd.expired
    ? 'text-red-600'
    : isUrgent
    ? 'text-amber-700'
    : isTrial
    ? 'text-blue-700'
    : 'text-gray-900';
  const labelClass = cd.expired
    ? 'text-red-400'
    : isUrgent
    ? 'text-amber-500'
    : isTrial
    ? 'text-blue-400'
    : 'text-gray-400';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-2xl border px-4 py-4 mb-4 ${bgClass}`}
    >
      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${labelClass}`}>
        {cd.expired ? '⏰ Expired' : label}
      </p>
      {cd.expired ? (
        <p className={`text-2xl font-bold ${textClass}`}>Time's up!</p>
      ) : (
        <div className="flex items-baseline gap-1">
          {cd.days > 0 && (
            <>
              <span className={`text-3xl font-bold tabular-nums ${textClass}`}>{cd.days}</span>
              <span className={`text-sm font-medium mr-2 ${labelClass}`}>d</span>
            </>
          )}
          <span className={`text-3xl font-bold tabular-nums ${textClass}`}>{String(cd.hours).padStart(2, '0')}</span>
          <span className={`text-sm font-medium ${labelClass}`}>h</span>
          <span className={`text-3xl font-bold tabular-nums ${textClass}`}>{String(cd.minutes).padStart(2, '0')}</span>
          <span className={`text-sm font-medium ${labelClass}`}>m</span>
          {cd.days === 0 && (
            <>
              <span className={`text-3xl font-bold tabular-nums ${textClass}`}>{String(cd.seconds).padStart(2, '0')}</span>
              <span className={`text-sm font-medium ${labelClass}`}>s</span>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}

function StatsCountdownCell({ expiryTime }: { expiryTime: number }) {
  const cd = useCountdown(expiryTime > 0 ? expiryTime : null);
  if (!cd) {
    return (
      <div className="bg-gray-50 rounded-2xl px-4 py-3 text-center">
        <p className="text-base font-bold text-black">∞</p>
        <p className="text-xs text-gray-400 mt-0.5">No expiry</p>
      </div>
    );
  }
  const isUrgent = cd.days <= 1;
  return (
    <div className={`rounded-2xl px-4 py-3 text-center ${
      cd.expired ? 'bg-red-50' : isUrgent ? 'bg-amber-50' : 'bg-gray-50'
    }`}>
      {cd.expired ? (
        <p className="text-base font-bold text-red-600">Expired</p>
      ) : cd.days > 0 ? (
        <p className={`text-base font-bold ${isUrgent ? 'text-amber-700' : 'text-black'}`}>
          {cd.days}d {cd.hours}h
        </p>
      ) : (
        <p className="text-base font-bold text-amber-700">
          {cd.hours}h {cd.minutes}m {cd.seconds}s
        </p>
      )}
      <p className={`text-xs mt-0.5 ${cd.expired ? 'text-red-400' : isUrgent ? 'text-amber-500' : 'text-gray-400'}`}>
        {cd.expired ? 'Plan ended' : 'Time left'}
      </p>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { firebaseUser, profile, avatarDataUrl } = useAuth();

  // VPN state
  const [activating, setActivating]   = useState(false);
  const [activated, setActivated]     = useState(false);
  const [copied, setCopied]           = useState(false);
  const [hasEverCopied, setHasEverCopied] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
  const [copiedWs, setCopiedWs]       = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(() =>
    localStorage.getItem('ws-update-dismissed') === '2',
  );
  const [activateError, setActivateError] = useState<string | null>(null);
  const [stats, setStats]             = useState<XuiClientStat | null>(null);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [diagResult, setDiagResult]   = useState<DiagnosticResult | null>(null);
  const [diagRunning, setDiagRunning] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Orders & trial state
  const [orders, setOrders]           = useState<VpnOrder[]>([]);
  const [trial, setTrial]             = useState<VpnTrial | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const device = useMemo(() => detectDevice(), []);
  const cfg = DEVICE_CONFIG[device];
  const subUrl = firebaseUser?.email ? getSubUrl(firebaseUser.email) : null;
  const isAdmin = profile?.role === 'admin';
  const initials = (profile?.firstname?.[0] ?? firebaseUser?.email?.[0] ?? '?').toUpperCase();

  const runHealth = useCallback(async () => {
    const { online } = await checkVpnServerHealth();
    setServerOnline(online);
  }, []);

  useEffect(() => {
    if (!firebaseUser?.email) return;
    getXuiStats(firebaseUser.email).then((s) => {
      setStats(s); setActivated(true);
      runHealth();
      healthRef.current = setInterval(runHealth, 60_000);
    }).catch(() => {
      // VPN backend unreachable — still try health check and mark activated
      // if user has an active order (Firestore is the source of truth for entitlement)
      runHealth();
      healthRef.current = setInterval(runHealth, 60_000);
    });
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [firebaseUser?.email, runHealth]);

  useEffect(() => {
    if (!firebaseUser) return;
    Promise.all([
      getUserOrders(firebaseUser.uid).catch(() => [] as VpnOrder[]),
      getUserTrial(firebaseUser.uid).catch(() => null),
    ]).then(([o, t]) => {
      setOrders(o); setTrial(t);
      // If user has an active order or trial in Firestore, mark as activated
      // even if VPN stats endpoint failed (backend might be temporarily down)
      const hasActive = o.some((order) => order.status === 'active');
      const hasTrial = t?.status === 'active';
      if (hasActive || hasTrial) {
        setActivated(true);
      }
    }).finally(() => setDataLoading(false));
  }, [firebaseUser]);

  const activeOrder  = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) => o.status === 'pending_payment' || o.status === 'payment_submitted');
  const historyOrders = orders.filter((o) => o.status !== 'pending_payment' && o.status !== 'payment_submitted');
  const days         = daysUntilExpiry(activeOrder?.expiresAt);
  const expired      = isExpired(activeOrder?.expiresAt);
  const activeTrial  = trial?.status === 'active';

  // User can activate/copy link only if they have active paid plan OR active trial
  const canActivate  = (!expired && !!activeOrder) || activeTrial;
  const canCopyLink  = activated && canActivate;
  const isConnected  = activated && serverOnline === true;

  // Auto-activate in background once entitlement is confirmed
  const autoActivatedRef = useRef(false);
  useEffect(() => {
    if (!dataLoading && canActivate && !activated && !activating && !autoActivatedRef.current) {
      autoActivatedRef.current = true;
      handleActivate();
    }
  }, [dataLoading, canActivate, activated, activating]);

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
    if (!subUrl || !canCopyLink) return;
    navigator.clipboard.writeText(subUrl);
    setHasEverCopied(true);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  async function copyBackup() {
    if (!firebaseUser?.email || !canCopyLink) return;
    const base = import.meta.env.DEV ? 'http://localhost:4000' : 'https://ikambavpn.duckdns.org:4443';
    try {
      const res = await fetch(`${base}/xui-public/xhttp-link/${encodeURIComponent(firebaseUser.email)}`);
      const data = await res.json();
      if (data.ok && data.link) {
        await navigator.clipboard.writeText(data.link);
        setCopiedBackup(true); setTimeout(() => setCopiedBackup(false), 3000);
      }
    } catch {}
  }

  /** Copy the new WS link — better YouTube / anti-DPI transport */
  async function copyWsLink() {
    if (!subUrl || !canCopyLink) return;
    try {
      await navigator.clipboard.writeText(subUrl);
      setCopiedWs(true);
      setHasEverCopied(true);
      setTimeout(() => setCopiedWs(false), 3000);
    } catch {}
  }

  function dismissUpdate() {
    localStorage.setItem('ws-update-dismissed', '2');
    setUpdateDismissed(true);
  }

  async function runDiag() {
    setDiagRunning(true); setDiagResult(null);
    try { const r = await runDiagnostics(); setDiagResult(r); setServerOnline(r.xrayRunning); }
    catch {} finally { setDiagRunning(false); }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="max-w-[480px] mx-auto px-4 py-6 space-y-4"
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <motion.div variants={card} className="flex items-center justify-between px-1">
          <div>
            <p className="text-gray-400 text-xs font-medium tracking-wide">{greet(profile?.firstname)}</p>
            <p className="text-gray-900 text-sm font-semibold mt-0.5 truncate max-w-[220px]">{firebaseUser?.email}</p>
          </div>
          <Link to="/account">
            <div className="w-9 h-9 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center
              text-gray-700 text-sm font-bold hover:opacity-80 transition-opacity ring-2 ring-white">
              {avatarDataUrl
                ? <img src={avatarDataUrl} alt="avatar" className="w-full h-full object-cover" />
                : initials}
            </div>
          </Link>
        </motion.div>

        {/* ── Hero connection card ─────────────────────────────────────── */}
        <motion.div
          variants={card}
          className="relative bg-white text-black rounded-3xl p-8 overflow-hidden"
        >
          {/* Concentric rings — visible when server is online */}
          <AnimatePresence>
            {isConnected && [0, 1, 2].map((i) => (
              <motion.div
                key={i}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [1, 2.6], opacity: [0.18, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[140%]
                  w-32 h-32 border border-black/20 rounded-full pointer-events-none"
              />
            ))}
          </AnimatePresence>

          {/* Status row */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2">
              <motion.div
                animate={{ scale: isConnected ? [1, 1.3, 1] : 1 }}
                transition={{ duration: 1.5, repeat: isConnected ? Infinity : 0 }}
                className={`w-2.5 h-2.5 rounded-full ${
                  isConnected ? 'bg-green-500' : serverOnline === false ? 'bg-red-400' : 'bg-gray-300'
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                {isConnected ? 'Server online' : serverOnline === false ? 'Server unavailable' : activating ? 'Setting up…' : activated ? 'Checking…' : canActivate ? 'Ready' : 'Not activated'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
              <Wifi className="w-3.5 h-3.5" />
              VLESS encrypted
            </div>
          </div>

          {/* App download buttons (always shown when user has entitlement) or orb */}
          <AnimatePresence mode="wait">
            {canActivate ? (
              <motion.div
                key="app-buttons"
                initial={{ opacity: 0, scale: 0.92, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="w-full mb-8"
              >
                <p className="text-center text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">
                  Download the app to connect
                </p>
                <div className="flex flex-col gap-2">
                  {/* Primary app for detected device */}
                  <a
                    href={cfg.appUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-black text-white rounded-2xl px-5 py-3.5
                      hover:bg-gray-800 active:scale-[0.97] transition-all duration-150"
                  >
                    {cfg.appStore === 'App Store' ? (
                      <svg className="w-6 h-6 shrink-0" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-43.3-150.3-113c-52.4-77.7-96.2-196.9-96.2-311.2 0-205.5 132.4-314.1 261.8-314.1 65.2 0 119.2 43.3 159.8 43.3 38.7 0 99.7-46.5 169.2-46.5 24.2-.2 80.3 4.4 126.7 51.5zM451.3 126.5c-25.2 29.9-67.7 52.1-108.2 52.1-1.3 0-2.6 0-3.9-.2 0-38.7 19.2-76.7 43.3-101.6 29.2-31.5 76.5-55.9 115-57.2 1 41.5-17.5 82.9-46.2 106.9z"/>
                      </svg>
                    ) : cfg.appStore === 'Google Play' ? (
                      <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3.18 23.76A2 2 0 0 1 2 22V2a2 2 0 0 1 1.18-1.76l11.51 11.76zM16.9 8.12l-2.6 2.66L5.06.34l11.84 7.78zM21.14 10.4a2 2 0 0 1 0 3.2l-2.72 1.79-2.93-3L18.42 9.6zM5.06 23.66l9.24-10.1 2.6 2.66L5.06 23.66z"/>
                      </svg>
                    ) : (
                      <Download className="w-6 h-6 shrink-0" />
                    )}
                    <div className="flex flex-col leading-none">
                      <span className="text-[10px] opacity-60 mb-0.5">
                        {cfg.appStore === 'App Store' ? 'Download on the' : cfg.appStore === 'Google Play' ? 'Get it on' : 'Download free on'}
                      </span>
                      <span className="text-sm font-semibold">{cfg.appStore === 'Download' ? 'GitHub (Hiddify)' : cfg.appStore}</span>
                    </div>
                    <ExternalLink className="w-4 h-4 ml-auto opacity-40" />
                  </a>

                  {/* Secondary app if on iOS/Mac — also offer Android option as info */}
                  {(device === 'ios' || device === 'mac') && (
                    <motion.a
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 }}
                      href="https://play.google.com/store/apps/details?id=com.v2ray.ang"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 border border-gray-100 bg-gray-50 text-gray-700
                        rounded-2xl px-5 py-3 hover:bg-gray-100 active:scale-[0.97] transition-all duration-150"
                    >
                      <svg className="w-5 h-5 shrink-0 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M3.18 23.76A2 2 0 0 1 2 22V2a2 2 0 0 1 1.18-1.76l11.51 11.76zM16.9 8.12l-2.6 2.66L5.06.34l11.84 7.78zM21.14 10.4a2 2 0 0 1 0 3.2l-2.72 1.79-2.93-3L18.42 9.6zM5.06 23.66l9.24-10.1 2.6 2.66L5.06 23.66z"/>
                      </svg>
                      <span className="text-xs text-gray-500">Also on Android — V2RayNG on Google Play</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-30" />
                    </motion.a>
                  )}
                  {device === 'android' && (
                    <motion.a
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 }}
                      href="https://apps.apple.com/app/id6476628951"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 border border-gray-100 bg-gray-50 text-gray-700
                        rounded-2xl px-5 py-3 hover:bg-gray-100 active:scale-[0.97] transition-all duration-150"
                    >
                      <svg className="w-5 h-5 shrink-0 text-gray-500" viewBox="0 0 814 1000" fill="currentColor">
                        <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-43.3-150.3-113c-52.4-77.7-96.2-196.9-96.2-311.2 0-205.5 132.4-314.1 261.8-314.1 65.2 0 119.2 43.3 159.8 43.3 38.7 0 99.7-46.5 169.2-46.5 24.2-.2 80.3 4.4 126.7 51.5zM451.3 126.5c-25.2 29.9-67.7 52.1-108.2 52.1-1.3 0-2.6 0-3.9-.2 0-38.7 19.2-76.7 43.3-101.6 29.2-31.5 76.5-55.9 115-57.2 1 41.5-17.5 82.9-46.2 106.9z"/>
                      </svg>
                      <span className="text-xs text-gray-500">Also on iPhone/Mac — V2RayTun on App Store</span>
                      <ExternalLink className="w-3.5 h-3.5 ml-auto opacity-30" />
                    </motion.a>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="orb"
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center mb-8"
              >
                <div className="w-32 h-32 rounded-full bg-gray-100 flex items-center justify-center shadow-none">
                  <Power className="w-10 h-10 text-gray-300" />
                </div>
                <p className="mt-3 text-sm text-gray-400 font-medium">No active plan</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Activation error */}
          {activateError && (
            <p className="text-red-500 text-xs text-center mb-4 bg-red-50 rounded-xl px-4 py-2">
              {activateError}
            </p>
          )}

          {/* Stats — shown post-activation */}
          <AnimatePresence>
            {activated && stats && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="grid grid-cols-2 gap-3 mb-6"
              >
                <div className="bg-gray-50 rounded-2xl px-4 py-3 text-center">
                  <p className="text-base font-bold text-black">{formatBytes(stats.total)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Data used</p>
                </div>
                <StatsCountdownCell expiryTime={stats.expiryTime} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Bottom action — only relevant actions shown */}
          {activated ? (
            <motion.button
              whileTap={canCopyLink ? { scale: 0.97 } : {}}
              onClick={copyLink}
              title={!canCopyLink ? 'You need an active plan or trial to copy your link' : undefined}
              className={`w-full rounded-full h-12 flex items-center justify-center gap-2.5
                text-sm font-semibold transition-all duration-200 ${
                copied
                  ? 'bg-green-500 text-white'
                  : canCopyLink
                  ? 'bg-black text-white hover:bg-gray-800 cursor-pointer'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {copied ? (
                <><Check className="w-4 h-4" /> Copied!</>
              ) : canCopyLink ? (
                <><Copy className="w-4 h-4" /> Copy VPN Link</>
              ) : (
                <><Shield className="w-4 h-4" /> Plan required to connect</>
              )}
            </motion.button>
          ) : canActivate ? (
            /* Has plan or trial — show activate button */
            <button
              onClick={handleActivate}
              disabled={activating}
              className="w-full rounded-full h-12 bg-black text-white text-sm font-semibold
                hover:bg-gray-800 active:scale-[0.97] transition-all duration-150
                flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {activating ? <><RefreshCw className="w-4 h-4 animate-spin" /> Activating…</> : 'Activate VPN'}
            </button>
          ) : dataLoading ? (
            /* Loading entitlement state */
            <div className="h-12 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            </div>
          ) : null /* No entitlement — plan card below has CTAs */}

          {/* Paste hint — stays visible once copied */}
          <AnimatePresence>
            {hasEverCopied && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-3 bg-gray-50 rounded-2xl px-4 py-3 text-center"
              >
                <p className="text-xs text-gray-500 leading-relaxed">
                  Link copied — open <strong className="text-black">{cfg.appName}</strong>, tap{' '}
                  <strong className="text-black">+</strong> → Import from clipboard → Connect
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ── Config update banner — shown once until user dismisses ──── */}
        {activated && canCopyLink && !updateDismissed && (
          <motion.div
            variants={card}
            className="relative bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 text-black rounded-3xl p-5 overflow-hidden"
          >
            <button
              onClick={dismissUpdate}
              className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/80 flex items-center justify-center
                text-gray-400 hover:text-gray-600 text-xs font-bold"
              aria-label="Dismiss"
            >✕</button>

            <div className="flex items-start gap-3 mb-3">
              <div className="w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center shrink-0 mt-0.5">
                <RefreshCw className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-bold text-blue-900">VPN Update Available</p>
                <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                  We upgraded your connection for better YouTube &amp; video streaming.
                  Re-import your link to switch to the faster transport.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={copyWsLink}
                className={`w-full rounded-full h-10 flex items-center justify-center gap-2
                  text-sm font-semibold transition-all duration-150 ${
                  copiedWs
                    ? 'bg-green-500 text-white'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {copiedWs
                  ? <><Check className="w-4 h-4" /> Copied — now import in {cfg.appName}</>
                  : <><Copy className="w-4 h-4" /> Copy updated VPN link</>
                }
              </button>
              <p className="text-[10px] text-blue-600 text-center leading-relaxed">
                Open {cfg.appName} → delete old config → tap <strong>+</strong> → Import from clipboard → Connect
              </p>
            </div>
          </motion.div>
        )}

        {/* ── Plan / no-plan card ──────────────────────────────────────── */}
        {!dataLoading && (
          <motion.div variants={card} className="bg-white text-black rounded-3xl p-6">

            {/* Active paid plan */}
            {activeOrder && !expired ? (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">{activeOrder.planName}</h3>
                    <p className="text-sm text-gray-500 mt-0.5">{activeOrder.planDuration}</p>
                  </div>
                  {statusBadge(activeOrder.status)}
                </div>

                <div className="space-y-2 mb-5">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Shield className="w-4 h-4 shrink-0" /> Unlimited bandwidth
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Zap className="w-4 h-4 shrink-0" /> All servers included
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Wifi className="w-4 h-4 shrink-0" /> VLESS+REALITY protocol
                  </div>
                </div>

                {activeOrder.expiresAt && (
                  <CountdownDisplay
                    targetEpochMs={new Date(activeOrder.expiresAt).getTime()}
                    label="Time remaining"
                    variant={days !== null && days <= 3 ? 'urgent' : 'default'}
                  />
                )}

                {days !== null && days <= 7 && (
                  <Link to="/plans">
                    <button className="w-full rounded-full h-10 border-2 border-black text-sm font-semibold
                      hover:bg-black hover:text-white transition-all duration-150">
                      Renew plan
                    </button>
                  </Link>
                )}
              </>
            ) : activeTrial ? (
              /* Active trial */
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">Free Trial</h3>
                    <p className="text-sm text-gray-500 mt-0.5">1-hour access</p>
                  </div>
                  <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-semibold">
                    Trial
                  </div>
                </div>

                {trial?.expiresAt && (
                  <CountdownDisplay
                    targetEpochMs={new Date(trial.expiresAt).getTime()}
                    label="Trial time remaining"
                    variant="trial"
                  />
                )}

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-3">Upgrade to keep access after your trial.</p>
                  <Link to="/plans">
                    <button className="w-full rounded-full h-10 border-2 border-black text-sm font-semibold
                      hover:bg-black hover:text-white transition-all duration-150 flex items-center
                      justify-center gap-1.5">
                      View plans <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </Link>
                </div>
              </>
            ) : (
              /* No plan at all */
              <>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">No active plan</h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {activated ? 'Activate a plan to copy your VPN link.' : 'Get started below.'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 mb-5">
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Shield className="w-4 h-4 shrink-0" /> Full VPN access
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Zap className="w-4 h-4 shrink-0" /> Works in Russia & restricted regions
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Clock className="w-4 h-4 shrink-0" /> Plans from 49 ₽ / month
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-100 space-y-2">
                  {trial?.status !== 'active' && trial?.status !== 'expired' ? (
                    /* No trial used yet */
                    <>
                      <p className="text-xs text-gray-500 mb-3">Try before you buy — no payment needed.</p>
                      <Link to="/trial">
                        <button className="w-full rounded-full h-11 bg-black text-white text-sm font-semibold
                          hover:bg-gray-800 active:scale-[0.97] transition-all duration-150
                          flex items-center justify-center gap-2">
                          <Clock className="w-4 h-4" /> Get 1-hour free trial
                        </button>
                      </Link>
                      <Link to="/plans">
                        <button className="w-full rounded-full h-10 border border-gray-200 text-sm font-medium
                          text-gray-600 hover:border-black hover:text-black transition-all duration-150
                          flex items-center justify-center gap-1.5 mt-2">
                          View plans <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </Link>
                    </>
                  ) : (
                    /* Trial used — push to paid plan */
                    <>
                      <p className="text-xs text-gray-500 mb-3">Your trial has ended. Pick a plan to continue.</p>
                      <Link to="/plans">
                        <button className="w-full rounded-full h-11 bg-black text-white text-sm font-semibold
                          hover:bg-gray-800 active:scale-[0.97] transition-all duration-150
                          flex items-center justify-center gap-2">
                          View plans <ArrowRight className="w-4 h-4" />
                        </button>
                      </Link>
                    </>
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* ── Pending orders ───────────────────────────────────────────── */}
        {pendingOrders.length > 0 && (
          <motion.div variants={card}>
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2.5 px-1">Pending</p>
            <div className="flex flex-col gap-2">
              {pendingOrders.map((o) => (
                <div key={o.id} className="bg-white rounded-2xl px-5 py-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-black">{o.planName}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(o.createdAt)}</p>
                  </div>
                  {statusBadge(o.status)}
                </div>
              ))}
              <p className="text-xs text-green-600 flex items-start gap-1.5 px-1 leading-relaxed">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Activated within a few hours after payment review.
              </p>
            </div>
          </motion.div>
        )}

        {/* ── How to connect ───────────────────────────────────────────── */}
        {activated && (
          <motion.div variants={card} className="bg-white text-black rounded-3xl overflow-hidden">
            <button
              onClick={() => setShowConnect(!showConnect)}
              className="w-full flex items-center justify-between px-6 py-5
                hover:bg-gray-50 transition-colors duration-150"
            >
              <span className="text-base font-semibold">How to connect</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showConnect ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showConnect && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-6 border-t border-gray-100 pt-4 space-y-4">
                    {[
                      { n: '1', title: 'Copy your VPN link', sub: 'Tap "Copy VPN Link" above to copy your personal link.' },
                      { n: '2', title: `Download ${cfg.appName}`, sub: null },
                      { n: '3', title: 'Import and connect', sub: cfg.steps.join(' → ') },
                      { n: '4', title: 'Enable auto-reconnect', sub: cfg.persistTip ?? null },
                    ].map(({ n, title, sub }) => (
                      <motion.div
                        key={n}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.05 * Number(n) }}
                        className="flex gap-4"
                      >
                        <div className="w-8 h-8 bg-black text-white rounded-full flex items-center
                          justify-center text-sm font-bold shrink-0">
                          {n}
                        </div>
                        <div className="flex-1 pt-0.5">
                          <p className="text-sm font-semibold">{title}</p>
                          {n === '2' ? (
                            <a href={cfg.appUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 mt-2 bg-black text-white
                                rounded-xl px-3 py-2 hover:bg-gray-800 active:scale-95
                                transition-all duration-150 select-none">
                              {cfg.appStore === 'App Store' ? (
                                <svg className="w-4 h-4 shrink-0" viewBox="0 0 814 1000" fill="currentColor">
                                  <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105-43.3-150.3-113c-52.4-77.7-96.2-196.9-96.2-311.2 0-205.5 132.4-314.1 261.8-314.1 65.2 0 119.2 43.3 159.8 43.3 38.7 0 99.7-46.5 169.2-46.5 24.2-.2 80.3 4.4 126.7 51.5z M451.3 126.5c-25.2 29.9-67.7 52.1-108.2 52.1-1.3 0-2.6 0-3.9-.2 0-38.7 19.2-76.7 43.3-101.6 29.2-31.5 76.5-55.9 115-57.2 1 41.5-17.5 82.9-46.2 106.9z"/>
                                </svg>
                              ) : cfg.appStore === 'Google Play' ? (
                                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M3.18 23.76A2 2 0 0 1 2 22V2a2 2 0 0 1 1.18-1.76l11.51 11.76zM16.9 8.12l-2.6 2.66L5.06.34l11.84 7.78zM21.14 10.4a2 2 0 0 1 0 3.2l-2.72 1.79-2.93-3L18.42 9.6zM5.06 23.66l9.24-10.1 2.6 2.66L5.06 23.66z"/>
                                </svg>
                              ) : (
                                <Download className="w-4 h-4 shrink-0" />
                              )}
                              <div className="flex flex-col leading-none">
                                <span className="text-[9px] opacity-70 mb-0.5">
                                  {cfg.appStore === 'App Store' ? 'Download on the' : cfg.appStore === 'Google Play' ? 'Get it on' : 'Download free on'}
                                </span>
                                <span className="text-xs font-semibold">{cfg.appStore}</span>
                              </div>
                            </a>
                          ) : n === '4' && sub ? (
                            <p className="text-xs text-blue-600 mt-1 leading-relaxed">{sub}</p>
                          ) : sub ? (
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{sub}</p>
                          ) : null}
                        </div>
                      </motion.div>
                    ))}
                    {cfg.routingTip && (
                      <div className="ml-12 bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
                        <p className="text-xs font-semibold text-amber-800 mb-0.5">Set routing to Global</p>
                        <p className="text-xs text-amber-700">{cfg.routingTip}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Quick nav ────────────────────────────────────────────────── */}
        <motion.div variants={card} className="grid grid-cols-2 gap-3">
          {[
            { to: '/plans',   label: 'Plans',   sub: 'from 49 ₽' },
            { to: '/account', label: 'Account', sub: 'Settings'   },
          ].map(({ to, label, sub }) => (
            <Link key={to} to={to}
              className="bg-white rounded-2xl px-4 py-4 flex items-center justify-between
                hover:bg-gray-50 transition-colors duration-150">
              <div>
                <p className="text-sm font-semibold text-black">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          ))}
        </motion.div>

        {/* ── Advanced / diagnostics ───────────────────────────────────── */}
        {activated && (
          <motion.div variants={card} className="bg-white text-black rounded-3xl overflow-hidden">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-full flex items-center justify-between px-6 py-5
                hover:bg-gray-50 transition-colors duration-150"
            >
              <span className="text-base font-semibold">Advanced settings</span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showSettings ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div className="px-6 pb-6 border-t border-gray-100 pt-5 space-y-4">
                    {/* Backup link */}
                    <div>
                      <p className="text-sm font-semibold mb-1">Blocked by your ISP?</p>
                      <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                        Copy a backup link using a different transport that bypasses most ISP blocks.
                      </p>
                      <button
                        onClick={copyBackup}
                        disabled={!canCopyLink}
                        className={`w-full rounded-full h-10 flex items-center justify-center gap-2
                          text-sm font-semibold transition-all duration-150 ${
                          !canCopyLink
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : copiedBackup
                            ? 'bg-green-500 text-white'
                            : 'bg-black text-white hover:bg-gray-800'
                        }`}
                      >
                        {copiedBackup
                          ? <><Check className="w-4 h-4" /> Copied</>
                          : <><Copy className="w-4 h-4" /> Copy backup link</>
                        }
                      </button>
                    </div>

                    {cfg.disconnectTip && (
                      <div className="bg-gray-50 rounded-2xl px-4 py-3">
                        <p className="text-xs font-semibold text-gray-700 mb-1">VPN keeps disconnecting?</p>
                        <p className="text-xs text-gray-500 leading-relaxed">{cfg.disconnectTip}</p>
                      </div>
                    )}

                    <div>
                      <Button onClick={runDiag} disabled={diagRunning} variant="secondary" size="sm" className="w-full">
                        {diagRunning
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Testing…</>
                          : <><Activity className="w-3 h-3" /> Run connection test</>}
                      </Button>
                      <AnimatePresence>
                        {diagResult && (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className={`mt-3 rounded-2xl p-3 text-xs border flex items-start gap-2 ${
                              diagResult.xrayRunning
                                ? 'bg-green-50 border-green-200 text-green-800'
                                : 'bg-red-50 border-red-200 text-red-700'
                            }`}
                          >
                            {diagResult.xrayRunning
                              ? <Wifi className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              : <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                            <div>
                              <p className="font-semibold">{diagResult.verdict}</p>
                              {diagResult.suggestion && <p className="mt-0.5 opacity-80">{diagResult.suggestion}</p>}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {isAdmin && (
                      <a href="https://194.76.217.4:2053/x7kQ9m/" target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-between border border-gray-200 rounded-2xl px-4 py-3
                          hover:border-black transition-colors">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <Shield className="w-4 h-4 text-gray-400" /> 3X-UI Panel
                        </span>
                        <ExternalLink className="w-4 h-4 text-gray-300" />
                      </a>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── Admin dashboard link ─────────────────────────────────────── */}
        {isAdmin && (
          <motion.div variants={card}>
            <Link to="/admin" className="bg-white rounded-2xl px-5 py-4 flex items-center justify-between
              hover:bg-gray-50 transition-colors">
              <span className="flex items-center gap-2.5 font-semibold text-sm text-black">
                <Shield className="w-4 h-4 text-gray-400" /> Admin Dashboard
              </span>
              <ChevronRight className="w-4 h-4 text-gray-300" />
            </Link>
          </motion.div>
        )}

        {/* ── Order history ────────────────────────────────────────────── */}
        {historyOrders.length > 0 && (
          <motion.div variants={card}>
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2.5 px-1">History</p>
            <div className="bg-white rounded-3xl overflow-hidden divide-y divide-gray-50">
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
          </motion.div>
        )}

        <div className="h-6" />
      </motion.div>
    </div>
  );
}
