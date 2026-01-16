import { Router, Request, Response } from "express";
import { getMetrics } from "../services/metrics";

export const metricsRouter = Router();

metricsRouter.get("/metrics", async (_req: Request, res: Response) => {
  const metrics = await getMetrics();
  return res.json(metrics);
});
