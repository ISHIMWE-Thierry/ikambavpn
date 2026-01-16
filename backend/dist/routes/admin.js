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
exports.adminRouter = void 0;
const express_1 = require("express");
const metrics_1 = require("../services/metrics");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.post("/metrics", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    const realMode = process.env.REAL_METRICS === "true";
    if (!realMode)
        return res.status(403).json({ error: "REAL_METRICS disabled" });
    const isAdmin = ((_a = req.user) === null || _a === void 0 ? void 0 : _a.admin) === true || ((_c = (_b = req.user) === null || _b === void 0 ? void 0 : _b.claims) === null || _c === void 0 ? void 0 : _c.admin) === true;
    if (!isAdmin)
        return res.status(403).json({ error: "admin only" });
    yield (0, metrics_1.setMetrics)(req.body);
    return res.json({ ok: true });
}));
