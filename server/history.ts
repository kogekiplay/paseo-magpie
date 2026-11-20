import { createHash } from "node:crypto";
import { z } from "zod";
import { historyAccessTypes, historyPageSizes, type HistoryInput, type HistoryOutput, type HistoryRow, type UsageOverviewData } from "../shared/history.ts";
import { readConfig, type MagpieConfig } from "./config.ts";
import { redact } from "./source.ts";

const count = z.number().int().nonnegative().safe();
const optionalCount = count.optional().catch(undefined);
const optionalText = z.string().optional().catch(undefined);
const optionalCharge = z.number().nonnegative().optional().catch(undefined);
export const gatewayHistoryPageSize = 500;
const usageTotals = z.object({
  calls: count, input: count, output: count, cache_read: count, cache_write: count,
  cache_unknown: count.default(0), cost: z.number().nonnegative(), unpriced: count.default(0),
}).refine(({ input, output, cache_read, cache_write }) => Number.isSafeInteger(input + output + cache_read + cache_write));
const gatewayPoint = z.object({ time: z.iso.datetime({ offset: true }) });
const usageSeries = z.object({
  bucket: z.enum(["hour", "day"]),
  series: z.array(z.intersection(usageTotals, gatewayPoint)).max(32),
});
const usagePage = z.object({
  rows: z.array(z.unknown()).max(gatewayHistoryPageSize),
  offset: count, total: count,
  accounts: z.array(z.object({ id: z.string(), name: optionalText })).optional().catch(undefined),
});
const usageRow = z.object({
  t: z.iso.datetime({ offset: true }),
  agent: z.string(),
  agentName: optionalText,
  source: z.string().optional(),
  provider: z.string().optional(),
  providerName: z.string().optional(),
  served: optionalText,
  req: optionalText,
  providerAccount: optionalText,
  host: optionalText,
  access: z.enum(historyAccessTypes).optional().catch(undefined),
  ep: optionalText,
  ws: z.boolean().optional().catch(undefined),
  status: z.number().int().min(0).max(599).optional(),
  err: z.string().optional(),
  canceled: z.boolean().optional(),
  handed_on: z.boolean().optional(),
  ms: count.optional(),
  ttft_ms: count.optional(),
  first_text_ms: count.optional(),
  first_reasoning_ms: count.optional(),
  flow_ms: count.optional(),
  in: optionalCount,
  out: optionalCount,
  cache_read: optionalCount,
  cache_write: optionalCount,
  cache_unknown: z.boolean().optional().catch(undefined),
  priced: z.boolean().optional().catch(undefined),
  cost: optionalCharge,
  credits: optionalCharge,
  reasoning: count.optional(),
  reasoning_hidden: z.boolean().optional(),
  session: z.string().optional().catch(undefined),
  native_session: z.string().optional().catch(undefined),
});

type UsageRow = z.infer<typeof usageRow>;
type UsagePage = z.infer<typeof usagePage> & { overview?: UsageOverviewData };
export type HistoryRecord = { row: HistoryRow; sessionKey?: string };
type HistorySession = NonNullable<HistoryRow["session"]>;
type SessionIdentity = { provider: string; sessionId: string | null };
type SessionDirectory = (options: {
  filter: { includeArchived: true; includeBackground: true };
  sort: [{ key: "created_at"; direction: "asc" }];
  page: { limit: 200; cursor?: string };
}) => Promise<{
  entries: { agent: {
    id: string;
    title: string | null;
    runtimeInfo?: SessionIdentity;
    persistence: (SessionIdentity & { nativeHandle?: string }) | null;
  } }[];
  pageInfo: { nextCursor: string | null };
}>;

