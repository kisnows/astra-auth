import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyInternalServiceHeadersMock = vi.fn();

vi.mock("@/server/internal-service-signature", () => ({
  verifyInternalServiceHeaders: verifyInternalServiceHeadersMock,
}));

describe("internal-auth 工具函数", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_AUTH_SECRET = "test-internal-secret";
    delete process.env.AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    process.env.AUTH_COOKIE_PREFIX = "astraos-auth";
  });

  it("x-internal-secret 正确时直接放行", async () => {
    const { verifyInternalRequest } = await import("@/server/internal-auth");
    const request = new Request("http://localhost/api/internal/session/resolve", {
      method: "POST",
      headers: {
        "x-internal-secret": "test-internal-secret",
      },
    });

    expect(verifyInternalRequest(request)).toBe(true);
    expect(verifyInternalServiceHeadersMock).not.toHaveBeenCalled();
  });

  it("x-internal-secret 不匹配时回退到 HMAC 头校验", async () => {
    verifyInternalServiceHeadersMock.mockReturnValueOnce(true);
    const { verifyInternalRequest } = await import("@/server/internal-auth");
    const request = new Request("http://localhost/api/internal/users/by-ids", {
      method: "GET",
      headers: {
        "x-internal-secret": "wrong-secret",
        "x-internal-ts": "1700000000",
        "x-internal-signature": "mock-signature",
      },
    });

    expect(verifyInternalRequest(request)).toBe(true);
    expect(verifyInternalServiceHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        pathname: "/api/internal/users/by-ids",
        secret: "test-internal-secret",
      }),
    );
  });

  it("缺少 INTERNAL_AUTH_SECRET 时拒绝请求", async () => {
    delete process.env.INTERNAL_AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    const { verifyInternalRequest } = await import("@/server/internal-auth");
    const request = new Request("http://localhost/api/internal/session/resolve");

    expect(verifyInternalRequest(request)).toBe(false);
  });

  it("未设置 INTERNAL_AUTH_SECRET 时回退到 AUTH_SECRET", async () => {
    delete process.env.INTERNAL_AUTH_SECRET;
    process.env.AUTH_SECRET = "fallback-auth-secret";
    const { verifyInternalRequest } = await import("@/server/internal-auth");
    const request = new Request("http://localhost/api/internal/session/resolve", {
      method: "POST",
      headers: {
        "x-internal-secret": "fallback-auth-secret",
      },
    });

    expect(verifyInternalRequest(request)).toBe(true);
  });

  it("优先解析 __Secure- 前缀 session cookie，并剥离签名段", async () => {
    const { readSessionTokenFromCookieHeader } = await import(
      "@/server/internal-auth"
    );
    const token = readSessionTokenFromCookieHeader(
      "__Secure-astraos-auth.session_token=abc123.signature%2Epart; Path=/", // gitleaks:allow -- 固定 Cookie 解析夹具，断言值为 abc123。
    );

    expect(token).toBe("abc123");
  });

  it("cookie 中没有 session token 时返回 null", async () => {
    const { readSessionTokenFromCookieHeader } = await import(
      "@/server/internal-auth"
    );
    const token = readSessionTokenFromCookieHeader("foo=bar; hello=world");

    expect(token).toBeNull();
  });
});
