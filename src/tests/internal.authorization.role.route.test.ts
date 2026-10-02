import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyInternalRequestMock = vi.fn();
const resolveAuthRoleMock = vi.fn();

vi.mock("@/server/internal-auth", () => ({
  verifyInternalRequest: verifyInternalRequestMock,
}));

vi.mock("@/server/oidc/service", () => ({
  resolveAuthRole: resolveAuthRoleMock,
}));

function makeRoleRequest(body: unknown) {
  return new Request("http://localhost/api/internal/authorization/role", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/internal/authorization/role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyInternalRequestMock.mockReturnValue(true);
  });

  it("拒绝未通过内部服务签名校验的请求", async () => {
    verifyInternalRequestMock.mockReturnValueOnce(false);
    const route = await import(
      "@/app/api/internal/authorization/role/route"
    );

    const response = await route.POST(makeRoleRequest({ userId: "user-1" }));

    expect(response.status).toBe(403);
    expect(resolveAuthRoleMock).not.toHaveBeenCalled();
  });

  it("拒绝空 userId", async () => {
    const route = await import(
      "@/app/api/internal/authorization/role/route"
    );

    const response = await route.POST(makeRoleRequest({ userId: "   " }));

    expect(response.status).toBe(400);
    expect(resolveAuthRoleMock).not.toHaveBeenCalled();
  });

  it("返回管理员的在线角色", async () => {
    resolveAuthRoleMock.mockResolvedValueOnce("admin");
    const route = await import(
      "@/app/api/internal/authorization/role/route"
    );

    const response = await route.POST(makeRoleRequest({ userId: "admin-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      active: true,
      userId: "admin-1",
      role: "admin",
      isAdmin: true,
    });
  });

  it("返回普通用户的在线角色", async () => {
    resolveAuthRoleMock.mockResolvedValueOnce("user");
    const route = await import(
      "@/app/api/internal/authorization/role/route"
    );

    const response = await route.POST(makeRoleRequest({ userId: "user-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      active: true,
      userId: "user-1",
      role: "user",
      isAdmin: false,
    });
  });

  it("禁用或不存在的用户返回 inactive，不能继承管理员权限", async () => {
    resolveAuthRoleMock.mockResolvedValueOnce(null);
    const route = await import(
      "@/app/api/internal/authorization/role/route"
    );

    const response = await route.POST(
      makeRoleRequest({ userId: "disabled-user" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      active: false,
      userId: "disabled-user",
      role: null,
      isAdmin: false,
    });
  });
});
