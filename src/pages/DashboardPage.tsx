import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Clock, AlertCircle, RefreshCw, ChevronRight, Zap, Download, Eye, EyeOff, Copy, Check, Globe } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrders, getUserTrial, updateTrial } from '../lib/db-service';
import { getAccount, disableAccount, listServers, getAccountByUsername, usernameFromEmail, changePassword, generatePassword } from '../lib/vpnresellers-api';
import type { VpnrServer } from '../lib/vpnresellers-api';
import { provisionXuiAccount, getXuiLinks, getXuiStats, formatBytes, formatExpiry } from '../lib/xui-api';
import type { XuiProvisionResult, XuiClientLinks, XuiClientStat } from '../lib/xui-api';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { formatDate, formatCurrency, daysUntilExpiry, isExpired } from '../lib/utils';
import type { VpnOrder, OrderStatus, VpnTrial } from '../types';

// ── App download links ────────────────────────────────────────────────────────

const DOWNLOADS = [
  { label: 'Windows', badge: '.exe',         url: 'https://vpnclient.app/current/vpnclient/vpnclient.exe' },
  { label: 'macOS',   badge: '.dmg',         url: 'https://vpnclient.app/current/vpnclient/vpnclient.dmg' },
  { label: 'iOS',     badge: 'App Store',    url: 'https://apps.apple.com/app/id1506797696' },
  { label: 'Android', badge: 'Google Play',  url: 'https://play.google.com/store/apps/details?id=com.vpn.client' },
  { label: 'Android APK', badge: 'Direct',   url: 'https://vpnclient.app/apk/VPNClient.apk' },
  { label: 'TV / Fire TV', badge: 'APK',     url: 'https://vpnclient.app/apk/VPNClient-TV.apk' },
  { label: 'Linux',   badge: '.run',         url: 'https://vpnclient.app/current/vpnclient/vpnclient.run' },
];

