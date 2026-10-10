import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import db from "@/server/db";
import {
  adminAuditLogs,
  adminRoles,
  oauthAccessTokens,
  oauthRefreshGrants,
  oauthRefreshTokens,
  oauthAuthorizationCodes,
  oauthClients,
  users,
} from "@/server/db/schema";

import { clientAllowsUser } from "./client-access";

export type OAuthClientEntity = typeof oauthClients.$inferSelect;

function nowPlusSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

export type AuthRole = "admin" | "user";

/**
 * 中文注释：管理员角色只从 Auth 数据库读取，业务系统不得维护可编辑副本。
 */
export async function resolveAuthRole(userId: string): Promise<AuthRole | null> {
  const [row] = await db
    .select({
      isDisabled: users.isDisabled,
      role: adminRoles.role,
    })
    .from(users)
    .leftJoin(adminRoles, eq(adminRoles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || row.isDisabled) {
    return null;
  }
  return row.role === "admin" ? "admin" : "user";
}

export async function isAuthAdmin(userId: string): Promise<boolean> {
  return (await resolveAuthRole(userId)) === "admin";
}

/**
 * 中文注释：统一把敏感 secret 做 sha256 存储，避免数据库明文泄漏。
 */
function hashClientSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function normalizeRedirectUris(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function generateClientSecret() {
  return randomBytes(32).toString("hex");
}

export function generateClientId(appName: string) {
  const normalized = appName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  const suffix = randomBytes(6).toString("hex");
  return `astra-${normalized}-${suffix}`;
}

export async function listOAuthClients() {
  return db.select().from(oauthClients);
}

export async function listActiveClientByIds(clientIds: string[]) {
  if (clientIds.length === 0) return [];
  return db
    .select()
    .from(oauthClients)
    .where(and(inArray(oauthClients.clientId, clientIds), eq(oauthClients.status, "active")));
}

export async function getOAuthClientByClientId(clientId: string) {
  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return client ?? null;
}

export async function verifyOAuthClientSecret(clientId: string, rawSecret: string) {
  const client = await getOAuthClientByClientId(clientId);
  if (!client || client.status !== "active") return null;
  const expected = Buffer.from(client.clientSecret, "utf8");
  const provided = Buffer.from(hashClientSecret(rawSecret), "utf8");
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;
  return client;
}

export function clientSupportsRedirectUri(client: OAuthClientEntity, redirectUri: string) {
  const uris = normalizeRedirectUris(client.redirectUris);
  return uris.includes(redirectUri);
}

export function clientSupportsScopes(client: OAuthClientEntity, requestedScope: string) {
  const allowed = new Set(client.scopes.split(/\s+/).filter(Boolean));
  return requestedScope
    .split(/\s+/)
    .filter(Boolean)
    .every((scope) => allowed.has(scope));
}

export async function createOAuthClient(input: {
  actorUserId: string;
  appName: string;
  loginDescription?: string | null;
  redirectUris: string[];
  scopes: string;
  trusted: boolean;
  allowedUserIds?: string[] | null;
}) {
  const clientId = generateClientId(input.appName);
  const rawSecret = generateClientSecret();
  const secretHash = hashClientSecret(rawSecret);

  const [created] = await db
    .insert(oauthClients)
    .values({
      clientId,
      clientSecret: secretHash,
      appName: input.appName,
      loginDescription: input.loginDescription?.trim() || null,
      redirectUris: input.redirectUris.join(","),
      scopes: input.scopes,
      trusted: input.trusted,
      allowedUserIds: input.allowedUserIds === null ? null : JSON.stringify(input.allowedUserIds ?? []),
      status: "active",
    })
    .returning();

  await db.insert(adminAuditLogs).values({
    actorUserId: input.actorUserId,
    action: "oauth_client_create",
    targetType: "oauth_client",
    targetId: created.id,
    detail: JSON.stringify({ clientId: created.clientId, appName: created.appName }),
  });

  return {
    client: created,
    clientSecret: rawSecret,
  };
}

export async function rotateOAuthClientSecret(input: {
  actorUserId: string;
  clientId: string;
}) {
  const target = await getOAuthClientByClientId(input.clientId);
  if (!target) return null;

  const rawSecret = generateClientSecret();
  const secretHash = hashClientSecret(rawSecret);

  const [updated] = await db
    .update(oauthClients)
    .set({
      clientSecret: secretHash,
      rotatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(oauthClients.clientId, input.clientId))
    .returning();

  await db.insert(adminAuditLogs).values({
    actorUserId: input.actorUserId,
    action: "oauth_client_rotate_secret",
    targetType: "oauth_client",
    targetId: updated.id,
    detail: JSON.stringify({ clientId: updated.clientId }),
  });

  return {
    client: updated,
    clientSecret: rawSecret,
  };
}

export async function issueAuthorizationCode(input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  scope: string;
  nonce?: string | null;
  codeChallenge?: string | null;
  codeChallengeMethod?: string | null;
}) {
  const code = randomBytes(32).toString("base64url");
  const expiresAt = nowPlusSeconds(300);
  await db.insert(oauthAuthorizationCodes).values({
    code,
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    scope: input.scope,
    nonce: input.nonce ?? null,
    codeChallenge: input.codeChallenge ?? null,
    codeChallengeMethod: input.codeChallengeMethod ?? null,
    expiresAt,
  });
  return code;
}

function verifyPkce(codeChallenge: string | null, codeVerifier?: string | null) {
  if (!codeChallenge) return true;
  if (!codeVerifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) return false;
  const digest = createHash("sha256").update(codeVerifier).digest("base64url");
  return digest === codeChallenge;
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier?: string | null;
}) {
  // 中文注释：同一写事务中复核授权、消费授权码并签发令牌，防止并发重放。
  return db.transaction((tx) => {
    const record = tx.select().from(oauthAuthorizationCodes).where(and(
      eq(oauthAuthorizationCodes.code, input.code),
      eq(oauthAuthorizationCodes.clientId, input.clientId),
      eq(oauthAuthorizationCodes.redirectUri, input.redirectUri),
      isNull(oauthAuthorizationCodes.usedAt),
      gt(oauthAuthorizationCodes.expiresAt, new Date()),
    )).get();
    if (!record || !verifyPkce(record.codeChallenge, input.codeVerifier)) return null;
    const client = tx.select().from(oauthClients).where(eq(oauthClients.clientId, record.clientId)).get();
    if (!client || !clientAllowsUser(client, record.userId) || !clientSupportsScopes(client, record.scope)) return null;
    const user = tx.select({
      id: users.id, email: users.email, name: users.name, emailVerified: users.emailVerified,
      isDisabled: users.isDisabled, mustChangePassword: users.mustChangePassword, role: adminRoles.role,
    }).from(users).leftJoin(adminRoles, eq(adminRoles.userId, users.id))
      .where(eq(users.id, record.userId)).get();
    if (!user || user.isDisabled || user.mustChangePassword) return null;
    const consumed = tx.update(oauthAuthorizationCodes).set({ usedAt: new Date() })
      .where(and(eq(oauthAuthorizationCodes.id, record.id), isNull(oauthAuthorizationCodes.usedAt)))
      .returning().get();
    if (!consumed) return null;
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const grantId = randomBytes(32).toString("base64url");
    const refreshExpiresAt = nowPlusSeconds(30 * 86400);
    tx.insert(oauthRefreshGrants).values({ id: grantId, clientId: record.clientId, userId: record.userId,
      scope: record.scope, clientSecretHash: client.clientSecret, expiresAt: refreshExpiresAt }).run();
    tx.insert(oauthRefreshTokens).values({ tokenHash: hashClientSecret(refreshToken), grantId }).run();
    const expiresAt = nowPlusSeconds(3600);
    tx.insert(oauthAccessTokens).values({
      token: accessToken, grantId, clientId: record.clientId, userId: record.userId,
      scope: record.scope, expiresAt,
    }).run();
    return { record, accessToken, refreshToken, refreshExpiresAt, accessTokenExpiresAt: expiresAt,
      user: { ...user, role: user.role === "admin" ? "admin" as const : "user" as const } };
  }, { behavior: "immediate" });
}

/** 中文注释：BEGIN IMMEDIATE 串行化整条续期链；已消费令牌重放会永久撤销该链。 */
export function exchangeRefreshToken(input: { refreshToken: string; clientId: string; scope?: string }) {
  return db.transaction((tx) => {
    const record = tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, hashClientSecret(input.refreshToken))).get();
    if (!record) return null;
    const grant = tx.select().from(oauthRefreshGrants).where(eq(oauthRefreshGrants.id, record.grantId)).get();
    if (!grant || !grant.expiresAt || grant.clientId !== input.clientId) return null;
    const scope = input.scope ?? grant.scope;
    const requested = scope.trim().split(/\s+/).filter(Boolean);
    if (!requested.length || requested.some((value) => !grant.scope.split(/\s+/).includes(value))) return null;
    const revoke = () => { tx.update(oauthRefreshGrants).set({ revokedAt: new Date() }).where(eq(oauthRefreshGrants.id, grant.id)).run(); return null; };
    if (grant.revokedAt || grant.expiresAt <= new Date() || record.usedAt) return revoke();
    const client = tx.select().from(oauthClients).where(eq(oauthClients.clientId, grant.clientId)).get();
    const user = tx.select({ id: users.id, isDisabled: users.isDisabled, mustChangePassword: users.mustChangePassword })
      .from(users).where(eq(users.id, grant.userId)).get();
    if (!client || !clientAllowsUser(client, grant.userId) || client.clientSecret !== grant.clientSecretHash
      || !clientSupportsScopes(client, grant.scope) || !user || user.isDisabled || user.mustChangePassword) return revoke();
    const consumed = tx.update(oauthRefreshTokens).set({ usedAt: new Date() })
      .where(and(eq(oauthRefreshTokens.tokenHash, record.tokenHash), isNull(oauthRefreshTokens.usedAt))).returning().get();
    if (!consumed) return revoke();
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Math.min(Date.now() + 3600000, grant.expiresAt.getTime()));
    tx.insert(oauthAccessTokens).values({ token: accessToken, grantId: grant.id, clientId: grant.clientId,
      userId: grant.userId, scope: requested.join(" "), expiresAt }).run();
    tx.insert(oauthRefreshTokens).values({ tokenHash: hashClientSecret(refreshToken), grantId: grant.id }).run();
    // 中文注释：缩小 scope 后不可在后续续期重新扩大；绝对到期时间保持不变。
    tx.update(oauthRefreshGrants).set({ scope: requested.join(" ") }).where(eq(oauthRefreshGrants.id, grant.id)).run();
    return { accessToken, refreshToken, scope: requested.join(" "), expiresAt, refreshExpiresAt: grant.expiresAt };
  }, { behavior: "immediate" });
}

