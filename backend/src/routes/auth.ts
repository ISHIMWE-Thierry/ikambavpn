import { Router, Request, Response } from "express";

export const authRouter = Router();

// Placeholder; client should use Firebase Auth SDK.
authRouter.post("/anonymous", (_req: Request, res: Response) => {
  return res.status(501).json({ error: "Use Firebase Auth client-side" });
});
