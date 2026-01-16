import crypto from "crypto";
import { ServerId } from "./metrics";

export interface WireGuardConfig {
  private_key: string | null;
  peer_public_key: string;
  endpoint: string;
  allowed_ips: string;
  dns: string;
}

const envOr = (key: string, fallback: string) => process.env[key] || fallback;

const mockEndpoints: Record<ServerId, string> = {
  USA: envOr("MOCK_WG_ENDPOINT_USA", "us.example.com:51820"),
  RWANDA: envOr("MOCK_WG_ENDPOINT_RWANDA", "rw.example.com:51820"),
};

const mockPubKeys: Record<ServerId, string> = {
  USA: envOr("MOCK_WG_PUBLIC_KEY_USA", "server-public-key-us"),
  RWANDA: envOr("MOCK_WG_PUBLIC_KEY_RWANDA", "server-public-key-rw"),
};

const generatePrivateKey = () => crypto.randomBytes(32).toString("base64");

export const generateWGConfig = (server: ServerId): WireGuardConfig => {
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
