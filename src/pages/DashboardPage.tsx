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
  steps: string[]; disconnectTip?: string; routingTip?: string;
}> = {
  ios:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951',                              appStore: 'App Store',   steps: ['Open V2RayTun', 'Tap + → Import from clipboard', 'Tap Connect'],             disconnectTip: 'Enable On-Demand in V2RayTun Settings to stay connected in background.', routingTip: 'Tap config → Routing → Global.' },
  android: { appName: 'V2RayNG',  appUrl: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',         appStore: 'Google Play', steps: ['Open V2RayNG', 'Tap + → Import config from clipboard', 'Tap play'],           disconnectTip: 'Disable battery optimisation for V2RayNG in Android Settings.',           routingTip: '⋮ → Settings → Routing → Global.' },
  mac:     { appName: 'V2RayTun', appUrl: 'https://apps.apple.com/app/id6476628951',                              appStore: 'App Store',   steps: ['Open V2RayTun', 'Click + → Import from clipboard', 'Click Connect'],          routingTip: 'Click config → Routing → Global.' },
  windows: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],              routingTip: 'Settings → Routing → Block None.' },
  linux:   { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open Hiddify', 'Click + → Add from clipboard', 'Click Connect'],              routingTip: 'Settings → Routing → Block None.' },
  unknown: { appName: 'Hiddify',  appUrl: 'https://github.com/hiddify/hiddify-app/releases',                     appStore: 'Download',    steps: ['Open VPN app', 'Import from clipboard', 'Connect'] },
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

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();

  // VPN state
  const [activating, setActivating]   = useState(false);
  const [activated, setActivated]     = useState(false);
  const [copied, setCopied]           = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);
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
    }).catch(() => {});
    return () => { if (healthRef.current) clearInterval(healthRef.current); };
  }, [firebaseUser?.email, runHealth]);

  useEffect(() => {
    if (!firebaseUser) return;
    Promise.all([
      getUserOrders(firebaseUser.uid).catch(() => [] as VpnOrder[]),
      getUserTrial(firebaseUser.uid).catch(() => null),
    ]).then(([o, t]) => {
      setOrders(o); setTrial(t);
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
    setCopied(true); setTimeout(() => setCopied(false), 3000);
  }

  async function copyBackup() {
    if (!firebaseUser?.email || !canCopyLink) return;
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
            <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center
              text-gray-700 text-sm font-bold hover:bg-gray-300 transition-colors">
              {initials}
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
                {isConnected ? 'Server online' : serverOnline === false ? 'Server unavailable' : activated ? 'Checking…' : 'Not activated'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-400 font-medium">
              <Wifi className="w-3.5 h-3.5" />
              VLESS+REALITY
            </div>
          </div>

          {/* Power orb */}
          <div className="flex flex-col items-center mb-8">
            <motion.button
              whileHover={!activated && canActivate ? { scale: 1.04 } : {}}
              whileTap={!activated && canActivate ? { scale: 0.96 } : {}}
              onClick={!activated && !activating && canActivate ? handleActivate : undefined}
              className={`relative w-32 h-32 rounded-full flex items-center justify-center
                shadow-2xl transition-all duration-500 ${
                activated && !activating
                  ? isConnected
                    ? 'bg-black shadow-black/30 cursor-default'
                    : 'bg-gray-800 shadow-gray-800/20 cursor-default'
                  : activating
                  ? 'bg-gray-200 cursor-default'
                  : canActivate
                  ? 'bg-gray-900 cursor-pointer hover:bg-black shadow-gray-900/40'
                  : 'bg-gray-200 cursor-default shadow-none'
              }`}
            >
              {activating ? (
                <RefreshCw className="w-10 h-10 text-white animate-spin" />
              ) : (
                <Power className={`w-10 h-10 transition-colors duration-500 ${
                  activated ? 'text-white' : canActivate ? 'text-white/70' : 'text-gray-400'
                }`} />
              )}
            </motion.button>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="mt-3 text-sm text-gray-500 font-medium"
            >
              {activating ? 'Activating…' : activated ? (isConnected ? 'Connected' : 'Ready') : canActivate ? 'Tap to activate' : 'No active plan'}
            </motion.p>
          </div>

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
                <div className="bg-gray-50 rounded-2xl px-4 py-3 text-center">
                  <p className="text-base font-bold text-black">{formatExpiry(stats.expiryTime)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Expires</p>
                </div>
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

          {/* Paste hint */}
          <AnimatePresence>
            {copied && (
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center text-xs text-gray-500 mt-3"
              >
                Open <strong>{cfg.appName}</strong> → tap + → Import from clipboard
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>

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
                  <div className={`flex items-center gap-1.5 text-xs font-medium mb-4 ${
                    days !== null && days <= 5 ? 'text-red-500' : 'text-gray-400'
                  }`}>
                    <Clock className="w-3.5 h-3.5" />
                    {`Expires in ${days} day${days !== 1 ? 's' : ''}`}
                  </div>
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
                              className="inline-flex items-center gap-1 mt-1 text-xs text-gray-500
                                hover:text-black underline underline-offset-2 transition-colors">
                              <Download className="w-3 h-3" />
                              {cfg.appStore === 'Download' ? 'Download free' : `Get on ${cfg.appStore}`}
                            </a>
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
