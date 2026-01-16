import { ServerId } from "./metrics";
import { WireGuardConfig } from "./wgConfig";
import { generateWGConfig } from "./wgConfig";

export type ProviderId = "A" | "B";

export interface ProviderConfig {
  endpoint: string;
  publicKey: string;
  dns?: string;
  allowedIps?: string;
}

const envOr = (key: string, fallback: string) => process.env[key] || fallback;

const providerConfigs: Record<ServerId, Record<ProviderId, ProviderConfig>> = {
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

const chooseProvider = (server: ServerId): ProviderId => {
  // Placeholder selection: prefer A, fall back to B if A missing endpoint
  const pref: ProviderId = "A";
  const hasPref = providerConfigs[server][pref]?.endpoint;
  return hasPref ? pref : "B";
};

export interface ProviderWGConfig extends WireGuardConfig {
  provider: ProviderId;
}

export const getProviderWGConfig = (server: ServerId): ProviderWGConfig => {
  const provider = chooseProvider(server);
  const config = providerConfigs[server][provider];
  const base = generateWGConfig(server);
  return {
    ...base,
    endpoint: config.endpoint,
    peer_public_key: config.publicKey,
    dns: config.dns || base.dns,
    allowed_ips: config.allowedIps || base.allowed_ips,
    provider,
  };
};
