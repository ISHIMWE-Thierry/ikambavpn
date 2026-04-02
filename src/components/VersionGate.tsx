import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Shield, Wrench } from 'lucide-react';
import { getAppConfig, type AppConfig } from '../lib/db-service';
import { APP_BUILD } from '../lib/version';

type State = 'ok' | 'outdated' | 'maintenance';

async function forceReload() {
  // Unregister service workers first so they don't serve cached version
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
  // Hard reload — bypass cache
  window.location.reload();
}

export function VersionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('ok');
  const [message, setMessage] = useState('');
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    getAppConfig().then((cfg: AppConfig) => {
      if (cfg.maintenanceMode) {
        setMessage(cfg.maintenanceMessage || 'We\'re doing a quick upgrade. Back shortly.');
        setState('maintenance');
      } else if (APP_BUILD < cfg.minBuildNumber) {
        setState('outdated');
      }
    }).catch(() => {
      // Network error — don't block the user
    });
  }, []);

  const handleReload = async () => {
    setReloading(true);
    await forceReload();
  };

  return (
    <>
      {children}

      <AnimatePresence>
        {state !== 'ok' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center px-6 text-center"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.4, ease: 'easeOut' }}
              className="max-w-sm w-full"
            >
              <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-6">
                {state === 'maintenance'
                  ? <Wrench className="w-8 h-8 text-white" />
                  : <Shield className="w-8 h-8 text-white" />
                }
              </div>

              {state === 'maintenance' ? (
                <>
                  <h1 className="text-2xl font-bold text-black mb-3">Under maintenance</h1>
                  <p className="text-gray-500 text-sm leading-relaxed mb-8">{message}</p>
                  <button
                    onClick={handleReload}
                    disabled={reloading}
                    className="w-full h-12 rounded-full bg-black text-white text-sm font-semibold
                      flex items-center justify-center gap-2 hover:bg-gray-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
                    {reloading ? 'Refreshing…' : 'Try again'}
                  </button>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-black mb-3">Update required</h1>
                  <p className="text-gray-500 text-sm leading-relaxed mb-8">
                    A new version of Ikamba VPN is available. Tap below to get the latest version.
                  </p>
                  <button
                    onClick={handleReload}
                    disabled={reloading}
                    className="w-full h-12 rounded-full bg-black text-white text-sm font-semibold
                      flex items-center justify-center gap-2 hover:bg-gray-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
                    {reloading ? 'Updating…' : 'Update now'}
                  </button>
                  <p className="text-xs text-gray-400 mt-4">Build {APP_BUILD} → latest</p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
