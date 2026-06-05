import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Users,
  CreditCard,
  AlertTriangle,
  Search,
  Eye,
  EyeOff,
  Copy,
  Activity,
  Wifi,
  WifiOff,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { auth } from '../../lib/firebase';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4000'
  : 'https://ikambavpn.duckdns.org:4443';

// ── Types matching backend /admin/customers ──────────────────────────────────
interface ConfigRow {
  inboundId: number;
  inboundRemark: string;
  inboundPort: number;
  kind: string;
  email: string;
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
}

interface CustomerRow {
  email: string;
  configs: ConfigRow[];
  configCount: number;
  anyEnabled: boolean;
  allEnabled: boolean;
  earliestExpiry: number | null;
  latestExpiry: number | null;
  totalUsageBytes: number;
  status: 'expired' | 'disabled' | 'active' | 'never_expires';
  daysLeft: number | null;
  firestoreUid: string | null;
  displayName: string | null;
  inFirestore: boolean;
  type: 'paid' | 'trial' | 'unknown_in_firestore' | 'expired_unpaid';
  orderCount: number;
  latestPlan: string | null;
  latestPlanDuration: string | null;
  latestOrderStatus: string | null;
  latestOrderAmount: number;
  latestOrderCurrency: string;
  latestOrderCreatedAt: string | null;
}

interface Sections {
  realUsers: {
    total: number;
    paid: number;
    trial: number;
    expired: number;
    expiringIn3Days: number;
    unknownInFirestore: number;
  };
  vpnConfigs: Record<string, number>;
  revenue: {
    monthlyActivePaidUsers: number;
    expectedMonthlyRevenueRub: number;
    expectedMonthlyRevenueUsd: number;
    expiredUnpaidUsers: number;
    renewalRate: number;
  };
  alerts: {
    expiredButEnabled: string[];
    activeButZeroUsage: string[];
    highTrafficUsers: Array<{ email: string; totalUsageBytes: number }>;
    orphanConfigs: Array<{ email: string; configCount: number }>;
  };
}

interface InboundSummary {
  id: number;
  remark: string;
  port: number;
  clientCount: number;
}

interface CustomersResponse {
  ok: boolean;
  generatedAt: string;
  sections: Sections;
  inbounds: InboundSummary[];
  customers: CustomerRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function authedFetch(path: string) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt}`);
  }
  return res.json();
}

function maskEmail(email: string): string {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!domain) return (email[0] || '*') + '***';
  if (!local) return '***@' + domain;
  return `${local[0]}***@${domain}`;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatExpiry(ms: number | null): string {
  if (!ms) return 'Never';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function statusBadge(status: CustomerRow['status']) {
  const map: Record<CustomerRow['status'], string> = {
    active: 'bg-emerald-100 text-emerald-700',
    expired: 'bg-red-100 text-red-700',
    disabled: 'bg-gray-200 text-gray-700',
    never_expires: 'bg-blue-100 text-blue-700',
  };
  const label = status === 'never_expires' ? 'lifetime' : status;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status]}`}
    >
      {label}
    </span>
  );
}

function typeBadge(type: CustomerRow['type']) {
  const map: Record<CustomerRow['type'], string> = {
    paid: 'bg-green-100 text-green-700',
    trial: 'bg-yellow-100 text-yellow-700',
    unknown_in_firestore: 'bg-gray-100 text-gray-600',
    expired_unpaid: 'bg-orange-100 text-orange-700',
  };
  const label =
    type === 'unknown_in_firestore' ? 'no-account' : type.replace('_', ' ');
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[type]}`}
    >
      {label}
    </span>
  );
}

function daysLeftBadge(days: number | null) {
  if (days === null) return <span className="text-gray-400 text-xs">—</span>;
  let cls = 'bg-gray-100 text-gray-700';
  if (days < 0) cls = 'bg-red-100 text-red-700';
  else if (days <= 1) cls = 'bg-red-50 text-red-600';
  else if (days <= 3) cls = 'bg-orange-100 text-orange-700';
  else if (days <= 7) cls = 'bg-yellow-100 text-yellow-700';
  else cls = 'bg-emerald-50 text-emerald-700';
  const label =
    days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

// ── Stat box ─────────────────────────────────────────────────────────────────
function StatBox({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'gray',
}: {
  icon: any;
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'gray' | 'green' | 'red' | 'orange' | 'blue';
}) {
  const tones: Record<string, string> = {
    gray: 'bg-gray-50 text-gray-700',
    green: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    orange: 'bg-orange-50 text-orange-700',
    blue: 'bg-blue-50 text-blue-700',
  };
  return (
    <div className={`rounded-2xl p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-4 h-4 opacity-70" />
        <span className="text-xs font-medium uppercase tracking-wide opacity-70">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {hint && <div className="text-xs opacity-60 mt-1">{hint}</div>}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
