import { Router, Response } from "express";
import { AuthedRequest } from "../middleware/auth";
import { decideServer } from "../services/decisionEngine";
import { getMetrics } from "../services/metrics";
import { getFirestore } from "../services/firebase";
import { getProviderWGConfig } from "../services/providers";

export const aiRouter = Router();

// ── NVIDIA Kimi K2.5 proxy (avoids CORS) ──────────────────────────────

const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_API_KEY =
  process.env.NVIDIA_API_KEY ||
  "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";

aiRouter.post("/chat", async (req: AuthedRequest, res: Response) => {
  try {
    const { messages, max_tokens, temperature, top_p } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const nvidiaRes = await fetch(NVIDIA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
      },
      body: JSON.stringify({
        model: "moonshotai/kimi-k2.5",
        messages,
        max_tokens: max_tokens || 8192,
        temperature: temperature ?? 0.7,
        top_p: top_p ?? 0.95,
      }),
    });

    if (!nvidiaRes.ok) {
      const errText = await nvidiaRes.text();
      console.error(`NVIDIA API error ${nvidiaRes.status}:`, errText);
      return res
        .status(nvidiaRes.status)
        .json({ error: `NVIDIA API error: ${nvidiaRes.status}`, details: errText });
    }

    const data = await nvidiaRes.json();
    return res.json(data);
  } catch (err: any) {
    console.error("AI chat proxy error:", err);
    return res.status(500).json({ error: err.message || "AI proxy failed" });
  }
});

// ── Smart connect (existing) ──────────────────────────────────────────

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
