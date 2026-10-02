import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createLocalJWKSet, jwtVerify } from "jose";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

it("独立加载和重启沿用同一签名密钥，持久文件只允许所有者读写", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "astra-key-"));
  directories.push(dir);
  const file = path.join(dir, "keys.json");
  vi.stubEnv("AUTH_SIGNING_KEY_PATH", file);
  vi.stubEnv("OIDC_JWT_PRIVATE_KEY", "");
  vi.stubEnv("OIDC_JWT_PUBLIC_KEY", "");
  const first = await import("@/server/oidc/keys");
  vi.resetModules();
  const second = await import("@/server/oidc/keys");
  const [a, b] = await Promise.all([first.getPublicJwks(), second.getPublicJwks()]);
  expect(a).toEqual(b);
  const source = await readFile(file, "utf8");
  // 中文注释：POSIX 权限由 Linux CI 校验；Windows 使用 ACL，不提供对应的 mode 语义。
  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  }
  const token = await first.signIdToken({ issuer: "https://auth.test", audience: "app", subject: "user", role: "user", nonce: "proof" });
  const verified = await jwtVerify(token, createLocalJWKSet(b), { issuer: "https://auth.test", audience: "app" });
  expect(verified.payload.nonce).toBe("proof");
  vi.resetModules();
  expect(await (await import("@/server/oidc/keys")).getPublicJwks()).toEqual(a);
  expect(await readFile(file, "utf8")).toBe(source);
});

it("仅配置一半环境密钥时拒绝启动签名", async () => {
  vi.stubEnv("OIDC_JWT_PRIVATE_KEY", "incomplete");
  vi.stubEnv("OIDC_JWT_PUBLIC_KEY", "");
  await expect((await import("@/server/oidc/keys")).getPublicJwks()).rejects.toThrow("OIDC 公私钥必须同时配置");
});
