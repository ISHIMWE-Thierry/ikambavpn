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
exports.heartbeatRouter = void 0;
const express_1 = require("express");
const firebase_1 = require("../services/firebase");
exports.heartbeatRouter = (0, express_1.Router)();
exports.heartbeatRouter.post("/heartbeat", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { session_id, status, local_ping_ms } = req.body || {};
    if (!session_id)
        return res.status(400).json({ error: "session_id required" });
    const db = (0, firebase_1.getFirestore)();
    yield db.collection("sessions").doc(session_id).set({
        status,
        last_heartbeat: new Date().toISOString(),
        local_ping_ms,
    }, { merge: true });
    return res.json({ ok: true });
}));
