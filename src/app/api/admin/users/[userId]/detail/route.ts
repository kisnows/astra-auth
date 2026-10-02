import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminRoles, authAccounts, authSessions, users } from "@/server/db/schema";

export const runtime = "nodejs";

/**
 * 中文注释：返回用户详情和账号绑定信息，供管理后台抽屉展示。
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const [role] = await db
    .select({ role: adminRoles.role })
    .from(adminRoles)
    .where(eq(adminRoles.userId, userId))
    .limit(1);

  const accounts = await db
    .select({
      id: authAccounts.id,
      providerId: authAccounts.providerId,
      accountId: authAccounts.accountId,
      scope: authAccounts.scope,
      createdAt: authAccounts.createdAt,
      updatedAt: authAccounts.updatedAt,
    })
    .from(authAccounts)
    .where(eq(authAccounts.userId, userId));

  const sessions = await db
    .select({
      id: authSessions.id,
      expiresAt: authSessions.expiresAt,
      createdAt: authSessions.createdAt,
      ipAddress: authSessions.ipAddress,
      userAgent: authSessions.userAgent,
    })
    .from(authSessions)
    .where(eq(authSessions.userId, userId));

  return NextResponse.json({
    item: {
      ...user,
      isAdmin: role?.role === "admin",
      accounts,
      sessions,
    },
  });
}
