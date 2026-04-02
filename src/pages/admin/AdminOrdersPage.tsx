import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { getAllOrders, updateOrderStatus } from '../../lib/db-service';
import { notifyUserServiceActivated, notifyUserOrderCancelled } from '../../lib/email-service';
import { provisionXuiAccount } from '../../lib/xui-api';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatDate, formatCurrency } from '../../lib/utils';
import type { VpnOrder, OrderStatus } from '../../types';
import toast from 'react-hot-toast';

const EXPIRY_OPTIONS = [
  { label: '30 days',  days: 30 },
  { label: '90 days',  days: 90 },
  { label: '180 days', days: 180 },
  { label: '365 days', days: 365 },
];

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

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
  const [expiryDays, setExpiryDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    if (!order.userEmail) { toast.error('Order has no user email.'); return; }
    setLoading(true);
    try {
      // Provision VLESS+REALITY account in the same 3X-UI panel as the dashboard
      await provisionXuiAccount({
        email: order.userEmail,
        trafficLimitGB: 0,
        expiryDays,
        maxConnections: 2,
      });

      await updateOrderStatus(order.id, 'active', {
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + expiryDays * 86_400_000).toISOString(),
      });

      // Email tells user to go to dashboard to copy their VPN link
      notifyUserServiceActivated({
        userEmail: order.userEmail,
        userName: order.userName,
        planName: order.planName,
        planDuration: order.planDuration,
      }).catch(() => {});

      toast.success('Order activated — user notified to check their dashboard.');
      onDone();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to activate order.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    await updateOrderStatus(order.id, 'cancelled');
    notifyUserOrderCancelled({
      userEmail: order.userEmail ?? '',
      userName: order.userName,
      planName: order.planName,
      orderId: order.id,
      newStatus: 'cancelled',
    }).catch(() => {});
    onDone();
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 flex flex-col gap-3">
      <p className="text-sm font-medium">Activate VPN access</p>

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

      <div className="flex gap-2">
        <Button size="sm" onClick={handleActivate} loading={loading}>Activate</Button>
        <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel order</Button>
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