// Match the Magpie Usage Requests view: decoded generation rate when it can be
// timed, otherwise the same lower bounds. A withheld burst is not a measurement.
function measureSpeed(row: UsageRow): HistoryRow["speed"] {
  const {
    ms = 0, ttft_ms: ttft = 0, out = 0, reasoning = 0, first_text_ms: text = 0,
    first_reasoning_ms: firstReasoning = 0, flow_ms: flow = 0, reasoning_hidden: hidden,
  } = row;
  const textOnly = reasoning > 0 && firstReasoning === 0;
  const start = textOnly ? text : firstReasoning ? Math.min(firstReasoning, ttft) : ttft;
  const tokens = textOnly ? out - reasoning : out;
  const window = ms - start;
  const tail = ms - (reasoning && text ? text : ttft);
  const validRate = (n: number, w: number) => n > 0 && w >= 100 && n * 1_000 <= 10_000 * w;
  if (
    ttft > 0 && (!hidden || text || firstReasoning) && (!textOnly || text > 0) && reasoning <= out
    && validRate(tokens, window) && !(flow > 0 && flow * 4 < tail)
    && !(window < 1_000 && start > 4 * window)
    && !(reasoning && text && (out - reasoning) * (text - ttft) > 20 * reasoning * tail)
  ) return { tps: tokens * 1_000 / window, lowerBound: false };

  const afterFirst = ms - ttft;
  const answer = out - reasoning;
  if (ttft > 0 && reasoning > 0 && !text && answer >= 100 && afterFirst >= 1_000
    && validRate(answer, afterFirst) && !(flow > 0 && flow * 4 < afterFirst)
  ) return { tps: answer * 1_000 / afterFirst, lowerBound: true };

  if (out >= 1_000 && ms >= 1_000 && validRate(out, ms)) return { tps: out * 1_000 / ms, lowerBound: true };
}

function safeLabel(value: string | undefined, secret?: string) {
  return value ? redact(value, secret).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 160) : "";
}

function displayAccount(row: UsageRow, names: ReadonlyMap<string, string | undefined>, secret?: string) {
  const host = row.host ?? "";
  const separator = host.lastIndexOf(" as ");
  const id = (row.providerAccount || (separator >= 0 ? host.slice(separator + 4) : "")).trim();
  if (!id) return;
  const name = names.get(id)?.trim();
  if (name && name.toLowerCase() !== id.toLowerCase() && !name.includes("@")) return safeLabel(name, secret) || undefined;
  const tag = createHash("sha256").update(id).digest("hex").slice(0, 6);
  const initials = /^([a-z0-9]{1,2})[^@\s]*@[^@\s]+$/i.exec(id)?.[1];
  return initials && safeLabel(id, secret) === id ? `${initials}•• #${tag}` : `#${tag}`;
}

type Protocol = NonNullable<HistoryRow["protocol"]>["upstream"];

function protocolOf(path: string): Protocol | undefined {
  if (/\/messages\b/.test(path)) return "Anthropic";
  if (/\/responses\b/.test(path)) return "Responses";
  if (/\/chat\/completions\b/.test(path)) return "Chat";
  if (/[gG]enerateContent|\/generate\b/.test(path)) return "Gemini";
}

function displayProtocol(row: UsageRow): HistoryRow["protocol"] {
  if (!row.ep) return;
  const [first, last] = row.ep.split(" → ", 2);
  const client = protocolOf(first);
  const upstream = last ? protocolOf(last) : client;
  if (upstream) return {
    upstream, ...(client && client !== upstream ? { client } : {}), websocket: row.ws === true,
  };
}

function cacheHitOf(row: UsageRow) {
  if (row.cache_unknown) return;
  const read = row.cache_read ?? 0;
  const prompt = (row.in ?? 0) + read + (row.cache_write ?? 0);
  if (prompt > 0) return read / prompt;
}

function sessionKey(provider: string, id: string) {
  return JSON.stringify([provider, id]);
}

function requestSessionKey(row: UsageRow) {
  const id = row.native_session || row.session;
  return row.agent && id ? sessionKey(row.agent, id) : undefined;
}

