/**
 * 3X-UI / VLESS+REALITY routes
 *
 * These endpoints manage VLESS+REALITY users on the 3X-UI panel.
 * They sit alongside the existing VPNresellers routes — they don't replace anything.
 *
 * All routes require authentication (authMiddleware applied in index.ts).
 */

import { Router, Request, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import {
  provisionUser,
  addClient,
  deleteClient,
  setClientEnabled,
  getClientStatByEmail,
  getClientStats,
  listInbounds,
  getSystemStatus,
  getAllClientLinks,
  getSubscriptionUrl,
  getV2RayTunDeepLink,
  buildVlessLink,
  GB,
  daysFromNow,
  resetClientTraffic,
  getCachedSubscription,
} from "../services/xui";

export const xuiRouter = Router();

/**
 * Public router for subscription endpoints — NO auth middleware.
 * V2RayTun / V2RayNG / Hiddify call these directly.
 */
export const xuiPublicRouter = Router();

// ── Public subscription endpoint ──────────────────────────────────────────────

/**
 * GET /xui-public/health
 * Public health check — no auth. Frontend and users can call this to check
 * whether our VPN server / Xray process is running.
 */
xuiPublicRouter.get("/health", async (_req: Request, res: Response) => {
  try {
    const status = await getSystemStatus();
    const online = status.xray?.state === "running";
    return res.json({ ok: true, online, xray: status.xray?.state, ts: Date.now() });
  } catch {
    return res.status(503).json({ ok: false, online: false, ts: Date.now() });
  }
});

/**
 * GET /xui-public/diagnose
 * Connection diagnostics — helps users figure out if the problem is:
 *   1. Their internet connection (can they reach us at all?)
 *   2. Our backend server (is the API running?)
 *   3. The Xray/VLESS process (is the VPN tunnel service up?)
 *   4. The 3X-UI panel (can we manage accounts?)
 *
 * NO AUTH — so users can run this even when VPN is broken.
 * Returns a checklist of what works and what doesn't, plus a human-readable verdict.
 */
xuiPublicRouter.get("/diagnose", async (req: Request, res: Response) => {
  const startTime = Date.now();
  const results = {
    ts: startTime,
    // If user got this response, their internet + our API are working
    internetToApi: true,
    apiLatencyMs: 0,
    xrayRunning: false,
    xrayState: "unknown" as string,
    panelReachable: false,
    serverCpu: 0,
    serverMemPct: 0,
    serverUptime: 0,
    verdict: "" as string,
    suggestion: "" as string,
    userIp: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown",
  };

  // Check 1: Xray status + system stats
  try {
    const status = await getSystemStatus();
    results.xrayRunning = status.xray?.state === "running";
    results.xrayState = status.xray?.state || "unknown";
    results.panelReachable = true;
    results.serverCpu = status.cpu || 0;
    results.serverMemPct = status.mem?.total
      ? Math.round((status.mem.current / status.mem.total) * 100)
      : 0;
    results.serverUptime = status.uptime || 0;
  } catch {
    results.panelReachable = false;
  }

  results.apiLatencyMs = Date.now() - startTime;

  // Build verdict
  if (results.xrayRunning && results.panelReachable) {
    results.verdict = "✅ Our VPN server is fully operational.";
    results.suggestion =
      "If you can't connect, the issue is likely on your side: " +
      "check your internet connection, try switching between Wi-Fi and mobile data, " +
      "or restart the VPN app. If you're in a restricted country, make sure you're " +
      "using V2RayTun (iOS) or V2RayNG (Android).";
  } else if (!results.xrayRunning && results.panelReachable) {
    results.verdict = "⚠️ Our VPN tunnel (Xray) is down, but the server is reachable.";
    results.suggestion =
      "This is a problem on our end — the VPN service crashed. " +
      "It should auto-restart within 2 minutes. If it doesn't, contact support.";
  } else if (!results.panelReachable) {
    results.verdict = "⚠️ Our VPN management panel is unreachable.";
    results.suggestion =
      "The server may be restarting or under maintenance. " +
      "Your existing VPN connection should continue working. " +
      "If you can't connect at all, try again in 5 minutes.";
  }

  if (results.serverMemPct > 85) {
    results.suggestion +=
      " ⚠️ Server memory is at " + results.serverMemPct + "% — performance may be degraded.";
  }

  return res.json(results);
});

/**
 * GET /xui-public/sub/:email
 * Self-hosted subscription endpoint — returns base64-encoded VLESS link.
 * V2RayTun / V2RayNG / Hiddify all expect this format from subscription URLs.
 * NO AUTH required — apps call this directly.
 *
 * CRITICAL: This endpoint uses an in-memory cache so that brief 3X-UI panel
 * outages (restarts, memory spikes) don't cause V2RayTun/V2RayNG to drop the
 * connection. The apps poll this URL every few minutes — if it returns an error,
 * they disconnect the user (the #1 cause of "VPN auto goes off").
 */
/**
 * GET /xui-public/stats/:email
 * Public traffic stats for a user — no auth required.
 * Returns 404 if the user hasn't been provisioned yet (expected for new users).
 */
xuiPublicRouter.get("/stats/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const stat = await getClientStatByEmail(email);
    if (!stat) return res.json({ ok: false, error: "Client not found" });
    return res.json({
      ok: true,
      data: {
        email: stat.email,
        upload: stat.up,
        download: stat.down,
        total: stat.up + stat.down,
        limit: stat.total,
        enabled: stat.enable,
        expiryTime: stat.expiryTime,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

xuiPublicRouter.get("/sub/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);

    const entry = await getCachedSubscription(email);
    if (!entry) {
      return res.status(404).send("Client not found");
    }

    const base64 = Buffer.from(entry.vlessLink).toString("base64");

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Profile-Update-Interval", "24");
    res.setHeader("Subscription-Userinfo", entry.userInfo);
    // Allow client apps to cache for 5 minutes to reduce hammering
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.send(base64);
  } catch (err: any) {
    console.error(`[sub] Error for ${req.params.email}:`, err.message);
    // Return 503 (temporary) instead of 500 so clients know to retry
    return res.status(503).send("Temporarily unavailable — please retry");
  }
});

// ── User-facing endpoints ─────────────────────────────────────────────────────

/**
 * POST /xui/provision
 * Provision a new VLESS+REALITY account for the authenticated user.
 *
 * Body: {
 *   email?: string,          // identifier (defaults to user email)
 *   trafficLimitGB?: number, // traffic cap in GB (0 = unlimited)
 *   expiryDays?: number,     // days until expiry (0 = never)
 *   maxConnections?: number  // concurrent device limit (default 3)
 * }
 */
xuiRouter.post("/provision", async (req: AuthedRequest, res: Response) => {
  try {
    const userEmail =
      req.body.email || (req.user as any)?.email || "unknown";

    const result = await provisionUser(userEmail, {
      trafficLimitGB: req.body.trafficLimitGB,
      expiryDays: req.body.expiryDays,
      maxConnections: req.body.maxConnections,
    });

    return res.json({
      ok: true,
      data: result,
    });
  } catch (err: any) {
    console.error("XUI provision error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/links/:email
 * Get all connection links for a client by email.
 */
xuiRouter.get("/links/:email", async (req: AuthedRequest, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    // Look up client in inbound to get clientId and subId
    const inbounds = await listInbounds();
    let clientId = "";
    let subId = "";
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      const client = (settings.clients || []).find((c: any) => c.email === email);
      if (client) {
        clientId = client.id;
        subId = client.subId || "";
        break;
      }
    }
    if (!clientId) {
      return res.status(404).json({ ok: false, error: "Client not found" });
    }
    const links = getAllClientLinks(clientId, subId, email);
    return res.json({ ok: true, data: links });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/subscription/:subId
 * Legacy redirect (kept for backwards compatibility).
 */
xuiRouter.get("/subscription/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  return res.redirect(getSubscriptionUrl(subId));
});

/**
 * GET /xui/deeplink/:subId
 * Legacy redirect — now redirects to V2RayTun import with subscription URL.
 */
xuiRouter.get("/deeplink/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  const subUrl = getSubscriptionUrl(subId);
  return res.redirect(getV2RayTunDeepLink(subUrl));
});

/**
 * GET /xui/stats/:email
 * Get traffic stats for a specific client.
 */
xuiRouter.get("/stats/:email", async (req: AuthedRequest, res: Response) => {
  try {
    const stat = await getClientStatByEmail(req.params.email);
    if (!stat) {
      return res.status(404).json({ ok: false, error: "Client not found" });
    }
    return res.json({
      ok: true,
      data: {
        email: stat.email,
        upload: stat.up,
        download: stat.down,
        total: stat.up + stat.down,
        limit: stat.total,
        enabled: stat.enable,
        expiryTime: stat.expiryTime,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Admin endpoints ───────────────────────────────────────────────────────────

/**
 * GET /xui/admin/clients
 * List all clients with stats, UUIDs, and subscription URLs (admin only).
 */
xuiRouter.get("/admin/clients", async (req: AuthedRequest, res: Response) => {
  try {
    const isAdmin =
      (req.user as any)?.admin === true ||
      (req.user as any)?.claims?.admin === true;
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

    const stats = await getClientStats();
    // Merge with client config (UUIDs, subIds) from inbound settings
    const inbounds = await listInbounds();
    const clientMap = new Map<string, { uuid: string; subId: string; limitIp: number }>();
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      for (const c of settings.clients || []) {
        clientMap.set(c.email, { uuid: c.id, subId: c.subId || "", limitIp: c.limitIp || 0 });
      }
    }

    const enriched = stats.map((s: any) => {
      const cfg = clientMap.get(s.email);
      const links = cfg ? getAllClientLinks(cfg.uuid, cfg.subId, s.email) : null;
      return {
        ...s,
        uuid: cfg?.uuid || "",
        subId: cfg?.subId || "",
        limitIp: cfg?.limitIp || 0,
        subscriptionUrl: links?.subscriptionUrl || "",
        vlessLink: links?.vlessLink || "",
      };
    });

    return res.json({ ok: true, data: enriched });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /xui/admin/add
 * Add a client manually (admin only).
 *
 * Body: {
 *   email: string,
 *   trafficLimitGB?: number,
 *   expiryDays?: number,
 *   maxConnections?: number
 * }
 */
xuiRouter.post("/admin/add", async (req: AuthedRequest, res: Response) => {
  try {
    const isAdmin =
      (req.user as any)?.admin === true ||
      (req.user as any)?.claims?.admin === true;
    if (!isAdmin) {
      return res.status(403).json({ ok: false, error: "Admin only" });
    }

    const { email, trafficLimitGB, expiryDays, maxConnections } = req.body;
    if (!email) {
      return res.status(400).json({ ok: false, error: "email is required" });
    }

    const result = await provisionUser(email, {
      trafficLimitGB,
      expiryDays,
      maxConnections,
    });

    return res.json({ ok: true, data: result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /xui/admin/disable/:clientId
 * Disable a client (admin only).
 */
xuiRouter.post(
  "/admin/disable/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      await setClientEnabled(req.params.clientId, false);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * POST /xui/admin/enable/:clientId
 * Enable a client (admin only).
 */
xuiRouter.post(
  "/admin/enable/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      await setClientEnabled(req.params.clientId, true);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * DELETE /xui/admin/delete/:clientId
 * Delete a client (admin only).
 */
xuiRouter.delete(
  "/admin/delete/:clientId",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      await deleteClient(req.params.clientId);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * POST /xui/admin/reset-traffic/:email
 * Reset traffic counter for a client (admin only).
 */
xuiRouter.post(
  "/admin/reset-traffic/:email",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      await resetClientTraffic(req.params.email);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/inbounds
 * List all inbounds (admin only).
 */
xuiRouter.get(
  "/admin/inbounds",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const inbounds = await listInbounds();
      return res.json({ ok: true, data: inbounds });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

/**
 * GET /xui/admin/status
 * Get server system status (admin only).
 */
xuiRouter.get(
  "/admin/status",
  async (req: AuthedRequest, res: Response) => {
    try {
      const isAdmin =
        (req.user as any)?.admin === true ||
        (req.user as any)?.claims?.admin === true;
      if (!isAdmin) {
        return res.status(403).json({ ok: false, error: "Admin only" });
      }

      const status = await getSystemStatus();
      return res.json({ ok: true, data: status });
    } catch (err: any) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);
