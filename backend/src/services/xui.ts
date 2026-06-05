/**
 * 3X-UI Panel API Service
 *
 * Communicates with the 3X-UI admin panel REST API to manage
 * VLESS+REALITY inbounds and clients (users).
 *
 * This runs server-side only — panel credentials never reach the browser.
 *
 * Docs: https://github.com/MHSanaei/3x-ui (see API section in wiki)
 */

import { randomUUID } from "crypto";
import https from "https";

// ── Configuration ─────────────────────────────────────────────────────────────

const PANEL_URL = process.env.XPANEL_URL || "https://194.76.217.4:2053";
const PANEL_USER = process.env.XPANEL_USER || "ikamba";
const PANEL_PASS = process.env.XPANEL_PASS || "";

// Default inbound ID for the VLESS+REALITY inbound (set after creating it in the panel)
const DEFAULT_INBOUND_ID = Number(process.env.XPANEL_INBOUND_ID || "1");

// Subscription base URL (with HTTPS when domain is set up)
const SUB_BASE = process.env.XPANEL_SUB_URL || "https://194.76.217.4:2096/sub";

// VLESS+REALITY direct link parameters (bypass broken 3X-UI subscription endpoint)
const VPS_IP = process.env.XPANEL_VPS_IP || "194.76.217.4";
const REALITY_PUBLIC_KEY = process.env.XPANEL_REALITY_PUBLIC_KEY || "";
const REALITY_SHORT_ID = process.env.XPANEL_REALITY_SHORT_ID || "";
const REALITY_SNI = process.env.XPANEL_REALITY_SNI || "www.microsoft.com";
const REALITY_FINGERPRINT = "chrome";
const VLESS_PORT = Number(process.env.XPANEL_VLESS_PORT || "443");

// WebSocket (anti-DPI primary) inbound — multiplexes all traffic over one TCP connection
// This prevents ISP connection-count-based blocking (YouTube creates 50+ connections)
const WS_PORT = 2083;
const WS_PATH = "/ws-tunnel";
const WS_HOST = "dl.google.com"; // camouflage Host header
const WS_INBOUND_ID = Number(process.env.XPANEL_WS_INBOUND_ID || "3");

// XHTTP+REALITY (anti-DPI fallback) inbound
const XHTTP_PORT = 8443;
const XHTTP_PATH = "/ikamba";
const XHTTP_INBOUND_ID = 2;
const XHTTP_PUBLIC_KEY = process.env.XHTTP_REALITY_PUBLIC_KEY || "";
const XHTTP_SHORT_ID = process.env.XHTTP_REALITY_SHORT_ID || "";
const XHTTP_SNI = process.env.XHTTP_REALITY_SNI || REALITY_SNI;

// Extra production profiles included in the normal user subscription.
// Values are public VLESS/REALITY client metadata, not private server keys.
const HOSTKEY_ES_IP = process.env.HOSTKEY_ES_IP || "152.114.194.169";
const HOSTKEY_ES_PUBLIC_KEY =
  process.env.HOSTKEY_ES_PUBLIC_KEY || "KGzL6YisolF-AzJ-qIIm9HqxnQi7NnC-WfKfumaOYG4";
const HOSTKEY_ES_SHORT_ID_443 = process.env.HOSTKEY_ES_SHORT_ID_443 || "6654a290102fe531";
const HOSTKEY_ES_SHORT_ID_43234 = process.env.HOSTKEY_ES_SHORT_ID_43234 || "d24c784291c548ee";
const HOSTKEY_ES_SHORT_ID_8443 = process.env.HOSTKEY_ES_SHORT_ID_8443 || "e4924abc2dbcd900";
const HOSTKEY_ES_XHTTP_PATH = process.env.HOSTKEY_ES_XHTTP_PATH || "/assets/es-speed/events";

// es-grpc-9443 inbound on HOSTKEY Spain — VLESS + gRPC + REALITY, SNI www.apple.com.
// PROVEN WORKING: carries live Russian-user web traffic (WiFi + mobile). gRPC
// (HTTP/2) survives the DPI that freezes TCP+Vision REALITY on this user's
// network. Shared free UUID is already provisioned in this inbound on the server.
const HOSTKEY_ES_GRPC_PORT = Number(process.env.HOSTKEY_ES_GRPC_PORT || "9443");
const HOSTKEY_ES_GRPC_SHORT_ID =
  process.env.HOSTKEY_ES_GRPC_SHORT_ID || "c0cf136b037aaab1";
const HOSTKEY_ES_GRPC_SNI =
  process.env.HOSTKEY_ES_GRPC_SNI || "www.apple.com";
const HOSTKEY_ES_GRPC_SERVICE =
  process.env.HOSTKEY_ES_GRPC_SERVICE || "ikambasvc266940179";
// Shared free UUID provisioned in the ES gRPC inbound on the server. Same UUID
// for every client on this inbound (free tier — no per-user accounting).
const ES_GRPC_SHARED_UUID =
  process.env.ES_GRPC_SHARED_UUID || "86dc53bb-8e7c-4086-a32e-984d706b9fad";

const FRANKFURT_TURBO_PORT = Number(process.env.FRANKFURT_TURBO_PORT || "43234");
const FRANKFURT_TURBO_PUBLIC_KEY =
  process.env.FRANKFURT_TURBO_PUBLIC_KEY ||
  process.env.XHTTP_REALITY_PUBLIC_KEY ||
  "i2ryLXz5H51kVANIqKIFI30_rAx6iuEveXwPqY_GyRY";
const FRANKFURT_TURBO_SHORT_ID = process.env.FRANKFURT_TURBO_SHORT_ID || "0123456789";
const FRANKFURT_TURBO_SNI = process.env.FRANKFURT_TURBO_SNI || "www.yahoo.com";

// Brazil clean IP — test30 Russia-DPI XHTTP+REALITY (exit IP geolocates as BR).
export const BRAZIL_CLEAN_IP = process.env.BRAZIL_CLEAN_IP || "187.77.71.106";
const BRAZIL_XHTTP_PORT = Number(process.env.BRAZIL_XHTTP_PORT || "8443");
const BRAZIL_XHTTP_PATH =
  process.env.BRAZIL_XHTTP_PATH || "/assets/fceebc8ad5ca/events";
const BRAZIL_XHTTP_PUBLIC_KEY =
  process.env.BRAZIL_XHTTP_PUBLIC_KEY || FRANKFURT_TURBO_PUBLIC_KEY;
const BRAZIL_XHTTP_SHORT_ID =
  process.env.BRAZIL_XHTTP_SHORT_ID || "509db650956762e8";
const BRAZIL_XHTTP_SNI = process.env.BRAZIL_XHTTP_SNI || "tradingview.com";

// Hetzner — test30-style XHTTP+REALITY (installed via install-hetzner-dpi-xhttp.py)
const HETZNER_XHTTP_PORT = Number(process.env.HETZNER_XHTTP_PORT || "8443");
const HETZNER_XHTTP_PATH =
  process.env.HETZNER_XHTTP_PATH || "/assets/fceebc8ad5ca/events";
const HETZNER_XHTTP_PUBLIC_KEY =
  process.env.HETZNER_XHTTP_PUBLIC_KEY || REALITY_PUBLIC_KEY;
const HETZNER_XHTTP_SHORT_ID =
  process.env.HETZNER_XHTTP_SHORT_ID || REALITY_SHORT_ID || "d24c784291c548ee";
const HETZNER_XHTTP_SNI = process.env.HETZNER_XHTTP_SNI || "tradingview.com";

// NONSUB — permanent direct links only (no subscription URL). TCP+REALITY, no Cloudflare SNI.
export const NONSUB_PORT = Number(process.env.NONSUB_PORT || "43234");
const NONSUB_SNI = process.env.NONSUB_SNI || "tradingview.com";
const NONSUB_PUBLIC_KEY = process.env.NONSUB_REALITY_PUBLIC_KEY || REALITY_PUBLIC_KEY;
const NONSUB_SHORT_ID = process.env.NONSUB_REALITY_SHORT_ID || REALITY_SHORT_ID || "d24c784291c548ee";

// Albania exit — real Albanian IP (Tirana VPS). whatismyip shows AL only when users
// connect to this host, not Finland/Spain. Set after 3X-UI is up on the Albania box.
const ALBANIA_VPS_IP = process.env.ALBANIA_VPS_IP || "";
const ALBANIA_VLESS_HOST = process.env.ALBANIA_VLESS_HOST || ALBANIA_VPS_IP;
const ALBANIA_REALITY_PUBLIC_KEY = process.env.ALBANIA_REALITY_PUBLIC_KEY || "";
const ALBANIA_REALITY_SHORT_ID = process.env.ALBANIA_REALITY_SHORT_ID || "";
const ALBANIA_VLESS_PORT = Number(process.env.ALBANIA_VLESS_PORT || "443");
const ALBANIA_REALITY_SNI = process.env.ALBANIA_REALITY_SNI || "www.yahoo.com";

// Social-optimized WebSocket inbound — port 2087, /yt-stream, host i.ytimg.com.
// Server-side routing rules blackhole geosite:category-ads-all + tracker domains
// for traffic with this inbound's tag (set up via 3X-UI panel routing config).
// Result: ad-light browsing + faster social media loading.
//
// Currently lives on the Stockholm box (138.124.24.164, inbound id 3) only —
// the Hetzner panel that the backend talks to does NOT have this inbound, so
// the addClient mirror in provisionUser will silently fail there. New clients
// must be mirrored to Stockholm via infrastructure/create-social-inbound.sh
// (idempotent — re-run periodically as a cron until proper cross-panel
// provisioning is built).
const SOCIAL_PORT = 2087;
const SOCIAL_PATH = "/yt-stream";
const SOCIAL_HOST = "i.ytimg.com";
const SOCIAL_SERVER_IP = process.env.XPANEL_SOCIAL_SERVER_IP || "138.124.24.164";
const SOCIAL_INBOUND_ID = Number(process.env.XPANEL_SOCIAL_INBOUND_ID || "3");

