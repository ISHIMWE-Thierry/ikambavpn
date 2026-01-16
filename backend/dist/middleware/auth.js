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
exports.authMiddleware = void 0;
const firebase_1 = require("../services/firebase");
const authMiddleware = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    const authHeader = req.headers.authorization;
    if (!(authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))) {
        return res.status(401).json({ error: "Missing token" });
    }
    const token = authHeader.replace("Bearer ", "");
    try {
        const decoded = yield (0, firebase_1.verifyIdToken)(token);
        req.user = Object.assign(Object.assign({}, decoded), { uid: decoded.uid });
        return next();
    }
    catch (err) {
        console.error("Auth error", err);
        return res.status(401).json({ error: "Invalid token" });
    }
});
exports.authMiddleware = authMiddleware;
