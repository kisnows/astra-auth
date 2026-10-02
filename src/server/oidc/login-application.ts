import type { LoginApplication } from "@/lib/login-application";
import { getOidcConfig, resolveDefaultScopes } from "./config";
import { clientSupportsRedirectUri, clientSupportsScopes, getOAuthClientByClientId } from "./service";

/** 中文注释：展示只信任已登记且与授权请求完全匹配的应用，不使用 URL 中的品牌文案。 */
export async function resolveLoginApplication(raw: unknown): Promise<LoginApplication | null> {
  if (typeof raw !== "string" || !raw || raw.length > 16000 || raw.includes("\\") || raw.startsWith("//") ||
      [...raw].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return null;
  const issuer = new URL(getOidcConfig().issuer);
  let url: URL;
  try { url = new URL(raw, issuer); } catch { return null; }
  if (url.origin !== issuer.origin || url.pathname !== "/oauth2/authorize" || url.hash || url.username || url.password) return null;
  const params = url.searchParams;
  for (const key of params.keys()) if (params.getAll(key).length !== 1) return null;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const nonce = params.get("nonce");
  if (!clientId || !redirectUri || params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "") ||
      (nonce !== null && (nonce.length === 0 || nonce.length > 512))) return null;
  const client = await getOAuthClientByClientId(clientId);
  if (!client || client.status !== "active" || !clientSupportsRedirectUri(client, redirectUri) ||
      !clientSupportsScopes(client, params.get("scope") || resolveDefaultScopes())) return null;
  return { appName: client.appName, description: client.loginDescription || null, origin: new URL(redirectUri).origin };
}
