import { useEffect, useState } from 'react';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { getAllOrders, updateOrderStatus } from '../../lib/db-service';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { formatDate, formatCurrency } from '../../lib/utils';
import type { VpnOrder, OrderStatus, VpnCredentials } from '../../types';
import toast from 'react-hot-toast';

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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);

  const handleActivate = async () => {
    setLoading(true);
    try {
      const credentials: VpnCredentials = { username, password, serverAddress, notes };
      await updateOrderStatus(order.id, 'active', {
        credentials,
        activatedAt: new Date().toISOString(),
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      });
      toast.success('Order activated!');
      onDone();
    } catch {
      toast.error('Failed to activate order.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 border-t border-gray-100 pt-4 flex flex-col gap-3">
      <p className="text-sm font-medium">Activate service — set credentials</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <input
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Server address"
          value={serverAddress}
          onChange={(e) => setServerAddress(e.target.value)}
        />
        <input
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
          type="date"
          placeholder="Expires at"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>
      <input
        className="border border-gray-200 rounded-xl px-3 py-2 text-sm"
        placeholder="Notes (optional setup instructions)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={handleActivate} loading={loading}>
          Activate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => updateOrderStatus(order.id, 'cancelled').then(onDone)}
        >
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