async function findHistorySessions(list: SessionDirectory, rows: HistoryRecord[], secret?: string) {
  const wanted = new Set(rows.map((request) => request.sessionKey));
  const sessions = new Map<string, HistorySession | undefined>();
  wanted.delete(undefined);
  if (!wanted.size) return sessions;
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await list({
      filter: { includeArchived: true, includeBackground: true },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, cursor },
    });
    for (const { agent } of entries) {
      const identities = [
        [agent.runtimeInfo?.provider, agent.runtimeInfo?.sessionId],
        [agent.persistence?.provider, agent.persistence?.sessionId],
        [agent.persistence?.provider, agent.persistence?.nativeHandle],
      ];
      for (const [provider, id] of identities) {
        if (!provider || !id) continue;
        const key = sessionKey(provider, id);
        if (!wanted.has(key)) continue;
        const known = sessions.get(key);
        sessions.set(key, !sessions.has(key) || known?.agentId === agent.id
          ? { agentId: agent.id, title: safeLabel(agent.title ?? undefined, secret) }
          : undefined);
      }
    }
    cursor = pageInfo.nextCursor ?? undefined;
    if (cursor && cursors.has(cursor)) return new Map<string, HistorySession>();
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return sessions;
}

export async function historyRows(records: HistoryRecord[], secret?: string, list?: SessionDirectory): Promise<HistoryRow[]> {
  // An unavailable Paseo directory must not hide valid performance data.
  const sessions = list ? await findHistorySessions(list, records, secret).catch(() => undefined) : undefined;
  return records.map(({ row, sessionKey }) => {
    const session = sessionKey ? sessions?.get(sessionKey) : undefined;
    return session ? { ...row, session } : row;
  });
}

export function gatewayRequests(values: unknown[]) {
  return values.flatMap((value): UsageRow[] => {
    const decoded = usageRow.safeParse(value);
    // Keep this guard even when an older gateway ignores a query filter.
    return decoded.success && !decoded.data.source ? [decoded.data] : [];
  });
}

export function historyAccountNames(accounts: UsagePage["accounts"]) {
  return new Map(accounts?.map(({ id, name }) => [id, name]));
}

export function projectHistoryRequest(row: UsageRow, accountNames: ReadonlyMap<string, string | undefined>, secret?: string): HistoryRecord | undefined {
  const time = Date.parse(row.t);
  if (!Number.isSafeInteger(time) || time <= 0) return;
  const outcome = row.canceled ? "canceled" : row.err || (row.status ?? 0) >= 400 ? "failed" : "completed";
  const speed = outcome === "completed" ? measureSpeed(row) : undefined;
  const agentLabel = safeLabel(row.agentName, secret)
    || (row.agent === "codex" ? "Codex" : row.agent === "claude" ? "Claude Code" : safeLabel(row.agent, secret));
  const account = displayAccount(row, accountNames, secret);
  const protocol = displayProtocol(row);
  const cacheHit = cacheHitOf(row);
  const requestedModel = safeLabel(row.req, secret);
  return {
    sessionKey: requestSessionKey(row),
    row: {
      time,
      agent: agentLabel,
      provider: safeLabel(row.providerName || row.provider, secret),
      model: safeLabel(row.served, secret),
      ...(requestedModel ? { requestedModel } : {}),
      ...(account ? { account } : {}),
      ...(row.access ? { access: row.access } : {}),
      ...(protocol ? { protocol } : {}),
      ...(row.in !== undefined ? { inputTokens: row.in } : {}),
      ...(row.out !== undefined ? { outputTokens: row.out } : {}),
      ...(cacheHit !== undefined ? { cacheHit } : {}),
      ...(row.priced && row.cost !== undefined ? { costUsd: row.cost } : {}),
      ...(row.credits !== undefined ? { credits: row.credits } : {}),
      outcome,
      ...(row.status ? { status: row.status } : {}),
      ...(row.ttft_ms ? { ttftMs: row.ttft_ms } : {}),
      ...(row.ms ? { durationMs: row.ms } : {}),
      ...(speed ? { speed } : {}),
    },
  };
}

