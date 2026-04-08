import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

const vpnresellersToken = defineSecret('VPNRESELLERS_TOKEN');

const VPNR_BASE = 'https://api.vpnresellers.com/v3_2';

const CORS_ORIGIN = 'https://ikambavpn.com';

/**
 * Proxy for VPNresellers API — avoids CORS issues.
 * Route: /vpnrProxy?path=/accounts&method=POST&body={...}
 *
 * Frontend calls: /vpnrProxy?path=/accounts (GET)
 *                 /vpnrProxy?path=/accounts (POST, body in request body)
 */
export const vpnrProxy = onRequest(
  { secrets: [vpnresellersToken], cors: [CORS_ORIGIN, 'http://localhost:5173'] },
  async (req, res) => {
    // OPTIONS preflight is handled by the cors option above
    const apiPath = (req.query.path as string) || '';
    if (!apiPath) {
      res.status(400).json({ error: 'Missing path query parameter' });
      return;
    }

    const method = req.method === 'OPTIONS' ? 'GET' : req.method;
    const url = `${VPNR_BASE}${apiPath}`;
    const token = vpnresellersToken.value();

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...(method !== 'GET' && method !== 'HEAD'
          ? { 'Content-Type': 'application/json' }
          : {}),
      },
    };

    if (method !== 'GET' && method !== 'HEAD' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, fetchOptions);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  }
);

/**
 * PayGate.to callback handler — called by PayGate when a card payment is received.
 *
 * PayGate hits this URL with query params:
 *   ?order_id=<firestoreOrderId>&sig=<hmac>&value_coin=<usdAmount>
 *    &coin=<coinName>&txid_in=<tx>&txid_out=<tx>&address_in=<addr>&value_forwarded_coin=<amt>
 *
 * We verify the HMAC signature and mark the order as payment_submitted.
 */
export const paygateCallback = onRequest(
  { cors: true },
  async (req, res) => {
    const orderId = (req.query.order_id || req.query.invoice_id) as string;
    const sig = req.query.sig as string;
    const valueCoin = req.query.value_coin as string;
    const txidOut = req.query.txid_out as string;
    const coin = req.query.coin as string;

    if (!orderId || !sig) {
      res.status(400).send('Missing order_id or sig');
      return;
    }

    try {
      // 1. Fetch the order from Firestore
      const orderRef = db.collection('vpn_orders').doc(orderId);
      const orderSnap = await orderRef.get();

      if (!orderSnap.exists) {
        res.status(404).send('Order not found');
        return;
      }

      const order = orderSnap.data()!;

      // 2. Fetch the merchant wallet from app settings
      const settingsSnap = await db.doc('appdata/appSettings').get();
      const walletAddress = settingsSnap.exists
        ? settingsSnap.data()?.paygateUsdcWallet || ''
        : '';

      if (!walletAddress) {
        res.status(500).send('Merchant wallet not configured');
        return;
      }

      // 3. Verify HMAC signature
      const crypto = await import('crypto');
      const secret = crypto.createHash('sha256')
        .update('paygate_salt_' + walletAddress)
        .digest('hex');
      const expectedSig = crypto.createHmac('sha256', secret)
        .update(orderId)
        .digest('hex');

      if (sig !== expectedSig) {
        console.warn('[paygateCallback] Invalid signature for order', orderId);
        res.status(403).send('Invalid signature');
        return;
      }

      // 4. Only update if order is still pending
      if (order.status === 'pending_payment') {
        await orderRef.update({
          status: 'payment_submitted',
          paygateTxId: txidOut || '',
          paygateAmountReceived: valueCoin || '',
          paygateCoin: coin || '',
          updatedAt: new Date().toISOString(),
        });
        console.log('[paygateCallback] Order', orderId, 'marked as payment_submitted');
      }

      res.status(200).send('*ok*');
    } catch (err) {
      console.error('[paygateCallback] Error:', err);
      res.status(500).send('Internal error');
    }
  }
);
