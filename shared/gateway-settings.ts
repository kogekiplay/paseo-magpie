import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const defaultGatewayUrl = "http://127.0.0.1:3425";

export function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Magpie gateway URL");
  }
  // Accept a gateway root or a /v1 base URL, including a proxy prefix.
  const path = url.pathname.replace(/\/v1\/?$/, "/").replace(/\/?$/, "/");
  return `${url.origin}${path}`;
}

export const gatewayUrlSetting = z.string().trim().max(2048).refine((value) => {
  if (value === "") return true;
  // React Native's URL implementation does not expose username reliably.
  if (!/^https?:\/\/[^/@?#\s\\]+(?:\/[^?#\s\\]*)?$/i.test(value)) return false;
  try {
    normalizeUrl(value);
    return true;
  } catch {
    return false;
  }
}, "Enter an HTTP or HTTPS gateway URL without credentials, a query, or a fragment.");

export const gatewaySettings = defineSettings({
  id: "gateway",
  scope: "host",
  version: 1,
  schema: z.object({ url: gatewayUrlSetting.default("") }).strict(),
});

export const gatewayKey = z.string().trim().min(1).max(4096).regex(/^[\x21-\x7e]+$/);

const gatewayStatus = z.object({
  url: gatewayUrlSetting,
  revision: z.string().max(128),
  environmentOverride: z.boolean(),
  keySource: z.enum(["none", "saved", "host", "environment"]),
  hasSavedKey: z.boolean(),
});

export const readGatewaySettings = defineRpc({
  name: "gateway.read",
  input: z.object({}).strict(),
  output: gatewayStatus,
});

export const saveGatewaySettings = defineRpc({
  name: "gateway.save",
  input: z.object({
    url: gatewayUrlSetting,
    revision: z.string().max(128),
    apiKey: gatewayKey.nullable().optional(),
  }).strict(),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("saved"), settings: gatewayStatus }),
    z.object({ status: z.enum(["conflict", "managed"]) }),
  ]),
});

export type GatewayStatus = z.infer<typeof gatewayStatus>;
