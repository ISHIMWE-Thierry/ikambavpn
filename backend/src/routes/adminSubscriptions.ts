/**
 * Admin endpoints for the smart subscription monitor.
 *
 *   GET  /admin/subscriptions              — list every active+expiring soon
 *                                            order with devices, expiry, email
 *                                            integrity flag.
 *   POST /admin/subscriptions/scan         — manually trigger the scanner.
 *   POST /admin/subscriptions/:orderId/send-renewal
 *                                          — force-send a renewal reminder for
 *                                            one specific order.
 *
 * All routes require admin claim.
 */

import { Router, Response, NextFunction } from "express";
import { AuthedRequest } from "../middleware/auth";
import { getFirestore } from "../services/firebase";
import { getDeviceSummaryForUsers } from "../services/devices";
import {
  scanAndSendRenewalReminders,
  processOrderForRenewal,
} from "../services/renewalScanner";
import { getClientStatByEmail } from "../services/xui";

export const adminSubscriptionsRouter = Router();

/**
 * Admin auth check (matches the logic in routes/xui.ts):
 *   1. Insecure/dev mode: trust everyone
 *   2. Firebase custom claim `admin === true`
 *   3. Firestore `users/{uid}.role === 'admin'`  ← this is how the app stores it
 */
const insecureMode = process.env.ALLOW_INSECURE_FIREBASE === "true";

