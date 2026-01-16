"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideServer = void 0;
const geoip_lite_1 = __importDefault(require("geoip-lite"));
const scoreServer = (metrics) => {
    return (100 - metrics.latency_ms) * 0.5 + (100 - metrics.load_percent) * 0.3 + metrics.stability * 0.2;
};
const decideServer = ({ userIp, metrics }) => {
    const geo = userIp ? geoip_lite_1.default.lookup(userIp) : null;
    const country = (geo === null || geo === void 0 ? void 0 : geo.country) || "UNKNOWN";
    const preferred = country === "RW" ? "USA" : "RWANDA";
    const scores = {
        USA: scoreServer(metrics.USA),
        RWANDA: scoreServer(metrics.RWANDA),
    };
    const chosen = scores[preferred] >= 60
        ? preferred
        : (scores.USA >= scores.RWANDA ? "USA" : "RWANDA");
    return { server: chosen, scores, user_country: country };
};
exports.decideServer = decideServer;
