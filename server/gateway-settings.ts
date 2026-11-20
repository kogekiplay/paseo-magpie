import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { PluginSettings } from "@getpaseo/plugin/server";
import { gatewayKey, gatewaySettings, gatewayUrlSetting, saveGatewaySettings, type GatewayStatus } from "../shared/gateway-settings.ts";
import { readConfig, type MagpieConfig } from "./config.ts";

const storedGateway = z.object({
  url: gatewayUrlSetting,
  revision: z.string().uuid(),
  credential: z.object({ url: z.string().min(1), value: gatewayKey }).optional(),
});
type StoredGateway = Omit<z.infer<typeof storedGateway>, "revision"> & { revision: string };

export function createGatewayConfiguration(
  legacy: Pick<PluginSettings<typeof gatewaySettings.schema>, "read">,
  env: NodeJS.ProcessEnv = process.env,
) {
  const path = join(env.PASEO_HOME || join(homedir(), ".paseo"), "paseo-magpie", "gateway.json");
  let pending: Promise<unknown> = Promise.resolve();

  async function load(): Promise<StoredGateway> {
    try {
      return storedGateway.parse(JSON.parse(await readFile(path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("Unable to read private Magpie gateway settings.");
      }
    }
    const previous = await legacy.read();
    return { url: previous.status === "ready" ? previous.values.url : "", revision: `legacy:${previous.revision}` };
  }

  function managed(config: MagpieConfig): boolean {
    return Boolean(config.apiKey && config.apiKey === env.PASEO_MAGPIE_API_KEY);
  }

  function status(stored: StoredGateway, config: MagpieConfig): GatewayStatus {
    return {
      url: stored.url,
      revision: stored.revision,
      environmentOverride: Boolean(env.PASEO_MAGPIE_URL),
      hasSavedKey: stored.credential !== undefined,
      keySource: managed(config) ? "environment" : stored.credential?.url === config.url ? "saved" : config.apiKey ? "host" : "none",
    };
  }

  async function write(settings: StoredGateway): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { mode: 0o700, recursive: true });
      await writeFile(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } catch {
      throw new Error("Unable to save private Magpie gateway settings.");
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  return {
    async config(): Promise<MagpieConfig> {
      const saved = await load();
      const config = await readConfig(env, saved.url);
      return !managed(config) && saved.credential?.url === config.url
        ? { ...config, apiKey: saved.credential.value } : config;
    },
    async read(): Promise<GatewayStatus> {
      const saved = await load();
      return status(saved, await readConfig(env, saved.url));
    },
    save(input: z.output<typeof saveGatewaySettings.input>): Promise<z.output<typeof saveGatewaySettings.output>> {
      const result = pending.then(async () => {
        const current = await load();
        if (current.revision !== input.revision) return { status: "conflict" } as const;
        const url = env.PASEO_MAGPIE_URL ? current.url : input.url;
        const config = await readConfig(env, url);
        if (typeof input.apiKey === "string" && managed(config)) return { status: "managed" } as const;
        const credential = typeof input.apiKey === "string" ? { url: config.url, value: input.apiKey }
          : input.apiKey === null ? undefined : current.credential;
        const next = { url, credential, revision: randomUUID() };
        await write(next);
        return { status: "saved", settings: status(next, config) } as const;
      });
      pending = result.catch(() => {});
      return result;
    },
  };
}
