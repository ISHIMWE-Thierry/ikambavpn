import { useEffect, useState } from 'react';
import { RefreshCw, Shield, Wrench, Save, Rocket, ArrowUp, ArrowUpRight, AlertTriangle, CheckCircle, XCircle, CreditCard, Wallet } from 'lucide-react';
import { getAppConfig, setAppConfig, getAppSettings, setAppSettings, type AppConfig, type AppPaymentSettings } from '../../lib/db-service';
import { APP_BUILD } from '../../lib/version';
import { APP_VERSION, bumpVersion, compareVersions } from '../../lib/app-version';
import { useAuth } from '../../contexts/AuthContext';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import toast from 'react-hot-toast';

export function AdminSettingsPage() {
  const { firebaseUser } = useAuth();
  const [config, setConfig] = useState<AppConfig>({
    minBuildNumber: 1,
    maintenanceMode: false,
    maintenanceMessage: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Version deploy form
  const [newVersion, setNewVersion] = useState('');
  const [versionMessage, setVersionMessage] = useState('');
  const [updateType, setUpdateType] = useState<'optional' | 'recommended' | 'critical'>('optional');

  // PayGate.to settings
  const [paygateWallet, setPaygateWallet] = useState('');
  const [paygateEnabled, setPaygateEnabled] = useState(false);
  const [savingPaygate, setSavingPaygate] = useState(false);

  const patchVersion = bumpVersion(APP_VERSION, 'patch');
  const minorVersion = bumpVersion(APP_VERSION, 'minor');
  const majorVersion = bumpVersion(APP_VERSION, 'major');

  useEffect(() => {
    Promise.all([
      getAppConfig(),
      getAppSettings(),
    ]).then(([cfg, ps]) => {
        setConfig(cfg);
        setNewVersion(cfg.version || patchVersion);
        setVersionMessage(cfg.versionMessage || '');
        if (cfg.versionMinimum) setUpdateType('critical');
        else if (cfg.versionForceRefresh) setUpdateType('recommended');
        else setUpdateType('optional');
        // PayGate settings
        setPaygateWallet(ps.paygateUsdcWallet || '');
        setPaygateEnabled(ps.paygateEnabled ?? false);
      })
      .catch(() => toast.error('Failed to load config'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setAppConfig(config);
      toast.success('Settings saved.');
    } catch {
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const forceRefreshAll = async () => {
    const newBuild = config.minBuildNumber + 1;
    const updated = { ...config, minBuildNumber: newBuild };
    setSaving(true);
    try {
      await setAppConfig(updated);
      setConfig(updated);
      toast.success(`All users on build < ${newBuild} will be forced to refresh.`);
    } catch {
      toast.error('Failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeployVersion = async () => {
    if (!newVersion.trim()) {
      toast.error('Enter a version number.');
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(newVersion.trim())) {
      toast.error('Version must be MAJOR.MINOR.PATCH (e.g. 1.2.0)');
      return;
    }
    setSaving(true);
    try {
      const versionData: Partial<AppConfig> = {
        version: newVersion.trim(),
        versionDeployedAt: Date.now(),
        versionMessage: versionMessage.trim() || undefined,
        versionForceRefresh: updateType !== 'optional',
        versionMinimum: updateType === 'critical' ? newVersion.trim() : undefined,
        versionUpdatedBy: firebaseUser?.email || 'admin',
      };
      await setAppConfig(versionData);
      setConfig((c) => ({ ...c, ...versionData }));
      toast.success(`Version ${newVersion} deployed to all users!`);
    } catch {
      toast.error('Failed to deploy version.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold mb-8">App settings</h1>

      <div className="flex flex-col gap-6">

        {/* Version control */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4" />
              <h2 className="font-semibold">Version control</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <span className="text-sm text-gray-500">Current server build</span>
                <span className="font-mono font-bold text-black">{APP_BUILD}</span>
              </div>
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <span className="text-sm text-gray-500">Minimum required build</span>
                <input
                  type="number"
                  min={1}
                  value={config.minBuildNumber}
                  onChange={(e) => setConfig({ ...config, minBuildNumber: Number(e.target.value) })}
                  className="w-20 text-right font-mono font-bold border border-gray-200 rounded-lg
                    px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Any user whose app build number is lower than the minimum will see a forced
                "Update required" screen and cannot proceed until they refresh.
              </p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleSave} loading={saving}>
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
                <button
                  onClick={forceRefreshAll}
                  disabled={saving}
                  className="flex items-center gap-1.5 text-sm font-medium text-gray-600
                    border border-gray-200 rounded-xl px-4 py-2 hover:border-black
                    hover:text-black transition-all disabled:opacity-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Force refresh all users
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Deploy new version (semver) ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4" />
              <h2 className="font-semibold">Deploy new version</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Set a new target version. Users whose build is older will see an update banner.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">

              {/* Current versions overview */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Build version</p>
                  <p className="font-mono font-bold text-lg mt-0.5">{APP_VERSION}</p>
                </div>
                <div className={`rounded-xl px-4 py-3 ${config.version ? 'bg-gray-50' : 'bg-gray-50'}`}>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Live version</p>
                  {config.version ? (
                    <>
                      <p className="font-mono font-bold text-lg mt-0.5">{config.version}</p>
                      <p className="text-[10px] text-gray-400">
                        {config.versionDeployedAt ? new Date(config.versionDeployedAt).toLocaleDateString() : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-gray-400 mt-1">Not set</p>
                  )}
                </div>
              </div>

              {/* Quick bump buttons */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">Quick bump</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setNewVersion(patchVersion)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all
                      ${newVersion === patchVersion
                        ? 'border-black bg-black text-white'
                        : 'border-gray-200 hover:border-gray-400'
                      }`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                    <span className="font-mono text-sm font-bold">{patchVersion}</span>
                    <span className="text-[10px] opacity-60">Patch</span>
                  </button>
                  <button
                    onClick={() => setNewVersion(minorVersion)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all
                      ${newVersion === minorVersion
                        ? 'border-black bg-black text-white'
                        : 'border-gray-200 hover:border-gray-400'
                      }`}
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    <span className="font-mono text-sm font-bold">{minorVersion}</span>
                    <span className="text-[10px] opacity-60">Minor</span>
                  </button>
                  <button
                    onClick={() => setNewVersion(majorVersion)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all
                      ${newVersion === majorVersion
                        ? 'border-black bg-black text-white'
                        : 'border-gray-200 hover:border-gray-400'
                      }`}
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    <span className="font-mono text-sm font-bold">{majorVersion}</span>
                    <span className="text-[10px] opacity-60">Major</span>
                  </button>
                </div>
              </div>

              {/* Custom version input */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Version number</label>
                <input
                  value={newVersion}
                  onChange={(e) => setNewVersion(e.target.value)}
                  placeholder="1.2.0"
                  className="w-full font-mono font-bold border border-gray-200 rounded-xl
                    px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                />
              </div>

              {/* Update type */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-2 block">Update type</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      setUpdateType('optional');
                      setVersionMessage('New features and improvements!');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border
                      text-xs font-medium transition-all ${
                      updateType === 'optional'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Optional
                  </button>
                  <button
                    onClick={() => {
                      setUpdateType('recommended');
                      setVersionMessage('Important bug fixes');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border
                      text-xs font-medium transition-all ${
                      updateType === 'recommended'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" /> Recommended
                  </button>
                  <button
                    onClick={() => {
                      setUpdateType('critical');
                      setVersionMessage('Critical security update');
                    }}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border
                      text-xs font-medium transition-all ${
                      updateType === 'critical'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Critical
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                  {updateType === 'optional' && 'Users can dismiss the update banner.'}
                  {updateType === 'recommended' && 'Banner cannot be dismissed. Good for bug fixes.'}
                  {updateType === 'critical' && 'Full-screen block — users must refresh immediately.'}
                </p>
              </div>

              {/* Message */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">User message</label>
                <textarea
                  value={versionMessage}
                  onChange={(e) => setVersionMessage(e.target.value)}
                  placeholder="What's new in this version?"
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm
                    focus:outline-none focus:ring-2 focus:ring-black resize-none"
                />
              </div>

              {/* Deploy button */}
              <button
                onClick={handleDeployVersion}
                disabled={saving || !newVersion.trim()}
                className="w-full rounded-xl h-12 bg-black text-white text-sm font-semibold
                  hover:bg-gray-800 active:scale-[0.98] transition-all duration-150
                  flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Rocket className={`w-4 h-4 ${saving ? 'animate-pulse' : ''}`} />
                {saving ? 'Deploying...' : `Deploy v${newVersion || '?'} to all users`}
              </button>
            </div>
          </CardContent>
        </Card>

        {/* PayGate.to card payment gateway */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              <h2 className="font-semibold">Card payments (PayGate.to)</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Accept Visa, Mastercard, Apple Pay, Google Pay via PayGate.to. Payouts in USDC (Polygon).
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable card payments</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Show "Pay with Card" option for non-Russian card holders.
                  </p>
                </div>
                <button
                  onClick={() => setPaygateEnabled(!paygateEnabled)}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                    paygateEnabled ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
                    transition-transform duration-200 ${paygateEnabled ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">
                  <Wallet className="w-3 h-3 inline mr-1" />
                  USDC (Polygon) wallet address
                </label>
                <input
                  value={paygateWallet}
                  onChange={(e) => setPaygateWallet(e.target.value)}
                  placeholder="0x..."
                  className="w-full font-mono text-sm border border-gray-200 rounded-xl
                    px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-black"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Your self-custodial USDC wallet on Polygon. Payouts arrive instantly per order.
                </p>
              </div>

              {paygateEnabled && !paygateWallet.trim() && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-100
                  rounded-xl px-4 py-3 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Card payments are enabled but no wallet is set. Customers won't see the card option.
                </div>
              )}

              <Button
                size="sm"
                loading={savingPaygate}
                onClick={async () => {
                  setSavingPaygate(true);
                  try {
                    await setAppSettings({
                      paygateUsdcWallet: paygateWallet.trim(),
                      paygateEnabled,
                    });
                    toast.success('PayGate settings saved.');
                  } catch {
                    toast.error('Failed to save PayGate settings.');
                  } finally {
                    setSavingPaygate(false);
                  }
                }}
              >
                <Save className="w-3.5 h-3.5" /> Save card payment settings
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Maintenance mode */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Wrench className="w-4 h-4" />
              <h2 className="font-semibold">Maintenance mode</h2>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable maintenance mode</p>
                  <p className="text-xs text-gray-400 mt-0.5">All users see maintenance screen — use when deploying breaking changes.</p>
                </div>
                <button
                  onClick={() => setConfig({ ...config, maintenanceMode: !config.maintenanceMode })}
                  className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                    config.maintenanceMode ? 'bg-black' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow
                    transition-transform duration-200 ${config.maintenanceMode ? 'translate-x-5' : ''}`}
                  />
                </button>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">Maintenance message</label>
                <textarea
                  value={config.maintenanceMessage}
                  onChange={(e) => setConfig({ ...config, maintenanceMessage: e.target.value })}
                  placeholder="We're doing a quick upgrade. Back shortly."
                  rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                    focus:outline-none focus:ring-2 focus:ring-black resize-none"
                />
              </div>

              {config.maintenanceMode && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-100
                  rounded-xl px-4 py-3 text-xs text-amber-700">
                  <Wrench className="w-3.5 h-3.5 shrink-0" />
                  Maintenance is ON — all users are currently blocked.
                </div>
              )}

              <Button size="sm" onClick={handleSave} loading={saving}>
                <Save className="w-3.5 h-3.5" /> Save
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>
    </main>
  );
}
