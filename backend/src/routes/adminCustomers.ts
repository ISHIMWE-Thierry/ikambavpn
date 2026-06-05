/**
 * Admin Customers endpoint — the "real users" view.
 *
 *   GET /admin/customers
 *     Returns:
 *       - aggregated x-ui snapshot (configs collapsed into customers)
 *       - cross-reference with Firestore users + vpn_orders (paid / trial / unknown)
 *       - dashboard buckets: Real Users / VPN Configs / Revenue / Alerts
 *
 * Read-only. Does not touch x-ui.
 */
import { Router, Response, NextFunction } from "express";
import { AuthedRequest } from "../middleware/auth";
import { getFirestore } from "../services/firebase";
import { buildXuiCustomerSnapshot, XuiCustomer } from "../services/xuiCustomers";

export const adminCustomersRouter = Router();

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

adminCustomersRouter.use(requireAdmin);

interface FirestoreUserDoc {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  createdAt: string | null;
}

interface VpnOrderDoc {
  id: string;
  userId: string;
  userEmail: string | null;
  status: string;
  amount: number;
  currency: string;
  planName: string;
  planDuration: string;
  expiresAt: string | null;
  createdAt: string;
  isRenewal?: boolean;
}

/**
 * Pull all Firestore users + orders and key them by email (lowercase) so we
 * can match against the x-ui snapshot.
 */
async function loadFirestoreContext(): Promise<{
  usersByEmail: Map<string, FirestoreUserDoc>;
  ordersByEmail: Map<string, VpnOrderDoc[]>;
  allOrders: VpnOrderDoc[];
}> {
  const db = getFirestore();
  const [usersSnap, ordersSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("vpn_orders").get(),
  ]);

  const usersByEmail = new Map<string, FirestoreUserDoc>();
  for (const d of usersSnap.docs) {
    const data = d.data() as any;
    const email = (data.email || "").trim().toLowerCase();
    if (!email) continue;
    usersByEmail.set(email, {
      uid: d.id,
      email,
      displayName: data.displayName || data.name || null,
      role: data.role || null,
      createdAt: data.createdAt || null,
    });
  }

  const ordersByEmail = new Map<string, VpnOrderDoc[]>();
  const allOrders: VpnOrderDoc[] = [];
  for (const d of ordersSnap.docs) {
    const data = d.data() as any;
    const order: VpnOrderDoc = {
      id: d.id,
      userId: data.userId || "",
      userEmail: (data.userEmail || "").toString() || null,
      status: data.status || "unknown",
      amount: Number(data.amount) || 0,
      currency: data.currency || "RUB",
      planName: data.planName || "",
      planDuration: data.planDuration || "",
      expiresAt: data.expiresAt || null,
      createdAt: data.createdAt || "",
      isRenewal: !!data.isRenewal,
    };
    allOrders.push(order);
    const key = (order.userEmail || "").trim().toLowerCase();
    if (!key) continue;
    if (!ordersByEmail.has(key)) ordersByEmail.set(key, []);
    ordersByEmail.get(key)!.push(order);
  }

  return { usersByEmail, ordersByEmail, allOrders };
}

type CustomerType = "paid" | "trial" | "unknown_in_firestore" | "expired_unpaid";

/** Decide the customer's commercial status from their orders. */
function classifyCustomer(
  customer: XuiCustomer,
  orders: VpnOrderDoc[],
  inFirestore: boolean
): CustomerType {
  if (!inFirestore) return "unknown_in_firestore";
  // Has any active paid (non-renewal flagged isn't necessary; just paid status).
  const hasPaid = orders.some(
    (o) => o.status === "active" || o.status === "completed" || o.status === "paid"
  );
  if (hasPaid) {
    if (customer.status === "expired") return "expired_unpaid";
    return "paid";
  }
  // No paid order — likely a trial or admin-provisioned account.
  return "trial";
}

