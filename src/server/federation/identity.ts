import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { identityNamespace, readProviders, type UpstreamProvider } from "./config";
import type { UpstreamIdentity } from "./providers";
import db from "@/server/db";
import { adminAuditLogs, authAccounts, users } from "@/server/db/schema";

/** 绑定和审计处于同一事务；身份冲突只能拒绝，不能把已有绑定改到当前用户。 */
export function linkIdentity(userId: string, namespace: string, subject: string) {
  return db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!user || user.isDisabled || user.mustChangePassword) throw new Error("account_unavailable");
    const existing = tx.select().from(authAccounts).where(and(eq(authAccounts.providerId, namespace), eq(authAccounts.accountId, subject))).get();
    if (existing) {
      if (existing.userId !== userId) throw new Error("identity_already_linked");
      return;
    }
    const own = tx.select().from(authAccounts).where(and(eq(authAccounts.providerId, namespace), eq(authAccounts.userId, userId))).get();
    if (own) throw new Error("provider_already_linked");
    const id = randomUUID();
    tx.insert(authAccounts).values({ id, userId, providerId: namespace, accountId: subject, updatedAt: new Date() }).run();
    tx.insert(adminAuditLogs).values({ actorUserId: userId, action: "federation_link", targetType: "auth_account", targetId: id }).run();
  });
}

/** 按稳定平台身份定位已有账号，绑定和重新验证复用此查询。 */
export async function userForIdentity(namespace: string, subject: string) {
  const [row] = await db.select({ user: users }).from(authAccounts).innerJoin(users, eq(users.id, authAccounts.userId))
    .where(and(eq(authAccounts.providerId, namespace), eq(authAccounts.accountId, subject))).limit(1);
  if (!row) throw new Error("identity_not_linked");
  if (row.user.isDisabled) throw new Error("account_unavailable");
  return row.user;
}

/** 首次 GitHub/Google 登录原子注册；冲突回滚，绝不按邮箱合并或创建权限。 */
export function loginOrRegisterIdentity(provider: UpstreamProvider, identity: UpstreamIdentity, currentUserId?: string) {
  const namespace = identityNamespace(provider);
  return db.transaction((tx) => {
    const row = tx.select({ user: users }).from(authAccounts).innerJoin(users, eq(users.id, authAccounts.userId))
      .where(and(eq(authAccounts.providerId, namespace), eq(authAccounts.accountId, identity.subject))).get();
    if (row) {
      if (row.user.isDisabled) throw new Error("account_unavailable");
      if (currentUserId && currentUserId !== row.user.id) throw new Error("session_changed");
      return row.user;
    }
    if (currentUserId) throw new Error("session_changed");
    if (!["github", "google"].includes(provider.type)) throw new Error("identity_not_linked");
    const email = z.string().email().max(254).safeParse(identity.email?.trim().toLowerCase());
    if (!email.success) throw new Error("verified_email_required");
    const existing = tx.select({ id: users.id }).from(users).where(sql`lower(trim(${users.email})) = ${email.data}`).get();
    if (existing) throw new Error("email_already_registered");
    const id = randomUUID();
    const accountId = randomUUID();
    const user = tx.insert(users).values({ id, email: email.data, name: identity.name?.trim().slice(0, 120) || "", emailVerified: true }).returning().get();
    tx.insert(authAccounts).values({ id: accountId, userId: id, providerId: namespace, accountId: identity.subject }).run();
    tx.insert(adminAuditLogs).values({ actorUserId: id, action: "federation_register", targetType: "user", targetId: id }).run();
    return user;
  });
}

/** 解绑保留至少一个已启用的登录方式，避免无密码账号被锁在账户之外。 */
export function unlinkIdentity(userId: string, accountId: string) {
  return db.transaction((tx) => {
    const account = tx.select().from(authAccounts).where(and(eq(authAccounts.id, accountId), eq(authAccounts.userId, userId))).get();
    if (!account || !account.providerId.startsWith("external:")) throw new Error("identity_not_found");
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    const credential = tx.select().from(authAccounts).where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential"))).get();
    if (!user || user.isDisabled) throw new Error("account_unavailable");
    if (!user.passwordHash && !credential?.password) {
      const enabled = new Set(readProviders().filter((p) => p.enabled).map(identityNamespace));
      const alternatives = tx.select().from(authAccounts).where(eq(authAccounts.userId, userId)).all()
        .filter((item) => item.id !== accountId && enabled.has(item.providerId));
      if (!alternatives.length) throw new Error("last_login_method");
    }
    tx.delete(authAccounts).where(eq(authAccounts.id, accountId)).run();
    tx.insert(adminAuditLogs).values({ actorUserId: userId, action: "federation_unlink", targetType: "auth_account", targetId: accountId }).run();
  });
}
