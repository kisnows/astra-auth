import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminRoles, users } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      emailVerified: users.emailVerified,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(users);
  const roleRows = await db
    .select({ userId: adminRoles.userId, role: adminRoles.role })
    .from(adminRoles);
  const adminUserIds = new Set(
    roleRows.filter((item) => item.role === "admin").map((item) => item.userId),
  );

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      isAdmin: adminUserIds.has(item.id),
    })),
  });
}

/**
 * 中文注释：支持按 email 精准查询，便于管理台快速定位用户。
 */
export async function POST(request: Request) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as { email?: string } | null;
  if (!payload?.email) {
    return NextResponse.json({ error: "email_required" }, { status: 400 });
  }

  const [item] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      emailVerified: users.emailVerified,
      isDisabled: users.isDisabled,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.email, payload.email.trim().toLowerCase()))
    .limit(1);

  if (!item) {
    return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  }

  const [roleRow] = await db
    .select({ role: adminRoles.role })
    .from(adminRoles)
    .where(eq(adminRoles.userId, item.id))
    .limit(1);

  return NextResponse.json({
    item: {
      ...item,
      isAdmin: roleRow?.role === "admin",
    },
  });
}