// ── Multi-Server Configuration ────────────────────────────────────────────────
// Each backend instance serves subscription links for ALL servers so users get
// Helsinki + Frankfurt (and future locations) in their VPN app.
//
// SECONDARY_SERVERS env var is a JSON array of server objects:
// [{"ip":"187.77.71.106","label":"Frankfurt","realityPubKey":"HVv7...","realityShortId":"bf08..."}]

export interface ServerConfig {
  ip: string;
  label: string;           // Location label (e.g. "Helsinki", "Frankfurt")
  realityPubKey: string;
  realityShortId: string;
  realitySni?: string;     // default: www.microsoft.com
  vlessPort?: number;      // default: 443
  wsPort?: number;         // default: 2083
  wsPath?: string;         // default: /ws-tunnel
  wsHost?: string;         // default: dl.google.com
  inboundId?: number;      // default: primary VLESS inbound id
  xhttpInboundId?: number;  // optional secondary XHTTP inbound id
  // Panel credentials for querying this server's 3X-UI API (online status, etc.)
  panelUrl?: string;       // e.g. "https://187.77.71.106:2053/ikamba-panel"
  panelUser?: string;
  panelPass?: string;
}

/** This server's config (built from env vars) */
const PRIMARY_SERVER: ServerConfig = {
  ip: VPS_IP,
  label: process.env.XPANEL_SERVER_LABEL || "Helsinki",
  realityPubKey: REALITY_PUBLIC_KEY,
  realityShortId: REALITY_SHORT_ID,
  realitySni: REALITY_SNI,
  vlessPort: VLESS_PORT,
  wsPort: WS_PORT,
  wsPath: WS_PATH,
  wsHost: WS_HOST,
};

function countryProfileLabel(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("stockholm") || normalized.includes("sweden")) return "🇸🇪 Sweden TCP Turbo";
  if (normalized.includes("helsinki") || normalized.includes("finland")) return "🇫🇮 Finland TCP Turbo";
  if (normalized.includes("frankfurt") || normalized.includes("germany")) return "🇩🇪 Germany TCP Turbo";
  if (normalized.includes("spain") || normalized === "es") return "🇪🇸 Spain TCP Turbo";
  return `${label} TCP Turbo`;
}

/** Parse secondary servers from env var */
function parseSecondaryServers(): ServerConfig[] {
  const raw = process.env.SECONDARY_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((s: any) => ({
      ip: s.ip,
      label: s.label || "Server",
      realityPubKey: s.realityPubKey || "",
      realityShortId: s.realityShortId || "",
      realitySni: s.realitySni || REALITY_SNI,
      vlessPort: s.vlessPort || VLESS_PORT,
      wsPort: s.wsPort || WS_PORT,
      wsPath: s.wsPath || WS_PATH,
      wsHost: s.wsHost || WS_HOST,
      inboundId: s.inboundId || s.vlessInboundId || DEFAULT_INBOUND_ID,
      xhttpInboundId: s.xhttpInboundId || undefined,
      panelUrl: s.panelUrl || "",
      panelUser: s.panelUser || "",
      panelPass: s.panelPass || "",
    }));
  } catch (err) {
    console.error("[multi-server] Failed to parse SECONDARY_SERVERS env var:", err);
    return [];
  }
}

const SECONDARY_SERVERS = parseSecondaryServers();

/** All servers: primary first, then secondaries */
export function getAllServers(): ServerConfig[] {
  return [PRIMARY_SERVER, ...SECONDARY_SERVERS];
}

// HTTPS agent that tolerates IP-based or short-lived certs
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

// Public-facing backend domain for subscription URLs.
const BACKEND_DOMAIN = process.env.XPANEL_BACKEND_DOMAIN || "ikambavpn.duckdns.org";
/** Host in vless:// URIs — Duck DNS (not Cloudflare). Falls back to VPS IP. */
const VLESS_CONNECT_HOST = process.env.XPANEL_VLESS_HOST || BACKEND_DOMAIN;

// For Node.js native fetch with HTTPS IP certs — set at module level
if (PANEL_URL.startsWith("https://")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface XuiSession {
  cookie: string;
  expiresAt: number;
}

export interface XuiClient {
  id: string;          // UUID
  email: string;       // remark / identifier
  enable: boolean;
  flow: string;        // empty for plain TCP REALITY
  totalGB: number;     // 0 = unlimited
  expiryTime: number;  // epoch ms, 0 = never
  subId: string;       // subscription token (auto-generated)
  limitIp: number;     // max concurrent IPs, 0 = unlimited
  tgId: string;        // Telegram user ID for notifications
  reset: number;       // traffic reset interval (days), 0 = never
}

export interface XuiInbound {
  id: number;
  remark: string;
  enable: boolean;
  protocol: string;
  port: number;
  up: number;
  down: number;
  total: number;
  clientStats: XuiClientStat[];
}

export interface XuiClientStat {
  id: number;
  inboundId: number;
  email: string;
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
}

export interface XuiCreateClientOptions {
  /** User-facing identifier (e.g. user_001 or email) */
  email: string;
  /** Traffic limit in bytes. 0 = unlimited. Use GB() helper. */
  totalGB?: number;
  /** Expiry as epoch ms. 0 = never. Use daysFromNow() helper. */
  expiryTime?: number;
  /** Max concurrent IPs. 0 = unlimited (recommended to prevent VPN disconnects). */
  limitIp?: number;
  /** Telegram user ID for notifications. Default empty. */
  tgId?: string;
  /** Force a specific UUID (used when mirroring a client to a second inbound). */
  id?: string;
  /** Force a specific subscription token when mirroring across servers. */
  subId?: string;
  /** VLESS flow. Default is empty for plain TCP REALITY. */
  flow?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert GB to bytes */
export function GB(gb: number): number {
  return gb * 1024 * 1024 * 1024;
}

/** Get epoch ms for N days from now */
export function daysFromNow(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

/** Generate a short subscription ID */
function genSubId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// ── In-memory subscription cache ──────────────────────────────────────────────
// Caches VLESS links so subscription requests survive brief 3X-UI panel outages.
// This is the #1 fix for "VPN auto goes off" — V2RayTun/V2RayNG poll the sub URL
// every few minutes. If it returns an error, they disconnect the user.

interface SubCacheEntry {
  vlessLink: string;
  userInfo: string;
  cachedAt: number;
}

const subCache = new Map<string, SubCacheEntry>();
const SUB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes — long enough to survive panel restarts

function clientMatchesEmail(client: any, email: string): boolean {
  const clientEmail = String(client?.email || "");
  return clientEmail === email || normalizeMirrorEmail(clientEmail) === email;
}

function userInfoFromClient(client: any): string {
  const upload = Number(client?.up || 0);
  const download = Number(client?.down || 0);
  const total = Number(client?.total || client?.totalGB || 0);
  const expiryTime = Number(client?.expiryTime || 0);
  const expireSec = expiryTime ? Math.floor(expiryTime / 1000) : 0;
  return `upload=${upload}; download=${download}; total=${total}; expire=${expireSec}`;
}

type SubscriptionClientLookup = {
  client: any;
  source: "local" | "remote";
};

export async function findSubscriptionClient(email: string): Promise<SubscriptionClientLookup | null> {
  const inbounds = await listInbounds();
  for (const inb of inbounds) {
    const settings = JSON.parse((inb as any).settings || "{}");
    const client = (settings.clients || []).find((c: any) => clientMatchesEmail(c, email));
    if (client?.id) return { client, source: "local" };
  }

  for (const server of SECONDARY_SERVERS) {
    const remoteInbounds = await listRemoteInbounds(server);
    for (const inb of remoteInbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      const client = (settings.clients || []).find((c: any) => clientMatchesEmail(c, email));
      if (client?.id) return { client, source: "remote" };
    }
  }

  return null;
}

/**
 * Get or refresh a cached subscription entry for an email.
 * Returns cached data if fresh, otherwise fetches from 3X-UI.
 * On fetch failure, returns stale cache if available (better than nothing).
 */
export async function getCachedSubscription(email: string): Promise<SubCacheEntry | null> {
  const cached = subCache.get(email);
  const isFresh = cached && (Date.now() - cached.cachedAt) < SUB_CACHE_TTL;

  if (isFresh) return cached;

  // Try to fetch fresh data from 3X-UI panel
  try {
    const lookup = await findSubscriptionClient(email);

    // Panel lookup is best-effort — buildAllServerLinks uses shared UUIDs so
    // clientId doesn't affect the output. Any authenticated user gets links.
    const clientId = lookup?.client?.id ?? "free";
    const remark = `IkambaVPN-${email.split("@")[0]}`;

    const allLinks = buildAllServerLinks(clientId, remark);
    const vlessLink = allLinks.join("\n");

    // Build user info
    let userInfo = "upload=0; download=0; total=0; expire=0";
    try {
      const stat = await getClientStatByEmail(email);
      if (stat) {
        const expireSec = stat.expiryTime ? Math.floor(stat.expiryTime / 1000) : 0;
        userInfo = `upload=${stat.up}; download=${stat.down}; total=${stat.total}; expire=${expireSec}`;
      } else if (lookup) {
        userInfo = userInfoFromClient(lookup.client);
      }
    } catch {
      if (lookup) userInfo = userInfoFromClient(lookup.client);
    }

    const entry: SubCacheEntry = { vlessLink, userInfo, cachedAt: Date.now() };
    subCache.set(email, entry);
    return entry;
  } catch (err) {
    // Panel is down — return stale cache if we have it (this prevents disconnections!)
    if (cached) {
      console.warn(`[sub-cache] Panel unreachable, serving stale cache for ${email}`);
      return cached;
    }
    throw err;
  }
}

/**
 * Clear subscription cache for a specific email.
 * Must be called after updating a client's expiry/traffic/enable status
 * so that V2RayTun/V2RayNG pick up the new settings on next poll.
 */
export function clearSubCache(email: string): void {
  subCache.delete(email);
}

function normalizeMirrorEmail(email: string): string {
  return email.replace(/-ws$/, "").replace(/-yt$/, "").replace(/\.x@/, "@");
}

/**
 * Subscription URLs used to be created with the 3X-UI subId token. Newer URLs
 * use email because that lets this backend attach app-facing expiry/traffic
 * metadata. Accept both so old links keep working.
 */
export async function resolveSubscriptionEmail(identifier: string): Promise<string> {
  const decoded = decodeURIComponent(identifier);
  if (decoded.includes("@")) return normalizeMirrorEmail(decoded);

  const inbounds = await listInbounds();
  for (const inb of inbounds) {
    const settings = JSON.parse((inb as any).settings || "{}");
    const client = (settings.clients || []).find((c: any) => c.subId === decoded);
    if (client?.email) return normalizeMirrorEmail(client.email);
  }

  return decoded;
}

// ── Session Management ────────────────────────────────────────────────────────

let session: XuiSession | null = null;

async function login(): Promise<string> {
  // Reuse session if still valid (with 5-min buffer)
  if (session && session.expiresAt > Date.now() + 300_000) {
    return session.cookie;
  }

  const res = await fetch(`${PANEL_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(PANEL_USER)}&password=${encodeURIComponent(PANEL_PASS)}`,
    redirect: "manual",
  });

  if (!res.ok && res.status !== 302) {
    throw new Error(`3X-UI login failed: ${res.status} ${res.statusText}`);
  }

  const cookies = res.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.startsWith("3x-ui=") || c.startsWith("session="));
  if (!sessionCookie) {
    // Some versions return success JSON with a Set-Cookie
    const body = await res.json().catch(() => ({})) as { success?: boolean };
    if (!body.success) throw new Error("3X-UI login failed: no session cookie");
  }

  const cookie = sessionCookie?.split(";")[0] ?? "";
  session = {
    cookie,
    expiresAt: Date.now() + 3600_000, // assume 1hr session
  };

  return cookie;
}

async function apiRequest<T = any>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const cookie = await login();

  const res = await fetch(`${PANEL_URL}${path}`, {
    ...options,
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`3X-UI API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { success: boolean; msg?: string; obj?: T };
  if (!data.success) {
    throw new Error(`3X-UI API error: ${data.msg || "unknown"}`);
  }

  return data.obj as T;
}

// ── Online Status & Activity Tracking ─────────────────────────────────────────

/**
 * Get list of currently online client emails.
 * Merges two sources:
 *  1. x-ui panel /onlines API — tracks connections to the x-ui Xray instance.
 *  2. Codex Xray access log — tracks connections via port 8444 XHTTP (the
 *     active subscription profile). "Online" = seen in the last 3 minutes.
 */
export async function getOnlineClients(): Promise<string[]> {
  const onlineSet = new Set<string>();

  // Source 1: x-ui panel
  try {
    const result = await apiRequest<string[]>("/panel/api/inbounds/onlines", {
      method: "POST",
    });
    (result || []).forEach((e) => onlineSet.add(e));
  } catch { /* panel may be unreachable */ }

  // Source 2: codex Xray access log (port 8444 XHTTP connections)
  try {
    const { execSync } = await import("child_process");
    const raw = execSync("tail -200 /var/log/xray-codex/access.log 2>/dev/null", {
      encoding: "utf-8", timeout: 3000,
    });
    const cutoff = Date.now() - 3 * 60 * 1000; // 3 minutes
    for (const line of raw.split("\n")) {
      if (!line.includes("email:")) continue;
      const tsMatch = line.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
      const emailMatch = line.match(/email:\s+(\S+)/);
      if (!tsMatch || !emailMatch) continue;
      const [, yr, mo, dy, hr, mn, sc] = tsMatch;
      const ts = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}Z`).getTime();
      if (ts >= cutoff) onlineSet.add(emailMatch[1].trim());
    }
  } catch { /* log may not exist yet */ }

  return [...onlineSet];
}

