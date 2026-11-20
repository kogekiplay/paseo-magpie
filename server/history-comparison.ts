import { createHash, randomBytes } from "node:crypto";
import {
  historyPageSizes, type ComparisonInput, type ComparisonOutput, type HistoryInput, type HistoryOutput,
  type TrendInput, type TrendOutput,
} from "../shared/history.ts";
import { readConfig, type MagpieConfig } from "./config.ts";
import {
  gatewayHistoryPageSize, gatewayRequests, historyAccountNames, historyRows, projectHistoryRequest,
  readGatewayHistoryPage, type HistoryRecord,
} from "./history.ts";

const maxRequests = 50_000;
const overlap = 16;
const cacheMs = 2 * 60_000;
type Period = HistoryInput["period"];
type Comparison = Extract<ComparisonOutput, { state: "ready" }>;
type Snapshot = { state: "ready"; id: string; comparison: Comparison; routes: Map<string, HistoryRecord[]> }
  | Exclude<ComparisonOutput, { state: "ready" }>;
type Group = { id: string; name: string; records: HistoryRecord[] };
type Model = { id: string; name: string; requests: number; providers: Map<string, Group> };

function identity(...parts: unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function median(sorted: number[]) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(records: HistoryRecord[]) {
  const firstToken: number[] = [];
  const speeds: number[] = [];
  for (const { row } of records) {
    if (row.outcome !== "completed") continue;
    if (row.ttftMs !== undefined) firstToken.push(row.ttftMs);
    if (row.speed && !row.speed.lowerBound) speeds.push(row.speed.tps);
  }
  firstToken.sort((a, b) => a - b);
  speeds.sort((a, b) => a - b);
  return {
    requests: records.length,
    ttft: firstToken.length ? {
      p50: median(firstToken), p90: firstToken[Math.ceil(firstToken.length * 0.9) - 1], count: firstToken.length,
    } : undefined,
    speed: speeds.length ? { p50: median(speeds), count: speeds.length } : undefined,
  };
}

function historyBucket(time: number, period: Period) {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  const midnight = day.getTime();
  day.setDate(day.getDate() + 1);
  day.setHours(0, 0, 0, 0);
  const tomorrow = day.getTime();
  if (period !== "today") return { start: midnight, end: tomorrow };
  const hour = 3_600_000;
  const start = midnight + Math.floor((time - midnight) / hour) * hour;
  return { start, end: Math.min(start + hour, tomorrow) };
}

function trend(snapshot: Extract<Snapshot, { state: "ready" }>, modelId: string, period: Period): TrendOutput {
  const model = snapshot.comparison.models.find(({ id }) => id === modelId);
  const observed = new Map<number, ReturnType<typeof historyBucket>>();
  const providers = (model?.providers ?? []).map(({ id, name }) => {
    const groups = new Map<number, HistoryRecord[]>();
    for (const record of snapshot.routes.get(id) ?? []) {
      const bucket = historyBucket(record.row.time, period);
      observed.set(bucket.start, bucket);
      const records = groups.get(bucket.start);
      if (records) records.push(record);
      else groups.set(bucket.start, [record]);
    }
    const points = Array.from(groups, ([start, records]) => {
      const { requests, ttft, speed } = summarize(records);
      return {
        start, requests,
        p90: ttft && { value: ttft.p90, count: ttft.count },
        tpsP50: speed && { value: speed.p50, count: speed.count },
      };
    });
    return { id, name, points };
  });
  const buckets = [...observed.values()].sort((a, b) => a.start - b.start);
  // Fill normal gaps in the selected period. Bound the expansion if a gateway
  // returns timestamps far outside the period it was asked for.
  const slots: typeof buckets = [];
  for (const bucket of buckets) {
    if (slots.length) {
      let next = slots[slots.length - 1].end;
      const gaps: typeof buckets = [];
      while (next < bucket.start && gaps.length < 32) {
        const gap = historyBucket(next, period);
        gaps.push(gap);
        next = gap.end;
      }
      if (next === bucket.start) slots.push(...gaps);
    }
    slots.push(bucket);
  }
  return { state: "ready", snapshot: snapshot.id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, buckets: slots, providers };
}

async function scan(config: MagpieConfig, period: Period, request: typeof fetch): Promise<Snapshot> {
  const models = new Map<string, Model>();
  const routes = new Map<string, HistoryRecord[]>();
  const deadline = Date.now() + 25_000;
  let offset = 0;
  let seen = 0;
  let tail: string | undefined;
  let limitedTo: number | undefined;
  for (;;) {
    const timeoutMs = Math.min(config.timeoutMs, deadline - Date.now());
    if (timeoutMs <= 0) return { state: "unavailable" };
    const page = await readGatewayHistoryPage({ ...config, timeoutMs }, period, offset, gatewayHistoryPageSize, request);
    if (page.state !== "ready") return page;
    if (page.offset !== offset) return { state: "unavailable" };

    // With newest-first offsets, completed requests can shift the next page.
    // Resume after the previous tail to avoid silently duplicating or skipping rows.
    const previous = tail === undefined ? -1 : page.rows.findIndex((row) => identity(row) === tail);
    if (tail !== undefined && previous < 0) return { state: "unavailable" };
    const fresh = page.rows.slice(previous + 1);
    const chunk = fresh.slice(0, maxRequests - seen);
    const names = historyAccountNames(page.accounts);
    for (const source of gatewayRequests(chunk)) {
      if (source.handed_on || !source.provider?.trim() || !source.served?.trim()) continue;
      const record = projectHistoryRequest(source, names, config.apiKey);
      if (!record?.row.model || !record.row.provider) continue;

      let model = models.get(source.served);
      if (!model) {
        model = { id: identity(source.served), name: record.row.model, requests: 0, providers: new Map() };
        models.set(source.served, model);
      }
      let group = model.providers.get(source.provider);
      if (!group) {
        group = { id: identity(source.provider, source.served), name: record.row.provider, records: [] };
        model.providers.set(source.provider, group);
        routes.set(group.id, group.records);
      }
      group.records.push(record);
      model.requests++;
    }

    seen += chunk.length;
    const end = page.offset + page.rows.length;
    if (seen === maxRequests) {
      if (fresh.length > chunk.length || end < page.total) limitedTo = seen;
      break;
    }
    if (end >= page.total) break;
    if (fresh.length === 0 || end - 1 <= offset) return { state: "unavailable" };
    tail = identity(page.rows.at(-1));
    offset = end - Math.min(overlap, page.rows.length - 1);
  }
  return {
    state: "ready", id: randomBytes(32).toString("hex"), routes,
    comparison: {
      state: "ready", limitedTo,
      models: [...models.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)).map((model) => ({
        id: model.id, name: model.name,
        providers: [...model.providers.values()].map(({ id, name, records }) => ({ id, name, ...summarize(records) })).sort((a, b) =>
          (a.ttft?.p50 ?? Infinity) - (b.ttft?.p50 ?? Infinity) || b.requests - a.requests || a.name.localeCompare(b.name)),
      })),
    },
  };
}