/** 中文注释：只允许已鉴权的原客户端撤销令牌族，未知令牌统一返回成功。 */
export function revokeOAuthToken(token: string, clientId: string) {
  db.transaction((tx) => {
    const refresh = tx.select().from(oauthRefreshTokens).where(eq(oauthRefreshTokens.tokenHash, hashClientSecret(token))).get();
    const access = tx.select().from(oauthAccessTokens).where(eq(oauthAccessTokens.token, token)).get();
    const grantId = refresh?.grantId ?? access?.grantId;
    if (grantId) tx.update(oauthRefreshGrants).set({ revokedAt: new Date() })
      .where(and(eq(oauthRefreshGrants.id, grantId), eq(oauthRefreshGrants.clientId, clientId))).run();
    else if (access?.clientId === clientId) tx.delete(oauthAccessTokens).where(eq(oauthAccessTokens.id, access.id)).run();
  }, { behavior: "immediate" });
}

export async function findAccessToken(token: string) {
  const [item] = await db
    .select({
      token: oauthAccessTokens.token,
      grantId: oauthAccessTokens.grantId,
      mustChangePassword: users.mustChangePassword,
      clientId: oauthAccessTokens.clientId,
      scope: oauthAccessTokens.scope,
      userId: oauthAccessTokens.userId,
      expiresAt: oauthAccessTokens.expiresAt,
      email: users.email,
      name: users.name,
      emailVerified: users.emailVerified,
    })
    .from(oauthAccessTokens)
    .innerJoin(users, eq(users.id, oauthAccessTokens.userId))
    .where(and(eq(oauthAccessTokens.token, token), gt(oauthAccessTokens.expiresAt, new Date())))
    .limit(1);

  if (!item || item.mustChangePassword) return null;
  if (item.grantId) {
    const grant = db.select().from(oauthRefreshGrants).where(eq(oauthRefreshGrants.id, item.grantId)).get();
    const current = db.select().from(oauthClients).where(eq(oauthClients.clientId, item.clientId)).get();
    if (!grant || !grant.expiresAt || grant.revokedAt || grant.expiresAt <= new Date() || grant.clientSecretHash !== current?.clientSecret) return null;
  }
  const client = await getOAuthClientByClientId(item.clientId);
  if (!client || !clientAllowsUser(client, item.userId) || !clientSupportsScopes(client, item.scope)) return null;
  const role = await resolveAuthRole(item.userId);
  if (!role) return null;
  return { ...item, role };
}

