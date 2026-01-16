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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyIdToken = exports.getFirestore = exports.initFirebase = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
let initialized = false;
const initFirebase = () => {
    var _a;
    if (initialized)
        return;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = (_a = process.env.FIREBASE_PRIVATE_KEY) === null || _a === void 0 ? void 0 : _a.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error("Missing Firebase credentials env vars");
    }
    firebase_admin_1.default.initializeApp({
        credential: firebase_admin_1.default.credential.cert({
            projectId,
            clientEmail,
            privateKey,
        }),
    });
    initialized = true;
};
exports.initFirebase = initFirebase;
const getFirestore = () => {
    if (!initialized)
        (0, exports.initFirebase)();
    return firebase_admin_1.default.firestore();
};
exports.getFirestore = getFirestore;
const verifyIdToken = (token) => __awaiter(void 0, void 0, void 0, function* () {
    if (!initialized)
        (0, exports.initFirebase)();
    return firebase_admin_1.default.auth().verifyIdToken(token);
});
exports.verifyIdToken = verifyIdToken;
