import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyInternalRequestMock = vi.fn();

const selectMock = vi.fn();
const selectFromMock = vi.fn();
const selectWhereMock = vi.fn();

const updateMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

vi.mock("@/server/internal-auth", () => ({
  verifyInternalRequest: verifyInternalRequestMock,
}));

vi.mock("@/server/db", () => ({
  default: {
    select: selectMock,
    update: updateMock,
  },
}));

describe("GET /api/internal/users/by-ids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyInternalRequestMock.mockReturnValue(true);
    selectWhereMock.mockResolvedValue([]);
    selectFromMock.mockReturnValue({ where: selectWhereMock });
    selectMock.mockReturnValue({ from: selectFromMock });
  });

  it("鉴权失败返回 403", async () => {
    verifyInternalRequestMock.mockReturnValueOnce(false);
    const route = await import("@/app/api/internal/users/by-ids/route");
    const response = await route.GET(
      new Request("http://localhost/api/internal/users/by-ids?ids=u1"),
    );

    expect(response.status).toBe(403);
  });

  it("ids 为空时返回空数组", async () => {
    const route = await import("@/app/api/internal/users/by-ids/route");
    const response = await route.GET(
      new Request("http://localhost/api/internal/users/by-ids"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ items: [] });
    expect(selectMock).not.toHaveBeenCalled();
  });

  it("返回用户列表并规范化 emailVerified", async () => {
    selectWhereMock.mockResolvedValueOnce([
      {
        id: "u1",
        email: "u1@example.com",
        name: "u1",
        image: null,
        emailVerified: 1,
      },
      {
        id: "u2",
        email: "u2@example.com",
        name: "u2",
        image: null,
        emailVerified: 0,
      },
    ]);
    const route = await import("@/app/api/internal/users/by-ids/route");
    const response = await route.GET(
      new Request("http://localhost/api/internal/users/by-ids?ids=u1,u2"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      items: [
        {
          id: "u1",
          email: "u1@example.com",
          name: "u1",
          image: null,
          emailVerified: true,
        },
        {
          id: "u2",
          email: "u2@example.com",
          name: "u2",
          image: null,
          emailVerified: false,
        },
      ],
    });
  });
});

describe("PATCH /api/internal/users/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyInternalRequestMock.mockReturnValue(true);

    // 组装 drizzle 查询链：update -> set -> where -> returning
    updateReturningMock.mockResolvedValue([]);
    updateWhereMock.mockReturnValue({ returning: updateReturningMock });
    updateSetMock.mockReturnValue({ where: updateWhereMock });
    updateMock.mockReturnValue({ set: updateSetMock });
  });

  it("鉴权失败返回 403", async () => {
    verifyInternalRequestMock.mockReturnValueOnce(false);
    const route = await import("@/app/api/internal/users/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/internal/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "new" }),
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("请求体非法返回 400", async () => {
    const route = await import("@/app/api/internal/users/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/internal/users/u1", {
        method: "PATCH",
        body: "not-json",
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("空 patch 返回 400", async () => {
    const route = await import("@/app/api/internal/users/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/internal/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("用户不存在返回 404", async () => {
    updateReturningMock.mockResolvedValueOnce([]);
    const route = await import("@/app/api/internal/users/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/internal/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "next-name" }),
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );

    expect(response.status).toBe(404);
  });

  it("更新成功并清洗 name 字段", async () => {
    updateReturningMock.mockResolvedValueOnce([
      {
        id: "u1",
        email: "u1@example.com",
        name: "trimmed",
        image: null,
        emailVerified: 1,
      },
    ]);
    const route = await import("@/app/api/internal/users/[id]/route");
    const response = await route.PATCH(
      new Request("http://localhost/api/internal/users/u1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "   trimmed   ", image: null }),
      }),
      { params: Promise.resolve({ id: "u1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trimmed",
        image: null,
        updatedAt: expect.any(Date),
      }),
    );
    expect(body).toEqual({
      user: {
        id: "u1",
        email: "u1@example.com",
        name: "trimmed",
        image: null,
        emailVerified: true,
      },
    });
  });
});
