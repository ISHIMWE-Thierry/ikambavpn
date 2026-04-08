import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Shield, Wrench } from 'lucide-react';
import { getAppConfig, type AppConfig } from '../lib/db-service';
import { APP_BUILD } from '../lib/version';
import { APP_VERSION, compareVersions } from '../lib/app-version';

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
  const [remoteVersion, setRemoteVersion] = useState('');
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    getAppConfig().then((cfg: AppConfig) => {
      if (cfg.maintenanceMode) {
        setMessage(cfg.maintenanceMessage || 'We\'re doing a quick upgrade. Back shortly.');
        setState('maintenance');
        return;
      }

      // Check numeric build number
      if (APP_BUILD < cfg.minBuildNumber) {
        setState('outdated');
        return;
      }

      // Check semver version — critical (blocking)
      if (cfg.versionMinimum && compareVersions(APP_VERSION, cfg.versionMinimum) < 0) {
        setRemoteVersion(cfg.version || cfg.versionMinimum);
        setMessage(cfg.versionMessage || 'Critical update required. Please refresh.');
        setState('outdated');
        return;
      }

      // Check semver version — force refresh
      if (cfg.version && cfg.versionForceRefresh && compareVersions(APP_VERSION, cfg.version) < 0) {
        setRemoteVersion(cfg.version);
        setMessage(cfg.versionMessage || 'An important update is available.');
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
                  <p className="text-gray-500 text-sm leading-relaxed mb-2">
                    A new version of Ikamba VPN is available. Tap below to get the latest version.
                  </p>
                  {message && (
                    <p className="text-sm text-gray-700 font-medium mb-6">{message}</p>
                  )}
                  {!message && <div className="mb-6" />}
                  <button
                    onClick={handleReload}
                    disabled={reloading}
                    className="w-full h-12 rounded-full bg-black text-white text-sm font-semibold
                      flex items-center justify-center gap-2 hover:bg-gray-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${reloading ? 'animate-spin' : ''}`} />
                    {reloading ? 'Updating…' : 'Update now'}
                  </button>
                  <p className="text-xs text-gray-400 mt-4">
                    {APP_VERSION}{remoteVersion ? ` → ${remoteVersion}` : ' → latest'}
                  </p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
