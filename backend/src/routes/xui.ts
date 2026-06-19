/**
 * 3X-UI / VLESS+REALITY routes
 *
 * These endpoints manage VLESS+REALITY users on the 3X-UI panel.
 * They sit alongside the existing VPNresellers routes — they don't replace anything.
 *
 * All routes require authentication (authMiddleware applied in index.ts).
 */

import { Router, Request, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import {
  provisionUser,
  addClient,
  updateClient,
  deleteClient,
  setClientEnabled,
  getClientStatByEmail,
  getClientStats,
  listInbounds,
  getSystemStatus,
  getAllClientLinks,
  getV2RayTunDeepLink,
  buildVlessLink,
  buildXhttpLink,
  buildWsLink,
  buildBrazilDpiXhttpLink,
  buildNonsubTcpLink,
  BRAZIL_CLEAN_IP,
  GB,
  daysFromNow,
  resetClientTraffic,
  getCachedSubscription,
  clearSubCache,
  resolveSubscriptionEmail,
  findSubscriptionClient,
  buildTcpRealityLinks,
  getAllOnlineClients,
  getRecentConnections,
  getUserActivitySummaries,
  isNoiseDest,
} from "../services/xui";
import { getFirestore } from "../services/firebase";
import { getHistory } from "../services/vpn-analytics";
import {
  createPayment,
  getPayment,
  verifyWebhookPayment,
  isYooKassaConfigured,
} from "../services/yookassa";

export const xuiRouter = Router();

/**
 * Public router for subscription endpoints — NO auth middleware.
 * V2RayTun / V2RayNG / Hiddify call these directly.
 */
export const xuiPublicRouter = Router();

/**
 * Check if a user is admin.
 * 1. Insecure/dev mode: all authenticated requests are trusted as admin
 *    (auth middleware already skips real token verification)
 * 2. Firebase custom claims: decoded.admin === true
 * 3. Firestore user doc: users/{uid}.role === 'admin'
 */
const insecureMode = process.env.ALLOW_INSECURE_FIREBASE === "true";

async function checkIsAdmin(user: any): Promise<boolean> {
  if (!user?.uid) return false;
  // In insecure mode, auth is already bypassed — trust the caller
  if (insecureMode) return true;
  // Check Firebase custom claims first (fast)
  if (user.admin === true) return true;
  if (user.claims?.admin === true) return true;
  // Fallback: check Firestore user document role
  try {
    const db = getFirestore();
    const doc = await db.collection("users").doc(user.uid).get();
    if (doc.exists && doc.data()?.role === "admin") return true;
  } catch {
    // Firestore unavailable — rely on claims only
  }
  return false;
}

// ── Public subscription endpoint ──────────────────────────────────────────────

export async function publicSubscriptionHandler(req: Request, res: Response) {
  try {
    const identifier = req.params.email || req.params.identifier || req.params.subId;
    const email = await resolveSubscriptionEmail(identifier);

    const entry = await getCachedSubscription(email);
    if (!entry) {
      return res.status(404).send("Client not found");
    }

    const tcpOnly =
      req.query.tcp_only === "1" || req.query.profile === "tcp";
    let payload = entry.vlessLink;
    if (tcpOnly) {
      const lookup = await findSubscriptionClient(email);
      if (!lookup) return res.status(404).send("Client not found");
      const remark = `IkambaVPN-${email.split("@")[0]}`;
      const tcpLinks = buildTcpRealityLinks(lookup.client.id, remark);
      if (!tcpLinks.length) {
        return res.status(503).send("TCP REALITY profiles not configured");
      }
      payload = tcpLinks.join("\n");
    }

    const base64 = Buffer.from(payload).toString("base64");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Profile-Update-Interval", "1"); // Check every 1 hour for config updates
    res.setHeader("Subscription-Userinfo", entry.userInfo);
    res.setHeader("ETag", `"sub-${Date.now()}"`);
    res.setHeader("Last-Modified", new Date().toUTCString());
    // Subscription profiles change during live server failover; force clients and
    // intermediaries to revalidate so new locations appear immediately.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.send(base64);
  } catch (err: any) {
    console.error(`[sub] Error for ${req.params.email || req.params.identifier || req.params.subId}:`, err.message);
    // Return 503 (temporary) instead of 500 so clients know to retry
    return res.status(503).send("Temporarily unavailable - please retry");
  }
}

export function publicSubscriptionRedirectHandler(req: Request, res: Response) {
  const identifier = req.params.email || req.params.identifier || req.params.subId;
  const base = process.env.PUBLIC_SUB_BASE || `${req.protocol}://${req.get("host")}`;
  return res.redirect(307, `${base}/xui-public/sub/${encodeURIComponent(identifier)}`);
}

/**
 * GET /xui-public/health
 * Public health check — no auth. Frontend and users can call this to check
 * whether our VPN server / Xray process is running.
 */
xuiPublicRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const status = await getSystemStatus();
    const online = status.xray?.state === "running";
    return res.json({ ok: true, online, xray: status.xray?.state, ts: Date.now() });
  } catch {
    return res.status(503).json({ ok: false, online: false, ts: Date.now() });
  }
});

/**
 * GET /xui-public/diagnose
 * Connection diagnostics — helps users figure out if the problem is:
 *   1. Their internet connection (can they reach us at all?)
 *   2. Our backend server (is the API running?)
 *   3. The Xray/VLESS process (is the VPN tunnel service up?)
 *   4. The 3X-UI panel (can we manage accounts?)
 *
 * NO AUTH — so users can run this even when VPN is broken.
 * Returns a checklist of what works and what doesn't, plus a human-readable verdict.
 */
