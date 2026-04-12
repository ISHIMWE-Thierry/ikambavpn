import { Link } from 'react-router-dom';
import { Shield, Globe, Smartphone, Monitor, ArrowLeft, ExternalLink, Check, Landmark, AlertTriangle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

// ── App data ──────────────────────────────────────────────────────────────────

const IOS_APPS = [
  {
    name: 'Изи VPN (Easy VPN)',
    badge: 'Recommended',
    desc: 'Best for Russia — available in Russian App Store. Supports VLESS Reality + clipboard import.',
    url: 'https://apps.apple.com/ru/app/%D0%B8%D0%B7%D0%B8-vpn/id6746414734?l=en-GB',
    free: true,
  },
  {
    name: 'V2App',
    badge: 'Full Protocol',
    desc: 'Supports VLESS+Reality, XHTTP, Trojan. Available on Russian App Store.',
    url: 'https://apps.apple.com/app/v2app/id6670790798',
    free: true,
  },
  {
    name: 'V2RayTun',
    badge: 'International',
    desc: 'Great app for iPhone & Mac. May not be available in Russian App Store.',
    url: 'https://apps.apple.com/app/id6476628951',
    free: true,
  },
  {
    name: 'Streisand',
    badge: 'Open Source',
    desc: 'Free and open source. Supports Ikamba VPN protocol.',
    url: 'https://apps.apple.com/app/streisand/id6450534064',
    free: true,
  },
];

const ANDROID_APPS = [
  {
    name: 'V2RayNG',
    badge: 'Recommended',
    desc: 'Most popular client on Android. Supports subscription auto-update.',
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
            <p className="text-sm text-gray-500">Ikamba VPN — works on all devices, invisible to DPI</p>
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
              <strong>Ikamba VPN</strong> is a next-generation protocol that solves this by making your
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
                  <li>• <strong>Ikamba VPN</strong> (what we use)</li>
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
              title="Install Изи VPN"
              desc="Download Изи VPN from the App Store (iPhone) or V2RayNG from Google Play (Android). Alternatives: V2App, V2RayTun, Streisand."
            />
            <Step
              num={2}
              title="Copy your VPN link"
              desc="Go to your Dashboard → tap 'Copy VPN Link'. Your personal subscription link is copied."
            />
            <Step
              num={3}
              title="Paste & connect!"
              desc="In Изи VPN, tap + → 'Import from clipboard' → tap Connect. Done!"
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
          <h3 className="text-sm font-semibold mb-2">📱 iPhone step-by-step (Изи VPN)</h3>
          <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
            <li>Open the <a href="https://apps.apple.com/ru/app/%D0%B8%D0%B7%D0%B8-vpn/id6746414734?l=en-GB" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">App Store link</a> → Install <strong>Изи VPN</strong></li>
            <li>Go to your <strong>IkambaVPN Dashboard</strong> → tap <strong>"Copy VPN Link"</strong></li>
            <li>Open Изи VPN → tap <strong>+</strong> → <strong>"Import from clipboard"</strong></li>
            <li>Your server appears in the list → tap <strong>Connect</strong></li>
            <li>Allow VPN configuration when iOS prompts you</li>
            <li>✅ Connected! The VPN icon (🔒) appears in your status bar</li>
          </ol>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-2 mt-3 text-xs text-blue-800">
            <strong>💡 Alternatives:</strong>{' '}
            <a href="https://apps.apple.com/app/v2app/id6670790798" target="_blank" rel="noopener noreferrer" className="underline font-medium">V2App</a>{' '}
            (Full Protocol) •{' '}
            <a href="https://apps.apple.com/app/id6476628951" target="_blank" rel="noopener noreferrer" className="underline font-medium">V2RayTun</a>{' '}
            (International) •{' '}
            <a href="https://apps.apple.com/app/streisand/id6450534064" target="_blank" rel="noopener noreferrer" className="underline font-medium">Streisand</a>{' '}
            (Open Source) — all support VLESS Reality and clipboard import.
          </div>
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

      {/* ── Russian Banks & Split Routing ── */}
      <Card className="mb-6 border-amber-200 bg-amber-50/30">
        <CardHeader>
          <h2 className="font-semibold flex items-center gap-2">
            <Landmark className="w-5 h-5 text-amber-600" />
            🏦 Доступ к российским банкам и .ru сайтам
          </h2>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-gray-700 flex flex-col gap-3">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-900 text-xs">
              <strong>⚠️ Проблема:</strong> Когда VPN включён, весь ваш трафик идёт через финский сервер.
              Российские банки (Сбербанк, Тинькофф, ВТБ и др.) и сайты .ru <strong>блокируют иностранные IP-адреса</strong>.
              Поэтому с включённым VPN вы не можете открыть сбербанк или другие российские сервисы.
            </div>
            <p>
              <strong>Решение:</strong> Переключите VPN-приложение в режим <strong>«Правила» (Rule mode)</strong>.
              В этом режиме российские сайты и банки идут <em>напрямую</em> через ваш обычный интернет,
              а всё остальное — через VPN.
            </p>

            {/* V2RayNG (Android) */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-2">📱 V2RayNG (Android)</h3>
              <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
                <li>Откройте V2RayNG</li>
                <li>В нижней панели нажмите на текущий режим (обычно написано <strong>«Global»</strong> или <strong>«Глобальный»</strong>)</li>
                <li>Выберите <strong>«Rule» / «Правила»</strong></li>
                <li>Перейдите в <strong>Settings → Routing Settings</strong></li>
                <li>Выберите <strong>«Bypass mainland China and Russia»</strong> или <strong>«Russia direct»</strong></li>
                <li>Если такой опции нет — выберите <strong>«Custom rules»</strong> и добавьте в поле <strong>«Direct Domain or IP»</strong>:
                  <div className="bg-gray-100 rounded-lg p-2 mt-1 font-mono text-[10px] leading-relaxed select-all">
                    geosite:category-ru<br/>
                    geoip:ru<br/>
                    domain:sberbank.ru<br/>
                    domain:tinkoff.ru<br/>
                    domain:vtb.ru<br/>
                    domain:alfabank.ru<br/>
                    domain:gosuslugi.ru
                  </div>
                </li>
                <li>Нажмите <strong>✓ / Сохранить</strong></li>
              </ol>
            </div>

            {/* Hiddify (Android/iOS/Desktop) */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-2">📱 Hiddify (Android / iOS / Desktop)</h3>
              <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
                <li>Откройте Hiddify</li>
                <li>Нажмите на режим подключения (обычно <strong>«TUN»</strong> или <strong>«System Proxy»</strong>)</li>
                <li>Перейдите в <strong>Settings → Routing</strong></li>
                <li>Переключите режим с <strong>«All»</strong> на <strong>«Exclude»</strong> или <strong>«Rule-based»</strong></li>
                <li>В списке исключений добавьте:
                  <div className="bg-gray-100 rounded-lg p-2 mt-1 font-mono text-[10px] select-all">
                    *.ru, *.рф, sberbank.ru, tinkoff.ru, vtb.ru, alfabank.ru, gosuslugi.ru
                  </div>
                </li>
                <li>Сохраните настройки и переподключитесь</li>
              </ol>
            </div>

            {/* V2RayTun / Изи VPN / Streisand (iOS) */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h3 className="text-sm font-semibold mb-2">📱 V2RayTun / Изи VPN / V2App (iOS)</h3>
              <ol className="text-xs text-gray-700 list-decimal ml-4 flex flex-col gap-1.5">
                <li>Откройте приложение</li>
                <li>Перейдите в <strong>Настройки → Routing / Маршрутизация</strong></li>
                <li>Переключите режим с <strong>«Global Proxy»</strong> на <strong>«Rule»</strong> или <strong>«Bypass LAN and China/RU»</strong></li>
                <li>Если доступны пользовательские правила — добавьте <strong>geosite:category-ru</strong> и <strong>geoip:ru</strong> в <strong>Direct</strong></li>
                <li>Переподключитесь к VPN</li>
              </ol>
              <p className="text-xs text-gray-500 mt-2">
                <strong>💡 Простой способ:</strong> Если ваше приложение не поддерживает правила маршрутизации,
                просто <strong>выключите VPN</strong> когда пользуетесь Сбербанком или другими российскими сервисами,
                а потом включите обратно.
              </p>
            </div>

            {/* Quick workaround */}
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <h3 className="text-xs font-semibold text-green-800 mb-1">✅ Самый простой способ</h3>
              <p className="text-xs text-green-700">
                Если настройка правил кажется сложной — просто <strong>отключайте VPN</strong> когда открываете
                Сбербанк, Тинькофф, Госуслуги или другие .ru сайты. Потом включите VPN обратно.
                Это самый надёжный способ.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Troubleshooting ── */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="font-semibold">🔧 Troubleshooting</h2>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 text-sm">
            <FAQ
              q="I can't open Sberbank / Tinkoff / VTB / other Russian banks"
              a="Russian banks block foreign IP addresses. When VPN is on, they see a Finnish IP and refuse. Solution: Switch your VPN app to 'Rule' mode (see the '🏦 Russian Banks' section above) — this sends Russian traffic directly without VPN. Or simply turn off VPN when using Russian banking apps."
            />
            <FAQ
              q=".ru websites don't load with VPN on"
              a="Some .ru sites restrict access from foreign IPs. Use 'Rule' mode in your VPN app to bypass Russian domains, or temporarily disable VPN for .ru sites."
            />
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
              a="No. Ikamba VPN makes your traffic indistinguishable from visiting microsoft.com. Your ISP sees encrypted HTTPS traffic to what appears to be a Microsoft server."
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
              <li><strong>iPhone:</strong> <a href="https://apps.apple.com/ru/app/%D0%B8%D0%B7%D0%B8-vpn/id6746414734?l=en-GB" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">Изи VPN</a> — рекомендуем, доступен в российском App Store</li>
              <li><strong>Альтернативы iPhone:</strong> <a href="https://apps.apple.com/app/v2app/id6670790798" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">V2App</a> • <a href="https://apps.apple.com/app/id6476628951" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">V2RayTun</a> • <a href="https://apps.apple.com/app/streisand/id6450534064" target="_blank" rel="noopener noreferrer" className="underline text-blue-600">Streisand</a></li>
              <li><strong>Android:</strong> V2RayNG из Google Play или скачайте APK с GitHub</li>
              <li><strong>Компьютер:</strong> Hiddify (Windows/macOS/Linux) с GitHub</li>
            </ul>
            <p><strong>Шаг 2:</strong> Перейдите в <strong>Панель управления</strong> → нажмите <strong>«Copy VPN Link»</strong></p>
            <p><strong>Шаг 3:</strong> Откройте Изи VPN → <strong>+</strong> → <strong>«Import from clipboard»</strong></p>
            <p><strong>Шаг 4:</strong> Нажмите <strong>«Подключиться»</strong> → готово! ✅</p>
            <p className="mt-2"><strong>⚠️ Сбербанк / Тинькофф / банки:</strong> Если не открываются банки — переключите режим VPN на <strong>«Правила» (Rule)</strong>. Подробная инструкция выше в разделе «🏦 Доступ к российским банкам».</p>
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
