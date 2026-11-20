import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defaultGatewayUrl, normalizeUrl as normalizeGatewayUrl } from "../shared/gateway-settings.ts";

const configSchema = z.object({
  url: z.string().default(defaultGatewayUrl),
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
  try {
    return normalizeGatewayUrl(value);
  } catch {
    throw new Error("Magpie 网关地址须使用 HTTP 或 HTTPS，且不能包含密钥、查询参数或片段。");
  }
}

export async function readConfig(
  env: NodeJS.ProcessEnv = process.env,
  settingsUrl?: string,
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
  const configuredUrl = normalizeUrl(env.PASEO_MAGPIE_URL || config.url);
  const url = !env.PASEO_MAGPIE_URL && settingsUrl ? normalizeUrl(settingsUrl) : configuredUrl;
  return {
    url,
    // A UI address override must never forward a daemon credential to a
    // different gateway or proxy path.
    apiKey: url === configuredUrl ? env.PASEO_MAGPIE_API_KEY || config.apiKey || undefined : undefined,
    timeoutMs: config.timeoutMs,
  };
}
