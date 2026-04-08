/**
 * PayGate.to — Payment Gateway integration
 *
 * API flow:
 *  1.  Generate temporary encrypted wallet via GET wallet.php
 *  2.  Redirect customer to checkout.paygate.to/pay.php with encrypted wallet + amount
 *  3.  PayGate hits our callback URL when payment is received
 *  4.  Client polls payment-status.php to confirm payment
 *
 * Docs: https://documenter.getpostman.com/view/14826208/2sA3Bj9aBi
 */

const API_BASE = 'https://api.paygate.to';
const CHECKOUT_DOMAIN = 'checkout.paygate.to';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PayGateWallet {
  /** Encrypted wallet address for the payment link */
  address_in: string;
  /** Polygon address for tracking */
  polygon_address_in: string;
  /** Callback URL that was registered */
  callback_url: string;
  /** IPN token for checking payment status */
  ipn_token?: string;
}

export interface PayGateConversion {
  /** Converted USD amount */
  value_coin: string;
  /** Original value */
  original_value?: string;
  /** Source currency */
  from?: string;
}

export interface PayGatePaymentStatus {
  /** 'paid' or 'unpaid' */
  status: string;
  /** Amount received */
  value_coin?: string;
  /** Transaction ID */
  txid_out?: string;
}

// ── Wallet generation ─────────────────────────────────────────────────────────

/**
 * Step 1: Generate a temporary encrypted wallet address.
 *
 * @param merchantWallet  Your USDC (Polygon) wallet address to receive payouts
 * @param callbackUrl     URL PayGate will hit when payment is received
 * @returns               Encrypted wallet details
 */
export async function generateWallet(
  merchantWallet: string,
  callbackUrl: string,
): Promise<PayGateWallet> {
  const url = `${API_BASE}/control/wallet.php?address=${encodeURIComponent(merchantWallet)}&callback=${encodeURIComponent(callbackUrl)}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`PayGate wallet.php returned ${res.status}`);

  const data = await res.json();
  if (!data?.address_in) throw new Error('PayGate wallet.php returned no address_in');

  return {
    address_in: data.address_in,
    polygon_address_in: data.polygon_address_in || data.address_in,
    callback_url: data.callback_url || callbackUrl,
    ipn_token: data.ipn_token,
  };
}

// ── Payment URL ───────────────────────────────────────────────────────────────

/**
 * Step 2: Build the redirect URL that sends the customer to the PayGate checkout.
 *
 * @param encryptedAddress  The address_in from generateWallet()
 * @param amountUsd         Amount in USD (PayGate works in USD)
 * @param email             Customer email (optional but helpful)
 * @param currency          Display currency on checkout page (default: USD)
 */
export function buildPaymentUrl(
  encryptedAddress: string,
  amountUsd: number,
  email?: string,
  currency = 'USD',
): string {
  const params = new URLSearchParams({
    address: encryptedAddress,
    amount: amountUsd.toFixed(2),
    currency,
  });
  if (email) params.set('email', email);
  return `https://${CHECKOUT_DOMAIN}/pay.php?${params.toString()}`;
}

// ── Currency conversion ───────────────────────────────────────────────────────

/**
 * Convert a value from a given currency to USD using PayGate's exchange rate.
 *
 * @param value   Amount in source currency
 * @param from    Source currency code (e.g. 'RUB', 'EUR')
 * @returns       Equivalent amount in USD
 */
export async function convertToUsd(value: number, from: string): Promise<number> {
  if (from.toUpperCase() === 'USD') return value;

  const url = `${API_BASE}/control/convert.php?value=${value}&from=${encodeURIComponent(from.toLowerCase())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PayGate convert.php returned ${res.status}`);

  const data: PayGateConversion = await res.json();
  const usd = parseFloat(data.value_coin);
  if (isNaN(usd) || usd <= 0) throw new Error('PayGate currency conversion failed');

  return usd;
}

// ── Payment status polling ────────────────────────────────────────────────────

/**
 * Check whether a payment has been received.
 *
 * @param ipnToken  The IPN token returned by wallet.php
 */
export async function checkPaymentStatus(ipnToken: string): Promise<PayGatePaymentStatus> {
  const url = `${API_BASE}/control/payment-status.php?ipn_token=${encodeURIComponent(ipnToken)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`PayGate payment-status.php returned ${res.status}`);
  return res.json();
}

/**
 * Poll for payment completion. Resolves when status becomes 'paid' or rejects
 * after maxAttempts.
 *
 * @param ipnToken      IPN token from wallet generation
 * @param intervalMs    Polling interval in milliseconds (default 10s)
 * @param maxAttempts   Maximum number of polls (default 60 = 10 min at 10s)
 */
export function pollPaymentStatus(
  ipnToken: string,
  intervalMs = 10_000,
  maxAttempts = 60,
): Promise<PayGatePaymentStatus> {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      try {
        const status = await checkPaymentStatus(ipnToken);
        if (status.status === 'paid') {
          clearInterval(timer);
          resolve(status);
        } else if (attempts >= maxAttempts) {
          clearInterval(timer);
          reject(new Error('Payment status check timed out'));
        }
      } catch (err) {
        if (attempts >= maxAttempts) {
          clearInterval(timer);
          reject(err);
        }
        // else keep polling
      }
    }, intervalMs);
  });
}

// ── HMAC signature (for callback verification) ────────────────────────────────

/**
 * Build the HMAC-SHA256 signature the same way the WHMCS plugin does.
 * sig = HMAC-SHA256( orderId, SHA256('paygate_salt_' + walletAddress) )
 */
export async function buildCallbackSignature(
  orderId: string,
  walletAddress: string,
): Promise<string> {
  const encoder = new TextEncoder();

  // secret = SHA-256('paygate_salt_' + walletAddress)
  const secretBuf = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode('paygate_salt_' + walletAddress),
  );
  const secretHex = Array.from(new Uint8Array(secretBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // sig = HMAC-SHA-256(orderId, secretHex)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secretHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, encoder.encode(orderId));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build the full callback URL for PayGate to hit when payment is received.
 * This URL points to our Firebase Function that will update the order status.
 *
 * @param orderId        Firestore order ID
 * @param walletAddress  Merchant USDC wallet used for this payment
 */
export async function buildCallbackUrl(
  orderId: string,
  walletAddress: string,
): Promise<string> {
  const sig = await buildCallbackSignature(orderId, walletAddress);
  // The callback function is deployed at our Firebase project
  const base = 'https://us-central1-ikamba-1c669.cloudfunctions.net/paygateCallback';
  return `${base}?order_id=${encodeURIComponent(orderId)}&sig=${encodeURIComponent(sig)}`;
}
