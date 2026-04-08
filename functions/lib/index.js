"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paygateCallback = exports.vpnrProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = require("firebase-admin");
// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const vpnresellersToken = (0, params_1.defineSecret)('VPNRESELLERS_TOKEN');
const VPNR_BASE = 'https://api.vpnresellers.com/v3_2';
const CORS_ORIGIN = 'https://ikambavpn.com';
/**
 * Proxy for VPNresellers API — avoids CORS issues.
 * Route: /vpnrProxy?path=/accounts&method=POST&body={...}
 *
 * Frontend calls: /vpnrProxy?path=/accounts (GET)
 *                 /vpnrProxy?path=/accounts (POST, body in request body)
 */
exports.vpnrProxy = (0, https_1.onRequest)({ secrets: [vpnresellersToken], cors: [CORS_ORIGIN, 'http://localhost:5173'] }, async (req, res) => {
    // OPTIONS preflight is handled by the cors option above
    const apiPath = req.query.path || '';
    if (!apiPath) {
        res.status(400).json({ error: 'Missing path query parameter' });
        return;
    }
    const method = req.method === 'OPTIONS' ? 'GET' : req.method;
    const url = `${VPNR_BASE}${apiPath}`;
    const token = vpnresellersToken.value();
    const fetchOptions = {
        method,
        headers: Object.assign({ 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }, (method !== 'GET' && method !== 'HEAD'
            ? { 'Content-Type': 'application/json' }
            : {})),
    };
    if (method !== 'GET' && method !== 'HEAD' && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
    }
    const upstream = await fetch(url, fetchOptions);
    const data = await upstream.json();
    res.status(upstream.status).json(data);
});
/**
 * PayGate.to callback handler — called by PayGate when a card payment is received.
 *
 * PayGate hits this URL with query params:
 *   ?order_id=<firestoreOrderId>&sig=<hmac>&value_coin=<usdAmount>
 *    &coin=<coinName>&txid_in=<tx>&txid_out=<tx>&address_in=<addr>&value_forwarded_coin=<amt>
 *
 * We verify the HMAC signature and mark the order as payment_submitted.
 */
exports.paygateCallback = (0, https_1.onRequest)({ cors: true }, async (req, res) => {
    var _a;
    const orderId = (req.query.order_id || req.query.invoice_id);
    const sig = req.query.sig;
    const valueCoin = req.query.value_coin;
    const txidOut = req.query.txid_out;
    const coin = req.query.coin;
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
        const order = orderSnap.data();
        // 2. Fetch the merchant wallet from app settings
        const settingsSnap = await db.doc('appdata/appSettings').get();
        const walletAddress = settingsSnap.exists
            ? ((_a = settingsSnap.data()) === null || _a === void 0 ? void 0 : _a.paygateUsdcWallet) || ''
            : '';
        if (!walletAddress) {
            res.status(500).send('Merchant wallet not configured');
            return;
        }
        // 3. Verify HMAC signature
        const crypto = await Promise.resolve().then(() => require('crypto'));
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
    }
    catch (err) {
        console.error('[paygateCallback] Error:', err);
        res.status(500).send('Internal error');
    }
});
//# sourceMappingURL=index.js.map