xuiPublicRouter.get("/diagnose", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const results = {
    ts: startTime,
    // If user got this response, their internet + our API are working
    internetToApi: true,
    apiLatencyMs: 0,
    xrayRunning: false,
    xrayState: "unknown" as string,
    panelReachable: false,
    serverCpu: 0,
    serverMemPct: 0,
    serverUptime: 0,
    verdict: "" as string,
    suggestion: "" as string,
    userIp: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown",
  };

  // Check 1: Xray status + system stats
  try {
    const status = await getSystemStatus();
    results.xrayRunning = status.xray?.state === "running";
    results.xrayState = status.xray?.state || "unknown";
    results.panelReachable = true;
    results.serverCpu = status.cpu || 0;
    results.serverMemPct = status.mem?.total
      ? Math.round((status.mem.current / status.mem.total) * 100)
      : 0;
    results.serverUptime = status.uptime || 0;
  } catch {
    results.panelReachable = false;
  }

  results.apiLatencyMs = Date.now() - startTime;

  // Build verdict
  if (results.xrayRunning && results.panelReachable) {
    results.verdict = "✅ Our VPN server is fully operational.";
    results.suggestion =
      "If you can't connect, the issue is likely on your side: " +
      "check your internet connection, try switching between Wi-Fi and mobile data, " +
      "or restart the VPN app. If you're in a restricted country, make sure you're " +
      "using V2RayTun (iOS) or V2RayNG (Android).";
  } else if (!results.xrayRunning && results.panelReachable) {
    results.verdict = "⚠️ Our VPN tunnel (Xray) is down, but the server is reachable.";
    results.suggestion =
      "This is a problem on our end — the VPN service crashed. " +
      "It should auto-restart within 2 minutes. If it doesn't, contact support.";
  } else if (!results.panelReachable) {
    results.verdict = "⚠️ Our VPN management panel is unreachable.";
    results.suggestion =
      "The server may be restarting or under maintenance. " +
      "Your existing VPN connection should continue working. " +
      "If you can't connect at all, try again in 5 minutes.";
  }

  if (results.serverMemPct > 85) {
    results.suggestion +=
      " ⚠️ Server memory is at " + results.serverMemPct + "% — performance may be degraded.";
  }

  return res.json(results);
});

/**
 * GET /xui-public/sub/:email
 * Self-hosted subscription endpoint — returns base64-encoded VLESS link.
 * V2RayTun / V2RayNG / Hiddify all expect this format from subscription URLs.
 * NO AUTH required — apps call this directly.
 *
 * CRITICAL: This endpoint uses an in-memory cache so that brief 3X-UI panel
 * outages (restarts, memory spikes) don't cause V2RayTun/V2RayNG to drop the
 * connection. The apps poll this URL every few minutes — if it returns an error,
 * they disconnect the user (the #1 cause of "VPN auto goes off").
 */
/**
 * GET /xui-public/stats/:email
 * Public traffic stats for a user — no auth required.
 * Returns 404 if the user hasn't been provisioned yet (expected for new users).
 */
