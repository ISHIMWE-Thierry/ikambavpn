import { Router, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { decideServer } from "../services/decisionEngine";
import { getMetrics } from "../services/metrics";
import { getFirestore } from "../services/firebase";
import { getProviderWGConfig } from "../services/providers";

export const aiRouter = Router();

aiRouter.post("/smart-connect", async (req: AuthedRequest, res: Response) => {
  try {
  const metrics = await getMetrics();
    const userIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0] || req.socket.remoteAddress || undefined;
    const decision = decideServer({ userIp, metrics });
    const wgConfig = getProviderWGConfig(decision.server);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const db = getFirestore?.();
    let sessionId = "mock-session";

    if (db) {
      sessionId = db.collection("sessions").doc().id;
      await db.collection("sessions").doc(sessionId).set({
        user_id: req.user?.uid,
        server: decision.server,
        status: "connected",
        started_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
      });

      await db.collection("decisions").doc().set({
        user_id: req.user?.uid,
        user_country: decision.user_country,
        chosen_server: decision.server,
        scores: decision.scores,
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      session_id: sessionId,
      server: decision.server,
      wg_config: wgConfig,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "smart-connect failed" });
  }
});