export function createHistoryComparison(loadConfig: () => Promise<MagpieConfig> = readConfig, request: typeof fetch = fetch) {
  const cache = new Map<Period, { key: string; expires: number; result: Promise<Snapshot> }>();
  async function load(config: MagpieConfig, period: Period, refresh?: boolean, keepSnapshot?: boolean) {
    const key = identity(config.url, config.apiKey);
    const cached = cache.get(period);
    if (cached?.key === key && (cached.expires === Infinity || (!refresh && (keepSnapshot || cached.expires > Date.now())))) {
      return cached.result;
    }
    const entry = {
      key, expires: Infinity,
      result: scan(config, period, request).catch((): Snapshot => ({ state: "unavailable" })),
    };
    cache.set(period, entry);
    const snapshot = await entry.result;
    if (snapshot.state === "ready") entry.expires = Date.now() + cacheMs;
    else if (cache.get(period) === entry) cache.delete(period);
    return snapshot;
  }

  return {
    async compare({ period, refresh }: ComparisonInput): Promise<ComparisonOutput> {
      try {
        const snapshot = await load(await loadConfig(), period, refresh);
        return snapshot.state === "ready" ? snapshot.comparison : snapshot;
      } catch {
        return { state: "unavailable" };
      }
    },
    async trend({ period, model }: TrendInput): Promise<TrendOutput> {
      try {
        const snapshot = await load(await loadConfig(), period, false, true);
        return snapshot.state === "ready" ? trend(snapshot, model, period) : snapshot;
      } catch {
        return { state: "unavailable" };
      }
    },
    async details(
      { period, offset, limit = historyPageSizes[0], route, bucket, snapshot: expected, refresh }: HistoryInput,
      list?: Parameters<typeof historyRows>[2],
    ): Promise<HistoryOutput> {
      try {
        const config = await loadConfig();
        const entry = cache.get(period);
        const snapshot = expected === undefined ? await load(config, period, refresh, true)
          : entry?.key === identity(config.url, config.apiKey) ? await entry.result : undefined;
        if (expected !== undefined && (snapshot?.state !== "ready" || snapshot.id !== expected)) return { state: "expired" };
        if (!snapshot) return { state: "unavailable" };
        if (snapshot.state !== "ready") return snapshot;
        const routeRecords = route ? snapshot.routes.get(route) ?? [] : [];
        const interval = bucket === undefined ? undefined : historyBucket(bucket, period);
        const records = interval ? routeRecords.filter(({ row }) => row.time >= interval.start && row.time < interval.end) : routeRecords;
        const rows = await historyRows(records.slice(offset, offset + limit), config.apiKey, list);
        return { state: "ready", rows, offset, total: records.length };
      } catch {
        return { state: "unavailable" };
      }
    },
  };
}
