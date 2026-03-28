import { Link } from 'react-router-dom';
import { Shield, Lock, Zap, Globe, Check } from 'lucide-react';
import { Button } from '../components/ui/button';

const features = [
  {
    icon: Lock,
    title: 'Military-grade encryption',
    desc: 'AES-256 encryption keeps your traffic completely private.',
  },
  {
    icon: Zap,
    title: 'Fast, reliable servers',
    desc: 'High-speed servers in multiple locations for smooth browsing.',
  },
  {
    icon: Globe,
    title: 'Global access',
    desc: 'Bypass geo-restrictions and access content from anywhere.',
  },
  {
    icon: Shield,
    title: 'No-logs policy',
    desc: 'We never store your activity. Your privacy is guaranteed.',
  },
];

const highlights = [
  'No activity logs',
  'Unlimited bandwidth',
  'Easy setup on any device',
  'Cancel anytime',
  '24/7 support',
  'Shared & dedicated plans',
];

export function HomePage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-24 text-center">
        <div className="inline-flex items-center gap-2 bg-gray-100 rounded-full px-4 py-1.5 text-sm text-gray-600 mb-8">
          <Shield className="w-3.5 h-3.5" />
          Trusted VPN for Africa & beyond
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-black leading-tight mb-6">
          Private internet,<br />
          <span className="text-gray-400">wherever you are.</span>
        </h1>

        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-10">
          Ikamba VPN gives you secure, encrypted internet access in seconds.
          Simple plans. No contracts. No logs.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link to="/plans">
            <Button size="lg">View plans</Button>
          </Link>
          <Link to="/signup">
            <Button size="lg" variant="secondary">Create account</Button>
          </Link>
        </div>

        <div className="mt-12 flex flex-wrap justify-center gap-x-8 gap-y-3">
          {highlights.map((h) => (
            <span key={h} className="flex items-center gap-1.5 text-sm text-gray-500">
              <Check className="w-3.5 h-3.5 text-black" />
              {h}
            </span>
          ))}
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-gray-100" />

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-14">Everything you need</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex flex-col gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                <Icon className="w-5 h-5 text-black" />
              </div>
              <h3 className="font-semibold text-black">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-black mx-4 sm:mx-6 rounded-3xl mb-16 max-w-6xl lg:mx-auto px-8 py-16 text-center text-white">
        <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
        <p className="text-gray-400 mb-8 max-w-md mx-auto">
          Pick a plan, pay securely, and get your VPN credentials instantly after activation.
        </p>
        <Link to="/plans">
          <Button variant="secondary" size="lg">See all plans</Button>
        </Link>
      </section>
    </main>
  );
}
