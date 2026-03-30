import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import { json } from "express";
import { authRouter } from "./routes/auth";
import { aiRouter } from "./routes/ai";
import { metricsRouter } from "./routes/metrics";
import { heartbeatRouter } from "./routes/heartbeat";
import { adminRouter } from "./routes/admin";
import { xuiRouter, xuiPublicRouter } from "./routes/xui";
import { initFirebase } from "./services/firebase";
import { authMiddleware } from "./middleware/auth";

dotenv.config();

initFirebase();

const app = express();
app.use(helmet());
app.use(cors());
app.use(json());
app.use(morgan("dev"));

app.get("/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/ai", authMiddleware, aiRouter);
app.use("/servers", metricsRouter);
app.use("/connection", authMiddleware, heartbeatRouter);
app.use("/admin", authMiddleware, adminRouter);
app.use("/xui", authMiddleware, xuiRouter);
app.use("/xui-public", xuiPublicRouter);  // No auth — V2RayTun calls this directly

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on :${port}`);

  // Startup health check — verify 3X-UI panel is reachable
  const panelUrl = process.env.XPANEL_URL || "";
  if (panelUrl) {
    fetch(`${panelUrl}/server/status`, {
      headers: { Accept: "application/json" },
    })
      .then((res) => {
        if (res.ok || res.status === 401) {
          console.log(`✅ 3X-UI panel reachable at ${panelUrl}`);
        } else {
          console.warn(`⚠️ 3X-UI panel returned ${res.status} at ${panelUrl} — check XPANEL_URL`);
        }
      })
      .catch((err) => {
        console.error(
          `❌ Cannot reach 3X-UI panel at ${panelUrl} — VLESS features will not work!\n` +
          `   Error: ${err.message}\n` +
          `   Fix: check XPANEL_URL in .env, ensure port matches (run 'x-ui setting -show' on VPS)`
        );
      });
  } else {
    console.warn("⚠️ XPANEL_URL not set — VLESS+REALITY features are disabled");
  }
});
