"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProviderWGConfig = void 0;
const wgConfig_1 = require("./wgConfig");
const envOr = (key, fallback) => process.env[key] || fallback;
const providerConfigs = {
    USA: {
        A: {
            endpoint: envOr("PROVIDER_A_USA_ENDPOINT", "usa-a.example.com:51820"),
            publicKey: envOr("PROVIDER_A_USA_PUBKEY", "providerA-usa-pubkey"),
            dns: envOr("PROVIDER_A_DNS", "1.1.1.1"),
        },
        B: {
            endpoint: envOr("PROVIDER_B_USA_ENDPOINT", "usa-b.example.com:51820"),
            publicKey: envOr("PROVIDER_B_USA_PUBKEY", "providerB-usa-pubkey"),
            dns: envOr("PROVIDER_B_DNS", "1.0.0.1"),
        },
    },
    RWANDA: {
        A: {
            endpoint: envOr("PROVIDER_A_RW_ENDPOINT", "rw-a.example.com:51820"),
            publicKey: envOr("PROVIDER_A_RW_PUBKEY", "providerA-rw-pubkey"),
            dns: envOr("PROVIDER_A_DNS", "1.1.1.1"),
        },
        B: {
            endpoint: envOr("PROVIDER_B_RW_ENDPOINT", "rw-b.example.com:51820"),
            publicKey: envOr("PROVIDER_B_RW_PUBKEY", "providerB-rw-pubkey"),
            dns: envOr("PROVIDER_B_DNS", "1.0.0.1"),
        },
    },
};
const chooseProvider = (server) => {
    var _a;
    // Placeholder selection: prefer A, fall back to B if A missing endpoint
    const pref = "A";
    const hasPref = (_a = providerConfigs[server][pref]) === null || _a === void 0 ? void 0 : _a.endpoint;
    return hasPref ? pref : "B";
};
const getProviderWGConfig = (server) => {
    const provider = chooseProvider(server);
    const config = providerConfigs[server][provider];
    const base = (0, wgConfig_1.generateWGConfig)(server);
    return Object.assign(Object.assign({}, base), { endpoint: config.endpoint, peer_public_key: config.publicKey, dns: config.dns || base.dns, allowed_ips: config.allowedIps || base.allowed_ips, provider });
};
exports.getProviderWGConfig = getProviderWGConfig;
