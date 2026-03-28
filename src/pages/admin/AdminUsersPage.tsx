/**
 * Admin VPN Users Page
 *
 * Lists all ResellPortal clients with their active service + credentials.
 * "Create user" button provisions a new client + VPN order via the API
 * and shows the returned credentials so the admin can share them.
 */

import { useEffect, useState } from 'react';
import { Plus, RefreshCw, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react';
import {
  getClients,
  getClientById,
  getServices,
  getService,
  createClient,
  createVpnOrder,
} from '../../lib/api';
import type { ResellClient, ResellClientDetail, ResellService } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import toast from 'react-hot-toast';

interface ClientRow {
  client: ResellClient;
  detail: ResellClientDetail | null;
  services: ResellService[];
  expanded: boolean;
  loadingDetail: boolean;
}

export function AdminUsersPage() {
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Create user form
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCreds, setNewCreds] = useState<{ username: string; password: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const loadClients = async () => {
    setLoading(true);
    try {
      const clients = await getClients();
      setRows(clients.map((c) => ({ client: c, detail: null, services: [], expanded: false, loadingDetail: false })));
    } catch {
      toast.error('Failed to load clients from ResellPortal.');
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
    // Load detail + services if not yet loaded
    if (!row.detail) {
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, expanded: true, loadingDetail: true } : r));
      try {
        const [detail, allServices] = await Promise.all([
          getClientById(row.client.id),
          getServices(row.client.id),
        ]);
        setRows((prev) => prev.map((r, i) =>
          i === idx ? { ...r, detail, services: allServices, loadingDetail: false } : r
        ));
      } catch {
        setRows((prev) => prev.map((r, i) =>
          i === idx ? { ...r, loadingDetail: false } : r
        ));
        toast.error('Failed to load client details.');
      }
    } else {
      setRows((prev) => prev.map((r, i) => i === idx ? { ...r, expanded: true } : r));
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setNewCreds(null);
    try {
      const clientId = await createClient({
        name: formName,
        email: formEmail,
        phone: formPhone || undefined,
      });
      const order = await createVpnOrder(clientId, 'monthly');
      if (!order.success || !order.service_id) {
        throw new Error(order.message || 'VPN provisioning failed.');
      }
      const creds = order.vpn_credentials;
      if (!creds?.username || !creds?.password) {
        throw new Error('VPN account created but credentials were not returned. Check ResellPortal panel.');
      }
      setNewCreds({ username: creds.username, password: creds.password });
      setFormName('');
      setFormEmail('');
      setFormPhone('');
      toast.success('VPN user created successfully.');
      loadClients(); // refresh list
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to create user.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">VPN Users</h1>
        <div className="flex items-center gap-2">
          <button onClick={loadClients} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
            <RefreshCw className="w-5 h-5 text-gray-400" />
          </button>
          <Button onClick={() => { setShowForm((v) => !v); setNewCreds(null); }} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Create user
          </Button>
        </div>
      </div>

      {/* Create user form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <h2 className="font-semibold">Create VPN user</h2>
          </CardHeader>
          <CardContent>
            {newCreds ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-gray-600">User created. Share these credentials with the client:</p>
                <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-2">
                  <p><span className="text-gray-400">Username: </span>{newCreds.username}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Password: </span>
                    <span>{showPassword ? newCreds.password : '••••••••••'}</span>
                    <button onClick={() => setShowPassword((v) => !v)} className="ml-1 text-gray-400 hover:text-black">
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => { setNewCreds(null); setShowForm(false); }}>
                  Done
                </Button>
              </div>
            ) : (
              <form onSubmit={handleCreate} className="flex flex-col gap-3 max-w-sm">
                <Input
                  label="Full name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="John Doe"
                  required
                />
                <Input
                  label="Email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="john@example.com"
                  required
                />
                <Input
                  label="Phone (optional)"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="+1234567890"
                />
                <div className="flex gap-2 pt-1">
                  <Button type="submit" size="sm" loading={creating}>
                    {creating ? 'Creating…' : 'Create & provision VPN'}
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {/* Client list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-gray-400">
            No clients found in ResellPortal.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-gray-50">
            {rows.map((row, idx) => (
              <div key={row.client.id}>
                {/* Client row */}
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

                {/* Expanded detail */}
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
  );
}

function ServiceList({ clientId, services }: { clientId: number; services: ResellService[] }) {
  const clientServices = services.filter((s) => Number(s.client_id) === Number(clientId));

  if (clientServices.length === 0) {
    return <p className="text-sm text-gray-400 py-3">No services found.</p>;
  }

  return (
    <div className="flex flex-col gap-3 pt-3">
      {clientServices.map((svc) => (
        <ServiceCredentialRow key={svc.id} service={svc} />
      ))}
    </div>
  );
}

function ServiceCredentialRow({ service }: { service: ResellService }) {
  const [creds, setCreds] = useState<{ username?: string; password?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const loadCreds = async () => {
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
          <p className="text-xs text-gray-400">${service.monthly_cost}/mo · {service.billing_cycle}</p>
        </div>
        <Badge variant={service.status === 'active' ? 'success' : 'muted'}>
          {service.status}
        </Badge>
      </div>

      {creds ? (
        <div className="font-mono text-sm flex flex-col gap-1 mt-2">
          {creds.username && <p><span className="text-gray-400">Username: </span>{creds.username}</p>}
          {creds.password && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">Password: </span>
              <span>{showPw ? creds.password : '••••••••'}</span>
              <button onClick={() => setShowPw((v) => !v)} className="text-gray-400 hover:text-black">
                {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={loadCreds}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-black underline mt-1"
        >
          {loading ? 'Loading…' : 'View credentials'}
        </button>
      )}
    </div>
  );
}
