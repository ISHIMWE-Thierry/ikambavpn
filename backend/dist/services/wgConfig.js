"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWGConfig = void 0;
const crypto_1 = __importDefault(require("crypto"));
const envOr = (key, fallback) => process.env[key] || fallback;
const mockEndpoints = {
    USA: envOr("MOCK_WG_ENDPOINT_USA", "us.example.com:51820"),
    RWANDA: envOr("MOCK_WG_ENDPOINT_RWANDA", "rw.example.com:51820"),
};
const mockPubKeys = {
    USA: envOr("MOCK_WG_PUBLIC_KEY_USA", "server-public-key-us"),
    RWANDA: envOr("MOCK_WG_PUBLIC_KEY_RWANDA", "server-public-key-rw"),
};
const generatePrivateKey = () => crypto_1.default.randomBytes(32).toString("base64");
const generateWGConfig = (server) => {
    // For MVP, generate client private key locally and return server public key + endpoint.
    const privateKey = generatePrivateKey();
    return {
        private_key: privateKey,
        peer_public_key: mockPubKeys[server],
        endpoint: mockEndpoints[server],
        allowed_ips: "0.0.0.0/0",
        dns: "1.1.1.1",
    };
};
exports.generateWGConfig = generateWGConfig;
