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
 * Build the subscription URL for a client.
 * This URL auto-refreshes configs when the user reconnects.
 */
export function getSubscriptionUrl(subId: string): string {
  return `${SUB_BASE}/${subId}`;
}

/**
 * Build a V2RayTun deep link that auto-imports the subscription.
 * iOS users tap this → V2RayTun app opens → subscription imported.
 */
export function getV2RayTunDeepLink(subId: string): string {
  const subUrl = getSubscriptionUrl(subId);
  return `v2raytun://import/${subUrl}`;
}

/**
 * Build a V2RayNG deep link for Android.
 */
export function getV2RayNGDeepLink(subId: string): string {
  const subUrl = getSubscriptionUrl(subId);
  return `v2rayng://install-sub?url=${encodeURIComponent(subUrl)}`;
}

/**
 * Build a Hiddify deep link for Android.
 */
export function getHiddifyDeepLink(subId: string): string {
  const subUrl = getSubscriptionUrl(subId);
  return `hiddify://import/${subUrl}`;
}

/**
 * Get all connection links for a client.
 */
export function getAllClientLinks(subId: string) {
  return {
    subscriptionUrl: getSubscriptionUrl(subId),
    v2raytun: getV2RayTunDeepLink(subId),
    v2rayng: getV2RayNGDeepLink(subId),
    hiddify: getHiddifyDeepLink(subId),
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
  return apiRequest<XuiSystemStatus>("/server/status");
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
  subscriptionUrl: string;
  v2raytunLink: string;
  v2rayngLink: string;
  hiddifyLink: string;
}

/**
 * Provision a new VLESS+REALITY user end-to-end.
 *
 * 1. Creates a client in 3X-UI
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
  const { id: clientId, subId } = await addClient({
    email,
    totalGB: options?.trafficLimitGB ? GB(options.trafficLimitGB) : 0,
    expiryTime: options?.expiryDays ? daysFromNow(options.expiryDays) : 0,
    limitIp: options?.maxConnections ?? 3,
  });

  const links = getAllClientLinks(subId);

  return {
    clientId,
    subId,
    email,
    subscriptionUrl: links.subscriptionUrl,
    v2raytunLink: links.v2raytun,
    v2rayngLink: links.v2rayng,
    hiddifyLink: links.hiddify,
  };
}
