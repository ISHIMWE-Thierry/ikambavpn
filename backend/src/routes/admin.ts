import { Router, Request, Response } from "express";
import { setMetrics } from "../services/metrics";
import { AuthedRequest } from "../middleware/auth";

export const adminRouter = Router();

adminRouter.post("/metrics", async (req: AuthedRequest, res: Response) => {
  const realMode = process.env.REAL_METRICS === "true";
  if (!realMode) return res.status(403).json({ error: "REAL_METRICS disabled" });
  const isAdmin = (req.user as any)?.admin === true || (req.user as any)?.claims?.admin === true;
  if (!isAdmin && process.env.ALLOW_INSECURE_FIREBASE !== "true") return res.status(403).json({ error: "admin only" });
  await setMetrics(req.body);
  return res.json({ ok: true });
});
