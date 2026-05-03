/**
 * Smart subscription renewal scanner.
 *
 * Runs on a 6-hour cron. For every active subscription expiring within the
 * next 5 days, generates a YooKassa renewal payment link, emails the user a
 * one-click renewal link via the shared `mail` Firestore collection (Brevo
 * delivery via Blink-1's Cloud Function), and records the reminder so we
 * don't spam.
 *
 * Anti-spam rules:
 *   - At most ONE reminder per (orderId, daysLeft bucket) where buckets are
 *     5d, 3d, 1d, 0d (expiry day).
 *   - Skip if order already has a pending renewal payment that's still valid.
 *   - Skip if user has another `pending_payment` order — they're mid-flow.
 */

import { getFirestore } from "./firebase";
import { createPayment, isYooKassaConfigured, YooKassaPayment } from "./yookassa";
import { sendMail, emailShell, escapeHtml } from "./firebaseMail";
import { getClientStatByEmail } from "./xui";
import { randomUUID } from "crypto";

// Inbound IDs — the user has a client entry in each of these inbounds
// (default REALITY, WebSocket anti-DPI, and social-optimised). They share
// the same expiryTime in normal operation, but we take the max as the
// source of truth in case any inbound is out of sync.
const XUI_INBOUND_IDS_FOR_TRUTH = [
  Number(process.env.XPANEL_INBOUND_ID || "1"),
  Number(process.env.XPANEL_WS_INBOUND_ID || "3"),
];

interface VpnOrderDoc {
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
  expiresAt?: string;
  createdAt: string;
}

interface RenewalReminderDoc {
  orderId: string;
  userId: string;
  userEmail: string;
  paymentId: string;
  confirmationUrl: string;
  linkExpiresAt: string;
  daysLeftBucket: number; // 5 | 3 | 1 | 0
  sentAt: string;
}

const REMINDER_BUCKETS = [5, 3, 1, 0];

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function bucketFor(daysLeft: number): number | null {
  // Send the LARGEST bucket the user falls into (so a 4-day-left user gets the 5d notice once, then 3d, then 1d, then 0d).
  for (const b of REMINDER_BUCKETS) {
    if (daysLeft <= b) return b;
  }
  return null;
}

