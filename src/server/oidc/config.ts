export type OidcConfig = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  userinfoEndpoint: string;
};

const DEFAULT_SUPPORTED_SCOPES = ["openid", "profile", "email"] as const;

function normalizeBaseUrl(raw?: string) {
  const value = raw?.trim();
  if (!value) {
    return "http://localhost:4300";
  }
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * 中文注释：统一构建 OIDC 公开元数据，避免各路由重复拼接 URL。
 */
export function getOidcConfig(): OidcConfig {
  const issuer = normalizeBaseUrl(
    process.env.AUTH_ISSUER ?? process.env.AUTH_PUBLIC_URL,
  );

  return {
    issuer,
    authorizationEndpoint: `${issuer}/oauth2/authorize`,
    tokenEndpoint: `${issuer}/oauth2/token`,
    jwksUri: `${issuer}/jwks`,
    userinfoEndpoint: `${issuer}/oauth2/userinfo`,
  };
}

export function resolveDefaultScopes() {
  return resolveSupportedScopes().join(" ");
}

/**
 * 中文注释：统一返回当前 auth 服务允许的 scopes，供 OIDC 元数据与管理台复用。
 */
export function resolveSupportedScopes() {
  const raw = process.env.AUTH_SUPPORTED_SCOPES?.trim();
  if (!raw) {
    return [...DEFAULT_SUPPORTED_SCOPES];
  }
  const parsed = raw
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (parsed.length === 0) {
    return [...DEFAULT_SUPPORTED_SCOPES];
  }
  return parsed;
}
