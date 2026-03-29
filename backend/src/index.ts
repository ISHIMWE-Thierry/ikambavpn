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
import { xuiRouter } from "./routes/xui";
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

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on :${port}`));
