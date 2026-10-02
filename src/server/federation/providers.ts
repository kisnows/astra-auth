import * as oidc from "openid-client";
import { z } from "zod";
import type { UpstreamProvider } from "./config";
import { providerCallback } from "./config";
import type { FederationFlow } from "./flow";

/** Discovery 由标准客户端完成，校验元数据 issuer；缓存仅存当前配置对应的客户端。 */
const cache = new Map<string, Promise<oidc.Configuration>>();
async function configuration(provider: UpstreamProvider) {
  const issuer = provider.type === "google" ? "https://accounts.google.com" : provider.issuer!;
  const cacheKey = JSON.stringify(provider);
  let result = cache.get(cacheKey);
  if (!result) {
    const local = process.env.NODE_ENV !== "production" && new URL(issuer).protocol === "http:";
    result = oidc.discovery(new URL(issuer), provider.clientId, provider.clientSecret,
      provider.tokenAuthMethod === "client_secret_basic" ? oidc.ClientSecretBasic(provider.clientSecret) : oidc.ClientSecretPost(provider.clientSecret),
      { timeout: 10, execute: local ? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks] : [oidc.enableNonRepudiationChecks] });
    if (cache.size > 20) cache.clear();
    cache.set(cacheKey, result);
    result.catch(() => cache.delete(cacheKey));
  }
  return result;
}

/** 仅请求登录必需权限，所有上游使用服务端生成的 state。 */
export async function authorizationUrl(provider: UpstreamProvider, flow: FederationFlow, state: string) {
  const redirectUri = providerCallback(provider);
  if (provider.type === "oidc" || provider.type === "google") {
    return oidc.buildAuthorizationUrl(await configuration(provider), {
      redirect_uri: redirectUri, scope: "openid profile email", state, nonce: flow.nonce,
      ...(flow.intent === "reauthenticate" ? { prompt: provider.type === "google" ? "select_account" : "login" } : {}),
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: "S256",
    }).href;
  }
  if (provider.type === "github") {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.search = new URLSearchParams({ client_id: provider.clientId, redirect_uri: redirectUri, scope: "read:user user:email", state,
      code_challenge: await oidc.calculatePKCECodeChallenge(flow.verifier), code_challenge_method: "S256" }).toString();
    return url.href;
  }
  const url = new URL("https://open.weixin.qq.com/connect/qrconnect");
  url.search = new URLSearchParams({ appid: provider.clientId, redirect_uri: redirectUri, response_type: "code", scope: "snsapi_login", state }).toString();
  url.hash = "wechat_redirect";
  return url.href;
}

/** 上游错误只向调用层返回固定错误码，不记录包含凭据的请求 URL 或响应。 */
async function fetchJson(url: string | URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("upstream_failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object") throw new Error("upstream_failed");
  return body;
}

export type UpstreamIdentity = { subject: string; email: string | null; name: string | null };

/** 已验证邮箱仅用于首次注册；稳定 subject 才是登录和绑定的唯一身份键。 */
function verifiedEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = z.string().email().max(254).safeParse(value.trim().toLowerCase());
  return parsed.success ? parsed.data : null;
}
function displayName(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) || null : null;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("upstream_failed");
  return value as Record<string, unknown>;
}

/** 兑换并验证平台身份；上游令牌只在当前请求使用，不写入用户资料或数据库。 */
export async function exchangeIdentity(provider: UpstreamProvider, flow: FederationFlow, callback: URL, state: string): Promise<UpstreamIdentity> {
  if (provider.type === "oidc" || provider.type === "google") {
    const tokens = await oidc.authorizationCodeGrant(await configuration(provider), callback, {
      pkceCodeVerifier: flow.verifier, expectedState: state, expectedNonce: flow.nonce, idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("invalid_identity");
    return { subject: claims.sub, email: claims.email_verified === true ? verifiedEmail(claims.email) : null, name: displayName(claims.name) };
  }
  const code = callback.searchParams.get("code");
  if (!code || code.length > 2048 || callback.searchParams.has("error")) throw new Error("upstream_denied");
  if (provider.type === "github") {
    const token = record(await fetchJson("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: provider.clientId, client_secret: provider.clientSecret, code,
        redirect_uri: providerCallback(provider), code_verifier: flow.verifier }),
    }));
    if (typeof token.access_token !== "string" || token.error) throw new Error("upstream_failed");
    const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/vnd.github+json", "user-agent": "AstraOS-Auth" };
    const profile = record(await fetchJson("https://api.github.com/user", { headers }));
    if (typeof profile.id !== "number" || !Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error("invalid_identity");
    // 老绑定仍可使用只有 read:user 的授权，邮箱端点失败不影响稳定身份登录。
    let email: string | null = null;
    try {
      const emails = await fetchJson("https://api.github.com/user/emails", { headers });
      if (Array.isArray(emails)) {
        const candidates = emails.map(record).filter((item) => item.verified === true)
          .sort((a, b) => Number(b.primary === true) - Number(a.primary === true));
        email = candidates.map((item) => verifiedEmail(item.email)).find(Boolean) ?? null;
      }
    } catch { /* 邮箱不可用时只拒绝首次注册，不改变已绑定用户的登录。 */ }
    return { subject: String(profile.id), email, name: displayName(profile.name) ?? displayName(profile.login) };
  }
  const url = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
  url.search = new URLSearchParams({ appid: provider.clientId, secret: provider.clientSecret, code, grant_type: "authorization_code" }).toString();
  const token = record(await fetchJson(url));
  if (token.errcode || typeof token.openid !== "string" || !token.openid || typeof token.access_token !== "string") throw new Error("invalid_identity");
  // 微信 openid 在当前 appid 内稳定；不使用可缺失的 unionid 隐式跨应用合并。
  return { subject: token.openid, email: null, name: null };
}
