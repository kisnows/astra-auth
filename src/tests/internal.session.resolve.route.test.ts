import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyInternalRequestMock = vi.fn();
const readSessionTokenFromCookieHeaderMock = vi.fn();

const selectMock = vi.fn();
const fromMock = vi.fn();
const innerJoinMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();

vi.mock("@/server/internal-auth", () => ({
  verifyInternalRequest: verifyInternalRequestMock,
  readSessionTokenFromCookieHeader: readSessionTokenFromCookieHeaderMock,
}));

vi.mock("@/server/db", () => ({
  default: {
    select: selectMock,
  },
}));

describe("POST /api/internal/session/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyInternalRequestMock.mockReturnValue(true);
    readSessionTokenFromCookieHeaderMock.mockReturnValue("session-token-1");

    // 组装 drizzle 查询链：select -> from -> innerJoin -> where -> limit
    limitMock.mockResolvedValue([]);
    whereMock.mockReturnValue({ limit: limitMock });
    innerJoinMock.mockReturnValue({ where: whereMock });
    fromMock.mockReturnValue({ innerJoin: innerJoinMock, where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
  });

  it("内部鉴权失败时返回 403", async () => {
    verifyInternalRequestMock.mockReturnValueOnce(false);
    const route = await import("@/app/api/internal/session/resolve/route");
    const response = await route.POST(
      new Request("http://localhost/api/internal/session/resolve", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
  });

  it("没有 token 时返回空会话", async () => {
    readSessionTokenFromCookieHeaderMock.mockReturnValueOnce(null);
    const route = await import("@/app/api/internal/session/resolve/route");
    const response = await route.POST(
      new Request("http://localhost/api/internal/session/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookieHeader: "foo=bar" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ session: null, user: null });
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("根据 token 成功解析会话与用户", async () => {
    limitMock
      .mockResolvedValueOnce([
        {
          session: {
            id: "s1",
            userId: "u1",
            expiresAt: new Date("2030-01-01T00:00:00.000Z"),
          },
          user: {
            id: "u1",
            email: "demo@example.com",
            name: "Demo User",
            isDisabled: false,
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "u1",
          email: "demo@example.com",
          name: "Demo User",
          image: null,
          emailVerified: 1,
        },
      ]);
    const route = await import("@/app/api/internal/session/resolve/route");
    const response = await route.POST(
      new Request("http://localhost/api/internal/session/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cookieHeader: "astraos-auth.session_token=abc" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toEqual({
      id: "u1",
      email: "demo@example.com",
      name: "Demo User",
      image: null,
      emailVerified: true,
    });
    expect(body.session).toEqual({
      id: "s1",
      userId: "u1",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });
    expect(readSessionTokenFromCookieHeaderMock).toHaveBeenCalled();
  });
});
