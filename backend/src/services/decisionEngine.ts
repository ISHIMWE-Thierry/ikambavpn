import geoip from "geoip-lite";
import { MetricsDocument, ServerId } from "./metrics";

export interface DecisionInput {
  userIp?: string;
  metrics: MetricsDocument;
}

export interface DecisionResult {
  server: ServerId;
  scores: Record<ServerId, number>;
  user_country?: string;
}

const scoreServer = (metrics: { latency_ms: number; load_percent: number; stability: number }) => {
  return (100 - metrics.latency_ms) * 0.5 + (100 - metrics.load_percent) * 0.3 + metrics.stability * 0.2;
};

export const decideServer = ({ userIp, metrics }: DecisionInput): DecisionResult => {
  const geo = userIp ? geoip.lookup(userIp) : null;
  const country = geo?.country || "UNKNOWN";
  const preferred: ServerId = country === "RW" ? "USA" : "RWANDA";

  const scores: Record<ServerId, number> = {
    USA: scoreServer(metrics.USA),
    RWANDA: scoreServer(metrics.RWANDA),
  };

  const chosen = scores[preferred] >= 60
    ? preferred
    : (scores.USA >= scores.RWANDA ? "USA" : "RWANDA");

  return { server: chosen, scores, user_country: country };
};
