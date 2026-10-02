type SameSiteValue = "lax" | "strict" | "none";

export type AuthCookieOptions = {
  name: string;
  domain?: string;
  httpOnly: true;
  maxAge: number;
  path: string;
  sameSite: SameSiteValue;
  secure: boolean;
};

function resolveSameSite(raw?: string): SameSiteValue {
  // 只接受浏览器支持的 SameSite 值，非法配置统一回退到 lax
  if (raw === "strict" || raw === "none") return raw;
  return "lax";
}

function resolveSecureFlag(raw?: string) {
  // 生产环境默认使用 Secure Cookie，本地 HTTP 调试可显式设为 false
  if (raw === "true") return true;
  if (raw === "false") return false;
  return process.env.NODE_ENV === "production";
}

function resolveCookieDomain(raw?: string) {
  // 双子域部署时配置为 .example.com；不配置则退回当前 host-only cookie
  const normalized = raw?.trim();
  return normalized ? normalized : undefined;
}

function parseOrigins(raw?: string) {
  // 逗号分隔 origin 配置，忽略非法 URL，避免启动时因单个配置错误失败
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
}

function resolveOrigin(raw?: string) {
  // 将完整 URL 规整为 origin，供 Origin 校验使用
  if (!raw) return undefined;
  try {
    return new URL(raw).origin;
  } catch {
    return undefined;
  }
}

export function resolveSessionMaxAgeSeconds() {
  // 会话有效期默认 30 天，可通过环境变量按部署调整
  const raw = Number(process.env.AUTH_SESSION_MAX_AGE_SECONDS);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 60 * 60 * 24 * 30;
}

export function resolveAuthCookieOptions(): AuthCookieOptions {
  // 保持历史 cookie 名，减少 wealth 和其它接入方迁移成本
  const secure = resolveSecureFlag(process.env.AUTH_COOKIE_SECURE);
  const prefix = process.env.AUTH_COOKIE_PREFIX || "astraos-auth";
  const name = `${secure ? "__Secure-" : ""}${prefix}.session_token`;
  return {
    name,
    domain: resolveCookieDomain(process.env.AUTH_COOKIE_DOMAIN),
    httpOnly: true,
    maxAge: resolveSessionMaxAgeSeconds(),
    path: "/",
    sameSite: resolveSameSite(process.env.AUTH_COOKIE_SAMESITE),
    secure,
  };
}

export function resolveAllowedOrigins() {
  // AUTH_TRUSTED_ORIGINS 用于接入应用；AUTH_PUBLIC_URL 是认证站自身来源
  const origins = new Set<string>();
  for (const origin of parseOrigins(process.env.AUTH_TRUSTED_ORIGINS)) {
    origins.add(origin);
  }
  const publicOrigin = resolveOrigin(process.env.AUTH_PUBLIC_URL);
  const serviceOrigin = resolveOrigin(process.env.AUTH_SERVICE_ORIGIN);
  if (publicOrigin) origins.add(publicOrigin);
  if (serviceOrigin) origins.add(serviceOrigin);
  return origins;
}