/** 中文注释：管理员修改应用配置时校验账号存在，并在同一事务中记录审计。 */
export function updateOAuthClient(input: {
  actorUserId: string; clientId: string; appName: string; redirectUris: string[];
  scopes: string; trusted: boolean; status: "active" | "disabled"; allowedUserIds: string[] | null;
  loginDescription?: string | null;
}) {
  return db.transaction((tx) => {
    if (input.allowedUserIds?.length) {
      const found = tx.select({ id: users.id }).from(users).where(inArray(users.id, input.allowedUserIds)).all();
      if (found.length !== new Set(input.allowedUserIds).size) throw new Error("unknown_user");
    }
    const updated = tx.update(oauthClients).set({
      appName: input.appName, redirectUris: input.redirectUris.join(","), scopes: input.scopes,
      trusted: input.trusted, status: input.status,
      // 中文注释：旧版管理客户端省略介绍时保留原值，显式空值才清除。
      ...(input.loginDescription !== undefined ? { loginDescription: input.loginDescription?.trim() || null } : {}),
      allowedUserIds: input.allowedUserIds === null ? null : JSON.stringify([...new Set(input.allowedUserIds)]),
      updatedAt: new Date(),
    }).where(eq(oauthClients.clientId, input.clientId)).returning().get();
    if (!updated) return null;
    tx.insert(adminAuditLogs).values({ actorUserId: input.actorUserId, action: "oauth_client_update",
      targetType: "oauth_client", targetId: updated.id,
      detail: JSON.stringify({ clientId: input.clientId, status: input.status, allowedUserIds: input.allowedUserIds }),
    }).run();
    return updated;
  });
}

/** 中文注释：管理接口只返回接入元数据，密钥摘要也不下发到浏览器。 */
export function publicOAuthClient(client: OAuthClientEntity) {
  const { clientSecret: _secret, ...metadata } = client;
  return metadata;
}

/** 中文注释：新增授权仅接受真实存在的身份 ID，不根据邮箱隐式匹配。 */
export async function validateClientUserIds(ids: string[] | null) {
  if (!ids?.length) return true;
  const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
  return found.length === new Set(ids).size;
}
