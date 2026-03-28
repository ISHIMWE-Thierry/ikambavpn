import { useEffect, useState, useRef, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, CheckCircle, Copy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createOrder, getPaymentAccounts, uploadPaymentProof, updateOrderStatus } from '../lib/db-service';
import { Button } from '../components/ui/button';
import { formatCurrency } from '../lib/utils';
import type { VpnPlan, PaymentAccount } from '../types';
import toast from 'react-hot-toast';

type Step = 'review' | 'payment' | 'proof' | 'done';

export function CheckoutPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();

  const plan = (location.state as { plan?: VpnPlan })?.plan;

  const [step, setStep] = useState<Step>('review');
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PaymentAccount | null>(null);
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
    getPaymentAccounts()
      .then((accounts) => {
        setPaymentAccounts(accounts);
        if (accounts.length) setSelectedAccount(accounts[0]);
      })
      .catch(() => {});
  }, [plan, navigate]);

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
        userName: profile?.fullName || firebaseUser.displayName,
        planId: plan.id,
        planName: plan.name,
        planDuration: plan.duration,
        amount: plan.price,
        currency: plan.currency,
        status: 'pending_payment',
        paymentMethod: selectedAccount?.method || 'Manual',
      });
      setOrderId(id);
      setStep('payment');
    } catch {
      toast.error('Failed to create order. Please try again.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setProofFile(file);
  };

  const handleUploadProof = async () => {
    if (!proofFile || !orderId) return;
    setUploading(true);
    try {
      const url = await uploadPaymentProof(orderId, proofFile);
      await updateOrderStatus(orderId, 'payment_submitted', { paymentProofUrl: url });
      setStep('done');
    } catch {
      toast.error('Failed to upload proof. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  };

  return (
    <main className="flex-1 max-w-lg mx-auto px-4 py-12">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-8 text-xs text-gray-400">
        {(['review', 'payment', 'proof', 'done'] as Step[]).map((s, i) => (
          <span key={s} className="flex items-center gap-2">
            <span className={step === s || isAfter(step, s) ? 'text-black font-medium' : ''}>
              {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
            {i < 3 && <span>›</span>}
          </span>
        ))}
      </div>

      {/* Step: Review plan */}
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

          {paymentAccounts.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Payment method</p>
              <div className="flex flex-col gap-2">
                {paymentAccounts.map((acc) => (
                  <label
                    key={acc.id}
                    className={`flex items-center gap-3 border rounded-xl px-4 py-3 cursor-pointer transition ${
                      selectedAccount?.id === acc.id ? 'border-black' : 'border-gray-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      checked={selectedAccount?.id === acc.id}
                      onChange={() => setSelectedAccount(acc)}
                      className="accent-black"
                    />
                    <span className="text-sm font-medium">{acc.method}</span>
                    {acc.provider && <span className="text-sm text-gray-400">({acc.provider})</span>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {paymentAccounts.length === 0 && (
            <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-3">
              Payment instructions will be provided on the next step.
            </p>
          )}

          <Button onClick={handleConfirmPlan} loading={creatingOrder} className="w-full">
            Confirm & proceed to payment
          </Button>
        </div>
      )}

      {/* Step: Payment instructions */}
      {step === 'payment' && selectedAccount && (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-bold">Make your payment</h1>

          <div className="border border-gray-100 rounded-2xl p-5 flex flex-col gap-4">
            <p className="text-sm font-medium text-gray-500">Amount to pay</p>
            <p className="text-3xl font-bold">{formatCurrency(plan.price, plan.currency)}</p>

            <div className="border-t border-gray-100 pt-4 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">{selectedAccount.method}</span>
                {selectedAccount.provider && (
                  <span className="text-sm text-gray-400">{selectedAccount.provider}</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Account name</span>
                <span className="text-sm font-medium">{selectedAccount.accountName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Account number</span>
                <button
                  onClick={() => copyToClipboard(selectedAccount.accountNumber)}
                  className="flex items-center gap-1 text-sm font-medium hover:underline"
                >
                  {selectedAccount.accountNumber}
                  <Copy className="w-3.5 h-3.5 text-gray-400" />
                </button>
              </div>
            </div>
          </div>

          {selectedAccount.instructions && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600 leading-relaxed">
              {selectedAccount.instructions}
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

      {/* Step: Upload proof */}
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
            <Upload className="w-8 h-8 text-gray-400" />
            {proofFile ? (
              <p className="text-sm font-medium text-black">{proofFile.name}</p>
            ) : (
              <p className="text-sm text-gray-400">Click to upload your screenshot</p>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
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

      {/* Step: Done */}
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
  );
}

function isAfter(current: Step, target: Step): boolean {
  const order: Step[] = ['review', 'payment', 'proof', 'done'];
  return order.indexOf(current) > order.indexOf(target);
}
