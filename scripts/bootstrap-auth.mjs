import fs from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

function resolveDefaultSqlitePath() {
  // 中文注释：生产容器默认写入 /app/data，开发环境默认保留仓库内 sqlite 文件。
  if (process.env.NODE_ENV === "production") {
    return "/app/data/auth.sqlite";
  }
  return "infra/db/auth.sqlite";
}

const dbPath = process.env.AUTH_SQLITE_PATH || resolveDefaultSqlitePath();
const AUTH_SCHEMA_MIGRATION_ID = "0001-auth-schema-v1";
/**
 * 中文注释：兼容 true/1/yes/on 以及常见笔误 ture，避免因为拼写导致启动注入不生效。
 */
function isEnvEnabled(raw) {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return (
    normalized === "true" ||
    normalized === "1" ||
    normalized === "yes" ||
    normalized === "on" ||
    normalized === "ture"
  );
}

/**
 * 中文注释：清洗环境变量值，去掉首尾空白和包裹引号，降低部署平台注入差异带来的风险。
 */
function normalizeEnvValue(raw) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

/**
 * 中文注释：支持直接传明文密码（优先）或传 bcrypt hash，统一输出可用于入库的 hash。
 */
function resolveBootstrapPasswordHash({ plain, hash, label, fallbackHash }) {
  const normalizedPlain = normalizeEnvValue(plain);
  if (normalizedPlain) {
    try {
      // 中文注释：仅在需要明文转 hash 时按需加载 bcryptjs，避免运行镜像缺失依赖导致启动失败。
      const { hashSync } = require("bcryptjs");
      return hashSync(normalizedPlain, 12);
    } catch {
      console.warn(
        `[auth-init] ${label} 明文密码配置已检测到，但当前环境缺少 bcryptjs，已忽略明文并回退使用 HASH 配置`,
      );
    }
  }

  const normalizedHash = normalizeEnvValue(hash);
  const finalHash = normalizedHash || fallbackHash;
  if (!finalHash.startsWith("$2") || finalHash.length < 59) {
    console.warn(
      `[auth-init] ${label} password hash 可能无效（当前长度=${finalHash.length}），请检查环境变量转义/引号`,
    );
  }
  return finalHash;
}

const enableDemoUser = isEnvEnabled(process.env.AUTH_BOOTSTRAP_DEMO_USER);
const demoUserId = process.env.AUTH_BOOTSTRAP_DEMO_USER_ID || "seed-user-001";
const demoEmail = process.env.AUTH_BOOTSTRAP_DEMO_EMAIL || "user@example.com";
const demoName = process.env.AUTH_BOOTSTRAP_DEMO_NAME || "Standard User";
const demoPasswordHash = resolveBootstrapPasswordHash({
  plain: process.env.AUTH_BOOTSTRAP_DEMO_PASSWORD,
  hash: process.env.AUTH_BOOTSTRAP_DEMO_PASSWORD_HASH,
  label: "demo",
  fallbackHash: "$2b$12$fFsPH6.hFyJ8QmJ5gIDM5e4DxVqTxWYZueW8YGOdGTnJTSzw/.ciy",
});
const enableAdminUser = isEnvEnabled(process.env.AUTH_BOOTSTRAP_ADMIN_USER);
const adminUserId = process.env.AUTH_BOOTSTRAP_ADMIN_USER_ID || "seed-admin-user-001";
const adminEmail = process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL || "admin@example.com";
const adminName = process.env.AUTH_BOOTSTRAP_ADMIN_NAME || "Admin User";
const adminPasswordHash = resolveBootstrapPasswordHash({
  plain: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD,
  hash: process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD_HASH,
  label: "admin",
  fallbackHash: "$2b$12$fFsPH6.hFyJ8QmJ5gIDM5e4DxVqTxWYZueW8YGOdGTnJTSzw/.ciy",
});
const enableE2eUser = isEnvEnabled(process.env.AUTH_BOOTSTRAP_E2E_USER);
const e2eUserId = process.env.AUTH_BOOTSTRAP_E2E_USER_ID || "seed-e2e-user-001";
const e2eEmail =
  process.env.AUTH_BOOTSTRAP_E2E_EMAIL || "e2e-user-1771738633451@example.com";
