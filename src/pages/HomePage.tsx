import { Link, Navigate } from 'react-router-dom';
import { useRef, useState } from 'react';
import { Lock, Zap, Globe, Shield, Check, ArrowRight } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAuth } from '../contexts/AuthContext';

const steps = [
  {
    n: '01',
    title: 'Create & verify',
    desc: 'Sign up with email and verify your account in under a minute.',
  },
  {
    n: '02',
    title: 'Choose a plan',
    desc: 'Basic, Popular, or Premium — or start with a free 1-hour trial.',
  },
  {
    n: '03',
    title: 'Connect',
    desc: 'Paste your link into any V2Ray-compatible app and you\'re live.',
  },
];

const features = [
  {
    icon: Lock,
    title: 'AES-256 encrypted',
    desc: 'Every byte of your traffic is fully encrypted end-to-end.',
  },
  {
    icon: Zap,
    title: 'Low-latency routing',
    desc: 'Optimized server paths for fast, stable connections.',
  },
  {
    icon: Globe,
    title: 'Works where others fail',
    desc: 'VLESS + REALITY protocol bypasses deep packet inspection.',
  },
  {
    icon: Shield,
    title: 'Zero logs, always',
    desc: 'We never store, sell, or share your activity. Ever.',
  },
];

const plans = [
  {
    name: 'Basic',
    price: 49,
    period: 'month',
    devices: 1,
    premiumSupport: false,
    popular: false,
  },
  {
    name: 'Popular',
    price: 79,
    period: 'month',
    devices: 3,
    premiumSupport: false,
    popular: true,
  },
  {
    name: 'Premium',
    price: 99,
    period: 'month',
    devices: 5,
    premiumSupport: true,
    popular: false,
  },
];

function PricingCard({
  name, price, period, devices, premiumSupport, popular, active,
}: typeof plans[0] & { active: boolean }) {
  return (
    <div className={`relative rounded-2xl border p-6 flex flex-col transition-all duration-300 h-full ${
      popular
        ? 'border-black shadow-xl bg-black text-white'
        : 'border-gray-100 bg-white shadow-sm'
    } ${active && popular ? 'scale-[1.03]' : ''}`}>
      {popular && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2
          bg-white text-black text-[11px] font-semibold px-3 py-0.5
          rounded-full border border-gray-200 whitespace-nowrap">
          Most popular
        </span>
      )}
      <p className="text-xs font-semibold uppercase tracking-wider mb-4 text-gray-400">{name}</p>
      <div className="mb-5 flex items-baseline gap-1">
        <span className="text-3xl font-bold">{price} ₽</span>
        <span className={`text-sm ${popular ? 'text-gray-500' : 'text-gray-400'}`}>/ {period}</span>
      </div>
      <ul className="flex flex-col gap-2 mb-7 flex-1">
        {[
          `${devices} device${devices > 1 ? 's' : ''}`,
          'All servers',
          'Zero logs',
          ...(premiumSupport ? ['Premium support'] : []),
        ].map((f) => (
          <li key={f} className={`flex items-center gap-2 text-xs ${popular ? 'text-gray-300' : 'text-gray-600'}`}>
            <Check className={`w-3.5 h-3.5 shrink-0 ${popular ? 'text-white' : 'text-black'}`} />
            {f}
          </li>
        ))}
      </ul>
      <Link
        to="/signup"
        className={`block w-full text-center rounded-xl py-2.5 text-sm font-semibold
          transition-colors duration-150 ${
          popular ? 'bg-white text-black hover:bg-gray-100' : 'bg-black text-white hover:bg-gray-800'
        }`}
      >
        Get {name}
      </Link>
    </div>
  );
}

function PricingCarousel() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(1);
  const lastIdxRef = useRef(1);

  function vibrate() {
    try { if ('vibrate' in navigator) navigator.vibrate(10); } catch { /* noop */ }
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.scrollWidth / plans.length;
    const idx = Math.min(plans.length - 1, Math.max(0, Math.round(el.scrollLeft / cardWidth)));
    if (idx !== lastIdxRef.current) {
      lastIdxRef.current = idx;
      setActiveIdx(idx);
      vibrate();
    }
  }

  return (
    <>
      {/* Mobile: horizontal snap scroll */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="sm:hidden no-scrollbar"
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'nowrap',
          gap: '16px',
          overflowX: 'scroll',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollSnapType: 'x mandatory',
          paddingLeft: 'calc(50vw - 140px)',
          paddingRight: 'calc(50vw - 140px)',
          paddingBottom: '24px',
          paddingTop: '20px',
        }}
      >
        {plans.map((plan, i) => (
          <div
            key={plan.name}
            style={{ scrollSnapAlign: 'center', flexShrink: 0, width: '280px' }}
          >
            <PricingCard {...plan} active={activeIdx === i} />
          </div>
        ))}
      </div>

      {/* Dot indicators — mobile only */}
      <div className="sm:hidden flex justify-center gap-1.5 mb-2">
        {plans.map((_, i) => (
          <div
            key={i}
            className={`rounded-full transition-all duration-300 ${
              activeIdx === i ? 'w-4 h-1.5 bg-black' : 'w-1.5 h-1.5 bg-gray-300'
            }`}
          />
        ))}
      </div>

      {/* Desktop: 3-column grid */}
      <div className="hidden sm:grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto px-6">
        {plans.map((plan, i) => (
          <div key={plan.name} className={`pt-5 ${plan.popular ? 'scale-[1.03]' : ''}`}>
            <PricingCard {...plan} active={i === 1} />
          </div>
        ))}
      </div>
    </>
  );
}

