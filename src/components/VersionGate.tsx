import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Shield, Wrench } from 'lucide-react';
import { getAppConfig, type AppConfig } from '../lib/db-service';
import { APP_BUILD } from '../lib/version';
import { APP_VERSION, compareVersions } from '../lib/app-version';

type State = 'ok' | 'outdated' | 'maintenance';

/** Storage key to prevent infinite reload loops */
const RELOAD_KEY = 'ikamba_version_reload';
const MAX_RELOADS = 2; // max auto-reloads before showing manual button

/**
 * Clear ALL caches aggressively:
 *  1. Unregister service workers
 *  2. Delete all Cache API entries (the CDN/SW cache)
 *  3. Clear localStorage (except reload-loop guard)
 *  4. Clear sessionStorage
 */
async function nukeAllCaches() {
  // 1. Unregister service workers
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }

  // 2. Delete all Cache API entries (Vite build cache, SW precache, etc.)
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }

  // 3. Clear localStorage (preserve reload-loop guard)
  const reloadCount = localStorage.getItem(RELOAD_KEY);
  localStorage.clear();
  if (reloadCount) localStorage.setItem(RELOAD_KEY, reloadCount);

  // 4. Clear sessionStorage
  sessionStorage.clear();
}

async function forceReload() {
  await nukeAllCaches();
  // Hard reload — bypass browser cache
  window.location.reload();
}

export function VersionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>('ok');
  const [message, setMessage] = useState('');
  const [remoteVersion, setRemoteVersion] = useState('');
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    getAppConfig().then(async (cfg: AppConfig) => {
      if (cfg.maintenanceMode) {
        setMessage(cfg.maintenanceMessage || 'We\'re doing a quick upgrade. Back shortly.');
        setState('maintenance');
        return;
      }

      let isOutdated = false;

      // Check numeric build number
      if (APP_BUILD < cfg.minBuildNumber) {
        isOutdated = true;
      }

      // Check semver version — critical (blocking)
      if (cfg.versionMinimum && compareVersions(APP_VERSION, cfg.versionMinimum) < 0) {
        setRemoteVersion(cfg.version || cfg.versionMinimum);
        setMessage(cfg.versionMessage || 'Critical update required. Please refresh.');
        isOutdated = true;
      }

      // Check semver version — force refresh
      if (!isOutdated && cfg.version && cfg.versionForceRefresh && compareVersions(APP_VERSION, cfg.version) < 0) {
        setRemoteVersion(cfg.version);
        setMessage(cfg.versionMessage || 'An important update is available.');
        isOutdated = true;
      }

      if (isOutdated) {
        // Auto-clear caches and reload (with loop protection)
        const reloadCount = Number(localStorage.getItem(RELOAD_KEY) || '0');
        if (reloadCount < MAX_RELOADS) {
          // Increment counter, nuke caches, and hard-reload automatically
          localStorage.setItem(RELOAD_KEY, String(reloadCount + 1));
          await nukeAllCaches();
          window.location.reload();
          return; // won't reach here — browser is reloading
        }
        // Exceeded auto-reload limit → show manual update screen
        // (means the deploy hasn't propagated yet, or cached by CDN edge)
        setState('outdated');
      } else {
        // Version matches — clear any stale reload counter
        localStorage.removeItem(RELOAD_KEY);
      }
    }).catch(() => {
      // Network error — don't block the user, clear reload counter
      localStorage.removeItem(RELOAD_KEY);
    });
  }, []);

  const handleReload = async () => {
    setReloading(true);
    // Reset counter so auto-reload kicks in again
    localStorage.setItem(RELOAD_KEY, '0');
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
