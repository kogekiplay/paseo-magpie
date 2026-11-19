import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { replyRouteSchema, type ReplyRoute } from "../shared/reply-route.ts";

const maxRouteBytes = 16 * 1024;
const routeRetentionMs = 7 * 24 * 60 * 60 * 1_000;
const entrySchema = replyRouteSchema.extend({ version: z.literal(1) });

export async function readCodexReplyRoute(
  session: string, messageId: string, signal: AbortSignal, configHome = process.env.XDG_CONFIG_HOME,
): Promise<ReplyRoute | null> {
  if (!session || !messageId || signal.aborted || typeof process.getuid !== "function") return null;
  const base = configHome && isAbsolute(configHome) ? configHome : join(homedir(), ".config");
  const key = createHash("sha256").update(session).update("\0").update(messageId).digest("hex");
  const path = join(base, "magpie", "paseo-bridge", "v1", `${key}.json`);

  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o077)
      || stat.size > maxRouteBytes || Date.now() - stat.mtimeMs >= routeRetentionMs || signal.aborted) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== stat.size || signal.aborted) return null;
    const entry = entrySchema.safeParse(JSON.parse(bytes.toString("utf8", 0, bytesRead)));
    if (!entry.success) return null;
    const { provider, model, attempts } = entry.data;
    return { provider, model, attempts };
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
