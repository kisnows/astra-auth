import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_SOURCE = "";
const DEFAULT_TARGET = "infra/db/auth.sqlite";

function resolveSqlitePath(rawPath?: string) {
  // 统一处理 file: 前缀，避免路径格式不一致
  if (!rawPath) return "";
  if (rawPath.startsWith("file:")) return rawPath.replace("file:", "");
  return rawPath;
}

function ensureSqliteDirExists(filePath: string) {
  // 确保目标 sqlite 目录存在，避免写入失败
  if (!filePath) return;
  if (filePath === ":memory:") return;
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  mkdirSync(dir, { recursive: true });
}

function initAuthSchema(db: Database.Database) {
  // 初始化认证表结构，避免首次运行找不到表
  db.exec(`
    CREATE TABLE IF NOT EXISTS User (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      image TEXT,
      passwordHash TEXT,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL
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
  `);

  const userColumns = db.prepare("PRAGMA table_info(User)").all() as Array<{
    name: string;
  }>;
  if (!userColumns.some((column) => column.name === "passwordHash")) {
    db.exec("ALTER TABLE User ADD COLUMN passwordHash TEXT");
  }
}

function main() {
  const sourcePath = resolveSqlitePath(
    process.env.WEALTH_SQLITE_PATH || DEFAULT_SOURCE,
  );
  const targetPath = resolveSqlitePath(
    process.env.AUTH_SQLITE_PATH || DEFAULT_TARGET,
  );

  if (!sourcePath) {
    throw new Error("source_db_path_required");
  }
  if (!targetPath) {
    throw new Error("target_db_path_required");
  }

  ensureSqliteDirExists(targetPath);

  const sourceDb = new Database(sourcePath, { readonly: true });
  const targetDb = new Database(targetPath);

  initAuthSchema(targetDb);

  const readUsers = sourceDb.prepare(`
    SELECT id, email, name, image, emailVerified, createdAt, updatedAt
    FROM User
  `);
  const readAccounts = sourceDb.prepare(`
    SELECT id, providerId, accountId, userId, accessToken, refreshToken,
           idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
           createdAt, updatedAt
    FROM AuthAccount
  `);
  const readVerifications = sourceDb.prepare(`
    SELECT id, identifier, value, expiresAt, createdAt, updatedAt
    FROM AuthVerification
  `);

  const insertUser = targetDb.prepare(`
    INSERT INTO User (id, email, name, image, emailVerified, createdAt, updatedAt)
    VALUES (@id, @email, @name, @image, @emailVerified, @createdAt, @updatedAt)
  `);
  const insertAccount = targetDb.prepare(`
    INSERT INTO AuthAccount (
      id, providerId, accountId, userId, accessToken, refreshToken,
      idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password,
      createdAt, updatedAt
    ) VALUES (
      @id, @providerId, @accountId, @userId, @accessToken, @refreshToken,
      @idToken, @accessTokenExpiresAt, @refreshTokenExpiresAt, @scope, @password,
      @createdAt, @updatedAt
    )
  `);
  const insertVerification = targetDb.prepare(`
    INSERT INTO AuthVerification (
      id, identifier, value, expiresAt, createdAt, updatedAt
    ) VALUES (
      @id, @identifier, @value, @expiresAt, @createdAt, @updatedAt
    )
  `);

  const migrate = targetDb.transaction(() => {
    // 清空目标库，保证脚本可重复执行
    targetDb.exec(`
      DELETE FROM AuthSession;
      DELETE FROM AuthAccount;
      DELETE FROM AuthVerification;
      DELETE FROM User;
    `);

    const users = readUsers.all();
    for (const user of users) {
      insertUser.run(user);
    }

    const accounts = readAccounts.all();
    for (const account of accounts) {
      insertAccount.run(account);
    }

    targetDb.exec(`
      UPDATE User
      SET passwordHash = (
        SELECT password
        FROM AuthAccount
        WHERE AuthAccount.userId = User.id
          AND AuthAccount.providerId = 'credential'
        LIMIT 1
      )
      WHERE passwordHash IS NULL;
    `);

    const verifications = readVerifications.all();
    for (const verification of verifications) {
      insertVerification.run(verification);
    }
  });

  migrate();

  sourceDb.close();
  targetDb.close();
}

main();
