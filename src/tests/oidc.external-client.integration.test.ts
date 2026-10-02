import type * as OidcService from "@/server/oidc/service";
import type * as AuthorizeRoute from "@/app/oauth2/authorize/route";
import type * as TokenRoute from "@/app/oauth2/token/route";
import type * as ClientRoute from "@/app/api/admin/clients/route";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createLocalJWKSet, jwtVerify } from "jose";
import { eq } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ userId: "owner", admin: true }));
vi.mock("@/server/auth-session", () => ({
  resolveAuthenticatedUserFromRequest: async () => mocks.userId ? ({ id: mocks.userId, mustChangePassword: false }) : null,
}));
vi.mock("@/server/admin/guard", () => ({
  resolveAdminUserFromRequest: async () => mocks.admin ? { id: "owner" } : null,
}));
const dir = mkdtempSync(path.join(tmpdir(), "astra-oidc-external-"));
const issuer = "https://auth.example.test:20777";
const redirectUri = "https://stock.example.test:20777/auth/callback";
const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier).digest("base64url");
let service: typeof OidcService;
let authorize: typeof AuthorizeRoute;
let token: typeof TokenRoute;
let clients: typeof ClientRoute;
let clientId: string;
let clientSecret: string;

function authorizationUrl(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId,
    redirect_uri: redirectUri, scope: "openid profile email", state: "external-state",
    nonce: "external-client-nonce", code_challenge: challenge, code_challenge_method: "S256", ...overrides });
  return new Request(`${issuer}/oauth2/authorize?${params}`);
}
function tokenRequest(code: string, codeVerifier = verifier) {
  return new Request(`${issuer}/oauth2/token`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
      client_secret: clientSecret, redirect_uri: redirectUri, code, code_verifier: codeVerifier }) });
}

beforeAll(async () => {
  process.env.AUTH_SQLITE_PATH = path.join(dir, "auth.sqlite");
  process.env.AUTH_ISSUER = issuer;
  execFileSync(process.execPath, ["scripts/bootstrap-auth.mjs"], { env: { ...process.env, NODE_ENV: "production",
    AUTH_BOOTSTRAP_DEMO_USER: "false", AUTH_BOOTSTRAP_ADMIN_USER: "false", AUTH_BOOTSTRAP_E2E_USER: "false",
    AUTH_BOOTSTRAP_LOCAL_CLIENT: "false", AUTH_BOOTSTRAP_STRICT_SEED_USERS: "false" } });
  const { default: db } = await import("@/server/db");
  const { users } = await import("@/server/db/schema");
  db.insert(users).values([
    { id: "owner", email: "owner@example.test", name: "Owner" },
    { id: "other", email: "other@example.test", name: "Other" },
  ]).run();
  service = await import("@/server/oidc/service");
  authorize = await import("@/app/oauth2/authorize/route");
  token = await import("@/app/oauth2/token/route");
  clients = await import("@/app/api/admin/clients/route");
  const created = await service.createOAuthClient({ actorUserId: "owner", appName: "Stock",
    redirectUris: [redirectUri], scopes: "openid profile email", trusted: true, allowedUserIds: ["owner"] });
  clientId = created.client.clientId;
  clientSecret = created.clientSecret;
});
afterAll(() => {
  const runtime = globalThis as typeof globalThis & { sqlite?: { close(): void }; db?: unknown };
  runtime.sqlite?.close(); delete runtime.sqlite; delete runtime.db;
  delete process.env.AUTH_SQLITE_PATH; delete process.env.AUTH_ISSUER;
  rmSync(dir, { recursive: true, force: true });
});

