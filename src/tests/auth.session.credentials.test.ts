import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbGlobal = typeof globalThis & {
  sqlite?: { close?: () => void };
  db?: unknown;
};

let tempDir = "";

async function loadAuthModules() {
  const [{ default: db }, schema, session, password] = await Promise.all([
    import("@/server/db"),
    import("@/server/db/schema"),
    import("@/server/services/auth/session"),
    import("@/server/services/identity/password"),
  ]);
  return { db, schema, session, password };
}

describe("auth credential password compatibility", () => {
  beforeEach(() => {
    vi.resetModules();
    const globalForDb = globalThis as DbGlobal;
    globalForDb.sqlite?.close?.();
    delete globalForDb.sqlite;
    delete globalForDb.db;

    tempDir = mkdtempSync(path.join(tmpdir(), "astraos-auth-"));
    vi.stubEnv("AUTH_SQLITE_PATH", path.join(tempDir, "auth.sqlite"));
  });

  afterEach(() => {
    const globalForDb = globalThis as DbGlobal;
    globalForDb.sqlite?.close?.();
    delete globalForDb.sqlite;
    delete globalForDb.db;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("新注册用户同时写入 User.passwordHash 和 AuthAccount.password", async () => {
    const { db, schema, session, password } = await loadAuthModules();

    const user = await session.createUserWithPassword({
      email: "new-user@example.com",
      name: "New User",
      password: "new-password",
    });

    const [storedUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    const [credentialAccount] = await db
      .select()
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, user.id))
      .limit(1);

    expect(storedUser.passwordHash).toBeTruthy();
    expect(credentialAccount.password).toBe(storedUser.passwordHash);
    await expect(
      password.verifyPassword("new-password", storedUser.passwordHash ?? ""),
    ).resolves.toBe(true);
  });

  it("旧 AuthAccount 密码可登录，后续更新会同步回 User.passwordHash", async () => {
    const { db, schema, session, password } = await loadAuthModules();
    const userId = randomUUID();
    const legacyHash = await password.hashPassword("legacy-password");
    const now = new Date();

    await db.insert(schema.users).values({
      id: userId,
      email: "legacy-user@example.com",
      name: "Legacy User",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.authAccounts).values({
      id: randomUUID(),
      providerId: "credential",
      accountId: userId,
      userId,
      password: legacyHash,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      session.verifyEmailPassword({
        email: "legacy-user@example.com",
        password: "legacy-password",
      }),
    ).resolves.toEqual({
      id: userId,
      email: "legacy-user@example.com",
      name: "Legacy User",
    });

    const nextHash = await password.hashPassword("next-password");
    await session.upsertCredentialPassword({
      userId,
      passwordHash: nextHash,
      mustChangePassword: false,
    });

    const [storedUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const [credentialAccount] = await db
      .select()
      .from(schema.authAccounts)
      .where(eq(schema.authAccounts.userId, userId))
      .limit(1);

    expect(storedUser.passwordHash).toBe(nextHash);
    expect(credentialAccount.password).toBe(nextHash);
    await expect(
      session.verifyEmailPassword({
        email: "legacy-user@example.com",
        password: "legacy-password",
      }),
    ).resolves.toBeNull();
    await expect(
      session.verifyEmailPassword({
        email: "legacy-user@example.com",
        password: "next-password",
      }),
    ).resolves.toEqual({
      id: userId,
      email: "legacy-user@example.com",
      name: "Legacy User",
    });
  });

  it("禁用用户不会通过邮箱密码登录", async () => {
    const { db, schema, session, password } = await loadAuthModules();
    const userId = randomUUID();
    const passwordHash = await password.hashPassword("disabled-password");
    const now = new Date();

    await db.insert(schema.users).values({
      id: userId,
      email: "disabled-user@example.com",
      name: "Disabled User",
      passwordHash,
      emailVerified: true,
      isDisabled: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      session.verifyEmailPassword({
        email: "disabled-user@example.com",
        password: "disabled-password",
      }),
    ).resolves.toBeNull();
  });
});
