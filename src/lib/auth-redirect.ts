export const DEFAULT_AUTH_REDIRECT = "/account";

/** 中文注释：统一登录和注册回跳校验，保留合法业务地址并阻止登录循环与开放重定向。 */
export function resolveAuthRedirect(options: {
  raw?: unknown;
  redirectAllowlist?: string[];
  currentOrigin?: string | null;
}) {
  const { raw, redirectAllowlist = [], currentOrigin } = options;
  if (typeof raw !== "string" || !raw || raw.startsWith("//") || [...raw].some((char) => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return DEFAULT_AUTH_REDIRECT;
  try {
    if (!raw.startsWith("/") && !/^https?:\/\//.test(raw)) return DEFAULT_AUTH_REDIRECT;
    const origin = new URL(currentOrigin || "https://auth.invalid").origin;
    const target = new URL(raw, origin);
    if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) return DEFAULT_AUTH_REDIRECT;
    const relative = raw.startsWith("/");
    if (!relative && target.origin !== origin && !redirectAllowlist.includes(target.origin)) return DEFAULT_AUTH_REDIRECT;
    if ((relative || target.origin === origin) && ["/", "/sign-in", "/signin", "/sign-up", "/signup"].includes(target.pathname.replace(/\/$/, "") || "/")) return DEFAULT_AUTH_REDIRECT;
    return relative ? `${target.pathname}${target.search}${target.hash}` : target.href;
  } catch { return DEFAULT_AUTH_REDIRECT; }
}