// ── Remote Panel Session Cache ────────────────────────────────────────────────
// Each secondary server has its own 3X-UI panel session cookie.

const remoteSessions = new Map<string, { cookie: string; expiresAt: number }>();

async function loginRemotePanel(server: ServerConfig): Promise<string> {
  if (!server.panelUrl || !server.panelUser || !server.panelPass) return "";

  const key = server.ip;
  const cached = remoteSessions.get(key);
  if (cached && cached.expiresAt > Date.now() + 300_000) return cached.cookie;

  try {
    const res = await fetch(`${server.panelUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${encodeURIComponent(server.panelUser)}&password=${encodeURIComponent(server.panelPass)}`,
      redirect: "manual",
    });

    if (!res.ok && res.status !== 302) return "";

    const cookies = res.headers.getSetCookie?.() ?? [];
    const sessionCookie = cookies.find((c) => c.startsWith("3x-ui=") || c.startsWith("session="));
    const cookie = sessionCookie?.split(";")[0] ?? "";
    remoteSessions.set(key, { cookie, expiresAt: Date.now() + 3600_000 });
    return cookie;
  } catch {
    return "";
  }
}

/**
 * Get online clients from a REMOTE 3X-UI panel.
 */
async function getRemoteOnlineClients(server: ServerConfig): Promise<string[]> {
  if (!server.panelUrl) return [];
  try {
    const cookie = await loginRemotePanel(server);
    if (!cookie) return [];

    const res = await fetch(`${server.panelUrl}/panel/api/inbounds/onlines`, {
      method: "POST",
      headers: { Cookie: cookie, Accept: "application/json" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { success: boolean; obj?: string[] };
    return data.success && data.obj ? data.obj : [];
  } catch {
    return [];
  }
}

async function listRemoteInbounds(server: ServerConfig): Promise<XuiInbound[]> {
  if (!server.panelUrl) return [];
  try {
    const cookie = await loginRemotePanel(server);
    if (!cookie) return [];

    const res = await fetch(`${server.panelUrl}/panel/api/inbounds/list`, {
      headers: { Cookie: cookie, Accept: "application/json" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { success: boolean; obj?: XuiInbound[] };
    return data.success && data.obj ? data.obj : [];
  } catch {
    return [];
  }
}

async function addRemoteClient(
  server: ServerConfig,
  opts: XuiCreateClientOptions,
  inboundId: number = server.inboundId || DEFAULT_INBOUND_ID
): Promise<void> {
  if (!server.panelUrl) throw new Error(`${server.label} panel URL is not configured`);
  const cookie = await loginRemotePanel(server);
  if (!cookie) throw new Error(`${server.label} panel login failed`);

  const client = buildClientPayload(opts);
  const res = await fetch(`${server.panelUrl}/panel/api/inbounds/addClient`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      id: inboundId,
      settings: JSON.stringify({ clients: [client] }),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${server.label} addClient HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`${server.label} addClient failed: ${data.msg || "unknown"}`);
  }
}

async function updateRemoteClient(
  server: ServerConfig,
  clientId: string,
  updates: Partial<XuiClient>,
  inboundId: number = server.inboundId || DEFAULT_INBOUND_ID
): Promise<void> {
  if (!server.panelUrl) throw new Error(`${server.label} panel URL is not configured`);
  const inbounds = await listRemoteInbounds(server);
  const inbound = inbounds.find((inb) => inb.id === inboundId);
  const settings = JSON.parse((inbound as any)?.settings || "{}");
  const clients: XuiClient[] = settings.clients || [];
  const existing = clients.find((c) => c.id === clientId);
  if (!existing) throw new Error(`${server.label} client ${clientId} not found`);

  const cookie = await loginRemotePanel(server);
  if (!cookie) throw new Error(`${server.label} panel login failed`);

  const res = await fetch(`${server.panelUrl}/panel/api/inbounds/updateClient/${clientId}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      id: inboundId,
      settings: JSON.stringify({ clients: [{ ...existing, ...updates }] }),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${server.label} updateClient HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`${server.label} updateClient failed: ${data.msg || "unknown"}`);
  }
}

async function deleteRemoteClient(
  server: ServerConfig,
  clientId: string,
  inboundId: number = server.inboundId || DEFAULT_INBOUND_ID
): Promise<void> {
  if (!server.panelUrl) throw new Error(`${server.label} panel URL is not configured`);
  const cookie = await loginRemotePanel(server);
  if (!cookie) throw new Error(`${server.label} panel login failed`);

  const res = await fetch(
    `${server.panelUrl}/panel/api/inbounds/${inboundId}/delClient/${clientId}`,
    {
      method: "POST",
      headers: { Cookie: cookie, Accept: "application/json" },
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${server.label} deleteClient HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`${server.label} deleteClient failed: ${data.msg || "unknown"}`);
  }
}

async function findRemoteClientByEmail(
  server: ServerConfig,
  email: string,
  inboundId: number = server.inboundId || DEFAULT_INBOUND_ID
): Promise<XuiClient | null> {
  const inbounds = await listRemoteInbounds(server);
  const inbound = inbounds.find((inb) => inb.id === inboundId);
  const settings = JSON.parse((inbound as any)?.settings || "{}");
  const clients: XuiClient[] = settings.clients || [];
  return clients.find((c) => c.email === email) || null;
}

async function ensureRemoteClient(
  server: ServerConfig,
  opts: XuiCreateClientOptions,
  inboundId: number = server.inboundId || DEFAULT_INBOUND_ID
): Promise<{ server: string; inboundId: number; action: string; ok: boolean; error?: string }> {
  const updates: Partial<XuiClient> = {
    enable: true,
    expiryTime: opts.expiryTime ?? 0,
    totalGB: opts.totalGB ?? 0,
    limitIp: opts.limitIp ?? 0,
    flow: opts.flow !== undefined ? opts.flow : "",
    reset: 0,
  };

  try {
    await addRemoteClient(server, opts, inboundId);
    return { server: server.label, inboundId, action: "created", ok: true };
  } catch (err: any) {
    const message = String(err?.message || err);
    const existing = await findRemoteClientByEmail(server, opts.email, inboundId).catch(() => null);
    if (!existing) {
      return { server: server.label, inboundId, action: "failed", ok: false, error: message };
    }

    if (opts.id && existing.id !== opts.id) {
      try {
        await deleteRemoteClient(server, existing.id, inboundId);
        await addRemoteClient(server, opts, inboundId);
        return { server: server.label, inboundId, action: "recreated", ok: true };
      } catch (replaceErr: any) {
        return {
          server: server.label,
          inboundId,
          action: "failed",
          ok: false,
          error: String(replaceErr?.message || replaceErr),
        };
      }
    }

    try {
      await updateRemoteClient(server, existing.id, updates, inboundId);
      return { server: server.label, inboundId, action: "updated", ok: true };
    } catch (updateErr: any) {
      return {
        server: server.label,
        inboundId,
        action: "failed",
        ok: false,
        error: String(updateErr?.message || updateErr),
      };
    }
  }
}

/**
 * Get online clients from ALL servers (local + secondary panels).
 * Returns deduplicated email list with server labels.
 */
export async function getAllOnlineClients(): Promise<{ email: string; server: string }[]> {
  // Query local panel + all secondary panels in parallel
  const localPromise = getOnlineClients().then((emails) =>
    emails.map((e) => ({ email: e, server: PRIMARY_SERVER.label }))
  );

  const remotePromises = SECONDARY_SERVERS.map((server) =>
    getRemoteOnlineClients(server).then((emails) =>
      emails.map((e) => ({ email: e, server: server.label }))
    )
  );

  const results = await Promise.all([localPromise, ...remotePromises]);
  const all = results.flat();

  // Deduplicate — if same email is on multiple servers, list all servers
  const byEmail = new Map<string, Set<string>>();
  for (const { email, server } of all) {
    if (!byEmail.has(email)) byEmail.set(email, new Set());
    byEmail.get(email)!.add(server);
  }

  return [...byEmail.entries()].map(([email, servers]) => ({
    email,
    server: [...servers].join(", "),
  }));
}

/**
 * Connection log entry parsed from Xray access log.
 */
export interface ConnectionLogEntry {
  timestamp: string;
  sourceIp: string;
  sourcePort: string;
  protocol: string; // tcp or udp
  destination: string;
  destinationPort: string;
  inbound: string;
  route: string;
  email: string;
}

/**
 * Parse the last N lines of Xray access log.
 * Returns structured connection entries.
 */
export async function getRecentConnections(maxLines: number = 500): Promise<ConnectionLogEntry[]> {
  const { execSync } = await import("child_process");
  // Read from BOTH Xray log files: x-ui managed Xray + codex XHTTP Xray (port 8444)
  const logPaths = [
    "/var/log/xray/access.log",
    "/var/log/xray-codex/access.log",
    "/var/log/xray-es/access.log",
  ];

  try {
    const raw = execSync(
      logPaths.map(p => `tail -${maxLines} ${p} 2>/dev/null`).join(" ; "),
      { encoding: "utf-8", timeout: 5000 }
    );

    const entries: ConnectionLogEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim() || !line.includes("email:")) continue;

      // Format: 2026/04/13 14:45:39.272260 from 31.173.84.33:23817 accepted tcp:cf-st.sc-cdn.net:443 [inbound-2083 >> fragment] email: user@email.com
      const match = line.match(
        /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\.\d+\s+from\s+(?:tcp:|udp:)?(\d+\.\d+\.\d+\.\d+):(\d+)\s+accepted\s+(tcp|udp):(.+?):(\d+)\s+\[(.+?)\]\s+email:\s+(.+)$/
      );
      if (match) {
        const [, timestamp, srcIp, srcPort, proto, dest, destPort, routeInfo, email] = match;
        const [inbound, route] = routeInfo.split(/\s+>>\s+|\s+->\s+/);
        entries.push({
          timestamp,
          sourceIp: srcIp,
          sourcePort: srcPort,
          protocol: proto,
          destination: dest,
          destinationPort: destPort,
          inbound: inbound.trim(),
          route: route?.trim() || "direct",
          email: email.trim(),
        });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * User activity summary — aggregated from access logs.
 */
export interface UserActivitySummary {
  email: string;
  isOnline: boolean;
  onlineServer: string | null; // which server(s) user is connected to
  lastSeen: string | null;
  lastSeenAgo: string | null;
  sourceIps: string[];
  connectionCount: number;
  topDomains: { domain: string; count: number }[];
  inboundsUsed: string[];
  blockedCount: number;
}

/**
 * Check if a destination is "noise" — DNS, OS telemetry, push services, system
 * background traffic, etc. These are automated connections from the user's device,
 * NOT real websites the user intentionally visited.
 *
 * We keep: social media, streaming, messaging apps, real websites, email servers.
 * We filter: DNS, push services, telemetry, system updates, our own VPN infra.
 */
export function isNoiseDest(dest: string, port: string): boolean {
  // ── Always noise ──
  // DNS resolvers (port 53)
  if (port === "53") return true;
  // SSDP / multicast / mDNS
  if (port === "1900" || port === "5353") return true;
  // Raw IP addresses (no domain name — not a real website)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(dest)) return true;
  // Localhost / internal API
  if (dest === "127.0.0.1" || dest === "localhost") return true;

  const d = dest.toLowerCase();

  // ── Our own VPN infrastructure ──
  if (d.includes("ikambavpn") || d.includes("ikambaremit.com")) return true;

  // ── DNS-over-HTTPS / resolver services ──
  if (
    d === "dns.google" ||
    d === "one.one.one.one" ||
    d.includes("cloudflare-dns.com") ||
    d === "dns.adguard.com" ||
    d === "dns.quad9.net" ||
    d === "doh.opendns.com"
  ) return true;

  // ── OS push / keep-alive services (not user-initiated) ──
  if (d === "mtalk.google.com") return true;               // Android push
  if (d === "courier.push.apple.com") return true;          // Apple push (APNs)
  if (d.endsWith(".push.apple.com")) return true;           // Other APNs endpoints
  if (d === "gs-loc.apple.com") return true;                // Apple location services
  if (d === "tether.edge.apple") return true;               // Apple tethering probe
  if (d === "bag.itunes.apple.com") return true;            // Apple config bag
  if (d === "gateway.icloud.com") return true;              // iCloud gateway keep-alive
  if (d === "gsa.apple.com") return true;                   // Apple auth services

  // ── Windows / Microsoft telemetry & delivery optimization ──
  if (d.includes("self.events.data.microsoft.com")) return true;
  if (d.includes(".prod.do.dsp.mp.microsoft.com")) return true;  // Delivery optimization
  if (d.includes("settings-win.data.microsoft.com")) return true;
  if (d.includes("v10.events.data.microsoft.com")) return true;
  if (d.includes("watson.telemetry.microsoft.com")) return true;
  if (d.includes("vortex.data.microsoft.com")) return true;

  // ── Google system / auth services (not user-browsed) ──
  if (d === "oauthaccountmanager.googleapis.com") return true;
  if (d === "identitytoolkit.googleapis.com") return true;
  if (d === "securetoken.googleapis.com") return true;
  if (d === "firebasestorage.googleapis.com") return true;
  if (d === "firebaselogging-pa.googleapis.com") return true;
  if (d === "firebaseinstallations.googleapis.com") return true;
  if (d.includes("update.googleapis.com")) return true;
  if (d.includes("xgapromomanager-pa.googleapis.com")) return true;

  // ── IDE / dev tool telemetry (background) ──
  if (d.includes("telemetry.individual.githubcopilot.com")) return true;
  if (d.includes("vscode-sync.trafficmanager.net")) return true;
  if (d.includes("otel.gitkraken.com")) return true;

  // ── Antivirus / security software background ──
  if (d.includes("360safe.com")) return true;
  if (d.includes("kaspersky")) return true;
  if (d.includes("avast")) return true;

  // Not noise — this is real traffic
  return false;
}

/**
 * Build an activity summary for all users from access logs + online status.
 */
export async function getUserActivitySummaries(): Promise<UserActivitySummary[]> {
  const [onlineList, connections] = await Promise.all([
    getAllOnlineClients(),
    getRecentConnections(2000),
  ]);

  // Build online lookup: email -> server label(s)
  const onlineMap = new Map<string, string>();
  for (const entry of onlineList) {
    onlineMap.set(entry.email, entry.server);
  }

  // Group connections by email — filter out internal API calls (no email)
  const byUser = new Map<string, ConnectionLogEntry[]>();
  for (const conn of connections) {
    if (!byUser.has(conn.email)) byUser.set(conn.email, []);
    byUser.get(conn.email)!.push(conn);
  }

  // Build summaries
  const summaries: UserActivitySummary[] = [];

  // Include ALL emails — both those in logs AND those currently online
  const allEmails = new Set([...byUser.keys(), ...onlineMap.keys()]);

  for (const email of allEmails) {
    const conns = byUser.get(email) || [];

    // Last seen — use the most recent REAL connection (not DNS noise)
    const realConns = conns.filter(
      (c) => !isNoiseDest(c.destination, c.destinationPort)
    );
    const lastConn =
      realConns.length > 0
        ? realConns[realConns.length - 1]
        : conns.length > 0
        ? conns[conns.length - 1]
        : null;
    let lastSeen: string | null = null;
    let lastSeenAgo: string | null = null;
    if (lastConn) {
      lastSeen = lastConn.timestamp;
      // Calculate "ago" string
      const logDate = new Date(lastConn.timestamp.replace(/\//g, "-"));
      const diffMs = Date.now() - logDate.getTime();
      if (diffMs < 60_000) lastSeenAgo = "just now";
      else if (diffMs < 3600_000) lastSeenAgo = `${Math.floor(diffMs / 60_000)}m ago`;
      else if (diffMs < 86400_000) lastSeenAgo = `${Math.floor(diffMs / 3600_000)}h ago`;
      else lastSeenAgo = `${Math.floor(diffMs / 86400_000)}d ago`;
    }

    // Unique source IPs
    const sourceIps = [...new Set(conns.map((c) => c.sourceIp))];

    // Top domains — exclude blocked, DNS noise, raw IPs
    const domainCounts = new Map<string, number>();
    let blockedCount = 0;
    for (const c of conns) {
      if (c.route === "blocked") {
        blockedCount++;
        continue;
      }
      // Skip noise
      if (isNoiseDest(c.destination, c.destinationPort)) continue;
      const domain = c.destination;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }
    const topDomains = [...domainCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([domain, count]) => ({ domain, count }));

    // Inbounds used
    const inboundsUsed = [...new Set(conns.map((c) => c.inbound))];

    summaries.push({
      email,
      isOnline: onlineMap.has(email),
      onlineServer: onlineMap.get(email) || null,
      lastSeen,
      lastSeenAgo: onlineMap.has(email) ? "now" : lastSeenAgo,
      sourceIps,
      connectionCount: realConns.length, // meaningful connections only
      topDomains,
      inboundsUsed,
      blockedCount,
    });
  }

  // Sort: online first, then by connection count
  summaries.sort((a, b) => {
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return b.connectionCount - a.connectionCount;
  });

  return summaries;
}

// ── Inbound Operations ────────────────────────────────────────────────────────

/** List all inbounds */
export async function listInbounds(): Promise<XuiInbound[]> {
  return apiRequest<XuiInbound[]>("/panel/api/inbounds/list");
}

/** Get a single inbound by ID */
export async function getInbound(id: number = DEFAULT_INBOUND_ID): Promise<XuiInbound> {
  return apiRequest<XuiInbound>(`/panel/api/inbounds/get/${id}`);
}

// ── Client (User) Operations ──────────────────────────────────────────────────

function buildClientPayload(opts: XuiCreateClientOptions): XuiClient {
  return {
    id: opts.id ?? randomUUID(),
    email: opts.email,
    enable: true,
    flow: opts.flow !== undefined ? opts.flow : "",
    totalGB: opts.totalGB ?? 0,
    expiryTime: opts.expiryTime ?? 0,
    subId: opts.subId ?? genSubId(),
    limitIp: opts.limitIp ?? 0,
    tgId: opts.tgId ?? "",
    reset: 0,
  };
}

/**
 * Add a new client to an inbound.
 * Returns the client UUID and subscription token.
 */
export async function addClient(
  opts: XuiCreateClientOptions,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<{ id: string; subId: string; email: string }> {
  const client = buildClientPayload(opts);

  const cookie = await login();

  const res = await fetch(`${PANEL_URL}/panel/api/inbounds/addClient`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      id: inboundId,
      settings: JSON.stringify({ clients: [client] }),
    }),
  });

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`Failed to add client: ${data.msg}`);
  }

  return { id: client.id, subId: client.subId, email: opts.email };
}

/**
 * Update an existing client.
 */
export async function updateClient(
  clientId: string,
  updates: Partial<XuiClient>,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<void> {
  // First get current client settings
  const inbound = await getInbound(inboundId);
  const settings = JSON.parse((inbound as any).settings || "{}");
  const clients: XuiClient[] = settings.clients || [];
  const existing = clients.find((c) => c.id === clientId);

  if (!existing) {
    throw new Error(`Client ${clientId} not found in inbound ${inboundId}`);
  }

  const updated = { ...existing, ...updates };

  const cookie = await login();
  const res = await fetch(
    `${PANEL_URL}/panel/api/inbounds/updateClient/${clientId}`,
    {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        id: inboundId,
        settings: JSON.stringify({ clients: [updated] }),
      }),
    }
  );

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`Failed to update client: ${data.msg}`);
  }
}

/**
 * Enable or disable a client.
 */
export async function setClientEnabled(
  clientId: string,
  enable: boolean,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<void> {
  return updateClient(clientId, { enable }, inboundId);
}

/**
 * Delete a client by email.
 */
export async function deleteClient(
  clientId: string,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<void> {
  const cookie = await login();
  const res = await fetch(
    `${PANEL_URL}/panel/api/inbounds/${inboundId}/delClient/${clientId}`,
    {
      method: "POST",
      headers: { Cookie: cookie, Accept: "application/json" },
    }
  );

  const data = (await res.json()) as { success: boolean; msg?: string };
  if (!data.success) {
    throw new Error(`Failed to delete client: ${data.msg}`);
  }
}

/**
 * Reset a client's traffic counter.
 */
export async function resetClientTraffic(
  email: string,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<void> {
  await apiRequest(`/panel/api/inbounds/${inboundId}/resetClientTraffic/${encodeURIComponent(email)}`, {
    method: "POST",
  });
}

/**
 * Get traffic stats for all clients in an inbound.
 */
export async function getClientStats(
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<XuiClientStat[]> {
  const inbound = await getInbound(inboundId);
  return inbound.clientStats ?? [];
}

/**
 * Get stats for a specific client by email.
 */
export async function getClientStatByEmail(
  email: string,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<XuiClientStat | null> {
  const stats = await getClientStats(inboundId);
  return stats.find((s) => s.email === email) ?? null;
}

// ── Subscription URLs ─────────────────────────────────────────────────────────

/**
 * Build a direct VLESS+REALITY link for a client.
 * Bypasses the broken 3X-UI subscription endpoint entirely.
 *
 * IMPORTANT: We build the query string manually instead of using URLSearchParams
 * because URLSearchParams encodes special characters (e.g. / → %2F) which causes
 * V2RayNG, V2RayTun, and Hiddify to fail parsing the link silently — users see
 * "connected" but traffic doesn't flow, or the connection drops after a few seconds.
 */
/**
 * Permanent NONSUB profile: VLESS+TCP+REALITY, tradingview SNI, no Cloudflare, no subscription.
 */
export function buildNonsubTcpLink(clientId: string, remark: string): string {
  if (!clientId) throw new Error("buildNonsubTcpLink: clientId is required");
  if (!NONSUB_PUBLIC_KEY || !NONSUB_SHORT_ID) {
    throw new Error("buildNonsubTcpLink: REALITY keys not configured");
  }
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${NONSUB_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `flow=xtls-rprx-vision`,
    `sni=${NONSUB_SNI}`,
    `sid=${NONSUB_SHORT_ID}`,
    `spx=/`,
  ].join("&");
  const label = remark ? `${remark}-NONSUB` : "IkambaVPN-NONSUB";
  return `vless://${clientId}@${VLESS_CONNECT_HOST}:${NONSUB_PORT}?${query}#${encodeURIComponent(label)}`;
}

export function buildVlessLink(clientId: string, remark: string): string {
  if (!clientId) {
    throw new Error("buildVlessLink: clientId is required");
  }
  if (!REALITY_PUBLIC_KEY) {
    throw new Error("buildVlessLink: XPANEL_REALITY_PUBLIC_KEY env var is not set");
  }
  if (!REALITY_SHORT_ID) {
    throw new Error("buildVlessLink: XPANEL_REALITY_SHORT_ID env var is not set");
  }

  // Build query string manually — URLSearchParams encodes `/` and `-` which
  // breaks V2RayNG/V2RayTun/Hiddify VLESS URI parsing on Android & iOS.
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${REALITY_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `flow=xtls-rprx-vision`,
    `sni=tradingview.com`,
    `sid=${REALITY_SHORT_ID}`,
    `spx=/`,
  ].join("&");

  return `vless://${clientId}@${VLESS_CONNECT_HOST}:${VLESS_PORT}?${query}#${encodeURIComponent(remark)}`;
}

/**
 * Build a VLESS+XHTTP+REALITY link for the anti-DPI fallback inbound (port 8443).
 * Same REALITY keys as the TCP inbound — just a different transport.
 */
export function buildXhttpLink(clientId: string, remark: string): string {
  if (!XHTTP_PUBLIC_KEY || !XHTTP_SHORT_ID) {
    throw new Error("buildXhttpLink: XHTTP REALITY metadata is not set");
  }

  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${XHTTP_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${XHTTP_SNI}`,
    `sid=${XHTTP_SHORT_ID}`,
    `path=${encodeURIComponent(XHTTP_PATH)}`,
    `mode=auto`,
  ].join("&");

  return `vless://${clientId}@${VPS_IP}:${XHTTP_PORT}?${query}#${encodeURIComponent(remark + "-XHTTP")}`;
}

/**
 * Build a VLESS+WebSocket link for the anti-DPI primary inbound (port 2083).
 *
 * WebSocket multiplexes ALL user traffic over a single persistent TCP connection,
 * preventing ISP connection-count-based DPI that kills REALITY+TCP connections
 * when apps like YouTube create 50+ simultaneous TLS sessions.
 *
 * This is now the DEFAULT/PRIMARY transport for all users in Russia.
 */
export function buildWsLink(clientId: string, remark: string): string {
  if (!clientId) {
    throw new Error("buildWsLink: clientId is required");
  }

  const query = [
    `type=ws`,
    `security=none`,
    `path=${WS_PATH}`,
    `host=${WS_HOST}`,
  ].join("&");

  return `vless://${clientId}@${VLESS_CONNECT_HOST}:${WS_PORT}?${query}#${encodeURIComponent(remark + "-WS")}`;
}

/**
 * Build a VLESS+WebSocket link for the social-optimized inbound (port 2087).
 * Server-side routing rules blackhole ad/tracker domains for this inbound's tag,
 * giving lighter ads and faster social media loading.
 *
 * Points at SOCIAL_SERVER_IP (Stockholm) — the only box that hosts this inbound.
 * Clients use the same UUID as their primary connection.
 */
export function buildSocialLink(clientId: string, remark: string): string {
  if (!clientId) {
    throw new Error("buildSocialLink: clientId is required");
  }

  const query = [
    `type=ws`,
    `security=none`,
    `path=${SOCIAL_PATH}`,
    `host=${SOCIAL_HOST}`,
  ].join("&");

  return `vless://${clientId}@${SOCIAL_SERVER_IP}:${SOCIAL_PORT}?${query}#${encodeURIComponent(remark + "-Social")}`;
}

export function buildHostkeyEsVisionLink(clientId: string, remark: string): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${HOSTKEY_ES_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=www.microsoft.com`,
    `sid=${HOSTKEY_ES_SHORT_ID_443}`,
    `spx=/`,
    `flow=xtls-rprx-vision`,
  ].join("&");

  return `vless://${clientId}@${HOSTKEY_ES_IP}:443?${query}#${encodeURIComponent(remark + "-ES-Speed-443-Vision-Reality")}`;
}

/**
 * 🇪🇸 Spain TCP+REALITY+Vision on port 2087 (es-vision-2087 inbound).
 *
 * The intended fast & stealthy default profile:
 *   - TCP transport (single long-lived connection, lowest DPI surface)
 *   - REALITY with target=www.microsoft.com (top-tier SNI — too important
 *     to block wholesale, so most DPI leaves it alone)
 *   - xtls-rprx-vision flow (strips TLS-in-TLS, ~30–50% faster than gRPC,
 *     avoids the double-encryption entropy signature)
 *   - shortId is unique to this inbound (minted on server 2026-06-05)
 *
 * REALITY public key is shared with the rest of the ES inbounds
 * (HOSTKEY_ES_PUBLIC_KEY) because the server reuses one privateKey.
 */
export function buildEsSpainGrpcLink(_clientId: string, _remark: string): string {
  if (!HOSTKEY_ES_PUBLIC_KEY) {
    throw new Error("buildEsSpainGrpcLink: HOSTKEY_ES_PUBLIC_KEY not configured");
  }
  if (!HOSTKEY_ES_GRPC_SHORT_ID) {
    throw new Error("buildEsSpainGrpcLink: HOSTKEY_ES_GRPC_SHORT_ID not configured");
  }
  // Force the shared free UUID — the Spain es-grpc-9443 inbound uses one
  // shared client for the free tier. Per-user UUIDs would fail auth.
  const uuid = ES_GRPC_SHARED_UUID;
  const query = [
    `type=grpc`,
    `security=reality`,
    `pbk=${HOSTKEY_ES_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${HOSTKEY_ES_GRPC_SNI}`,
    `sid=${HOSTKEY_ES_GRPC_SHORT_ID}`,
    `spx=`,
    `serviceName=${HOSTKEY_ES_GRPC_SERVICE}`,
    `mode=gun`,
  ].join("&");
  return `vless://${uuid}@${HOSTKEY_ES_IP}:${HOSTKEY_ES_GRPC_PORT}?${query}#${encodeURIComponent("🇪🇸 Spain gRPC")}`;
}

/**
 * 🇪🇸 Spain XHTTP+REALITY on 8443 (es-xhttp-8443 inbound).
 *
 * For clients that DON'T support gRPC (e.g. izi VPN). XHTTP is HTTP-based, so
 * like gRPC it survives the DPI that freezes TCP+Vision REALITY on these
 * networks. REALITY fronts cloudflare/tradingview; Host header = server IP and
 * mode=auto are the shape that passes aggressive RU/WiFi DPI. Uses the shared
 * free UUID already provisioned in this inbound. Carries live RU traffic.
 */
export function buildEsSpainXhttpLink(_clientId: string, _remark: string): string {
  if (!HOSTKEY_ES_PUBLIC_KEY) {
    throw new Error("buildEsSpainXhttpLink: HOSTKEY_ES_PUBLIC_KEY not configured");
  }
  const uuid = ES_GRPC_SHARED_UUID; // same shared free UUID across ES inbounds
  // es-xhttp-443: XHTTP clone of the proven working es-grpc-9443 inbound —
  // same REALITY key/shortId and www.apple.com SNI, but XHTTP transport on
  // port 443 (the privileged TLS port RU DPI can't broadly drop) and a client
  // that supports XHTTP (izi VPN, no gRPC needed).
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=i2ryLXz5H51kVANIqKIFI30_rAx6iuEveXwPqY_GyRY`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=www.cloudflare.com`,
    `sid=509db650956762e8`,
    `spx=/`,
    `path=${encodeURIComponent("/assets/fceebc8ad5ca/events")}`,
    `host=${HOSTKEY_ES_IP}`,
    `mode=auto`,
  ].join("&");
  return `vless://${uuid}@${HOSTKEY_ES_IP}:443?${query}#${encodeURIComponent("🇪🇸 Spain XHTTP")}`;
}

/**
 * Frankfurt TCP+REALITY+Vision on port 443 (IkambaVPN-test30-Backup-Frankfurt-TCP-Reality).
 * x-ui inbound-443, sni=www.microsoft.com, sid=bf08e4d4a095a87d.
 * Shared UUID 38285504-... is provisioned with flow=xtls-rprx-vision in this inbound.
 * Confirmed working on both WiFi and mobile data in Russia.
 */
export function buildFrankfurtTcpVisionLink(_clientId: string, _remark: string): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=HVv7GZjb6DYZsfQKvv21lyV8LquTZGZPcMSQ6SevhBA`,
    `fp=chrome`,
    `flow=xtls-rprx-vision`,
    `sni=www.microsoft.com`,
    `sid=bf08e4d4a095a87d`,
    `spx=/`,
  ].join("&");
  return `vless://38285504-1bba-4511-b5fe-ecfc72e1285b@187.77.71.106:443?${query}#${encodeURIComponent("🇩🇪 Frankfurt Vision")}`;
}

/**
 * 🇩🇪 Frankfurt XHTTP+REALITY — port 8444, DPI-resistant.
 * Replaces TCP+Vision as the default subscription profile.
 * Same Frankfurt server & UUID, XHTTP transport survives the DPI that
 * freezes TCP+Vision. Path /assets/fceebc8ad5ca/clean, host=server IP.
 */
export function buildFrankfurtXhttpLink(_clientId: string, _remark: string): string {
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=i2ryLXz5H51kVANIqKIFI30_rAx6iuEveXwPqY_GyRY`,
    `fp=chrome`,
    `sni=www.cloudflare.com`,
    `sid=509db650956762e8`,
    `spx=/`,
    `path=${encodeURIComponent("/assets/fceebc8ad5ca/clean")}`,
    `host=187.77.71.106`,
    `mode=auto`,
  ].join("&");
  return `vless://38285504-1bba-4511-b5fe-ecfc72e1285b@187.77.71.106:8444?${query}#${encodeURIComponent("🇩🇪 Frankfurt XHTTP")}`;
}

export function buildHostkeyEsTurboLink(clientId: string, remark: string): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${HOSTKEY_ES_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `flow=xtls-rprx-vision`,
    `sni=tradingview.com`,
    `sid=${HOSTKEY_ES_SHORT_ID_43234}`,
    `spx=`,
  ].join("&");

  return `vless://${clientId}@${HOSTKEY_ES_IP}:43234?${query}#${encodeURIComponent("🇪🇸 Spain TCP Turbo")}`;
}

export function buildHostkeyEsXhttpLink(clientId: string, remark: string): string {
  // Matches the working "Russia-DPI-XHTTP-Reality" shape: XHTTP + Reality
  // with cloudflare SNI, explicit Host header set to the server IP, and
  // mode=auto. These three details let the request shape pass aggressive
  // WiFi DPI that fingerprints stock XHTTP-Reality traffic.
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${HOSTKEY_ES_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=tradingview.com`,
    `sid=${HOSTKEY_ES_SHORT_ID_8443}`,
    `spx=/`,
    `path=${encodeURIComponent(HOSTKEY_ES_XHTTP_PATH)}`,
    `host=${HOSTKEY_ES_IP}`,
    `mode=auto`,
  ].join("&");

  return `vless://${clientId}@${HOSTKEY_ES_IP}:8443?${query}#${encodeURIComponent("🇪🇸 Spain Stealth")}`;
}

/**
 * Russia-DPI XHTTP+REALITY on the Brazil clean IP (187.77.71.106).
 * Matches the working test30 client JSON: xhttp, reality, sni=cloudflare,
 * host=server IP, path=/assets/.../events. whatismyip shows Brazil (BR).
 */
/** XHTTP+REALITY on Hetzner (inbound Russia-DPI-XHTTP-Reality, port 8443). */
export function buildHetznerDpiXhttpLink(clientId: string, remark: string): string {
  if (!clientId) throw new Error("buildHetznerDpiXhttpLink: clientId is required");
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${HETZNER_XHTTP_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${HETZNER_XHTTP_SNI}`,
    `sid=${HETZNER_XHTTP_SHORT_ID}`,
    `spx=/`,
    `path=${encodeURIComponent(HETZNER_XHTTP_PATH)}`,
    `host=${VPS_IP}`,
    `mode=auto`,
  ].join("&");
  const label = remark ? `${remark}-Hetzner-DPI-XHTTP` : "IkambaVPN-Hetzner-DPI-XHTTP";
  return `vless://${clientId}@${VLESS_CONNECT_HOST}:${HETZNER_XHTTP_PORT}?${query}#${encodeURIComponent(label)}`;
}

export function buildBrazilDpiXhttpLink(clientId: string, remark: string): string {
  if (!clientId) {
    throw new Error("buildBrazilDpiXhttpLink: clientId is required");
  }
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${BRAZIL_XHTTP_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${BRAZIL_XHTTP_SNI}`,
    `sid=${BRAZIL_XHTTP_SHORT_ID}`,
    `spx=/`,
    `path=${encodeURIComponent(BRAZIL_XHTTP_PATH)}`,
    `host=${BRAZIL_CLEAN_IP}`,
    `mode=auto`,
  ].join("&");
  const label = remark
    ? `${remark}-Russia-DPI-XHTTP-Reality`
    : "IkambaVPN-Russia-DPI-XHTTP-Reality";
  return `vless://${clientId}@${BRAZIL_CLEAN_IP}:${BRAZIL_XHTTP_PORT}?${query}#${encodeURIComponent(label)}`;
}

export function buildFrankfurtTurboLink(clientId: string, remark: string): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${FRANKFURT_TURBO_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${FRANKFURT_TURBO_SNI}`,
    `sid=${FRANKFURT_TURBO_SHORT_ID}`,
    `spx=`,
  ].join("&");

  return `vless://${clientId}@${VPS_IP}:${FRANKFURT_TURBO_PORT}?${query}#${encodeURIComponent("🇩🇪 Germany TCP Turbo")}`;
}

/**
 * Experimental profile — replicates the test30 "Russia-DPI-XHTTP-Reality"
 * shape verified to pass aggressive WiFi DPI: XHTTP + Reality + cloudflare
 * SNI + Host header set to the server IP + mode=auto. Same target as Spain
 * Stealth, kept under the "experimental" label as the canonical reference
 * config for comparing against future variants.
 */
export function buildExperimentalLink(clientId: string, remark: string): string {
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${HOSTKEY_ES_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=tradingview.com`,
    `sid=${HOSTKEY_ES_SHORT_ID_8443}`,
    `spx=/`,
    `path=${encodeURIComponent(HOSTKEY_ES_XHTTP_PATH)}`,
    `host=${HOSTKEY_ES_IP}`,
    `mode=auto`,
  ].join("&");
  return `vless://${clientId}@${HOSTKEY_ES_IP}:8443?${query}#${encodeURIComponent("experimental")}`;
}

/**
 * wifi profiles — gRPC+Reality+apple-SNI inbounds on port 9443.
 * Mirror of the working test30-Maximum-Stealth-gRPC shape — clean transport
 * that bypasses aggressive WiFi DPI when our cloud-provider IPs are reachable.
 * Each server has its own reality keypair + unique shortId + serviceName, but
 * the same per-customer UUID (reused from inbound-43234).
 */
const WIFI_GRPC_PORT = 9443;
const WIFI_GRPC_SNI = "www.apple.com";

const WIFI_ES_SHORT_ID = "c0cf136b037aaab1";
const WIFI_ES_SVC = "ikambasvc266940179";

const WIFI_FI_IP = "194.76.217.4";
const WIFI_FI_PUB_KEY = "yMO3nD0R94-dZW8-Cxc9LkepHyzjQIPXyXHKB56Ge1A";
const WIFI_FI_SHORT_ID = "8466916e4710938c";
const WIFI_FI_SVC = "ikambasvc614194697";

const WIFI_SE_IP = "138.124.24.164";
const WIFI_SE_PUB_KEY = "Hyr1QIN4U7tY3GYqe2FA0gv05IdTXn0hnAso7YhffCY";
const WIFI_SE_SHORT_ID = "165f394890879817";
const WIFI_SE_SVC = "ikambasvc701100088";

function buildGrpcRealityWifiLink(
  clientId: string, ip: string, pubKey: string, shortId: string, svc: string, label: string,
): string {
  const query = [
    `type=grpc`,
    `security=reality`,
    `pbk=${pubKey}`,
    `fp=chrome`,
    `sni=${WIFI_GRPC_SNI}`,
    `sid=${shortId}`,
    `spx=`,
    `serviceName=${svc}`,
    `mode=gun`,
  ].join("&");
  return `vless://${clientId}@${ip}:${WIFI_GRPC_PORT}?${query}#${encodeURIComponent(label)}`;
}

export function buildWifiLink(clientId: string, _remark: string): string {
  return buildGrpcRealityWifiLink(clientId, HOSTKEY_ES_IP, HOSTKEY_ES_PUBLIC_KEY, WIFI_ES_SHORT_ID, WIFI_ES_SVC, "🇪🇸 wifi");
}

export function buildWifiFinlandLink(clientId: string, _remark: string): string {
  return buildGrpcRealityWifiLink(clientId, WIFI_FI_IP, WIFI_FI_PUB_KEY, WIFI_FI_SHORT_ID, WIFI_FI_SVC, "🇫🇮 wifi");
}

export function buildWifiSwedenLink(clientId: string, _remark: string): string {
  return buildGrpcRealityWifiLink(clientId, WIFI_SE_IP, WIFI_SE_PUB_KEY, WIFI_SE_SHORT_ID, WIFI_SE_SVC, "🇸🇪 wifi");
}

/**
 * 🛡️ wifi-br — exact mirror of the working test30 gRPC+Reality config on the
 * clean Brazilian IP (187.77.71.106). UUID is shared (test30 account) since
 * that's the only credential the server has provisioned — so this profile is
 * a shared-credential failsafe for customers whose WiFi blocks our cloud IPs.
 */
export function buildWifiBrLink(_clientId: string, _remark: string): string {
  const query = [
    `type=grpc`,
    `security=reality`,
    `pbk=llRbGz-ZlXwLg6IcEEpeSXN_d9AydZ4qT0EFtSC6t1s`,
    `fp=chrome`,
    `sni=www.apple.com`,
    `sid=17a181082bcab919`,
    `spx=`,
    `serviceName=svcf121829146`,
    `mode=gun`,
  ].join("&");
  return `vless://38285504-1bba-4511-b5fe-ecfc72e1285b@187.77.71.106:9443?${query}#${encodeURIComponent("🛡️ wifi")}`;
}

// ── Multi-Server Link Builders ────────────────────────────────────────────────
// These variants accept a ServerConfig so we can generate links for any server,
// not just the one this backend instance is running on.

/**
 * Build a VLESS+REALITY link for a specific server.
 * The remark includes the server location and the intended fast TCP profile.
 */
export function buildVlessLinkForServer(clientId: string, remark: string, server: ServerConfig): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${server.realityPubKey}`,
    `fp=${REALITY_FINGERPRINT}`,
    `flow=xtls-rprx-vision`,
    `sni=tradingview.com`,
    `sid=${server.realityShortId}`,
    `spx=`,
  ].join("&");

  const port = server.vlessPort || VLESS_PORT;
  return `vless://${clientId}@${server.ip}:${port}?${query}#${encodeURIComponent(countryProfileLabel(server.label))}`;
}

/**
 * TCP+REALITY profiles only — for anti-DPI tests without WS/XHTTP noise.
 * Use subscription ?tcp_only=1 or GET /xui-public/tcp-link/:email.
 */
export function buildTcpRealityLinks(clientId: string, remark: string): string[] {
  const links: string[] = [];
  const addOptional = (builder: () => string) => {
    try {
      const link = builder();
      if (link) links.push(link);
    } catch {
      // Profile not configured on this host.
    }
  };

  addOptional(() => buildVlessLink(clientId, remark));
  for (const server of getAllServers()) {
    if (server.realityPubKey && server.realityShortId) {
      addOptional(() => buildVlessLinkForServer(clientId, remark, server));
    }
  }
  addOptional(() => buildHostkeyEsTurboLink(clientId, remark));
  addOptional(() => buildHostkeyEsVisionLink(clientId, remark));

  return links;
}

/**
 * Build a VLESS+WebSocket link for a specific server.
 * WS is the primary transport — defeats connection-count DPI.
 */
export function buildWsLinkForServer(clientId: string, remark: string, server: ServerConfig): string {
  const wsPath = server.wsPath || WS_PATH;
  const wsHost = server.wsHost || WS_HOST;
  const wsPort = server.wsPort || WS_PORT;

  const query = [
    `type=ws`,
    `security=none`,
    `path=${wsPath}`,
    `host=${wsHost}`,
  ].join("&");

  return `vless://${clientId}@${server.ip}:${wsPort}?${query}#${encodeURIComponent(remark + "-WS-" + server.label)}`;
}

/**
 * Generate the public subscription profile list.
 *
 * Reduced to ONLY the Brazil gRPC+REALITY profile (187.77.71.106:9443) because
 * all other inbounds (HOSTKEY ES turbo/xhttp, Helsinki, Stockholm, Frankfurt,
 * Finland/Sweden wifi-gRPC, experimental) are currently down or unreliable.
 * The Brazil entry uses the shared test30 UUID and is the only confirmed
 * working profile.
 *
 * To restore the multi-server fan-out, re-introduce the addOptional() calls
 * for the relevant builders below.
 */
export function buildAllServerLinks(clientId: string, remark: string): string[] {
  const links: string[] = [];
  const addOptional = (builder: () => string) => {
    try {
      const link = builder();
      if (link) links.push(link);
    } catch {
      // Optional transport is not configured on this subscription host.
    }
  };

  // Primary: Frankfurt XHTTP+REALITY port 8444 — survives DPI that blocks TCP+Vision
  addOptional(() => buildFrankfurtXhttpLink(clientId, remark));

  return links;
}

/**
 * Build the subscription URL for a client (kept as fallback).
 */
export function getSubscriptionUrl(subId: string): string {
  return `${SUB_BASE}/${subId}`;
}

/**
 * Build a V2RayTun deep link that auto-imports the VLESS link.
 */
export function getV2RayTunDeepLink(vlessLink: string): string {
  return `v2raytun://import/${vlessLink}`;
}

/**
 * Build a V2RayNG deep link for Android.
 */
export function getV2RayNGDeepLink(vlessLink: string): string {
  return `v2rayng://install-config?url=${encodeURIComponent(vlessLink)}`;
}

/**
 * Build a Hiddify deep link for Android.
 */
export function getHiddifyDeepLink(vlessLink: string): string {
  return `hiddify://import/${vlessLink}`;
}

/**
 * Get all connection links for a client.
 * subscriptionUrl now points to our self-hosted sub endpoint (not the broken 3X-UI one).
 * WS link is now the primary — prevents ISP connection-count DPI.
 */
export function getAllClientLinks(clientId: string, subId: string, email: string) {
  const remark = `IkambaVPN-${email.split("@")[0]}`;
  const wsLink = buildWsLink(clientId, remark);
  const vlessLink = buildVlessLink(clientId, remark);
  const socialLink = buildSocialLink(clientId, remark);
  // Self-hosted subscription endpoint — uses DuckDNS domain for proper TLS cert
  const selfHostedSubUrl = `https://${BACKEND_DOMAIN}:8443/xui-public/sub/${encodeURIComponent(email)}`;
  return {
    vlessLink: wsLink, // WS is now the default/primary link
    vlessTcpLink: vlessLink, // TCP REALITY kept as backup
    socialLink, // Social-optimized WS — ad/tracker blocking via server routing
    subscriptionUrl: selfHostedSubUrl,
    v2raytun: getV2RayTunDeepLink(selfHostedSubUrl),
    v2rayng: getV2RayNGDeepLink(selfHostedSubUrl),
    hiddify: getHiddifyDeepLink(selfHostedSubUrl),
  };
}

// ── System Status ─────────────────────────────────────────────────────────────

export interface XuiSystemStatus {
  cpu: number;
  mem: { current: number; total: number };
  disk: { current: number; total: number };
  uptime: number;
  xray: { state: string; version: string };
}

/** Get server system status */
export async function getSystemStatus(): Promise<XuiSystemStatus> {
  return apiRequest<XuiSystemStatus>("/panel/api/server/status");
}

/** Get Xray version */
export async function getXrayVersion(): Promise<string> {
  const status = await getSystemStatus();
  return status.xray.version;
}

// ── Provision a full user (helper) ────────────────────────────────────────────

export interface ProvisionedUser {
  clientId: string;
  subId: string;
  email: string;
  vlessLink: string;
  subscriptionUrl: string;
  v2raytunLink: string;
  v2rayngLink: string;
  hiddifyLink: string;
}

export interface ProvisionUserOptions {
  trafficLimitGB?: number;
  expiryDays?: number;
  maxConnections?: number;
}

function buildProvisionClientOptions(
  email: string,
  options: ProvisionUserOptions | undefined,
  clientId?: string,
  subId?: string
): XuiCreateClientOptions {
  return {
    id: clientId,
    subId,
    email,
    totalGB: options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0,
    expiryTime: options?.expiryDays ? daysFromNow(options.expiryDays) : 0,
    limitIp: options?.maxConnections ?? 0,
    flow: "",
  };
}

export async function syncClientToSecondaryServers(
  email: string,
  clientId: string,
  subId: string,
  options?: ProvisionUserOptions
): Promise<Array<{ server: string; inboundId: number; action: string; ok: boolean; error?: string }>> {
  const servers = SECONDARY_SERVERS.filter((server) => server.panelUrl);
  const tasks: Array<Promise<{ server: string; inboundId: number; action: string; ok: boolean; error?: string }>> = [];

  for (const server of servers) {
    tasks.push(
      ensureRemoteClient(
        server,
        buildProvisionClientOptions(email, options, clientId, subId),
        server.inboundId || DEFAULT_INBOUND_ID
      )
    );

    const shouldMirrorXhttp =
      server.xhttpInboundId ||
      server.ip === HOSTKEY_ES_IP ||
      server.label.toLowerCase().includes("spain") ||
      server.label.toLowerCase() === "es";

    if (shouldMirrorXhttp) {
      tasks.push(
        ensureRemoteClient(
          server,
          {
            ...buildProvisionClientOptions(email.replace("@", ".x@"), options, clientId),
            flow: "",
          },
          server.xhttpInboundId || XHTTP_INBOUND_ID
        )
      );
    }
  }

  const results = await Promise.all(tasks);
  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    console.warn("[multi-server] Client mirror failures:", JSON.stringify(failures));
  }
  return results;
}

/**
 * Provision a new VLESS+REALITY user end-to-end.
 *
 * 1. Creates a client in 3X-UI (or finds existing one)
 * 2. Returns all subscription/deep links
 */
export async function provisionUser(
  email: string,
  options?: ProvisionUserOptions
): Promise<ProvisionedUser> {
  try {
    const totalGB = options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0;
    const expiryTime = options?.expiryDays ? daysFromNow(options.expiryDays) : 0;
    const limitIp = options?.maxConnections ?? 0;

    const { id: clientId, subId } = await addClient({
      email,
      totalGB,
      expiryTime,
      limitIp,
    });

    // Mirror to XHTTP inbound — same UUID, flow must be "" (not xtls-rprx-vision)
    await addClient({
      id: clientId,
      email: email.replace("@", ".x@"),
      flow: "",
      totalGB,
      expiryTime,
      limitIp,
    }, XHTTP_INBOUND_ID).catch(() => { /* non-fatal: XHTTP inbound may not exist yet */ });

    // Mirror to WebSocket inbound — same UUID, flow must be "" (WS doesn't use Vision)
    // 3X-UI requires panel-wide unique emails, so suffix with "-ws"
    await addClient({
      id: clientId,
      email: email + "-ws",
      flow: "",
      totalGB,
      expiryTime,
      limitIp,
    }, WS_INBOUND_ID).catch(() => { /* non-fatal: WS inbound may not exist yet */ });

    // Mirror to social-optimized inbound — same UUID, email +"-yt" suffix.
    // Server-side routing rules blackhole ad/tracker domains for this inbound's tag.
    await addClient({
      id: clientId,
      email: email + "-yt",
      flow: "",
      totalGB,
      expiryTime,
      limitIp,
    }, SOCIAL_INBOUND_ID).catch(() => { /* non-fatal: social inbound may not exist yet */ });

    await syncClientToSecondaryServers(email, clientId, subId, options);
    clearSubCache(email);

    const links = getAllClientLinks(clientId, subId, email);

    return {
      clientId,
      subId,
      email,
      vlessLink: links.vlessLink,
      subscriptionUrl: links.subscriptionUrl,
      v2raytunLink: links.v2raytun,
      v2rayngLink: links.v2rayng,
      hiddifyLink: links.hiddify,
    };
  } catch (err: any) {
    // If duplicate email, the user already has a client (most likely an
    // expired/disabled one from a previous subscription that the admin is
    // now reactivating). We MUST refresh expiry / re-enable / reset traffic
    // — otherwise the order looks active in Firestore but the user stays
    // expired or disabled on the VPN panel and cannot connect.
    if (err.message?.includes("Duplicate email")) {
      const existing = await findClientByEmail(email);
      if (existing) {
        const newExpiry = options?.expiryDays ? daysFromNow(options.expiryDays) : 0;
        const newTotal = options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0;
        const newLimitIp = options?.maxConnections ?? 0;

        const refreshUpdates: Partial<XuiClient> = {
          enable: true,
          expiryTime: newExpiry,
          totalGB: newTotal,
          limitIp: newLimitIp,
          reset: 0,
        };

        // Refresh on the main VLESS+REALITY inbound
        await updateClient(existing.id, refreshUpdates, DEFAULT_INBOUND_ID).catch(() => {
          /* ignore — we still want to return links so the user gets something */
        });

        // Mirror refresh across the other inbounds (XHTTP / WS / social).
        // Each mirror uses a suffixed email but the SAME UUID/clientId.
        await updateClient(existing.id, refreshUpdates, XHTTP_INBOUND_ID).catch(() => {});
        await updateClient(existing.id, refreshUpdates, WS_INBOUND_ID).catch(() => {});
        await updateClient(existing.id, refreshUpdates, SOCIAL_INBOUND_ID).catch(() => {});

        // Also reset traffic stats so the user starts fresh on the new period.
        // Mirror inbounds use suffixed emails (.x@, -ws, -yt) — reset those too.
        await resetClientTraffic(email, DEFAULT_INBOUND_ID).catch(() => {});
        await resetClientTraffic(email.replace("@", ".x@"), XHTTP_INBOUND_ID).catch(() => {});
        await resetClientTraffic(email + "-ws", WS_INBOUND_ID).catch(() => {});
        await resetClientTraffic(email + "-yt", SOCIAL_INBOUND_ID).catch(() => {});

        await syncClientToSecondaryServers(email, existing.id, existing.subId, options);
        clearSubCache(email);

        const links = getAllClientLinks(existing.id, existing.subId, email);
        return {
          clientId: existing.id,
          subId: existing.subId,
          email,
          vlessLink: links.vlessLink,
          subscriptionUrl: links.subscriptionUrl,
          v2raytunLink: links.v2raytun,
          v2rayngLink: links.v2rayng,
          hiddifyLink: links.hiddify,
        };
      }
    }
    throw err;
  }
}

/**
 * Find an existing client by email across all inbounds.
 */
async function findClientByEmail(
  email: string,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<{ id: string; subId: string } | null> {
  const inbound = await getInbound(inboundId);
  const settings = JSON.parse((inbound as any).settings || "{}");
  const clients: XuiClient[] = settings.clients || [];
  const match = clients.find((c) => c.email === email);
  if (!match) return null;
  return { id: match.id, subId: match.subId };
}
