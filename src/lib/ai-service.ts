/**
 * AI Service — NVIDIA Kimi K2.5 integration for VPN business intelligence.
 *
 * Reads all Firestore collections and sends a structured snapshot to the AI
 * for analysis. Returns actionable insights for the admin.
 *
 * Model: moonshotai/kimi-k2.5 via NVIDIA NIM (free tier)
 */

import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  where,
  Timestamp,
} from 'firebase/firestore';
import { db, COLLECTIONS } from './firebase';

// ── Config ────────────────────────────────────────────────────────────────
const NVIDIA_API_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_API_KEY =
  import.meta.env.VITE_NVIDIA_API_KEY ||
  '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';
const MODEL = 'moonshotai/kimi-k2.5';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AiAnalysisResult {
  platformHealth: {
    score: number; // 0-100
    status: 'healthy' | 'warning' | 'critical';
    summary: string;
  };
  userInsights: {
    total: number;
    recentSignups: number;
    activeSubscribers: number;
    churnRisk: string[];
    recommendations: string[];
  };
  orderInsights: {
    total: number;
    pendingPayment: number;
    active: number;
    expired: number;
    revenueEstimate: number;
    bottlenecks: string[];
  };
  trialInsights: {
    total: number;
    active: number;
    conversionRate: string;
    recommendations: string[];
  };
  urgentActions: {
    action: string;
    priority: number;
    category: string;
    details: string;
  }[];
  adminTodoList: {
    item: string;
    priority: 'high' | 'medium' | 'low';
    deadline: string;
  }[];
  weeklyForecast: string;
  rawResponse?: string;
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function tsToString(ts: unknown): string {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  if (ts instanceof Timestamp) return ts.toDate().toISOString();
  return '';
}

function summarizeUser(d: Record<string, unknown>) {
  return {
    email: d.email || '',
    name: `${d.firstname || ''} ${d.lastname || ''}`.trim() || d.displayName || '',
    role: d.role || 'user',
    status: d.accountStatus || 'active',
    paymentStatus: d.paymentstatus || 'False',
    lastLogin: tsToString(d.last_login || d.lastLoginAt),
    createdAt: tsToString(d.createdAt),
  };
}

function summarizeOrder(d: Record<string, unknown>) {
  return {
    planName: d.planName || '',
    amount: d.amount || 0,
    currency: d.currency || '',
    status: d.status || '',
    paymentMethod: d.paymentMethod || '',
    hasProof: !!d.paymentProofUrl,
    activatedAt: tsToString(d.activatedAt),
    expiresAt: tsToString(d.expiresAt),
    createdAt: tsToString(d.createdAt),
  };
}

function summarizeTrial(d: Record<string, unknown>) {
  return {
    userEmail: d.userEmail || '',
    status: d.status || '',
    expiresAt: tsToString(d.expiresAt),
    createdAt: tsToString(d.createdAt),
  };
}

// ── Snapshot collector ────────────────────────────────────────────────────

export async function collectDatabaseSnapshot(): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();

  // Users (limit 200 most recent)
  const usersSnap = await getDocs(
    query(collection(db, COLLECTIONS.USERS), limit(200))
  );
  const users = usersSnap.docs.map((d) => summarizeUser(d.data()));

  // Orders (limit 200 most recent)
  const ordersSnap = await getDocs(
    query(collection(db, COLLECTIONS.ORDERS), orderBy('createdAt', 'desc'), limit(200))
  );
  const orders = ordersSnap.docs.map((d) => summarizeOrder(d.data()));

  // Trials (limit 100)
  const trialsSnap = await getDocs(
    query(collection(db, COLLECTIONS.TRIALS), orderBy('createdAt', 'desc'), limit(100))
  );
  const trials = trialsSnap.docs.map((d) => summarizeTrial(d.data()));

  // Payment accounts
  const paSnap = await getDocs(collection(db, COLLECTIONS.PAYMENT_ACCOUNTS));
  const paymentAccounts = paSnap.docs.map((d) => {
    const data = d.data();
    return { method: data.method, provider: data.provider, active: data.active };
  });

  // Plans
  const plansSnap = await getDocs(collection(db, 'vpn_plans'));
  const plans = plansSnap.docs.map((d) => {
    const data = d.data();
    return { name: data.name, price: data.price, currency: data.currency, duration: data.duration };
  });

  return {
    collectedAt: now,
    summary: {
      totalUsers: users.length,
      totalOrders: orders.length,
      totalTrials: trials.length,
      totalPaymentAccounts: paymentAccounts.length,
      totalPlans: plans.length,
    },
    users,
    orders,
    trials,
    paymentAccounts,
    plans,
  };
}

