import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Eye, EyeOff, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  getClients,
  getClientById,
  getClientByEmail,
  getServices,
  getService,
  createClient,
  createVpnOrder,
} from '../../lib/api';
import type { ResellClient, ResellClientDetail, ResellService } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent } from '../../components/ui/card';
import toast from 'react-hot-toast';

const BILLING_OPTIONS = [
  { value: 'monthly',   label: 'Monthly',   price: '$6' },
  { value: 'quarterly', label: 'Quarterly',  price: '$16' },
  { value: 'biannual',  label: '6 Months',   price: '$30' },
  { value: 'annual',    label: 'Annual',     price: '$54' },
];

interface ClientRow {
  client: ResellClient;
  detail: ResellClientDetail | null;
  services: ResellService[];
  expanded: boolean;
  loadingDetail: boolean;
}

// ── Create user modal ─────────────────────────────────────────────────────────

interface CreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateModal({ onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [billing, setBilling] = useState('monthly');
  const [vpnUsername, setVpnUsername] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ username: string; password: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Find existing client or create new one
      let clientId: number;
      const existing = await getClientByEmail(email);
      if (existing) {
        clientId = existing.id;
      } else {
        clientId = await createClient({ name, email, phone: phone || undefined });
      }

      // Provision VPN
      const order = await createVpnOrder(clientId, billing, vpnUsername || undefined);
      if (!order.success || !order.service_id) {
        throw new Error(order.message || 'VPN provisioning failed.');
      }
      const creds = order.vpn_credentials;
      if (!creds?.username || !creds?.password) {
        throw new Error('Order created but no credentials returned — check ResellPortal panel.');
      }
      setResult({ username: creds.username, password: creds.password });
      toast.success('VPN user provisioned.');
      onCreated();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">Create VPN user</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-black">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">User provisioned. Share these credentials:</p>
            <CredBox username={result.username} password={result.password} />
            <Button onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Field label="Full name" value={name} onChange={setName} placeholder="John Doe" required />
            <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="john@example.com" required />
            <Field label="Phone (optional)" value={phone} onChange={setPhone} placeholder="+1234567890" />
            <Field label="Custom username (optional)" value={vpnUsername} onChange={setVpnUsername} placeholder="Leave blank to auto-generate" />

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Billing cycle</label>
              <div className="grid grid-cols-2 gap-2">
                {BILLING_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => setBilling(o.value)}
                    className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm transition ${
                      billing === o.value ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
                    }`}
                  >
                    <span>{o.label}</span>
                    <span className={billing === o.value ? 'text-gray-300' : 'text-gray-400'}>{o.price}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" loading={saving}>
                {saving ? 'Provisioning…' : 'Create & provision VPN'}
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, type = 'text', required,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-black"
      />
    </div>
  );
}

function CredBox({ username, password }: { username: string; password: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
      <p><span className="text-gray-400">Username: </span>{username}</p>
      <div className="flex items-center gap-2">
        <span className="text-gray-400">Password: </span>
        <span>{show ? password : '••••••••'}</span>
        <button onClick={() => setShow((v) => !v)} className="text-gray-400 hover:text-black ml-1">
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminUsersPage() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const loadClients = async () => {
    setLoading(true);
    try {
      const clients = await getClients();
      setRows(clients.map((c) => ({
        client: c, detail: null, services: [], expanded: false, loadingDetail: false,
      })));
    } catch {
      toast.error('Failed to load clients.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClients(); }, []);

  const toggleExpand = async (idx: number) => {
    const row = rows[idx];
    if (row.expanded) {
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, expanded: false } : r));
      return;
    }
    if (!row.detail) {
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, expanded: true, loadingDetail: true } : r));
      try {
        const [detail, services] = await Promise.all([
          getClientById(row.client.id),
          getServices(row.client.id),
        ]);
        setRows((prev) => prev.map((r, i) =>
          i === idx ? { ...r, detail, services, loadingDetail: false } : r
        ));
      } catch {
        setRows((prev) => prev.map((r, i) => i === idx ? { ...r, loadingDetail: false } : r));
        toast.error('Failed to load client details.');
      }
    } else {
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, expanded: true } : r));
    }
  };

  return (
    <>
      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreated={loadClients}
        />
      )}

      <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">VPN Users</h1>
          <div className="flex items-center gap-2">
            <button onClick={loadClients} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
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
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-gray-400">
              No clients in ResellPortal yet.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-gray-50">
              {rows.map((row, idx) => (
                <div key={row.client.id}>
                  <button
                    onClick={() => toggleExpand(idx)}
                    className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition text-left"
                  >
                    <div>
                      <p className="text-sm font-medium">{row.client.name}</p>
                      <p className="text-xs text-gray-400">{row.client.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {row.detail && (
                        <Badge variant={row.detail.active_services > 0 ? 'success' : 'muted'}>
                          {row.detail.active_services > 0
                            ? `${row.detail.active_services} active`
                            : 'No services'}
                        </Badge>
                      )}
                      {row.expanded
                        ? <ChevronUp className="w-4 h-4 text-gray-400" />
                        : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>

                  {row.expanded && (
                    <div className="px-5 pb-4 bg-gray-50 border-t border-gray-100">
                      {row.loadingDetail ? (
                        <div className="flex justify-center py-4">
                          <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : (
                        <ServiceList clientId={row.client.id} services={row.services} />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </main>
    </>
  );
}

// ── Service list + credential rows ────────────────────────────────────────────

function ServiceList({ clientId, services }: { clientId: number; services: ResellService[] }) {
  const mine = services.filter((s) => Number(s.client_id) === Number(clientId));
  if (mine.length === 0) return <p className="text-sm text-gray-400 py-3">No services found.</p>;
  return (
    <div className="flex flex-col gap-3 pt-3">
      {mine.map((svc) => <ServiceRow key={svc.id} service={svc} />)}
    </div>
  );
}

function ServiceRow({ service }: { service: ResellService }) {
  const [creds, setCreds] = useState<{ username?: string; password?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const full = await getService(service.id);
      const sd = full.service_data ?? {};
      setCreds({ username: sd.username, password: sd.password });
    } catch {
      toast.error('Failed to load credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-gray-100 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-medium capitalize">{service.service_type ?? 'VPN'} service</p>
          {service.monthly_cost && (
            <p className="text-xs text-gray-400">${service.monthly_cost}/mo · {service.billing_cycle}</p>
          )}
        </div>
        <Badge variant={service.status === 'active' ? 'success' : 'muted'}>{service.status}</Badge>
      </div>

      {creds ? (
        <div className="font-mono text-sm flex flex-col gap-1 mt-2">
          {creds.username && <p><span className="text-gray-400">Username: </span>{creds.username}</p>}
          {creds.password && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Password: </span>
              <span>{show ? creds.password : '••••••••'}</span>
              <button onClick={() => setShow((v) => !v)} className="text-gray-400 hover:text-black">
                {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button onClick={load} disabled={loading} className="text-xs text-gray-500 hover:text-black underline mt-1">
          {loading ? 'Loading…' : 'View credentials'}
        </button>
      )}
    </div>
  );
}
