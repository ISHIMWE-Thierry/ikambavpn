/**
 * VPNresellers API client v3.2
 *
 * All requests are routed through /vpnr-api (Firebase Hosting rewrite →
 * Cloud Function proxy) to avoid CORS issues. The token lives server-side
 * in a Firebase Secret — it is never sent to the browser.
 */

// In dev Vite proxies /vpnr-api → function emulator; in prod call the Cloud Function directly
// (ikambavpn.com is on Railway, not Firebase Hosting, so rewrites don't apply).
const PROXY_BASE = import.meta.env.DEV
  ? '/vpnr-api'
  : 'https://us-central1-ikamba-1c669.cloudfunctions.net/vpnrProxy';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  // Pass the upstream path as a query param so the function knows where to forward
  const url = `${PROXY_BASE}?path=${encodeURIComponent(path)}`;

  const res = await fetch(url, {
    ...options,
    method,
    headers: {
      'Accept': 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string; errors?: unknown };
    throw new Error(data.message || `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VpnrAccount {
  id: number;
  username: string;
  status: 'Active' | 'Disabled';
  wg_ip: string;
  wg_private_key: string;
  wg_public_key: string;
  expired_at: string | null;
  updated: string;
  created: string;
}

export interface VpnrServer {
  id: number;
  name: string;
  ip: string;
  country_code: string;
  city: string;
  capacity: number;
  wg_public_key?: string;      // Server WireGuard public key (for .conf generation)
  l2tp_pre_shared_key?: string; // L2TP/IPSec pre-shared key (typically "vpnresellers")
}

// ── Accounts ──────────────────────────────────────────────────────────────────

/** Check if username is available. Returns true if available. */
export async function checkUsername(username: string): Promise<boolean> {
  try {
    await request<{ data: { message: string } }>(
      `/accounts/check_username?username=${encodeURIComponent(username)}`
    );
    return true;
  } catch {
    return false;
  }
}

/** List all accounts (paginated). */
export async function listAccounts(params?: {
  per_page?: number;
  page?: number;
  status?: 'Active' | 'Disabled';
}): Promise<VpnrAccount[]> {
  const q = new URLSearchParams();
  if (params?.per_page) q.set('per_page', String(params.per_page));
  if (params?.page) q.set('page', String(params.page));
  if (params?.status) q.set('status', params.status);
  const qs = q.toString() ? `?${q.toString()}` : '';
  const r = await request<{ data: VpnrAccount[] }>(`/accounts${qs}`);
  return r.data ?? [];
}

/** Get a single account by ID. */
export async function getAccount(id: number): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>(`/accounts/${id}`);
  return r.data;
}

/** Find an account by username (searches first page, up to 100). */
export async function getAccountByUsername(username: string): Promise<VpnrAccount | null> {
  const accounts = await listAccounts({ per_page: 100 });
  return accounts.find((a) => a.username.toLowerCase() === username.toLowerCase()) ?? null;
}

/**
 * Create a VPN account.
 * username: alpha-numeric + dashes/underscores/dots/@, 3–50 chars.
 * password: 3–50 chars.
 */
export async function createAccount(username: string, password: string): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>('/accounts', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  return r.data;
}

/** Delete an account permanently. */
export async function deleteAccount(id: number): Promise<void> {
  await request<unknown>(`/accounts/${id}`, { method: 'DELETE' });
}

/** Enable a disabled account. */
export async function enableAccount(id: number): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>(`/accounts/${id}/enable`, { method: 'PUT' });
  return r.data;
}

/** Disable an account (keeps it in DB — used for trial expiry). */
export async function disableAccount(id: number): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>(`/accounts/${id}/disable`, { method: 'PUT' });
  return r.data;
}

/** Set or clear expiry date (null = auto-renewal). */
export async function setExpiry(id: number, expireAt: string | null): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>(`/accounts/${id}/expire`, {
    method: 'PUT',
    body: JSON.stringify({ expire_at: expireAt }),
  });
  return r.data;
}

/**
 * Validate VPN credentials — use this to check if a user's subscription/trial is still active.
 *   const { success } = await validateAccount(username, password);
 * Returns success=true (200), false on wrong password (461) or not found (460).
 */
export async function validateAccount(
  username: string,
  password: string
): Promise<{ success: boolean; id?: number }> {
  try {
    const r = await request<{ success: boolean; id?: number; code?: number }>(
      '/accounts/validate',
      { method: 'POST', body: JSON.stringify({ username, password }) }
    );
    return { success: r.success === true, id: r.id };
  } catch {
    return { success: false };
  }
}

/** Change account password. */
export async function changePassword(id: number, password: string): Promise<VpnrAccount> {
  const r = await request<{ data: VpnrAccount }>(`/accounts/${id}/change_password`, {
    method: 'PUT',
    body: JSON.stringify({ password }),
  });
  return r.data;
}

// ── Servers ───────────────────────────────────────────────────────────────────

export async function listServers(): Promise<VpnrServer[]> {
  const r = await request<{ data: VpnrServer[] }>('/servers');
  return r.data ?? [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Derive a valid VPNresellers username from an email address. */
export function usernameFromEmail(email: string): string {
  const base = email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9._@-]/g, '')
    .slice(0, 40);
  return base.length >= 3 ? base : `${base}vpn`;
}

/** Generate a random password (12 chars, alpha-numeric). */
export function generatePassword(): string {
  return (
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8)
  ).slice(0, 12);
}

/**
 * Find or create a VPNresellers account for a user.
 * Tries the base username first; appends a short suffix if taken.
 * Returns { account, password } — password is only meaningful on create.
 */
export async function findOrCreateAccount(
  email: string,
  preferredUsername?: string
): Promise<{ account: VpnrAccount; password: string; isNew: boolean }> {
  const base = preferredUsername ?? usernameFromEmail(email);
  const password = generatePassword();

  // Try base username, then base+4 random chars if taken
  const candidates = [base, `${base}${Math.random().toString(36).slice(2, 6)}`];

  for (const username of candidates) {
    const available = await checkUsername(username);
    if (available) {
      const account = await createAccount(username, password);
      return { account, password, isNew: true };
    }
  }

  // Both taken — account likely already exists; find it
  const existing = await getAccountByUsername(base);
  if (existing) return { account: existing, password: '', isNew: false };

  // Last resort: force unique username with timestamp suffix
  const ts = Date.now().toString(36).slice(-4);
  const account = await createAccount(`${base}${ts}`, password);
  return { account, password, isNew: true };
}