function formatExpiry(iso: string, locale = "en-US"): string {
  return new Date(iso).toLocaleString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function formatPrice(amount: number, currency: string): string {
  if (currency === "RUB") return `${amount.toFixed(2)} ₽`;
  if (currency === "USD") return `$${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${currency}`;
}

/**
 * Find active orders ending within `windowDays` days.
 * NOTE: We can't filter by `expiresAt` directly in Firestore + status without
 * a composite index, so we filter in memory — fine at our scale.
 */
async function findExpiringOrders(windowDays: number): Promise<VpnOrderDoc[]> {
  const db = getFirestore();
  const snap = await db
    .collection("vpn_orders")
    .where("status", "==", "active")
    .get();

  const cutoffMs = Date.now() + windowDays * 24 * 60 * 60 * 1000;
  const out: VpnOrderDoc[] = [];
  for (const doc of snap.docs) {
    const d = doc.data() as Omit<VpnOrderDoc, "id">;
    if (!d.expiresAt) continue;
    const expMs = new Date(d.expiresAt).getTime();
    if (isNaN(expMs)) continue;
    if (expMs <= cutoffMs) {
      out.push({ id: doc.id, ...d });
    }
  }
  return out;
}

/**
 * Has the user already received a reminder for this order at this bucket?
 */
async function alreadyReminded(orderId: string, bucket: number): Promise<boolean> {
  const db = getFirestore();
  const snap = await db
    .collection("renewal_reminders")
    .where("orderId", "==", orderId)
    .where("daysLeftBucket", "==", bucket)
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Does the user have any non-renewal pending order? If yes, leave them alone.
 */
async function userHasOtherPendingOrder(userId: string): Promise<boolean> {
  const db = getFirestore();
  const snap = await db
    .collection("vpn_orders")
    .where("userId", "==", userId)
    .where("status", "==", "pending_payment")
    .limit(1)
    .get();
  return !snap.empty;
}

/**
 * Create a renewal order + YooKassa payment for an existing active subscription.
 * Returns the payment object so we can link the user to its `confirmation_url`.
 */
async function createRenewalPayment(order: VpnOrderDoc): Promise<{
  renewalOrderId: string;
  payment: YooKassaPayment;
}> {
  const db = getFirestore();
  const now = new Date().toISOString();
  const renewalOrderId = `renew-${order.id}-${Date.now()}`;

  // Create a fresh `pending_payment` order tagged as renewal of the parent.
  await db.collection("vpn_orders").doc(renewalOrderId).set({
    userId: order.userId,
    userEmail: order.userEmail,
    userName: order.userName,
    planId: order.planId,
    planName: order.planName,
    planDuration: order.planDuration,
    amount: order.amount,
    currency: order.currency,
    status: "pending_payment",
    isRenewal: true,
    renewalOf: order.id,
    createdAt: now,
    updatedAt: now,
  });

  const payment = await createPayment({
    amount: order.amount,
    currency: order.currency || "RUB",
    description: `IkambaVPN renewal — ${order.planName}`,
    orderId: renewalOrderId,
    planId: order.planId,
    userEmail: order.userEmail || undefined,
  });

  // Mirror checkout's behaviour — record YooKassa fields on the renewal order.
  await db.collection("vpn_orders").doc(renewalOrderId).update({
    yookassaPaymentId: payment.id,
    yookassaStatus: payment.status,
    updatedAt: new Date().toISOString(),
  });

  return { renewalOrderId, payment };
}

/**
 * Build & send the renewal email.
 */
async function emailRenewalLink(args: {
  toEmail: string;
  userName: string | null;
  planName: string;
  planDuration: string;
  amount: number;
  currency: string;
  expiresAt: string;
  daysLeft: number;
  confirmationUrl: string;
  linkExpiresAt: string;
}): Promise<void> {
  const {
    toEmail,
    userName,
    planName,
    planDuration,
    amount,
    currency,
    expiresAt,
    daysLeft,
    confirmationUrl,
    linkExpiresAt,
  } = args;

  const greeting = userName ? `Hi ${escapeHtml(userName.split(" ")[0])},` : "Hi,";
  const urgency =
    daysLeft <= 0
      ? "Your VPN subscription expires today."
      : daysLeft === 1
      ? "Your VPN subscription expires tomorrow."
      : `Your VPN subscription expires in ${daysLeft} days.`;

  const subject =
    daysLeft <= 0
      ? `⚠️ Your IkambaVPN expires today — renew now`
      : `Your IkambaVPN expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

  const bodyHtml = `
<p style="margin:0 0 14px;font-size:15px;">${greeting}</p>
<p style="margin:0 0 18px;font-size:15px;"><strong>${urgency}</strong> Renew with one tap below to keep your access uninterrupted.</p>

<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border:1px solid #eee;border-radius:12px;margin:0 0 22px;">
  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:13px;color:#666;">Plan</td>
      <td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(planName)}</td></tr>
  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:13px;color:#666;">Duration</td>
      <td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:14px;text-align:right;">${escapeHtml(planDuration)}</td></tr>
  <tr><td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:13px;color:#666;">Price</td>
      <td style="padding:14px 18px;border-bottom:1px solid #f3f3f3;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(formatPrice(amount, currency))}</td></tr>
  <tr><td style="padding:14px 18px;font-size:13px;color:#666;">Expires</td>
      <td style="padding:14px 18px;font-size:14px;text-align:right;">${escapeHtml(formatExpiry(expiresAt))}</td></tr>
</table>

<div style="text-align:center;margin:0 0 20px;">
  <a href="${escapeHtml(confirmationUrl)}"
     style="display:inline-block;padding:14px 32px;background:#000000;color:#ffffff;text-decoration:none;border-radius:12px;font-weight:600;font-size:15px;">
    Renew now
  </a>
</div>

<p style="margin:0 0 6px;font-size:13px;color:#666;text-align:center;">
  Pay securely via YooKassa (card, SBP, YooMoney, Mir).
</p>
<p style="margin:0;font-size:12px;color:#999;text-align:center;">
  This payment link expires on ${escapeHtml(formatExpiry(linkExpiresAt))}.
</p>

<hr style="border:0;border-top:1px solid #eee;margin:24px 0 16px;" />
<p style="margin:0 0 6px;font-size:12px;color:#999;">
  If the button doesn't work, copy and paste this URL into your browser:<br/>
  <span style="word-break:break-all;color:#666;">${escapeHtml(confirmationUrl)}</span>
</p>
`;

  const text = [
    `${urgency}`,
    ``,
    `Plan: ${planName} (${planDuration})`,
    `Price: ${formatPrice(amount, currency)}`,
    `Expires: ${formatExpiry(expiresAt)}`,
    ``,
    `Renew here:`,
    confirmationUrl,
    ``,
    `Payment link expires: ${formatExpiry(linkExpiresAt)}`,
  ].join("\n");

  await sendMail({
    to: toEmail,
    subject,
    html: emailShell("Subscription expiring soon", bodyHtml),
    text,
    tag: "vpn-renewal-reminder",
  });
}

/**
 * Read the user's REAL expiry from 3X-UI across all relevant inbounds.
 * 3X-UI is the source of truth — Firestore `vpn_orders.expiresAt` can be
 * stale (e.g. user renewed via panel directly, or webhook hiccupped).
 *
 * Returns max expiryTime (epoch ms) found across inbounds, or null if the
 * client doesn't exist in x-ui at all (rare — could be a deleted client).
 */
async function getXuiTruthExpiry(email: string): Promise<number | null> {
  let maxExpiry: number | null = null;
  for (const inboundId of XUI_INBOUND_IDS_FOR_TRUTH) {
    try {
      const stat = await getClientStatByEmail(email, inboundId);
      if (stat?.expiryTime && stat.expiryTime > 0) {
        if (maxExpiry === null || stat.expiryTime > maxExpiry) {
          maxExpiry = stat.expiryTime;
        }
      }
    } catch (err) {
      // Don't fail the whole scan because one inbound is unreachable.
      console.warn(
        `[renewal] xui lookup failed for ${email} inbound=${inboundId}:`,
        (err as Error).message
      );
    }
  }
  return maxExpiry;
}

/**
 * Process a single order: maybe send a reminder for it.
 * Returns the result for logging.
 */
export async function processOrderForRenewal(
  order: VpnOrderDoc
): Promise<
  | { kind: "skip"; reason: string }
  | { kind: "sent"; bucket: number; paymentId: string; confirmationUrl: string }
  | { kind: "error"; message: string }
> {
  if (!order.expiresAt) return { kind: "skip", reason: "no expiresAt" };
  if (!order.userEmail) return { kind: "skip", reason: "no userEmail" };

  // ── X-UI truth check ─────────────────────────────────────────────────────
  // Before doing anything, ask 3X-UI directly. If the panel says the user's
  // access stretches well beyond our Firestore record, they've already renewed
  // (manually, via webhook race, or via direct panel edit). Sync Firestore and
  // skip the email — sending now would be spam.
  try {
    const xuiExpiryMs = await getXuiTruthExpiry(order.userEmail);
    if (xuiExpiryMs !== null) {
      const firestoreExpiryMs = new Date(order.expiresAt).getTime();
      const drift = xuiExpiryMs - firestoreExpiryMs;
      // If x-ui is more than 1 day ahead of Firestore, trust x-ui and sync.
      if (drift > 24 * 60 * 60 * 1000) {
        const newExpiryIso = new Date(xuiExpiryMs).toISOString();
        await getFirestore()
          .collection("vpn_orders")
          .doc(order.id)
          .update({
            expiresAt: newExpiryIso,
            xuiSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        return {
          kind: "skip",
          reason: `xui truth: expires ${newExpiryIso} (Firestore was ${order.expiresAt}; synced)`,
        };
      }
      // x-ui says expired or matches Firestore → continue with normal flow.
    }
  } catch (err) {
    // Never block the scan on x-ui being grumpy.
    console.warn(
      `[renewal] xui truth check failed for ${order.userEmail}:`,
      (err as Error).message
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const daysLeft = daysUntil(order.expiresAt);
  if (daysLeft > 5) return { kind: "skip", reason: `daysLeft=${daysLeft} >5` };

  const bucket = bucketFor(daysLeft);
  if (bucket === null) return { kind: "skip", reason: "no bucket" };

  // Already reminded for this bucket?
  if (await alreadyReminded(order.id, bucket)) {
    return { kind: "skip", reason: `already reminded at bucket=${bucket}d` };
  }

  // User mid-checkout?
  if (await userHasOtherPendingOrder(order.userId)) {
    return { kind: "skip", reason: "user has other pending order" };
  }

  if (!isYooKassaConfigured()) {
    return { kind: "error", message: "YooKassa not configured" };
  }

  try {
    const { renewalOrderId, payment } = await createRenewalPayment(order);
    const confirmationUrl = payment.confirmation?.confirmation_url || "";
    if (!confirmationUrl) {
      return { kind: "error", message: "YooKassa returned no confirmation_url" };
    }

    // YooKassa redirect-type payments expire automatically; we mirror the
    // gateway value if present, else default 7 days from now.
    const linkExpiresAt =
      payment.expires_at ||
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await emailRenewalLink({
      toEmail: order.userEmail,
      userName: order.userName,
      planName: order.planName,
      planDuration: order.planDuration,
      amount: order.amount,
      currency: order.currency,
      expiresAt: order.expiresAt,
      daysLeft: Math.max(0, daysLeft),
      confirmationUrl,
      linkExpiresAt,
    });

    // Persist reminder record so we don't double-send this bucket.
    const db = getFirestore();
    const reminder: RenewalReminderDoc = {
      orderId: order.id,
      userId: order.userId,
      userEmail: order.userEmail,
      paymentId: payment.id,
      confirmationUrl,
      linkExpiresAt,
      daysLeftBucket: bucket,
      sentAt: new Date().toISOString(),
    };
    await db.collection("renewal_reminders").add({
      ...reminder,
      renewalOrderId, // helpful for debugging
    });

    return { kind: "sent", bucket, paymentId: payment.id, confirmationUrl };
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }
}

export interface RenewalScanSummary {
  scanned: number;
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{
    orderId: string;
    userEmail: string | null;
    daysLeft: number;
    result: string;
  }>;
}

export async function scanAndSendRenewalReminders(): Promise<RenewalScanSummary> {
  console.log("[renewal] Scan starting…");
  const summary: RenewalScanSummary = {
    scanned: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  let orders: VpnOrderDoc[] = [];
  try {
    orders = await findExpiringOrders(5);
  } catch (err) {
    console.error("[renewal] Failed to query expiring orders:", err);
    return summary;
  }

  for (const order of orders) {
    summary.scanned++;
    const result = await processOrderForRenewal(order);
    const daysLeft = daysUntil(order.expiresAt!);
    let resultStr = "";
    if (result.kind === "sent") {
      summary.sent++;
      resultStr = `sent[${result.bucket}d] payment=${result.paymentId}`;
    } else if (result.kind === "skip") {
      summary.skipped++;
      resultStr = `skip: ${result.reason}`;
    } else {
      summary.errors++;
      resultStr = `error: ${result.message}`;
    }
    summary.details.push({
      orderId: order.id,
      userEmail: order.userEmail,
      daysLeft,
      result: resultStr,
    });
    console.log(`[renewal] ${order.id} (${order.userEmail}) ${daysLeft}d → ${resultStr}`);
  }

  console.log(
    `[renewal] Scan complete: scanned=${summary.scanned} sent=${summary.sent} skipped=${summary.skipped} errors=${summary.errors}`
  );
  return summary;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let scannerInterval: ReturnType<typeof setInterval> | null = null;

/** Run every 6 hours. Stagger initial run by 90s to let the rest of the
 *  service finish booting / Firebase warm up. */
export function startRenewalScanner(): void {
  if (scannerInterval) return;

  // Tag each scan with a short ID for log grepping.
  const tag = randomUUID().slice(0, 8);
  console.log(`[renewal] Starting scheduler (every 6h) — tag ${tag}`);

  setTimeout(() => {
    scanAndSendRenewalReminders().catch((err) =>
      console.error("[renewal] Initial scan failed:", err)
    );
  }, 90_000);

  scannerInterval = setInterval(() => {
    scanAndSendRenewalReminders().catch((err) =>
      console.error("[renewal] Scheduled scan failed:", err)
    );
  }, 6 * 60 * 60 * 1000);
}

export function stopRenewalScanner(): void {
  if (scannerInterval) {
    clearInterval(scannerInterval);
    scannerInterval = null;
  }
}
