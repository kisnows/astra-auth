import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { UpstreamProvider } from "@/server/federation/config";
import type { FederationFlow } from "@/server/federation/flow";
import { authorizationUrl, exchangeIdentity } from "@/server/federation/providers";

let server: Server;
let issuer: string;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let mutation = "";
let provider: UpstreamProvider;
const flow: FederationFlow = { providerId: "oidc", namespace: "fixture", returnTo: "/", verifier: "v".repeat(43), nonce: "fixture-nonce", userId: null, sessionHash: null };
let pkceVerified = false;
let challenge = "";

beforeAll(async () => {
  keys = await generateKeyPair("RS256"); wrongKeys = await generateKeyPair("RS256");
  server = createServer(async (req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/.well-known/openid-configuration") {
      res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"] }));
    } else if (req.url === "/jwks") {
      res.end(JSON.stringify({ keys: [{ ...await exportJWK(keys.publicKey), kid: "fixture", alg: "RS256", use: "sig" }] }));
    } else if (req.url === "/token") {
      let text = ""; for await (const part of req) text += part.toString();
      const body = new URLSearchParams(text);
      pkceVerified = createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") === challenge;
      if (!pkceVerified || body.get("client_id") !== "fixture-client" || body.get("client_secret") !== "fixture-secret" || body.get("redirect_uri") !== "https://auth.example.com/api/federation/oidc/callback") {
        res.statusCode = 400; res.end(JSON.stringify({ error: "invalid_grant" })); return;
      }
      const token = await new SignJWT({ nonce: mutation === "nonce" ? "wrong" : flow.nonce, email: "verified@example.com", email_verified: mutation !== "unverified", name: "Fixture User" })
        .setProtectedHeader({ alg: "RS256", kid: "fixture" }).setSubject("stable-subject")
        .setIssuer(mutation === "issuer" ? "https://evil.example" : issuer)
        .setAudience(mutation === "audience" ? "other-client" : "fixture-client")
        .setIssuedAt().setExpirationTime(mutation === "expired" ? Math.floor(Date.now() / 1000) - 3600 : "5m")
        .sign(mutation === "signature" ? wrongKeys.privateKey : keys.privateKey);
      res.end(JSON.stringify({ access_token: "fixture-access", token_type: "Bearer", expires_in: 300, id_token: token }));
    } else { res.statusCode = 404; res.end("{}"); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error();
  issuer = `http://127.0.0.1:${address.port}`;
  provider = { id: "oidc", name: "Fixture", type: "oidc", clientId: "fixture-client", clientSecret: "fixture-secret", issuer, enabled: true, tokenAuthMethod: "client_secret_post" };
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
afterEach(() => { mutation = ""; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function begin(p = provider) {
  vi.stubEnv("AUTH_PUBLIC_URL", "https://auth.example.com");
  const url = new URL(await authorizationUrl(p, flow, "test-state"));
  challenge = url.searchParams.get("code_challenge") ?? "";
  return url;
}
function callback(state = "test-state") { return new URL(`https://auth.example.com/api/federation/oidc/callback?code=fixture-code&state=${state}`); }

describe("真实 OIDC 协议和平台适配", () => {
  it("discovery → S256 → token → JWKS 签名验证，返回稳定 sub", async () => {
    const url = await begin();
    expect(url.searchParams.get("nonce")).toBe(flow.nonce); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(await exchangeIdentity(provider, flow, callback(), "test-state")).toEqual({ subject: "stable-subject", email: "verified@example.com", name: "Fixture User" });
    expect(pkceVerified).toBe(true);
  });
  it.each(["nonce", "issuer", "audience", "expired", "signature"])("拒绝被篡改的 OIDC %s", async (kind) => {
    await begin(); mutation = kind;
    await expect(exchangeIdentity(provider, flow, callback(), "test-state")).rejects.toThrow();
  });
  it("拒绝错误 state 和 PKCE verifier", async () => {
    await begin();
    await expect(exchangeIdentity(provider, flow, callback("wrong"), "test-state")).rejects.toThrow();
    await expect(exchangeIdentity(provider, { ...flow, verifier: "wrong" }, callback(), "test-state")).rejects.toThrow();
  });
  it("GitHub 请求最少权限、携带 PKCE，以数字 ID 识别账号", async () => {
    const github = { ...provider, id: "github", type: "github" as const, issuer: undefined };
    const url = await begin(github); expect(url.origin).toBe("https://github.com"); expect(url.searchParams.get("scope")).toBe("read:user user:email");
    const mockFetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret-token" })).mockResolvedValueOnce(Response.json({ id: 12345, login: "renameable", email: "ignored@example.com" }))
      .mockResolvedValueOnce(Response.json([{ email: "unverified@example.com", primary: true, verified: false }, { email: "verified@example.com", primary: false, verified: true }]));
    vi.stubGlobal("fetch", mockFetch);
    expect(await exchangeIdentity(github, flow, callback(), "test-state")).toEqual({ subject: "12345", email: "verified@example.com", name: "renameable" });
    expect(mockFetch.mock.calls[0][1].body.get("code_verifier")).toBe(flow.verifier);
    expect(mockFetch.mock.calls[1][1].headers.authorization).toBe("Bearer secret-token");
  });
  it("OIDC 不接受未经验证的邮箱注册资料", async () => {
    await begin(); mutation = "unverified";
    expect((await exchangeIdentity(provider, flow, callback(), "test-state")).email).toBeNull();
  });
  it("GitHub 邮箱端点不可用时仍保留稳定身份，拒绝信任公开邮箱", async () => {
    const github = { ...provider, id: "github", type: "github" as const, issuer: undefined };
    await begin(github);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret" }))
      .mockResolvedValueOnce(Response.json({ id: 12345, email: "unverified@example.com" }))
      .mockResolvedValueOnce(new Response("denied", { status: 403 })));
    expect(await exchangeIdentity(github, flow, callback(), "test-state")).toEqual({ subject: "12345", email: null, name: null });
  });
  it("微信网站扫码使用 appid + openid，拒绝错误响应", async () => {
    const wechat = { ...provider, id: "wechat", type: "wechat" as const, issuer: undefined };
    const url = await begin(wechat); expect(url.pathname).toBe("/connect/qrconnect"); expect(url.searchParams.get("scope")).toBe("snsapi_login");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ access_token: "secret", openid: "stable-openid", unionid: "ignored-unionid" })).mockResolvedValueOnce(Response.json({ errcode: 40029 })));
    expect(await exchangeIdentity(wechat, flow, callback(), "test-state")).toEqual({ subject: "stable-openid", email: null, name: null });
    await expect(exchangeIdentity(wechat, flow, callback(), "test-state")).rejects.toThrow("invalid_identity");
  });
  it("拒绝平台取消授权而不请求 token", async () => {
    const github = { ...provider, id: "github", type: "github" as const };
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(exchangeIdentity(github, flow, new URL("https://auth.example.com/?error=access_denied"), "test-state")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
