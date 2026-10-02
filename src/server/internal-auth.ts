import { timingSafeEqual } from "node:crypto";
import { verifyInternalServiceHeaders } from "@/server/internal-service-signature";

function parseCookieHeader(cookieHeader: string) {
  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const index = entry.indexOf("=");
      if (index <= 0) return acc;
      const key = entry.slice(0, index).trim();
      const value = entry.slice(index + 1).trim();
      if (!key) return acc;
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
      return acc;
    }, {});
}

export function resolveInternalAuthSecret() {
  const secret =
    process.env.INTERNAL_AUTH_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret && process.env.NODE_ENV !== "production") {
    // 开发环境默认值，避免本地联调因遗漏变量直接不可用。
    return "local-internal-secret";
  }
  if (!secret) {
    throw new Error("INTERNAL_AUTH_SECRET is required");
  }
  return secret;
}

export function verifyInternalRequest(request: Request) {
  try {
    const secret = resolveInternalAuthSecret();
    const providedSecret = request.headers.get("x-internal-secret");
    if (providedSecret) {
      const expectedBuffer = Buffer.from(secret);
      const providedBuffer = Buffer.from(providedSecret);
      if (
        expectedBuffer.length === providedBuffer.length &&
        timingSafeEqual(expectedBuffer, providedBuffer)
      ) {
        return true;
      }
    }
    const url = new URL(request.url);
    const verified = verifyInternalServiceHeaders({
      method: request.method,
      pathname: url.pathname,
      secret,
      headers: {
        "x-internal-ts": request.headers.get("x-internal-ts") ?? undefined,
        "x-internal-signature":
          request.headers.get("x-internal-signature") ?? undefined,
      },
    });
    return verified === true;
  } catch {
    return false;
  }
}

export function readSessionTokenFromCookieHeader(cookieHeader?: string | null) {
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);
  const prefix = process.env.AUTH_COOKIE_PREFIX || "astraos-auth";
  const candidates = [
    `__Secure-${prefix}.session_token`,
    `${prefix}.session_token`,
  ];
  for (const name of candidates) {
    if (cookies[name]) {
      // 兼容旧签名 cookie 格式 "<token>.<signature>"，内部查询只需要 token 主体。
      return cookies[name].split(".")[0] || null;
    }
  }
  return null;
}
