import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({ exchange: vi.fn(), authorize: vi.fn() }));
vi.mock("@/server/federation/providers", () => ({ exchangeIdentity: upstream.exchange, authorizationUrl: upstream.authorize }));
type DbGlobal = typeof globalThis & { sqlite?: { close?: () => void }; db?: unknown };
let tempDir: string;
const provider = { id: "github", name: "GitHub", type: "github", enabled: true, clientId: "test-client", clientSecret: "test-secret" };
async function modules() {
  const [session, config, flow, identity, route, connections, dbModule, schema] = await Promise.all([
    import("@/server/services/auth/session"), import("@/server/federation/config"), import("@/server/federation/flow"),
    import("@/server/federation/identity"), import("@/app/api/federation/[provider]/[action]/route"),
    import("@/app/api/federation/connections/route"), import("@/server/db"), import("@/server/db/schema"),
  ]);
  return { session, config, flow, identity, route, connections, db: dbModule.default, schema };
}
function request(url: string, method = "GET", body?: unknown, cookie = "", origin = "https://auth.example.com") {
  return new NextRequest(`https://auth.example.com${url}`, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
}
const context = (action: string) => ({ params: Promise.resolve({ provider: "github", action }) });
async function user(email = "owner@example.com") {
  const m = await modules();
  const u = await m.session.createUserWithPassword({ email, password: "original-password" });
  const s = await m.session.createSession({ userId: u.id });
  return { ...u, cookie: `astraos-auth.session_token=${s.token}`, token: s.token };
}
async function start(cookie = "", intent = "login", password = "original-password") {
  const m = await modules();
  const response = await m.route.POST(request("/api/federation/github/start", "POST", { intent, password, returnTo: "/oauth2/authorize?client_id=business" }, cookie), context("start"));
  expect(response.status).toBe(200);
  const state = new URL((await response.json()).url).searchParams.get("state")!;
  const proof = response.cookies.get("astra-federation-github")!.value;
  return { state, cookie: `${cookie}; astra-federation-github=${proof}`, proof };
}
async function callback(state: string, cookie: string) {
  return (await modules()).route.GET(request(`/api/federation/github/callback?state=${state}&code=code`, "GET", undefined, cookie), context("callback"));
}

beforeEach(() => {
  vi.resetModules();
  const g = globalThis as DbGlobal; g.sqlite?.close?.(); delete g.sqlite; delete g.db;
  tempDir = mkdtempSync(path.join(tmpdir(), "auth-federation-"));
  vi.stubEnv("AUTH_SQLITE_PATH", path.join(tempDir, "auth.sqlite"));
  vi.stubEnv("AUTH_SECRET", "s".repeat(48)); vi.stubEnv("AUTH_PUBLIC_URL", "https://auth.example.com");
  vi.stubEnv("AUTH_COOKIE_SECURE", "false"); vi.stubEnv("AUTH_COOKIE_DOMAIN", "");
  vi.stubEnv("AUTH_UPSTREAM_PROVIDERS_FILE", path.join(tempDir, "providers.json"));
  writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([provider]));
  upstream.authorize.mockImplementation(async (_provider, _flow, state) => `https://provider.example.com/authorize?state=${state}`);
  upstream.exchange.mockResolvedValue({ subject: "upstream-subject", email: "new@example.com", name: "New User" });
});
afterEach(() => {
  const g = globalThis as DbGlobal; g.sqlite?.close?.(); delete g.sqlite; delete g.db;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("第三方登录和账号绑定", () => {
  it("验证密码绑定、退出后第三方登录保留 User.id，回到原 OIDC 授权地址", async () => {
    const m = await modules(); const owner = await user();
    const first = await start(owner.cookie, "link");
    expect((await callback(first.state, first.cookie)).headers.get("location")).toContain("result=linked");
    await m.session.deleteSessionByToken(owner.token);
    const login = await start(); const result = await callback(login.state, login.cookie);
    expect(result.headers.get("location")).toBe("https://auth.example.com/oauth2/authorize?client_id=business");
    const authenticated = await m.session.getSessionByToken(result.cookies.get("astraos-auth.session_token")!.value);
    expect(authenticated?.user.id).toBe(owner.id);
    const rows = await m.db.select().from(m.schema.authAccounts).where(eq(m.schema.authAccounts.providerId, m.config.identityNamespace(m.config.requireProvider("github"))));
    expect(rows).toHaveLength(1); expect(rows[0].accessToken).toBeNull(); expect(rows[0].idToken).toBeNull();
    expect(await m.db.select().from(m.schema.adminRoles)).toHaveLength(0);
  });
  it("首次第三方登录注册无密码普通账号，后续邮箱变化仍登录同一用户", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const token = result.cookies.get("astraos-auth.session_token")!.value;
    const owner = (await m.session.getSessionByToken(token))!.user;
    expect(owner.email).toBe("new@example.com");
    const [row] = await m.db.select().from(m.schema.users);
    expect(row.passwordHash).toBeNull(); expect(row.emailVerified).toBe(true);
    expect(await m.db.select().from(m.schema.authAccounts)).toHaveLength(1);
    expect(await m.db.select().from(m.schema.adminRoles)).toHaveLength(0);
    expect(await m.db.select().from(m.schema.oauthClients)).toHaveLength(0);
    upstream.exchange.mockResolvedValueOnce({ subject: "upstream-subject", email: "changed@example.com", name: "Renamed" });
    const next = await start(); const login = await callback(next.state, next.cookie);
    expect((await m.session.getSessionByToken(login.cookies.get("astraos-auth.session_token")!.value))?.user.id).toBe(owner.id);
    expect(await m.db.select().from(m.schema.users)).toHaveLength(1);
    expect((await m.db.select().from(m.schema.users))[0].email).toBe("new@example.com");
  });
  it("已注册邮箱不能自动合并或接管，失败无副作用", async () => {
    const m = await modules(); await user();
    upstream.exchange.mockResolvedValueOnce({ subject: "upstream-subject", email: " OWNER@EXAMPLE.COM ", name: "Impostor" });
    const flow = await start();
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("email_already_registered");
    expect(await m.db.select().from(m.schema.users)).toHaveLength(1);
    expect((await m.db.select().from(m.schema.authAccounts)).filter((a) => a.providerId.startsWith("external:"))).toHaveLength(0);
    expect(await m.db.select().from(m.schema.adminAuditLogs)).toHaveLength(0);
  });
  it("没有已验证邮箱拒绝自动注册，已有绑定仍可登录", async () => {
    const m = await modules();
    upstream.exchange.mockResolvedValue({ subject: "upstream-subject", email: null, name: null });
    const first = await start(); expect((await callback(first.state, first.cookie)).headers.get("location")).toContain("verified_email_required");
    expect(await m.db.select().from(m.schema.users)).toHaveLength(0);
    const owner = await user(); m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    const next = await start(); const result = await callback(next.state, next.cookie);
    expect((await m.session.getSessionByToken(result.cookies.get("astraos-auth.session_token")!.value))?.user.id).toBe(owner.id);
  });
  it("已登录用户的未知平台身份不能隐式注册", async () => {
    const m = await modules(); const owner = await user(); const flow = await start(owner.cookie);
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("session_changed");
    expect(await m.db.select().from(m.schema.users)).toHaveLength(1);
  });
  it.each(["", "wrong-password"])("错误密码不能发起绑定：%s", async (password) => {
    const m = await modules(); const owner = await user();
    const res = await m.route.POST(request("/api/federation/github/start", "POST", { intent: "link", password }, owner.cookie), context("start"));
    expect(res.status).toBe(400); expect(upstream.authorize).not.toHaveBeenCalled();
  });
  it("拒绝跨站及缺少 Origin 的写请求", async () => {
    const m = await modules();
    for (const origin of ["https://evil.example.com", "null", ""]) {
      expect((await m.route.POST(request("/api/federation/github/start", "POST", { intent: "login" }, "", origin), context("start"))).status).toBe(403);
    }
  });
  it("缺少浏览器证明的回调不能消费合法流程", async () => {
    const owner = await user(); const flow = await start(owner.cookie, "link");
    expect((await callback(flow.state, owner.cookie)).headers.get("location")).toContain("federation_failed");
    expect(upstream.exchange).not.toHaveBeenCalled();
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("result=linked");
  });
  it("一次性流程拒绝回调重放", async () => {
    const owner = await user(); const flow = await start(owner.cookie, "link");
    await callback(flow.state, flow.cookie);
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("federation_failed");
    expect(upstream.exchange).toHaveBeenCalledTimes(1);
  });
  it("会话退出或切换时拒绝绑定", async () => {
    const m = await modules(); const owner = await user(); const flow = await start(owner.cookie, "link");
    await m.session.deleteSessionByToken(owner.token);
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("session_changed");
    expect(upstream.exchange).not.toHaveBeenCalled();
  });
  it("上游请求等待期间退出会话也必须拒绝登录", async () => {
    const m = await modules(); const owner = await user();
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    const flow = await start(owner.cookie);
    upstream.exchange.mockImplementationOnce(async () => { await m.session.deleteSessionByToken(owner.token); return { subject: "upstream-subject", email: null, name: null }; });
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("session_changed");
  });
  it("第三方已属于另一用户时不能抢绑", async () => {
    const m = await modules(); const owner = await user(); const other = await user("other@example.com");
    const ns = m.config.identityNamespace(m.config.requireProvider("github")); m.identity.linkIdentity(owner.id, ns, "upstream-subject");
    const flow = await start(other.cookie, "link");
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("identity_already_linked");
    expect((await m.identity.userForIdentity(ns, "upstream-subject")).id).toBe(owner.id);
  });
  it("已登录另一个用户时不能被第三方回调替换会话", async () => {
    const m = await modules(); const owner = await user(); const other = await user("other@example.com");
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    const flow = await start(other.cookie);
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("session_changed");
  });
  it("禁用账号不能第三方登录", async () => {
    const m = await modules(); const owner = await user();
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    await m.db.update(m.schema.users).set({ isDisabled: true }).where(eq(m.schema.users.id, owner.id));
    const flow = await start();
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("account_unavailable");
  });
  it("强制改密账号登录后仍然进入改密页", async () => {
    const m = await modules(); const owner = await user();
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    await m.db.update(m.schema.users).set({ mustChangePassword: true }).where(eq(m.schema.users.id, owner.id));
    const flow = await start();
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("/account/password-reset?");
  });
  it("身份源应用配置被替换后旧流程失效", async () => {
    const owner = await user(); const flow = await start(owner.cookie, "link");
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([{ ...provider, clientId: "replacement" }]));
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("federation_failed");
    expect(upstream.exchange).not.toHaveBeenCalled();
  });
  it("校验密码解绑，保留原密码和数据", async () => {
    const m = await modules(); const owner = await user(); const ns = m.config.identityNamespace(m.config.requireProvider("github"));
    m.identity.linkIdentity(owner.id, ns, "upstream-subject");
    const overview = await m.connections.GET(request("/api/federation/connections", "GET", undefined, owner.cookie));
    const body = await overview.json(); expect(JSON.stringify(body)).not.toContain("test-secret"); expect(JSON.stringify(body)).not.toContain("upstream-subject");
    const input = { accountId: body.connections[0].id, password: "wrong-password" };
    expect((await m.connections.POST(request("/api/federation/connections", "POST", input, owner.cookie))).status).toBe(400);
    input.password = "original-password";
    expect((await m.connections.POST(request("/api/federation/connections", "POST", input, owner.cookie))).status).toBe(200);
    await expect(m.identity.userForIdentity(ns, "upstream-subject")).rejects.toThrow("identity_not_linked");
    expect((await m.session.verifyEmailPassword({ email: owner.email, password: input.password }))?.id).toBe(owner.id);
  });
  it("解绑接口不能删除密码凭证或别人的绑定", async () => {
    const m = await modules(); const owner = await user(); const other = await user("other@example.com");
    const rows = await m.db.select().from(m.schema.authAccounts).where(eq(m.schema.authAccounts.userId, owner.id));
    expect(() => m.identity.unlinkIdentity(owner.id, rows[0].id)).toThrow("identity_not_found");
    m.identity.linkIdentity(other.id, m.config.identityNamespace(m.config.requireProvider("github")), "other");
    const [row] = await m.db.select().from(m.schema.authAccounts).where(eq(m.schema.authAccounts.accountId, "other"));
    expect(() => m.identity.unlinkIdentity(owner.id, row.id)).toThrow("identity_not_found");
  });
  it("过期或加密数据被篡改时不交换上游 code", async () => {
    const m = await modules(); const owner = await user(); const flow = await start(owner.cookie, "link");
    await m.db.update(m.schema.authVerifications).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("federation_failed");
    const second = await start(owner.cookie, "link"); await m.db.update(m.schema.authVerifications).set({ value: "tampered" });
    expect((await callback(second.state, second.cookie)).headers.get("location")).toContain("federation_failed");
    expect(upstream.exchange).not.toHaveBeenCalled();
  });
  it("ReturnTo 拒绝协议相对地址、反斜线和绝对外站", async () => {
    const { config } = await modules();
    for (const raw of ["//evil.example", "/\\evil.example", "https://evil.example", "/\nevil"]) expect(config.safeReturnTo(raw)).toBe("/account");
    expect(config.safeReturnTo("/oauth2/authorize?client_id=x")).toBe("/oauth2/authorize?client_id=x");
  });
  it("账户概览拒绝匿名或已过期会话，不返回其他用户的绑定", async () => {
    const m = await modules(); const owner = await user(); const other = await user("other@example.com");
    m.identity.linkIdentity(other.id, m.config.identityNamespace(m.config.requireProvider("github")), "other-subject");
    expect((await m.connections.GET(request("/api/federation/connections"))).status).toBe(401);
    const response = await m.connections.GET(request("/api/federation/connections", "GET", undefined, owner.cookie));
    const data = await response.json();
    expect(data.user.email).toBe(owner.email); expect(data.connections).toEqual([]); expect(data.passwordEnabled).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await m.session.deleteSessionByToken(owner.token);
    expect((await m.connections.GET(request("/api/federation/connections", "GET", undefined, owner.cookie))).status).toBe(401);
  });
  it("账户概览区分未配置、已停用和仍然保留的历史绑定，且不泄露凭据", async () => {
    const m = await modules(); const owner = await user();
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(m.config.requireProvider("github")), "upstream-subject");
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([{ ...provider, enabled: false }]));
    const read = async () => (await m.connections.GET(request("/api/federation/connections", "GET", undefined, owner.cookie))).json();
    const disabled = await read();
    expect(disabled.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "github", configured: true, enabled: false }),
      expect.objectContaining({ type: "google", configured: false, enabled: false }),
      expect.objectContaining({ type: "wechat", configured: false, enabled: false }),
      expect.objectContaining({ type: "oidc", configured: false, enabled: false }),
    ]));
    expect(disabled.connections[0]).toMatchObject({ name: "GitHub", providerId: "github", enabled: false });
    expect(disabled.connections[0].linkedAt).toBeTruthy();
    for (const secret of ["test-secret", "upstream-subject", "passwordHash", "external:", "test-client"]) expect(JSON.stringify(disabled)).not.toContain(secret);
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, "[]");
    expect((await read()).connections).toEqual([expect.objectContaining({ name: "已停用的身份源", providerId: null, enabled: false })]);
  });

  it("无密码账号通过上游重新验证设置密码，证明只能使用一次", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const token = result.cookies.get("astraos-auth.session_token")!.value;
    const cookie = `astraos-auth.session_token=${token}`;
    const { POST } = await import("@/app/api/account/password/change/route");
    expect((await POST(request("/api/account/password/change", "POST", { newPassword: "new-password" }, cookie))).status).toBe(400);
    const verify = await start(cookie, "reauthenticate"); const verified = await callback(verify.state, verify.cookie);
    const proof = verified.cookies.get("astra-reauth")!.value;
    const authorized = `${cookie}; astra-reauth=${proof}`;
    expect((await POST(request("/api/account/password/change", "POST", { newPassword: "new-password" }, authorized))).status).toBe(200);
    expect((await m.session.verifyEmailPassword({ email: "new@example.com", password: "new-password" }))?.id).toBe((await m.session.getSessionByToken(token))?.user.id);
    expect((await POST(request("/api/account/password/change", "POST", { newPassword: "replace-password" }, authorized))).status).toBe(400);
    expect((await POST(request("/api/account/password/change", "POST", { currentPassword: "new-password", newPassword: "replace-password" }, authorized, "https://evil.example"))).status).toBe(403);
  });
  it("无密码账号可以验证后添加平台，但不能删除最后一个启用登录方式", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const cookie = `astraos-auth.session_token=${result.cookies.get("astraos-auth.session_token")!.value}`;
    const owner = (await m.session.getSessionByToken(result.cookies.get("astraos-auth.session_token")!.value))!.user;
    const [account] = await m.db.select().from(m.schema.authAccounts);
    expect(() => m.identity.unlinkIdentity(owner.id, account.id)).toThrow("last_login_method");
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([provider, { ...provider, id: "google", name: "Google", type: "google" }]));
    const googleContext = { params: Promise.resolve({ provider: "google", action: "start" }) };
    expect((await m.route.POST(request("/api/federation/google/start", "POST", { intent: "link" }, cookie), googleContext)).status).toBe(400);
    const verify = await start(cookie, "reauthenticate"); const verified = await callback(verify.state, verify.cookie);
    const authorized = `${cookie}; astra-reauth=${verified.cookies.get("astra-reauth")!.value}`;
    const linked = await m.route.POST(request("/api/federation/google/start", "POST", { intent: "link" }, authorized), googleContext);
    expect(linked.status).toBe(200);
    expect((await m.route.POST(request("/api/federation/google/start", "POST", { intent: "link" }, authorized), googleContext)).status).toBe(400);
    const state = new URL((await linked.json()).url).searchParams.get("state")!;
    const proof = linked.cookies.get("astra-federation-google")!.value;
    const complete = await m.route.GET(request(`/api/federation/google/callback?state=${state}&code=code`, "GET", undefined, `${cookie}; astra-federation-google=${proof}`), { params: Promise.resolve({ provider: "google", action: "callback" }) });
    expect(complete.headers.get("location")).toContain("result=linked");
    expect(() => m.identity.unlinkIdentity(owner.id, account.id)).not.toThrow();
    const [remaining] = await m.db.select().from(m.schema.authAccounts);
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([provider, { ...provider, id: "google", name: "Google", type: "google", enabled: false }]));
    expect(() => m.identity.unlinkIdentity(owner.id, remaining.id)).toThrow("last_login_method");
  });
  it("重新验证不能用另一个第三方用户来证明当前账号", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const cookie = `astraos-auth.session_token=${result.cookies.get("astraos-auth.session_token")!.value}`;
    const other = await user("other@example.com");
    m.identity.linkIdentity(other.id, m.config.identityNamespace(m.config.requireProvider("github")), "other-subject");
    const verify = await start(cookie, "reauthenticate");
    upstream.exchange.mockResolvedValueOnce({ subject: "other-subject", email: "other@example.com", name: null });
    const rejected = await callback(verify.state, verify.cookie);
    expect(rejected.headers.get("location")).toContain("reauthentication_required");
    expect(rejected.cookies.get("astra-reauth")).toBeUndefined();
  });
  it("重新验证证明绑定会话并有有效期", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const token = result.cookies.get("astraos-auth.session_token")!.value;
    const cookie = `astraos-auth.session_token=${token}`;
    const owner = (await m.session.getSessionByToken(token))!.user;
    const verify = await start(cookie, "reauthenticate"); const verified = await callback(verify.state, verify.cookie);
    const another = await m.session.createSession({ userId: owner.id });
    const { POST } = await import("@/app/api/account/password/change/route");
    expect((await POST(request("/api/account/password/change", "POST", { newPassword: "new-password" }, `astraos-auth.session_token=${another.token}; astra-reauth=${verified.cookies.get("astra-reauth")!.value}`))).status).toBe(400);
    const again = await start(cookie, "reauthenticate"); const proof = await callback(again.state, again.cookie);
    await m.db.update(m.schema.authVerifications).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await POST(request("/api/account/password/change", "POST", { newPassword: "new-password" }, `${cookie}; astra-reauth=${proof.cookies.get("astra-reauth")!.value}`))).status).toBe(400);
  });
  it("Google 首次登录复用注册事务，微信与 OIDC 维持显式绑定", async () => {
    const m = await modules(); const identity = { subject: "subject", email: "google@example.com", name: "Google User" };
    const google = { ...m.config.requireProvider("github"), id: "google", type: "google" as const };
    const created = m.identity.loginOrRegisterIdentity(google, identity);
    expect(created.email).toBe("google@example.com");
    expect(m.identity.loginOrRegisterIdentity(google, identity).id).toBe(created.id);
    for (const type of ["wechat", "oidc"] as const) expect(() => m.identity.loginOrRegisterIdentity({ ...google, id: type, type }, identity)).toThrow("identity_not_linked");
  });
  it("注册事务中任一写入失败都不会留下用户或绑定", async () => {
    const m = await modules();
    m.db.run(sql`CREATE TRIGGER reject_registration_audit BEFORE INSERT ON AdminAuditLog BEGIN SELECT RAISE(ABORT, 'fixture audit failure'); END`);
    const flow = await start();
    expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("federation_failed");
    expect(await m.db.select().from(m.schema.users)).toHaveLength(0);
    expect(await m.db.select().from(m.schema.authAccounts)).toHaveLength(0);
    expect(await m.db.select().from(m.schema.authSessions)).toHaveLength(0);
  });
  it("无密码解绑接口保护最后一个登录方式且不改变身份", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const cookie = `astraos-auth.session_token=${result.cookies.get("astraos-auth.session_token")!.value}`;
    const verify = await start(cookie, "reauthenticate"); const verified = await callback(verify.state, verify.cookie);
    const [account] = await m.db.select().from(m.schema.authAccounts);
    const response = await m.connections.POST(request("/api/federation/connections", "POST", { accountId: account.id }, `${cookie}; astra-reauth=${verified.cookies.get("astra-reauth")!.value}`));
    expect(response.status).toBe(400); expect((await response.json()).error).toBe("last_login_method");
    expect(await m.db.select().from(m.schema.authAccounts)).toHaveLength(1);
  });
  it("停用的备用身份不能用于删除最后一个可用身份", async () => {
    const m = await modules(); const first = await start(); const result = await callback(first.state, first.cookie);
    const owner = (await m.session.getSessionByToken(result.cookies.get("astraos-auth.session_token")!.value))!.user;
    const [account] = await m.db.select().from(m.schema.authAccounts);
    const google = { ...m.config.requireProvider("github"), id: "google", type: "google" as const, enabled: false };
    m.identity.linkIdentity(owner.id, m.config.identityNamespace(google), "google-subject");
    writeFileSync(process.env.AUTH_UPSTREAM_PROVIDERS_FILE!, JSON.stringify([provider, google]));
    expect(() => m.identity.unlinkIdentity(owner.id, account.id)).toThrow("last_login_method");
    expect(await m.db.select().from(m.schema.authAccounts)).toHaveLength(2);
  });
  it("历史邮箱大小写冲突仍拒绝自动注册", async () => {
    const m = await modules(); const owner = await user();
    await m.db.update(m.schema.users).set({ email: "Owner@Example.COM" }).where(eq(m.schema.users.id, owner.id));
    upstream.exchange.mockResolvedValueOnce({ subject: "new-subject", email: "owner@example.com", name: null });
    const flow = await start(); expect((await callback(flow.state, flow.cookie)).headers.get("location")).toContain("email_already_registered");
    expect(await m.db.select().from(m.schema.users)).toHaveLength(1);
  });
  it("公共身份源列表不泄露任何密钥", async () => {
    const { GET } = await import("@/app/api/federation/providers/route");
    const response = GET(); expect(await response.json()).toEqual([{ id: "github", name: "GitHub" }]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
