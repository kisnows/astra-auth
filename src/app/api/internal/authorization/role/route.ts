import { NextResponse } from "next/server";
import { verifyInternalRequest } from "@/server/internal-auth";
import { resolveAuthRole } from "@/server/oidc/service";

export const runtime = "nodejs";

type RoleCheckPayload = {
  userId?: unknown;
};

/**
 * 中文注释：供业务系统在线复核 Auth 角色；调用方必须使用内部服务签名。
 */
export async function POST(request: Request) {
  if (!verifyInternalRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as RoleCheckPayload | null;
  const userId =
    typeof payload?.userId === "string" ? payload.userId.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "userId_required" }, { status: 400 });
  }

  const role = await resolveAuthRole(userId);
  if (!role) {
    return NextResponse.json(
      {
        active: false,
        userId,
        role: null,
        isAdmin: false,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    active: true,
    userId,
    role,
    isAdmin: role === "admin",
  });
}
