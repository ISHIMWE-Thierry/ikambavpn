import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Menu, X, LogOut, LayoutDashboard, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';

export function Navbar() {
  const { firebaseUser, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 font-bold text-black text-lg">
          <Shield className="w-5 h-5" />
          Ikamba VPN
        </Link>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          <Link to="/plans" className="text-sm text-gray-600 hover:text-black transition-colors">
            Plans
          </Link>
          {firebaseUser ? (
            <>
              <Link to="/dashboard" className="text-sm text-gray-600 hover:text-black transition-colors">
                Dashboard
              </Link>
              {profile?.role === 'admin' && (
                <Link to="/admin" className="text-sm text-gray-600 hover:text-black transition-colors">
                  Admin
                </Link>
              )}
              <button
                onClick={handleSignOut}
                className="text-sm text-gray-600 hover:text-black transition-colors flex items-center gap-1"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/signin" className="text-sm text-gray-600 hover:text-black transition-colors">
                Sign in
              </Link>
              <Link to="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>

        {/* Mobile menu toggle */}
        <button
          className="sm:hidden p-2"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="sm:hidden bg-white border-t border-gray-100 px-4 py-4 flex flex-col gap-4">
          <Link to="/plans" className="text-sm text-gray-700" onClick={() => setMenuOpen(false)}>
            Plans
          </Link>
          {firebaseUser ? (
            <>
              <Link
                to="/dashboard"
                className="text-sm text-gray-700 flex items-center gap-2"
                onClick={() => setMenuOpen(false)}
              >
                <LayoutDashboard className="w-4 h-4" /> Dashboard
              </Link>
              {profile?.role === 'admin' && (
                <Link
                  to="/admin"
                  className="text-sm text-gray-700 flex items-center gap-2"
                  onClick={() => setMenuOpen(false)}
                >
                  Admin
                </Link>
              )}
              <Link
                to="/account"
                className="text-sm text-gray-700 flex items-center gap-2"
                onClick={() => setMenuOpen(false)}
              >
                <User className="w-4 h-4" /> Account
              </Link>
              <button
                onClick={handleSignOut}
                className="text-sm text-gray-700 flex items-center gap-2 text-left"
              >
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </>
          ) : (
            <>
              <Link to="/signin" className="text-sm text-gray-700" onClick={() => setMenuOpen(false)}>
                Sign in
              </Link>
              <Link to="/signup" onClick={() => setMenuOpen(false)}>
                <Button className="w-full">Get started</Button>
              </Link>
            </>
          )}
        </div>
      )}
    </header>
  );
}
