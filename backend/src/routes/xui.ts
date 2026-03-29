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
  GB,
  daysFromNow,
  resetClientTraffic,
} from "../services/xui";

export const xuiRouter = Router();

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
 * GET /xui/links/:subId
 * Get all connection links (subscription URL, V2RayTun, V2RayNG, Hiddify)
 * for a given subscription ID.
 */
xuiRouter.get("/links/:subId", async (req: Request, res: Response) => {
  try {
    const { subId } = req.params;
    const links = getAllClientLinks(subId);
    return res.json({ ok: true, data: links });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /xui/subscription/:subId
 * Redirect to the raw subscription URL (for QR code generation, etc.)
 */
xuiRouter.get("/subscription/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  return res.redirect(getSubscriptionUrl(subId));
});

/**
 * GET /xui/deeplink/:subId
 * Redirect to V2RayTun deep link (iOS auto-import).
 */
xuiRouter.get("/deeplink/:subId", async (req: Request, res: Response) => {
  const { subId } = req.params;
  return res.redirect(getV2RayTunDeepLink(subId));
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
 * List all client stats (admin only).
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
    return res.json({ ok: true, data: stats });
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
