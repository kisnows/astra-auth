import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const dbPath = process.env.AUTH_SQLITE_PATH || "infra/db/auth.sqlite";
const adminEmail = (process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const authBaseUrl = (
  process.env.AUTH_PUBLIC_URL ||
  process.env.AUTH_ISSUER ||
  "http://localhost:4300"
).trim().replace(/\/+$/, "");
const ttlMinutes = Number.parseInt(
  (process.env.AUTH_ADMIN_PASSWORD_RESET_TTL_MINUTES || "30").trim(),
  10,
);

const IDENTIFIER_PREFIX = "admin_password_reset:";

function resolveTtlMinutes() {
  if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) return 30;
  return ttlMinutes;
}

/**
 * 中文注释：生成管理员密码重置链接（一次性 token），用于服务器命令行应急改密。
 */
function main() {
  if (!adminEmail) {
    console.error("[auth-reset-link] AUTH_BOOTSTRAP_ADMIN_EMAIL 未配置，无法定位管理员账号");
    process.exit(1);
  }

  const db = new DatabaseSync(dbPath);
  try {
    const adminUser = db
      .prepare("SELECT id, email FROM User WHERE lower(email) = lower(?) LIMIT 1")
      .get(adminEmail);

    if (!adminUser?.id) {
      console.error(`[auth-reset-link] 未找到该邮箱用户，请先注册账号: ${adminEmail}`);
      process.exit(1);
    }

    const role = db
      .prepare("SELECT role FROM AdminRole WHERE userId = ? LIMIT 1")
      .get(adminUser.id);
    if (role?.role !== "admin") {
      console.warn(
        `[auth-reset-link] 警告：该用户当前无 AdminRole，仍继续生成重置链接: ${adminEmail}`,
      );
    }

    const token = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + resolveTtlMinutes() * 60 * 1000).toISOString();
    const identifier = `${IDENTIFIER_PREFIX}${adminUser.id}`;

    db.exec("BEGIN");
    try {
      // 中文注释：同一管理员仅保留最近一次重置 token，避免并发链接混淆。
      db.prepare("DELETE FROM AuthVerification WHERE identifier = ?").run(identifier);
      db.prepare(
        `
        INSERT INTO AuthVerification (id, identifier, value, expiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(randomUUID(), identifier, token, expiresAt, now.toISOString(), now.toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const resetLink = `${authBaseUrl}/account/password-reset/by-token?token=${encodeURIComponent(token)}`;
    console.log(`[auth-reset-link] admin: ${adminUser.email}`);
    console.log(`[auth-reset-link] expiresAt: ${expiresAt}`);
    console.log(`[auth-reset-link] url: ${resetLink}`);
  } finally {
    db.close();
  }
}

main();
