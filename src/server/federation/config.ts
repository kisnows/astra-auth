import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

const providerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  name: z.string().min(1).max(60),
  type: z.enum(["github", "google", "wechat", "oidc"]),
  enabled: z.boolean().default(true),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  issuer: z.string().url().optional(),
  tokenAuthMethod: z.enum(["client_secret_post", "client_secret_basic"]).default("client_secret_post"),
}).strict();
export type UpstreamProvider = z.infer<typeof providerSchema>;

/** 仅接受部署者配置的 HTTPS 身份源，本地测试可使用环回 HTTP。 */
export function trustedUrl(raw: string) {
  const url = new URL(raw);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash || url.search) {
    throw new Error("invalid_provider_url");
  }
  return url;
}

/** 配置只从服务端受保护文件读取，解析错误不包含密钥或原始配置。 */
export function readProviders(): UpstreamProvider[] {
  const file = process.env.AUTH_UPSTREAM_PROVIDERS_FILE;
  if (!file) return [];
  try {
    const providers = z.array(providerSchema).max(20).parse(JSON.parse(readFileSync(file, "utf8")));
    if (new Set(providers.map((p) => p.id)).size !== providers.length) throw new Error();
    for (const p of providers) {
      if (p.type === "oidc") {
        if (!p.issuer) throw new Error();
        trustedUrl(p.issuer);
      } else if (p.issuer) throw new Error();
    }
    return providers;
  } catch { throw new Error("invalid_provider_configuration"); }
}

export function requireProvider(id: string) {
  const provider = readProviders().find((p) => p.id === id && p.enabled);
  if (!provider) throw new Error("provider_unavailable");
  return provider;
}

/** 身份命名空间包含上游应用信息，避免配置替换后继承旧账号绑定。 */
export function identityNamespace(provider: UpstreamProvider) {
  const authority = provider.type === "oidc" ? provider.issuer : provider.type;
  const digest = createHash("sha256").update(JSON.stringify([authority, provider.clientId])).digest("hex");
  return `external:${provider.id}:${digest}`;
}

export function publicOrigin() {
  const value = process.env.AUTH_PUBLIC_URL;
  if (!value) throw new Error("auth_public_url_required");
  return trustedUrl(value).origin;
}

export function providerCallback(provider: UpstreamProvider) {
  return `${publicOrigin()}/api/federation/${provider.id}/callback`;
}

/** 跳转只允许 Auth 站内路径；OIDC authorize 路径会继续原业务应用的登录流程。 */
export function safeReturnTo(raw: unknown) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || [...raw].some((char) => char === "\\" || char.charCodeAt(0) <= 32)) return "/account";
  const parsed = new URL(raw, publicOrigin());
  return parsed.origin === publicOrigin() ? `${parsed.pathname}${parsed.search}` : "/account";
}
