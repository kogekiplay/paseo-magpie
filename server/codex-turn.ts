import { constants } from "node:fs";
import { open, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tailBytes = 4 * 1024 * 1024;

export async function findCodexTurn(
  session: string, messageId: string, signal: AbortSignal, codexHome = process.env.CODEX_HOME,
): Promise<string | undefined> {
  if (!uuidV7.test(session) || !messageId || signal.aborted || typeof process.getuid !== "function") return;
  const root = codexHome && isAbsolute(codexHome) ? codexHome : join(homedir(), ".codex");
  const started = Number.parseInt(session.slice(0, 13).replace("-", ""), 16);
  const matches: string[] = [];
  for (const days of [0, -1, 1]) {
    if (signal.aborted) return;
    const date = new Date(started + days * 86_400_000).toISOString().slice(0, 10).split("-");
    const dir = join(root, "sessions", ...date);
    try {
      let visited = 0;
      for await (const entry of await opendir(dir)) {
        if (signal.aborted || ++visited > 4096) return;
        if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(`-${session}.jsonl`)) {
          matches.push(join(dir, entry.name));
          if (matches.length > 1) return;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return;
    }
  }
  if (matches.length !== 1 || signal.aborted) return;

  let file;
  try {
    file = await open(matches[0], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o022) || stat.nlink !== 1) return;
    const prefix = Buffer.alloc(Math.min(64 * 1024, stat.size));
    const header = await file.read(prefix, 0, prefix.length, 0);
    const head = header.buffer.toString("utf8", 0, header.bytesRead);
    const newline = head.indexOf("\n");
    if (newline < 0) return;
    const metadata = JSON.parse(head.slice(0, newline));
    if (metadata.type !== "session_meta" || metadata.payload?.id !== session) return;

    const start = Math.max(0, stat.size - tailBytes);
    const buffer = Buffer.alloc(stat.size - start);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, start);
    if (bytesRead !== buffer.length || signal.aborted) return;
    const lines = buffer.toString("utf8").split("\n");
    if (start) lines.shift();
    if (lines.at(-1)) lines.pop(); // The last line can still be in flight.
    return completedTurnForMessage(lines, messageId);
  } catch {
    return;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

export function completedTurnForMessage(lines: Iterable<string>, messageId: string): string | undefined {
  let active: string | undefined;
  let finalId: string | undefined;
  let matched: string | undefined;
  for (const line of lines) {
    if (!line || !(line.includes('"event_msg"') || line.includes('"response_item"'))) continue;
    let event;
    try { event = JSON.parse(line); } catch { active = undefined; continue; }
    const payload = event?.payload;
    if (event?.type === "event_msg" && payload?.type === "task_started") {
      active = typeof payload.turn_id === "string" && uuidV7.test(payload.turn_id) &&
        (payload.root_turn_id == null || payload.root_turn_id === payload.turn_id)
        ? payload.turn_id : undefined;
      finalId = undefined;
    } else if (active && event?.type === "response_item" && payload?.type === "message" &&
               payload.role === "assistant" && payload.phase === "final_answer") {
      finalId = typeof payload.id === "string" ? payload.id : undefined;
    } else if (event?.type === "event_msg" && (payload?.type === "task_complete" || payload?.type === "turn_aborted")) {
      if (active && payload.type === "task_complete" && payload.turn_id === active &&
          (payload.root_turn_id == null || payload.root_turn_id === active) && finalId === messageId) {
        if (matched) return;
        matched = active;
      }
      active = undefined;
    }
  }
  return matched;
}