// ── NVIDIA API call ───────────────────────────────────────────────────────

async function callKimi(messages: AiChatMessage[]): Promise<string> {
  const res = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: 8192,
      temperature: 0.7,
      top_p: 0.95,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`NVIDIA API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Full analysis ─────────────────────────────────────────────────────────

export async function runFullAnalysis(): Promise<AiAnalysisResult> {
  const snapshot = await collectDatabaseSnapshot();

  const systemPrompt = `You are Ikamba AI — the intelligent operations manager for Ikamba VPN, a VPN service business. You have access to the complete database snapshot below.

Your job is to analyze the data and provide actionable insights to the admin. Be specific with numbers and names. Be concise but thorough. Think like a COO/CTO hybrid.

IMPORTANT: Respond ONLY with valid JSON matching this exact schema:
{
  "platformHealth": { "score": number(0-100), "status": "healthy"|"warning"|"critical", "summary": "brief" },
  "userInsights": { "total": number, "recentSignups": number, "activeSubscribers": number, "churnRisk": ["email1", ...], "recommendations": ["...", ...] },
  "orderInsights": { "total": number, "pendingPayment": number, "active": number, "expired": number, "revenueEstimate": number, "bottlenecks": ["...", ...] },
  "trialInsights": { "total": number, "active": number, "conversionRate": "X%", "recommendations": ["...", ...] },
  "urgentActions": [{ "action": "...", "priority": 1-5, "category": "users|orders|trials|security|growth", "details": "..." }],
  "adminTodoList": [{ "item": "...", "priority": "high|medium|low", "deadline": "today|this week|this month" }],
  "weeklyForecast": "Brief paragraph about what to expect this week"
}`;

  const userPrompt = `Here is the current database snapshot for Ikamba VPN (${new Date().toLocaleDateString()}):

${JSON.stringify(snapshot, null, 2)}

Analyze everything and provide your complete analysis as JSON.`;

  const raw = await callKimi([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  // Parse JSON from response (may be wrapped in markdown code blocks)
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return { ...parsed, rawResponse: raw } as AiAnalysisResult;
  } catch {
    // Return a fallback with the raw response
    return {
      platformHealth: { score: 0, status: 'warning', summary: 'AI response could not be parsed. See raw response.' },
      userInsights: { total: 0, recentSignups: 0, activeSubscribers: 0, churnRisk: [], recommendations: [] },
      orderInsights: { total: 0, pendingPayment: 0, active: 0, expired: 0, revenueEstimate: 0, bottlenecks: [] },
      trialInsights: { total: 0, active: 0, conversionRate: '0%', recommendations: [] },
      urgentActions: [],
      adminTodoList: [],
      weeklyForecast: '',
      rawResponse: raw,
    };
  }
}

// ── Chat with AI (context-aware) ──────────────────────────────────────────

export async function chatWithAI(
  userMessage: string,
  dbSnapshot?: Record<string, unknown>,
  history: AiChatMessage[] = [],
): Promise<string> {
  const snapshot = dbSnapshot || await collectDatabaseSnapshot();

  const systemPrompt = `You are Ikamba AI — the intelligent assistant for Ikamba VPN business. You have full access to the database.

Current database state:
${JSON.stringify(snapshot, null, 2)}

Answer the admin's question accurately and concisely. If they ask about specific users, orders, or metrics, refer to the actual data. Be helpful and actionable.`;

  const messages: AiChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  return callKimi(messages);
}
