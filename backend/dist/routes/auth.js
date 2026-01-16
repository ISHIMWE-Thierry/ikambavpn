"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = void 0;
const express_1 = require("express");
exports.authRouter = (0, express_1.Router)();
// Placeholder; client should use Firebase Auth SDK.
exports.authRouter.post("/anonymous", (_req, res) => {
    return res.status(501).json({ error: "Use Firebase Auth client-side" });
});
