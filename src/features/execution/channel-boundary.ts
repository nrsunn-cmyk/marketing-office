import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { ExternalChannelKey } from "./channels";

const urls = z.object({ dispatch: z.string().optional(), metrics: z.string().optional() }).strict();
const configSchema = z.object({ crm: urls.optional(), search_ad: urls.optional(), social_api: urls.optional() }).strict();

export function configuredSigningKey() {
  const key = process.env.P4_CHANNEL_SIGNING_KEY?.trim();
  return key && /^[a-f0-9]{64}$/.test(key) ? key : null;
}

export function signedChannelCall(
  action: "prepare" | "finish" | "metrics" | "recordMetric",
  userId: string,
  payload: object,
  key: string,
) {
  const at = Date.now();
  const nonce = randomUUID();
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", key).update(["p4", action, userId, at, nonce, body].join("|")).digest("hex");
  return { p_action: action, p_payload: body, p_at: at, p_nonce: nonce, p_signature: signature };
}

function endpoint(input: string) {
  const url = URL.parse(input);
  if (
    !url || url.protocol !== "https:" || url.port || url.username || url.password || url.hash || url.search
    || !url.hostname.includes(".") || isIP(url.hostname) || url.hostname.endsWith(".")
  ) return null;
  return url.href;
}

export function approvedChannelEndpoint(channel: ExternalChannelKey, kind: "dispatch" | "metrics", input: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(process.env.P4_CHANNEL_ALLOWED_ENDPOINTS ?? "{}");
  } catch {
    return null;
  }
  const config = configSchema.safeParse(raw);
  const configured = config.success ? config.data[channel]?.[kind] : undefined;
  const actual = endpoint(input);
  return actual && configured && endpoint(configured) === actual ? actual : null;
}
