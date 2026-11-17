import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const configSchema = z.object({
  url: z.string().default("http://127.0.0.1:3425"),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(15_000).default(15_000),
}).strict();

export interface MagpieConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

export function configPath(env = process.env): string {
  if (env.PASEO_MAGPIE_CONFIG) return env.PASEO_MAGPIE_CONFIG;
  const directory = env.XDG_CONFIG_HOME
    || (process.platform === "win32" ? env.APPDATA : undefined)
    || join(homedir(), ".config");
  return join(directory, "paseo-magpie", "config.json");
}

export function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Magpie 网关地址无效，请填写 HTTP 或 HTTPS 地址。");
  }
  if (!["http:", "https:"].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    throw new Error("Magpie 网关地址须使用 HTTP 或 HTTPS，且不能包含密钥、查询参数或片段。");
  }
  // Accept a gateway root or an OpenAI-compatible /v1 base URL, including a proxy prefix.
  url.pathname = url.pathname.replace(/\/v1\/?$/, "/").replace(/\/?$/, "/");
  return url.toString();
}

export async function readConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MagpieConfig> {
  let saved: unknown = {};
  try {
    saved = JSON.parse(await readFile(configPath(env), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error("无法读取 Magpie 插件配置，请检查 config.json 的格式与权限。");
    }
  }
  const result = configSchema.safeParse(saved);
  if (!result.success) {
    throw new Error("Magpie 插件配置无效，请检查 url、apiKey 和 timeoutMs。");
  }
  const config = result.data;
  return {
    url: normalizeUrl(env.PASEO_MAGPIE_URL || config.url),
    apiKey: env.PASEO_MAGPIE_API_KEY || config.apiKey || undefined,
    timeoutMs: config.timeoutMs,
  };
}
