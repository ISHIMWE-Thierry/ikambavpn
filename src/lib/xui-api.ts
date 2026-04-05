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
  : (import.meta.env.VITE_API_URL || 'https://ikambavpn.duckdns.org:4443');

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

// ── Public endpoints (no auth) ────────────────────────────────────────────────

/**
 * Check whether the VPN server / Xray process is online.
 * Calls the public /xui-public/health endpoint — no login required.
 * Returns { online, latencyMs }.
 */
export async function checkVpnServerHealth(): Promise<{ online: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${API_BASE}/xui-public/health`, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) return { online: false, latencyMs };
    const json = await res.json() as { online?: boolean };
    return { online: json.online ?? false, latencyMs };
  } catch {
    return { online: false, latencyMs: Date.now() - start };
  }
}

/**
 * Run a full connection diagnostic.
 * Calls /xui-public/diagnose (no auth) and also runs client-side checks.
 * Returns a structured result that tells users exactly where the problem is.
 */
export interface DiagnosticResult {
  // Client-side checks
  browserOnline: boolean;
  canReachApi: boolean;
  apiLatencyMs: number;
  // Server-side checks (from /diagnose endpoint)
  xrayRunning: boolean;
  xrayState: string;
  panelReachable: boolean;
  serverCpu: number;
  serverMemPct: number;
  // Overall
  verdict: string;
  suggestion: string;
  userIp: string;
}

export async function runDiagnostics(): Promise<DiagnosticResult> {
  const result: DiagnosticResult = {
    browserOnline: navigator.onLine,
    canReachApi: false,
    apiLatencyMs: 0,
    xrayRunning: false,
    xrayState: 'unknown',
    panelReachable: false,
    serverCpu: 0,
    serverMemPct: 0,
    verdict: '',
    suggestion: '',
    userIp: '',
  };

  // Check 1: Is the browser even online?
  if (!navigator.onLine) {
    result.verdict = '❌ Your device is offline.';
    result.suggestion =
      'You have no internet connection. Check your Wi-Fi or mobile data, ' +
      'then try again. This is NOT a VPN problem — your device cannot reach the internet at all.';
    return result;
  }

  // Check 2: Can we reach our API?
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${API_BASE}/xui-public/diagnose`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    result.apiLatencyMs = Date.now() - start;

    if (res.ok) {
      result.canReachApi = true;
      const data = await res.json();
      result.xrayRunning = data.xrayRunning ?? false;
      result.xrayState = data.xrayState ?? 'unknown';
      result.panelReachable = data.panelReachable ?? false;
      result.serverCpu = data.serverCpu ?? 0;
      result.serverMemPct = data.serverMemPct ?? 0;
      result.verdict = data.verdict ?? '';
      result.suggestion = data.suggestion ?? '';
      result.userIp = data.userIp ?? '';
    } else {
      result.canReachApi = true; // We got a response, just not 200
      result.verdict = '⚠️ Our API responded with an error.';
      result.suggestion = 'The server is reachable but returned an error. Try again in a few minutes.';
    }
  } catch {
    result.apiLatencyMs = Date.now() - start;
    result.canReachApi = false;

    // Can't reach our API — but is the user's internet working?
    // Try fetching a well-known public endpoint
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 5000);
      await fetch('https://www.google.com/generate_204', {
        mode: 'no-cors',
        signal: controller2.signal,
      });
      clearTimeout(timer2);
      // Google is reachable but our API isn't
      result.verdict = '⚠️ Your internet works, but our VPN server is unreachable.';
      result.suggestion =
        'Your internet connection is fine — the problem is on our end. ' +
        'Our server may be down for maintenance or the IP might be blocked in your country. ' +
        'Try again in 5-10 minutes. If it persists, contact support.';
    } catch {
      // Can't reach Google either
      result.verdict = '❌ Your internet connection is unstable.';
      result.suggestion =
        'Your device says it\'s online, but cannot reach external servers. ' +
        'This is a problem with YOUR connection, not our VPN. ' +
        'Try: switch between Wi-Fi and mobile data, restart your router, ' +
        'or move to a location with better signal.';
    }
  }

  // Add latency warning
  if (result.canReachApi && result.apiLatencyMs > 3000) {
    result.suggestion += ' ⚠️ Your connection to our server is very slow (' +
      result.apiLatencyMs + 'ms). This may cause the VPN to disconnect frequently.';
  }

  return result;
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
 * Uses the public endpoint — no auth token required.
 */
export async function getXuiStats(email: string): Promise<XuiClientStat> {
  const res = await fetch(`${API_BASE}/xui-public/stats/${encodeURIComponent(email)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `API error ${res.status}`);
  }
  const json = (await res.json()) as { ok: boolean; data: XuiClientStat };
  if (!json.ok) throw new Error('Stats unavailable');
  return json.data;
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
export async function enableAdminClient(clientId: string, email?: string): Promise<void> {
  await xuiRequest<void>(`/admin/enable/${clientId}`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Disable a VPN client (admin) */
export async function disableAdminClient(clientId: string, email?: string): Promise<void> {
  await xuiRequest<void>(`/admin/disable/${clientId}`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/** Delete a VPN client (admin) */
export async function deleteAdminClient(clientId: string): Promise<void> {
  await xuiRequest<void>(`/admin/delete/${clientId}`, { method: 'DELETE' });
}

/** Reset traffic for a VPN client (admin) */
export async function resetAdminClientTraffic(email: string): Promise<void> {
  await xuiRequest<void>(`/admin/reset-traffic/${encodeURIComponent(email)}`, { method: 'POST' });
}

/**
 * Update a VPN client's expiry, traffic limit, or connection limit (admin).
 * Also flushes the subscription cache so V2RayTun picks up changes immediately.
 */
export async function updateAdminClient(
  clientId: string,
  updates: {
    expiryTime?: number;
    totalGB?: number;
    limitIp?: number;
    enable?: boolean;
    email?: string;
  }
): Promise<void> {
  await xuiRequest<void>(`/admin/update/${clientId}`, {
    method: 'POST',
    body: JSON.stringify(updates),
  });
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
