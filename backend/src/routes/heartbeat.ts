import { Router, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { getFirestore } from "../services/firebase";

export const heartbeatRouter = Router();

heartbeatRouter.post("/heartbeat", async (req: AuthedRequest, res: Response) => {
  const { session_id, status, local_ping_ms } = req.body || {};
  if (!session_id) return res.status(400).json({ error: "session_id required" });
  const db = getFirestore?.();
  if (db) {
    await db.collection("sessions").doc(session_id).set(
      {
        status,
        last_heartbeat: new Date().toISOString(),
        local_ping_ms,
      },
      { merge: true }
    );
  }
  return res.json({ ok: true });
});
