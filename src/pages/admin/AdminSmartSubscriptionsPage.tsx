import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Send, Mail, Smartphone, AlertTriangle, CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import { auth } from '../../lib/firebase';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4000'
  : 'https://ikambavpn.duckdns.org:4443';

interface DeviceItem {
  deviceId: string;
  model: string;
  name: string;
  osVersion: string;
  appVersion: string;
  lastSeenISO: string;
}

interface SubscriptionRow {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  planId: string;
  planName: string;
  planDuration: string;
  amount: number;
  currency: string;
  status: string;
  expiresAt: string | null;
  daysLeft: number | null;
  emailMatchesProfile: boolean;
  profileEmail: string | null;
  devices: { count: number; items: DeviceItem[] };
  lastReminder: {
    sentAt: string;
    daysLeftBucket: number;
    confirmationUrl: string;
    linkExpiresAt: string;
  } | null;
}

async function authedFetch(path: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

function formatPrice(amount: number, currency: string) {
  if (currency === 'RUB') return `${amount.toFixed(2)} ₽`;
  if (currency === 'USD') return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${currency}`;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function daysBadge(days: number | null) {
  if (days === null) return <span className="text-gray-400">—</span>;
  let cls = 'bg-gray-100 text-gray-700';
  if (days <= 0) cls = 'bg-red-100 text-red-700';
  else if (days <= 1) cls = 'bg-red-50 text-red-600';
  else if (days <= 3) cls = 'bg-orange-100 text-orange-700';
  else if (days <= 5) cls = 'bg-yellow-100 text-yellow-700';
  else cls = 'bg-emerald-50 text-emerald-700';
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function AdminSmartSubscriptionsPage() {
  const [items, setItems] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [withinDays, setWithinDays] = useState(14);
  const [syncing, setSyncing] = useState(false);

  async function load(within = withinDays) {
    setLoading(true);
    try {
      const data = await authedFetch(
        `/admin/subscriptions?status=active&within=${within}`
      );
      setItems(data.items || []);
    } catch (err) {
      toast.error(`Failed to load: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan() {
    setScanning(true);
    try {
      const res = await authedFetch('/admin/subscriptions/scan', {
        method: 'POST',
      });
      const s = res.summary || {};
      toast.success(
        `Scanned ${s.scanned} · sent ${s.sent} · skipped ${s.skipped} · errors ${s.errors}`
      );
      await load();
    } catch (err) {
      toast.error(`Scan failed: ${(err as Error).message}`);
    } finally {
      setScanning(false);
    }
  }

  async function syncFromXui() {
    setSyncing(true);
    try {
      const res = await authedFetch('/admin/subscriptions/sync-from-xui', {
        method: 'POST',
        body: JSON.stringify({ thresholdHours: 24 }),
      });
      toast.success(
        `X-UI sync · updated ${res.updated} · skipped ${res.skipped} · errors ${res.errored}`
      );
      await load();
    } catch (err) {
      toast.error(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function sendRenewal(orderId: string, force = false) {
    setSendingFor(orderId);
    try {
      const res = await authedFetch(
        `/admin/subscriptions/${encodeURIComponent(orderId)}/send-renewal`,
        {
          method: 'POST',
          body: JSON.stringify({ force }),
        }
      );
      const r = res.result;
      if (r.kind === 'sent') toast.success(`Email sent (bucket ${r.bucket}d)`);
      else if (r.kind === 'skip') toast(`Skipped: ${r.reason}`, { icon: 'ℹ️' });
      else toast.error(`Error: ${r.message}`);
      await load();
    } catch (err) {
      toast.error(`Send failed: ${(err as Error).message}`);
    } finally {
      setSendingFor(null);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Quick stats
  const expiringSoon = items.filter((i) => i.daysLeft !== null && i.daysLeft <= 5).length;
  const emailMismatches = items.filter((i) => !i.emailMatchesProfile).length;
  const totalDevices = items.reduce((s, i) => s + i.devices.count, 0);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center gap-4 mb-6">
          <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-xl">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Smart Subscriptions</h1>
            <p className="text-sm text-gray-500">
              Auto-renewal reminders · device tracking · email integrity
            </p>
          </div>
          <Button
            onClick={syncFromXui}
            disabled={syncing}
            variant="secondary"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync from x-ui'}
          </Button>
          <Button
            onClick={runScan}
            disabled={scanning}
            className="bg-black text-white"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
            {scanning ? 'Scanning…' : 'Run scan now'}
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatBox icon={Clock} label="Expiring ≤5d" value={expiringSoon} tone="orange" />
          <StatBox icon={AlertTriangle} label="Email mismatches" value={emailMismatches} tone="red" />
          <StatBox icon={Smartphone} label="Total devices" value={totalDevices} tone="gray" />
          <StatBox icon={Mail} label="Subscriptions tracked" value={items.length} tone="green" />
        </div>

        {/* Filter */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <span className="text-gray-500">Show subs expiring within:</span>
          {[5, 14, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => {
                setWithinDays(d);
                load(d);
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                withinDays === d
                  ? 'bg-black text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>

        <Card>
          <CardHeader>
            <h2 className="font-semibold">Active subscriptions</h2>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 text-center text-sm text-gray-500">Loading…</div>
            ) : items.length === 0 ? (
              <div className="p-8 text-center text-sm text-gray-500">
                No subscriptions match the filter.
              </div>
            ) : (
              <div className="divide-y">
                {items.map((row) => {
                  const isOpen = expanded.has(row.id);
                  return (
                    <div key={row.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => toggle(row.id)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">
                              {row.userEmail || '(no email)'}
                            </span>
                            {row.emailMatchesProfile ? (
                              <CheckCircle2
                                className="w-4 h-4 text-emerald-600 shrink-0"
                                aria-label="Email matches profile"
                              />
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-xs text-red-600"
                                title={`Profile email: ${row.profileEmail || 'none'}`}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                                mismatch
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5 truncate">
                            {row.planName} · {row.planDuration} ·{' '}
                            {formatPrice(row.amount, row.currency)} · expires{' '}
                            {formatDate(row.expiresAt)}
                          </div>
                        </button>

                        <div className="flex items-center gap-2 shrink-0">
                          {daysBadge(row.daysLeft)}
                          <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                            <Smartphone className="w-3.5 h-3.5" />
                            {row.devices.count}
                          </span>
                          <Button
                            onClick={() => sendRenewal(row.id, false)}
                            disabled={sendingFor === row.id}
                            className="!py-1.5 !px-3 text-xs bg-black text-white"
                          >
                            <Send className="w-3.5 h-3.5 mr-1" />
                            {sendingFor === row.id ? '…' : 'Send'}
                          </Button>
                        </div>
                      </div>

                      {isOpen && (
                        <div className="mt-3 pl-2 border-l-2 border-gray-100 space-y-3 text-sm">
                          {!row.emailMatchesProfile && (
                            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-xs text-red-700">
                              <strong>Email mismatch.</strong> Order email:{' '}
                              <code>{row.userEmail || '(empty)'}</code>. Profile
                              email: <code>{row.profileEmail || '(empty)'}</code>.
                            </div>
                          )}

                          <div>
                            <div className="text-xs font-semibold text-gray-700 mb-1">
                              Devices ({row.devices.count})
                            </div>
                            {row.devices.items.length === 0 ? (
                              <div className="text-xs text-gray-400">
                                No heartbeats in last 30 days.
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {row.devices.items.map((d) => (
                                  <div
                                    key={d.deviceId}
                                    className="text-xs bg-gray-50 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-0.5"
                                  >
                                    <span className="font-mono text-gray-500">
                                      {d.deviceId.slice(0, 12)}…
                                    </span>
                                    <span className="font-medium">{d.model || 'unknown model'}</span>
                                    {d.name && d.name !== d.model && (
                                      <span className="text-gray-600">"{d.name}"</span>
                                    )}
                                    {d.osVersion && (
                                      <span className="text-gray-500">iOS {d.osVersion}</span>
                                    )}
                                    {d.appVersion && (
                                      <span className="text-gray-500">app {d.appVersion}</span>
                                    )}
                                    <span className="text-gray-400 ml-auto">
                                      seen {formatDate(d.lastSeenISO)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {row.lastReminder ? (
                            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
                              <div className="font-semibold text-blue-900 mb-1">
                                Last reminder sent
                              </div>
                              <div className="text-blue-800 space-y-0.5">
                                <div>At: {formatDate(row.lastReminder.sentAt)}</div>
                                <div>Bucket: {row.lastReminder.daysLeftBucket}d</div>
                                <div>
                                  Link expires:{' '}
                                  {formatDate(row.lastReminder.linkExpiresAt)}
                                </div>
                                <a
                                  href={row.lastReminder.confirmationUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-700 underline"
                                >
                                  Open YooKassa link <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              <button
                                onClick={() => sendRenewal(row.id, true)}
                                disabled={sendingFor === row.id}
                                className="mt-2 text-xs underline text-blue-900"
                              >
                                Force-resend (clears reminder history)
                              </button>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400">
                              No reminder sent yet for this order.
                            </div>
                          )}

                          <div className="text-xs text-gray-400">
                            Order ID: <code>{row.id}</code> · User ID:{' '}
                            <code>{row.userId}</code>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-gray-400 mt-4">
          Reminders go out automatically every 6 hours. Anti-spam: at most one
          email per (order, bucket) where buckets are 5d / 3d / 1d / 0d.
          Payment links use YooKassa with their own expiration timestamps.
        </p>
      </div>
    </div>
  );
}

function StatBox({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  tone: 'orange' | 'red' | 'gray' | 'green';
}) {
  const toneCls = {
    orange: 'bg-orange-50 text-orange-700',
    red: 'bg-red-50 text-red-700',
    gray: 'bg-gray-50 text-gray-700',
    green: 'bg-emerald-50 text-emerald-700',
  }[tone];
  return (
    <div className="border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${toneCls}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <div>
        <div className="text-xl font-bold leading-none">{value}</div>
        <div className="text-[11px] text-gray-500 mt-1">{label}</div>
      </div>
    </div>
  );
}
