"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vpnrProxy = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
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
//# sourceMappingURL=index.js.map