async function isAdmin(req: AuthedRequest): Promise<boolean> {
  const user: any = req.user;
  if (!user?.uid) return false;
  if (insecureMode) return true;
  if (user.admin === true) return true;
  if (user.claims?.admin === true) return true;
  try {
    const db = getFirestore();
    const doc = await db.collection("users").doc(user.uid).get();
    if (doc.exists && doc.data()?.role === "admin") return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) {
  if (await isAdmin(req)) return next();
  return res.status(403).json({ error: "admin only" });
}

adminSubscriptionsRouter.use(requireAdmin);

interface OrderWithMeta {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  planId: string;
  planName: string;
  planDuration: string;
  amount: number;
  currency: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  daysLeft: number | null;
  emailMatchesProfile: boolean;
  profileEmail: string | null;
  devices: {
    count: number;
    items: Array<{
      deviceId: string;
      model: string;
      name: string;
      osVersion: string;
      appVersion: string;
      lastSeenISO: string;
    }>;
  };
  lastReminder: {
    sentAt: string;
    daysLeftBucket: number;
    confirmationUrl: string;
    linkExpiresAt: string;
  } | null;
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (isNaN(ms)) return null;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * GET /admin/subscriptions
 *
 * Query params:
 *   - status:  filter by order status (default: "active")
 *   - within:  only return orders whose expiresAt is within N days from now
 *              (default: 14, set to 0 to disable filter)
 */
adminSubscriptionsRouter.get(
  "/subscriptions",
  async (req: AuthedRequest, res: Response) => {
    try {
      const db = getFirestore();
      const status = String(req.query.status || "active");
      const within = Number(req.query.within ?? 14);

      const ordersSnap = await db
        .collection("vpn_orders")
        .where("status", "==", status)
        .get();

      const cutoffMs =
        within > 0 ? Date.now() + within * 24 * 60 * 60 * 1000 : null;

      const filtered = ordersSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((o) => {
          if (!o.expiresAt) return false;
          if (cutoffMs === null) return true;
          const exp = new Date(o.expiresAt).getTime();
          return !isNaN(exp) && exp <= cutoffMs;
        })
        .sort((a, b) => {
          const ax = new Date(a.expiresAt).getTime();
          const bx = new Date(b.expiresAt).getTime();
          return ax - bx;
        });

      const userIds = Array.from(new Set(filtered.map((o: any) => o.userId)));

      // Bulk-load device summaries.
      const deviceMap = await getDeviceSummaryForUsers(userIds);

      // Bulk-load profile emails to verify "email matches".
      const profileEmails = new Map<string, string | null>();
      await Promise.all(
        userIds.map(async (uid) => {
          try {
            const snap = await db.collection("users").doc(uid).get();
            const email = snap.exists ? (snap.data() as any).email || null : null;
            profileEmails.set(uid, email);
          } catch {
            profileEmails.set(uid, null);
          }
        })
      );

      // Latest reminder per orderId.
      const latestReminders = new Map<string, any>();
      await Promise.all(
        filtered.map(async (o: any) => {
          try {
            const snap = await db
              .collection("renewal_reminders")
              .where("orderId", "==", o.id)
              .orderBy("sentAt", "desc")
              .limit(1)
              .get();
            if (!snap.empty) latestReminders.set(o.id, snap.docs[0].data());
          } catch {
            /* index may not exist yet; ignore */
          }
        })
      );

      const result: OrderWithMeta[] = filtered.map((o: any) => {
        const profileEmail = profileEmails.get(o.userId) ?? null;
        const orderEmail = o.userEmail || null;
        const emailMatchesProfile =
          !!profileEmail &&
          !!orderEmail &&
          profileEmail.trim().toLowerCase() ===
            orderEmail.trim().toLowerCase();

        const dev = deviceMap.get(o.userId);
        const reminder = latestReminders.get(o.id);

        return {
          id: o.id,
          userId: o.userId,
          userEmail: orderEmail,
          userName: o.userName || null,
          planId: o.planId,
          planName: o.planName,
          planDuration: o.planDuration,
          amount: o.amount,
          currency: o.currency,
          status: o.status,
          expiresAt: o.expiresAt || null,
          createdAt: o.createdAt,
          daysLeft: daysUntil(o.expiresAt || null),
          emailMatchesProfile,
          profileEmail,
          devices: {
            count: dev?.deviceCount ?? 0,
            items: (dev?.devices ?? []).map((d) => ({
              deviceId: d.deviceId,
              model: d.model,
              name: d.name,
              osVersion: d.osVersion,
              appVersion: d.appVersion,
              lastSeenISO: d.lastSeenISO,
            })),
          },
          lastReminder: reminder
            ? {
                sentAt: reminder.sentAt,
                daysLeftBucket: reminder.daysLeftBucket,
                confirmationUrl: reminder.confirmationUrl,
                linkExpiresAt: reminder.linkExpiresAt,
              }
            : null,
        };
      });

      return res.json({
        count: result.length,
        within,
        status,
        items: result,
      });
    } catch (err) {
      console.error("[admin/subscriptions] list failed:", err);
      return res
        .status(500)
        .json({ error: "list failed", message: (err as Error).message });
    }
  }
);

/**
 * POST /admin/subscriptions/scan
 *
 * Triggers the renewal scanner immediately. Returns the summary.
 * This is safe to run repeatedly — anti-spam guards prevent duplicate emails.
 */
adminSubscriptionsRouter.post(
  "/subscriptions/scan",
  async (_req: AuthedRequest, res: Response) => {
    try {
      const summary = await scanAndSendRenewalReminders();
      return res.json({ ok: true, summary });
    } catch (err) {
      console.error("[admin/subscriptions] scan failed:", err);
      return res
        .status(500)
        .json({ error: "scan failed", message: (err as Error).message });
    }
  }
);

/**
 * POST /admin/subscriptions/:orderId/send-renewal
 *
 * Force-send a reminder for a specific order. Honours the same anti-spam
 * guards as the scheduled scan, but lets admins manually re-trigger.
 *
 * Body (optional): { force: true } — bypasses the "already reminded this
 *                                    bucket" check by deleting prior reminders
 *                                    for this order's current bucket.
 */
adminSubscriptionsRouter.post(
  "/subscriptions/:orderId/send-renewal",
  async (req: AuthedRequest, res: Response) => {
    try {
      const { orderId } = req.params;
      const force = req.body?.force === true;
      const db = getFirestore();

      const snap = await db.collection("vpn_orders").doc(orderId).get();
      if (!snap.exists) return res.status(404).json({ error: "order not found" });

      const order = { id: snap.id, ...(snap.data() as any) };

      if (force) {
        // Drop any existing reminders for this order so the scanner re-sends.
        const remSnap = await db
          .collection("renewal_reminders")
          .where("orderId", "==", orderId)
          .get();
        await Promise.all(remSnap.docs.map((d) => d.ref.delete()));
      }

      const result = await processOrderForRenewal(order);
      return res.json({ ok: true, orderId, result });
    } catch (err) {
      console.error("[admin/subscriptions] send-renewal failed:", err);
      return res.status(500).json({
        error: "send-renewal failed",
        message: (err as Error).message,
      });
    }
  }
);

/**
 * POST /admin/subscriptions/sync-from-xui
 *
 * For every active order, look up the user's real expiry in 3X-UI and update
 * Firestore `vpn_orders.expiresAt` to match. 3X-UI is the source of truth —
 * users may have renewed via direct panel edits or earlier webhook hiccups.
 *
 * Body (optional):
 *   { dryRun: true }  — return what *would* change without writing.
 *   { thresholdHours: 24 }  — only sync if drift exceeds N hours (default 24).
 *
 * This is safe to run anytime; it never shortens a user's access (we only
 * accept x-ui values that are LATER than Firestore's).
 */
adminSubscriptionsRouter.post(
  "/subscriptions/sync-from-xui",
  async (req: AuthedRequest, res: Response) => {
    const dryRun = req.body?.dryRun === true;
    const thresholdHours = Number(req.body?.thresholdHours ?? 24);
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    const db = getFirestore();
    const inboundIds = [
      Number(process.env.XPANEL_INBOUND_ID || "1"),
      Number(process.env.XPANEL_WS_INBOUND_ID || "3"),
    ];

    try {
      const snap = await db
        .collection("vpn_orders")
        .where("status", "==", "active")
        .get();

      const results: Array<{
        orderId: string;
        userEmail: string | null;
        firestoreExpiresAt: string | null;
        xuiExpiresAt: string | null;
        action: "synced" | "would-sync" | "skip-no-email" | "skip-no-xui-record" | "skip-no-drift" | "skip-xui-earlier" | "error";
        message?: string;
      }> = [];

      let updated = 0;
      let skipped = 0;
      let errored = 0;

      for (const doc of snap.docs) {
        const o = doc.data() as any;
        const orderId = doc.id;
        const email = o.userEmail || null;
        const firestoreExpiresAt = o.expiresAt || null;

        if (!email) {
          results.push({
            orderId,
            userEmail: null,
            firestoreExpiresAt,
            xuiExpiresAt: null,
            action: "skip-no-email",
          });
          skipped++;
          continue;
        }

        try {
          let maxExpiry: number | null = null;
          for (const inboundId of inboundIds) {
            const stat = await getClientStatByEmail(email, inboundId);
            if (stat?.expiryTime && stat.expiryTime > 0) {
              if (maxExpiry === null || stat.expiryTime > maxExpiry) {
                maxExpiry = stat.expiryTime;
              }
            }
          }

          if (maxExpiry === null) {
            results.push({
              orderId,
              userEmail: email,
              firestoreExpiresAt,
              xuiExpiresAt: null,
              action: "skip-no-xui-record",
            });
            skipped++;
            continue;
          }

          const xuiIso = new Date(maxExpiry).toISOString();
          const fsMs = firestoreExpiresAt
            ? new Date(firestoreExpiresAt).getTime()
            : 0;
          const drift = maxExpiry - fsMs;

          if (drift <= 0) {
            // x-ui is the same or older — never shorten, just skip.
            results.push({
              orderId,
              userEmail: email,
              firestoreExpiresAt,
              xuiExpiresAt: xuiIso,
              action: "skip-xui-earlier",
            });
            skipped++;
            continue;
          }

          if (drift < thresholdMs) {
            results.push({
              orderId,
              userEmail: email,
              firestoreExpiresAt,
              xuiExpiresAt: xuiIso,
              action: "skip-no-drift",
            });
            skipped++;
            continue;
          }

          if (!dryRun) {
            await db.collection("vpn_orders").doc(orderId).update({
              expiresAt: xuiIso,
              xuiSyncedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          }

          results.push({
            orderId,
            userEmail: email,
            firestoreExpiresAt,
            xuiExpiresAt: xuiIso,
            action: dryRun ? "would-sync" : "synced",
          });
          updated++;
        } catch (err) {
          results.push({
            orderId,
            userEmail: email,
            firestoreExpiresAt,
            xuiExpiresAt: null,
            action: "error",
            message: (err as Error).message,
          });
          errored++;
        }
      }

      return res.json({
        ok: true,
        dryRun,
        thresholdHours,
        totalOrders: snap.size,
        updated,
        skipped,
        errored,
        items: results,
      });
    } catch (err) {
      console.error("[admin/subscriptions] sync-from-xui failed:", err);
      return res.status(500).json({
        error: "sync-from-xui failed",
        message: (err as Error).message,
      });
    }
  }
);
