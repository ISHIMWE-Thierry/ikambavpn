import { useEffect, useState } from 'react';
import { RefreshCw, Shield, Wrench, Save } from 'lucide-react';
import { getAppConfig, setAppConfig, type AppConfig } from '../../lib/db-service';
import { APP_BUILD } from '../../lib/version';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import toast from 'react-hot-toast';

export function AdminSettingsPage() {
  const [config, setConfig] = useState<AppConfig>({
    minBuildNumber: 1,
    maintenanceMode: false,
    maintenanceMessage: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAppConfig()
      .then(setConfig)
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
