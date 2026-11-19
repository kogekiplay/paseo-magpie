import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { requestPhaseSchema, requestRouteSchema, type ReplyRoute, type RequestRoute } from "../shared/reply-route.ts";

const maxRouteBytes = 16 * 1024;
const maxHistoryBytes = 44 * 1024;
const maxHistoryRequests = 16;
const maxIndexEntries = 4096 + 128;
const routeRetentionMs = 7 * 24 * 60 * 60 * 1_000;
const entrySchema = requestRouteSchema.extend({ version: z.literal(1) });
const orderSchema = z.object({ time: z.number().int().positive(), id: z.number().int().positive() });
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const historySchema = z.object({ turn: hashSchema, request: hashSchema, order: orderSchema });
const requestEntrySchema = entrySchema.extend({ order: orderSchema, phase: requestPhaseSchema });
type Order = z.infer<typeof orderSchema>;
type History = z.infer<typeof historySchema>;

function routeFromEntry({ provider, model, attempts }: RequestRoute): RequestRoute {
  return { provider, model, attempts };
}

function compareOrder(a: Order, b: Order) {
  return a.time - b.time || a.id - b.id;
}

function indexPath(configHome = process.env.XDG_CONFIG_HOME) {
  const base = configHome && isAbsolute(configHome) ? configHome : join(homedir(), ".config");
  return join(base, "magpie", "paseo-bridge", "v1");
}

export async function readCodexReplyRoute(
  session: string, messageId: string, signal: AbortSignal, configHome = process.env.XDG_CONFIG_HOME,
): Promise<ReplyRoute | null> {
  if (!session || !messageId || signal.aborted || typeof process.getuid !== "function") return null;
  const uid = process.getuid();
  const key = createHash("sha256").update(session).update("\0").update(messageId).digest("hex");
  const index = indexPath(configHome);
  const anchor = await readPrivateFile(join(index, `${key}.json`), uid, signal);
  const entry = entrySchema.safeParse(anchor);
  if (!entry.success) return null;
  const route = routeFromEntry(entry.data);
  const history = historySchema.safeParse(anchor?.history);
  if (!history.success) return route;
  return await readHistory(index, uid, signal, history.data.turn, { history: history.data, route }) ?? route;
}

export async function readCodexTurnRoutes(
  session: string, turnId: string, signal: AbortSignal, configHome = process.env.XDG_CONFIG_HOME,
): Promise<ReplyRoute | undefined> {
  if (!session || !turnId || signal.aborted || typeof process.getuid !== "function") return;
  const turn = createHash("sha256").update(session).update("\0").update(turnId).digest("hex");
  return readHistory(indexPath(configHome), process.getuid(), signal, turn);
}

async function readHistory(
  index: string, uid: number, signal: AbortSignal, turn: string, anchor?: { history: History; route: RequestRoute },
): Promise<ReplyRoute | undefined> {
  try {
    const stat = await lstat(index);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077)) return;
    const prefix = `${turn}-`;
    const candidates: z.infer<typeof requestEntrySchema>[] = [];
    const limit = maxHistoryRequests - (anchor ? 1 : 0);
    let visited = 0;
    let truncated = false;
    for await (const file of await opendir(index)) {
      if (signal.aborted) return;
      if (++visited > maxIndexEntries) { truncated = true; break; }
      if (!file.isFile() || !file.name.startsWith(prefix) || !file.name.endsWith(".json")) continue;
      const request = file.name.slice(prefix.length, -5);
      if (request === anchor?.history.request || !hashSchema.safeParse(request).success) continue;
      const entry = requestEntrySchema.safeParse(await readPrivateFile(join(index, file.name), uid, signal));
      if (!entry.success || (anchor && compareOrder(entry.data.order, anchor.history.order) >= 0)) continue;
      candidates.push(entry.data);
      candidates.sort((a, b) => compareOrder(b.order, a.order));
      if (candidates.length > limit) { candidates.pop(); truncated = true; }
    }
    if (signal.aborted) return;
    const route = anchor?.route ?? (candidates[0] && routeFromEntry(candidates[0]));
    if (!route) return;
    const requests: NonNullable<ReplyRoute["requests"]> = anchor ? [{ ...route, phase: "reply" }] : [];
    let bytes = Buffer.byteLength(JSON.stringify(requests));
    for (const request of candidates) {
      const value = { ...routeFromEntry(request), phase: request.phase === "reply" ? "model" as const : request.phase };
      bytes += Buffer.byteLength(JSON.stringify(value)) + 1;
      if (bytes > maxHistoryBytes) { truncated = true; break; }
      requests.push(value);
    }
    return { ...route, requests: requests.reverse(), ...(truncated && { truncated }), ...(!anchor && { turnOnly: true }) };
  } catch {
    return;
  }
}

async function readPrivateFile(path: string, uid: number, signal: AbortSignal): Promise<{ history?: unknown } | null> {
  if (signal.aborted) return null;
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o077)
      || stat.size > maxRouteBytes || Date.now() - stat.mtimeMs >= routeRetentionMs || signal.aborted) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || signal.aborted) return null;
    return JSON.parse(bytes.toString("utf8", 0, bytesRead));
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
