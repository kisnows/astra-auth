import { and, eq, like } from "drizzle-orm";
import db from "@/server/db";
import { authAccounts, users } from "@/server/db/schema";
import { identityNamespace, readProviders } from "./config";
import { resolveCredentialPasswordHash, type PublicAuthUser } from "@/server/services/auth/session";

const supportedPlatforms = [
  { type: "github", name: "GitHub" },
  { type: "google", name: "Google" },
  { type: "wechat", name: "微信" },
  { type: "oidc", name: "OIDC" },
] as const;

/** 中文注释：账户首页和刷新接口复用同一投影，绝不向浏览器返回上游身份标识或凭据。 */
export async function getAccountOverview(user: PublicAuthUser) {
  const providers = readProviders();
  const [accounts, [credential]] = await Promise.all([
    db.select({ id: authAccounts.id, namespace: authAccounts.providerId, createdAt: authAccounts.createdAt })
      .from(authAccounts).where(and(eq(authAccounts.userId, user.id), like(authAccounts.providerId, "external:%"))),
    db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1),
  ]);
  const byNamespace = new Map(providers.map((provider) => [identityNamespace(provider), provider]));
  const connections = accounts.map((account) => {
    const provider = byNamespace.get(account.namespace);
    return { id: account.id, name: provider?.name ?? "已停用的身份源", providerId: provider?.id ?? null,
      enabled: provider?.enabled ?? false, linkedAt: account.createdAt?.toISOString() ?? null };
  });
  const platforms = [
    ...providers.map((provider) => ({ id: provider.id, name: provider.name, type: provider.type,
      enabled: provider.enabled, configured: true })),
    ...supportedPlatforms.filter((platform) => !providers.some((provider) => provider.type === platform.type))
      .map((platform) => ({ id: `unconfigured-${platform.type}`, ...platform, enabled: false, configured: false })),
  ];
  return { user, passwordEnabled: Boolean(await resolveCredentialPasswordHash({ userId: user.id, passwordHash: credential?.passwordHash })),
    providers: providers.filter((provider) => provider.enabled).map(({ id, name }) => ({ id, name })), platforms, connections };
}