adminCustomersRouter.get(
  "/customers",
  async (_req: AuthedRequest, res: Response) => {
    try {
      const [snapshot, fsCtx] = await Promise.all([
        buildXuiCustomerSnapshot(),
        loadFirestoreContext(),
      ]);

      // Enrich each customer with Firestore data.
      const enriched = snapshot.customers.map((c) => {
        const fsUser = fsCtx.usersByEmail.get(c.email) || null;
        const orders = fsCtx.ordersByEmail.get(c.email) || [];
        const type = classifyCustomer(c, orders, !!fsUser);
        const latestOrder = orders.sort((a, b) =>
          (b.createdAt || "").localeCompare(a.createdAt || "")
        )[0];
        return {
          ...c,
          firestoreUid: fsUser?.uid || null,
          displayName: fsUser?.displayName || null,
          inFirestore: !!fsUser,
          type,
          orderCount: orders.length,
          latestPlan: latestOrder?.planName || null,
          latestPlanDuration: latestOrder?.planDuration || null,
          latestOrderStatus: latestOrder?.status || null,
          latestOrderAmount: latestOrder?.amount || 0,
          latestOrderCurrency: latestOrder?.currency || "RUB",
          latestOrderCreatedAt: latestOrder?.createdAt || null,
        };
      });

      // Buckets the user asked for.
      const realUsers = {
        total: enriched.length,
        paid: enriched.filter((c) => c.type === "paid").length,
        trial: enriched.filter((c) => c.type === "trial").length,
        expired: enriched.filter(
          (c) => c.status === "expired" || c.type === "expired_unpaid"
        ).length,
        expiringIn3Days: enriched.filter(
          (c) =>
            c.status === "active" && c.daysLeft !== null && c.daysLeft <= 3
        ).length,
        unknownInFirestore: enriched.filter(
          (c) => c.type === "unknown_in_firestore"
        ).length,
      };

      const vpnConfigs = {
        totalXrayClients: snapshot.totals.totalConfigs,
        ...snapshot.totals.configsByKind, // vless / ws / yt / xhttp counts
      };

      // Revenue — only count active, paid, non-expired customers.
      const paidActive = enriched.filter(
        (c) => c.type === "paid" && c.status === "active"
      );
      // Sum latest order monthly-equivalent. We don't have plan price normalisation,
      // so use the literal amount from the most recent order. RUB is dominant.
      const expectedRubFromActive = paidActive.reduce(
        (sum, c) => sum + (c.latestOrderCurrency === "RUB" ? c.latestOrderAmount : 0),
        0
      );
      const expectedUsdFromActive = paidActive.reduce(
        (sum, c) => sum + (c.latestOrderCurrency === "USD" ? c.latestOrderAmount : 0),
        0
      );
      const expiredUnpaid = enriched.filter((c) => c.type === "expired_unpaid").length;
      // Renewal rate: paid customers who have ≥2 orders.
      const renewers = enriched.filter(
        (c) => c.type === "paid" && c.orderCount >= 2
      ).length;
      const renewalRate =
        realUsers.paid > 0 ? renewers / realUsers.paid : 0;

      const revenue = {
        monthlyActivePaidUsers: paidActive.length,
        expectedMonthlyRevenueRub: Math.round(expectedRubFromActive * 100) / 100,
        expectedMonthlyRevenueUsd: Math.round(expectedUsdFromActive * 100) / 100,
        expiredUnpaidUsers: expiredUnpaid,
        renewalRate: Math.round(renewalRate * 1000) / 10, // percentage
      };

      const alerts = {
        expiredButEnabled: snapshot.alerts.expiredButEnabled.map((c) => c.email),
        activeButZeroUsage: snapshot.alerts.activeButZeroUsage.map((c) => c.email),
        highTrafficUsers: snapshot.alerts.highTrafficUsers.map((c) => ({
          email: c.email,
          totalUsageBytes: c.totalUsageBytes,
        })),
        orphanConfigs: snapshot.alerts.orphanConfigs.map((c) => ({
          email: c.email,
          configCount: c.configCount,
        })),
      };

      // Note: we do NOT mask emails server-side. The frontend handles masking
      // for display so admins can still copy the real email when actioning.
      return res.json({
        ok: true,
        generatedAt: snapshot.generatedAt,
        sections: {
          realUsers,
          vpnConfigs,
          revenue,
          alerts,
        },
        inbounds: snapshot.inbounds,
        customers: enriched,
      });
    } catch (err) {
      console.error("[admin/customers] failed:", err);
      return res.status(500).json({
        error: "failed",
        message: (err as Error).message,
      });
    }
  }
);
