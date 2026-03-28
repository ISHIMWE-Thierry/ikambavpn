/**
 * ResellPortal API client — VPN-related operations only.
 * Base URL: https://panel.resellportal.com/wp-json/resellportal/v1/
 * Auth: X-API-Key + X-API-Secret headers (from env variables)
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

// ── Balance ──────────────────────────────────────────────────────────────────

export interface BalanceResponse {
  balance: number;
  currency: string;
}

export function getBalance(): Promise<BalanceResponse> {
  return request<BalanceResponse>('/balance');
}

// ── Products ─────────────────────────────────────────────────────────────────

export interface ResellProduct {
  id: number;
  name: string;
  description: string;
  price: string;
  category: string;
  type: string;
  sub_type?: string;
}

export function getProducts(): Promise<ResellProduct[]> {
  return request<ResellProduct[]>('/products');
}

/** Returns only VPN-related products by filtering on category/type. */
export async function getVpnProducts(): Promise<ResellProduct[]> {
  const products = await getProducts();
  return products.filter((p) => {
    const cat = (p.category || '').toLowerCase();
    const type = (p.type || '').toLowerCase();
    const name = (p.name || '').toLowerCase();
    return cat.includes('vpn') || type.includes('vpn') || name.includes('vpn');
  });
}

// ── Clients ──────────────────────────────────────────────────────────────────

export interface ResellClient {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
}

export function getClients(): Promise<ResellClient[]> {
  return request<ResellClient[]>('/clients');
}

export async function getClientByEmail(email: string): Promise<ResellClient | null> {
  const clients = await getClients();
  return clients.find((c) => c.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export function createClient(data: {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
}): Promise<ResellClient> {
  return request<ResellClient>('/clients', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Orders ───────────────────────────────────────────────────────────────────

export interface ResellOrder {
  id: number;
  client_id: number;
  product_id: number;
  status: string;
  amount: string;
  created_at: string;
}

export function createOrder(data: {
  client_id: number;
  product_id: number;
  quantity?: number;
}): Promise<ResellOrder> {
  return request<ResellOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({ quantity: 1, ...data }),
  });
}

export function getOrder(orderId: number): Promise<ResellOrder> {
  return request<ResellOrder>(`/orders/${orderId}`);
}

// ── VPN order (trial and paid) ────────────────────────────────────────────────

export interface VpnOrderResponse {
  success: boolean;
  service_id: number;
  message?: string;
  billing_cycle?: string;
  amount_charged?: number;
  new_balance?: number;
  vpn_credentials?: {
    username: string;
    password: string;
    server?: string;
    server_address?: string;
  };
}

/**
 * Creates a VPN service order using the `vpn` product key.
 * Returns credentials immediately on success.
 */
export function createVpnOrder(clientId: number, billingCycle = 'monthly'): Promise<VpnOrderResponse> {
  return request<VpnOrderResponse>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      client_id: clientId,
      product_key: 'vpn',
      billing_cycle: billingCycle,
    }),
  });
}

// ── Services ─────────────────────────────────────────────────────────────────

export interface ResellService {
  id: number;
  client_id: number;
  product_id?: number;
  service_type?: string;
  status: string;
  username?: string;
  password?: string;
  expiry_date?: string;
  monthly_cost?: number;
}

export function getServices(clientId?: number): Promise<ResellService[]> {
  const query = clientId ? `?client_id=${clientId}` : '';
  return request<ResellService[]>(`/services${query}`);
}

export function getService(serviceId: number): Promise<ResellService> {
  return request<ResellService>(`/services/${serviceId}`);
}

/**
 * Terminates a service immediately via DELETE /services/{id}.
 * Used to deactivate expired trials.
 */
export async function cancelService(serviceId: number): Promise<void> {
  await request<unknown>(`/services/${serviceId}`, { method: 'DELETE' });
}
