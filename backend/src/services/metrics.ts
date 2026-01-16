import { getFirestore } from "./firebase";

export type ServerId = "USA" | "RWANDA";

export interface ServerMetrics {
  latency_ms: number;
  load_percent: number;
  stability: number;
}

export interface MetricsDocument {
  USA: ServerMetrics;
  RWANDA: ServerMetrics;
  updated_at: string;
}

const defaultMetrics: MetricsDocument = {
  USA: { latency_ms: 90, load_percent: 40, stability: 98 },
  RWANDA: { latency_ms: 45, load_percent: 55, stability: 96 },
  updated_at: new Date().toISOString(),
};

export const getMetrics = async (): Promise<MetricsDocument> => {
  const db = getFirestore();
  const docRef = db.collection("metrics").doc("servers");
  const snap = await docRef.get();
  if (!snap.exists) {
    await docRef.set(defaultMetrics);
    return defaultMetrics;
  }
  return snap.data() as MetricsDocument;
};

export const setMetrics = async (metrics: MetricsDocument) => {
  const db = getFirestore();
  const docRef = db.collection("metrics").doc("servers");
  await docRef.set({ ...metrics, updated_at: new Date().toISOString() });
};