export function HomePage() {
  const { firebaseUser, loading } = useAuth();

  if (!loading && firebaseUser) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <main className="flex-1 overflow-hidden">

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative flex flex-col items-center justify-center text-center
        px-4 sm:px-6 py-28 min-h-[88vh]">
        <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="hero-orb-1" />
          <div className="hero-orb-2" />
        </div>

        <div className="anim-hero" style={{ animationDelay: '0ms' }}>
          <div className="inline-flex items-center gap-2 border border-gray-200 rounded-full
            px-4 py-1.5 text-xs text-gray-500 mb-10 bg-white/80 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block shrink-0" />
            Servers online — all regions
          </div>
        </div>

        <h1
          className="text-5xl sm:text-[68px] font-bold tracking-tight leading-[1.04] mb-6 anim-hero"
          style={{ animationDelay: '80ms' }}
        >
          Private.<br />
          <span className="text-gray-300">Unrestricted.</span>
        </h1>

        <p
          className="text-base sm:text-lg text-gray-500 max-w-sm mx-auto mb-10 leading-relaxed anim-hero"
          style={{ animationDelay: '160ms' }}
        >
          One link. Works on every device.<br />No logs, no limits, no contracts.
        </p>

        <div
          className="flex flex-col sm:flex-row gap-3 justify-center anim-hero"
          style={{ animationDelay: '240ms' }}
        >
          <Link to="/signup">
            <Button size="lg" className="min-w-[180px]">
              Try free — 1 hour
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link to="/plans">
            <Button size="lg" variant="secondary" className="min-w-[140px]">
              View plans
            </Button>
          </Link>
        </div>

        <div
          className="mt-14 flex flex-wrap justify-center gap-x-8 gap-y-3 anim-hero"
          style={{ animationDelay: '320ms' }}
        >
          {['No activity logs', 'Unlimited bandwidth', 'Works in Russia', 'Cancel anytime'].map((h) => (
            <span key={h} className="flex items-center gap-1.5 text-sm text-gray-400">
              <Check className="w-3.5 h-3.5 text-black shrink-0" />
              {h}
            </span>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100 py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.15em] text-center mb-12">
            How it works
          </p>
          <div className="grid sm:grid-cols-3 gap-10">
            {steps.map(({ n, title, desc }) => (
              <div key={n} className="flex flex-col gap-3">
                <span className="text-[40px] font-bold text-gray-100 leading-none">{n}</span>
                <h3 className="font-semibold text-black">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="bg-gray-50/70 py-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.15em] text-center mb-12">
            Why Ikamba VPN
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm
                  hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className="w-9 h-9 rounded-xl bg-black flex items-center justify-center mb-4">
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <h3 className="font-semibold text-black text-sm mb-1.5">{title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing preview ───────────────────────────────────────────────── */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <p className="text-[11px] text-gray-400 uppercase tracking-[0.15em] text-center mb-3">
            Pricing
          </p>
          <h2 className="text-3xl font-bold text-center text-black mb-2">
            Under 100 ₽ / month
          </h2>
          <p className="text-center text-sm text-gray-400 mb-12">
            Transparent pricing. No hidden fees.
          </p>
        </div>

        {/* Desktop: 3-column grid — Mobile: horizontal snap carousel */}
        <PricingCarousel />

        <p className="text-center text-xs text-gray-400 mt-8 px-4">
          First-time users get 1 hour free — no card required.
        </p>
      </section>

      {/* ── CTA ───────────────────────────────────────────────────────────── */}
      <section className="px-4 sm:px-6 pb-16">
        <div className="max-w-4xl mx-auto bg-black rounded-3xl px-8 py-16 text-center text-white">
          <h2 className="text-3xl font-bold mb-3">Start for free</h2>
          <p className="text-gray-400 text-sm mb-8 max-w-xs mx-auto">
            Create your account, verify your email, and get 1 hour free access instantly.
          </p>
          <Link to="/signup">
            <Button variant="secondary" size="lg">
              Create account
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

    </main>
  );
}
