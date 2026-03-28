import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { getAllOrders, updateOrderStatus } from '../../lib/db-service';
import { notifyUserServiceActivated, notifyUserOrderCancelled } from '../../lib/email-service';
import { getClientByEmail, createClient, createVpnOrder } from '../../lib/api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatDate, formatCurrency } from '../../lib/utils';
import type { VpnOrder, OrderStatus } from '../../types';
import toast from 'react-hot-toast';

const BILLING_OPTIONS = [
  { value: 'monthly',   label: 'Monthly',  price: '$6' },
  { value: 'quarterly', label: 'Quarterly', price: '$16' },
  { value: 'biannual',  label: '6 Months',  price: '$30' },
  { value: 'annual',    label: 'Annual',    price: '$54' },
];

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'default' }> = {
    active: { label: 'Active', variant: 'success' },
    pending_payment: { label: 'Pending payment', variant: 'warning' },
    payment_submitted: { label: 'Under review', variant: 'muted' },
    expired: { label: 'Expired', variant: 'danger' },
    cancelled: { label: 'Cancelled', variant: 'danger' },
  };
  const s = map[status] ?? { label: status, variant: 'muted' };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

interface ActivateFormProps {
  order: VpnOrder;
  onDone: () => void;
}

function ActivateForm({ order, onDone }: ActivateFormProps) {
  const [billing, setBilling] = useState('monthly');
  const [vpnUsername, setVpnUsername] = useState('');
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    if (!order.userEmail) { toast.error('Order has no user email.'); return; }
    setLoading(true);
    try {
      // Find or create ResellPortal client for this user
      let clientId: number;
      const existing = await getClientByEmail(order.userEmail);
      if (existing) {
        clientId = existing.id;
      } else {
        clientId = await createClient({
          name: order.userName || order.userEmail,
          email: order.userEmail,
        });
      }

      // Provision VPN order via API → get credentials immediately
      const vpnOrder = await createVpnOrder(clientId, billing, vpnUsername || undefined);
      if (!vpnOrder.success || !vpnOrder.service_id) {
        throw new Error(vpnOrder.message || 'VPN provisioning failed.');
      }

      const creds = {
        username: vpnOrder.vpn_credentials?.username,
        password: vpnOrder.vpn_credentials?.password,
      };

      await updateOrderStatus(order.id, 'active', {
        credentials: creds,
        activatedAt: new Date().toISOString(),
      });

      if (order.userEmail) {
        notifyUserServiceActivated({
          userEmail: order.userEmail,
          userName: order.userName,
          planName: order.planName,
          planDuration: order.planDuration,
          username: creds.username,
          password: creds.password,
        }).catch(() => {});
      }

      toast.success('Order activated — credentials sent to user.');
      onDone();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to activate order.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    await updateOrderStatus(order.id, 'cancelled');
    if (order.userEmail) {
      notifyUserOrderCancelled({
        userEmail: order.userEmail,
        userName: order.userName,
        planName: order.planName,
        orderId: order.id,
        newStatus: 'cancelled',
      }).catch(() => {});
    }
    onDone();
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 flex flex-col gap-3">
      <p className="text-sm font-medium">Activate via ResellPortal API</p>

      <div className="grid grid-cols-2 gap-2">
        {BILLING_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setBilling(o.value)}
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
              billing === o.value ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
            }`}
          >
            <span>{o.label}</span>
            <span className={billing === o.value ? 'text-gray-300' : 'text-gray-400'}>{o.price}</span>
          </button>
        ))}
      </div>

      <input
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
        placeholder="Custom username (optional — leave blank to auto-generate)"
        value={vpnUsername}
        onChange={(e) => setVpnUsername(e.target.value)}
      />

      <div className="flex gap-2">
        <Button size="sm" onClick={handleActivate} loading={loading}>
          Activate
        </Button>
        <Button size="sm" variant="ghost" onClick={handleCancel}>
          Cancel order
        </Button>
      </div>
    </div>
  );
}

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const fetchOrders = () => {
    setLoading(true);
    getAllOrders()
      .then(setOrders)
      .catch(() => toast.error('Failed to load orders.'))
      .finally(() => setLoading(false));
  };

  useEffect(fetchOrders, []);

  const filtered =
    statusFilter === 'all' ? orders : orders.filter((o) => o.status === statusFilter);

  return (
    <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Orders</h1>
        <div className="flex items-center gap-3">
          <select
            className="text-sm border border-gray-200 rounded-xl px-3 py-2"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="pending_payment">Pending payment</option>
            <option value="payment_submitted">Under review</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={fetchOrders} className="p-2 hover:bg-gray-50 rounded-xl" title="Refresh">
            <RefreshCw className="w-5 h-5 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Summary counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', count: orders.length },
          { label: 'Under review', count: orders.filter((o) => o.status === 'payment_submitted').length },
          { label: 'Active', count: orders.filter((o) => o.status === 'active').length },
          { label: 'Pending', count: orders.filter((o) => o.status === 'pending_payment').length },
        ].map(({ label, count }) => (
          <div key={label} className="border border-gray-100 rounded-2xl px-4 py-3">
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="px-6 py-10 text-center text-sm text-gray-400">No orders found.</div>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((order) => (
            <Card key={order.id}>
              <div className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-medium text-sm">{order.planName} — {order.planDuration}</p>
                    <p className="text-xs text-gray-400">
                      {order.userEmail} · {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-600">{formatCurrency(order.amount, order.currency)}</span>
                    {statusBadge(order.status)}
                    <button
                      onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                      className="p-1 hover:bg-gray-50 rounded-lg"
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-gray-400 transition-transform ${
                          expanded === order.id ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {expanded === order.id && (
                  <div className="mt-4 text-sm text-gray-600 flex flex-col gap-2">
                    <div className="grid sm:grid-cols-2 gap-2">
                      <p><span className="text-gray-400">Order ID:</span> {order.id}</p>
                      <p><span className="text-gray-400">User ID:</span> {order.userId}</p>
                      <p><span className="text-gray-400">Payment:</span> {order.paymentMethod}</p>
                      {order.activatedAt && (
                        <p><span className="text-gray-400">Activated:</span> {formatDate(order.activatedAt)}</p>
                      )}
                      {order.expiresAt && (
                        <p><span className="text-gray-400">Expires:</span> {formatDate(order.expiresAt)}</p>
                      )}
                    </div>

                    {order.paymentProofUrl && (
                      <a
                        href={order.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-black underline text-sm mt-1"
                      >
                        View payment proof →
                      </a>
                    )}

                    {order.credentials && (
                      <div className="bg-gray-50 rounded-xl p-3 font-mono text-xs mt-1">
                        {order.credentials.serverAddress && <p>Server: {order.credentials.serverAddress}</p>}
                        {order.credentials.username && <p>User: {order.credentials.username}</p>}
                        {order.credentials.password && <p>Pass: {order.credentials.password}</p>}
                      </div>
                    )}

                    {(order.status === 'payment_submitted' || order.status === 'pending_payment') && (
                      <ActivateForm order={order} onDone={fetchOrders} />
                    )}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
