import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import {
  runFullAnalysis,
  chatWithAI,
  collectDatabaseSnapshot,
  type AiAnalysisResult,
  type AiChatMessage,
} from '../../lib/ai-service';
import {
  Brain,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Users,
  ShoppingBag,
  Zap,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';
import { Link } from 'react-router-dom';

// ── Section toggle hook ───────────────────────────────────────────────────
function useToggle(initial = false) {
  const [open, setOpen] = useState(initial);
  return [open, () => setOpen((v) => !v)] as const;
}

// ── Health score colour ───────────────────────────────────────────────────
function healthColor(score: number) {
  if (score >= 75) return 'text-green-600';
  if (score >= 50) return 'text-yellow-600';
  return 'text-red-600';
}
function healthBadge(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'healthy') return 'success';
  if (status === 'warning') return 'warning';
  return 'danger';
}

// ── Main page ─────────────────────────────────────────────────────────────
export function AdminAIMonitorPage() {
  const [analysis, setAnalysis] = useState<AiAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRun, setLastRun] = useState<Date | null>(null);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<AiChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [dbSnapshot, setDbSnapshot] = useState<Record<string, unknown> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Collapsible sections
  const [showUsers, toggleUsers] = useToggle(true);
  const [showOrders, toggleOrders] = useToggle(true);
  const [showTrials, toggleTrials] = useToggle(true);
  const [showActions, toggleActions] = useToggle(true);
  const [showTodo, toggleTodo] = useToggle(true);
  const [showRaw, toggleRaw] = useToggle(false);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // ── Run full analysis ─────────────────────────────────────────────────
  const handleAnalyze = async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await collectDatabaseSnapshot();
      setDbSnapshot(snapshot);
      const result = await runFullAnalysis();
      setAnalysis(result);
      setLastRun(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Chat ──────────────────────────────────────────────────────────────
  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput('');
    const userMsg: AiChatMessage = { role: 'user', content: msg };
    setChatHistory((h) => [...h, userMsg]);
    setChatLoading(true);
    try {
      const reply = await chatWithAI(msg, dbSnapshot || undefined, chatHistory);
      setChatHistory((h) => [...h, { role: 'assistant', content: reply }]);
    } catch {
      setChatHistory((h) => [
        ...h,
        { role: 'assistant', content: '⚠️ Failed to get a response. Please try again.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const a = analysis; // shorthand

  return (
    <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link to="/admin" className="text-gray-400 hover:text-black transition">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <Brain className="w-6 h-6" />
        <h1 className="text-2xl font-bold">AI Monitor</h1>
        <Badge variant="muted">Kimi K2.5</Badge>
      </div>
      <p className="text-sm text-gray-400 mb-6 ml-8">
        AI-powered analysis of your VPN business — reads all database collections in real time.
      </p>

      {/* Run button */}
      <div className="flex items-center gap-4 mb-8">
        <Button onClick={handleAnalyze} disabled={loading}>
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Run Full Analysis
            </>
          )}
        </Button>
        {lastRun && (
          <span className="text-xs text-gray-400">
            Last run: {lastRun.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 inline mr-2" />
          {error}
        </div>
      )}

      {/* ── Analysis results ─────────────────────────────────────────── */}
      {a && (
        <div className="space-y-6">
          {/* Health score */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div
                  className={`text-5xl font-black ${healthColor(a.platformHealth.score)}`}
                >
                  {a.platformHealth.score}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-lg">Platform Health</span>
                    <Badge variant={healthBadge(a.platformHealth.status)}>
                      {a.platformHealth.status}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500">{a.platformHealth.summary}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stat cards row */}
          <div className="grid sm:grid-cols-3 gap-4">
            <StatMini
              icon={Users}
              label="Total Users"
              value={a.userInsights.total}
              sub={`${a.userInsights.recentSignups} recent`}
            />
            <StatMini
              icon={ShoppingBag}
              label="Orders"
              value={a.orderInsights.total}
              sub={`${a.orderInsights.active} active`}
            />
            <StatMini
              icon={Zap}
              label="Trials"
              value={a.trialInsights.total}
              sub={`${a.trialInsights.conversionRate} conversion`}
            />
          </div>

          {/* User insights */}
          <CollapsibleCard
            title="User Insights"
            icon={Users}
            open={showUsers}
            toggle={toggleUsers}
          >
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <MiniStat label="Active subscribers" value={a.userInsights.activeSubscribers} />
              <MiniStat label="Recent signups" value={a.userInsights.recentSignups} />
              <MiniStat label="Churn risk" value={a.userInsights.churnRisk.length} />
            </div>
            {a.userInsights.churnRisk.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Churn-risk users</p>
                <div className="flex flex-wrap gap-1">
                  {a.userInsights.churnRisk.map((u, i) => (
                    <Badge key={i} variant="warning">{u}</Badge>
                  ))}
                </div>
              </div>
            )}
            <Recommendations items={a.userInsights.recommendations} />
          </CollapsibleCard>

          {/* Order insights */}
          <CollapsibleCard
            title="Order Insights"
            icon={ShoppingBag}
            open={showOrders}
            toggle={toggleOrders}
          >
            <div className="grid sm:grid-cols-4 gap-3 mb-4">
              <MiniStat label="Pending payment" value={a.orderInsights.pendingPayment} />
              <MiniStat label="Active" value={a.orderInsights.active} />
              <MiniStat label="Expired" value={a.orderInsights.expired} />
              <MiniStat label="Revenue est." value={`$${a.orderInsights.revenueEstimate}`} />
            </div>
            {a.orderInsights.bottlenecks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Bottlenecks</p>
                <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                  {a.orderInsights.bottlenecks.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </CollapsibleCard>

          {/* Trial insights */}
          <CollapsibleCard
            title="Trial Insights"
            icon={Zap}
            open={showTrials}
            toggle={toggleTrials}
          >
            <div className="grid sm:grid-cols-3 gap-3 mb-4">
              <MiniStat label="Total" value={a.trialInsights.total} />
              <MiniStat label="Active" value={a.trialInsights.active} />
              <MiniStat label="Conversion" value={a.trialInsights.conversionRate} />
            </div>
            <Recommendations items={a.trialInsights.recommendations} />
          </CollapsibleCard>

          {/* Urgent actions */}
          <CollapsibleCard
            title={`Urgent Actions (${a.urgentActions.length})`}
            icon={AlertTriangle}
            open={showActions}
            toggle={toggleActions}
          >
            {a.urgentActions.length === 0 ? (
              <p className="text-sm text-gray-400">No urgent actions needed 🎉</p>
            ) : (
              <div className="space-y-3">
                {a.urgentActions
                  .sort((x, y) => x.priority - y.priority)
                  .map((act, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl"
                    >
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          act.priority <= 2
                            ? 'bg-red-100 text-red-700'
                            : act.priority <= 3
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        P{act.priority}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{act.action}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{act.details}</p>
                        <Badge variant="muted" className="mt-1">{act.category}</Badge>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CollapsibleCard>

          {/* Admin todo list */}
          <CollapsibleCard
            title={`Admin To-Do (${a.adminTodoList.length})`}
            icon={CheckCircle}
            open={showTodo}
            toggle={toggleTodo}
          >
            {a.adminTodoList.length === 0 ? (
              <p className="text-sm text-gray-400">All clear!</p>
            ) : (
              <div className="space-y-2">
                {a.adminTodoList.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <Badge
                      variant={
                        t.priority === 'high'
                          ? 'danger'
                          : t.priority === 'medium'
                          ? 'warning'
                          : 'muted'
                      }
                    >
                      {t.priority}
                    </Badge>
                    <span className="text-sm flex-1">{t.item}</span>
                    <span className="text-xs text-gray-400">{t.deadline}</span>
                  </div>
                ))}
              </div>
            )}
          </CollapsibleCard>

          {/* Weekly forecast */}
          {a.weeklyForecast && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Weekly Forecast
                </h3>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 leading-relaxed">{a.weeklyForecast}</p>
              </CardContent>
            </Card>
          )}

          {/* Raw response */}
          <CollapsibleCard
            title="Raw AI Response"
            icon={Brain}
            open={showRaw}
            toggle={toggleRaw}
          >
            <pre className="text-xs bg-gray-50 p-4 rounded-xl overflow-auto max-h-64 whitespace-pre-wrap">
              {a.rawResponse || 'No raw response.'}
            </pre>
          </CollapsibleCard>
        </div>
      )}

      {/* ── AI Chat ──────────────────────────────────────────────────── */}
      <div className="mt-10">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Brain className="w-5 h-5" /> Chat with Ikamba AI
        </h2>
        <Card>
          <CardContent className="pt-4">
            {/* Messages */}
            <div className="h-72 overflow-y-auto mb-4 space-y-3">
              {chatHistory.length === 0 && (
                <p className="text-sm text-gray-400 text-center pt-20">
                  Ask anything about your VPN business — users, orders, revenue, suggestions…
                </p>
              )}
              {chatHistory.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-black text-white rounded-br-md'
                        : 'bg-gray-100 text-gray-800 rounded-bl-md'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 px-4 py-3 rounded-2xl rounded-bl-md">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={handleChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about users, orders, revenue…"
                className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              />
              <Button type="submit" disabled={chatLoading || !chatInput.trim()}>
                <Send className="w-4 h-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// ── Small helper components ─────────────────────────────────────────────

function StatMini({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="border border-gray-100 rounded-2xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xl font-bold leading-none">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{label}</p>
        <p className="text-[10px] text-gray-300">{sub}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}

function Recommendations({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">Recommendations</p>
      <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
        {items.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}

function CollapsibleCard({
  title,
  icon: Icon,
  open,
  toggle,
  children,
}: {
  title: string;
  icon: React.ElementType;
  open: boolean;
  toggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50/50 transition rounded-t-2xl"
      >
        <span className="font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4" /> {title}
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {open && <CardContent>{children}</CardContent>}
    </Card>
  );
}
