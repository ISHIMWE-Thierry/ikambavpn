/**
 * x-ui Customer Aggregation
 *
 * 3X-UI counts every Xray client config as a row, but a single paying customer
 * normally has 3 configs (default REALITY, -ws WebSocket, -yt social). This
 * service collapses configs back into real customers.
 *
 * Suffix scheme used by provisionUser():
 *   user@example.com         → default REALITY (inbound 1)
 *   user@example.com-ws      → WebSocket (inbound 3)
 *   user@example.com-yt      → social-optimised (inbound on stockholm)
 *
 * We strip those suffixes to derive the "base email" that identifies the
 * customer, then group all configs under that key.
 */
import { listInbounds, XuiClientStat, XuiInbound } from "./xui";

/** Known suffix tags we append to a base email when provisioning extra inbounds. */
const SUFFIX_TAGS = ["-ws", "-yt", "-xtls", "-reality", "-social"] as const;

/** Map inbound id/protocol to a friendlier "kind" for the dashboard. */
function configKindFor(inbound: XuiInbound, clientEmail: string): string {
  // Suffix takes priority — most reliable signal.
  for (const tag of SUFFIX_TAGS) {
    if (clientEmail.endsWith(tag)) return tag.slice(1); // "ws" / "yt" / "xtls"
  }
  // Fall back to inbound metadata.
  const remark = (inbound.remark || "").toLowerCase();
  if (remark.includes("ws") || inbound.port === 2083) return "ws";
  if (remark.includes("social") || remark.includes("yt") || inbound.port === 2087)
    return "yt";
  if (remark.includes("xhttp") || inbound.port === 8443) return "xhttp";
  return "vless"; // default REALITY tcp
}

/**
 * Strip provisioning suffix to recover the original customer email.
 * Returns the base email (lowercased, trimmed). Robust to weird inputs.
 */
export function deriveBaseEmail(clientEmail: string): string {
  let e = (clientEmail || "").trim().toLowerCase();
  for (const tag of SUFFIX_TAGS) {
    if (e.endsWith(tag)) {
      e = e.slice(0, -tag.length);
      break; // only one tag expected
    }
  }
  return e;
}

export interface XuiConfigRow {
  inboundId: number;
  inboundRemark: string;
  inboundPort: number;
  kind: string; // vless / ws / yt / xhttp
  email: string; // raw email in x-ui (with suffix)
  enable: boolean;
  up: number;
  down: number;
  total: number;
  expiryTime: number; // epoch ms; 0 = never
}

export interface XuiCustomer {
  email: string; // base email (no suffix)
  configs: XuiConfigRow[];
  configCount: number;
  /** OR across configs: if any config is enabled, customer is at least partially enabled. */
  anyEnabled: boolean;
  /** All configs enabled. */
  allEnabled: boolean;
  /** earliest expiryTime across enabled configs (0 means "never"; ignored). */
  earliestExpiry: number | null;
  /** latest expiryTime across all configs. */
  latestExpiry: number | null;
  /** total bytes (up+down) across configs. */
  totalUsageBytes: number;
  /**
   * Strict status logic the user asked for:
   *   if (expiry && expiry < now) → expired
   *   else if (!anyEnabled)       → disabled
   *   else                        → active
   */
  status: "expired" | "disabled" | "active" | "never_expires";
  daysLeft: number | null;
}

export interface XuiCustomerSnapshot {
  generatedAt: string;
  inbounds: Array<{ id: number; remark: string; port: number; clientCount: number }>;
  totals: {
    totalConfigs: number;
    uniqueCustomers: number;
    activeCustomers: number;
    disabledCustomers: number;
    expiredCustomers: number;
    neverExpiresCustomers: number;
    expiringIn3Days: number;
    expiringIn7Days: number;
    /** Configs broken down by kind. */
    configsByKind: Record<string, number>;
  };
  alerts: {
    /** Configs whose expiryTime is in the past, but `enable` is still true. */
    expiredButEnabled: XuiCustomer[];
    /** Customers active with 0 bytes used → paid but never connected / setup help. */
    activeButZeroUsage: XuiCustomer[];
    /** Any config has up+down > 50 GB. */
    highTrafficUsers: XuiCustomer[];
    /** Configs whose base email doesn't match any other config — orphan profiles. */
    orphanConfigs: XuiCustomer[];
  };
  customers: XuiCustomer[];
}

/**
 * Pull every client across every inbound and reduce to a customer-level view.
 * This is read-only and safe to call frequently. Inbound fetch is the slowest
 * part (one HTTP call per inbound), so we parallelise.
 */
