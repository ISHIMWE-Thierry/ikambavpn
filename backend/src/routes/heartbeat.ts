import { Router, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { getFirestore } from "../services/firebase";

export const heartbeatRouter = Router();

/**
 * POST /connection/heartbeat
 *
 * Accepts (all optional except session_id):
 *   session_id, status, local_ping_ms,
 *   device_id (identifierForVendor), device_model, device_name,
 *   os_version, app_version
 *
 * Stores under `sessions/{session_id}` with `uid` and `email` from auth so
 * the admin device-summary scanner can group by user.
 */
heartbeatRouter.post("/heartbeat", async (req: AuthedRequest, res: Response) => {
  const {
    session_id,
    status,
    local_ping_ms,
    device_id,
    device_model,
    device_name,
    os_version,
    app_version,
  } = req.body || {};
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  const db = getFirestore?.();
  if (db) {
    const user = req.user as { uid?: string; email?: string } | undefined;
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    const payload: Record<string, unknown> = {
      status,
      last_heartbeat: new Date().toISOString(),
      local_ping_ms,
      uid: user?.uid || null,
      email: user?.email || null,
      ip,
    };
    if (device_id) payload.device_id = device_id;
    if (device_model) payload.device_model = device_model;
    if (device_name) payload.device_name = device_name;
    if (os_version) payload.os_version = os_version;
    if (app_version) payload.app_version = app_version;

    await db.collection("sessions").doc(session_id).set(payload, { merge: true });
  }
  return res.json({ ok: true });
});