const e2eName = process.env.AUTH_BOOTSTRAP_E2E_NAME || "E2E User";
const e2ePasswordHash = resolveBootstrapPasswordHash({
  plain: process.env.AUTH_BOOTSTRAP_E2E_PASSWORD,
  hash: process.env.AUTH_BOOTSTRAP_E2E_PASSWORD_HASH,
  label: "e2e",
  fallbackHash: "$2b$12$fFsPH6.hFyJ8QmJ5gIDM5e4DxVqTxWYZueW8YGOdGTnJTSzw/.ciy",
});
const strictSeedUsers = process.env.AUTH_BOOTSTRAP_STRICT_SEED_USERS
  ? isEnvEnabled(process.env.AUTH_BOOTSTRAP_STRICT_SEED_USERS)
  : process.env.NODE_ENV !== "production";
const enableLocalClient = isEnvEnabled(process.env.AUTH_BOOTSTRAP_LOCAL_CLIENT);
const localClientId = process.env.AUTH_BOOTSTRAP_LOCAL_CLIENT_ID || "astra-wealth-local";
const localClientSecret =
  process.env.AUTH_BOOTSTRAP_LOCAL_CLIENT_SECRET || "astra-wealth-local-secret";
const localClientRedirectUri =
  process.env.AUTH_BOOTSTRAP_LOCAL_CLIENT_REDIRECT_URI ||
  "http://localhost:4000/auth/callback";

function hashClientSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 中文注释：判断迁移台账是否已经登记当前 Auth schema，旧库首次升级时返回 false。 */
function hasAuthSchemaMigration(db, migrationId = AUTH_SCHEMA_MIGRATION_ID) {
  const ledger = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='__astra_auth_migrations' LIMIT 1",
    )
    .get();
  if (!ledger) return false;
  return Boolean(
    db
      .prepare("SELECT 1 FROM __astra_auth_migrations WHERE id = ? LIMIT 1")
      .get(migrationId),
  );
}

