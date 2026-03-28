/**
 * ResellPortal API client
 * Base URL: https://panel.resellportal.com/wp-json/resellportal/v1/
 * Auth: X-API-Key + X-API-Secret headers
 *
 * All responses are wrapped: { success: true, <key>: ... }
 */

const BASE_URL = import.meta.env.VITE_RESELL_API_BASE || 'https://panel.resellportal.com/wp-json/resellportal/v1';
const API_KEY = import.meta.env.VITE_RESELL_API_KEY || '';
const API_SECRET = import.meta.env.VITE_RESELL_API_SECRET || '';

const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
  'X-API-Secret': API_SECRET,
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Balance ───────────────────────────────────────────────────────────────────

export interface BalanceResponse {
  balance: number;
  currency: string;
}

export async function getBalance(): Promise<BalanceResponse> {
  const r = await request<{ success: boolean; balance: number; currency: string }>('/balance');
  return { balance: r.balance, currency: r.currency };
}

// ── Products ──────────────────────────────────────────────────────────────────

export interface ResellProduct {
  key: string;
  name: string;
  cost: number;
  billing_cycle: string;
}

export async function getProducts(): Promise<ResellProduct[]> {
  const r = await request<{ success: boolean; products: ResellProduct[] }>('/products');
  return r.products ?? [];
}

// ── Clients ───────────────────────────────────────────────────────────────────

export interface ResellClient {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

export async function getClients(): Promise<ResellClient[]> {
  const r = await request<{ success: boolean; clients: ResellClient[] }>('/clients');
  return r.clients ?? [];
}

export async function getClientByEmail(email: string): Promise<ResellClient | null> {
  const clients = await getClients();
  return clients.find((c) => c.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export interface ResellClientDetail extends ResellClient {
  phone?: string;
  company?: string;
  active_services: number;
  total_services: number;
}

export async function getClientById(clientId: number): Promise<ResellClientDetail> {
  const r = await request<{ success: boolean; client: ResellClientDetail }>(`/clients/${clientId}`);
  return r.client;
}

/**
 * Creates a client. Returns the new client_id.
 * Request: { name, email, phone?, company? }
 * Response: { success, client_id, message }
 */
export async function createClient(data: {
  name: string;
  email: string;
  phone?: string;
}): Promise<number> {
  const r = await request<{ success: boolean; client_id: number; message?: string }>('/clients', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!r.success || !r.client_id) {
    throw new Error(r.message || 'Failed to create client');
  }
  return r.client_id;
}

// ── Services ──────────────────────────────────────────────────────────────────

export interface ResellService {
  id: number;
  client_id: number;
  service_type?: string;
  status: string;
  billing_cycle?: string;
  monthly_cost?: number;
  next_billing_date?: string;
  deployment_status?: string;
  service_data?: Record<string, string>;
}

export async function getServices(clientId?: number): Promise<ResellService[]> {
  // API only supports ?status=active, not ?client_id — filter in JS
  const r = await request<{ success: boolean; services: ResellService[] }>('/services?status=active');
  const all = r.services ?? [];
  return clientId ? all.filter((s) => Number(s.client_id) === Number(clientId)) : all;
}

export async function getService(serviceId: number): Promise<ResellService> {
  const r = await request<{ success: boolean; service: ResellService }>(`/services/${serviceId}`);
  return r.service;
}

/**
 * Terminates a service via DELETE /services/{id}.
 * Used to deactivate expired trials.
 */
export async function cancelService(serviceId: number): Promise<void> {
  await request<unknown>(`/services/${serviceId}`, { method: 'DELETE' });
}

// ── VPN order ─────────────────────────────────────────────────────────────────

export interface VpnOrderResponse {
  success: boolean;
  service_id: number;
  message?: string;
  amount_charged?: number;
  new_balance?: number;
  vpn_credentials?: {
    username?: string;
    password?: string;
  };
}

/**
 * Creates a VPN order for a client.
 * POST /orders { client_id, product_key: "vpn", billing_cycle }
 */
export function createVpnOrder(
  clientId: number,
  billingCycle = 'monthly',
  vpnUsername?: string
): Promise<VpnOrderResponse> {
  const body: Record<string, unknown> = {
    client_id: clientId,
    product_key: 'vpn',
    billing_cycle: billingCycle,
  };
  if (vpnUsername) body.vpn_username = vpnUsername;
  return request<VpnOrderResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
