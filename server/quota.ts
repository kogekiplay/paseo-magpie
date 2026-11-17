import {
  balanceToneFromRemaining,
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  windowFromUsedPct,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { z } from "zod";

const number = z.number().finite().nullable().optional();
const spanSchema = z.object({
  name: z.string().default(""),
  used: number,
  remaining: number,
  resetsAt: z.string().nullable().optional(),
  runsOutAt: z.string().nullable().optional(),
  unlimited: z.boolean().optional(),
  text: z.boolean().optional(),
  display: z.string().optional(),
  lane: z.string().optional(),
  pool: z.string().optional(),
  amount: number,
  limit: number,
  unit: z.string().optional(),
  balance: number,
  spent: number,
});

export const quotaSchema = z.object({
  provider: z.string().min(1),
  name: z.string().default(""),
  kind: z.string().default(""),
  user: z.string().optional(),
  plan: z.string().optional(),
  alias: z.string().optional(),
  seat: z.string().optional(),
  from: z.string().optional(),
  windows: z.array(spanSchema).default([]),
  balance: z.string().optional(),
  sharedBalance: z.string().optional(),
  error: z.string().optional(),
  readAt: z.string().nullable().optional(),
  asOf: z.string().nullable().optional(),
  until: z.string().nullable().optional(),
  readDeferred: z.boolean().optional(),
});

export const responseSchema = z.object({ data: z.array(quotaSchema) });
export type MagpieQuota = z.infer<typeof quotaSchema>;
type Span = z.infer<typeof spanSchema>;

export function accountKey(url: string, quota: MagpieQuota): string {
  // Names/aliases are presentation, not identity; utilization and array positions never belong here.
  return hashAccountKey(JSON.stringify([
    url, quota.from || "", quota.provider, quota.kind,
    quota.user || "", quota.seat || "",
  ]));
}

export function accountLabel(quota: MagpieQuota): string {
  const provider = quota.name || quota.provider;
  const account = quota.alias || quota.user || quota.seat;
  return [provider, account, quota.from ? `来自 ${quota.from}` : undefined]
    .filter(Boolean).join(" · ");
}

function date(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function formatTimestamp(
  value: string | null | undefined,
  timeZone?: string,
): string | null {
  const parsed = date(value);
  if (!parsed) return null;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(parsed));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  const offset = part("timeZoneName").replace(/^GMT/, "UTC");
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} (${offset})`;
}

function displayText(span: Span): string | undefined {
  const value = span.display?.trim();
  return value && !["unknown", "未知"].includes(value.toLowerCase()) ? value : undefined;
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function spanId(span: Span): string {
  return `quota-${hashAccountKey(JSON.stringify([
    normalizedName(span.name), span.lane || "", span.pool || "",
  ])).slice(0, 24)}`;
}

function spanLabel(span: Span): string {
  // The API's own period name is the authority; never infer a window from its reset countdown.
  return [span.lane, span.name || "额度", span.pool].filter(Boolean).join(" · ");
}

function percent(span: Span): number | null {
  if (span.unlimited || span.text || span.balance != null) return null;
  const used = span.used ?? (span.remaining != null ? 100 - span.remaining : null);
  return used === null ? null : Math.max(0, Math.min(100, used));
}

function unit(value: string | undefined): UsageBalance["unit"] | undefined {
  switch (value?.trim().toLowerCase()) {
    case "$": case "usd": case "us$": return "usd";
    case "credit": case "credits": return "credits";
    case "request": case "requests": return "requests";
    case "token": case "tokens": return "tokens";
    default: return undefined;
  }
}

export function quotaReport(quota: MagpieQuota): UsageReport {
  const windows: UsageWindow[] = [];
  const balances: UsageBalance[] = [];
  const details: UsageDetail[] = [];
  const seen = new Set<string>();
  const addDetail = (id: string, label: string, value: string, warning = false) => {
    details.push({ id, label, value, ...(warning ? { tone: "warning" as const } : {}) });
  };

  for (const span of quota.windows) {
    const id = spanId(span);
    const label = spanLabel(span);
    // Ambiguous repeated scopes cannot safely become separate pinnable windows.
    if (seen.has(id)) continue;
    seen.add(id);
    const usedPct = percent(span);
    if (!span.text && !span.unlimited && span.balance == null) {
      windows.push({
        ...windowFromUsedPct({
          id,
          label,
          utilizationPct: usedPct,
          resetsAt: date(span.resetsAt),
          summary: true,
          tone: toneFromUsedPct(usedPct),
        }),
        runsOutAt: date(span.runsOutAt),
      });
    }
    const balanceUnit = unit(span.unit);
    const hasCounts = span.amount != null || span.balance != null;
    if (balanceUnit && hasCounts) {
      balances.push({
        id: `${id}-balance`,
        label,
        unit: balanceUnit,
        used: span.spent ?? span.amount ?? null,
        remaining: span.balance
          ?? (span.amount != null && span.limit != null
            ? Math.max(0, span.limit - span.amount) : null),
        limit: span.limit ?? null,
        resetsAt: date(span.resetsAt),
        tone: usedPct === null
          ? balanceToneFromRemaining(span.balance)
          : toneFromUsedPct(usedPct),
      });
    } else if (span.balance != null) {
      // Paseo has a fixed unit enum. Do not reinterpret CNY or an unknown currency as USD.
      addDetail(`${id}-balance`, label, `${span.balance} ${span.unit || ""}`.trim());
    } else if (span.amount != null && span.limit != null && !balanceUnit) {
      addDetail(`${id}-count`, label, `${span.amount} / ${span.limit} ${span.unit || ""}`.trim());
    }
    if (span.unlimited) addDetail(`${id}-unlimited`, label, "不限额");
    const display = displayText(span);
    if (display) addDetail(`${id}-display`, label, display);
  }

  if (quota.balance) addDetail("balance", "余额", quota.balance);
  if (quota.sharedBalance) addDetail("shared-balance", "共享余额", "与同一供应商的其他密钥共享，勿重复相加。");
  const readAt = formatTimestamp(quota.readAt) || formatTimestamp(quota.asOf);
  if (readAt) addDetail("read-at", "读取时间", readAt);
  const until = formatTimestamp(quota.until);
  if (until) addDetail("until", "有效期", until);
  if (quota.readDeferred) addDetail("deferred", "读取状态", "本次未重新读取，显示 Magpie 保留的数据。");
  if (quota.error) {
    if (!windows.length && !balances.length && !quota.balance
      && !quota.windows.some((span) => displayText(span) || span.unlimited || span.balance != null)) {
      return { status: "error", error: quota.error };
    }
    addDetail("read-error", "读取异常", quota.error, true);
  }
  if (!windows.length && !balances.length
    && !details.some((detail) => !["read-at", "until", "deferred"].includes(detail.id))) {
    return unavailable({ kind: "no_quota", detail: "Magpie 暂未提供此账号的额度或余额。" });
  }
  return {
    status: "available",
    planLabel: quota.plan || undefined,
    windows,
    ...(balances.length ? { balances } : {}),
    ...(details.length ? { details } : {}),
  };
}
