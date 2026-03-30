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

// HTTPS agent that tolerates IP-based or short-lived certs
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

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
  /** Max concurrent connections. Default 3. */
  limitIp?: number;
  /** Telegram user ID for notifications. Default empty. */
  tgId?: string;
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
    const vlessLink = buildVlessLink(clientId, remark);

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
  const clientId = randomUUID();
  const subId = genSubId();

  const client: XuiClient = {
    id: clientId,
    email: opts.email,
    enable: true,
    flow: "xtls-rprx-vision",
    totalGB: opts.totalGB ?? 0,
    expiryTime: opts.expiryTime ?? 0,
    subId,
    limitIp: opts.limitIp ?? 3,
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
 */
export function getAllClientLinks(clientId: string, subId: string, email: string) {
  const remark = `IkambaVPN-${email.split("@")[0]}`;
  const vlessLink = buildVlessLink(clientId, remark);
  // Self-hosted subscription endpoint that returns base64-encoded VLESS config
  const selfHostedSubUrl = `https://${VPS_IP}:4443/xui-public/sub/${encodeURIComponent(email)}`;
  return {
    vlessLink,
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
      limitIp: options?.maxConnections ?? 3,
    });

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