describe("外部系统 OIDC 接入", () => {
  it("登录介绍保存后只对合法应用上下文展示，兼容旧管理调用", async () => {
    const { resolveLoginApplication } = await import("@/server/oidc/login-application");
    const raw = () => { const url = new URL(authorizationUrl().url); return url.pathname + url.search; };
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Media Vault", loginDescription: "整理与播放你的授权媒体。\n仅授权账号可访问。",
      redirectUris: [redirectUri], scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: ["owner"] });
    expect(await resolveLoginApplication(raw())).toEqual({ appName: "Media Vault", description: "整理与播放你的授权媒体。\n仅授权账号可访问。", origin: new URL(redirectUri).origin });
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Life Finance",
      redirectUris: [redirectUri], scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: ["owner"] });
    expect((await resolveLoginApplication(raw()))?.description).toContain("整理");
    expect((await resolveLoginApplication(raw() + "&appName=Spoof&description=untrusted"))?.appName).toBe("Life Finance");
    for (const value of [undefined, [raw(),raw()], "//evil.test" + raw(), "https://evil.test" + raw(), "/account", raw() + "#fragment", raw() + "&client_id=other", raw() + "&scope=openid", "/\\evil.test", raw().replace("response_type=code", "response_type=token")]) {
      expect(await resolveLoginApplication(value)).toBeNull();
    }
    for (const override of [{ client_id: "unknown" }, { redirect_uri: "https://evil.test/callback" }, { scope: "admin" }, { code_challenge_method: "plain" }]) {
      const url = new URL(authorizationUrl(override).url); expect(await resolveLoginApplication(url.pathname + url.search)).toBeNull();
    }
    const makeRequest = (description: unknown) => new Request(`${issuer}/api/admin/clients`, { method: "PATCH", headers: { "content-type": "application/json", origin: issuer }, body: JSON.stringify({ clientId, appName: "Media Vault", loginDescription: description, redirectUris: redirectUri, scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: ["owner"] }) });
    expect((await clients.PATCH(makeRequest("x".repeat(501)))).status).toBe(400);
    expect((await clients.PATCH(makeRequest({ html: "unsafe" }))).status).toBe(400);
    expect((await clients.PATCH(makeRequest(""))).status).toBe(200);
    expect((await resolveLoginApplication(raw()))?.description).toBeNull();
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Stock", redirectUris: [redirectUri], scopes: "openid profile email", trusted: true, status: "disabled", allowedUserIds: ["owner"] });
    expect(await resolveLoginApplication(raw())).toBeNull();
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Stock", redirectUris: [redirectUri], scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: ["owner"] });
  });

  it("完整授权码登录保留端口、state 和 nonce，令牌签名与 audience 可验证", async () => {
    const response = await authorize.GET(authorizationUrl());
    const callback = new URL(response.headers.get("location")!);
    expect(callback.origin).toBe("https://stock.example.test:20777");
    expect(callback.searchParams.get("state")).toBe("external-state");
    const result = await token.POST(tokenRequest(callback.searchParams.get("code")!));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const payload = await result.json();
    const { getPublicJwks } = await import("@/server/oidc/keys");
    const keys = createLocalJWKSet(await getPublicJwks());
    const verified = await jwtVerify(payload.id_token, keys, { issuer, audience: clientId });
    expect(verified.payload.sub).toBe("owner");
    expect(verified.payload.nonce).toBe("external-client-nonce");
    await expect(jwtVerify(payload.id_token, keys, { issuer, audience: "another-app" })).rejects.toThrow();
    expect((await token.POST(tokenRequest(callback.searchParams.get("code")!))).status).toBe(400);
  });

  it("代理内部地址不会进入登录后的回跳地址", async () => {
    mocks.userId = "";
    const original = authorizationUrl();
    const internal = new URL(original.url); internal.host = "localhost:3000";
    const response = await authorize.GET(new Request(internal));
    const target = new URL(response.headers.get("location")!);
    expect(target.origin).toBe(issuer);
    expect(target.searchParams.get("callbackUrl")).toBe(internal.pathname + internal.search);
    mocks.userId = "owner";
  });

  it("未知应用和未登记的回调地址不会重定向", async () => {
    for (const options of ([{ client_id: "missing" }, { redirect_uri: "https://untrusted.test/" }] as Record<string, string>[])) {
      const response = await authorize.GET(authorizationUrl(options));
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it("未授权账号被拒绝；缺失或不合法 PKCE 被拒绝", async () => {
    mocks.userId = "other";
    const response = await authorize.GET(authorizationUrl());
    expect(new URL(response.headers.get("location")!).searchParams.get("error")).toBe("access_denied");
    mocks.userId = "owner";
    for (const options of ([{ code_challenge: "" }, { code_challenge_method: "plain" }, { nonce: "" }] as Record<string, string>[])) {
      const rejected = await authorize.GET(authorizationUrl(options));
      expect(new URL(rejected.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    }
  });

  it("错误 verifier 不消费授权码，并发兑换最多成功一次", async () => {
    const response = await authorize.GET(authorizationUrl());
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    expect((await token.POST(tokenRequest(code, "x".repeat(64)))).status).toBe(400);
    const results = await Promise.all([token.POST(tokenRequest(code)), token.POST(tokenRequest(code))]);
    expect(results.map((item) => item.status).sort()).toEqual([200, 400]);
  });

  it("授权撤销立即阻止 token 兑换和 userinfo 查询，旧客户端 NULL 保持兼容", async () => {
    const code = await service.issueAuthorizationCode({ clientId, userId: "owner", redirectUri, scope: "openid", codeChallenge: challenge });
    const access = await service.exchangeAuthorizationCode({ clientId, code, redirectUri, codeVerifier: verifier });
    const pending = await service.issueAuthorizationCode({ clientId, userId: "owner", redirectUri, scope: "openid" });
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Stock", redirectUris: [redirectUri],
      scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: [] });
    expect(await service.findAccessToken(access!.accessToken)).toBeNull();
    expect(await service.exchangeAuthorizationCode({ clientId, code: pending, redirectUri })).toBeNull();
    service.updateOAuthClient({ actorUserId: "owner", clientId, appName: "Stock", redirectUris: [redirectUri],
      scopes: "openid profile email", trusted: true, status: "active", allowedUserIds: null });
    expect(await service.findAccessToken(access!.accessToken)).not.toBeNull();
    const { default: db } = await import("@/server/db");
    const { users } = await import("@/server/db/schema");
    db.update(users).set({ isDisabled: true }).where(eq(users.id, "owner")).run();
    expect(await service.findAccessToken(access!.accessToken)).toBeNull();
    db.update(users).set({ isDisabled: false }).where(eq(users.id, "owner")).run();
  });

  it("管理接口隐藏 secret 摘要，创建默认拒绝访问，拦截非法回调和跨站写入", async () => {
    const config = { appName: "Promise", redirectUris: redirectUri };
    const request = (body: unknown, origin = issuer) => new Request(`${issuer}/api/admin/clients`, {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
    const created = await clients.POST(request(config));
    expect(created.status).toBe(200);
    const body = await created.json();
    expect(body.item.allowedUserIds).toBe("[]");
    expect(body.item.clientSecret).toBeUndefined();
    expect(body.clientSecret).toBeTruthy();
    const listed = await (await clients.GET(new Request(`${issuer}/api/admin/clients`))).json();
    expect(listed.items.every((item: Record<string, unknown>) => !("clientSecret" in item))).toBe(true);
    expect((await clients.POST(request({ ...config, redirectUris: "https://wild.test/*" }))).status).toBe(400);
    expect((await clients.POST(request({ ...config, allowedUserIds: ["missing"] }))).status).toBe(400);
    expect((await clients.POST(request(config, "https://untrusted.test"))).status).toBe(403);
    mocks.admin = false;
    expect((await clients.POST(request(config))).status).toBe(403);
    mocks.admin = true;
  });
});
