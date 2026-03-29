import { Link } from 'react-router-dom';
import { Shield, Globe, Smartphone, Monitor, ArrowLeft, ExternalLink, Check } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

// ── App data ──────────────────────────────────────────────────────────────────

const IOS_APPS = [
  {
    name: 'V2RayTun',
    badge: 'Recommended',
    desc: 'Best experience on iPhone & Mac. Supports VLESS+REALITY and clipboard import.',
    url: 'https://apps.apple.com/app/id6476628951',
    free: true,
  },
  {
    name: 'Streisand',
    badge: 'Alternative',
    desc: 'Free and open source. Supports VLESS+REALITY.',
    url: 'https://apps.apple.com/app/streisand/id6450534064',
    free: true,
  },
];

const ANDROID_APPS = [
  {
    name: 'V2RayNG',
    badge: 'Recommended',
    desc: 'Most popular VLESS client on Android. Supports subscription auto-update.',
    url: 'https://play.google.com/store/apps/details?id=com.v2ray.ang',
    free: true,
  },
  {
    name: 'Hiddify',
    badge: 'Great UI',
    desc: 'Beautiful interface, supports all Xray protocols. Also available on desktop.',
    url: 'https://play.google.com/store/apps/details?id=app.hiddify.com',
    free: true,
  },
  {
    name: 'NekoBox',
    badge: 'Advanced',
    desc: 'For power users. GitHub APK download required if not on Play Store.',
    url: 'https://github.com/MatsuriDayo/NekoBoxForAndroid/releases',
    free: true,
  },
];

