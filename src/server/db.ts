import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "@/server/db/schema";

type GlobalWithDb = typeof globalThis & {
  sqlite?: Database.Database;
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

const globalForDb = globalThis as GlobalWithDb;

function resolveSqlitePath(rawPath?: string) {
  // 统一处理 file: 前缀，保证路径解析一致
  if (!rawPath) {
    const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
    // 中文注释：生产运行时默认写入 /app/data；但 build 阶段使用仓库内路径，避免构建期触发容器目录写入。
    if (process.env.NODE_ENV === "production" && !isProductionBuild) {
      return "/app/data/auth.sqlite";
    }
    return "infra/db/auth.sqlite";
  }
  if (rawPath.startsWith("file:")) return rawPath.replace("file:", "");
  return rawPath;
}

function ensureSqliteDirExists(filePath: string) {
  // 确保 sqlite 文件所在目录存在，避免启动时写文件失败
  if (!filePath) return;
  if (filePath === ":memory:") return;

  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;

  mkdirSync(dir, { recursive: true });
}

function ensureAuthSchema(sqlite: Database.Database) {
  // 认证服务自带最小 schema 初始化，方便独立部署和旧库平滑升级
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image TEXT,
      passwordHash TEXT,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL,
      isDisabled INTEGER NOT NULL DEFAULT 0,
      mustChangePassword INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS User_email_key ON User (email);
    CREATE INDEX IF NOT EXISTS User_email_idx ON User (email);

    CREATE TABLE IF NOT EXISTS AuthAccount (
      id TEXT PRIMARY KEY,
      providerId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      userId TEXT NOT NULL,
      accessToken TEXT,
      refreshToken TEXT,
      idToken TEXT,
      accessTokenExpiresAt TEXT,
      refreshTokenExpiresAt TEXT,
      scope TEXT,
      password TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS AuthAccount_providerId_accountId_key
      ON AuthAccount (providerId, accountId);
    CREATE INDEX IF NOT EXISTS AuthAccount_userId_idx ON AuthAccount (userId);

    CREATE TABLE IF NOT EXISTS AuthSession (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      token TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL,
      ipAddress TEXT,
      userAgent TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS AuthSession_token_key ON AuthSession (token);
    CREATE INDEX IF NOT EXISTS AuthSession_userId_idx ON AuthSession (userId);

    CREATE TABLE IF NOT EXISTS AuthVerification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS OAuthClient (
      id TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      clientSecret TEXT NOT NULL,
      appName TEXT NOT NULL,
      loginDescription TEXT,
      redirectUris TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'openid profile email',
      allowedUserIds TEXT,
      trusted INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL,
      rotatedAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS OAuthClient_clientId_key ON OAuthClient (clientId);
    CREATE INDEX IF NOT EXISTS OAuthClient_status_idx ON OAuthClient (status);

    CREATE TABLE IF NOT EXISTS OAuthAuthorizationCode (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      clientId TEXT NOT NULL,
      userId TEXT NOT NULL,
      redirectUri TEXT NOT NULL,
      scope TEXT NOT NULL,
      nonce TEXT,
      codeChallenge TEXT,
      codeChallengeMethod TEXT,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS OAuthAuthorizationCode_code_key ON OAuthAuthorizationCode (code);
    CREATE INDEX IF NOT EXISTS OAuthAuthorizationCode_clientId_idx ON OAuthAuthorizationCode (clientId);
    CREATE INDEX IF NOT EXISTS OAuthAuthorizationCode_userId_idx ON OAuthAuthorizationCode (userId);
    CREATE INDEX IF NOT EXISTS OAuthAuthorizationCode_expiresAt_idx ON OAuthAuthorizationCode (expiresAt);

    CREATE TABLE IF NOT EXISTS OAuthAccessToken (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      grantId TEXT,
      clientId TEXT NOT NULL,
      userId TEXT NOT NULL,
      scope TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS OAuthAccessToken_token_key ON OAuthAccessToken (token);
    CREATE INDEX IF NOT EXISTS OAuthAccessToken_clientId_idx ON OAuthAccessToken (clientId);
    CREATE INDEX IF NOT EXISTS OAuthAccessToken_userId_idx ON OAuthAccessToken (userId);

    CREATE TABLE IF NOT EXISTS OAuthRefreshGrant (
      id TEXT PRIMARY KEY, clientId TEXT NOT NULL, userId TEXT NOT NULL,
      scope TEXT NOT NULL, clientSecretHash TEXT NOT NULL, expiresAt TEXT NOT NULL, revokedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS OAuthRefreshToken (
      tokenHash TEXT PRIMARY KEY, grantId TEXT NOT NULL, usedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS OAuthRefreshToken_grantId_idx ON OAuthRefreshToken (grantId);

    CREATE TABLE IF NOT EXISTS AdminAuditLog (
      id TEXT PRIMARY KEY,
      actorUserId TEXT NOT NULL,
      action TEXT NOT NULL,
      targetType TEXT NOT NULL,
      targetId TEXT NOT NULL,
      detail TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS AdminAuditLog_actorUserId_idx ON AdminAuditLog (actorUserId);
    CREATE INDEX IF NOT EXISTS AdminAuditLog_action_idx ON AdminAuditLog (action);
    CREATE INDEX IF NOT EXISTS AdminAuditLog_createdAt_idx ON AdminAuditLog (createdAt);

    CREATE TABLE IF NOT EXISTS AdminRole (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS AdminRole_userId_key ON AdminRole (userId);
    CREATE INDEX IF NOT EXISTS AdminRole_role_idx ON AdminRole (role);
  `);

  const columns = sqlite.prepare("PRAGMA table_info(User)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "passwordHash")) {
    sqlite.exec("ALTER TABLE User ADD COLUMN passwordHash TEXT");
  }
  if (!columns.some((column) => column.name === "isDisabled")) {
    sqlite.exec("ALTER TABLE User ADD COLUMN isDisabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "mustChangePassword")) {
    sqlite.exec(
      "ALTER TABLE User ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function getOrCreateDb() {
  if (globalForDb.db) return globalForDb.db;

  const sqlitePath = resolveSqlitePath(process.env.AUTH_SQLITE_PATH);
  ensureSqliteDirExists(sqlitePath);
  const sqlite = globalForDb.sqlite || new Database(sqlitePath);
  ensureAuthSchema(sqlite);
  // 中文注释：已有库的扩展必须经过带备份的 bootstrap 迁移，不在请求中静默 ALTER。
  const clientColumns = sqlite.prepare("PRAGMA table_info(OAuthClient)").all() as { name: string }[];
  const accessColumns = sqlite.prepare("PRAGMA table_info(OAuthAccessToken)").all() as { name: string }[];
  const codeColumns = sqlite.prepare("PRAGMA table_info(OAuthAuthorizationCode)").all() as { name: string }[];
  if (!clientColumns.some((column) => column.name === "loginDescription") ||
      !clientColumns.some((column) => column.name === "allowedUserIds") ||
      !codeColumns.some((column) => column.name === "nonce") ||
      !accessColumns.some((column) => column.name === "grantId")) {
    sqlite.close();
    throw new Error("Auth 数据库需要先执行 scripts/bootstrap-auth.mjs 完成兼容迁移");
  }
  const db = drizzle(sqlite, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.sqlite = sqlite;
    globalForDb.db = db;
  }

  return db;
}

const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  // 中文注释：延迟初始化数据库连接，避免 Next build 的路由分析阶段触发文件系统副作用。
  get(_target, prop, receiver) {
    const instance = getOrCreateDb();
    return Reflect.get(instance, prop, receiver);
  },
});

export { db, schema };
export default db;
