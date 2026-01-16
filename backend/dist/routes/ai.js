"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiRouter = void 0;
const express_1 = require("express");
const decisionEngine_1 = require("../services/decisionEngine");
const metrics_1 = require("../services/metrics");
const firebase_1 = require("../services/firebase");
const providers_1 = require("../services/providers");
exports.aiRouter = (0, express_1.Router)();
exports.aiRouter.post("/smart-connect", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const metrics = yield (0, metrics_1.getMetrics)();
        const userIp = ((_a = req.headers["x-forwarded-for"]) === null || _a === void 0 ? void 0 : _a.split(",")[0]) || req.socket.remoteAddress || undefined;
        const decision = (0, decisionEngine_1.decideServer)({ userIp, metrics });
        const wgConfig = (0, providers_1.getProviderWGConfig)(decision.server);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        const db = (0, firebase_1.getFirestore)();
        const sessionId = db.collection("sessions").doc().id;
        yield db.collection("sessions").doc(sessionId).set({
            user_id: (_b = req.user) === null || _b === void 0 ? void 0 : _b.uid,
            server: decision.server,
            status: "connected",
            started_at: new Date().toISOString(),
            last_heartbeat: new Date().toISOString(),
        });
        yield db.collection("decisions").doc().set({
            user_id: (_c = req.user) === null || _c === void 0 ? void 0 : _c.uid,
            user_country: decision.user_country,
            chosen_server: decision.server,
            scores: decision.scores,
            timestamp: new Date().toISOString(),
        });
        return res.json({
            session_id: sessionId,
            server: decision.server,
            wg_config: wgConfig,
            expires_at: expiresAt,
        });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ error: "smart-connect failed" });
    }
}));
