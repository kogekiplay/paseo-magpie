import {
  hashAccountKey,
  unavailable,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { accountKey, formatTimestamp, quotaReport, type MagpieQuota, type Span } from "./quota.ts";

export interface QuotaGroup {
  key: string;
  name: string;
  members: MagpieQuota[];
}

export function groupKey(url: string, quota: MagpieQuota): string {
  return hashAccountKey(JSON.stringify([
    "aggregate", url, quota.provider, quota.kind, quota.from || "",
  ]));
}

export function quotaGroups(url: string, quotas: MagpieQuota[]): QuotaGroup[] {
  const groups = new Map<string, Map<string, MagpieQuota>>();
  for (const quota of quotas) {
    const key = groupKey(url, quota);
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key)!.set(accountKey(url, quota), quota);
  }
  return [...groups.entries()].flatMap(([key, accounts]) => {
    const members = [...accounts.values()];
    if (members.length < 2) return [];
    const first = members[0];
    const name = [first.name || first.provider, "总额度", first.from ? `来自 ${first.from}` : ""]
      .filter(Boolean).join(" · ");
    return [{ key, name, members }];
  });
}

type Kind = "percent" | "count" | "balance" | "unlimited";
interface Reading { quota: MagpieQuota; span: Span }
interface Bucket {
  key: string;
  kind: Kind;
  plan: string;
  readings: Reading[];
}

function kindOf(span: Span): Kind | undefined {
  if (span.text) return undefined;
  if (span.unlimited) return "unlimited";
  if (span.limit != null && span.limit > 0) return "count";
  if (span.balance != null) return "balance";
  if (span.used != null || span.remaining != null) return "percent";
  return undefined;
}

function usedOf(span: Span): number {
  return Math.max(0, Math.min(100, span.used ?? (100 - span.remaining!)));
}

function windowName(span: Span, plan: string): string {
  const names: Record<string, string> = {
    "5 hours": "5 小时", "5h": "5 小时",
    "7 days": "7 天", weekly: "每周", week: "每周",
  };
  const plans: Record<string, string> = {
    team: "Team", plus: "Plus", pro: "Pro", prolite: "Pro Lite",
  };
  return [names[span.name.toLowerCase()] || span.name, plans[plan] || plan]
    .filter(Boolean).join(" · ");
}

export function aggregateReport(group: QuotaGroup, now = Date.now()): UsageReport {
  // Percentage shares have equal weight only within one plan. Counted allowances use their
  // actual capacities instead. Text rows and unknown/failed readings have nothing to sum.
  const readable = group.members.filter((q) => !q.error && (q.windows.length || q.balance));
  const buckets = new Map<string, Bucket>();
  for (const quota of readable) {
    const seen = new Set<string>();
    for (const span of quota.windows) {
      const kind = kindOf(span);
      if (!kind) continue;
      const plan = kind === "percent" ? quota.plan || "" : "";
      const key = JSON.stringify([
        span.name, span.lane || "", span.family || "", span.pool || "",
        span.unit || "", kind, plan,
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { key, kind, plan, readings: [] };
        buckets.set(key, bucket);
      }
      if (quota.asOf && span.resetsAt && Date.parse(span.resetsAt) <= now) continue;
      bucket.readings.push({ quota, span });
    }
  }

  const windows: UsageWindow[] = [];
  const balances: UsageBalance[] = [];
  const details: UsageDetail[] = [];
  const contributors = new Set<MagpieQuota>();
  for (const bucket of buckets.values()) {
    const { readings, kind, plan } = bucket;
    if (readings.length < 2) continue;
    if (kind === "unlimited" && readings.length !== readable.length) continue;
    // A shared wallet is not an independent second balance.
    if (kind === "balance" && readings.some(({ quota }) => quota.sharedBalance)) continue;
    const first = readings[0].span;
    const combined: Span = {
      ...first,
      name: windowName(first, plan),
      display: undefined,
      heldBy: undefined,
      spent: undefined,
      runsOutAt: undefined,
      used: undefined,
      remaining: undefined,
      amount: undefined,
      limit: undefined,
      balance: undefined,
    };
    if (kind === "percent") {
      const total = readings.reduce((sum, { span }) => sum + (span.heldBy ? 100 : usedOf(span)), 0);
      combined.used = Math.round(total / readings.length * 10) / 10;
    } else if (kind === "count") {
      combined.limit = readings.reduce((sum, { span }) => sum + span.limit!, 0);
      combined.amount = readings.reduce((sum, { span }) =>
        sum + (span.heldBy ? span.limit! : Math.max(0, span.amount || 0)), 0);
      combined.used = 100 * combined.amount / combined.limit;
    } else if (kind === "balance") {
      combined.balance = readings.reduce((sum, { span }) => sum + span.balance!, 0);
    }
    const futureResets = readings.map(({ span }) => Date.parse(span.resetsAt || ""))
      .filter((time) => Number.isFinite(time) && time > now);
    combined.resetsAt = futureResets.length ? new Date(Math.min(...futureResets)).toISOString() : null;
    const mapped = quotaReport({
      provider: group.members[0].provider,
      name: group.name,
      kind: group.members[0].kind,
      windows: [combined],
    });
    if (mapped.status !== "available") continue;
    const id = `aggregate-${hashAccountKey(bucket.key).slice(0, 24)}`;
    windows.push(...mapped.windows.map((window) => ({
      ...window,
      id,
      label: windowName(first, ""),
      shortLabel: windowName(first, ""),
      summary: true,
    })));
    balances.push(...(mapped.balances || []).map((balance) => ({ ...balance, id: `${id}-balance` })));
    details.push(...(mapped.details || []).map((detail) => ({ ...detail, id: `${id}-${detail.id}` })));
    for (const { quota } of readings) contributors.add(quota);
  }
  if (!contributors.size) {
    return unavailable({
      kind: "no_quota",
      detail: "当前没有至少两个账号可合并的同类额度窗口，请查看各账号明细。",
    });
  }
  const unread = group.members.length - readable.length;
  if (unread) details.push({
    id: "unread", label: "未计入", value: `${unread} 个账号没有有效读数`, tone: "warning",
  });
  const readTimes = [...contributors].map((q) => Date.parse(q.readAt || q.asOf || ""))
    .filter(Number.isFinite);
  if (readTimes.length) details.push({
    id: "read-at", label: "读取时间", value: formatTimestamp(new Date(Math.min(...readTimes)).toISOString())!,
  });
  return {
    status: "available",
    planLabel: `${group.members.length} 个账号`,
    windows,
    ...(balances.length ? { balances } : {}),
    details,
  };
}
