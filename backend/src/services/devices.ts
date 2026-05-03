/**
 * Device aggregation service.
 *
 * Reads heartbeat sessions from Firestore and groups them by user, returning
 * a stable device fingerprint per (userId, device_id).
 *
 * IMPORTANT — iOS / Apple privacy:
 *   Apps CANNOT read a real iPhone serial number on iOS 7+. The closest stable
 *   identifier is `UIDevice.current.identifierForVendor` — a UUID per
 *   (vendor, app install). We treat that as the "serial" here.
 *
 * Schema of `sessions` documents (from /connection/heartbeat):
 *   {
 *     uid:         string   — Firebase user ID (set by heartbeat route)
 *     status:      string
 *     last_heartbeat: ISO string
 *     local_ping_ms: number
 *     device_id:   string   — identifierForVendor UUID (NEW)
 *     device_model: string  — "iPhone15,2"             (NEW)
 *     device_name: string   — user-set name           (NEW)
 *     os_version:  string                              (NEW)
 *     app_version: string                              (NEW)
 *     ip:          string                              (NEW)
 *   }
 *
 * Pre-existing sessions without these fields will appear as "Unknown device".
 */

import { getFirestore } from "./firebase";

export interface DeviceInfo {
  /** identifierForVendor (iOS) — stable per app install. Treat as device serial. */
  deviceId: string;
  model: string;
  name: string;
  osVersion: string;
  appVersion: string;
  /** Last time we saw this device send a heartbeat. */
  lastSeenISO: string;
  /** Last public IP we observed (best-effort; may be empty). */
  lastIp?: string;
}

export interface UserDeviceSummary {
  uid: string;
  email: string | null;
  deviceCount: number;
  devices: DeviceInfo[];
}

/**
 * Window for "active devices": any device that pinged a heartbeat in the
 * last N days. 30 days catches occasional travelers without false positives.
 */
const LOOKBACK_DAYS = 30;

export async function getDeviceSummaryForUser(uid: string): Promise<UserDeviceSummary> {
  const db = getFirestore();
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const snap = await db
    .collection("sessions")
    .where("uid", "==", uid)
    .where("last_heartbeat", ">=", cutoff)
    .get();

  const byDevice = new Map<string, DeviceInfo>();
  let email: string | null = null;

  for (const doc of snap.docs) {
    const d = doc.data();
    if (!email && typeof d.email === "string") email = d.email;

    const deviceId = (d.device_id as string) || `legacy-${doc.id}`;
    const existing = byDevice.get(deviceId);
    const lastSeen = (d.last_heartbeat as string) || "";

    if (!existing || lastSeen > existing.lastSeenISO) {
      byDevice.set(deviceId, {
        deviceId,
        model: (d.device_model as string) || "Unknown",
        name: (d.device_name as string) || "Unknown device",
        osVersion: (d.os_version as string) || "",
        appVersion: (d.app_version as string) || "",
        lastSeenISO: lastSeen,
        lastIp: (d.ip as string) || existing?.lastIp,
      });
    }
  }

  const devices = Array.from(byDevice.values()).sort((a, b) =>
    b.lastSeenISO.localeCompare(a.lastSeenISO)
  );
  return { uid, email, deviceCount: devices.length, devices };
}

/**
 * Bulk lookup — returns a map keyed by `uid`.
 * Uses a single query per user (Firestore has no `IN` >30 limit issues here
 * since this only runs from the admin/scanner contexts at low frequency).
 */
export async function getDeviceSummaryForUsers(
  uids: string[]
): Promise<Map<string, UserDeviceSummary>> {
  const out = new Map<string, UserDeviceSummary>();
  await Promise.all(
    uids.map(async (uid) => {
      try {
        out.set(uid, await getDeviceSummaryForUser(uid));
      } catch (err) {
        console.warn(`[devices] Failed for ${uid}:`, (err as Error).message);
      }
    })
  );
  return out;
}
