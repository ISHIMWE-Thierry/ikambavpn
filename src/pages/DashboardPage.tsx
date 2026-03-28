import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Clock, AlertCircle, RefreshCw, ChevronRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders } from '../lib/db-service';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { formatDate, formatCurrency, daysUntilExpiry, isExpired } from '../lib/utils';
import type { VpnOrder, OrderStatus } from '../types';

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

export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = () => {
    if (!firebaseUser) return;
    setLoading(true);
    getUserOrders(firebaseUser.uid)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchOrders, [firebaseUser]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) =>
    o.status === 'pending_payment' || o.status === 'payment_submitted'
  );

  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);

  return (
    <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-black">
            {profile?.firstname ? `Hi, ${profile.firstname}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{firebaseUser?.email}</p>
        </div>
        <button onClick={fetchOrders} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
          <RefreshCw className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Active service */}
          {activeOrder ? (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <h2 className="font-semibold">Active VPN service</h2>
                  </div>
                  {statusBadge(activeOrder.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-6">
                  <Stat label="Plan" value={`${activeOrder.planName} — ${activeOrder.planDuration}`} />
                  <Stat label="Amount paid" value={formatCurrency(activeOrder.amount, activeOrder.currency)} />
                  {activeOrder.expiresAt && (
                    <Stat
                      label="Expires"
                      value={expired ? 'Expired' : `${days} days left`}
                      alert={expired || (days !== null && days <= 5)}
                    />
                  )}
                </div>

                {activeOrder.credentials && (
                  <div className="mt-6 border-t border-gray-100 pt-5">
                    <p className="text-sm font-medium mb-3">Your VPN credentials</p>
                    <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
                      {activeOrder.credentials.serverAddress && (
                        <p><span className="text-gray-400">Server:</span> {activeOrder.credentials.serverAddress}</p>
                      )}
                      {activeOrder.credentials.username && (
                        <p><span className="text-gray-400">Username:</span> {activeOrder.credentials.username}</p>
                      )}
                      {activeOrder.credentials.password && (
                        <p><span className="text-gray-400">Password:</span> {activeOrder.credentials.password}</p>
                      )}
                      {activeOrder.credentials.notes && (
                        <p className="mt-1 font-sans text-gray-500 text-xs">{activeOrder.credentials.notes}</p>
                      )}
                    </div>
                  </div>
                )}

                {(expired || (days !== null && days <= 7)) && (
                  <div className="mt-5">
                    <Link to="/plans">
                      <Button variant="secondary" size="sm">Renew service</Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
                <Shield className="w-10 h-10 text-gray-300" />
                <p className="font-medium text-gray-700">No active VPN service</p>
                <p className="text-sm text-gray-400 max-w-xs">
                  Browse our plans and get started in minutes.
                </p>
                <Link to="/plans">
                  <Button>Browse plans</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* Pending orders */}
          {pendingOrders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
                Pending orders
              </h2>
              <div className="flex flex-col gap-3">
                {pendingOrders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium">{order.planName} — {order.planDuration}</p>
                          <p className="text-xs text-gray-400">Submitted {formatDate(order.createdAt)}</p>
                        </div>
                      </div>
                      {statusBadge(order.status)}
                    </CardContent>
                  </Card>
                ))}
                <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Orders are typically activated within a few hours after payment review.
                </p>
              </div>
            </div>
          )}

          {/* Order history */}
          {orders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">
                Order history
              </h2>
              <Card>
                <div className="divide-y divide-gray-50">
                  {orders.map((order) => (
                    <div key={order.id} className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{order.planName}</p>
                        <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600">{formatCurrency(order.amount, order.currency)}</span>
                        {statusBadge(order.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Quick links */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              to="/plans"
              className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition"
            >
              <span className="font-medium text-sm">Browse plans</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
            <Link
              to="/account"
              className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition"
            >
              <span className="font-medium text-sm">Account settings</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-semibold text-sm ${alert ? 'text-red-500' : 'text-black'}`}>{value}</p>
    </div>
  );
}