function AppDownloads({ username, password }: { username?: string; password?: string }) {
  const [showPw, setShowPw] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          <h2 className="font-semibold">Download VPN app</h2>
        </div>
      </CardHeader>
      <CardContent>
        {/* Login credentials reminder */}
        {username && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">Sign in with these credentials</p>
            <div className="font-mono text-sm flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-amber-600">Username:</span>
                <span className="font-semibold text-amber-900">{username}</span>
                <button onClick={() => copyText(username, 'app-user')} className="ml-1 text-amber-400 hover:text-amber-700 transition" title="Copy">
                  {copied === 'app-user' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              {password && (
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-600">Password:</span>
                  <span className="font-semibold text-amber-900">{showPw ? password : '••••••••••'}</span>
                  <button onClick={() => setShowPw((v) => !v)} className="ml-0.5 text-amber-400 hover:text-amber-700 transition">
                    {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => copyText(password, 'app-pass')} className="text-amber-400 hover:text-amber-700 transition" title="Copy">
                    {copied === 'app-pass' ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {DOWNLOADS.map((d) => (
            <a
              key={d.label}
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col gap-0.5 border border-gray-100 rounded-xl px-3 py-2.5 hover:border-black transition"
            >
              <span className="text-sm font-medium">{d.label}</span>
              <span className="text-xs text-gray-400">{d.badge}</span>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Credentials block (shared by trial + paid + resell) ───────────────────────

/** Extract password from admin notes (stored as "Password: xyz" by ActivateForm). */
function extractPassword(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/^Password:\s*(.+)$/i);
  return match?.[1]?.trim();
}

function CredentialsBox({
  username, password, wgIp, wgPrivateKey, wgPublicKey,
}: {
  username?: string; password?: string;
  wgIp?: string; wgPrivateKey?: string; wgPublicKey?: string;
}) {
  const [show, setShow] = useState(false);
  const [dlLoading, setDlLoading] = useState(false);
  const [servers, setServers] = useState<VpnrServer[]>([]);
  const [tab, setTab] = useState<'openvpn' | 'ikev2' | 'l2tp' | 'stealth' | 'wireguard' | 'vless'>('openvpn');
  const [copied, setCopied] = useState<string | null>(null);

  if (!username && !password && !wgIp) return null;

  // Fetch servers once
  useEffect(() => {
    listServers().then(setServers).catch(() => {});
  }, []);

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const CopyBtn = ({ text, label }: { text: string; label: string }) => (
    <button onClick={() => copyText(text, label)} className="ml-1.5 text-gray-400 hover:text-black transition" title="Copy">
      {copied === label ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  const srv = servers[0];

  const handleWgDownload = async () => {
    if (!wgPrivateKey || !wgIp) return;
    setDlLoading(true);
    try {
      let srvList = servers;
      if (!srvList.length) { srvList = await listServers(); setServers(srvList); }
      const s = srvList[0];
      if (!s?.wg_public_key) {
        // Try using the user's account public key as a fallback hint
        // but we actually need the SERVER's public key for the config
        alert('WireGuard config download is not available for your server. Use the VPN Client app with OpenVPN or Stealth protocol instead.');
        return;
      }
      const cfg = [
        '[Interface]',
        `PrivateKey = ${wgPrivateKey}`,
        `Address = ${wgIp}/32`,
        'DNS = 1.1.1.1, 8.8.8.8',
        '',
        '[Peer]',
        `PublicKey = ${s.wg_public_key}`,
        `Endpoint = ${s.ip}:51820`,
        'AllowedIPs = 0.0.0.0/0',
        'PersistentKeepalive = 25',
      ].join('\n');
      const blob = new Blob([cfg], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${username ?? 'vpn'}-wireguard.conf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to generate config. Try again.');
    } finally {
      setDlLoading(false);
    }
  };

  const tabs = [
    { key: 'openvpn' as const, label: 'OpenVPN' },
    { key: 'ikev2' as const, label: 'IKEv2' },
    { key: 'l2tp' as const, label: 'L2TP' },
    { key: 'stealth' as const, label: '🛡️ Stealth' },
    ...(wgPrivateKey ? [{ key: 'wireguard' as const, label: 'WireGuard' }] : []),
    { key: 'vless' as const, label: '🇷🇺 VLESS' },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* Protocol tabs */}
      <div className="flex gap-1 bg-gray-50 rounded-lg p-0.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-medium py-1.5 px-3 rounded-md transition ${
              tab === t.key ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OpenVPN (UDP / TCP) ── */}
      {tab === 'openvpn' && (
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
            {srv && (
              <p className="flex items-center flex-wrap">
                <span className="text-gray-400">Server: </span>{srv.ip}
                <CopyBtn text={srv.ip} label="ovpn-srv" />
                <span className="text-xs text-gray-400 ml-2">({srv.name})</span>
              </p>
            )}
            <p><span className="text-gray-400">Protocol: </span>OpenVPN (UDP or TCP)</p>
            {username && (
              <p className="flex items-center">
                <span className="text-gray-400">Username: </span>{username}
                <CopyBtn text={username} label="ovpn-user" />
              </p>
            )}
            {password && (
              <div className="flex items-center">
                <span className="text-gray-400">Password: </span>
                <span className="ml-1">{show ? password : '••••••••••'}</span>
                <button onClick={() => setShow((v) => !v)} className="ml-1 text-gray-400 hover:text-black">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {password && <CopyBtn text={password} label="ovpn-pw" />}
              </div>
            )}
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition">
              Setup instructions ▸
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 flex flex-col gap-2">
              <p className="font-semibold text-blue-900">Using VPN Client app (all platforms)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Download <strong>VPN Client</strong> from <a href="https://vpnclient.app" target="_blank" rel="noopener noreferrer" className="underline">vpnclient.app</a> (see downloads below)</li>
                <li>Open the app → enter your <strong>username</strong> &amp; <strong>password</strong></li>
                <li>The app connects with <strong>UDP-OpenVPN</strong> by default — this is the fastest option</li>
                <li>To switch protocol: tap <strong>Advanced</strong> → choose <strong>UDP-OpenVPN</strong> or <strong>TCP-OpenVPN</strong></li>
              </ol>
              <div className="mt-2 p-2 bg-blue-100 rounded-lg">
                <p className="font-semibold text-blue-900">💡 UDP vs TCP</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5">
                  <li><strong>UDP-OpenVPN</strong> — Faster, best for streaming &amp; general use</li>
                  <li><strong>TCP-OpenVPN</strong> — More reliable on unstable networks, may work when UDP is blocked</li>
                </ul>
              </div>
              <p className="mt-2 text-blue-600 text-[11px]">
                ⚠️ If OpenVPN is blocked in your country (Russia, China, Iran), switch to the <strong>Stealth</strong> tab.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ── IKEv2 ── */}
      {tab === 'ikev2' && (
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
            {srv && (
              <p className="flex items-center flex-wrap">
                <span className="text-gray-400">Server: </span>{srv.ip}
                <CopyBtn text={srv.ip} label="ike-srv" />
                <span className="text-xs text-gray-400 ml-2">({srv.name})</span>
              </p>
            )}
            <p><span className="text-gray-400">Protocol: </span>IKEv2</p>
            {username && (
              <p className="flex items-center">
                <span className="text-gray-400">Username: </span>{username}
                <CopyBtn text={username} label="ike-user" />
              </p>
            )}
            {password && (
              <div className="flex items-center">
                <span className="text-gray-400">Password: </span>
                <span className="ml-1">{show ? password : '••••••••••'}</span>
                <button onClick={() => setShow((v) => !v)} className="ml-1 text-gray-400 hover:text-black">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {password && <CopyBtn text={password} label="ike-pw" />}
              </div>
            )}
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition">
              Setup instructions ▸
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 flex flex-col gap-2">
              <p className="font-semibold text-blue-900">Using VPN Client app (recommended)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Open <strong>VPN Client</strong> → enter your credentials</li>
                <li>Tap <strong>Advanced</strong> → select <strong>IKEv2</strong></li>
                <li>Tap <strong>Connect</strong></li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">iOS / macOS (built-in)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Settings → VPN → Add VPN → Type: <strong>IKEv2</strong></li>
                <li>Server &amp; Remote ID: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Authentication: <strong>Username</strong></li>
                <li>Enter your username &amp; password → Connect</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">Windows (built-in)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Settings → Network → VPN → Add VPN</li>
                <li>Provider: <strong>Windows (built-in)</strong>, Type: <strong>IKEv2</strong></li>
                <li>Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Sign-in: <strong>Username and password</strong> → Connect</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">Android</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Install <strong>strongSwan VPN</strong> from Play Store</li>
                <li>Add Profile → Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Type: <strong>IKEv2 EAP (Username/Password)</strong></li>
                <li>Enter credentials → Connect</li>
              </ol>
              <p className="mt-2 text-blue-600 text-[11px]">
                ⚠️ IKEv2 is blocked in Russia. Use <strong>Stealth</strong> mode to tunnel IKEv2 through TLS.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ── L2TP/IPSec ── */}
      {tab === 'l2tp' && (
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
            {srv && (
              <p className="flex items-center flex-wrap">
                <span className="text-gray-400">Server: </span>{srv.ip}
                <CopyBtn text={srv.ip} label="l2tp-srv" />
                <span className="text-xs text-gray-400 ml-2">({srv.name})</span>
              </p>
            )}
            <p><span className="text-gray-400">Protocol: </span>L2TP/IPSec PSK</p>
            {username && (
              <p className="flex items-center">
                <span className="text-gray-400">Username: </span>{username}
                <CopyBtn text={username} label="l2tp-user" />
              </p>
            )}
            {password && (
              <div className="flex items-center">
                <span className="text-gray-400">Password: </span>
                <span className="ml-1">{show ? password : '••••••••••'}</span>
                <button onClick={() => setShow((v) => !v)} className="ml-1 text-gray-400 hover:text-black">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {password && <CopyBtn text={password} label="l2tp-pw" />}
              </div>
            )}
            <p className="flex items-center">
              <span className="text-gray-400">Pre-shared Key: </span>
              <span className="ml-1 font-semibold">vpnresellers</span>
              <CopyBtn text="vpnresellers" label="l2tp-psk" />
            </p>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition">
              Setup instructions ▸
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 flex flex-col gap-2">
              <p className="font-semibold text-blue-900">Using VPN Client app (recommended)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Open <strong>VPN Client</strong> → enter your credentials</li>
                <li>The app may use L2TP automatically when it's the best option</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">iOS</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Settings → VPN → Add VPN Configuration</li>
                <li>Type: <strong>L2TP</strong></li>
                <li>Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Account: your <strong>username</strong>, Password: your <strong>password</strong></li>
                <li>Secret: <strong>vpnresellers</strong></li>
                <li>Send All Traffic: <strong>ON</strong> → Connect</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">macOS</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>System Settings → Network → + → VPN → <strong>L2TP over IPSec</strong></li>
                <li>Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Auth Settings → Password + Shared Secret: <strong>vpnresellers</strong></li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">Windows</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Settings → Network → VPN → Add VPN</li>
                <li>Type: <strong>L2TP/IPsec with pre-shared key</strong></li>
                <li>Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>Pre-shared key: <strong>vpnresellers</strong>, enter credentials → Connect</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">Android</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Settings → Connections → VPN → Add</li>
                <li>Type: <strong>L2TP/IPSec PSK</strong></li>
                <li>Server: <strong>{srv?.ip ?? '(see above)'}</strong></li>
                <li>IPSec pre-shared key: <strong>vpnresellers</strong></li>
                <li>Enter credentials → Connect</li>
              </ol>
              <p className="mt-2 text-blue-600 text-[11px]">
                ⚠️ L2TP is blocked in Russia. Use <strong>Stealth</strong> mode to tunnel L2TP through TLS.
              </p>
            </div>
          </details>
        </div>
      )}

      {/* ── Stealth (IKEv2 / L2TP tunneled over TLS — for Russia / restricted networks) ── */}
      {tab === 'stealth' && (
        <div className="flex flex-col gap-3">
          {/* Russia / restricted country warning */}
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2">
            <Shield className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <div className="text-xs text-red-800">
              <p className="font-semibold">For Russia, China, Iran &amp; restricted networks</p>
              <p className="mt-0.5 text-red-600">
                Stealth mode tunnels your <strong>IKEv2</strong> or <strong>L2TP</strong> connection through
                TLS/SSL encryption, making it look like normal HTTPS web traffic. This bypasses
                deep packet inspection (DPI) used to block VPN protocols.
              </p>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
            {srv && (
              <p className="flex items-center flex-wrap">
                <span className="text-gray-400">Server: </span>{srv.ip}
                <CopyBtn text={srv.ip} label="stealth-srv" />
                <span className="text-xs text-gray-400 ml-2">({srv.name})</span>
              </p>
            )}
            <p><span className="text-gray-400">Protocol: </span>Stealth (IKEv2/L2TP over TLS)</p>
            {username && (
              <p className="flex items-center">
                <span className="text-gray-400">Username: </span>{username}
                <CopyBtn text={username} label="stealth-user" />
              </p>
            )}
            {password && (
              <div className="flex items-center">
                <span className="text-gray-400">Password: </span>
                <span className="ml-1">{show ? password : '••••••••••'}</span>
                <button onClick={() => setShow((v) => !v)} className="ml-1 text-gray-400 hover:text-black">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                {password && <CopyBtn text={password} label="stealth-pw" />}
              </div>
            )}
          </div>
          <details className="group" open>
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition">
              Setup instructions ▸
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 flex flex-col gap-2">
              <p className="font-semibold text-blue-900">💻 Desktop — macOS / Windows / Linux</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Download <strong>VPN Client</strong> from <a href="https://vpnclient.app" target="_blank" rel="noopener noreferrer" className="underline">vpnclient.app</a></li>
                <li>Open the app → enter your <strong>username</strong> &amp; <strong>password</strong></li>
                <li>Click <strong>Advanced</strong> (bottom of the screen)</li>
                <li>Select <strong>Stealth</strong> from the protocol list</li>
                <li>Click <strong>Connect</strong> — the connection will look like regular HTTPS traffic</li>
              </ol>

              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="font-semibold text-red-900">📱 iPhone / iPad &amp; Android — Stealth is NOT available</p>
                <p className="mt-1 text-red-700">
                  Stealth mode is <strong>only available on the desktop app</strong> (macOS, Windows, Linux).
                  The iOS and Android apps do not support Stealth.
                </p>
                <p className="mt-2 font-semibold text-red-900">What to do on iPhone in Russia:</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-1.5 text-red-800">
                  <li>
                    <strong>Connect from a Mac/PC first</strong> — use Stealth on the desktop app, then share the VPN
                    to your phone via <strong>Wi-Fi hotspot</strong> (Mac: System Settings → General → Sharing → Internet Sharing)
                    or <strong>USB tethering</strong>. This is the only reliable method.
                  </li>
                  <li>
                    <strong>Try the VPN Client iOS app</strong> — download from the <a href="https://apps.apple.com/app/id1506797696" target="_blank" rel="noopener noreferrer" className="underline">App Store</a>,
                    log in, and tap Connect. It will attempt to connect but <strong>will likely not work</strong> in Russia without Stealth.
                  </li>
                  <li>
                    <strong>Try IKEv2 in iOS Settings</strong> — see the <strong>IKEv2</strong> tab above. This works without
                    an app but is <strong>also blocked in most of Russia</strong>.
                  </li>
                </ul>
                <p className="mt-2 text-red-600 text-[11px] leading-relaxed">
                  ⚠️ There is currently no reliable way to use this VPN on iPhone in Russia.
                  The only guaranteed method is connecting a Mac or PC with Stealth and sharing
                  the internet to your phone. We are working on better mobile solutions.
                </p>
              </div>

              <div className="mt-2 p-2 bg-red-50 border border-red-100 rounded-lg">
                <p className="font-semibold text-red-800">🇷🇺 Russia summary</p>
                <ul className="list-disc ml-4 mt-1 flex flex-col gap-0.5 text-red-700">
                  <li><strong>Desktop ✅</strong> — use Stealth mode, it works</li>
                  <li><strong>iPhone / Android ❌</strong> — no Stealth on mobile, use desktop + hotspot sharing</li>
                  <li>If one server doesn't connect, try a different server location</li>
                  <li>Connect before opening blocked services (Instagram, etc.)</li>
                </ul>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* ── WireGuard ── */}
      {tab === 'wireguard' && wgPrivateKey && (
        <div className="flex flex-col gap-3">
          <div className="bg-gray-50 rounded-xl p-4 font-mono text-sm flex flex-col gap-1.5">
            {wgIp && (
              <p className="flex items-center">
                <span className="text-gray-400">WG IP: </span>{wgIp}
                <CopyBtn text={wgIp} label="wg-ip" />
              </p>
            )}
            {wgPrivateKey && (
              <p className="break-all flex items-center flex-wrap">
                <span className="text-gray-400 shrink-0">Private Key: </span>
                <span className="ml-1">{show ? wgPrivateKey : '••••••••••'}</span>
                <button onClick={() => setShow((v) => !v)} className="ml-1 text-gray-400 hover:text-black shrink-0">
                  {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </p>
            )}
            {wgPublicKey && (
              <p className="break-all"><span className="text-gray-400">Public Key: </span>{wgPublicKey}</p>
            )}
            {srv && (
              <p className="flex items-center flex-wrap">
                <span className="text-gray-400">Server: </span>{srv.ip}:51820
                <span className="text-xs text-gray-400 ml-2">({srv.name})</span>
              </p>
            )}
          </div>
          {srv?.wg_public_key ? (
            <button
              onClick={handleWgDownload}
              disabled={dlLoading}
              className="self-start flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-black bg-gray-50 hover:bg-gray-100 rounded-lg px-3 py-2 transition disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {dlLoading ? 'Preparing…' : 'Download .conf file'}
            </button>
          ) : (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              WireGuard .conf download not available — use the <strong>VPN Client</strong> app with <strong>OpenVPN</strong> or <strong>Stealth</strong> protocol instead.
            </p>
          )}
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition">
              Setup instructions ▸
            </summary>
            <div className="mt-2 bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-800 flex flex-col gap-1">
              <p className="font-semibold text-blue-900">Using VPN Client app</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Open <strong>VPN Client</strong> → log in with your credentials</li>
                <li>Tap <strong>Advanced</strong> → select <strong>WireGuard</strong></li>
                <li>The app handles configuration automatically</li>
              </ol>
              <p className="font-semibold text-blue-900 mt-2">Manual setup (with .conf file)</p>
              <ol className="list-decimal ml-4 flex flex-col gap-1">
                <li>Install <strong>WireGuard</strong> app on your device</li>
                <li>Download the <strong>.conf</strong> file above (if available)</li>
                <li>Open WireGuard → tap <strong>+</strong> → <strong>Import from file</strong></li>
                <li>Select the file → Toggle to connect</li>
              </ol>
              <div className="mt-2 p-2 bg-amber-50 border border-amber-100 rounded-lg">
                <p className="text-amber-700 text-[11px]">
                  ⚠️ WireGuard may be blocked in Russia and some restricted countries. Use <strong>Stealth</strong> mode instead.
                </p>
              </div>
            </div>
          </details>
        </div>
      )}

      {/* ── VLESS+REALITY (Russia / DPI bypass — works on ALL devices including mobile) ── */}
      {tab === 'vless' && (
        <VlessTab />
      )}
    </div>
  );
}

// ── VLESS+REALITY tab ─────────────────────────────────────────────────────────

function VlessTab() {
  const { firebaseUser } = useAuth();
  const [vlessLink, setVlessLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<XuiClientStat | null>(null);

  // Check if user already has a VLESS account
  useEffect(() => {
    if (!firebaseUser?.email) return;
    getXuiStats(firebaseUser.email)
      .then((s) => setStats(s))
      .catch(() => { /* no account yet */ });
  }, [firebaseUser?.email]);

  async function handleGetTrial() {
    if (!firebaseUser?.email) return;
    setLoading(true);
    setError(null);
    try {
      const result = await provisionXuiAccount({
        email: firebaseUser.email,
        trafficLimitGB: 1,    // 1 GB trial
        expiryDays: 3,        // 3 day trial
        maxConnections: 1,
      });
      setVlessLink(result.subscriptionUrl);
      // Refresh stats
      getXuiStats(firebaseUser.email).then(setStats).catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Failed to create trial');
    } finally {
      setLoading(false);
    }
  }

  function copyLink() {
    if (!vlessLink) return;
    navigator.clipboard.writeText(vlessLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2">
        <Globe className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-800">
          <p className="font-semibold">🇷🇺 For Russia, China, Iran &amp; restricted networks</p>
          <p className="mt-0.5 text-blue-600">
            VLESS+REALITY bypasses deep packet inspection. Your traffic looks identical to visiting <strong>microsoft.com</strong>.
          </p>
        </div>
      </div>

      {/* Step 1: Download app */}
      <div className="border border-gray-100 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 bg-black text-white rounded-full flex items-center justify-center text-xs font-bold">1</div>
          <p className="text-sm font-semibold">Download V2RayTun</p>
        </div>
        <a
          href="https://apps.apple.com/app/id6476628951"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between border border-blue-100 bg-blue-50 rounded-xl px-4 py-3 hover:border-blue-300 transition"
        >
          <div>
            <span className="text-sm font-medium text-blue-900">V2RayTun</span>
            <p className="text-xs text-blue-500">iPhone / iPad / Mac — App Store</p>
          </div>
          <Download className="w-4 h-4 text-blue-400" />
        </a>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a
            href="https://play.google.com/store/apps/details?id=com.v2ray.ang"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-0.5 border border-gray-100 rounded-xl px-3 py-2 hover:border-gray-300 transition"
          >
            <span className="text-xs font-medium">V2RayNG</span>
            <span className="text-[10px] text-gray-400">Android — Google Play</span>
          </a>
          <a
            href="https://github.com/hiddify/hiddify-app/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-0.5 border border-gray-100 rounded-xl px-3 py-2 hover:border-gray-300 transition"
          >
            <span className="text-xs font-medium">Hiddify</span>
            <span className="text-[10px] text-gray-400">Windows / macOS / Linux</span>
          </a>
        </div>
      </div>

      {/* Step 2: Get your link */}
      <div className="border border-gray-100 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 bg-black text-white rounded-full flex items-center justify-center text-xs font-bold">2</div>
          <p className="text-sm font-semibold">Get your connection link</p>
        </div>

        {vlessLink ? (
          <div className="flex flex-col gap-2">
            <div className="bg-gray-50 rounded-xl p-3 font-mono text-xs break-all text-gray-700 border border-gray-200">
              {vlessLink}
            </div>
            <Button
              onClick={copyLink}
              className="w-full"
              variant={copied ? 'primary' : 'secondary'}
            >
              {copied ? (
                <><Check className="w-4 h-4 mr-1.5" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4 mr-1.5" /> Copy link</>
              )}
            </Button>
          </div>
        ) : stats ? (
          <div className="bg-green-50 border border-green-100 rounded-xl p-3">
            <p className="text-xs text-green-800 font-medium">✅ You already have a VLESS account</p>
            <div className="mt-2 text-xs text-green-700 flex flex-col gap-0.5">
              <p>📊 Used: {formatBytes(stats.total)} {stats.limit > 0 ? `/ ${formatBytes(stats.limit)}` : '(unlimited)'}</p>
              <p>⏰ Expires: {formatExpiry(stats.expiryTime)}</p>
            </div>
            <p className="mt-2 text-[11px] text-green-600">
              Your connection link was shown when you first activated. Contact support if you need it again.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-gray-500">
              Start a free trial to get your VLESS connection link. Paste it into V2RayTun to connect.
            </p>
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg p-2 text-xs text-red-700">
                ⚠️ {error}
              </div>
            )}
            <Button onClick={handleGetTrial} disabled={loading} className="w-full">
              {loading ? (
                <><RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> Creating trial...</>
              ) : (
                <>🚀 Start free trial (1 GB / 3 days)</>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Step 3: Paste & connect */}
      <div className="border border-gray-100 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 bg-black text-white rounded-full flex items-center justify-center text-xs font-bold">3</div>
          <p className="text-sm font-semibold">Paste link &amp; connect</p>
        </div>
        <ol className="text-xs text-gray-600 list-decimal ml-8 flex flex-col gap-1.5">
          <li>Open <strong>V2RayTun</strong> (or V2RayNG / Hiddify)</li>
          <li>Tap the <strong>+</strong> button</li>
          <li>Choose <strong>"Import from clipboard"</strong> or <strong>"Import from URL"</strong></li>
          <li>Paste the link you copied above</li>
          <li>Tap <strong>Connect</strong> — done! 🎉</li>
        </ol>
      </div>

      {/* Why it works */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-blue-600 hover:text-blue-800 transition px-1">
          Why this works in Russia ▸
        </summary>
        <div className="mt-2 bg-green-50 border border-green-100 rounded-xl p-3 text-xs text-green-800">
          <ul className="list-disc ml-4 flex flex-col gap-1">
            <li>Your traffic looks <strong>identical</strong> to visiting microsoft.com</li>
            <li>Uses real TLS 1.3 handshakes — DPI cannot detect it</li>
            <li>Works on <strong>all devices</strong>: iPhone, Android, Windows, Mac, Linux</li>
            <li>If server IP changes, your subscription link auto-updates</li>
          </ul>
        </div>
      </details>

      {/* Russian summary */}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-xs text-gray-600">
        <p className="font-semibold text-gray-700 mb-1">🇷🇺 Краткая инструкция</p>
        <ol className="list-decimal ml-4 flex flex-col gap-0.5">
          <li>Скачайте <strong>V2RayTun</strong> из <a href="https://apps.apple.com/app/id6476628951" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">App Store</a></li>
          <li>Нажмите <strong>«Start free trial»</strong> выше, чтобы получить ссылку</li>
          <li>Скопируйте ссылку → откройте V2RayTun → <strong>+</strong> → <strong>«Import from URL»</strong></li>
          <li>Нажмите <strong>«Подключиться»</strong> — готово! ✅</li>
        </ol>
      </div>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function statusBadge(status: OrderStatus) {
  const map: Record<OrderStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' | 'default' }> = {
    active: { label: 'Active', variant: 'success' },
    pending_payment: { label: 'Pending payment', variant: 'warning' },
    payment_submitted: { label: 'Under review', variant: 'muted' },
    expired: { label: 'Expired', variant: 'danger' },
    cancelled: { label: 'Cancelled', variant: 'danger' },
  };
  const s = map[status] ?? { label: status, variant: 'muted' };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { firebaseUser, profile } = useAuth();
  const [orders, setOrders] = useState<VpnOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<VpnTrial | null>(null);
  const [trialTimeLeft, setTrialTimeLeft] = useState('');

    // VPNresellers live account for this user
  const [resellCreds, setResellCreds] = useState<{
    username?: string; password?: string;
    wgIp?: string; wgPrivateKey?: string; wgPublicKey?: string;
    status?: string; expiredAt?: string | null;
  } | null>(null);
  const [checkingResell, setCheckingResell] = useState(true);

  const fetchOrders = () => {
    if (!firebaseUser) return;
    setLoading(true);
    getUserOrders(firebaseUser.uid)
      .then(setOrders)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(fetchOrders, [firebaseUser]);

  // Fetch trial record
  useEffect(() => {
    if (!firebaseUser) return;
    getUserTrial(firebaseUser.uid)
      .then(setTrial)
      .catch((err) => {
        console.warn('Failed to fetch trial record:', err?.message || err);
      });
  }, [firebaseUser]);

  // Background check: sync live account from VPNresellers API.
  // Checks BOTH trial records AND active order credentials for vpnrAccountId.
  useEffect(() => {
    if (!firebaseUser) { setCheckingResell(false); return; }

    async function syncFromVpnresellers() {
      setCheckingResell(true);
      try {
        // 1. Gather all possible VPNresellers account IDs from trial + orders
        let accountId: number | null = null;
        let storedPassword: string | undefined;
        let storedUsername: string | undefined;
        let storedWgIp: string | undefined;
        let storedWgPrivateKey: string | undefined;
        let storedWgPublicKey: string | undefined;

        // Check trial first
        let trialRec: VpnTrial | null = null;
        try {
          trialRec = await getUserTrial(firebaseUser!.uid);
          // Also populate the trial state so the trial card renders
          if (trialRec) setTrial(trialRec);
        } catch {
          // Index may still be building — ignore
        }
        if (trialRec?.credentials?.vpnrAccountId) {
          accountId = trialRec.credentials.vpnrAccountId;
          storedPassword = trialRec.credentials.password;
          storedUsername = trialRec.credentials.username;
          storedWgIp = trialRec.credentials.wgIp;
          storedWgPrivateKey = trialRec.credentials.wgPrivateKey;
          storedWgPublicKey = trialRec.credentials.wgPublicKey;
        } else if (trialRec?.resellServiceId) {
          accountId = Number(trialRec.resellServiceId);
          storedPassword = trialRec.credentials?.password;
          storedUsername = trialRec.credentials?.username;
          storedWgIp = trialRec.credentials?.wgIp;
          storedWgPrivateKey = trialRec.credentials?.wgPrivateKey;
          storedWgPublicKey = trialRec.credentials?.wgPublicKey;
        }

        // Then check orders (active or most recent with credentials)
        const userOrders = await getUserOrders(firebaseUser!.uid);
        const orderWithCreds = userOrders.find(
          (o) => o.credentials?.vpnrAccountId
        );
        if (orderWithCreds?.credentials?.vpnrAccountId) {
          accountId = orderWithCreds.credentials.vpnrAccountId;
          // Password may be stored in credentials.notes as "Password: xyz"
          // or directly on credentials.password
          storedPassword =
            orderWithCreds.credentials.password ??
            extractPassword(orderWithCreds.credentials.notes);
          storedUsername = orderWithCreds.credentials.username ?? storedUsername;
          storedWgIp = orderWithCreds.credentials.wgIp ?? storedWgIp;
          storedWgPrivateKey = orderWithCreds.credentials.wgPrivateKey ?? storedWgPrivateKey;
          storedWgPublicKey = orderWithCreds.credentials.wgPublicKey ?? storedWgPublicKey;
        }

        if (!accountId) return;

        // 2. Try to fetch live status from VPNresellers API
        try {
          const acct = await getAccount(accountId);
          setResellCreds({
            username: acct.username,
            password: storedPassword,
            wgIp: acct.wg_ip,
            wgPrivateKey: acct.wg_private_key,
            wgPublicKey: acct.wg_public_key,
            status: acct.status,
            expiredAt: acct.expired_at,
          });
        } catch (apiErr) {
          // API failed (404, network error, etc.) — still show Firestore credentials
          console.warn('VPNresellers API error for account', accountId, apiErr);
          console.info('Falling back to stored creds:', { storedUsername, storedPassword: storedPassword ? '***' : undefined, storedWgIp });

          // Try to find the account on VPNresellers by stored username or email-derived username
          const lookupName = storedUsername || (firebaseUser?.email ? usernameFromEmail(firebaseUser.email) : '');
          if (lookupName) {
            try {
              const found = await getAccountByUsername(lookupName);
              if (found) {
                let pwd = storedPassword;

                // If no password stored, reset it and persist to Firestore
                if (!pwd) {
                  try {
                    pwd = generatePassword();
                    await changePassword(found.id, pwd);
                    // Save the new password + correct account ID back to Firestore
                    if (trialRec) {
                      await updateTrial(trialRec.id, {
                        credentials: {
                          ...trialRec.credentials,
                          username: found.username,
                          password: pwd,
                          vpnrAccountId: found.id,
                          wgIp: found.wg_ip,
                          wgPrivateKey: found.wg_private_key,
                          wgPublicKey: found.wg_public_key,
                        },
                      });
                    }
                    console.info('Password reset and saved for account', found.id);
                  } catch (resetErr) {
                    console.warn('Failed to reset password:', resetErr);
                    pwd = undefined;
                  }
                }

                setResellCreds({
                  username: found.username,
                  password: pwd,
                  wgIp: found.wg_ip,
                  wgPrivateKey: found.wg_private_key,
                  wgPublicKey: found.wg_public_key,
                  status: found.status,
                  expiredAt: found.expired_at,
                });
                return;
              }
            } catch {
              // lookup also failed — continue to final fallback
            }
          }

          // Show whatever credentials we have from Firestore
          setResellCreds({
            username: storedUsername,
            password: storedPassword,
            wgIp: storedWgIp,
            wgPrivateKey: storedWgPrivateKey,
            wgPublicKey: storedWgPublicKey,
            status: 'Active',   // assume active since we have an active trial/order
            expiredAt: null,
          });
        }
      } catch { /* silent */ } finally {
        setCheckingResell(false);
      }
    }

    syncFromVpnresellers();
  }, [firebaseUser]);

  // Live countdown + auto-deactivate when trial expires
  useEffect(() => {
    if (!trial || trial.status !== 'active') return;

    const tick = () => {
      const ms = new Date(trial.expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setTrialTimeLeft('Expired');
        const accountId = trial.credentials?.vpnrAccountId ?? trial.resellServiceId;
        if (accountId) disableAccount(Number(accountId)).catch(() => {});
        updateTrial(trial.id, { status: 'expired' }).catch(() => {});
        setTrial((t) => (t ? { ...t, status: 'expired' } : t));
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setTrialTimeLeft(`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [trial]);

  const activeOrder = orders.find((o) => o.status === 'active');
  const pendingOrders = orders.filter((o) =>
    o.status === 'pending_payment' || o.status === 'payment_submitted'
  );
  const days = daysUntilExpiry(activeOrder?.expiresAt);
  const expired = isExpired(activeOrder?.expiresAt);

  // User has an active VPN in any form
  const hasActiveVpn = !!activeOrder || trial?.status === 'active' || (resellCreds?.status === 'Active');

  // Derive the active VPN username + password (for the "Download app" section)
  const activeUsername =
    resellCreds?.username ??
    activeOrder?.credentials?.username ??
    trial?.credentials?.username;
  const activePassword =
    resellCreds?.password ??
    activeOrder?.credentials?.password ??
    extractPassword(activeOrder?.credentials?.notes) ??
    trial?.credentials?.password;

  // Compute days until VPNresellers account expires
  const resellDays = resellCreds?.expiredAt ? daysUntilExpiry(resellCreds.expiredAt) : null;
  const resellExpired = resellCreds?.expiredAt ? isExpired(resellCreds.expiredAt) : false;
  const resellIsActive = resellCreds?.status === 'Active' && !resellExpired;

  // Is the user on a free trial (not a paid plan)?
  const isTrialUser = trial?.status === 'active' && !activeOrder;

  // For trial users, merge resellCreds into the trial display instead of showing the "Your VPN service" card
  const trialUsername = resellCreds?.username ?? trial?.credentials?.username;
  const trialPassword = resellCreds?.password ?? trial?.credentials?.password;
  const trialWgIp = resellCreds?.wgIp ?? trial?.credentials?.wgIp;
  const trialWgPrivateKey = resellCreds?.wgPrivateKey ?? trial?.credentials?.wgPrivateKey;
  const trialWgPublicKey = resellCreds?.wgPublicKey ?? trial?.credentials?.wgPublicKey;

  return (
    <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-black">
            {profile?.firstname ? `Hi, ${profile.firstname}` : 'Dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{firebaseUser?.email}</p>
        </div>
        <button onClick={fetchOrders} className="p-2 hover:bg-gray-50 rounded-xl transition" title="Refresh">
          <RefreshCw className="w-5 h-5 text-gray-400" />
        </button>
      </div>

      {(loading || checkingResell) ? (
        <div className="flex flex-col gap-6">
          {/* Skeleton — main service card */}
          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col gap-4 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 bg-gray-100 rounded" />
                <div className="w-36 h-4 bg-gray-100 rounded" />
              </div>
              <div className="w-16 h-5 bg-gray-100 rounded-full" />
            </div>
            <div className="w-full h-20 bg-gray-50 rounded-xl" />
            <div className="w-32 h-8 bg-gray-100 rounded-xl" />
          </div>
          {/* Skeleton — downloads */}
          <div className="border border-gray-100 rounded-2xl p-6 flex flex-col gap-4 animate-pulse">
            <div className="w-40 h-4 bg-gray-100 rounded" />
            <div className="grid grid-cols-4 gap-2">
              {[...Array(7)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-50 rounded-xl" />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-6">

          {/* ── ResellPortal live service (only for paid users, NOT trial) ── */}
          {resellCreds && !isTrialUser && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <h2 className="font-semibold">Your VPN service</h2>
                  </div>
                  <Badge variant={resellIsActive ? 'success' : resellCreds.status === 'Disabled' ? 'danger' : 'muted'}>
                    {resellExpired ? 'Expired' : resellCreds.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {/* Service summary */}
                <div className="grid sm:grid-cols-3 gap-6 mb-4">
                  <Stat label="Account" value={resellCreds.username ?? '—'} />
                  <Stat label="Status" value={resellIsActive ? 'Active' : resellExpired ? 'Expired' : (resellCreds.status ?? 'Unknown')} />
                  {resellCreds.expiredAt ? (
                    <Stat
                      label="Expires"
                      value={resellExpired ? 'Expired' : `${resellDays} days left (${resellCreds.expiredAt})`}
                      alert={resellExpired || (resellDays !== null && resellDays <= 5)}
                    />
                  ) : (
                    <Stat label="Expires" value="Auto-renewal" />
                  )}
                </div>

                <p className="text-sm font-medium mb-3 border-t border-gray-100 pt-4">VPN credentials</p>
                <CredentialsBox
                  username={resellCreds.username}
                  password={resellCreds.password}
                  wgIp={resellCreds.wgIp}
                  wgPrivateKey={resellCreds.wgPrivateKey}
                  wgPublicKey={resellCreds.wgPublicKey}
                />
                {!resellCreds.username && !resellCreds.password && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                    <p className="font-medium">Credentials not available</p>
                    <p className="text-xs mt-1 text-amber-600">
                      Your VPN account credentials could not be retrieved. Please contact support or check your email for login details.
                    </p>
                  </div>
                )}

                {(resellExpired || (resellDays !== null && resellDays <= 7)) && (
                  <div className="mt-5">
                    <Link to="/plans"><Button variant="secondary" size="sm">Renew service</Button></Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Paid active order (Firestore) ── */}
          {activeOrder && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    <h2 className="font-semibold">Active VPN plan</h2>
                  </div>
                  {statusBadge(activeOrder.status)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-3 gap-6 mb-4">
                  <Stat label="Plan" value={`${activeOrder.planName} — ${activeOrder.planDuration}`} />
                  <Stat label="Amount paid" value={formatCurrency(activeOrder.amount, activeOrder.currency)} />
                  {activeOrder.expiresAt && (
                    <Stat
                      label="Expires"
                      value={expired ? 'Expired' : `${days} days left`}
                      alert={expired || (days !== null && days <= 5)}
                    />
                  )}
                </div>

                {activeOrder.credentials && (
                  <>
                    <p className="text-sm font-medium mb-3 border-t border-gray-100 pt-5">VPN credentials</p>
                    <CredentialsBox
                      username={activeOrder.credentials.username}
                      password={activeOrder.credentials.password ?? extractPassword(activeOrder.credentials.notes)}
                      wgIp={activeOrder.credentials.wgIp}
                      wgPrivateKey={activeOrder.credentials.wgPrivateKey}
                      wgPublicKey={activeOrder.credentials.wgPublicKey}
                    />
                  </>
                )}

                {(expired || (days !== null && days <= 7)) && (
                  <div className="mt-5">
                    <Link to="/plans"><Button variant="secondary" size="sm">Renew service</Button></Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Free trial ── */}
          {trial?.status === 'active' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    <h2 className="font-semibold">Free 1-day trial</h2>
                  </div>
                  <Badge variant="success">Trial active</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 mb-4">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <span className="text-sm font-mono font-semibold">{trialTimeLeft} remaining</span>
                </div>
                {(trialUsername || trialPassword) ? (
                  <>
                    <p className="text-sm font-medium mb-3 border-t border-gray-100 pt-4">VPN credentials</p>
                    <CredentialsBox
                      username={trialUsername}
                      password={trialPassword}
                      wgIp={trialWgIp}
                      wgPrivateKey={trialWgPrivateKey}
                      wgPublicKey={trialWgPublicKey}
                    />
                  </>
                ) : trial.credentials ? (
                  <>
                    <p className="text-sm font-medium mb-3 border-t border-gray-100 pt-4">VPN credentials</p>
                    <CredentialsBox
                      username={trial.credentials.username}
                      password={trial.credentials.password}
                      wgIp={trial.credentials.wgIp}
                      wgPrivateKey={trial.credentials.wgPrivateKey}
                      wgPublicKey={trial.credentials.wgPublicKey}
                    />
                  </>
                ) : null}
                <div className="mt-5">
                  <Link to="/plans"><Button variant="secondary" size="sm">Upgrade to paid plan</Button></Link>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── App downloads (shown whenever user has active VPN) ── */}
          {hasActiveVpn && <AppDownloads username={activeUsername} password={activePassword} />}

          {/* ── Russia / DPI-bypass recommendation card (always visible for active users) ── */}
          {hasActiveVpn && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  <h2 className="font-semibold">🇷🇺 For users in Russia &amp; restricted countries</h2>
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4 mb-4">
                  <p className="text-sm font-medium text-blue-900 mb-1">
                    Standard VPN protocols (OpenVPN, WireGuard, IKEv2) are blocked in Russia.
                  </p>
                  <p className="text-xs text-blue-700">
                    We offer <strong>VLESS+REALITY</strong> — a next-generation protocol that makes your traffic look
                    like normal HTTPS browsing. It works on <strong>all devices including iPhone</strong> and is
                    undetectable by Russian DPI systems.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link to="/russia-guide">
                    <Button variant="secondary" size="sm">
                      📖 Russia setup guide
                    </Button>
                  </Link>
                  <a href="https://t.me/ikambavpn" target="_blank" rel="noopener noreferrer">
                    <Button variant="secondary" size="sm">
                      💬 Telegram support
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Switch to the <strong>🇷🇺 VLESS</strong> tab in your VPN credentials section above to see the recommended apps and setup instructions.
                </p>
              </CardContent>
            </Card>
          )}

          {/* ── Trial expired ── */}
          {trial?.status === 'expired' && !activeOrder && (
            <Card>
              <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-gray-300" />
                <p className="font-medium text-gray-700">Your free trial has ended</p>
                <p className="text-sm text-gray-400 max-w-xs">Subscribe to keep your VPN access.</p>
                <Link to="/plans"><Button size="sm">View plans</Button></Link>
              </CardContent>
            </Card>
          )}

          {/* ── No service at all ── */}
          {!activeOrder && !isTrialUser && trial?.status !== 'active' && trial?.status !== 'expired' && !resellIsActive && (
            <Card>
              <CardContent className="py-10 flex flex-col items-center gap-4 text-center">
                <Shield className="w-10 h-10 text-gray-300" />
                <p className="font-medium text-gray-700">No active VPN service</p>
                <p className="text-sm text-gray-400 max-w-xs">Browse our plans or try free for 1 day.</p>
                <div className="flex gap-2">
                  <Link to="/plans"><Button>Browse plans</Button></Link>
                  {!trial && <Link to="/trial"><Button variant="secondary">Try free</Button></Link>}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Offer trial link (subtle) ── */}
          {!trial && !activeOrder && !resellIsActive && (
            <Link
              to="/trial"
              className="flex items-center justify-between border border-dashed border-gray-200 rounded-2xl px-5 py-4 hover:border-black transition"
            >
              <div className="flex items-center gap-3">
                <Zap className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium">Try Ikamba VPN free for 1 day</span>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          )}

          {/* ── Pending orders ── */}
          {pendingOrders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Pending orders</h2>
              <div className="flex flex-col gap-3">
                {pendingOrders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-gray-400" />
                        <div>
                          <p className="text-sm font-medium">{order.planName} — {order.planDuration}</p>
                          <p className="text-xs text-gray-400">Submitted {formatDate(order.createdAt)}</p>
                        </div>
                      </div>
                      {statusBadge(order.status)}
                    </CardContent>
                  </Card>
                ))}
                <p className="text-xs text-gray-400 flex items-center gap-1.5 px-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Orders are typically activated within a few hours after payment review.
                </p>
              </div>
            </div>
          )}

          {/* ── Order history ── */}
          {orders.length > 0 && (
            <div>
              <h2 className="font-semibold mb-3 text-sm text-gray-500 uppercase tracking-wide">Order history</h2>
              <Card>
                <div className="divide-y divide-gray-50">
                  {orders.map((order) => (
                    <div key={order.id} className="px-5 py-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{order.planName}</p>
                        <p className="text-xs text-gray-400">{formatDate(order.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-gray-600">{formatCurrency(order.amount, order.currency)}</span>
                        {statusBadge(order.status)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ── Quick links ── */}
          <div className="grid sm:grid-cols-2 gap-3">
            <Link to="/plans" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Browse plans</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
            <Link to="/account" className="flex items-center justify-between border border-gray-100 rounded-2xl px-5 py-4 hover:border-black transition">
              <span className="font-medium text-sm">Account settings</span>
              <ChevronRight className="w-4 h-4 text-gray-400" />
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div>
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`font-semibold text-sm ${alert ? 'text-red-500' : 'text-black'}`}>{value}</p>
    </div>
  );
}
