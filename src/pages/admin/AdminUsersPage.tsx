import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Eye, EyeOff, ChevronDown, ChevronUp, X, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  listAccounts,
  findOrCreateAccount,
  setExpiry,
  disableAccount,
  enableAccount,
} from '../../lib/vpnresellers-api';
import type { VpnrAccount } from '../../lib/vpnresellers-api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import toast from 'react-hot-toast';

const EXPIRY_OPTIONS = [
  { label: '1 day (trial)',  days: 1 },
  { label: '30 days',       days: 30 },
  { label: '90 days',       days: 90 },
  { label: '180 days',      days: 180 },
  { label: '365 days',      days: 365 },
  { label: 'No expiry',     days: 0 },
];

function addDays(days: number): string | null {
  if (days === 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ── Create user modal ─────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ account: VpnrAccount; password: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { account, password } = await findOrCreateAccount(email, username || undefined);
      const expireAt = addDays(expiryDays);
      await setExpiry(account.id, expireAt);
      setResult({ account, password });
      toast.success('VPN account created.');
      onCreated();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to create account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">Create VPN user</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black"><X className="w-5 h-5" /></button>
        </div>

        {result ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">Account created. Share these credentials:</p>
            <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
              <p><span className="text-gray-400">Username: </span>{result.account.username}</p>
              {result.password && <p><span className="text-gray-400">Password: </span>{result.password}</p>}
              {result.account.wg_ip && <p><span className="text-gray-400">WG IP: </span>{result.account.wg_ip}</p>}
              <p><span className="text-gray-400">Expires: </span>{result.account.expired_at ?? 'Auto-renewal'}</p>
            </div>
            <Button onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="user@example.com" required />
            <Field label="Custom username (optional)" value={username} onChange={setUsername} placeholder="Auto-generated from email" />

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Expiry</label>
              <div className="grid grid-cols-2 gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <button
                    key={o.days}
                    type="button"
                    onClick={() => setExpiryDays(o.days)}
                    className={`rounded-xl border px-3 py-2 text-sm text-left transition ${
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
                {saving ? 'Creating…' : 'Create VPN account'}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black"
      />
    </div>
  );
}

// ── Account row ───────────────────────────────────────────────────────────────

function AccountRow({ account, onRefresh }: { account: VpnrAccount; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [toggling, setToggling] = useState(false);

  const toggle = async () => {
    setToggling(true);
    try {
      if (account.status === 'Active') {
        await disableAccount(account.id);
        toast.success(`${account.username} disabled.`);
      } else {
        await enableAccount(account.id);
        toast.success(`${account.username} enabled.`);
      }
      onRefresh();
    } catch {
      toast.error('Failed to toggle account.');
    } finally {
      setToggling(false);
    }
  };

  const isExpired = account.expired_at
    ? new Date(account.expired_at) < new Date()
    : false;

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
      >
        <div>
          <p className="text-sm font-medium">{account.username}</p>
          <p className="text-xs text-gray-400">
            Expires: {account.expired_at ?? 'Auto-renewal'}{isExpired ? ' · Expired' : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={account.status === 'Active' ? 'success' : 'muted'}>{account.status}</Badge>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
          <div className="flex flex-col gap-3 pt-3">
            {/* Credentials */}
            <div className="border border-gray-100 rounded-xl p-4 bg-white font-mono text-sm flex flex-col gap-1.5">
              <p><span className="text-gray-400">ID: </span>{account.id}</p>
              <p><span className="text-gray-400">WG IP: </span>{account.wg_ip}</p>
              <p className="break-all">
                <span className="text-gray-400">WG Public: </span>
                {showKeys ? account.wg_public_key : `${account.wg_public_key.slice(0, 16)}…`}
              </p>
              {showKeys && (
                <p className="break-all">
                  <span className="text-gray-400">WG Private: </span>{account.wg_private_key}
                </p>
              )}
              <button
                onClick={() => setShowKeys((v) => !v)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-black mt-1 w-fit"
              >
                {showKeys ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {showKeys ? 'Hide keys' : 'Show full keys'}
              </button>
            </div>

            {/* Toggle enable/disable */}
            <button
              onClick={toggle}
              disabled={toggling}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-black w-fit"
            >
              {account.status === 'Active'
                ? <ToggleRight className="w-4 h-4 text-green-500" />
                : <ToggleLeft className="w-4 h-4 text-gray-400" />}
              {toggling ? 'Updating…' : account.status === 'Active' ? 'Disable account' : 'Enable account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const [accounts, setAccounts] = useState<VpnrAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const all = await listAccounts({ per_page: 100 });
      setAccounts(all);
    } catch {
      toast.error('Failed to load accounts from VPNresellers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const active = accounts.filter((a) => a.status === 'Active').length;

  return (
    <>
      {showModal && <CreateModal onClose={() => setShowModal(false)} onCreated={load} />}

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">VPN Users</h1>
            {!loading && (
              <p className="text-sm text-gray-400 mt-0.5">
                {accounts.length} total · {active} active
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
              <RefreshCw className="w-5 h-5 text-gray-400" />
            </button>
            <Button onClick={() => setShowModal(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Create user
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-400">
              No accounts yet. Create the first one above.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-gray-50">
              {accounts.map((acct) => (
                <AccountRow key={acct.id} account={acct} onRefresh={load} />
              ))}
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
