/**
 * YooKassa (YooMoney) Payment Gateway Service
 *
 * Integrates with the YooKassa API v3 for processing payments in RUB.
 * Russian users can pay via bank cards (Visa/Mastercard/Mir), SBP, YooMoney wallet, etc.
 *
 * API docs: https://yookassa.ru/developers/api
 * Endpoint: https://api.yookassa.ru/v3/
 * Auth: HTTP Basic (shopId:secretKey)
 *
 * Flow:
 *  1. Frontend calls POST /xui/payment/create with planId + orderId
 *  2. Backend creates a YooKassa payment → returns confirmation_url
 *  3. Frontend redirects user to YooKassa hosted payment page
 *  4. User pays → YooKassa sends webhook to POST /xui-public/yookassa-webhook
 *  5. Backend verifies payment, auto-activates VPN subscription
 *  6. User returns to our site → sees "Payment successful"
 */

import { randomUUID } from "crypto";

// ── Configuration ─────────────────────────────────────────────────────────────

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID || "";
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY || "";
const YOOKASSA_API = "https://api.yookassa.ru/v3";

// Return URL after payment — user comes back here
const RETURN_URL = process.env.YOOKASSA_RETURN_URL || "https://ikambavpn.com/dashboard?payment=success";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface YooKassaAmount {
  value: string;   // "99.00"
  currency: string; // "RUB"
}

export interface YooKassaPayment {
  id: string;
  status: "pending" | "waiting_for_capture" | "succeeded" | "canceled";
  amount: YooKassaAmount;
  description?: string;
  confirmation?: {
    type: string;
    confirmation_url?: string;
  };
  metadata?: Record<string, string>;
  paid: boolean;
  created_at: string;
  expires_at?: string;
}

export interface CreatePaymentParams {
  /** Amount in RUB (e.g. 79) */
  amount: number;
  /** Currency (default: RUB) */
  currency?: string;
  /** Description shown to user on payment page */
  description: string;
  /** Our internal order ID — stored in metadata for webhook lookup */
  orderId: string;
  /** User email for receipt */
  userEmail?: string;
  /** Plan ID for metadata */
  planId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader(): string {
  return "Basic " + Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString("base64");
}

/**
 * Check if YooKassa is configured.
 */
export function isYooKassaConfigured(): boolean {
  return !!(YOOKASSA_SHOP_ID && YOOKASSA_SECRET_KEY);
}

// ── API Methods ───────────────────────────────────────────────────────────────

/**
 * Create a payment on YooKassa.
 * Returns the payment object with a confirmation_url the user must be redirected to.
 *
 * Uses the "redirect" confirmation type — simplest flow, works with all payment methods.
 */
export async function createPayment(params: CreatePaymentParams): Promise<YooKassaPayment> {
  if (!isYooKassaConfigured()) {
    throw new Error("YooKassa is not configured (missing YOOKASSA_SHOP_ID or YOOKASSA_SECRET_KEY)");
  }

  const idempotenceKey = randomUUID();

  const body = {
    amount: {
      value: params.amount.toFixed(2),
      currency: params.currency || "RUB",
    },
    confirmation: {
      type: "redirect",
      return_url: RETURN_URL,
    },
    capture: true, // Auto-capture — no need for two-step capture
    description: params.description,
    metadata: {
      order_id: params.orderId,
      plan_id: params.planId || "",
      user_email: params.userEmail || "",
    },
    receipt: params.userEmail ? {
      customer: {
        email: params.userEmail,
      },
      items: [
        {
          description: params.description,
          quantity: "1",
          amount: {
            value: params.amount.toFixed(2),
            currency: params.currency || "RUB",
          },
          vat_code: 1, // No VAT (for individual entrepreneur / simplified tax)
        },
      ],
    } : undefined,
  };

  const res = await fetch(`${YOOKASSA_API}/payments`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Idempotence-Key": idempotenceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[yookassa] Payment creation failed: ${res.status}`, errorText);
    throw new Error(`YooKassa API error ${res.status}: ${errorText}`);
  }

  const payment = (await res.json()) as YooKassaPayment;
  console.log(`[yookassa] Payment created: ${payment.id}, status: ${payment.status}, order: ${params.orderId}`);
  return payment;
}

/**
 * Get payment status from YooKassa.
 * Used to verify payment status after webhook or when user returns.
 */
export async function getPayment(paymentId: string): Promise<YooKassaPayment> {
  if (!isYooKassaConfigured()) {
    throw new Error("YooKassa is not configured");
  }

  const res = await fetch(`${YOOKASSA_API}/payments/${paymentId}`, {
    method: "GET",
    headers: {
      Authorization: authHeader(),
    },
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`YooKassa API error ${res.status}: ${errorText}`);
  }

  return (await res.json()) as YooKassaPayment;
}

/**
 * Verify a webhook notification from YooKassa.
 *
 * YooKassa sends POST with JSON body containing the payment object.
 * The webhook comes from YooKassa's IP range — we verify by:
 *  1. Checking the payment ID exists in our system
 *  2. Re-fetching the payment from YooKassa API to confirm status
 *     (this is the most reliable verification — don't trust webhook body alone)
 */
export async function verifyWebhookPayment(paymentId: string): Promise<YooKassaPayment> {
  // Always re-fetch from YooKassa API — never trust the webhook body alone
  return getPayment(paymentId);
}
