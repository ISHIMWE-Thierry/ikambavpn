/**
 * VPN Watchdog Service
 *
 * Runs every 2 minutes to:
 * 1. Re-enable any clients that got auto-disabled by 3X-UI (traffic limit, IP limit, etc.)
 * 2. Fix any clients that still have limitIp > 0 (set to 0 = unlimited)
 * 3. Restart Xray if it's not running
 * 4. Enforce anti-disconnect Xray policy (connIdle=900, uplinkOnly=0, downlinkOnly=0)
 *
 * This ensures VPN connections NEVER get permanently dropped due to 3X-UI's
 * aggressive enforcement. The VPN should persist even under heavy bandwidth usage.
 *
 * Anti-disconnect settings explained:
 * - connIdle=900: Kill truly idle connections after 15 min (survives YouTube pauses)
 * - uplinkOnly=0: Never kill download-only streams (video streaming, large downloads)
 * - downlinkOnly=0: Never kill upload-only streams (file uploads, VoIP)
 * - bufferSize=0: Unlimited per-connection buffer (smoother streaming)
 * - TCP keepalive 60s: Below mobile NAT timeout (~120s) to keep connections alive
 *   without triggering ISP DPI
 * - tcpMaxSeg=1400: Smaller MSS to avoid fragmentation on mobile/LTE tunnels
 * - MPTCP: Survives WiFi↔cellular handoffs on mobile
 * - BBR congestion: Better throughput on lossy networks
 * - QUIC block (UDP:443): Forces YouTube/Google to TCP — QUIC bypasses Xray's
 *   connection tracking and is the #1 cause of mobile video disconnects
 * - Error logging: Captures disconnect events for diagnosis
 */

import {
  listInbounds,
  getInbound,
  getSystemStatus,
  type XuiClient,
  type XuiInbound,
} from "./xui";

const PANEL_URL = process.env.XPANEL_URL || "https://194.76.217.4:2053";
const PANEL_USER = process.env.XPANEL_USER || "ikamba";
const PANEL_PASS = process.env.XPANEL_PASS || "";
const DEFAULT_INBOUND_ID = Number(process.env.XPANEL_INBOUND_ID || "1");

/** Anti-disconnect policy that must be enforced on every watchdog run */
const REQUIRED_POLICY = {
  levels: {
    "0": {
      handshake: 10,
      connIdle: 900,       // 15 min idle timeout — survives YouTube pauses/buffer gaps on mobile
      uplinkOnly: 0,
      downlinkOnly: 0,
      bufferSize: 0,
      statsUserUplink: true,
      statsUserDownlink: true,
    },
  },
  system: {
    statsInboundUplink: true,
    statsInboundDownlink: true,
    statsOutboundUplink: true,
    statsOutboundDownlink: true,
  },
};

/** Sockopt settings for anti-disconnect on all inbounds/outbounds */
const REQUIRED_SOCKOPT = {
  tcpKeepAliveIdle: 60,     // 60s — well below mobile NAT timeout (~120s)
  tcpKeepAliveInterval: 15, // 15s between probes — fast enough for mobile network switching
  tcpKeepAliveProbes: 4,    // 4 probes × 15s = 1 min to detect dead connection
  tcpUserTimeout: 60000,    // 60s total TCP timeout
  tcpMaxSeg: 1400,          // Smaller MSS avoids fragmentation on mobile/LTE tunnels
  tcpcongestion: "bbr",
  tcpFastOpen: true,
  tcpMptcp: true,           // Multipath TCP — survives WiFi↔cellular switches on mobile
};

/**
 * QUIC block routing rule — forces YouTube/Google to fall back to TCP.
 * QUIC (UDP:443) bypasses Xray's connection tracking and causes frequent
 * disconnects on mobile. Blocking it makes all traffic go through TCP where
 * keepalive and flow control work properly.
 */
const REQUIRED_QUIC_BLOCK_RULE = {
  type: "field",
  network: "udp",
  port: "443",
  outboundTag: "blocked",
};

/** Error logging config — essential for diagnosing disconnects */
const REQUIRED_LOG = {
  loglevel: "error",
  error: "/var/log/xray/error.log",
};

