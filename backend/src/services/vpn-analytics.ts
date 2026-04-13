/**
 * VPN Analytics — Firestore-backed activity snapshots
 *
 * Stores SUMMARIES only to keep Firestore reads/writes minimal:
 *
 *   Collection: vpnOnlineStatus/{email}        — 1 doc per user, overwritten (not appended)
 *   Collection: vpnDailyStats/{date}/users/{email} — 1 doc per user per day
 *   Collection: vpnDailyStats/{date}           — daily aggregate (online peak, total connections, top domains)
 *
 * Estimated cost at 25 users:
 *   - Online status writes: ~720/day (every 2 min × 25 users = 1 batch write)
 *   - Daily stats writes:   ~50/day  (every 30 min, merge into same doc)
 *   - Admin reads:          ~100/day
 *   Total: well within Firebase free tier (20K writes, 50K reads/day)
 */

import { getFirestore } from "./firebase";
import { getAllOnlineClients, getUserActivitySummaries, type UserActivitySummary } from "./xui";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Online status doc — overwritten every 2 min per user */
export interface OnlineStatusDoc {
  email: string;
  isOnline: boolean;
  server: string | null;
  lastChecked: string;      // ISO timestamp
  lastOnline: string | null; // ISO timestamp of last time they were online
}

/** Per-user daily stats — merged every 30 min */
export interface UserDailyStats {
  email: string;
  date: string;                   // YYYY-MM-DD
  totalConnections: number;       // cumulative for the day
  topDomains: { domain: string; count: number }[];
  peakOnline: boolean;            // was online at any snapshot today
  lastSeen: string | null;        // last seen timestamp
  sourceIps: string[];
  inboundsUsed: string[];
  blockedCount: number;
  updatedAt: string;              // ISO timestamp
}

/** Daily aggregate — one doc per day */
export interface DailyAggregate {
  date: string;
  peakOnlineCount: number;
  totalUniqueUsers: number;
  totalConnections: number;
  topDomains: { domain: string; count: number }[];
  updatedAt: string;
}

