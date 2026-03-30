/**
 * 3X-UI / VLESS+REALITY API client
 *
 * Frontend client that talks to our backend /xui routes.
 * Used alongside the existing vpnresellers-api.ts — does NOT replace it.
 *
 * The 3X-UI panel credentials stay server-side; the browser only sees
 * subscription links and client metadata.
 */

const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4000'
  : (import.meta.env.VITE_API_URL || 'https://194.76.217.4:4443');

async function xuiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  // Get Firebase ID token for auth
  const { auth } = await import('./firebase');
  const token = await auth.currentUser?.getIdToken();

  const res = await fetch(`${API_BASE}/xui${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `API error ${res.status}`);
  }

  const json = (await res.json()) as { ok: boolean; data: T; error?: string };
  if (!json.ok) throw new Error(json.error || 'Unknown error');
  return json.data;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface XuiProvisionResult {
  clientId: string;
  subId: string;
  email: string;
  vlessLink: string;
  subscriptionUrl: string;
  v2raytunLink: string;
  v2rayngLink: string;
  hiddifyLink: string;
}

export interface XuiClientLinks {
  vlessLink: string;
  subscriptionUrl: string;
  v2raytun: string;
  v2rayng: string;
  hiddify: string;
}

export interface XuiClientStat {
  email: string;
  upload: number;
  download: number;
  total: number;
  limit: number;
  enabled: boolean;
  expiryTime: number;
}

// ── User endpoints ────────────────────────────────────────────────────────────

/**
 * Provision a new VLESS+REALITY account for the current user.
 */
export async function provisionXuiAccount(options?: {
  email?: string;
  trafficLimitGB?: number;
  expiryDays?: number;
  maxConnections?: number;
}): Promise<XuiProvisionResult> {
  return xuiRequest<XuiProvisionResult>('/provision', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

/**
 * Get all connection links for a subscription ID.
 */
export async function getXuiLinks(subId: string): Promise<XuiClientLinks> {
  return xuiRequest<XuiClientLinks>(`/links/${subId}`);
}

/**
 * Get traffic stats for the current user's VLESS account.
 */
export async function getXuiStats(email: string): Promise<XuiClientStat> {
  return xuiRequest<XuiClientStat>(`/stats/${encodeURIComponent(email)}`);
}

// ── Admin endpoints ───────────────────────────────────────────────────────────

export interface XuiAdminClient {
  id: number;
  inboundId: number;
  enable: boolean;
  email: string;
  up: number;
  down: number;
  total: number;
  expiryTime: number;
  reset: number;
  uuid: string;
  subId: string;
  limitIp: number;
  subscriptionUrl: string;
  vlessLink: string;
}

export interface XuiSystemStatus {
  cpu: number;
  mem: { current: number; total: number };
  disk: { current: number; total: number };
  uptime: number;
  xray: { state: string; version: string };
}

/** List all VPN clients (admin) */
export async function getAdminClients(): Promise<XuiAdminClient[]> {
  return xuiRequest<XuiAdminClient[]>('/admin/clients');
}

/** Get server system status (admin) */
export async function getAdminServerStatus(): Promise<XuiSystemStatus> {
  return xuiRequest<XuiSystemStatus>('/admin/status');
}

/** Add a new VPN client (admin) */
export async function addAdminClient(options: {
  email: string;
  trafficLimitGB?: number;
  expiryDays?: number;
  maxConnections?: number;
}): Promise<XuiProvisionResult> {
  return xuiRequest<XuiProvisionResult>('/admin/add', {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

/** Enable a VPN client (admin) */
export async function enableAdminClient(clientId: string): Promise<void> {
  await xuiRequest<void>(`/admin/enable/${clientId}`, { method: 'POST' });
}

/** Disable a VPN client (admin) */
export async function disableAdminClient(clientId: string): Promise<void> {
  await xuiRequest<void>(`/admin/disable/${clientId}`, { method: 'POST' });
}

/** Delete a VPN client (admin) */
export async function deleteAdminClient(clientId: string): Promise<void> {
  await xuiRequest<void>(`/admin/delete/${clientId}`, { method: 'DELETE' });
}

/** Reset traffic for a VPN client (admin) */
export async function resetAdminClientTraffic(email: string): Promise<void> {
  await xuiRequest<void>(`/admin/reset-traffic/${encodeURIComponent(email)}`, { method: 'POST' });
}

/** Get all connection links for a client by email (admin) */
export async function getAdminClientLinks(email: string): Promise<XuiClientLinks> {
  return xuiRequest<XuiClientLinks>(`/links/${encodeURIComponent(email)}`);
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Format epoch ms to readable date or "Never" */
export function formatExpiry(epochMs: number): string {
  if (!epochMs || epochMs === 0) return 'Never';
  return new Date(epochMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
