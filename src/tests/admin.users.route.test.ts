import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdminUserFromRequestMock = vi.fn();

const updateMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

const insertMock = vi.fn();
const insertValuesMock = vi.fn();

vi.mock("@/server/admin/guard", () => ({
  resolveAdminUserFromRequest: resolveAdminUserFromRequestMock,
}));

vi.mock("@/server/db", () => ({
  default: {
    update: updateMock,
    insert: insertMock,
  },
}));

describe("PATCH /api/admin/users/:userId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAdminUserFromRequestMock.mockResolvedValue({ id: "admin-1" });

    // 中文注释：组装 drizzle 更新链路 mock，覆盖 update -> set -> where -> returning。
    updateReturningMock.mockResolvedValue([]);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateMock.mockReturnValue({ set: updateSetMock });

    insertValuesMock.mockResolvedValue(undefined);
    insertMock.mockReturnValue({ values: insertValuesMock });
  });

  it("非管理员请求返回 403", async () => {
    resolveAdminUserFromRequestMock.mockResolvedValueOnce(null);
    const route = await import("@/app/api/admin/users/[userId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/admin/users/u1", { method: "PATCH" }),
      { params: Promise.resolve({ userId: "u1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("名称超长返回 400", async () => {
    const route = await import("@/app/api/admin/users/[userId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "x".repeat(65) }),
      }),
      { params: Promise.resolve({ userId: "u1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "name_too_long" });
  });

  it("更新名称时会执行 trim", async () => {
    updateReturningMock.mockResolvedValueOnce([
      {
        id: "u1",
        email: "u1@example.com",
        name: "trimmed",
        isDisabled: false,
        mustChangePassword: false,
        updatedAt: new Date(),
      },
    ]);

    const route = await import("@/app/api/admin/users/[userId]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/admin/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "   trimmed   " }),
      }),
      { params: Promise.resolve({ userId: "u1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trimmed",
        updatedAt: expect.any(Date),
      }),
    );
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
