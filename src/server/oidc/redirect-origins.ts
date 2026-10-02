import { listOAuthClients } from "@/server/oidc/service";

function parseOriginSafe(raw: string) {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function parseCsvOrigins(raw?: string) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseOriginSafe)
    .filter((item): item is string => Boolean(item));
}

/**
 * 中文注释：登录页 callbackUrl 白名单以 OAuth Client redirectUris 为主，
 * 并兼容 AUTH_REDIRECT_ORIGINS 作为应急补充来源。
 */
export async function resolveRedirectAllowlistFromConfig() {
  const result = new Set<string>();

  // 兼容老配置：仅作为补充来源，不再要求每个应用都写 env。
  for (const origin of parseCsvOrigins(process.env.AUTH_REDIRECT_ORIGINS)) {
    result.add(origin);
  }

  const clients = await listOAuthClients();
  for (const client of clients) {
    if (client.status !== "active") continue;
    const uris = client.redirectUris
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const uri of uris) {
      const origin = parseOriginSafe(uri);
      if (origin) {
        result.add(origin);
      }
    }
  }

  return [...result];
}
