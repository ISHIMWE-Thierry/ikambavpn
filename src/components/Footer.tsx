import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-gray-100 bg-white mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2 font-bold text-black">
            <Shield className="w-5 h-5" />
            Ikamba VPN
          </Link>

          <nav className="flex flex-wrap justify-center gap-6 text-sm text-gray-500">
            <Link to="/plans" className="hover:text-black transition-colors">Plans</Link>
            <Link to="/signin" className="hover:text-black transition-colors">Sign in</Link>
            <Link to="/signup" className="hover:text-black transition-colors">Get started</Link>
          </nav>
        </div>

        <div className="border-t border-gray-100 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <nav className="flex flex-wrap justify-center gap-5 text-xs text-gray-400">
            <Link to="/terms" className="hover:text-black transition-colors">Terms of Service</Link>
            <Link to="/privacy" className="hover:text-black transition-colors">Privacy Policy</Link>
            <Link to="/refund-policy" className="hover:text-black transition-colors">Refund Policy</Link>
          </nav>
          <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} Ikamba VPN. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
