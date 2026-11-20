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

export const getGatewaySettingsStatus = defineRpc({
  name: "gateway.settings-status",
  input: z.object({}).strict(),
  output: z.object({ environmentOverride: z.boolean() }),
});
