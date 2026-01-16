import { Request, Response, NextFunction } from "express";
import { verifyIdToken } from "../services/firebase";

export interface AuthedRequest extends Request {
  user?: { uid: string; [key: string]: any };
}

export const authMiddleware = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing token" });
  }
  const token = authHeader.replace("Bearer ", "");
  try {
  const decoded = await verifyIdToken(token);
  req.user = { ...decoded, uid: decoded.uid };
    return next();
  } catch (err) {
    console.error("Auth error", err);
    return res.status(401).json({ error: "Invalid token" });
  }
};
