import { z } from "zod";
import { historyPageSizes, type HistoryInput, type HistoryOutput, type HistoryRow } from "../shared/history.ts";
import { readConfig, type MagpieConfig } from "./config.ts";
import { redact } from "./source.ts";

const count = z.number().int().nonnegative().safe();
const usagePage = z.object({ rows: z.array(z.unknown()).max(Math.max(...historyPageSizes)), offset: count, total: count });
const usageRow = z.object({
  t: z.iso.datetime({ offset: true }),
  agent: z.string(),
  source: z.string().optional(),
  provider: z.string().optional(),
  providerName: z.string().optional(),
  model: z.string().optional(),
  served: z.string().optional(),
  status: z.number().int().min(0).max(599).optional(),
  err: z.string().optional(),
  canceled: z.boolean().optional(),
  ms: count.optional(),
  ttft_ms: count.optional(),
  first_text_ms: count.optional(),
  first_reasoning_ms: count.optional(),
  flow_ms: count.optional(),
  out: count.optional(),
  reasoning: count.optional(),
  reasoning_hidden: z.boolean().optional(),
  session: z.string().optional().catch(undefined),
  native_session: z.string().optional().catch(undefined),
});

type UsageRow = z.infer<typeof usageRow>;
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

function sessionOf(row: UsageRow) {
  return row.native_session || row.session;
}

async function findHistorySessions(
  list: SessionDirectory, rows: UsageRow[], provider: HistoryInput["agent"], secret?: string,
) {
  const ids = new Set(rows.map(sessionOf));
  const sessions = new Map<string, HistorySession | undefined>();
  ids.delete(undefined);
  ids.delete("");
  if (!ids.size) return sessions;
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await list({
      filter: { includeArchived: true, includeBackground: true },
      sort: [{ key: "created_at", direction: "asc" }],
      page: { limit: 200, cursor },
    });
    for (const { agent } of entries) {
      const persisted = agent.persistence?.provider === provider ? agent.persistence : null;
      const nativeIds = [
        agent.runtimeInfo?.provider === provider ? agent.runtimeInfo.sessionId : null,
        persisted?.sessionId,
        persisted?.nativeHandle,
      ];
      for (const id of nativeIds) {
        if (!id || !ids.has(id)) continue;
        const known = sessions.get(id);
        sessions.set(id, !sessions.has(id) || known?.agentId === agent.id
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

export async function projectHistory(
  body: unknown, agent: HistoryInput["agent"], secret?: string, list?: SessionDirectory,
): Promise<HistoryOutput> {
  const page = usagePage.safeParse(body);
  if (!page.success) return { state: "unavailable" };
  const { offset, total } = page.data;
  const requests = page.data.rows.flatMap((value): UsageRow[] => {
    const decoded = usageRow.safeParse(value);
    if (!decoded.success) return [];
    // Keep this guard even when an older gateway ignores a query filter.
    return decoded.data.agent === agent && !decoded.data.source ? [decoded.data] : [];
  });
  // An unavailable Paseo directory must not hide valid performance data.
  const sessions = list ? await findHistorySessions(list, requests, agent, secret).catch(() => undefined) : undefined;
  const rows = requests.flatMap((row): HistoryRow[] => {
    const time = Date.parse(row.t);
    if (!Number.isSafeInteger(time) || time <= 0) return [];
    const outcome = row.canceled ? "canceled" : row.err || (row.status ?? 0) >= 400 ? "failed" : "completed";
    const speed = outcome === "completed" ? measureSpeed(row) : undefined;
    const id = sessionOf(row);
    const session = id ? sessions?.get(id) : undefined;
    return [{
      time,
      provider: safeLabel(row.providerName || row.provider, secret),
      model: safeLabel(row.served || row.model, secret),
      outcome,
      ...(row.status ? { status: row.status } : {}),
      ...(row.ttft_ms ? { ttftMs: row.ttft_ms } : {}),
      ...(row.ms ? { durationMs: row.ms } : {}),
      ...(speed ? { speed } : {}),
      ...(session ? { session } : {}),
    }];
  });
  return { state: "ready", rows, offset, total };
}

export function createHistoryReader(loadConfig: () => Promise<MagpieConfig> = readConfig, request: typeof fetch = fetch) {
  return async ({ period, agent, offset, limit = historyPageSizes[0] }: HistoryInput, list?: SessionDirectory): Promise<HistoryOutput> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const config = await loadConfig();
      const url = new URL("v1/magpie/usage/requests", config.url);
      url.search = new URLSearchParams({ period, agent, via: "through", offset: String(offset), limit: String(limit) }).toString();
      timer = setTimeout(() => controller.abort(), config.timeoutMs);
      const response = await request(url, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { state: "forbidden" };
      if (response.status === 404 || response.status === 405) return { state: "unsupported" };
      if (!response.ok) return { state: "unavailable" };
      return projectHistory(await response.json(), agent, config.apiKey, list);
    } catch {
      return { state: "unavailable" };
    } finally {
      clearTimeout(timer);
    }
  };
}
