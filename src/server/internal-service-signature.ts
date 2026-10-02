import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;
const HEX_64 = /^[0-9a-f]{64}$/i;

export type InternalServiceHeaders = {
  "x-internal-ts": string;
  "x-internal-signature": string;
};

function normalizePath(pathname: string) {
  if (!pathname) return "/";
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function buildPayload(method: string, pathname: string, timestamp: number) {
  return `${method.toUpperCase()}\n${normalizePath(pathname)}\n${timestamp}`;
}

function signPayload(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function buildInternalServiceHeaders(options: {
  method: string;
  pathname: string;
  secret: string;
  timestamp?: number;
}): InternalServiceHeaders {
  const timestamp = options.timestamp ?? Date.now();
  const payload = buildPayload(options.method, options.pathname, timestamp);
  const signature = signPayload(payload, options.secret);
  return {
    "x-internal-ts": String(timestamp),
    "x-internal-signature": signature,
  };
}

export function verifyInternalServiceHeaders(options: {
  method: string;
  pathname: string;
  secret: string;
  headers: Record<string, string | undefined>;
  maxSkewMs?: number;
}) {
  const ts = options.headers["x-internal-ts"];
  const signature = options.headers["x-internal-signature"];
  if (!ts || !signature) return false;
  if (!HEX_64.test(signature)) return false;

  const timestamp = Number(ts);
  if (!Number.isFinite(timestamp)) return false;

  const maxSkewMs = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Math.abs(Date.now() - timestamp) > maxSkewMs) return false;

  const payload = buildPayload(options.method, options.pathname, timestamp);
  const expected = signPayload(payload, options.secret);
  if (!HEX_64.test(expected)) return false;

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}
