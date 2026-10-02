import { and, eq, gt } from "drizzle-orm";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import db from "@/server/db";
import { adminAuditLogs, authAccounts, authSessions, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/services/identity/password";
import { resolveSessionMaxAgeSeconds } from "./config";

export type PublicAuthUser = {
  id: string;
  email: string;
  name: string | null;
};

function normalizeEmail(email: string) {
  // 邮箱统一小写并去除首尾空白，保证唯一性判断稳定
  return email.trim().toLowerCase();
}

function hashSessionToken(token: string) {
  // 数据库只保存 token 哈希，避免 SQLite 泄露时可直接冒用 cookie
  return createHash("sha256").update(token).digest("hex");
}

function toPublicUser(user: {
  id: string;
  email: string;
  name?: string | null;
}): PublicAuthUser {
  // 统一对外用户结构，后续其它应用接入时只依赖这个稳定形状
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
  };
}

async function findUserByEmail(email: string) {
  // 登录/注册按邮箱定位用户，邮箱唯一约束由数据库兜底
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1);
  return user ?? null;
}

async function resolvePasswordHash(userId: string, directHash?: string | null) {
  // 新实现读取 User.passwordHash；旧 better-auth 数据兼容 AuthAccount.password
  if (directHash) return directHash;
  const [legacyAccount] = await db
    .select({ password: authAccounts.password })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, userId),
        eq(authAccounts.providerId, "credential"),
      ),
    )
    .limit(1);
  return legacyAccount?.password ?? null;
}

export async function resolveCredentialPasswordHash(input: {
  userId: string;
  passwordHash?: string | null;
}) {
  // 中文注释：密码校验统一走这里，兼容新列和旧 AuthAccount 凭证。
  return resolvePasswordHash(input.userId, input.passwordHash);
}

export async function upsertCredentialPassword(input: {
  userId: string;
  passwordHash: string;
  mustChangePassword?: boolean;
}) {
  // 中文注释：同时维护新旧两处密码字段，确保旧数据、管理后台和新登录实现一致。
  const now = new Date();
  const [credentialAccount] = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(
      and(
        eq(authAccounts.userId, input.userId),
        eq(authAccounts.providerId, "credential"),
      ),
    )
    .limit(1);

  if (credentialAccount) {
    await db
      .update(authAccounts)
      .set({
        accountId: input.userId,
        password: input.passwordHash,
        updatedAt: now,
      })
      .where(eq(authAccounts.id, credentialAccount.id));
  } else {
    await db.insert(authAccounts).values({
      id: randomUUID(),
      providerId: "credential",
      accountId: input.userId,
      userId: input.userId,
      password: input.passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  }

  const patch: {
    passwordHash: string;
    mustChangePassword?: boolean;
    updatedAt: Date;
  } = {
    passwordHash: input.passwordHash,
    updatedAt: now,
  };
  if (input.mustChangePassword !== undefined) {
    patch.mustChangePassword = input.mustChangePassword;
  }
  await db.update(users).set(patch).where(eq(users.id, input.userId));
}

export async function createUserWithPassword(input: {
  email: string;
  name?: string | null;
  password: string;
}) {
  // 创建邮箱密码用户；密码策略保持当前最小 8 位要求
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("email_required");
  if (input.password.length < 8) throw new Error("password_too_short");
  const existing = await findUserByEmail(email);
  if (existing) throw new Error("user_exists");

  const now = new Date();
  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      id: randomUUID(),
      email,
      name: input.name?.trim() || "",
      passwordHash,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await upsertCredentialPassword({
    userId: created.id,
    passwordHash,
    mustChangePassword: false,
  });
  return toPublicUser(created);
}

export async function verifyEmailPassword(input: {
  email: string;
  password: string;
}) {
  // 校验邮箱密码，失败时统一返回 null，避免泄露账号是否存在
  const user = await findUserByEmail(input.email);
  if (!user) return null;
  if (user.isDisabled) return null;
  const passwordHash = await resolvePasswordHash(user.id, user.passwordHash);
  if (!passwordHash) return null;
  const matched = await verifyPassword(input.password, passwordHash);
  return matched ? toPublicUser(user) : null;
}

export async function createSession(input: {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  // 生成高熵 session token，返回明文给 cookie，数据库仅保存哈希
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + resolveSessionMaxAgeSeconds() * 1000,
  );
  await db.insert(authSessions).values({
    id: randomUUID(),
    userId: input.userId,
    token: hashSessionToken(token),
    expiresAt,
    createdAt: now,
    updatedAt: now,
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  });
  return { token, expiresAt };
}

export async function getSessionByToken(token?: string | null) {
  // 根据 cookie token 查询会话和用户，过期会话直接视为无效
  if (!token) return null;
  const now = new Date();
  const [row] = await db
    .select({
      session: authSessions,
      user: users,
    })
    .from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id))
    .where(
      and(
        eq(authSessions.token, hashSessionToken(token)),
        gt(authSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row) return null;
  const expiresAt = row.session.expiresAt;
  if (!expiresAt) return null;
  if (row.user.isDisabled) return null;
  return {
    session: {
      id: row.session.id,
      userId: row.session.userId,
      expiresAt,
    },
    user: toPublicUser(row.user),
  };
}

export async function deleteSessionByToken(token?: string | null) {
  // 退出登录只删除当前 token 对应会话，不影响其它设备
  if (!token) return;
  await db
    .delete(authSessions)
    .where(eq(authSessions.token, hashSessionToken(token)));
}

export async function updateCurrentUser(input: {
  userId: string;
  name?: string;
}) {
  // 当前只允许更新名称；后续接入更多资料字段时在这里扩展白名单
  const patch: { name?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, input.userId))
    .returning();
  return updated ? toPublicUser(updated) : null;
}

/** 设置首个密码须原子复核无旧密码，不能覆盖并发设置的密码或管理员禁用状态。 */
export function setInitialCredentialPassword(userId: string, passwordHash: string) {
  return db.transaction((tx) => {
    const user = tx.select().from(users).where(eq(users.id, userId)).get();
    const credential = tx.select().from(authAccounts).where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "credential"))).get();
    if (!user || user.isDisabled || user.mustChangePassword || user.passwordHash || credential?.password) throw new Error("credential_already_exists");
    if (credential) tx.update(authAccounts).set({ password: passwordHash }).where(eq(authAccounts.id, credential.id)).run();
    else tx.insert(authAccounts).values({ userId, providerId: "credential", accountId: userId, password: passwordHash }).run();
    tx.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();
    tx.insert(adminAuditLogs).values({ actorUserId: userId, action: "password_set", targetType: "user", targetId: userId }).run();
  });
}
