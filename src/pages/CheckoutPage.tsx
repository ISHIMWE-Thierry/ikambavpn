import { useEffect, useState, useRef, useCallback, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, Copy, CreditCard, Building2, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createOrder, uploadPaymentProof, updateOrderStatus, getAppSettings, getUserOrders, type AppPaymentSettings } from '../lib/db-service';
import { notifyAdminsNewOrder, notifyAdminsPaymentProof } from '../lib/email-service';
import { initRevenueCat, getCurrentOffering, purchasePackage, isRevenueCatReady } from '../lib/revenuecat';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../lib/utils';
import { PageTransition } from '../components/PageTransition';
import type { VpnPlan } from '../types';
import type { Package as RCPackage } from '@revenuecat/purchases-js';
import toast from 'react-hot-toast';

type Step = 'review' | 'payment' | 'proof' | 'done';
type PaymentMethod = 'bank' | 'card';

const STEP_LABELS: Record<Step, string> = {
  review: 'Review',
  payment: 'Payment',
  proof: 'Proof',
  done: 'Done',
};

export function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();

  const plan = (location.state as { plan?: VpnPlan })?.plan;
  const isUpgrade = (location.state as { isUpgrade?: boolean })?.isUpgrade ?? false;

  const [step, setStep] = useState<Step>('review');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank');
  const [paymentSettings, setPaymentSettings] = useState<AppPaymentSettings | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RevenueCat card payment state
  const [cardProcessing, setCardProcessing] = useState(false);
  const [rcPackages, setRcPackages] = useState<RCPackage[]>([]);

  // Whether RevenueCat card option is available
  const rcApiKeySet = !!import.meta.env.VITE_REVENUECAT_API_KEY;
  const cardAvailable = rcApiKeySet;

  // Compute USD equivalent using admin rate
  const rubRate = paymentSettings?.rubToUsdRate || 0;
  const planUsdEquiv = (plan && plan.currency === 'RUB' && rubRate > 0)
    ? +(plan.price / rubRate).toFixed(2)
    : null;

  useEffect(() => {
    if (!plan) {
      navigate('/plans');
      return;
    }
    // Load payment account details from shared appdata (same doc as Blink-1)
    getAppSettings().then(setPaymentSettings);

    // Init RevenueCat and load offerings
    if (firebaseUser && rcApiKeySet) {
      initRevenueCat(firebaseUser.uid);
      getCurrentOffering().then((offering) => {
        if (offering) setRcPackages(offering.availablePackages);
      }).catch((err) => console.warn('[Checkout] RC offerings fetch failed:', err));
    }

    // Guard: block if user has pending order OR has active plan (unless upgrading)
    if (firebaseUser) {
      getUserOrders(firebaseUser.uid).then((orders) => {
        // Block if pending order exists
        const pending = orders.find(
          (o) => o.status === 'pending_payment' || o.status === 'payment_submitted',
        );
        if (pending) {
          toast('You already have a pending order. Complete it first.', { icon: '⏳' });
          navigate('/dashboard');
          return;
        }

        // Block if active plan exists and this is NOT an upgrade
        const active = orders.find(
          (o) => o.status === 'active' && !!o.expiresAt && new Date(o.expiresAt) > new Date(),
        );
        if (active && !isUpgrade) {
          toast('You already have an active plan. Upgrade from your dashboard.', { icon: '✅' });
          navigate('/dashboard');
          return;
        }

        // If upgrading, ensure new plan is actually higher value
        if (active && isUpgrade && plan.price <= active.amount) {
          toast('You can only upgrade to a higher plan.', { icon: '⬆️' });
          navigate('/dashboard');
          return;
        }
      }).catch(() => {});
    }
  }, [plan, navigate, firebaseUser, isUpgrade]);

  if (!plan) return null;

  const handleConfirmPlan = async () => {
    if (!firebaseUser) {
      navigate('/signin');
      return;
    }
    setCreatingOrder(true);
    try {
      const methodLabel = paymentMethod === 'card'
        ? 'Card (RevenueCat)'
        : paymentSettings?.depositBankName || 'Bank Transfer';

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
        paymentMethod: methodLabel,
      });
      setOrderId(id);
      // Notify admins — fire and forget, never block the user
      notifyAdminsNewOrder({
        orderId: id,
        userName: profile ? `${profile.firstname} ${profile.lastname}`.trim() : firebaseUser.displayName,
        userEmail: firebaseUser.email,
        planName: plan.name,
        planDuration: plan.duration,
        amount: plan.price,
        currency: plan.currency,
      }).catch(() => {});

      if (paymentMethod === 'card') {
        // RevenueCat flow: open Stripe checkout via RC SDK
        await handleCardPayment(id);
      } else {
        setStep('payment');
      }
    } catch (err: any) {
      console.error('[Checkout] Order creation failed:', err);
      toast.error('Failed to create order. Please try again.');
    } finally {
      setCreatingOrder(false);
    }
  };

  /** RevenueCat card payment: find matching RC package → open checkout */
  const handleCardPayment = useCallback(async (orderIdParam: string) => {
    if (!isRevenueCatReady()) {
      toast.error('Card payments are not configured yet.');
      return;
    }
    setCardProcessing(true);
    try {
      // Find the RevenueCat package that matches this plan by identifier or name
      let rcPkg = rcPackages.find(
        (p) => p.identifier === plan.id || p.identifier === `$rc_${plan.name.toLowerCase()}`,
      );
      // Fallback: pick the first package if only one exists, or by product name
      if (!rcPkg && rcPackages.length === 1) rcPkg = rcPackages[0];
      if (!rcPkg) rcPkg = rcPackages.find((p) => p.webBillingProduct?.title?.toLowerCase().includes(plan.name.toLowerCase()));

      if (!rcPkg) {
        toast.error('No matching product found. Please contact support.');
        setPaymentMethod('bank');
        setStep('payment');
        return;
      }

      // Open RevenueCat / Stripe checkout — this blocks until purchase is complete or cancelled
      const customerInfo = await purchasePackage(
        rcPkg,
        firebaseUser?.email || undefined,
      );

      // Purchase succeeded — update order status
      const hasEntitlement = Object.keys(customerInfo.entitlements.active).length > 0;
      if (hasEntitlement) {
        await updateOrderStatus(orderIdParam, 'payment_submitted', {
          rcPurchaseComplete: true,
        });
        toast.success('Payment received! 🎉');
        setStep('done');
      } else {
        // Payment went through but no entitlement yet — still mark as submitted
        await updateOrderStatus(orderIdParam, 'payment_submitted');
        setStep('done');
      }
    } catch (err: any) {
      console.error('[Checkout] RevenueCat card payment error:', err);
      // User may have closed the checkout — don't show error for cancellation
      if (err?.message?.includes('cancelled') || err?.message?.includes('closed')) {
        toast('Payment cancelled. You can retry or switch to bank transfer.', { icon: '↩️' });
      } else {
        toast.error('Card payment failed. Try bank transfer instead.');
      }
      setPaymentMethod('bank');
      setStep('payment');
    } finally {
      setCardProcessing(false);
    }
  }, [rcPackages, plan, firebaseUser]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File is too large. Maximum size is 10 MB.');
      return;
    }

    // Validate file type
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
    if (!allowed.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|heic|heif|pdf)$/i)) {
      toast.error('Please upload an image (JPG, PNG, WEBP) or PDF file.');
      return;
    }

    setProofFile(file);
  };

  const handleUploadProof = async () => {
    if (!proofFile || !orderId) return;
    setUploading(true);
    try {
      const url = await uploadPaymentProof(orderId, proofFile);
      await updateOrderStatus(orderId, 'payment_submitted', { paymentProofUrl: url });
      // Notify admins proof is ready for review — fire and forget
      notifyAdminsPaymentProof({
        orderId,
        userName: profile ? `${profile.firstname} ${profile.lastname}`.trim() : (firebaseUser?.displayName || null),
        userEmail: firebaseUser?.email || null,
        planName: plan.name,
        planDuration: plan.duration,
        amount: plan.price,
        currency: plan.currency,
        proofUrl: url,
      }).catch(() => {});
      setStep('done');
    } catch (err: any) {
      console.error('[Checkout] Upload failed:', err);
      const msg = err?.code === 'storage/unauthorized'
        ? 'Upload not authorised. Please sign in again and retry.'
        : err?.code === 'storage/canceled'
        ? 'Upload was cancelled. Please try again.'
        : err?.code === 'storage/retry-limit-exceeded'
        ? 'Network issue — please check your connection and try again.'
        : 'Failed to upload proof. Please try again.';
      toast.error(msg);
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };

  const steps = paymentMethod === 'card'
    ? (['review', 'payment', 'done'] as Step[])
    : (Object.keys(STEP_LABELS) as Step[]);

  return (
    <PageTransition>
    <main className="flex-1 max-w-lg mx-auto px-4 py-12">
      {/* Step indicator */}
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

      {/* Step 1: Review plan */}
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

          {/* Payment method selector */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Choose payment method</p>
            <div className="flex flex-col gap-2.5">
              {/* Bank transfer option — always available */}
              <button
                onClick={() => setPaymentMethod('bank')}
                className={`flex items-center gap-3 w-full text-left rounded-2xl border-2 px-4 py-4 transition-all
                  ${paymentMethod === 'bank'
                    ? 'border-black bg-gray-50'
                    : 'border-gray-100 hover:border-gray-300'
                  }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                  ${paymentMethod === 'bank' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
                >
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-black">Russian bank transfer</p>
                  <p className="text-xs text-gray-400">Sberbank, Tinkoff, SBP</p>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                  ${paymentMethod === 'bank' ? 'border-black' : 'border-gray-300'}`}
                >
                  {paymentMethod === 'bank' && <div className="w-2.5 h-2.5 rounded-full bg-black" />}
                </div>
              </button>

              {/* Card payment option — only if RevenueCat is configured */}
              {cardAvailable && (
                <button
                  onClick={() => setPaymentMethod('card')}
                  className={`flex items-center gap-3 w-full text-left rounded-2xl border-2 px-4 py-4 transition-all
                    ${paymentMethod === 'card'
                      ? 'border-black bg-gray-50'
                      : 'border-gray-100 hover:border-gray-300'
                    }`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                    ${paymentMethod === 'card' ? 'bg-black text-white' : 'bg-gray-100 text-gray-500'}`}
                  >
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-black">Pay with card</p>
                    <p className="text-xs text-gray-400">Visa, Mastercard, Apple Pay, Google Pay</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0
                    ${paymentMethod === 'card' ? 'border-black' : 'border-gray-300'}`}
                  >
                    {paymentMethod === 'card' && <div className="w-2.5 h-2.5 rounded-full bg-black" />}
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600">
            {paymentMethod === 'card'
              ? 'You will be redirected to a secure payment page to complete your purchase.'
              : 'You will receive payment instructions on the next step. After paying, upload a screenshot to confirm.'}
          </div>

          <Button onClick={handleConfirmPlan} loading={creatingOrder || cardProcessing} className="w-full">
            {paymentMethod === 'card' ? 'Continue to card payment' : 'Continue to payment'}
          </Button>
        </div>
      )}

      {/* Step 2: Payment instructions (card via RevenueCat) */}
      {step === 'payment' && paymentMethod === 'card' && (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-bold">Complete card payment</h1>

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
                <span>Visa, Mastercard, Apple Pay, Google Pay</span>
              </div>

              {cardProcessing ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  <p className="text-sm text-gray-500">Opening secure checkout…</p>
                </div>
              ) : (
                <button
                  onClick={() => orderId && handleCardPayment(orderId)}
                  disabled={!orderId || rcPackages.length === 0}
                  className="flex items-center justify-center gap-2 w-full h-12 bg-black text-white
                    rounded-xl text-sm font-semibold hover:bg-gray-800 active:scale-[0.98]
                    transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CreditCard className="w-4 h-4" />
                  Pay with card
                </button>
              )}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 leading-relaxed">
            Click the button above to open the secure checkout. You'll be able to pay with your card,
            Apple Pay, or Google Pay. Your order will be confirmed automatically.
          </div>

          <p className="text-xs text-gray-400 text-center">
            Having trouble?{' '}
            <button
              onClick={() => {
                setPaymentMethod('bank');
              }}
              className="underline hover:text-black transition"
            >
              Switch to bank transfer
            </button>
          </p>
        </div>
      )}

      {step === 'payment' && paymentMethod === 'bank' && (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-bold">Make your payment</h1>

          <div className="border border-gray-100 rounded-2xl p-5 flex flex-col gap-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Amount to pay</p>
              <p className="text-3xl font-bold">{formatCurrency(plan.price, plan.currency)}</p>
            </div>

            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              {paymentSettings ? (
                <>
                  <Row
                    label="Bank / Method"
                    value={paymentSettings.depositBankName}
                  />
                  <Row
                    label="Account name"
                    value={paymentSettings.depositAccountName}
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-500">Account / Phone</span>
                    <button
                      onClick={() => copyToClipboard(paymentSettings.depositAccountNumber)}
                      className="flex items-center gap-1.5 text-sm font-semibold hover:underline"
                    >
                      {paymentSettings.depositAccountNumber}
                      <Copy className="w-3.5 h-3.5 text-gray-400" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex justify-center py-4">
                  <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>

          {paymentSettings?.depositInstructions && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 leading-relaxed">
              {paymentSettings.depositInstructions}
            </div>
          )}

          <p className="text-sm text-gray-500">
            After making the payment, take a screenshot of the confirmation and upload it on the next step.
          </p>

          <Button onClick={() => setStep('proof')} className="w-full">
            I've made the payment →
          </Button>
        </div>
      )}

      {/* Step 3: Upload proof */}
      {step === 'proof' && (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-bold">Upload payment proof</h1>
          <p className="text-sm text-gray-500">
            Upload a screenshot or photo of your payment confirmation.
            Our team will review and activate your service within a few hours.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-gray-200 rounded-2xl p-10 flex flex-col items-center gap-3 cursor-pointer hover:border-black transition"
          >
            {proofFile && proofFile.type.startsWith('image/') ? (
              <img
                src={URL.createObjectURL(proofFile)}
                alt="Payment proof preview"
                className="max-h-48 rounded-xl object-contain"
              />
            ) : (
              <Upload className="w-8 h-8 text-gray-400" />
            )}
            {proofFile ? (
              <p className="text-sm font-medium text-black">{proofFile.name}</p>
            ) : (
              <p className="text-sm text-gray-400">Tap to upload your screenshot</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.heic,.heif"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <Button
            onClick={handleUploadProof}
            loading={uploading}
            disabled={!proofFile}
            className="w-full"
          >
            Submit payment proof
          </Button>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && (
        <div className="flex flex-col items-center gap-6 text-center py-8">
          <CheckCircle className="w-16 h-16 text-black" />
          <h1 className="text-2xl font-bold">Payment submitted!</h1>
          <p className="text-gray-500 max-w-sm">
            Your payment proof has been received. Our team will review it and activate your VPN service within a few hours.
            You'll be notified by email when it's ready.
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}

function isAfter(current: Step, target: Step): boolean {
  const order: Step[] = ['review', 'payment', 'proof', 'done'];
  return order.indexOf(current) > order.indexOf(target);
}
