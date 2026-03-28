import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
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
    description: 'Great for personal use',
    duration: '1 Month',
    price: 5,
    currency: 'USD',
    features: ['1 device', 'Standard speed', 'Global servers', 'No-logs policy'],
  },
  {
    id: 'standard-1m',
    name: 'Standard',
    description: 'For everyday protection',
    duration: '1 Month',
    price: 9,
    currency: 'USD',
    features: ['3 devices', 'High speed', 'Global servers', 'No-logs policy', 'Priority support'],
    popular: true,
  },
  {
    id: 'premium-3m',
    name: 'Premium',
    description: 'Best value — 3 months',
    duration: '3 Months',
    price: 22,
    currency: 'USD',
    features: [
      '5 devices',
      'Highest speed',
      'Global servers',
      'No-logs policy',
      'Priority support',
      'Dedicated IP option',
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
                {formatCurrency(plan.price, plan.currency)}
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
