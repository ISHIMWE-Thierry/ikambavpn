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
import { adminSubscriptionsRouter } from "./routes/adminSubscriptions";
import { adminCustomersRouter } from "./routes/adminCustomers";
import {
  xuiRouter,
  xuiPublicRouter,
  publicSubscriptionHandler,
  publicSubscriptionRedirectHandler,
} from "./routes/xui";
import { initFirebase } from "./services/firebase";
import { authMiddleware } from "./middleware/auth";
import { startWatchdog } from "./services/watchdog";
import { startAnalyticsScheduler } from "./services/vpn-analytics";
import { startRenewalScanner } from "./services/renewalScanner";

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
app.use("/admin", authMiddleware, adminSubscriptionsRouter);
app.use("/admin", authMiddleware, adminCustomersRouter);
app.get("/happ", (_req, res) => res.redirect(302, "/xui-public/happ")); // short one-tap alias
app.get("/sub/:identifier", publicSubscriptionHandler); // Legacy root subscription URL
app.get("/subscription/:identifier", publicSubscriptionRedirectHandler); // Legacy root subscription redirect
app.use("/xui", xuiPublicRouter); // Legacy public subscription paths, no auth
app.use("/xui", authMiddleware, xuiRouter);
app.use("/xui-public", xuiPublicRouter);  // No auth — V2RayTun calls this directly

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on :${port}`);

  // Start VPN watchdog — re-enables disabled clients, fixes limitIp, restarts Xray
  startWatchdog();

  // Start analytics scheduler — snapshots online status + daily activity to Firestore
  startAnalyticsScheduler();

  // Start renewal scanner — emails users whose subscriptions expire in <5 days
  // (every 6h, with anti-spam guards). Does NOT touch x-ui or any inbound.
  startRenewalScanner();

  // Startup health check — verify 3X-UI panel is reachable
  const panelUrl = process.env.XPANEL_URL || "";
  if (panelUrl) {
    fetch(`${panelUrl}/`, {
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
