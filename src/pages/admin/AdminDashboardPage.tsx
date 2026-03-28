import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, ShoppingBag, CheckCircle, Clock, ChevronRight, Plus, Zap } from 'lucide-react';
import { getAllOrders, getAllUsers, getAllTrials, getPaymentAccounts, savePaymentAccount, updatePaymentAccount } from '../../lib/db-service';
import { getServices } from '../../lib/api';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import type { VpnOrder, UserProfile, PaymentAccount } from '../../types';
import toast from 'react-hot-toast';

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
}

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="border border-gray-100 rounded-2xl px-5 py-4 flex items-center gap-4">
      <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-black" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs text-gray-400 mt-1">{label}</p>
      </div>
    </div>
  );
}

export function AdminDashboardPage() {
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [activeServiceCount, setActiveServiceCount] = useState(0);
  const [activeTrialCount, setActiveTrialCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Add payment account form
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newMethod, setNewMethod] = useState('Mobile Money');
  const [newProvider, setNewProvider] = useState('');
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newInstructions, setNewInstructions] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  useEffect(() => {
    Promise.all([
      getAllOrders(),
      getAllUsers(),
      getPaymentAccounts(),
      getAllTrials(),
      getServices().catch(() => []),   // live count from ResellPortal
    ]).then(([o, u, p, trials, services]) => {
      setOrders(o as VpnOrder[]);
      setUsers(u as UserProfile[]);
      setPaymentAccounts(p as PaymentAccount[]);
      setActiveTrialCount((trials as { status: string }[]).filter((t) => t.status === 'active').length);
      setActiveServiceCount((services as { status: string }[]).filter((s) => s.status === 'active').length);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccount(true);
    try {
      await savePaymentAccount({
        method: newMethod,
        provider: newProvider,
        accountName: newAccountName,
        accountNumber: newAccountNumber,
        instructions: newInstructions,
        active: true,
      });
      toast.success('Payment account added.');
      setShowAddAccount(false);
      setNewMethod('Mobile Money');
      setNewProvider('');
      setNewAccountName('');
      setNewAccountNumber('');
      setNewInstructions('');
      const updated = await getPaymentAccounts();
      setPaymentAccounts(updated);
    } catch {
      toast.error('Failed to save account.');
    } finally {
      setSavingAccount(false);
    }
  };

  const toggleAccount = async (acc: PaymentAccount) => {
    try {
      await updatePaymentAccount(acc.id, { active: !acc.active });
      const updated = await getPaymentAccounts();
      setPaymentAccounts(updated);
    } catch {
      toast.error('Failed to update account.');
    }
  };

  const reviewOrders = orders.filter((o) => o.status === 'payment_submitted').length;

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold mb-8">Admin dashboard</h1>

      {/* Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard icon={Users} label="Total users" value={users.length} />
        <StatCard icon={CheckCircle} label="Active VPN services" value={activeServiceCount} />
        <StatCard icon={Zap} label="Active trials" value={activeTrialCount} />
        <StatCard icon={Clock} label="Under review" value={reviewOrders} />
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Quick actions */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Quick actions</h2>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Link
                to="/admin/users"
                className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-gray-50 transition"
              >
                <span className="text-sm font-medium">Manage VPN users</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              <Link
                to="/admin/orders"
                className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-gray-50 transition"
              >
                <span className="text-sm font-medium">Manage orders</span>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </Link>
              {reviewOrders > 0 && (
                <Link
                  to="/admin/orders"
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-yellow-50 hover:bg-yellow-100 transition"
                >
                  <span className="text-sm font-medium text-yellow-800">
                    {reviewOrders} order{reviewOrders > 1 ? 's' : ''} awaiting review
                  </span>
                  <ChevronRight className="w-4 h-4 text-yellow-500" />
                </Link>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Payment accounts */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Payment accounts</h2>
              <button
                onClick={() => setShowAddAccount((v) => !v)}
                className="flex items-center gap-1 text-sm text-gray-500 hover:text-black transition"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
          </CardHeader>
          <CardContent>
            {showAddAccount && (
              <form onSubmit={handleSaveAccount} className="flex flex-col gap-3 mb-5 p-4 bg-gray-50 rounded-xl">
                <Input
                  label="Method"
                  value={newMethod}
                  onChange={(e) => setNewMethod(e.target.value)}
                  placeholder="e.g. Mobile Money"
                  required
                />
                <Input
                  label="Provider"
                  value={newProvider}
                  onChange={(e) => setNewProvider(e.target.value)}
                  placeholder="e.g. MTN"
                />
                <Input
                  label="Account name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  required
                />
                <Input
                  label="Account number"
                  value={newAccountNumber}
                  onChange={(e) => setNewAccountNumber(e.target.value)}
                  required
                />
                <Input
                  label="Instructions"
                  value={newInstructions}
                  onChange={(e) => setNewInstructions(e.target.value)}
                  placeholder="Payment instructions for users"
                />
                <Button type="submit" size="sm" loading={savingAccount}>
                  Save account
                </Button>
              </form>
            )}

            {paymentAccounts.length === 0 ? (
              <p className="text-sm text-gray-400">No payment accounts configured.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {paymentAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between py-2">
                    <div>
                      <p className="text-sm font-medium">{acc.method}{acc.provider ? ` — ${acc.provider}` : ''}</p>
                      <p className="text-xs text-gray-400">{acc.accountNumber}</p>
                    </div>
                    <button
                      onClick={() => toggleAccount(acc)}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        acc.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {acc.active ? 'Active' : 'Inactive'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
