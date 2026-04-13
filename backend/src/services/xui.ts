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
const REALITY_SNI = "www.microsoft.com";
const REALITY_FINGERPRINT = "chrome";
const VLESS_PORT = 443;

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

// Public-facing backend domain for subscription URLs (DuckDNS domain with valid TLS)
const BACKEND_DOMAIN = process.env.XPANEL_BACKEND_DOMAIN || "ikambavpn.duckdns.org";

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
  flow: string;        // "xtls-rprx-vision" for REALITY
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
  /** VLESS flow. Default "xtls-rprx-vision" for TCP, must be "" for XHTTP. */
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
    const inbounds = await listInbounds();
    let clientId = "";
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      const client = (settings.clients || []).find((c: any) => c.email === email);
      if (client) {
        clientId = client.id;
        break;
      }
    }
    if (!clientId) return null;

    const remark = `IkambaVPN-${email.split("@")[0]}`;

    // ── Multi-server subscription ─────────────────────────────────────────────
    // Generate links for ALL servers (primary + secondary) so users see
    // Helsinki, Frankfurt, etc. in their VPN app. Each server gets WS + REALITY.
    const allLinks = buildAllServerLinks(clientId, remark);
    const vlessLink = allLinks.join("\n");

    // Build user info
    let userInfo = "upload=0; download=0; total=0; expire=0";
    try {
      const stat = await getClientStatByEmail(email);
      if (stat) {
        const expireSec = stat.expiryTime ? Math.floor(stat.expiryTime / 1000) : 0;
        userInfo = `upload=${stat.up}; download=${stat.down}; total=${stat.total}; expire=${expireSec}`;
      }
    } catch { /* non-fatal */ }

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
 * Get list of currently online client emails from 3X-UI panel.
 * Uses POST /panel/api/inbounds/onlines — returns email[] of connected users.
 */
