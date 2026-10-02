import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./bootstrap-auth.mjs", import.meta.url));

/** 中文注释：执行真实 bootstrap 子进程，确保测试覆盖生产镜像使用的同一个迁移入口。 */
function runBootstrap(dbPath, backupDir) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      AUTH_SQLITE_PATH: dbPath,
      AUTH_DB_BACKUP_DIR: backupDir,
      AUTH_BOOTSTRAP_DEMO_USER: "false",
      AUTH_BOOTSTRAP_ADMIN_USER: "false",
      AUTH_BOOTSTRAP_E2E_USER: "false",
      AUTH_BOOTSTRAP_LOCAL_CLIENT: "false",
      AUTH_BOOTSTRAP_STRICT_SEED_USERS: "false",
    },
  });
}

test("旧 Auth SQLite 原地升级时保留数据、生成一次备份并登记幂等迁移", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "astra-auth-migration-"));
  const dbPath = path.join(tempDir, "auth.sqlite");
  const backupDir = path.join(tempDir, "backups");

  try {
    const legacyDb = new DatabaseSync(dbPath);
    legacyDb.exec(`
      CREATE TABLE User (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        image TEXT,
        emailVerified INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      INSERT INTO User (id, email, name, image, emailVerified, createdAt, updatedAt)
      VALUES ('legacy-user', 'legacy@example.com', 'Legacy', NULL, 1, '2026-01-01', '2026-01-01');
    `);
    legacyDb.close();

    const first = runBootstrap(dbPath, backupDir);
    assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);

    const migratedDb = new DatabaseSync(dbPath, { readOnly: true });
    const user = migratedDb.prepare("SELECT id, email FROM User WHERE id = ?").get("legacy-user");
    const columns = migratedDb.prepare("PRAGMA table_info(User)").all().map((row) => row.name);
    const migration = migratedDb
      .prepare("SELECT id FROM __astra_auth_migrations WHERE id = ?")
      .get("0001-auth-schema-v1");
    const nonceColumns = migratedDb.prepare("PRAGMA table_info(OAuthAuthorizationCode)").all().map((row) => row.name);
    const clientColumns = migratedDb.prepare("PRAGMA table_info(OAuthClient)").all().map((row) => row.name);
    assert.ok(nonceColumns.includes("nonce"));
    assert.ok(clientColumns.includes("allowedUserIds"));
    assert.ok(migratedDb.prepare("SELECT id FROM __astra_auth_migrations WHERE id = ?").get("0002-oidc-client-access-nonce"));
    const integrity = migratedDb.prepare("PRAGMA integrity_check").get();
    migratedDb.close();

    assert.equal(user.id, "legacy-user");
    assert.equal(user.email, "legacy@example.com");
    assert.ok(columns.includes("passwordHash"));
    assert.ok(columns.includes("isDisabled"));
    assert.ok(columns.includes("mustChangePassword"));
    assert.equal(migration.id, "0001-auth-schema-v1");
    assert.equal(integrity.integrity_check, "ok");
    assert.equal(fs.readdirSync(backupDir).length, 1);

    const second = runBootstrap(dbPath, backupDir);
    assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(fs.readdirSync(backupDir).length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


test("已登记 v1 的客户端升级后保持原授权和业务记录", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astra-auth-v1-"));
  const dbPath = path.join(dir, "auth.sqlite");
  const backupDir = path.join(dir, "backups");
  try {
    assert.equal(runBootstrap(dbPath, backupDir).status, 0);
    const db = new DatabaseSync(dbPath);
    db.exec(`ALTER TABLE OAuthClient DROP COLUMN allowedUserIds;
      ALTER TABLE OAuthAuthorizationCode DROP COLUMN nonce;
      DELETE FROM __astra_auth_migrations WHERE id='0002-oidc-client-access-nonce';
      INSERT INTO OAuthClient(id,clientId,clientSecret,appName,redirectUris,scopes,trusted,status,createdAt,updatedAt)
      VALUES('legacy','legacy','preserved-hash','Legacy','https://app.test/callback','openid',1,'active','2026-01-01','2026-01-01');`);
    db.close();
    const result = runBootstrap(dbPath, backupDir);
    assert.equal(result.status, 0, result.stderr);
    const upgraded = new DatabaseSync(dbPath, { readOnly: true });
    const client = upgraded.prepare("SELECT clientSecret,allowedUserIds FROM OAuthClient WHERE id='legacy'").get();
    assert.equal(client.clientSecret, "preserved-hash");
    assert.equal(client.allowedUserIds, null);
    assert.equal(upgraded.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    upgraded.close();
    const count = fs.readdirSync(backupDir).length;
    assert.ok(count >= 1);
    assert.equal(runBootstrap(dbPath, backupDir).status, 0);
    assert.equal(fs.readdirSync(backupDir).length, count);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test("v2 客户端介绍兼容迁移保留凭据授权并支持旧版读取，重复启动不覆盖介绍", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "astra-auth-presentation-"));
  const dbPath = path.join(dir, "auth.sqlite"); const backupDir = path.join(dir, "backups");
  try {
    assert.equal(runBootstrap(dbPath, backupDir).status, 0);
    const db = new DatabaseSync(dbPath);
    db.exec(`ALTER TABLE OAuthClient DROP COLUMN loginDescription;
      DELETE FROM __astra_auth_migrations WHERE id='0003-oidc-client-login-description';
      INSERT INTO OAuthClient(id,clientId,clientSecret,appName,redirectUris,scopes,trusted,status,allowedUserIds,createdAt,updatedAt)
      VALUES('existing','existing','preserved-secret-hash','Existing','https://app.test/callback','openid',1,'active','["owner"]','2026-01-01','2026-01-01');`);
    const before = db.prepare("SELECT * FROM OAuthClient").all(); db.close();
    const result = runBootstrap(dbPath, backupDir); assert.equal(result.status, 0, result.stderr);
    const upgraded = new DatabaseSync(dbPath);
    const row = upgraded.prepare("SELECT * FROM OAuthClient").get();
    assert.equal(row.loginDescription, null); delete row.loginDescription; assert.deepEqual(row, before[0]);
    assert(upgraded.prepare("SELECT id FROM __astra_auth_migrations WHERE id='0003-oidc-client-login-description'").get());
    upgraded.prepare("UPDATE OAuthClient SET loginDescription=?").run("保持自定义介绍"); upgraded.close();
    const files = fs.readdirSync(backupDir); assert.equal(files.length, 1);
    const backup = new DatabaseSync(path.join(backupDir, files[0]), { readOnly: true });
    assert.deepEqual(backup.prepare("SELECT * FROM OAuthClient").all(), before); backup.close();
    assert.equal(runBootstrap(dbPath, backupDir).status, 0); assert.equal(fs.readdirSync(backupDir).length, 1);
    const repeated = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(repeated.prepare("SELECT loginDescription FROM OAuthClient").get().loginDescription, "保持自定义介绍");
    assert.equal(repeated.prepare("PRAGMA integrity_check").get().integrity_check, "ok"); repeated.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