/** 中文注释：显式检查列是否存在，禁止用空 catch 吞掉真实迁移错误。 */
function columnExists(db, tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

/** 中文注释：使用 SQLite VACUUM INTO 生成一致性备份，避免直接复制 WAL 模式数据库造成快照不完整。 */
function backupBeforeAuthMigration(db) {
  const integrity = db.prepare("PRAGMA integrity_check").get();
  if (integrity?.integrity_check !== "ok") {
    throw new Error(`Auth SQLite 完整性检查失败：${integrity?.integrity_check || "unknown"}`);
  }

  const backupDir =
    process.env.AUTH_DB_BACKUP_DIR?.trim() || path.join(path.dirname(dbPath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
  const backupPath = path.join(backupDir, `auth-before-${AUTH_SCHEMA_MIGRATION_ID}-${timestamp}.sqlite`);
  const escapedBackupPath = backupPath.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escapedBackupPath}'`);
  console.log(`[auth-migrate] 已创建迁移前备份：${backupPath}`);
}

/**
 * 中文注释：幂等创建 auth 全量表结构（账号、OIDC、管理审计）。
 */
function initAuthSchema(db, { existingDatabase }) {
  const migrationPending = !hasAuthSchemaMigration(db);
  const oidcMigrationId = "0002-oidc-client-access-nonce";
  const oidcMigrationPending = !hasAuthSchemaMigration(db, oidcMigrationId);
  const presentationMigrationId = "0003-oidc-client-login-description";
  const presentationMigrationPending = !hasAuthSchemaMigration(db, presentationMigrationId);
  const renewalMigrationId = "0004-oidc-refresh-grants";
  const renewalMigrationPending = !hasAuthSchemaMigration(db, renewalMigrationId);
  if ((migrationPending || oidcMigrationPending || presentationMigrationPending || renewalMigrationPending) && existingDatabase) backupBeforeAuthMigration(db);

  db.exec("BEGIN IMMEDIATE");
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image TEXT,
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
      redirectUris TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT 'openid profile email',
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

    CREATE TABLE IF NOT EXISTS __astra_auth_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);

  // 中文注释：兼容旧库场景，确保新增字段存在；任何真实 ALTER 错误都会回滚事务。
  if (!columnExists(db, "User", "passwordHash")) {
    db.exec("ALTER TABLE User ADD COLUMN passwordHash TEXT;");
  }
  if (!columnExists(db, "User", "isDisabled")) {
    db.exec("ALTER TABLE User ADD COLUMN isDisabled INTEGER NOT NULL DEFAULT 0;");
  }
  if (!columnExists(db, "User", "mustChangePassword")) {
    db.exec("ALTER TABLE User ADD COLUMN mustChangePassword INTEGER NOT NULL DEFAULT 0;");
  }

    if (!columnExists(db, "OAuthClient", "allowedUserIds")) {
      db.exec("ALTER TABLE OAuthClient ADD COLUMN allowedUserIds TEXT");
    }
    if (!columnExists(db, "OAuthAuthorizationCode", "nonce")) {
      db.exec("ALTER TABLE OAuthAuthorizationCode ADD COLUMN nonce TEXT");
    }
    // 中文注释：仅做可空列扩展，历史介绍与身份权限保持不变。
    if (!columnExists(db, "OAuthClient", "loginDescription")) {
      db.exec("ALTER TABLE OAuthClient ADD COLUMN loginDescription TEXT");
    }
    if (!columnExists(db, "OAuthAccessToken", "grantId")) {
      db.exec("ALTER TABLE OAuthAccessToken ADD COLUMN grantId TEXT");
    }
    if (renewalMigrationPending) {
      db.prepare("INSERT INTO __astra_auth_migrations (id, appliedAt) VALUES (?, ?)")
        .run(renewalMigrationId, new Date().toISOString());
    }
    if (presentationMigrationPending) {
      db.prepare("INSERT INTO __astra_auth_migrations (id, appliedAt) VALUES (?, ?)")
        .run(presentationMigrationId, new Date().toISOString());
    }
    if (oidcMigrationPending) {
      db.prepare("INSERT INTO __astra_auth_migrations (id, appliedAt) VALUES (?, ?)")
        .run(oidcMigrationId, new Date().toISOString());
    }
    if (migrationPending) {
      db.prepare(
        "INSERT INTO __astra_auth_migrations (id, appliedAt) VALUES (?, ?)",
      ).run(AUTH_SCHEMA_MIGRATION_ID, new Date().toISOString());
      console.log(`[auth-migrate] 已登记迁移：${AUTH_SCHEMA_MIGRATION_ID}`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 中文注释：幂等注入邮箱密码账号，避免本地反复手工注册。 */
function seedCredentialUser(db, input) {
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    const existingUserByEmail = db
      .prepare("SELECT id FROM User WHERE lower(email) = lower(?) LIMIT 1")
      .get(input.email);
    const existingUserById = db.prepare("SELECT id FROM User WHERE id = ? LIMIT 1").get(input.userId);
    const resolvedUserId = existingUserByEmail?.id || existingUserById?.id || input.userId;

    if (existingUserByEmail || existingUserById) {
      db.prepare(
        `
        UPDATE User
        SET email = ?, name = ?, updatedAt = ?
        WHERE id = ?
      `,
      ).run(input.email, input.name, now, resolvedUserId);
    } else {
      db.prepare(
        `
        INSERT INTO User (id, email, name, image, emailVerified, createdAt, updatedAt, isDisabled)
        VALUES (?, ?, ?, NULL, 1, ?, ?, 0)
      `,
      ).run(resolvedUserId, input.email, input.name, now, now);
    }

    const existingCredentialAccount = db
      .prepare(
        `
        SELECT id
        FROM AuthAccount
        WHERE providerId='credential'
          AND (userId = ? OR lower(accountId) = lower(?))
        ORDER BY CASE WHEN userId = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
      )
      .get(resolvedUserId, input.email, resolvedUserId);

    if (existingCredentialAccount) {
      db.prepare(
        `
        UPDATE AuthAccount
        SET accountId = ?, userId = ?, password = ?, updatedAt = ?
        WHERE id = ?
      `,
      ).run(resolvedUserId, resolvedUserId, input.passwordHash, now, existingCredentialAccount.id);
    } else {
      db.prepare(
        `
        INSERT INTO AuthAccount (
          id, providerId, accountId, userId, accessToken, refreshToken,
          idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope,
          password, createdAt, updatedAt
        )
        VALUES (?, 'credential', ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)
      `,
      ).run(input.accountId, resolvedUserId, resolvedUserId, input.passwordHash, now, now);
    }

    db.exec("COMMIT");
    console.log(
      `[auth-init] ${input.label} credential user ensured: ${input.email} (userId=${resolvedUserId})`,
    );
    return resolvedUserId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readAdminAllowlist() {
  const raw = process.env.AUTH_ADMIN_ALLOWLIST || "";
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function seedAdminRolesFromAllowlist(db) {
  const allowlist = readAdminAllowlist();
  if (allowlist.length === 0) return;

  const users = db
    .prepare("SELECT id, email FROM User WHERE lower(email) IN (" + allowlist.map(() => "?").join(",") + ")")
    .all(...allowlist);
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO AdminRole (id, userId, role, createdAt, updatedAt)
    VALUES (?, ?, 'admin', ?, ?)
    ON CONFLICT(userId) DO UPDATE SET
      role='admin',
      updatedAt=excluded.updatedAt
  `);

  for (const user of users) {
    insert.run(`admin-role-${user.id}`, user.id, now, now);
  }
}

/**
 * 中文注释：普通种子用户若不在管理员 allowlist 中，启动时自动移除历史 admin 角色，避免本地权限污染。
 */
function ensureSeedUserNonAdminUnlessAllowlisted(db, input) {
  const allowlist = readAdminAllowlist();
  const allowed =
    allowlist.includes(input.userId.toLowerCase()) || allowlist.includes(input.email.toLowerCase());
  if (allowed) return;

  db.prepare("DELETE FROM AdminRole WHERE userId = ?").run(input.userId);
}

/**
 * 中文注释：开发环境按白名单收敛账号，删除非目标用户的会话、账号与管理员角色，避免历史脏数据干扰联调。
 */
function pruneUsersOutsideAllowlist(db, keepUserIds) {
  if (!keepUserIds.length) return;
  const placeholders = keepUserIds.map(() => "?").join(",");
  db.exec("BEGIN");
  try {
    db.prepare(`DELETE FROM AuthSession WHERE userId NOT IN (${placeholders})`).run(
      ...keepUserIds,
    );
    db.prepare(`DELETE FROM AuthAccount WHERE userId NOT IN (${placeholders})`).run(
      ...keepUserIds,
    );
    db.prepare(`DELETE FROM AdminRole WHERE userId NOT IN (${placeholders})`).run(
      ...keepUserIds,
    );
    db.prepare(`DELETE FROM User WHERE id NOT IN (${placeholders})`).run(...keepUserIds);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 中文注释：本地默认注入一个 OAuth Client，降低本地联调配置成本。 */
function seedLocalOAuthClient(db) {
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO OAuthClient (
      id, clientId, clientSecret, appName, redirectUris, scopes, trusted, status, createdAt, updatedAt
    )
    VALUES (?, ?, ?, 'wealth-local', ?, 'openid profile email', 1, 'active', ?, ?)
    ON CONFLICT(clientId) DO UPDATE SET
      clientSecret = excluded.clientSecret,
      redirectUris = excluded.redirectUris,
      scopes = excluded.scopes,
      trusted = excluded.trusted,
      status = excluded.status,
      updatedAt = excluded.updatedAt
  `,
  ).run(
    "oauth-client-local-wealth",
    localClientId,
    hashClientSecret(localClientSecret),
    localClientRedirectUri,
    now,
    now,
  );
  console.log(`[auth-init] local oauth client ensured: ${localClientId}`);
}

function bootstrap() {
  ensureParentDir(dbPath);
  const existingDatabase = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
  const db = new DatabaseSync(dbPath);
  try {
    initAuthSchema(db, { existingDatabase });
    const seededUserIds = [];
    let seededDemoUserId = demoUserId;
    let seededE2eUserId = e2eUserId;
    if (enableDemoUser) {
      seededDemoUserId = seedCredentialUser(db, {
        label: "demo",
        userId: demoUserId,
        accountId: "auth-account-demo-001",
        email: demoEmail,
        name: demoName,
        passwordHash: demoPasswordHash,
      });
      seededUserIds.push(seededDemoUserId);
    }
    if (enableAdminUser) {
      const seededAdminUserId = seedCredentialUser(db, {
        label: "admin",
        userId: adminUserId,
        accountId: "auth-account-admin-001",
        email: adminEmail,
        name: adminName,
        passwordHash: adminPasswordHash,
      });
      seededUserIds.push(seededAdminUserId);
    }
    if (enableE2eUser) {
      seededE2eUserId = seedCredentialUser(db, {
        label: "e2e",
        userId: e2eUserId,
        accountId: "auth-account-e2e-001",
        email: e2eEmail,
        name: e2eName,
        passwordHash: e2ePasswordHash,
      });
      seededUserIds.push(seededE2eUserId);
    }
    seedAdminRolesFromAllowlist(db);
    if (enableDemoUser) {
      ensureSeedUserNonAdminUnlessAllowlisted(db, {
        userId: seededDemoUserId,
        email: demoEmail,
      });
    }
    if (enableE2eUser) {
      ensureSeedUserNonAdminUnlessAllowlisted(db, {
        userId: seededE2eUserId,
        email: e2eEmail,
      });
    }
    if (strictSeedUsers && seededUserIds.length > 0) {
      pruneUsersOutsideAllowlist(db, seededUserIds);
      console.log(
        `[auth-init] strict seed users enabled, pruned users outside allowlist (${seededUserIds.length})`,
      );
    }
    if (enableLocalClient) {
      seedLocalOAuthClient(db);
    }
    console.log(`[auth-init] schema ensured: ${dbPath}`);
  } finally {
    db.close();
  }
}

bootstrap();