function projectTotals(totals: z.infer<typeof usageTotals>) {
  const { calls, input, output, cache_read: cacheRead, cache_write: cacheWrite, cache_unknown: unknown, cost, unpriced } = totals;
  const prompt = input + cacheRead + cacheWrite;
  const knownPrompt = prompt - unknown;
  return {
    requests: calls, costUsd: cost, unpriced, tokens: prompt + output, input, output, cacheRead, cacheWrite,
    ...(knownPrompt > 0 && cacheRead <= knownPrompt ? { cacheHit: cacheRead / knownPrompt } : {}),
  };
}

function decodeUsagePage(body: unknown): UsagePage | undefined {
  const parsed = usagePage.safeParse(body);
  if (!parsed.success) return;
  const page = parsed.data;
  const totals = usageTotals.safeParse(body);
  if (!totals.success) return page;
  const through = (body as { through?: unknown }).through;
  const gateway = usageTotals.safeParse(through);
  // Older gateways can ignore `via=through`. A summary with broader scope
  // must not be associated with a gateway-only request list.
  if (gateway.success && Object.keys(totals.data).some((key) => {
    const field = key as keyof typeof totals.data;
    const delta = Math.abs(totals.data[field] - gateway.data[field]);
    return delta > (field === "cost" ? 1e-6 : 0);
  })) return page;
  if (page.rows.some((row) => !!(row && typeof row === "object" && "source" in row && row.source))) return page;
  const chart = usageSeries.safeParse(body);
  const now = Date.now();
  const series = chart.success ? chart.data.series.filter(({ time }) => Date.parse(time) <= now)
    .map((point) => ({ time: point.time, ...projectTotals(point) })) : [];
  return { ...page, overview: { totals: projectTotals(totals.data), bucket: chart.data?.bucket, series } };
}

async function projectHistoryPage(page: UsagePage, secret?: string, list?: SessionDirectory): Promise<HistoryOutput> {
  const { rows, offset, total, accounts, overview } = page;
  if (rows.length > Math.max(...historyPageSizes)) return { state: "unavailable" };
  const names = historyAccountNames(accounts);
  const records = gatewayRequests(rows).flatMap((row) => projectHistoryRequest(row, names, secret) ?? []);
  return { state: "ready", rows: await historyRows(records, secret, list), offset, total, ...(overview ? { overview } : {}) };
}

export async function projectHistory(body: unknown, secret?: string, list?: SessionDirectory): Promise<HistoryOutput> {
  const page = decodeUsagePage(body);
  return page ? projectHistoryPage(page, secret, list) : { state: "unavailable" };
}

type GatewayPage = ({ state: "ready" } & UsagePage) | Exclude<HistoryOutput, { state: "ready" | "expired" }>;

export async function readGatewayHistoryPage(
  config: MagpieConfig, period: HistoryInput["period"], offset: number, limit: number,
  request: typeof fetch,
): Promise<GatewayPage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = new URL("v1/magpie/usage/requests", config.url);
    url.search = new URLSearchParams({ period, via: "through", offset: String(offset), limit: String(limit) }).toString();
    const response = await request(url, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { state: "forbidden" };
    if (response.status === 404 || response.status === 405) return { state: "unsupported" };
    if (!response.ok) return { state: "unavailable" };
    const page = decodeUsagePage(await response.json());
    return page ? { state: "ready", ...page } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

export function createHistoryReader(loadConfig: () => Promise<MagpieConfig> = readConfig, request: typeof fetch = fetch) {
  return async ({ period, offset, limit = historyPageSizes[0] }: HistoryInput, list?: SessionDirectory): Promise<HistoryOutput> => {
    try {
      const config = await loadConfig();
      const page = await readGatewayHistoryPage(config, period, offset, limit, request);
      return page.state === "ready" ? projectHistoryPage(page, config.apiKey, list) : page;
    } catch {
      return { state: "unavailable" };
    }
  };
}
