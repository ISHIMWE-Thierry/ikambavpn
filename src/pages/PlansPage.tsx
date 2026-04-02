import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Shield } from 'lucide-react';
import { getPlans } from '../lib/db-service';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { formatCurrency } from '../lib/utils';
import type { VpnPlan } from '../types';

// Fallback static plans if Firestore has none yet
const DEFAULT_PLANS: VpnPlan[] = [
  {
    id: 'basic-1m',
    name: 'Basic',
    description: 'Essential protection',
    duration: '1 Month',
    price: 49,
    currency: 'RUB',
    features: ['1 device', 'All servers', 'No-logs policy', 'Standard support'],
  },
  {
    id: 'popular-1m',
    name: 'Popular',
    description: 'Most chosen plan',
    duration: '1 Month',
    price: 79,
    currency: 'RUB',
    features: ['3 devices', 'All servers', 'No-logs policy', 'Standard support'],
    popular: true,
  },
  {
    id: 'premium-1m',
    name: 'Premium',
    description: 'Full access + priority support',
    duration: '1 Month',
    price: 99,
    currency: 'RUB',
    features: [
      '5 devices',
      'All servers',
      'No-logs policy',
      'Premium support',
    ],
  },
];

export function PlansPage() {
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState<VpnPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPlans()
      .then((p) => setPlans(p.length ? p : DEFAULT_PLANS))
      .catch(() => setPlans(DEFAULT_PLANS))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (plan: VpnPlan) => {
    if (!firebaseUser) {
      navigate('/signup');
      return;
    }
    navigate('/checkout', { state: { plan } });
  };

  const handleTrial = () => {
    if (!firebaseUser) {
      navigate('/signup', { state: { from: { pathname: '/trial' } } });
      return;
    }
    navigate('/trial');
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-6xl mx-auto px-4 sm:px-6 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-black mb-3">Choose your plan</h1>
        <p className="text-gray-500 max-w-md mx-auto">
          Simple, transparent pricing. No hidden fees. Cancel or renew anytime.
        </p>
      </div>

      {/* Free trial banner */}
      <div className="mb-10 border border-gray-100 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gray-50">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shrink-0">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-black">Try free for 1 hour</p>
            <p className="text-sm text-gray-500 mt-0.5">No payment required. One trial per account.</p>
          </div>
        </div>
        <Button variant="secondary" className="shrink-0" onClick={handleTrial}>
          Start free trial
        </Button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`relative flex flex-col rounded-2xl border ${
              plan.popular
                ? 'border-black shadow-lg'
                : 'border-gray-100 shadow-sm'
            } bg-white p-6`}
          >
            {plan.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge>Most popular</Badge>
              </div>
            )}

            <div className="mb-6">
              <h2 className="text-xl font-bold text-black">{plan.name}</h2>
              <p className="text-sm text-gray-500 mt-1">{plan.description}</p>
            </div>

            <div className="mb-6">
              <span className="text-4xl font-bold text-black">
                {plan.currency === 'RUB' ? `${plan.price} ₽` : formatCurrency(plan.price, plan.currency)}
              </span>
              <span className="text-gray-400 text-sm ml-1">/ {plan.duration}</span>
            </div>

            <ul className="flex flex-col gap-2 mb-8 flex-1">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                  <Check className="w-4 h-4 text-black mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>

            <Button
              variant={plan.popular ? 'primary' : 'secondary'}
              className="w-full"
              onClick={() => handleSelect(plan)}
            >
              Get {plan.name}
            </Button>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-gray-400 mt-10">
        Questions?{' '}
        <a href="mailto:support@ikamba.com" className="underline hover:text-black">
          Contact support
        </a>
      </p>
    </main>
  );
}