export async function buildXuiCustomerSnapshot(): Promise<XuiCustomerSnapshot> {
  const inbounds = await listInbounds();
  const now = Date.now();

  // Group rows by base email.
  const byEmail = new Map<string, XuiConfigRow[]>();
  const inboundSummaries: XuiCustomerSnapshot["inbounds"] = [];
  const configsByKind: Record<string, number> = {};

  for (const ib of inbounds) {
    const stats = ib.clientStats || [];
    inboundSummaries.push({
      id: ib.id,
      remark: ib.remark,
      port: ib.port,
      clientCount: stats.length,
    });

    for (const s of stats) {
      const kind = configKindFor(ib, s.email);
      configsByKind[kind] = (configsByKind[kind] || 0) + 1;
      const base = deriveBaseEmail(s.email);
      const row: XuiConfigRow = {
        inboundId: ib.id,
        inboundRemark: ib.remark,
        inboundPort: ib.port,
        kind,
        email: s.email,
        enable: !!s.enable,
        up: s.up || 0,
        down: s.down || 0,
        total: s.total || 0,
        expiryTime: s.expiryTime || 0,
      };
      if (!byEmail.has(base)) byEmail.set(base, []);
      byEmail.get(base)!.push(row);
    }
  }

  // Build customer aggregates.
  const customers: XuiCustomer[] = [];
  for (const [base, rows] of byEmail.entries()) {
    const anyEnabled = rows.some((r) => r.enable);
    const allEnabled = rows.every((r) => r.enable);

    // Treat 0 as "never expires" — only consider positive expiry times.
    const positiveExpiries = rows
      .filter((r) => r.expiryTime > 0)
      .map((r) => r.expiryTime);
    const earliestExpiry = positiveExpiries.length
      ? Math.min(...positiveExpiries)
      : null;
    const latestExpiry = positiveExpiries.length
      ? Math.max(...positiveExpiries)
      : null;
    const totalUsageBytes = rows.reduce((sum, r) => sum + r.up + r.down, 0);

    // Strict status — uses LATEST expiry as "true" expiry (user may have renewed
    // one inbound but not all). If even one inbound is still in the future and
    // enabled, customer can still connect.
    let status: XuiCustomer["status"];
    if (positiveExpiries.length === 0) {
      status = anyEnabled ? "never_expires" : "disabled";
    } else if (latestExpiry !== null && latestExpiry < now) {
      status = "expired";
    } else if (!anyEnabled) {
      status = "disabled";
    } else {
      status = "active";
    }

    const daysLeft =
      latestExpiry !== null
        ? Math.floor((latestExpiry - now) / (24 * 60 * 60 * 1000))
        : null;

    customers.push({
      email: base,
      configs: rows,
      configCount: rows.length,
      anyEnabled,
      allEnabled,
      earliestExpiry,
      latestExpiry,
      totalUsageBytes,
      status,
      daysLeft,
    });
  }

  // Sort: active first (by daysLeft asc), then expiring soon, then expired.
  customers.sort((a, b) => {
    const order = (c: XuiCustomer) =>
      c.status === "active" ? 0 : c.status === "never_expires" ? 1 : c.status === "expired" ? 2 : 3;
    const oa = order(a);
    const ob = order(b);
    if (oa !== ob) return oa - ob;
    const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
    const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
    return da - db;
  });

  // Compute aggregate counts.
  const activeCustomers = customers.filter((c) => c.status === "active").length;
  const disabledCustomers = customers.filter((c) => c.status === "disabled").length;
  const expiredCustomers = customers.filter((c) => c.status === "expired").length;
  const neverExpiresCustomers = customers.filter((c) => c.status === "never_expires").length;
  const expiringIn3Days = customers.filter(
    (c) => c.status === "active" && c.daysLeft !== null && c.daysLeft <= 3
  ).length;
  const expiringIn7Days = customers.filter(
    (c) => c.status === "active" && c.daysLeft !== null && c.daysLeft <= 7
  ).length;

  // Alerts.
  const expiredButEnabled = customers.filter((c) =>
    c.configs.some((r) => r.expiryTime > 0 && r.expiryTime < now && r.enable)
  );
  const activeButZeroUsage = customers.filter(
    (c) => c.status === "active" && c.totalUsageBytes === 0
  );
  const highTrafficUsers = customers.filter(
    (c) => c.totalUsageBytes > 50 * 1024 * 1024 * 1024 // 50 GB
  );
  // Orphan = a customer with only ONE config when we'd normally expect 2-3
  // (default + ws). Could indicate a partial provisioning failure.
  const orphanConfigs = customers.filter((c) => c.configCount === 1);

  const totalConfigs = customers.reduce((s, c) => s + c.configCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    inbounds: inboundSummaries,
    totals: {
      totalConfigs,
      uniqueCustomers: customers.length,
      activeCustomers,
      disabledCustomers,
      expiredCustomers,
      neverExpiresCustomers,
      expiringIn3Days,
      expiringIn7Days,
      configsByKind,
    },
    alerts: {
      expiredButEnabled,
      activeButZeroUsage,
      highTrafficUsers,
      orphanConfigs,
    },
    customers,
  };
}

/** Mask email for display: jane.doe@gmail.com → j***@gmail.com */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const [local, domain] = email.split("@");
  if (!domain) return email[0] + "***";
  if (!local) return "***@" + domain;
  return `${local[0]}***@${domain}`;
}
