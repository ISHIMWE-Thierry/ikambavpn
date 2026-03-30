import { useEffect, useState } from 'react';
import {
  Plus, RefreshCw, ChevronDown, ChevronUp, X, Copy, Check,
  ToggleLeft, ToggleRight, Trash2, RotateCcw, Server, Wifi,
  HardDrive, Cpu, Users, Shield, Link2, Globe,
} from 'lucide-react';
import {
  getAdminClients,
  getAdminServerStatus,
  addAdminClient,
  enableAdminClient,
  disableAdminClient,
  deleteAdminClient,
  resetAdminClientTraffic,
  formatBytes,
  formatExpiry,
} from '../../lib/xui-api';
import type { XuiAdminClient, XuiSystemStatus } from '../../lib/xui-api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import toast from 'react-hot-toast';

// ── Add Client Modal ──────────────────────────────────────────────────────────

const EXPIRY_OPTIONS = [
  { label: '1 day',   days: 1 },
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year',  days: 365 },
  { label: 'Never',   days: 0 },
];

const TRAFFIC_OPTIONS = [
  { label: '5 GB',     gb: 5 },
  { label: '10 GB',    gb: 10 },
  { label: '50 GB',    gb: 50 },
  { label: '100 GB',   gb: 100 },
  { label: '500 GB',   gb: 500 },
  { label: 'Unlimited', gb: 0 },
];

function AddClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [expiryDays, setExpiryDays] = useState(0);
  const [trafficGB, setTrafficGB] = useState(0);
  const [maxConn, setMaxConn] = useState(2);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ subscriptionUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await addAdminClient({
        email,
        trafficLimitGB: trafficGB,
        expiryDays,
        maxConnections: maxConn,
      });
      setResult({ subscriptionUrl: res.subscriptionUrl });
      toast.success('Client created');
      onCreated();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to create client');
    } finally {
      setSaving(false);
    }
  };

  const copySubUrl = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.subscriptionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">Add VPN Client</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">Client created. Share the subscription link:</p>
            <div className="bg-gray-50 rounded-xl p-3 font-mono text-xs break-all text-gray-700 border border-gray-200">
              {result.subscriptionUrl}
            </div>
            <Button onClick={copySubUrl} className="w-full" variant={copied ? 'primary' : 'secondary'}>
              {copied ? <><Check className="w-4 h-4 mr-1.5" /> Copied</> : <><Copy className="w-4 h-4 mr-1.5" /> Copy subscription link</>}
            </Button>
            <Button onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com" required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Max connections</label>
              <input
                type="number" value={maxConn} onChange={(e) => setMaxConn(Number(e.target.value))}
                min={1} max={10}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Traffic limit</label>
              <div className="grid grid-cols-3 gap-2">
                {TRAFFIC_OPTIONS.map((o) => (
                  <button
                    key={o.gb} type="button" onClick={() => setTrafficGB(o.gb)}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      trafficGB === o.gb ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Expiry</label>
              <div className="grid grid-cols-3 gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <button
                    key={o.days} type="button" onClick={() => setExpiryDays(o.days)}
                    className={`rounded-xl border px-3 py-2 text-sm transition ${
                      expiryDays === o.days ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" loading={saving}>
                {saving ? 'Creating...' : 'Create client'}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Client Row ────────────────────────────────────────────────────────────────

function ClientRow({ client, onRefresh }: { client: XuiAdminClient; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [copied, setCopied] = useState(false);

  const traffic = client.up + client.down;
  const isExpired = client.expiryTime > 0 && client.expiryTime < Date.now();

  const toggleEnabled = async () => {
    setToggling(true);
    try {
      if (client.enable) {
        await disableAdminClient(client.uuid);
        toast.success(`${client.email} disabled`);
      } else {
        await enableAdminClient(client.uuid);
        toast.success(`${client.email} enabled`);
      }
      onRefresh();
    } catch {
      toast.error('Failed to toggle client');
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${client.email}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteAdminClient(client.uuid);
      toast.success(`${client.email} deleted`);
      onRefresh();
    } catch {
      toast.error('Failed to delete client');
    } finally {
      setDeleting(false);
    }
  };

  const handleResetTraffic = async () => {
    setResetting(true);
    try {
      await resetAdminClientTraffic(client.email);
      toast.success('Traffic reset');
      onRefresh();
    } catch {
      toast.error('Failed to reset traffic');
    } finally {
      setResetting(false);
    }
  };

  const copySubUrl = () => {
    if (!client.subscriptionUrl) return;
    navigator.clipboard.writeText(client.subscriptionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{client.email}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {formatBytes(traffic)} used
            {client.total > 0 ? ` / ${formatBytes(client.total)}` : ' (unlimited)'}
            {' · '}
            Expires: {formatExpiry(client.expiryTime)}
            {isExpired && ' · Expired'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {isExpired && <Badge variant="warning">Expired</Badge>}
          <Badge variant={client.enable ? 'success' : 'muted'}>
            {client.enable ? 'Active' : 'Disabled'}
          </Badge>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
          <div className="flex flex-col gap-3 pt-3">
            {/* Info */}
            <div className="border border-gray-100 rounded-xl p-4 bg-white font-mono text-xs flex flex-col gap-1.5">
              <p><span className="text-gray-400">UUID: </span>{client.uuid}</p>
              <p><span className="text-gray-400">Upload: </span>{formatBytes(client.up)}</p>
              <p><span className="text-gray-400">Download: </span>{formatBytes(client.down)}</p>
              <p><span className="text-gray-400">Max connections: </span>{client.limitIp || 'Unlimited'}</p>
            </div>

            {/* Subscription link */}
            {client.subscriptionUrl && (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-gray-500">Subscription URL</p>
                <div className="bg-white rounded-xl p-2.5 font-mono text-[11px] break-all text-gray-600 border border-gray-200">
                  {client.subscriptionUrl}
                </div>
                <button
                  onClick={copySubUrl}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-black w-fit"
                >
                  {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy subscription link'}
                </button>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={toggleEnabled} disabled={toggling}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition"
              >
                {client.enable
                  ? <ToggleRight className="w-4 h-4 text-green-500" />
                  : <ToggleLeft className="w-4 h-4 text-gray-400" />}
                {toggling ? 'Updating...' : client.enable ? 'Disable' : 'Enable'}
              </button>

              <button
                onClick={handleResetTraffic} disabled={resetting}
                className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black px-3 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition"
              >
                <RotateCcw className="w-4 h-4" />
                {resetting ? 'Resetting...' : 'Reset traffic'}
              </button>

              <button
                onClick={handleDelete} disabled={deleting}
                className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-800 px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-400 transition"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Server Status Card ────────────────────────────────────────────────────────

function ServerStatusCard({ status }: { status: XuiSystemStatus | null }) {
  if (!status) return null;

  const memPct = status.mem.total > 0 ? Math.round((status.mem.current / status.mem.total) * 100) : 0;
  const diskPct = status.disk.total > 0 ? Math.round((status.disk.current / status.disk.total) * 100) : 0;
  const uptimeDays = Math.floor(status.uptime / 86400);
  const uptimeHrs = Math.floor((status.uptime % 86400) / 3600);

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4" />
          <h2 className="font-semibold">Server Status</h2>
          <Badge variant={status.xray.state === 'running' ? 'success' : 'warning'}>
            Xray {status.xray.state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatusItem icon={Cpu} label="CPU" value={`${Math.round(status.cpu)}%`} />
          <StatusItem
            icon={HardDrive}
            label="Memory"
            value={`${memPct}%`}
            sub={`${formatBytes(status.mem.current)} / ${formatBytes(status.mem.total)}`}
          />
          <StatusItem
            icon={HardDrive}
            label="Disk"
            value={`${diskPct}%`}
            sub={`${formatBytes(status.disk.current)} / ${formatBytes(status.disk.total)}`}
          />
          <StatusItem icon={Wifi} label="Uptime" value={`${uptimeDays}d ${uptimeHrs}h`} sub={`Xray v${status.xray.version}`} />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusItem({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-gray-600" />
      </div>
      <div>
        <p className="text-sm font-bold leading-tight">{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
        {sub && <p className="text-[10px] text-gray-300 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AdminVpnPanelPage() {
  const [clients, setClients] = useState<XuiAdminClient[]>([]);
  const [serverStatus, setServerStatus] = useState<XuiSystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        getAdminClients(),
        getAdminServerStatus().catch(() => null),
      ]);
      setClients(c);
      setServerStatus(s);
    } catch {
      toast.error('Failed to load VPN panel data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = search
    ? clients.filter((c) => c.email.toLowerCase().includes(search.toLowerCase()))
    : clients;

  const activeCount = clients.filter((c) => c.enable).length;
  const totalTraffic = clients.reduce((sum, c) => sum + c.up + c.down, 0);

  return (
    <>
      {showModal && <AddClientModal onClose={() => setShowModal(false)} onCreated={load} />}

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              <h1 className="text-2xl font-bold">VPN Control Panel</h1>
            </div>
            {!loading && (
              <p className="text-sm text-gray-400 mt-0.5">
                {clients.length} clients · {activeCount} active · {formatBytes(totalTraffic)} total traffic
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </button>
            <Button onClick={() => setShowModal(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Add client
            </Button>
          </div>
        </div>

        {/* Server status */}
        <ServerStatusCard status={serverStatus} />

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <MiniStat icon={Users} label="Total clients" value={clients.length} />
          <MiniStat icon={Globe} label="Active" value={activeCount} />
          <MiniStat icon={Wifi} label="Total upload" value={formatBytes(clients.reduce((s, c) => s + c.up, 0))} />
          <MiniStat icon={Link2} label="Total download" value={formatBytes(clients.reduce((s, c) => s + c.down, 0))} />
        </div>

        {/* Search */}
        {clients.length > 3 && (
          <div className="mb-4">
            <input
              type="text" value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email..."
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-black"
            />
          </div>
        )}

        {/* Client list */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-400">
              {search ? 'No clients matching search.' : 'No VPN clients yet. Add the first one above.'}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-gray-50">
              {filtered.map((client) => (
                <ClientRow key={client.email} client={client} onRefresh={load} />
              ))}
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string | number }) {
  return (
    <div className="border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
      <div className="w-8 h-8 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-black" />
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