const DESKTOP_APPS = [
  {
    name: 'Hiddify',
    platforms: 'Windows / macOS / Linux',
    desc: 'Cross-platform, beautiful UI, supports subscription links.',
    url: 'https://github.com/hiddify/hiddify-app/releases',
  },
  {
    name: 'V2RayTun',
    platforms: 'macOS',
    desc: 'Same great app as on iOS, also works on Mac.',
    url: 'https://apps.apple.com/app/id6476628951',
  },
  {
    name: 'V2RayN',
    platforms: 'Windows',
    desc: 'Classic Windows client with tray icon. Popular in the community.',
    url: 'https://github.com/2dust/v2rayN/releases',
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function RussiaGuidePage() {
  return (
    <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 py-10">
      {/* Back nav */}
      <Link to="/dashboard" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>

      {/* Hero */}
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-black">🇷🇺 Russia VPN Setup Guide</h1>
            <p className="text-sm text-gray-500">VLESS+REALITY — works on all devices, invisible to DPI</p>
          </div>
        </div>
      </div>

      {/* ── Why you need this ── */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Why standard VPN doesn't work in Russia
          </h2>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-700 flex flex-col gap-2">
            <p>
              Russia uses <strong>deep packet inspection (DPI)</strong> to detect and block VPN protocols.
              OpenVPN, WireGuard, IKEv2, and even most "stealth" modes are identified and blocked.
            </p>
            <p>
              <strong>VLESS+REALITY</strong> is a next-generation protocol that solves this by making your
              traffic look <em>identical</em> to visiting a normal website like microsoft.com. The DPI system
              sees real TLS 1.3 handshakes with real certificates — it cannot tell it's a VPN.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              <div className="bg-red-50 border border-red-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-800 mb-1">❌ Blocked in Russia</p>
                <ul className="text-xs text-red-600 flex flex-col gap-0.5">
                  <li>• OpenVPN (UDP &amp; TCP)</li>
                  <li>• WireGuard</li>
                  <li>• IKEv2</li>
                  <li>• L2TP/IPSec</li>
                  <li>• Most "stealth" / "obfuscation" modes</li>
                </ul>
              </div>
              <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-green-800 mb-1">✅ Works in Russia</p>
                <ul className="text-xs text-green-600 flex flex-col gap-0.5">
                  <li>• <strong>VLESS+REALITY</strong> (what we use)</li>
                  <li>• VLESS+WebSocket+TLS</li>
                  <li>• Trojan+REALITY</li>
                  <li>• Hysteria2 (QUIC-based)</li>
                  <li>• SSH tunneling (slow but works)</li>
                </ul>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── How it works ── */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold">How it works — 3 simple steps</h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Step
              num={1}
              title="Install V2RayTun"
              desc="Download V2RayTun from the App Store (iPhone/Mac) or V2RayNG from Google Play (Android)."
            />
            <Step
              num={2}
              title="Get your VLESS link"
              desc="Go to your Dashboard → VLESS tab → tap 'Start free trial'. Copy the link that appears."
            />
            <Step
              num={3}
              title="Paste & connect!"
              desc="In V2RayTun, tap + → 'Import from clipboard' → tap Connect. Done!"
            />
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mt-4 text-xs text-blue-700">
            <strong>💡 How subscriptions work:</strong> Your subscription link auto-updates.
            If we change servers (e.g. when an IP gets blocked), your app picks up the new server
            automatically the next time you connect. No manual action needed.
          </div>
        </CardContent>
      </Card>

      {/* ── iOS apps ── */}
      <div className="mb-6">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          iPhone / iPad apps
        </h2>
        <div className="flex flex-col gap-3">
          {IOS_APPS.map((app) => (
            <AppCard key={app.name} {...app} />
          ))}
        </div>

        {/* iOS specific instructions */}
        <div className="mt-4 bg-gray-50 border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">📱 iPhone step-by-step (V2RayTun)</h3>
          <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
            <li>Open the <a href="https://apps.apple.com/app/id6476628951" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">App Store link</a> → Install <strong>V2RayTun</strong></li>
            <li>Go to your <strong>IkambaVPN Dashboard</strong> → tap the <strong>🇷🇺 VLESS</strong> tab</li>
            <li>Tap <strong>"Start free trial"</strong> to get your connection link</li>
            <li>Tap <strong>"Copy link"</strong></li>
            <li>Open V2RayTun → tap <strong>+</strong> → <strong>"Import from clipboard"</strong></li>
            <li>Your server appears in the list → tap <strong>Connect</strong></li>
            <li>Allow VPN configuration when iOS prompts you</li>
            <li>✅ Connected! The VPN icon (🔒) appears in your status bar</li>
          </ol>
        </div>
      </div>

      {/* ── Android apps ── */}
      <div className="mb-6">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Android apps
        </h2>
        <div className="flex flex-col gap-3">
          {ANDROID_APPS.map((app) => (
            <AppCard key={app.name} {...app} />
          ))}
        </div>

        <div className="mt-4 bg-gray-50 border border-gray-100 rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-2">📱 Android step-by-step (V2RayNG)</h3>
          <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
            <li>Install <strong>V2RayNG</strong> from Google Play</li>
            <li>Open V2RayNG</li>
            <li>Tap the <strong>+</strong> button</li>
            <li>Choose <strong>"Import config from URL"</strong></li>
            <li>Paste your subscription link → tap OK</li>
            <li>Tap the ▶️ (play) button at the bottom</li>
            <li>Allow VPN connection when Android prompts</li>
            <li>✅ Connected! The key icon (🔑) appears in your status bar</li>
          </ol>
          <p className="text-xs text-gray-500 mt-2">
            <strong>Tip:</strong> In V2RayNG settings, enable <strong>"Update subscription on connect"</strong>
            so servers refresh automatically.
          </p>
        </div>
      </div>

      {/* ── Desktop apps ── */}
      <div className="mb-6">
        <h2 className="font-semibold text-lg mb-3 flex items-center gap-2">
          <Monitor className="w-5 h-5" />
          Desktop apps (Windows / macOS / Linux)
        </h2>
        <div className="flex flex-col gap-3">
          {DESKTOP_APPS.map((app) => (
            <a
              key={app.name}
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3 hover:border-black transition"
            >
              <div>
                <p className="text-sm font-medium">{app.name}</p>
                <p className="text-xs text-gray-400">{app.platforms}</p>
                <p className="text-xs text-gray-500 mt-0.5">{app.desc}</p>
              </div>
              <ExternalLink className="w-4 h-4 text-gray-300 shrink-0" />
            </a>
          ))}
        </div>
      </div>

      {/* ── Troubleshooting ── */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold">🔧 Troubleshooting</h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-sm">
            <FAQ
              q="I imported the subscription but can't connect"
              a="Try updating the subscription (pull-to-refresh in V2RayTun, or tap the refresh icon in V2RayNG). If the server IP was recently blocked, the subscription will provide a new server."
            />
            <FAQ
              q="V2RayTun says 'Invalid subscription'"
              a="Make sure you're copying the full URL starting with https://. If the link was sent via Telegram, make sure it wasn't truncated."
            />
            <FAQ
              q="Connection drops after a few minutes"
              a="Some ISPs in Russia do periodic resets. Enable 'Keep Alive' or 'Auto-reconnect' in your app settings."
            />
            <FAQ
              q="Is this legal in Russia?"
              a="Using a VPN is not illegal in Russia. Only providing VPN services from within Russian territory without compliance is restricted. Our servers are in Finland."
            />
            <FAQ
              q="Can my ISP see I'm using a VPN?"
              a="No. VLESS+REALITY makes your traffic indistinguishable from visiting microsoft.com. Your ISP sees encrypted HTTPS traffic to what appears to be a Microsoft server."
            />
            <FAQ
              q="The Google Play Store is blocked on my phone"
              a="Download V2RayNG APK directly from GitHub: github.com/2dust/v2rayNG/releases. For Hiddify: github.com/hiddify/hiddify-app/releases"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Russian-language quick summary ── */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold">🇷🇺 Краткая инструкция (на русском)</h2>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-700 flex flex-col gap-2">
            <p><strong>Шаг 1:</strong> Скачайте приложение:</p>
            <ul className="list-disc ml-5 text-xs flex flex-col gap-0.5">
              <li><strong>iPhone / Mac:</strong> <a href="https://apps.apple.com/app/id6476628951" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">V2RayTun из App Store</a></li>
              <li><strong>Android:</strong> V2RayNG из Google Play или скачайте APK с GitHub</li>
              <li><strong>Компьютер:</strong> Hiddify (Windows/macOS/Linux) с GitHub</li>
            </ul>
            <p><strong>Шаг 2:</strong> Перейдите в <strong>Панель управления</strong> → вкладка <strong>🇷🇺 VLESS</strong> → нажмите <strong>«Start free trial»</strong></p>
            <p><strong>Шаг 3:</strong> Скопируйте ссылку → откройте V2RayTun → <strong>+</strong> → <strong>«Import from clipboard»</strong></p>
            <p><strong>Шаг 4:</strong> Нажмите <strong>«Подключиться»</strong> → готово! ✅</p>
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 mt-1 text-xs text-blue-700">
              💬 Если нужна помощь, напишите нам в Telegram: <a href="https://t.me/ikambavpn" target="_blank" rel="noopener noreferrer" className="underline font-medium">@ikambavpn</a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CTA */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-center py-6">
        <Link to="/dashboard">
          <Button>← Back to Dashboard</Button>
        </Link>
        <Link to="/plans">
          <Button variant="secondary">View plans</Button>
        </Link>
        <a href="https://t.me/ikambavpn" target="_blank" rel="noopener noreferrer">
          <Button variant="secondary">💬 Telegram support</Button>
        </a>
      </div>
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 bg-black text-white rounded-full flex items-center justify-center text-xs font-bold shrink-0">
        {num}
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
    </div>
  );
}

function AppCard({
  name,
  badge,
  desc,
  url,
  free,
  price,
}: {
  name: string;
  badge: string;
  desc: string;
  url: string;
  free?: boolean;
  price?: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3 hover:border-black transition"
    >
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold">{name}</span>
          <Badge variant={badge === 'Recommended' ? 'success' : 'muted'}>{badge}</Badge>
          {free && <span className="text-[10px] text-green-600 font-medium">FREE</span>}
          {price && <span className="text-[10px] text-gray-400">{price}</span>}
        </div>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <ExternalLink className="w-4 h-4 text-gray-300 shrink-0 ml-3" />
    </a>
  );
}

function FAQ({ q, a }: { q: string; a: string }) {
  return (
    <details className="group">
      <summary className="cursor-pointer font-medium text-gray-800 hover:text-black transition">
        {q}
      </summary>
      <p className="mt-1 text-gray-500 text-xs pl-1">{a}</p>
    </details>
  );
}
