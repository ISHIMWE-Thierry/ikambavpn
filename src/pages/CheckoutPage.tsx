import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, Copy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createOrder, uploadPaymentProof, updateOrderStatus, getAppSettings, getUserOrders, type AppPaymentSettings } from '../lib/db-service';
import { notifyAdminsNewOrder, notifyAdminsPaymentProof } from '../lib/email-service';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../lib/utils';
import { PageTransition } from '../components/PageTransition';
import type { VpnPlan } from '../types';
import toast from 'react-hot-toast';

type Step = 'review' | 'payment' | 'proof' | 'done';

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

  const [step, setStep] = useState<Step>('review');
  const [paymentSettings, setPaymentSettings] = useState<AppPaymentSettings | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!plan) {
      navigate('/plans');
      return;
    }
    // Load payment account details from shared appdata (same doc as Blink-1)
    getAppSettings().then(setPaymentSettings);

    // Block duplicate orders — if user has a pending order, redirect to dashboard
    if (firebaseUser) {
      getUserOrders(firebaseUser.uid).then((orders) => {
        const pending = orders.find(
          (o) => o.status === 'pending_payment' || o.status === 'payment_submitted',
        );
        if (pending) {
          toast('You already have a pending order. Complete it first.', { icon: '⏳' });
          navigate('/dashboard');
        }
      }).catch(() => {});
    }
  }, [plan, navigate, firebaseUser]);

  if (!plan) return null;

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
        paymentMethod: paymentSettings?.depositBankName || 'Bank Transfer',
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
      setStep('payment');
    } catch {
      toast.error('Failed to create order. Please try again.');
    } finally {
      setCreatingOrder(false);
    }
  };

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

  const steps = Object.keys(STEP_LABELS) as Step[];

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
              </div>
              <p className="font-bold text-black">{formatCurrency(plan.price, plan.currency)}</p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600">
            You will receive payment instructions on the next step. After paying, upload a screenshot to confirm.
          </div>

          <Button onClick={handleConfirmPlan} loading={creatingOrder} className="w-full">
            Continue to payment
          </Button>
        </div>
      )}

      {/* Step 2: Payment instructions */}
      {step === 'payment' && (
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
