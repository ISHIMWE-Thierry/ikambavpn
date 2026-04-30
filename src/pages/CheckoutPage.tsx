import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createOrder, getAppSettings, getUserOrders, type AppPaymentSettings } from '../lib/db-service';
import { createYooKassaPayment } from '../lib/xui-api';
import { notifyAdminsNewOrder } from '../lib/email-service';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../lib/utils';
import { PageTransition } from '../components/PageTransition';
import type { VpnPlan } from '../types';
import toast from 'react-hot-toast';

type Step = 'review' | 'payment' | 'done';

const STEP_LABELS: Record<Step, string> = {
  review: 'Review',
  payment: 'Payment',
  done: 'Done',
};

export function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();

  const plan = (location.state as { plan?: VpnPlan })?.plan;
  const isUpgrade = (location.state as { isUpgrade?: boolean })?.isUpgrade ?? false;

  const [step, setStep] = useState<Step>('review');
  const [paymentSettings, setPaymentSettings] = useState<AppPaymentSettings | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [cardProcessing, setCardProcessing] = useState(false);

  const rubRate = paymentSettings?.rubToUsdRate || 0;
  const planUsdEquiv = (plan && plan.currency === 'RUB' && rubRate > 0)
    ? +(plan.price / rubRate).toFixed(2)
    : null;

  useEffect(() => {
    if (!plan) {
      navigate('/plans');
      return;
    }
    getAppSettings().then(setPaymentSettings).catch(() => {});

    if (firebaseUser) {
      getUserOrders(firebaseUser.uid).then((orders) => {
        const pending = orders.find((o) => o.status === 'pending_payment');
        if (pending) {
          toast('You already have a pending order. Complete it first.', { icon: '⏳' });
          navigate('/dashboard');
          return;
        }
        const active = orders.find(
          (o) => o.status === 'active' && !!o.expiresAt && new Date(o.expiresAt) > new Date(),
        );
        if (active && !isUpgrade) {
          toast('You already have an active plan. Upgrade from your dashboard.', { icon: '✅' });
          navigate('/dashboard');
          return;
        }
        if (active && isUpgrade && plan.price <= active.amount) {
          toast('You can only upgrade to a higher plan.', { icon: '⬆️' });
          navigate('/dashboard');
          return;
        }
      }).catch(() => {});
    }
  }, [plan, navigate, firebaseUser, isUpgrade]);

  const handleCardPayment = useCallback(async (orderIdParam: string) => {
    if (!plan) return;
    setCardProcessing(true);
    try {
      const result = await createYooKassaPayment({
        orderId: orderIdParam,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        currency: plan.currency,
      });
      if (!result.confirmationUrl) {
        toast.error('Payment service unavailable. Please contact support.');
        return;
      }
      toast.success('Redirecting to payment page…');
      window.location.href = result.confirmationUrl;
    } catch (err: unknown) {
      console.error('[Checkout] YooKassa payment error:', err);
      const msg = (err as Error)?.message || 'Payment failed. Please contact support.';
      toast.error(msg);
    } finally {
      setCardProcessing(false);
    }
  }, [plan]);

  if (!plan) return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <p className="text-sm text-gray-500">Loading plan…</p>
      </div>
    </main>
  );

  const handleConfirmPlan = async () => {
    if (!firebaseUser) {
      navigate('/signin');
      return;
    }
    setCreatingOrder(true);
    try {
      const id = await createOrder({
        userId: firebaseUser.uid,
        userEmail: firebaseUser.email,
        userName: profile ? `${profile.firstname} ${profile.lastname}`.trim() : firebaseUser.displayName,
        planId: plan.id,
        planName: plan.name,
        planDuration: plan.duration,
        amount: plan.price,
        currency: plan.currency,
        status: 'pending_payment',
      });
      setOrderId(id);
      notifyAdminsNewOrder({
        orderId: id,
        userName: profile ? `${profile.firstname} ${profile.lastname}`.trim() : firebaseUser.displayName,
        userEmail: firebaseUser.email,
        planName: plan.name,
        planDuration: plan.duration,
        amount: plan.price,
        currency: plan.currency,
      }).catch(() => {});

      setStep('payment');
      await handleCardPayment(id);
    } catch (err: unknown) {
      console.error('[Checkout] Order creation failed:', err);
      toast.error('Failed to create order. Please try again.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const steps: Step[] = ['review', 'payment', 'done'];

  return (
    <PageTransition>
      <main className="flex-1 max-w-lg mx-auto px-4 py-12">
        <div className="flex items-center gap-1 mb-8 text-xs text-gray-400">
          {steps.map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              <span className={step === s || isAfter(step, s) ? 'text-black font-medium' : ''}>
                {i + 1}. {STEP_LABELS[s]}
              </span>
              {i < steps.length - 1 && <span className="mx-1">›</span>}
            </span>
          ))}
        </div>

        {step === 'review' && (
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-bold">Review your order</h1>

            <div className="border border-gray-100 rounded-2xl p-5">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold text-black">{plan.name} Plan</p>
                  <p className="text-sm text-gray-500">{plan.duration}</p>
                  {isUpgrade && (
                    <p className="text-xs text-green-600 font-medium mt-1">⬆ Upgrade</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-bold text-black">{formatCurrency(plan.price, plan.currency)}</p>
                  {planUsdEquiv && (
                    <p className="text-xs text-gray-400 mt-0.5">≈ ${planUsdEquiv}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-black bg-gray-50 px-4 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-black text-white">
                <CreditCard className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-black">Pay online with YooKassa</p>
                <p className="text-xs text-gray-400">Card, SBP, YooMoney, Mir</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600">
              You will be redirected to a secure YooKassa page. Your VPN will activate automatically after payment.
            </div>

            <Button onClick={handleConfirmPlan} loading={creatingOrder || cardProcessing} className="w-full">
              Continue to payment
            </Button>
          </div>
        )}

        {step === 'payment' && (
          <div className="flex flex-col gap-6">
            <h1 className="text-2xl font-bold">Complete your payment</h1>

            <div className="border border-gray-100 rounded-2xl p-5 flex flex-col gap-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Amount to pay</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold">{formatCurrency(plan.price, plan.currency)}</p>
                  {planUsdEquiv !== null && plan.currency.toUpperCase() !== 'USD' && (
                    <p className="text-sm text-gray-400">≈ ${planUsdEquiv.toFixed(2)} USD</p>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                  <CreditCard className="w-4 h-4" />
                  <span>Visa, Mastercard, Mir, SBP, YooMoney</span>
                </div>

                {cardProcessing ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                    <p className="text-sm text-gray-500">Redirecting to YooKassa…</p>
                  </div>
                ) : (
                  <button
                    onClick={() => orderId && handleCardPayment(orderId)}
                    disabled={!orderId}
                    className="flex items-center justify-center gap-2 w-full h-12 bg-black text-white rounded-xl text-sm font-semibold hover:bg-gray-800 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Pay with YooKassa
                  </button>
                )}
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 leading-relaxed">
              You'll be redirected to a secure YooKassa payment page. After payment,
              your VPN will be activated automatically within a minute.
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-6 text-center py-8">
            <CheckCircle className="w-16 h-16 text-black" />
            <h1 className="text-2xl font-bold">Payment complete!</h1>
            <p className="text-gray-500 max-w-sm">
              Your payment has been processed. Your VPN service will be activated automatically within a minute.
            </p>
            <Button onClick={() => navigate('/dashboard')} className="w-full max-w-xs">
              Go to dashboard
            </Button>
          </div>
        )}
      </main>
    </PageTransition>
  );
}

function isAfter(current: Step, target: Step): boolean {
  const order: Step[] = ['review', 'payment', 'done'];
  return order.indexOf(current) > order.indexOf(target);
}
