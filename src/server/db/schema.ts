import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";
import { dateTimeText } from "@/server/db/columns";

export const users = sqliteTable(
  "User",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    image: text("image"),
    passwordHash: text("passwordHash"),
    emailVerified: integer("emailVerified", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: dateTimeText("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: dateTimeText("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    isDisabled: integer("isDisabled", { mode: "boolean" }).notNull().default(false),
    mustChangePassword: integer("mustChangePassword", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => ({
    emailKey: uniqueIndex("User_email_key").on(table.email),
    emailIdx: index("User_email_idx").on(table.email),
  }),
);

export const authAccounts = sqliteTable(
  "AuthAccount",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    providerId: text("providerId").notNull(),
    accountId: text("accountId").notNull(),
    userId: text("userId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: dateTimeText("accessTokenExpiresAt"),
    refreshTokenExpiresAt: dateTimeText("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: dateTimeText("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: dateTimeText("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    providerAccountKey: uniqueIndex("AuthAccount_providerId_accountId_key").on(
      table.providerId,
      table.accountId,
    ),
    userIdx: index("AuthAccount_userId_idx").on(table.userId),
  }),
);

export const authSessions = sqliteTable(
  "AuthSession",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("userId").notNull(),
    token: text("token").notNull(),
    expiresAt: dateTimeText("expiresAt").notNull(),
    createdAt: dateTimeText("createdAt")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: dateTimeText("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
  },
  (table) => ({
    tokenKey: uniqueIndex("AuthSession_token_key").on(table.token),
    userIdx: index("AuthSession_userId_idx").on(table.userId),
  }),
);

export const authVerifications = sqliteTable("AuthVerification", {
  id: text("id").primaryKey().$defaultFn(() => randomUUID()),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: dateTimeText("expiresAt").notNull(),
  createdAt: dateTimeText("createdAt")
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: dateTimeText("updatedAt")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
});

export const oauthClients = sqliteTable(
  "OAuthClient",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    clientId: text("clientId").notNull(),
    clientSecret: text("clientSecret").notNull(),
    appName: text("appName").notNull(),
    loginDescription: text("loginDescription"),
    redirectUris: text("redirectUris").notNull(),
    scopes: text("scopes").notNull().default("openid profile email"),
    allowedUserIds: text("allowedUserIds"),
    trusted: integer("trusted", { mode: "boolean" }).notNull().default(true),
    status: text("status").notNull().default("active"),
    createdAt: dateTimeText("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: dateTimeText("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    rotatedAt: dateTimeText("rotatedAt"),
  },
  (table) => ({
    clientIdKey: uniqueIndex("OAuthClient_clientId_key").on(table.clientId),
    statusIdx: index("OAuthClient_status_idx").on(table.status),
  }),
);

export const oauthAuthorizationCodes = sqliteTable(
  "OAuthAuthorizationCode",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    code: text("code").notNull(),
    clientId: text("clientId").notNull(),
    userId: text("userId").notNull(),
    redirectUri: text("redirectUri").notNull(),
    scope: text("scope").notNull(),
    nonce: text("nonce"),
    codeChallenge: text("codeChallenge"),
    codeChallengeMethod: text("codeChallengeMethod"),
    expiresAt: dateTimeText("expiresAt").notNull(),
    usedAt: dateTimeText("usedAt"),
    createdAt: dateTimeText("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    codeKey: uniqueIndex("OAuthAuthorizationCode_code_key").on(table.code),
    clientIdx: index("OAuthAuthorizationCode_clientId_idx").on(table.clientId),
    userIdx: index("OAuthAuthorizationCode_userId_idx").on(table.userId),
    expiresAtIdx: index("OAuthAuthorizationCode_expiresAt_idx").on(table.expiresAt),
  }),
);

export const oauthAccessTokens = sqliteTable(
  "OAuthAccessToken",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    token: text("token").notNull(),
    clientId: text("clientId").notNull(),
    userId: text("userId").notNull(),
    scope: text("scope").notNull(),
    expiresAt: dateTimeText("expiresAt").notNull(),
    createdAt: dateTimeText("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    tokenKey: uniqueIndex("OAuthAccessToken_token_key").on(table.token),
    clientIdx: index("OAuthAccessToken_clientId_idx").on(table.clientId),
    userIdx: index("OAuthAccessToken_userId_idx").on(table.userId),
  }),
);

export const adminAuditLogs = sqliteTable(
  "AdminAuditLog",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    actorUserId: text("actorUserId").notNull(),
    action: text("action").notNull(),
    targetType: text("targetType").notNull(),
    targetId: text("targetId").notNull(),
    detail: text("detail"),
    createdAt: dateTimeText("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => ({
    actorIdx: index("AdminAuditLog_actorUserId_idx").on(table.actorUserId),
    actionIdx: index("AdminAuditLog_action_idx").on(table.action),
    createdAtIdx: index("AdminAuditLog_createdAt_idx").on(table.createdAt),
  }),
);

export const adminRoles = sqliteTable(
  "AdminRole",
  {
    id: text("id").primaryKey().$defaultFn(() => randomUUID()),
    userId: text("userId").notNull(),
    role: text("role").notNull().default("admin"),
    createdAt: dateTimeText("createdAt").notNull().default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: dateTimeText("updatedAt")
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdKey: uniqueIndex("AdminRole_userId_key").on(table.userId),
    roleIdx: index("AdminRole_role_idx").on(table.role),
  }),
);
