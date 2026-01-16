import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config();

let initialized = false;
const insecure = process.env.ALLOW_INSECURE_FIREBASE === "true";

export const initFirebase = () => {
  if (initialized || insecure) return;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase credentials env vars");
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
  initialized = true;
};

export const getFirestore = () => {
  if (insecure) {
    throw new Error("Firestore unavailable in insecure mode");
  }
  if (!initialized) initFirebase();
  return admin.firestore();
};

export const verifyIdToken = async (token: string) => {
  if (insecure) {
    return { uid: "dev-user", token } as any;
  }
  if (!initialized) initFirebase();
  return admin.auth().verifyIdToken(token);
};
