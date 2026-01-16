import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config({ path: "../backend/.env" });

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Missing Firebase env vars");
}

admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});

const db = admin.firestore();

async function main() {
  await db.collection("metrics").doc("servers").set({
    USA: { latency_ms: 90, load_percent: 40, stability: 98 },
    RWANDA: { latency_ms: 45, load_percent: 55, stability: 96 },
    updated_at: new Date().toISOString(),
  });
  console.log("Seeded metrics." );
  process.exit(0);
}

main();