xuiPublicRouter.get("/stats/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const stat = await getClientStatByEmail(email);
    if (!stat) return res.json({ ok: false, error: "Client not found" });
    return res.json({
      ok: true,
      data: {
        email: stat.email,
        upload: stat.up,
        download: stat.down,
        total: stat.up + stat.down,
        limit: stat.total,
        enabled: stat.enable,
        expiryTime: stat.expiryTime,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui-public/xhttp-link/:email
 * Returns the raw VLESS+XHTTP+REALITY link for a user.
 * Used by the dashboard "Copy backup link" button.
 */
xuiPublicRouter.get("/xhttp-link/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const entry = await getCachedSubscription(email);
    if (!entry) return res.status(404).json({ ok: false });

    // The cached vlessLink is "wsLink\ntcpLink\nxhttpLink" — XHTTP is third (index 2)
    const links = entry.vlessLink.split("\n");
    const xhttpLink = links[2] || links[1]; // fallback to TCP if no XHTTP
    if (!xhttpLink) return res.status(404).json({ ok: false, error: "XHTTP link not available" });

    return res.json({ ok: true, link: xhttpLink });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui-public/ws-link/:email
 * Returns the raw VLESS+WebSocket link for a user.
 * WS is now the DEFAULT/PRIMARY transport — it multiplexes all traffic
 * over one persistent TCP connection, defeating ISP connection-count DPI.
 */
xuiPublicRouter.get("/ws-link/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const entry = await getCachedSubscription(email);
    if (!entry) return res.status(404).json({ ok: false });

    // The cached vlessLink is "wsLink\ntcpLink\nxhttpLink" — WS is first (index 0)
    const wsLink = entry.vlessLink.split("\n")[0];
    if (!wsLink) return res.status(404).json({ ok: false, error: "WS link not available" });

    return res.json({ ok: true, link: wsLink });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui-public/happ  (and /happ alias)
 * One-tap onboarding: an https page that redirects to the Happ crypto deep link.
 * Telegram/markdown buttons only allow http(s) URLs, so this https wrapper is
 * what makes a clickable "Connect" button possible. Tapping it opens Happ and
 * imports the permanent subscription (which auto-updates forever).
 */
const HAPP_DEEPLINK =
  process.env.HAPP_DEEPLINK ||
  "happ://crypt3/A7zz/j6bTJxadnEuwEw0Jily+tcsy8X45ole7m/ctoqhlOUO9a7UsqXRAH5xyay5VTOXHt5VNUcB5m1Ian3G7QaVGtJagLRqukteoHgneVCtyaXwkPJiizREAoZYJsAQzoHP10RSmi6JuflSxVvNFqyB1X+1eXfoMFiLFSxfqGsZiSGCjFzIuaaOpMlOphKNcArkyRetD9iXXFs5x1ukxWLtnNwBSzpr6KRT4qBpKpRWnF/F2tPckNLmETlAMxRuw5cINYoVAHx/+FMtJgRIlv32SMuKZBYy1nX297WBZai673lGwOqMJ8V2zvUSHlBqr/j7Nn1W1gQjVQqqMcOcVjHXYJIokAyHTda3b5QwjAHTKSjVN2X56WWXuYa0klMYApCi0hqm/zzoSFIvlV1H0Jmi0JNg3DsdMUtkljm+O73IJ/rwtkq+r2ZpeF17WTMGQ3iROT2hUQ2zaxD5gmrGKJUq4pqO+6vwOu3KcyyUAc1viuS2gH3wEm8D0qBPc71eSrco/5VClzhCLCYN85Epx/K/Bf7rFmdFVveu78vzuz5xlOu+0iyTFCpOuXGR7oyj+U/SnhTXtJqiYBPLiLVzU+WW5i0yEW8gQwDC7am47gMpZ0ezWIrnda/XHmfdBgoI7iqc9rQ2j7rbk9KRJQCXP97/Z3A30h6WZfClK0cAC68=";

function happRedirectHandler(_req: Request, res: Response) {
  const sub = (process.env.PUBLIC_SUB_BASE || "https://ikambavpn.duckdns.org:8443") +
    "/xui-public/sub/free#IkambaVPN";
  const subJs = JSON.stringify(sub);
  const dlJs = JSON.stringify(HAPP_DEEPLINK);
  // Override helmet's strict CSP for this standalone onboarding page so the
  // inline <script>/<style> and Google Fonts load (helmet default blocks them).
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>IkambaVPN — Подключение</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#09090b;--card:#0c0c0e;--bd:#1f1f23;--bd2:#2a2a30;--fg:#fafafa;--mut:#8a8a93;--fg2:#e4e4e7}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:'Inter',ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg);margin:0;padding:28px 18px;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:430px;animation:rise .5s cubic-bezier(.16,1,.3,1)}
.brand{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:4px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 4px rgba(250,250,250,.12)}
h1{font-size:25px;font-weight:800;letter-spacing:-.03em;margin:0;text-align:center}
.tag{text-align:center;color:var(--mut);font-size:13px;font-weight:500;margin:6px 0 24px}
.seg{display:flex;gap:4px;background:var(--card);border:1px solid var(--bd);border-radius:13px;padding:4px;margin-bottom:22px}
.tab{flex:1;padding:10px 4px;border-radius:9px;text-align:center;font-size:13px;font-weight:600;color:var(--mut);cursor:pointer;background:transparent;border:none;transition:color .2s,background .2s;font-family:inherit}
.tab.on{background:var(--fg);color:#09090b}
.tab:not(.on):hover{color:var(--fg2)}
.panel{display:none}
.panel.on{display:block;animation:fade .32s cubic-bezier(.16,1,.3,1)}
.lbl{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--mut);margin:20px 0 10px}
.num{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:6px;background:var(--card);border:1px solid var(--bd2);font-size:11px;color:var(--fg2)}
.b{display:block;width:100%;padding:14px 16px;border-radius:12px;font-size:15px;font-weight:600;text-decoration:none;text-align:center;margin:8px 0;border:1px solid transparent;cursor:pointer;font-family:inherit;transition:transform .12s,background .2s,border-color .2s,opacity .2s}
.b:active{transform:scale(.985)}
.dl{background:var(--card);color:var(--fg);border-color:var(--bd2)}
.dl:hover{background:#141417;border-color:#3a3a42}
.primary{background:var(--fg);color:#09090b}
.primary:hover{background:#e4e4e7}
.ghost{background:transparent;color:var(--fg2);border-color:var(--bd2)}
.ghost:hover{background:var(--card)}
.hint{font-size:12px;color:var(--mut);margin:10px 2px 0;line-height:1.5}
.hint a{color:var(--fg2)}
.ok{height:16px;text-align:center;margin-top:8px;font-size:13px;font-weight:600;color:var(--fg);opacity:0;transition:opacity .25s}
.ok.show{opacity:1}
.foot{margin-top:22px;padding-top:16px;border-top:1px solid var(--bd)}
.lk{font-size:11px;color:#5a5a62;word-break:break-all;text-align:center;line-height:1.5}
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
</style></head>
<body><div class="wrap">
<div class="brand"><h1>IkambaVPN</h1></div>
<div class="tag">Подключение за одну минуту</div>

<div class="seg">
  <button class="tab" data-os="ios">iPhone</button>
  <button class="tab" data-os="android">Android</button>
  <button class="tab" data-os="desktop">Компьютер</button>
</div>

<div class="panel" data-panel="ios">
  <div class="lbl"><span class="num">1</span>Установите приложение Happ</div>
  <a class="b dl" href="https://apps.apple.com/us/app/happ-proxy-utility/id6504287215">App Store — Global</a>
  <a class="b dl" href="https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973">App Store — Россия</a>
  <div class="hint">Недоступно в вашем регионе? TestFlight: <a href="https://testflight.apple.com/join/XMls6Ckd">Global</a> · <a href="https://testflight.apple.com/join/1bKEcMub">RU</a></div>
  <div class="lbl"><span class="num">2</span>Подключитесь</div>
  <a class="b primary" data-conn href="#">Подключить автоматически</a>
  <button class="b ghost" data-copy>Скопировать ссылку</button>
  <div class="ok" data-ok></div>
  <div class="hint">Если кнопка не сработала — скопируйте ссылку и откройте Happ, он добавит сервер сам.</div>
</div>

<div class="panel" data-panel="android">
  <div class="lbl"><span class="num">1</span>Установите приложение Happ</div>
  <a class="b dl" href="https://play.google.com/store/apps/details?id=com.happproxy">Google Play</a>
  <a class="b dl" href="https://github.com/Happ-proxy/happ-android/releases/latest/download/Happ.apk">Скачать APK</a>
  <div class="lbl"><span class="num">2</span>Подключитесь</div>
  <a class="b primary" data-conn href="#">Подключить автоматически</a>
  <button class="b ghost" data-copy>Скопировать ссылку</button>
  <div class="ok" data-ok></div>
  <div class="hint">Кнопка откроет Happ с готовым сервером. Не сработала — скопируйте ссылку.</div>
</div>

<div class="panel" data-panel="desktop">
  <div class="lbl"><span class="num">1</span>Установите приложение Happ</div>
  <a class="b dl" href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe">Windows</a>
  <a class="b dl" href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg">macOS</a>
  <a class="b dl" href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.linux.x64.deb">Linux</a>
  <div class="lbl"><span class="num">2</span>Подключитесь</div>
  <a class="b primary" data-conn href="#">Подключить автоматически</a>
  <button class="b ghost" data-copy>Скопировать ссылку</button>
  <div class="ok" data-ok></div>
</div>

<div class="foot"><div class="lk">${sub.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></div>
</div>
<script>
(function(){
  var SUB=${subJs}, DL=${dlJs};
  function showOk(panel){var o=panel.querySelector('[data-ok]');if(o){o.textContent='Скопировано — откройте Happ';o.classList.add('show');}}
  function copy(panel){
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(SUB).then(function(){showOk(panel);},function(){window.prompt('Скопируйте ссылку:',SUB);});
    } else {window.prompt('Скопируйте ссылку:',SUB);}
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-conn]'),function(a){a.setAttribute('href',DL);});
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'),function(b){
    b.addEventListener('click',function(){copy(b.closest('.panel'));});
  });
  function sel(os){
    Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(t){t.classList.toggle('on',t.getAttribute('data-os')===os);});
    Array.prototype.forEach.call(document.querySelectorAll('.panel'),function(p){p.classList.toggle('on',p.getAttribute('data-panel')===os);});
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'),function(t){
    t.addEventListener('click',function(){sel(t.getAttribute('data-os'));});
  });
  var ua=navigator.userAgent||'';
  sel(/iphone|ipad|ipod/i.test(ua)?'ios':(/android/i.test(ua)?'android':'desktop'));
})();
</script></body></html>`);
}
xuiPublicRouter.get("/happ", happRedirectHandler);

/**
 * GET /xui-public/nonsub-link/:email
 * Permanent VLESS link — TCP+REALITY, tradingview SNI, no Cloudflare, no subscription.
 */
xuiPublicRouter.get("/nonsub-link/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const lookup = await findSubscriptionClient(email);
    if (!lookup) return res.status(404).json({ ok: false, error: "Client not found" });

    const remark = `IkambaVPN-${email.split("@")[0]}`;
    const link = buildNonsubTcpLink(lookup.client.id, remark);
    return res.json({
      ok: true,
      link,
      permanent: true,
      noSubscription: true,
      note: "Import this vless:// URI only. Do not use a subscription URL.",
    });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui-public/brazil-xhttp-link/:email
 * Permanent direct link — Brazil IP exit via XHTTP+REALITY (test30 shape). No subscription.
 */
xuiPublicRouter.get("/brazil-xhttp-link/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const lookup = await findSubscriptionClient(email);
    if (!lookup) return res.status(404).json({ ok: false, error: "Client not found" });

    const remark = `IkambaVPN-${email.split("@")[0]}`;
    const link = buildBrazilDpiXhttpLink(lookup.client.id, remark);
    return res.json({
      ok: true,
      link,
      exitIp: BRAZIL_CLEAN_IP,
      note: "Import vless:// directly. Exit shows Brazil; SNI uses cloudflare for DPI camouflage.",
      permanent: true,
    });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

xuiPublicRouter.get("/tcp-link/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const lookup = await findSubscriptionClient(email);
    if (!lookup) return res.status(404).json({ ok: false, error: "Client not found" });

    const remark = `IkambaVPN-${email.split("@")[0]}`;
    const links = buildTcpRealityLinks(lookup.client.id, remark);
    if (!links.length) {
      return res.status(503).json({ ok: false, error: "TCP REALITY not configured" });
    }

    return res.json({
      ok: true,
      links,
      primary: links[0],
      subscriptionHint: `Add ?tcp_only=1 to your subscription URL for TCP-only profiles`,
    });
  } catch (err: any) {
    return res.status(503).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui-public/user-status/:email
 * Unified status for the dashboard — x-ui is source of truth, Firebase is fallback.
 * Returns expiry, days remaining, traffic, device limit, and subscription URL.
 * No auth required (email is the key; subscription URL is per-email already).
 */
xuiPublicRouter.get("/user-status/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const subUrl = `${process.env.PUBLIC_SUB_BASE ?? "https://ikambavpn.duckdns.org:4443"}/xui-public/sub/${encodeURIComponent(email)}`;

    // --- Primary: x-ui panel ---
    const stat = await getClientStatByEmail(email).catch(() => null);
    if (stat) {
      const now = Date.now();
      const expiryMs = stat.expiryTime ?? 0;
      const daysRemaining = expiryMs > 0 ? Math.max(0, Math.ceil((expiryMs - now) / 86400000)) : null;
      return res.json({
        ok: true, source: "panel",
        email,
        isActive: stat.enable !== false,
        expiryMs,
        expiryDate: expiryMs > 0 ? new Date(expiryMs).toISOString() : null,
        daysRemaining,
        uploadBytes: stat.up,
        downloadBytes: stat.down,
        totalBytes: stat.up + stat.down,
        limitBytes: stat.total,
        subscriptionUrl: subUrl,
      });
    }

    // --- Fallback: Firebase vpn_orders ---
    try {
      const db = getFirestore();
      const snap = await db.collection("vpn_orders")
        .where("userEmail", "==", email)
        .where("status", "==", "active")
        .get();
      if (!snap.empty) {
        const order = snap.docs
          .map(d => d.data())
          .sort((a, b) => new Date(b.activatedAt ?? 0).getTime() - new Date(a.activatedAt ?? 0).getTime())[0];
        const expiryMs = order.expiresAt ? new Date(order.expiresAt).getTime() : 0;
        const now = Date.now();
        const daysRemaining = expiryMs > 0 ? Math.max(0, Math.ceil((expiryMs - now) / 86400000)) : null;
        return res.json({
          ok: true, source: "firebase",
          email,
          isActive: true,
          expiryMs,
          expiryDate: order.expiresAt ?? null,
          daysRemaining,
          uploadBytes: 0, downloadBytes: 0, totalBytes: 0, limitBytes: 0,
          planName: order.planName,
          subscriptionUrl: subUrl,
        });
      }
    } catch { /* Firebase fallback failed — return minimal response */ }

    // Not found anywhere — new user, return minimal so dashboard still shows link
    return res.json({
      ok: true, source: "none",
      email,
      isActive: true,
      expiryMs: 0, expiryDate: null, daysRemaining: null,
      uploadBytes: 0, downloadBytes: 0, totalBytes: 0, limitBytes: 0,
      subscriptionUrl: subUrl,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

xuiPublicRouter.get("/sub/:email", publicSubscriptionHandler);

xuiPublicRouter.get("/subscription/:email", publicSubscriptionRedirectHandler);

// ── User-facing endpoints ─────────────────────────────────────────────────────

/**
 * POST /xui/provision
 * Provision a new VLESS+REALITY account for the authenticated user.
 *
 * Body: {
 *   email?: string,          // identifier (defaults to user email)
 *   trafficLimitGB?: number, // traffic cap in GB (0 = unlimited)
 *   expiryDays?: number,     // days until expiry (0 = never)
 *   maxConnections?: number  // concurrent device limit (default 3)
 * }
 */
xuiRouter.post("/provision", async (req: AuthedRequest, res: Response) => {
  const userEmail =
    req.body.email || (req.user as any)?.email || "unknown";
  try {
    const result = await provisionUser(userEmail, {
      trafficLimitGB: req.body.trafficLimitGB,
      expiryDays: req.body.expiryDays,
      maxConnections: req.body.maxConnections,
    });
    return res.json({ ok: true, data: result });
  } catch (err: any) {
    console.error("XUI provision error:", err.message);
    // Panel registration failed — return the shared subscription URL anyway
    // so the user can still connect (shared UUID model, no per-user UUID needed).
    const remark = `IkambaVPN-${userEmail.split("@")[0]}`;
    const { buildAllServerLinks } = await import("../services/xui");
    const links = buildAllServerLinks("free", remark);
    return res.json({
      ok: true,
      panelError: err.message,
      data: {
        clientId: "free",
        subId: "",
        email: userEmail,
        vlessLink: links[0] ?? "",
        subscriptionUrl: `${process.env.PUBLIC_SUB_BASE ?? ""}/xui-public/sub/${encodeURIComponent(userEmail)}`,
      },
    });
  }
});

/**
 * GET /xui/links/:email
 * Get all connection links for a client by email.
 */
xuiRouter.get("/links/:email", async (req: AuthedRequest, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    // Look up client in inbound to get clientId and subId
    const inbounds = await listInbounds();
    let clientId = "";
    let subId = "";
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      const client = (settings.clients || []).find((c: any) => c.email === email);
      if (client) {
        clientId = client.id;
        subId = client.subId || "";
        break;
      }
    }
    if (!clientId) {
      return res.status(404).json({ ok: false, error: "Client not found" });
    }
    const links = getAllClientLinks(clientId, subId, email);
    return res.json({ ok: true, data: links });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/subscription/:subId
 * Legacy redirect (kept for backwards compatibility).
 */
xuiRouter.get("/subscription/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  const base = process.env.PUBLIC_SUB_BASE || `${req.protocol}://${req.get("host")}`;
  return res.redirect(307, `${base}/xui-public/sub/${encodeURIComponent(subId)}`);
});

/**
 * GET /xui/deeplink/:subId
 * Legacy redirect — now redirects to V2RayTun import with subscription URL.
 */
xuiRouter.get("/deeplink/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  const base = process.env.PUBLIC_SUB_BASE || `${req.protocol}://${req.get("host")}`;
  const subUrl = `${base}/xui-public/sub/${encodeURIComponent(subId)}`;
  return res.redirect(getV2RayTunDeepLink(subUrl));
});

/**
 * GET /xui/stats/:email
 * Get traffic stats for a specific client.
 */
xuiRouter.get("/stats/:email", async (req: AuthedRequest, res: Response) => {
  try {
    const stat = await getClientStatByEmail(req.params.email);
    if (!stat) {
      return res.status(404).json({ ok: false, error: "Client not found" });
    }
    return res.json({
      ok: true,
      data: {
        email: stat.email,
        upload: stat.up,
        download: stat.down,
        total: stat.up + stat.down,
        limit: stat.total,
        enabled: stat.enable,
        expiryTime: stat.expiryTime,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

/**
 * GET /xui/admin/overview
 * Live stats for the admin header: active count, online now, expiring soon.
 */
xuiRouter.get("/admin/overview", async (req: AuthedRequest, res: Response) => {
  try {
    const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) return res.status(403).json({ ok: false, error: "Admin only" });

    const inbounds = await listInbounds();
    const now = Date.now();
    const sevenDays = 7 * 86400000;

    let totalClients = 0, activeClients = 0, expiringSoon = 0, lifetimeClients = 0;
    const seen = new Set<string>();

    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      for (const c of settings.clients || []) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        // Skip system/test accounts
        if ((c.email || "").includes("codex") || (c.email || "").includes("test30")) continue;
        totalClients++;
        const exp = c.expiryTime ?? 0;
        const enabled = c.enable !== false;
        if (!enabled) continue;
        if (exp === 0) { activeClients++; lifetimeClients++; continue; }
        if (exp > now) {
          activeClients++;
          if (exp - now < sevenDays) expiringSoon++;
        }
      }
    }

    const onlineList = await getAllOnlineClients().catch(() => []);
    const onlineNow = onlineList.filter(e =>
      !e.email.includes("codex") && !e.email.includes("test30")
    ).length;

    return res.json({ ok: true, data: { totalClients, activeClients, onlineNow, expiringSoon, lifetimeClients } });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/admin/clients
 * List all clients with stats, UUIDs, and subscription URLs (admin only).
 */
xuiRouter.get("/admin/clients", async (req: AuthedRequest, res: Response) => {
  try {
    const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

    // listInbounds() returns both clientStats AND settings.clients
    // (getInbound/getClientStats only returns the single-inbound API which
    //  may omit clientStats — so we use listInbounds for everything)
    const inbounds = await listInbounds();

    // Collect stats from all inbounds
    const stats: any[] = [];
    for (const inb of inbounds) {
      for (const s of inb.clientStats || []) {
        stats.push({ ...s, inboundId: inb.id });
      }
    }

    // Collect client configs (UUIDs, subIds, enable, expiry) from inbound settings
    const clientMap = new Map<string, {
      uuid: string; subId: string; limitIp: number;
      enable: boolean; expiryTime: number; totalGB: number;
      inboundId: number;
    }>();
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      for (const c of settings.clients || []) {
        clientMap.set(c.email, {
          uuid: c.id,
          subId: c.subId || "",
          limitIp: c.limitIp || 0,
          enable: c.enable !== false,
          expiryTime: c.expiryTime || 0,
          totalGB: c.totalGB || 0,
          inboundId: inb.id,
        });
      }
    }

    // Build a set of emails that have stats
    const statsEmails = new Set(stats.map((s: any) => s.email));

    // Enrich stats entries with config data
    const enriched = stats.map((s: any) => {
      const cfg = clientMap.get(s.email);
      const links = cfg ? getAllClientLinks(cfg.uuid, cfg.subId, s.email) : null;
      return {
        ...s,
        uuid: cfg?.uuid || "",
        subId: cfg?.subId || "",
        limitIp: cfg?.limitIp || 0,
        subscriptionUrl: links?.subscriptionUrl || "",
        vlessLink: links?.vlessLink || "",
      };
    });

    // Add clients from inbound settings that have NO stats entry yet
    // (e.g. trial users or newly provisioned clients who haven't connected)
    for (const [email, cfg] of clientMap) {
      if (!statsEmails.has(email)) {
        const links = getAllClientLinks(cfg.uuid, cfg.subId, email);
        enriched.push({
          id: 0,
          inboundId: cfg.inboundId,
          enable: cfg.enable,
          email,
          up: 0,
          down: 0,
          total: cfg.totalGB,
          expiryTime: cfg.expiryTime,
          reset: 0,
          uuid: cfg.uuid,
          subId: cfg.subId,
          limitIp: cfg.limitIp,
          subscriptionUrl: links?.subscriptionUrl || "",
          vlessLink: links?.vlessLink || "",
        });
      }
    }

    return res.json({ ok: true, data: enriched });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /xui/admin/add
 * Add a client manually (admin only).
 *
 * Body: {
 *   email: string,
 *   trafficLimitGB?: number,
 *   expiryDays?: number,
 *   maxConnections?: number
 * }
 */
xuiRouter.post("/admin/add", async (req: AuthedRequest, res: Response) => {
  try {
    const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

    const { email, trafficLimitGB, expiryDays, maxConnections } = req.body;
    if (!email) {
      return res.status(400).json({ ok: false, error: "email is required" });
    }

    const result = await provisionUser(email, {
      trafficLimitGB,
      expiryDays,
      maxConnections,
    });

    return res.json({ ok: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /xui/admin/disable/:clientId
 * Disable a client (admin only).
 */
xuiRouter.post(
  "/admin/disable/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      await setClientEnabled(req.params.clientId, false);
      // Flush sub cache so VPN clients see the change
      if (req.body?.email) clearSubCache(req.body.email);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * POST /xui/admin/enable/:clientId
 * Enable a client (admin only).
 */
xuiRouter.post(
  "/admin/enable/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      await setClientEnabled(req.params.clientId, true);
      // Flush sub cache so VPN clients see the change
      if (req.body?.email) clearSubCache(req.body.email);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * DELETE /xui/admin/delete/:clientId
 * Delete a client (admin only).
 */
xuiRouter.delete(
  "/admin/delete/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      await deleteClient(req.params.clientId);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * POST /xui/admin/reset-traffic/:email
 * Reset traffic counter for a client (admin only).
 */
xuiRouter.post(
  "/admin/reset-traffic/:email",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      await resetClientTraffic(req.params.email);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * POST /xui/admin/update/:clientId
 * Update a client's expiry, traffic limit, or connection limit (admin only).
 *
 * Body: {
 *   expiryTime?: number,     // epoch ms (0 = never)
 *   totalGB?: number,        // bytes (0 = unlimited)
 *   limitIp?: number,        // max concurrent connections (0 = unlimited)
 *   enable?: boolean         // enable/disable
 *   email?: string           // client email (used to flush sub cache)
 * }
 *
 * This also clears the subscription cache so that V2RayTun/V2RayNG
 * pick up the updated settings on their next poll (within ~5 minutes).
 */
xuiRouter.post(
  "/admin/update/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      const { clientId } = req.params;
      const { expiryTime, totalGB, limitIp, enable, email } = req.body;

      const updates: Record<string, any> = {};
      if (expiryTime !== undefined) updates.expiryTime = expiryTime;
      if (totalGB !== undefined) updates.totalGB = totalGB;
      if (limitIp !== undefined) updates.limitIp = limitIp;
      if (enable !== undefined) updates.enable = enable;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ ok: false, error: "No updates provided" });
      }

      // Update on the primary (TCP) inbound
      await updateClient(clientId, updates);

      // Also update on the XHTTP inbound (inbound 2) — non-fatal
      try {
        await updateClient(clientId, updates, 2);
      } catch { /* XHTTP inbound may not exist */ }

      // Flush subscription cache so V2RayTun/V2RayNG see updated expiry immediately
      if (email) {
        clearSubCache(email);
        clearSubCache(email.replace("@", ".x@"));
      }

      // Sync expiry to Firebase vpn_orders so dashboard shows correct days remaining
      if (email && expiryTime !== undefined) {
        try {
          const db = getFirestore();
          const snap = await db.collection("vpn_orders")
            .where("userEmail", "==", email)
            .where("status", "==", "active")
            .get();
          const newExpiry = expiryTime > 0 ? new Date(expiryTime).toISOString() : null;
          const updatePayload: Record<string, any> = { updatedAt: new Date().toISOString() };
          if (newExpiry) updatePayload.expiresAt = newExpiry;
          if (enable !== undefined) updatePayload.status = enable ? "active" : "disabled";
          if (!snap.empty) {
            await snap.docs[0].ref.update(updatePayload);
          }
        } catch { /* Firebase sync is non-fatal */ }
      }

      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/inbounds
 * List all inbounds (admin only).
 */
xuiRouter.get(
  "/admin/inbounds",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      const inbounds = await listInbounds();
      return res.json({ ok: true, data: inbounds });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/status
 * Get server system status (admin only).
 */
xuiRouter.get(
  "/admin/status",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

      const status = await getSystemStatus();
      return res.json({ ok: true, data: status });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── Admin Monitoring Endpoints ────────────────────────────────────────────────

/**
 * GET /xui/admin/onlines
 * Get list of currently online (connected) client emails.
 */
xuiRouter.get(
  "/admin/onlines",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const onlines = await getAllOnlineClients();
      return res.json({ ok: true, data: onlines });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/activity
 * Full user activity summary — online status, last seen, top domains, IPs, etc.
 * This is the main endpoint for the monitoring dashboard.
 */
xuiRouter.get(
  "/admin/activity",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const summaries = await getUserActivitySummaries();
      return res.json({ ok: true, data: summaries });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/connections/:email
 * Get recent connection log entries for a specific user.
 * Returns the last 200 connections with destinations, timestamps, IPs.
 */
xuiRouter.get(
  "/admin/connections/:email",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const email = decodeURIComponent(req.params.email);
      const allConnections = await getRecentConnections(3000);
      const userConnections = allConnections
        .filter((c) => c.email === email)
        .filter((c) => !isNoiseDest(c.destination, c.destinationPort))
        .slice(-200); // last 200 meaningful connections

      return res.json({ ok: true, data: userConnections });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/history?days=7&date=2026-04-14
 * Historical activity data from Firestore.
 * - days: number of days of aggregate data (default 7, max 30)
 * - date: specific date to get per-user detail for (default today)
 *
 * Reads: ~7-30 aggregate docs + ~25 user docs = ~55 reads per call
 */
xuiRouter.get(
  "/admin/history",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin = await checkIsAdmin(req.user);
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const days = Math.min(Number(req.query.days) || 7, 30);
      const date = (req.query.date as string) || undefined;

      const history = await getHistory(days, date);
      return res.json({ ok: true, data: history });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// ── YooKassa Payment Routes ───────────────────────────────────────────────────

/**
 * POST /xui/payment/create
 * Create a YooKassa payment for the authenticated user.
 * Returns a confirmation_url the frontend redirects to.
 *
 * Body: {
 *   orderId: string,     // Firestore order ID (already created by frontend)
 *   planId: string,      // plan identifier
 *   planName: string,     // plan display name
 *   amount: number,       // price in RUB
 *   currency?: string     // default "RUB"
 * }
 */
xuiRouter.post("/payment/create", async (req: AuthedRequest, res: Response) => {
  try {
    if (!isYooKassaConfigured()) {
      return res.status(503).json({ ok: false, error: "Online payments are not available yet" });
    }

    const user = req.user as any;
    const { orderId, planId, planName, amount, currency } = req.body;

    if (!orderId || !amount) {
      return res.status(400).json({ ok: false, error: "orderId and amount are required" });
    }

    // Verify the order exists and belongs to this user
    const db = getFirestore();
    const orderDoc = await db.collection("vpn_orders").doc(orderId).get();
    if (!orderDoc.exists) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }
    const orderData = orderDoc.data()!;
    if (orderData.userId !== user.uid) {
      return res.status(403).json({ ok: false, error: "Order does not belong to you" });
    }
    if (orderData.status !== "pending_payment") {
      return res.status(400).json({ ok: false, error: `Order already has status: ${orderData.status}` });
    }

    // Create payment on YooKassa
    const payment = await createPayment({
      amount: amount,
      currency: currency || "RUB",
      description: `IkambaVPN — ${planName || "VPN subscription"}`,
      orderId: orderId,
      planId: planId,
      userEmail: user.email || orderData.userEmail,
    });

    // Save YooKassa payment ID on the order for later lookup
    await db.collection("vpn_orders").doc(orderId).update({
      yookassaPaymentId: payment.id,
      yookassaStatus: payment.status,
      updatedAt: new Date().toISOString(),
    });

    return res.json({
      ok: true,
      data: {
        paymentId: payment.id,
        confirmationUrl: payment.confirmation?.confirmation_url,
        status: payment.status,
      },
    });
  } catch (err: any) {
    console.error("[yookassa] Payment creation error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/payment/status/:orderId
 * Check payment status for an order (authenticated).
 * Used when user returns from YooKassa to verify payment went through.
 */
xuiRouter.get("/payment/status/:orderId", async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user as any;
    const db = getFirestore();
    const orderDoc = await db.collection("vpn_orders").doc(req.params.orderId).get();

    if (!orderDoc.exists) {
      return res.status(404).json({ ok: false, error: "Order not found" });
    }

    const order = orderDoc.data()!;
    if (order.userId !== user.uid) {
      return res.status(403).json({ ok: false, error: "Not your order" });
    }

    // If we have a YooKassa payment ID, re-check status from YooKassa
    if (order.yookassaPaymentId && order.status === "pending_payment") {
      try {
        const ykPayment = await getPayment(order.yookassaPaymentId);
        if (ykPayment.status === "succeeded" && !order.yookassaActivated) {
          // Payment succeeded but webhook hasn't processed yet — process now
          await activateOrderAfterPayment(db, req.params.orderId, order);
          return res.json({
            ok: true,
            data: { status: "active", yookassaStatus: "succeeded" },
          });
        }
        return res.json({
          ok: true,
          data: { status: order.status, yookassaStatus: ykPayment.status },
        });
      } catch {
        // YooKassa API error — return what we have
      }
    }

    return res.json({
      ok: true,
      data: { status: order.status, yookassaStatus: order.yookassaStatus || null },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /xui-public/yookassa-webhook
 * YooKassa sends payment notifications here (no auth — public endpoint).
 * We verify by re-fetching payment from YooKassa API.
 *
 * Event types:
 *  - payment.succeeded — auto-activate VPN
 *  - payment.canceled — mark order as cancelled
 */
xuiPublicRouter.post("/yookassa-webhook", async (req: Request, res: Response) => {
  try {
    const event = req.body;
    console.log(`[yookassa-webhook] Received event: ${event?.event}`, JSON.stringify(event?.object?.id));

    if (!event?.object?.id) {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const paymentId = event.object.id;
    const eventType = event.event;

    // Always verify with YooKassa API — never trust the webhook body alone
    const payment = await verifyWebhookPayment(paymentId);
    console.log(`[yookassa-webhook] Verified payment ${paymentId}: status=${payment.status}`);

    const orderId = payment.metadata?.order_id;
    if (!orderId) {
      console.warn(`[yookassa-webhook] Payment ${paymentId} has no order_id in metadata`);
      return res.json({ ok: true }); // ACK to YooKassa anyway
    }

    const db = getFirestore();
    const orderRef = db.collection("vpn_orders").doc(orderId);
    const orderDoc = await orderRef.get();

    if (!orderDoc.exists) {
      console.warn(`[yookassa-webhook] Order ${orderId} not found in Firestore`);
      return res.json({ ok: true });
    }

    const order = orderDoc.data()!;

    if (eventType === "payment.succeeded" && payment.status === "succeeded") {
      if (order.status === "active") {
        console.log(`[yookassa-webhook] Order ${orderId} already active — skipping`);
        return res.json({ ok: true });
      }

      await activateOrderAfterPayment(db, orderId, order);
      console.log(`[yookassa-webhook] ✅ Order ${orderId} activated successfully`);
    } else if (eventType === "payment.canceled" || payment.status === "canceled") {
      await orderRef.update({
        status: "cancelled",
        yookassaStatus: "canceled",
        updatedAt: new Date().toISOString(),
      });
      console.log(`[yookassa-webhook] ❌ Order ${orderId} cancelled`);
    } else {
      // Update status for other events
      await orderRef.update({
        yookassaStatus: payment.status,
        updatedAt: new Date().toISOString(),
      });
    }

    // Always return 200 — YooKassa retries on non-2xx
    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[yookassa-webhook] Error:", err.message);
    // Still return 200 to prevent infinite retries
    return res.status(200).json({ ok: true, error: err.message });
  }
});

/**
 * Auto-activate a VPN subscription after successful payment.
 * Provisions the 3X-UI account and updates the Firestore order.
 */
async function activateOrderAfterPayment(
  db: FirebaseFirestore.Firestore,
  orderId: string,
  order: FirebaseFirestore.DocumentData
): Promise<void> {
  const email = order.userEmail;
  if (!email) throw new Error("Order has no userEmail");

  // Determine max connections from plan
  // Basic = 1 device, Popular = 3, Premium = 5 (fallback: 3)
  let maxConnections = 3;
  const planName = (order.planName || "").toLowerCase();
  if (planName.includes("basic")) maxConnections = 1;
  else if (planName.includes("premium")) maxConnections = 5;

  // Provision VLESS+REALITY account on 3X-UI
  const result = await provisionUser(email, {
    trafficLimitGB: 0, // Unlimited traffic for paid plans
    expiryDays: 30,     // 1 month
    maxConnections,
  });

  // Update order in Firestore
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

  await db.collection("vpn_orders").doc(orderId).update({
    status: "active",
    yookassaStatus: "succeeded",
    yookassaActivated: true,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    credentials: {
      xuiClientId: result.clientId,
      xuiSubId: result.subId,
      xuiSubscriptionUrl: result.subscriptionUrl,
      xuiV2raytunLink: result.v2raytunLink,
      xuiV2rayngLink: result.v2rayngLink,
      xuiHiddifyLink: result.hiddifyLink,
    },
    updatedAt: now.toISOString(),
  });

  console.log(`[yookassa] Auto-provisioned VPN for ${email}: clientId=${result.clientId}`);
}
