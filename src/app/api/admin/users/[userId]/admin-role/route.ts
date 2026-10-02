import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminAuditLogs, adminRoles } from "@/server/db/schema";

export const runtime = "nodejs";

/** 中文注释：授予管理员角色，持久化到 AdminRole 表。 */
export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;
  const now = new Date();
  const [item] = await db
    .insert(adminRoles)
    .values({
      userId,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: adminRoles.userId,
      set: { role: "admin", updatedAt: now },
    })
    .returning();

  await db.insert(adminAuditLogs).values({
    actorUserId: admin.id,
    action: "admin_role_grant",
    targetType: "user",
    targetId: userId,
    detail: JSON.stringify({ role: "admin" }),
  });

  return NextResponse.json({ item });
}

/** 中文注释：撤销管理员角色，回收管理后台访问权限。 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;
  await db.delete(adminRoles).where(eq(adminRoles.userId, userId));

  await db.insert(adminAuditLogs).values({
    actorUserId: admin.id,
    action: "admin_role_revoke",
    targetType: "user",
    targetId: userId,
    detail: JSON.stringify({ role: "admin" }),
  });

  return NextResponse.json({ ok: true });
}