// Suppress TLS errors for IP-based panel cert
if (PANEL_URL.startsWith("https://")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

let watchdogSession: string | null = null;
let watchdogSessionExpiry = 0;

async function getSession(): Promise<string> {
  if (watchdogSession && watchdogSessionExpiry > Date.now() + 60_000) {
    return watchdogSession;
  }

  const res = await fetch(`${PANEL_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `username=${encodeURIComponent(PANEL_USER)}&password=${encodeURIComponent(PANEL_PASS)}`,
    redirect: "manual",
  });

  const cookies = res.headers.getSetCookie?.() ?? [];
  const sessionCookie = cookies.find((c) => c.startsWith("3x-ui=") || c.startsWith("session="));
  const cookie = sessionCookie?.split(";")[0] ?? "";

  watchdogSession = cookie;
  watchdogSessionExpiry = Date.now() + 3600_000;
  return cookie;
}

interface WatchdogResult {
  ts: string;
  clientsChecked: number;
  clientsReEnabled: number;
  clientsLimitFixed: number;
  xrayState: string;
  xrayRestarted: boolean;
  policyEnforced: boolean;
  errors: string[];
}

/**
 * Enforce anti-disconnect policy by reading/writing the Xray config file directly.
 * This is more reliable than the panel API (which may return empty responses).
 * The config file at /usr/local/x-ui/bin/config.json is read by Xray on every restart.
 */
async function enforceAntiDisconnectPolicy(): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    const CONFIG_PATH = "/usr/local/x-ui/bin/config.json";

    let configStr: string;
    try {
      configStr = await fs.readFile(CONFIG_PATH, "utf-8");
    } catch {
      // Not running on VPS or file not accessible — skip silently
      return true;
    }

    const config = JSON.parse(configStr);
    let changed = false;

    // ── Enforce policy.levels.0 ──
    if (!config.policy) config.policy = {};
    if (!config.policy.levels) config.policy.levels = {};
    if (!config.policy.levels["0"]) config.policy.levels["0"] = {};

    const level0 = config.policy.levels["0"];
    for (const [key, val] of Object.entries(REQUIRED_POLICY.levels["0"])) {
      if (level0[key] !== val) {
        console.log(`[watchdog] Fixing policy.levels.0.${key}: ${level0[key]} → ${val}`);
        level0[key] = val;
        changed = true;
      }
    }

    // ── Enforce policy.system ──
    if (!config.policy.system) config.policy.system = {};
    for (const [key, val] of Object.entries(REQUIRED_POLICY.system)) {
      if (config.policy.system[key] !== val) {
        config.policy.system[key] = val;
        changed = true;
      }
    }

    // ── Enforce sockopt on outbounds ──
    for (const outbound of config.outbounds || []) {
      if (outbound.tag === "direct") {
        if (!outbound.streamSettings) outbound.streamSettings = {};
        if (!outbound.streamSettings.sockopt) outbound.streamSettings.sockopt = {};
        const sockopt = outbound.streamSettings.sockopt;
        for (const [key, val] of Object.entries(REQUIRED_SOCKOPT)) {
          if (sockopt[key] !== val) {
            sockopt[key] = val;
            changed = true;
          }
        }
      }
    }

    // ── Enforce QUIC block routing rule (UDP:443 → blackhole) ──
    // This is THE most critical anti-disconnect fix for YouTube on mobile.
    // QUIC bypasses Xray's connection tracking → frequent drops.
    // Blocking UDP:443 forces all traffic to TCP where keepalive works.
    if (!config.routing) config.routing = {};
    if (!config.routing.rules) config.routing.rules = [];
    const rules = config.routing.rules;
    const hasQuicBlock = rules.some(
      (r: any) => r.network === "udp" && r.port === "443" && r.outboundTag === "blocked"
    );
    if (!hasQuicBlock) {
      // Insert after the API rule (index 1) so it's checked early
      const apiIdx = rules.findIndex((r: any) => r.outboundTag === "api");
      rules.splice(apiIdx + 1, 0, { ...REQUIRED_QUIC_BLOCK_RULE });
      console.log("[watchdog] Fixing routing: added QUIC block rule (UDP:443 → blocked)");
      changed = true;
    }

    // ── Ensure "blocked" blackhole outbound exists ──
    const outbounds = config.outbounds || [];
    const hasBlocked = outbounds.some((o: any) => o.tag === "blocked" && o.protocol === "blackhole");
    if (!hasBlocked) {
      outbounds.push({ tag: "blocked", protocol: "blackhole", settings: {} });
      config.outbounds = outbounds;
      console.log("[watchdog] Fixing outbounds: added 'blocked' blackhole");
      changed = true;
    }

    // ── Enforce error logging ──
    if (!config.log) config.log = {};
    for (const [key, val] of Object.entries(REQUIRED_LOG)) {
      if (config.log[key] !== val) {
        console.log(`[watchdog] Fixing log.${key}: ${config.log[key]} → ${val}`);
        config.log[key] = val;
        changed = true;
      }
    }

    // ── Enforce sockopt + sniffing on inbounds (skip API) ──
    for (const inbound of config.inbounds || []) {
      if (inbound.tag === "api" || inbound.protocol === "dokodemo-door") continue;
      if (!inbound.streamSettings) inbound.streamSettings = {};
      if (!inbound.streamSettings.sockopt) inbound.streamSettings.sockopt = {};
      const sockopt = inbound.streamSettings.sockopt;
      for (const [key, val] of Object.entries(REQUIRED_SOCKOPT)) {
        if (sockopt[key] !== val) {
          sockopt[key] = val;
          changed = true;
        }
      }

      // Ensure sniffing includes quic + fakedns
      if (!inbound.sniffing) inbound.sniffing = {};
      inbound.sniffing.enabled = true;
      inbound.sniffing.routeOnly = false; // MUST be false — true causes traffic to bypass proxy
      const dest: string[] = inbound.sniffing.destOverride || [];
      for (const proto of ["http", "tls", "quic", "fakedns"]) {
        if (!dest.includes(proto)) {
          dest.push(proto);
          changed = true;
        }
      }
      inbound.sniffing.destOverride = dest;
    }

    if (!changed) {
      return true; // Already correct — no changes needed
    }

    // Write the fixed config back (Xray reads this on next restart — no need to force restart)
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    console.log("[watchdog] ✅ Anti-disconnect policy enforced in config file");

    // NOTE: We do NOT restart Xray here. Restarting causes 3X-UI to regenerate
    // the config from its DB template, which creates an infinite restart loop.
    // The policy in the DB template is already correct. The config file fix
    // is a safety net for when 3X-UI regenerates with wrong values.

    return true;
  } catch (err: any) {
    console.error("[watchdog] Policy enforcement error:", err.message);
    return false;
  }
}

/**
 * Run a single watchdog cycle.
 * Safe to call frequently — it's idempotent.
 */
export async function runWatchdog(): Promise<WatchdogResult> {
  const result: WatchdogResult = {
    ts: new Date().toISOString(),
    clientsChecked: 0,
    clientsReEnabled: 0,
    clientsLimitFixed: 0,
    xrayState: "unknown",
    xrayRestarted: false,
    policyEnforced: false,
    errors: [],
  };

  try {
    // ── Step 0: Enforce anti-disconnect policy ──
    try {
      result.policyEnforced = await enforceAntiDisconnectPolicy();
    } catch (err: any) {
      result.errors.push(`Policy enforcement failed: ${err.message}`);
    }

    // ── Step 1: Check Xray status ──
    try {
      const status = await getSystemStatus();
      result.xrayState = status.xray?.state || "unknown";

      if (status.xray?.state !== "running") {
        console.warn("[watchdog] Xray is NOT running — restarting...");
        try {
          const cookie = await getSession();
          await fetch(`${PANEL_URL}/panel/api/server/restartXrayService`, {
            method: "POST",
            headers: { Cookie: cookie, Accept: "application/json" },
          });
          result.xrayRestarted = true;
          console.log("[watchdog] ✅ Xray restart triggered");
        } catch (err: any) {
          result.errors.push(`Xray restart failed: ${err.message}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`Status check failed: ${err.message}`);
    }

    // ── Step 2: Check all clients — re-enable disabled, fix limitIp ──
    try {
      const inbound = await getInbound(DEFAULT_INBOUND_ID) as any;
      const settings = JSON.parse(inbound.settings || "{}");
      const clients: XuiClient[] = settings.clients || [];
      result.clientsChecked = clients.length;

      let needsUpdate = false;

      for (const client of clients) {
        // Re-enable disabled clients
        if (!client.enable) {
          console.log(`[watchdog] Re-enabling disabled client: ${client.email}`);
          client.enable = true;
          result.clientsReEnabled++;
          needsUpdate = true;
        }

        // Fix limitIp if it's > 0 (would cause disconnects)
        if (client.limitIp > 0) {
          console.log(`[watchdog] Fixing limitIp ${client.limitIp}→0 for: ${client.email}`);
          client.limitIp = 0;
          result.clientsLimitFixed++;
          needsUpdate = true;
        }
      }

      // Apply changes if any client was modified
      if (needsUpdate) {
        const cookie = await getSession();

        // Update the inbound with fixed client settings
        settings.clients = clients;
        const updateBody = {
          id: DEFAULT_INBOUND_ID,
          remark: inbound.remark,
          enable: inbound.enable,
          protocol: inbound.protocol,
          listen: inbound.listen || "",
          port: inbound.port,
          settings: JSON.stringify(settings),
          streamSettings: inbound.streamSettings,
          sniffing: inbound.sniffing,
          expiryTime: inbound.expiryTime || 0,
          up: inbound.up || 0,
          down: inbound.down || 0,
          total: inbound.total || 0,
        };

        const res = await fetch(
          `${PANEL_URL}/panel/api/inbounds/update/${DEFAULT_INBOUND_ID}`,
          {
            method: "POST",
            headers: {
              Cookie: cookie,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(updateBody),
          }
        );

        const data = (await res.json()) as { success: boolean; msg?: string };
        if (data.success) {
          console.log(
            `[watchdog] ✅ Fixed ${result.clientsReEnabled} disabled + ${result.clientsLimitFixed} limitIp clients`
          );
        } else {
          result.errors.push(`Inbound update failed: ${data.msg}`);
        }
      }

      // Also re-enable disabled client stats (traffic tracking)
      const clientStats = inbound.clientStats || [];
      for (const stat of clientStats) {
        if (!stat.enable) {
          try {
            const cookie = await getSession();
            // Use the updateClient endpoint to re-enable the stat
            const clientInSettings = clients.find((c: XuiClient) => c.email === stat.email);
            if (clientInSettings) {
              await fetch(
                `${PANEL_URL}/panel/api/inbounds/updateClient/${clientInSettings.id}`,
                {
                  method: "POST",
                  headers: {
                    Cookie: cookie,
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    id: DEFAULT_INBOUND_ID,
                    settings: JSON.stringify({ clients: [{ ...clientInSettings, enable: true }] }),
                  }),
                }
              );
              console.log(`[watchdog] Re-enabled client stat for: ${stat.email}`);
            }
          } catch (err: any) {
            result.errors.push(`Re-enable stat ${stat.email}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      result.errors.push(`Client check failed: ${err.message}`);
    }
  } catch (err: any) {
    result.errors.push(`Watchdog failed: ${err.message}`);
  }

  if (result.clientsReEnabled > 0 || result.clientsLimitFixed > 0 || result.xrayRestarted || !result.policyEnforced) {
    console.log(`[watchdog] Summary:`, JSON.stringify(result));
  }

  return result;
}

/**
 * Start the watchdog timer.
 * Runs every 2 minutes. Safe to call multiple times (idempotent).
 */
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

export function startWatchdog(intervalMs = 2 * 60 * 1000): void {
  if (watchdogInterval) {
    console.log("[watchdog] Already running — skipping duplicate start");
    return;
  }

  console.log(`[watchdog] 🐕 Starting VPN watchdog (every ${intervalMs / 1000}s)`);

  // Run immediately on start
  runWatchdog().catch((err) => console.error("[watchdog] Initial run failed:", err));

  // Then run on interval
  watchdogInterval = setInterval(() => {
    runWatchdog().catch((err) => console.error("[watchdog] Run failed:", err));
  }, intervalMs);
}

export function stopWatchdog(): void {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
    console.log("[watchdog] Stopped");
  }
}