type FilterKey =
  | 'all'
  | 'active'
  | 'expired'
  | 'disabled'
  | 'expiring_3d'
  | 'active_zero_usage'
  | 'expired_but_enabled'
  | 'orphan_configs'
  | 'unknown_in_firestore';

export function AdminCustomersPage() {
  const [data, setData] = useState<CustomersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [maskOn, setMaskOn] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    try {
      const res = await authedFetch('/admin/customers');
      setData(res);
    } catch (err) {
      toast.error(`Failed to load: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleExpand(email: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function copyEmail(email: string) {
    navigator.clipboard.writeText(email);
    toast.success('Email copied');
  }

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const alertSet = {
      activeButZeroUsage: new Set(data.sections.alerts.activeButZeroUsage),
      expiredButEnabled: new Set(data.sections.alerts.expiredButEnabled),
      orphanConfigs: new Set(data.sections.alerts.orphanConfigs.map((o) => o.email)),
    };
    return data.customers.filter((c) => {
      if (q && !c.email.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'active':
          return c.status === 'active' || c.status === 'never_expires';
        case 'expired':
          return c.status === 'expired' || c.type === 'expired_unpaid';
        case 'disabled':
          return c.status === 'disabled';
        case 'expiring_3d':
          return c.status === 'active' && c.daysLeft !== null && c.daysLeft <= 3;
        case 'active_zero_usage':
          return alertSet.activeButZeroUsage.has(c.email);
        case 'expired_but_enabled':
          return alertSet.expiredButEnabled.has(c.email);
        case 'orphan_configs':
          return alertSet.orphanConfigs.has(c.email);
        case 'unknown_in_firestore':
          return c.type === 'unknown_in_firestore';
        default:
          return true;
      }
    });
  }, [data, query, filter]);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-white p-8">
        <p className="text-gray-500">No data.</p>
      </div>
    );
  }

  const { sections, inbounds, customers } = data;

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to="/admin" className="p-2 hover:bg-gray-100 rounded-xl">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Real Customers</h1>
            <p className="text-sm text-gray-500">
              {customers.length} unique users · {sections.vpnConfigs.totalXrayClients} VPN
              configs · generated{' '}
              {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </div>
          <Button
            onClick={() => setMaskOn((v) => !v)}
            variant="secondary"
            title="Toggle email masking"
          >
            {maskOn ? (
              <>
                <Eye className="w-4 h-4 mr-2" /> Reveal
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4 mr-2" /> Mask
              </>
            )}
          </Button>
          <Button onClick={load} className="bg-black text-white">
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* Real Users */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Real Users
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <StatBox icon={Users} label="Total" value={sections.realUsers.total} />
          <StatBox
            icon={CreditCard}
            label="Paid"
            value={sections.realUsers.paid}
            tone="green"
          />
          <StatBox
            icon={Clock}
            label="Trial"
            value={sections.realUsers.trial}
            tone="orange"
          />
          <StatBox
            icon={AlertTriangle}
            label="Expired"
            value={sections.realUsers.expired}
            tone="red"
          />
          <StatBox
            icon={Clock}
            label="Expiring ≤3d"
            value={sections.realUsers.expiringIn3Days}
            tone="orange"
          />
          <StatBox
            icon={AlertTriangle}
            label="No Firestore"
            value={sections.realUsers.unknownInFirestore}
            tone="gray"
            hint="x-ui only"
          />
        </div>

        {/* VPN Configs */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          VPN Configs
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatBox
            icon={Activity}
            label="Total Xray Clients"
            value={sections.vpnConfigs.totalXrayClients || 0}
            tone="blue"
          />
          {['vless', 'ws', 'yt', 'xhttp'].map((kind) => (
            <StatBox
              key={kind}
              icon={Wifi}
              label={kind.toUpperCase()}
              value={sections.vpnConfigs[kind] || 0}
            />
          ))}
        </div>

        {/* Revenue */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Revenue
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <StatBox
            icon={Users}
            label="Active Paid"
            value={sections.revenue.monthlyActivePaidUsers}
            tone="green"
          />
          <StatBox
            icon={DollarSign}
            label="Expected MRR (RUB)"
            value={`${sections.revenue.expectedMonthlyRevenueRub.toLocaleString()} ₽`}
            tone="green"
          />
          <StatBox
            icon={DollarSign}
            label="Expected MRR (USD)"
            value={`$${sections.revenue.expectedMonthlyRevenueUsd.toLocaleString()}`}
            tone="green"
          />
          <StatBox
            icon={WifiOff}
            label="Expired Unpaid"
            value={sections.revenue.expiredUnpaidUsers}
            tone="red"
          />
          <StatBox
            icon={Activity}
            label="Renewal Rate"
            value={`${sections.revenue.renewalRate}%`}
            tone="blue"
          />
        </div>

        {/* Alerts (clickable filters) */}
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Alerts
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <button
            onClick={() => setFilter('expired_but_enabled')}
            className="text-left rounded-2xl p-4 bg-red-50 text-red-700 hover:ring-2 hover:ring-red-200 transition"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 opacity-70" />
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                Expired but Enabled
              </span>
            </div>
            <div className="text-2xl font-bold">
              {sections.alerts.expiredButEnabled.length}
            </div>
            <div className="text-xs opacity-60 mt-1">Click to filter →</div>
          </button>
          <button
            onClick={() => setFilter('active_zero_usage')}
            className="text-left rounded-2xl p-4 bg-orange-50 text-orange-700 hover:ring-2 hover:ring-orange-200 transition"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <WifiOff className="w-4 h-4 opacity-70" />
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                Active · 0 B Used
              </span>
            </div>
            <div className="text-2xl font-bold">
              {sections.alerts.activeButZeroUsage.length}
            </div>
            <div className="text-xs opacity-60 mt-1">Paid but never connected</div>
          </button>
          <button
            onClick={() => setFilter('all')}
            className="text-left rounded-2xl p-4 bg-blue-50 text-blue-700 hover:ring-2 hover:ring-blue-200 transition"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Activity className="w-4 h-4 opacity-70" />
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                High Traffic ({'>'}50 GB)
              </span>
            </div>
            <div className="text-2xl font-bold">
              {sections.alerts.highTrafficUsers.length}
            </div>
            <div className="text-xs opacity-60 mt-1">Power users</div>
          </button>
          <button
            onClick={() => setFilter('orphan_configs')}
            className="text-left rounded-2xl p-4 bg-gray-100 text-gray-700 hover:ring-2 hover:ring-gray-200 transition"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-4 h-4 opacity-70" />
              <span className="text-xs font-medium uppercase tracking-wide opacity-70">
                Orphan Configs
              </span>
            </div>
            <div className="text-2xl font-bold">
              {sections.alerts.orphanConfigs.length}
            </div>
            <div className="text-xs opacity-60 mt-1">
              Only 1 inbound (expected 2-3)
            </div>
          </button>
        </div>

        {/* Inbounds bar */}
        <div className="mb-6 text-xs text-gray-500 flex flex-wrap gap-3">
          {inbounds.map((ib) => (
            <span key={ib.id} className="inline-flex items-center gap-1.5">
              <span className="font-semibold text-gray-700">{ib.remark}</span>
              <span>·</span>
              <span>port {ib.port}</span>
              <span>·</span>
              <span>{ib.clientCount} configs</span>
            </span>
          ))}
        </div>

        {/* Search + filters */}
        <Card className="mb-4">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by email…"
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                />
              </div>
              {(
                [
                  ['all', `All (${customers.length})`],
                  ['active', 'Active'],
                  ['expiring_3d', '≤3d'],
                  ['expired', 'Expired'],
                  ['disabled', 'Disabled'],
                  ['active_zero_usage', '0 B used'],
                  ['expired_but_enabled', 'Expired+Enabled'],
                  ['orphan_configs', 'Orphan'],
                  ['unknown_in_firestore', 'No-account'],
                ] as [FilterKey, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`text-xs px-3 py-1.5 rounded-full transition ${
                    filter === key
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </CardHeader>
        </Card>

        {/* Customer list */}
        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              No customers match this filter.
            </div>
          )}
          {filtered.map((c) => {
            const isOpen = expanded.has(c.email);
            return (
              <Card key={c.email} className="overflow-hidden">
                <button
                  onClick={() => toggleExpand(c.email)}
                  className="w-full text-left p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="text-gray-400">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {maskOn ? maskEmail(c.email) : c.email}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyEmail(c.email);
                          }}
                          className="text-gray-400 hover:text-gray-700"
                          title="Copy real email"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {c.displayName && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          {c.displayName}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {statusBadge(c.status)}
                      {typeBadge(c.type)}
                      {daysLeftBadge(c.daysLeft)}
                      <span className="text-xs text-gray-500">
                        {c.configCount} config{c.configCount !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatBytes(c.totalUsageBytes)}
                      </span>
                      {c.latestPlan && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {c.latestPlan}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {isOpen && (
                  <CardContent className="bg-gray-50/50 border-t border-gray-100 pt-4">
                    <div className="grid md:grid-cols-2 gap-4 mb-4 text-xs">
                      <div>
                        <div className="text-gray-500 mb-1">Latest expiry</div>
                        <div className="font-medium">{formatExpiry(c.latestExpiry)}</div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">Earliest expiry</div>
                        <div className="font-medium">
                          {formatExpiry(c.earliestExpiry)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">Firestore UID</div>
                        <div className="font-mono text-xs">
                          {c.firestoreUid || '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 mb-1">Orders</div>
                        <div className="font-medium">
                          {c.orderCount} ·{' '}
                          {c.latestOrderAmount > 0
                            ? `${c.latestOrderAmount} ${c.latestOrderCurrency}`
                            : 'none'}
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 mb-2 font-medium uppercase tracking-wide">
                      Configs ({c.configs.length})
                    </div>
                    <div className="overflow-x-auto -mx-4 px-4">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-gray-500">
                            <th className="py-1.5 pr-3 font-medium">Email</th>
                            <th className="py-1.5 pr-3 font-medium">Kind</th>
                            <th className="py-1.5 pr-3 font-medium">Inbound</th>
                            <th className="py-1.5 pr-3 font-medium">Enabled</th>
                            <th className="py-1.5 pr-3 font-medium">Up</th>
                            <th className="py-1.5 pr-3 font-medium">Down</th>
                            <th className="py-1.5 pr-3 font-medium">Expiry</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {c.configs.map((cfg, idx) => (
                            <tr key={idx}>
                              <td className="py-1.5 pr-3 font-mono">
                                {maskOn ? maskEmail(cfg.email) : cfg.email}
                              </td>
                              <td className="py-1.5 pr-3">
                                <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                                  {cfg.kind}
                                </span>
                              </td>
                              <td className="py-1.5 pr-3 text-gray-600">
                                {cfg.inboundRemark} (:{cfg.inboundPort})
                              </td>
                              <td className="py-1.5 pr-3">
                                {cfg.enable ? (
                                  <span className="text-emerald-600">●</span>
                                ) : (
                                  <span className="text-gray-400">○</span>
                                )}
                              </td>
                              <td className="py-1.5 pr-3 text-gray-600">
                                {formatBytes(cfg.up)}
                              </td>
                              <td className="py-1.5 pr-3 text-gray-600">
                                {formatBytes(cfg.down)}
                              </td>
                              <td className="py-1.5 pr-3 text-gray-600">
                                {cfg.expiryTime
                                  ? formatExpiry(cfg.expiryTime)
                                  : 'Never'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
