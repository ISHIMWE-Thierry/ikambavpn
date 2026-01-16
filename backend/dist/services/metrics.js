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
exports.setMetrics = exports.getMetrics = void 0;
const firebase_1 = require("./firebase");
const defaultMetrics = {
    USA: { latency_ms: 90, load_percent: 40, stability: 98 },
    RWANDA: { latency_ms: 45, load_percent: 55, stability: 96 },
    updated_at: new Date().toISOString(),
};
const getMetrics = () => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, firebase_1.getFirestore)();
    const docRef = db.collection("metrics").doc("servers");
    const snap = yield docRef.get();
    if (!snap.exists) {
        yield docRef.set(defaultMetrics);
        return defaultMetrics;
    }
    return snap.data();
});
exports.getMetrics = getMetrics;
const setMetrics = (metrics) => __awaiter(void 0, void 0, void 0, function* () {
    const db = (0, firebase_1.getFirestore)();
    const docRef = db.collection("metrics").doc("servers");
    yield docRef.set(Object.assign(Object.assign({}, metrics), { updated_at: new Date().toISOString() }));
});
exports.setMetrics = setMetrics;