/** History response sent to frontend */
export interface HistoryResponse {
  days: DailyAggregate[];
  userHistory: UserDailyStats[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowISO(): string {
  return new Date().toISOString();
}

// ── Online Status Snapshot (runs every 2 min) ─────────────────────────────────

/**
 * Snapshot current online status to Firestore.
 * Overwrites one doc per user — no append, minimal writes.
 *
 * Writes: ~25 docs per run (1 per user) = ~720 writes/day at 2-min intervals
 * but we use batched writes so it's 1 batch operation.
 */
export async function snapshotOnlineStatus(): Promise<void> {
  try {
    const db = getFirestore();
    const onlineList = await getAllOnlineClients();
    const onlineMap = new Map(onlineList.map((e) => [e.email, e.server]));

    // Get all known users from the last activity data
    // We only update users we know about (from online list + existing docs)
    const col = db.collection("vpnOnlineStatus");

    // Batch write — counts as 1 operation per doc but uses a single network call
    const batch = db.batch();
    let writeCount = 0;

    // Update online users
    for (const { email, server } of onlineList) {
      const doc: OnlineStatusDoc = {
        email,
        isOnline: true,
        server,
        lastChecked: nowISO(),
        lastOnline: nowISO(),
      };
      batch.set(col.doc(email), doc, { merge: true });
      writeCount++;
    }

    // Mark previously-online users as offline (query existing online docs)
    const onlineDocs = await col.where("isOnline", "==", true).get();
    for (const snap of onlineDocs.docs) {
      if (!onlineMap.has(snap.id)) {
        batch.update(col.doc(snap.id), {
          isOnline: false,
          lastChecked: nowISO(),
        });
        writeCount++;
      }
    }

    if (writeCount > 0) {
      await batch.commit();
    }

    console.log(`[analytics] Online status snapshot: ${onlineList.length} online, ${writeCount} writes`);
  } catch (err) {
    console.error("[analytics] Failed to snapshot online status:", err);
  }
}

// ── Daily Activity Snapshot (runs every 30 min) ──────────────────────────────

/**
 * Snapshot user activity summaries into daily stats.
 * Merges into the SAME doc per user per day — no duplication.
 *
 * Writes: ~25 docs per run (1 per user) + 1 aggregate = ~52 writes per run
 * At 30-min intervals = ~2,500 writes/day — well within free tier.
 */
export async function snapshotDailyActivity(): Promise<void> {
  try {
    const db = getFirestore();
    const date = todayKey();
    const summaries = await getUserActivitySummaries();

    const dayRef = db.collection("vpnDailyStats").doc(date);
    const usersCol = dayRef.collection("users");

    const batch = db.batch();

    let peakOnline = 0;
    let totalConnections = 0;
    const globalDomains = new Map<string, number>();
    const uniqueUsers = new Set<string>();

    for (const user of summaries) {
      uniqueUsers.add(user.email);
      totalConnections += user.connectionCount;
      if (user.isOnline) peakOnline++;

      // Aggregate global domains
      for (const d of user.topDomains) {
        globalDomains.set(d.domain, (globalDomains.get(d.domain) || 0) + d.count);
      }

      // Per-user daily doc — MERGE so we accumulate throughout the day
      const userDoc: UserDailyStats = {
        email: user.email,
        date,
        totalConnections: user.connectionCount,
        topDomains: user.topDomains.slice(0, 10),
        peakOnline: user.isOnline,
        lastSeen: user.lastSeen,
        sourceIps: user.sourceIps,
        inboundsUsed: user.inboundsUsed,
        blockedCount: user.blockedCount,
        updatedAt: nowISO(),
      };

      batch.set(usersCol.doc(user.email), userDoc, { merge: true });
    }

    // Daily aggregate doc
    // Read existing to keep the peak (don't overwrite a higher peak from earlier)
    const existingAgg = await dayRef.get();
    const existingPeak = existingAgg.exists ? (existingAgg.data() as DailyAggregate).peakOnlineCount || 0 : 0;

    const topGlobal = [...globalDomains.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([domain, count]) => ({ domain, count }));

    const aggregate: DailyAggregate = {
      date,
      peakOnlineCount: Math.max(peakOnline, existingPeak),
      totalUniqueUsers: uniqueUsers.size,
      totalConnections,
      topDomains: topGlobal,
      updatedAt: nowISO(),
    };

    batch.set(dayRef, aggregate, { merge: true });
    await batch.commit();

    console.log(`[analytics] Daily snapshot: ${summaries.length} users, ${peakOnline} online, ${totalConnections} connections`);
  } catch (err) {
    console.error("[analytics] Failed to snapshot daily activity:", err);
  }
}

// ── Read History (for admin dashboard) ────────────────────────────────────────

/**
 * Get historical data for the admin dashboard.
 * Reads daily aggregates for the last N days + per-user stats for a specific day.
 *
 * Reads: ~7-30 docs for aggregates + ~25 docs for user detail = ~55 reads per admin view
 */
export async function getHistory(days: number = 7, detailDate?: string): Promise<HistoryResponse> {
  const db = getFirestore();

  // Get daily aggregates for the last N days
  const now = new Date();
  const dateKeys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dateKeys.push(d.toISOString().slice(0, 10));
  }

  // Read all daily aggregate docs in parallel
  const aggPromises = dateKeys.map((date) =>
    db.collection("vpnDailyStats").doc(date).get()
  );
  const aggDocs = await Promise.all(aggPromises);

  const dayAggregates: DailyAggregate[] = [];
  for (const doc of aggDocs) {
    if (doc.exists) {
      dayAggregates.push(doc.data() as DailyAggregate);
    }
  }

  // Sort oldest first for chart display
  dayAggregates.sort((a, b) => a.date.localeCompare(b.date));

  // If detail date requested, get per-user stats for that day
  let userHistory: UserDailyStats[] = [];
  const targetDate = detailDate || todayKey();
  try {
    const userDocs = await db
      .collection("vpnDailyStats")
      .doc(targetDate)
      .collection("users")
      .get();

    userHistory = userDocs.docs.map((d) => d.data() as UserDailyStats);
    userHistory.sort((a, b) => b.totalConnections - a.totalConnections);
  } catch {
    // No data for this date
  }

  return { days: dayAggregates, userHistory };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let onlineInterval: ReturnType<typeof setInterval> | null = null;
let dailyInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the analytics scheduler.
 * - Online status: every 2 minutes
 * - Daily activity: every 30 minutes
 *
 * Call this once from index.ts after Firebase is initialized.
 */
export function startAnalyticsScheduler(): void {
  // Don't start if Firebase is in insecure/disabled mode
  if (process.env.ALLOW_INSECURE_FIREBASE === "true") {
    console.log("[analytics] Skipping — Firebase in insecure mode");
    return;
  }

  console.log("[analytics] Starting scheduler — online every 2min, daily every 30min");

  // Run immediately on startup
  snapshotOnlineStatus();
  snapshotDailyActivity();

  // Then schedule recurring
  onlineInterval = setInterval(snapshotOnlineStatus, 2 * 60 * 1000);    // 2 min
  dailyInterval = setInterval(snapshotDailyActivity, 30 * 60 * 1000);  // 30 min
}

/**
 * Stop the analytics scheduler (for graceful shutdown).
 */
export function stopAnalyticsScheduler(): void {
  if (onlineInterval) clearInterval(onlineInterval);
  if (dailyInterval) clearInterval(dailyInterval);
  onlineInterval = null;
  dailyInterval = null;
  console.log("[analytics] Scheduler stopped");
}