export async function getOnlineClients(): Promise<string[]> {
  try {
    const result = await apiRequest<string[]>("/panel/api/inbounds/onlines", {
      method: "POST",
    });
    return result || [];
  } catch {
    return [];
  }
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
  const logPath = "/var/log/xray/access.log";

  try {
    const raw = execSync(`tail -${maxLines} ${logPath} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });

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
  lastSeen: string | null;
  lastSeenAgo: string | null;
  sourceIps: string[];
  connectionCount: number;
  topDomains: { domain: string; count: number }[];
  inboundsUsed: string[];
  blockedCount: number;
}

/**
 * Check if a destination is "noise" — DNS queries, raw IPs, internal API, etc.
 * These pollute the activity logs and aren't real user-visited sites.
 */
export function isNoiseDest(dest: string, port: string): boolean {
  // DNS resolvers (port 53)
  if (port === "53") return true;
  // Raw IP addresses (no domain name)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(dest)) return true;
  // Localhost / internal API
  if (dest === "127.0.0.1" || dest === "localhost") return true;
  // Common DNS-over-HTTPS / resolver noise
  const dnsNoise = [
    "dns.google",
    "chrome.cloudflare-dns.com",
    "cloudflare-dns.com",
    "1.1.1.1",
    "8.8.8.8",
    "8.8.4.4",
    "77.88.8.8",
    "77.88.8.1",
    "dns.adguard.com",
    "dns.quad9.net",
    "doh.opendns.com",
  ];
  if (dnsNoise.includes(dest.toLowerCase())) return true;
  return false;
}

/**
 * Build an activity summary for all users from access logs + online status.
 */
export async function getUserActivitySummaries(): Promise<UserActivitySummary[]> {
  const [onlineEmails, connections] = await Promise.all([
    getOnlineClients(),
    getRecentConnections(2000),
  ]);

  const onlineSet = new Set(onlineEmails);

  // Group connections by email — filter out internal API calls (no email)
  const byUser = new Map<string, ConnectionLogEntry[]>();
  for (const conn of connections) {
    if (!byUser.has(conn.email)) byUser.set(conn.email, []);
    byUser.get(conn.email)!.push(conn);
  }

  // Build summaries
  const summaries: UserActivitySummary[] = [];

  // Include ALL emails — both those in logs AND those currently online
  const allEmails = new Set([...byUser.keys(), ...onlineEmails]);

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
      isOnline: onlineSet.has(email),
      lastSeen,
      lastSeenAgo: onlineSet.has(email) ? "now" : lastSeenAgo,
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

/**
 * Add a new client to an inbound.
 * Returns the client UUID and subscription token.
 */
export async function addClient(
  opts: XuiCreateClientOptions,
  inboundId: number = DEFAULT_INBOUND_ID
): Promise<{ id: string; subId: string; email: string }> {
  const clientId = opts.id ?? randomUUID();
  const subId = genSubId();

  const client: XuiClient = {
    id: clientId,
    email: opts.email,
    enable: true,
    flow: opts.flow !== undefined ? opts.flow : "xtls-rprx-vision",
    totalGB: opts.totalGB ?? 0,
    expiryTime: opts.expiryTime ?? 0,
    subId,
    limitIp: opts.limitIp ?? 0, // 0 = unlimited IPs — prevents VPN disconnects under heavy use
    tgId: opts.tgId ?? "",
    reset: 0,
  };

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

  return { id: clientId, subId, email: opts.email };
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
    `sni=${REALITY_SNI}`,
    `sid=${REALITY_SHORT_ID}`,
    `spx=/`,
    `flow=xtls-rprx-vision`,
  ].join("&");

  return `vless://${clientId}@${VPS_IP}:${VLESS_PORT}?${query}#${encodeURIComponent(remark)}`;
}

/**
 * Build a VLESS+XHTTP+REALITY link for the anti-DPI fallback inbound (port 8443).
 * Same REALITY keys as the TCP inbound — just a different transport.
 */
export function buildXhttpLink(clientId: string, remark: string): string {
  const query = [
    `type=xhttp`,
    `security=reality`,
    `pbk=${REALITY_PUBLIC_KEY}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${REALITY_SNI}`,
    `sid=${REALITY_SHORT_ID}`,
    `path=${XHTTP_PATH}`,
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

  return `vless://${clientId}@${VPS_IP}:${WS_PORT}?${query}#${encodeURIComponent(remark + "-WS")}`;
}

// ── Multi-Server Link Builders ────────────────────────────────────────────────
// These variants accept a ServerConfig so we can generate links for any server,
// not just the one this backend instance is running on.

/**
 * Build a VLESS+REALITY link for a specific server.
 * The remark includes the server location so users see e.g. "IkambaVPN-user-Helsinki"
 */
export function buildVlessLinkForServer(clientId: string, remark: string, server: ServerConfig): string {
  const query = [
    `type=tcp`,
    `security=reality`,
    `pbk=${server.realityPubKey}`,
    `fp=${REALITY_FINGERPRINT}`,
    `sni=${server.realitySni || REALITY_SNI}`,
    `sid=${server.realityShortId}`,
    `spx=/`,
    `flow=xtls-rprx-vision`,
  ].join("&");

  const port = server.vlessPort || VLESS_PORT;
  return `vless://${clientId}@${server.ip}:${port}?${query}#${encodeURIComponent(remark + "-" + server.label)}`;
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
 * Generate ALL VLESS links for a client across ALL servers.
 * Returns an array of link strings — WS first per server, then REALITY TCP.
 * Order: [WS-Server1, REALITY-Server1, WS-Server2, REALITY-Server2, ...]
 */
export function buildAllServerLinks(clientId: string, remark: string): string[] {
  const servers = getAllServers();
  const links: string[] = [];

  for (const server of servers) {
    // WS first (primary), then REALITY TCP (backup) for each server
    links.push(buildWsLinkForServer(clientId, remark, server));
    if (server.realityPubKey && server.realityShortId) {
      links.push(buildVlessLinkForServer(clientId, remark, server));
    }
  }

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
  // Self-hosted subscription endpoint — uses DuckDNS domain for proper TLS cert
  const selfHostedSubUrl = `https://${BACKEND_DOMAIN}:4443/xui-public/sub/${encodeURIComponent(email)}`;
  return {
    vlessLink: wsLink, // WS is now the default/primary link
    vlessTcpLink: vlessLink, // TCP REALITY kept as backup
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

/**
 * Provision a new VLESS+REALITY user end-to-end.
 *
 * 1. Creates a client in 3X-UI (or finds existing one)
 * 2. Returns all subscription/deep links
 */
export async function provisionUser(
  email: string,
  options?: {
    trafficLimitGB?: number;
    expiryDays?: number;
    maxConnections?: number;
  }
): Promise<ProvisionedUser> {
  try {
    const { id: clientId, subId } = await addClient({
      email,
      totalGB: options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0,
      expiryTime: options?.expiryDays ? daysFromNow(options.expiryDays) : 0,
      limitIp: options?.maxConnections ?? 0,
    });

    // Mirror to XHTTP inbound — same UUID, flow must be "" (not xtls-rprx-vision)
    await addClient({
      id: clientId,
      email: email.replace("@", ".x@"),
      flow: "",
      totalGB: options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0,
      expiryTime: options?.expiryDays ? daysFromNow(options.expiryDays) : 0,
      limitIp: options?.maxConnections ?? 0,
    }, XHTTP_INBOUND_ID).catch(() => { /* non-fatal: XHTTP inbound may not exist yet */ });

    // Mirror to WebSocket inbound — same UUID, flow must be "" (WS doesn't use Vision)
    await addClient({
      id: clientId,
      email,
      flow: "",
      totalGB: options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0,
      expiryTime: options?.expiryDays ? daysFromNow(options.expiryDays) : 0,
      limitIp: options?.maxConnections ?? 0,
    }, WS_INBOUND_ID).catch(() => { /* non-fatal: WS inbound may not exist yet */ });

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
    // If duplicate email, find the existing client and return their links
    if (err.message?.includes("Duplicate email")) {
      const existing = await findClientByEmail(email);
      if (existing) {
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
