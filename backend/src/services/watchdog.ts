/**
 * VPN Watchdog Service
 *
 * Runs every 2 minutes to:
 * 1. Re-enable any clients that got auto-disabled by 3X-UI (traffic limit, IP limit, etc.)
 * 2. Fix any clients that still have limitIp > 0 (set to 0 = unlimited)
 * 3. Restart Xray if it's not running
 *
 * This ensures VPN connections NEVER get permanently dropped due to 3X-UI's
 * aggressive enforcement. The VPN should persist even under heavy bandwidth usage.
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
  errors: string[];
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
    errors: [],
  };

  try {
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

  if (result.clientsReEnabled > 0 || result.clientsLimitFixed > 0 || result.xrayRestarted) {
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
