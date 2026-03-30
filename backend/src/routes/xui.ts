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
 * GET /xui-public/sub/:email
 * Self-hosted subscription endpoint — returns base64-encoded VLESS link.
 * V2RayTun / V2RayNG / Hiddify all expect this format from subscription URLs.
 * NO AUTH required — apps call this directly.
 */
xuiPublicRouter.get("/sub/:email", async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const inbounds = await listInbounds();
    let clientId = "";
    for (const inb of inbounds) {
      const settings = JSON.parse((inb as any).settings || "{}");
      const client = (settings.clients || []).find((c: any) => c.email === email);
      if (client) {
        clientId = client.id;
        break;
      }
    }
    if (!clientId) {
      return res.status(404).send("Client not found");
    }
    const remark = `IkambaVPN-${email.split("@")[0]}`;
    const vlessLink = buildVlessLink(clientId, remark);
    const base64 = Buffer.from(vlessLink).toString("base64");

    // Real usage info so V2RayTun/V2RayNG can show the user their data consumption
    let userInfo = "upload=0; download=0; total=0; expire=0";
    try {
      const stat = await getClientStatByEmail(email);
      if (stat) {
        const expireSec = stat.expiryTime ? Math.floor(stat.expiryTime / 1000) : 0;
        userInfo = `upload=${stat.up}; download=${stat.down}; total=${stat.total}; expire=${expireSec}`;
      }
    } catch { /* non-fatal — fall back to zeros */ }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Profile-Update-Interval", "24");
    res.setHeader("Subscription-Userinfo", userInfo);
    return res.send(base64);
  } catch (err: any) {
    return res.status(500).send("Error");
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
 * Legacy redirect.
 */
xuiRouter.get("/deeplink/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  return res.redirect(getV2RayTunDeepLink(buildVlessLink("", "")));
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
