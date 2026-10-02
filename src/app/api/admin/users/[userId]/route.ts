import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminAuditLogs, users } from "@/server/db/schema";

export const runtime = "nodejs";
const MAX_USER_NAME_LENGTH = 64;

/**
 * 中文注释：统一清洗管理员提交的用户名，空白字符收敛并限制最大长度，避免写入脏数据。
 */
function normalizeUserName(value: unknown) {
  if (typeof value !== "string") {
    return { value: undefined, error: null as string | null };
  }
  const normalized = value.trim();
  if (normalized.length > MAX_USER_NAME_LENGTH) {
    return { value: undefined, error: "name_too_long" };
  }
  return { value: normalized, error: null as string | null };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;
  const payload = (await request.json().catch(() => null)) as {
    name?: string;
    isDisabled?: boolean;
  } | null;

  if (!payload) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  const normalizedName = normalizeUserName(payload.name);
  if (normalizedName.error) {
    return NextResponse.json({ error: normalizedName.error }, { status: 400 });
  }

  const [updated] = await db
    .update(users)
    .set({
      name: normalizedName.value,
      isDisabled:
        typeof payload.isDisabled === "boolean" ? payload.isDisabled : undefined,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      updatedAt: users.updatedAt,
    });

  if (!updated) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  await db.insert(adminAuditLogs).values({
    actorUserId: admin.id,
    action: "user_update",
    targetType: "user",
    targetId: updated.id,
    detail: JSON.stringify({ isDisabled: updated.isDisabled, name: updated.name }),
  });

  return NextResponse.json({ item: updated });
}
