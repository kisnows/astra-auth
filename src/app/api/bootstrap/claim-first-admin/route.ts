import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import db from "@/server/db";
import { adminAuditLogs, adminRoles } from "@/server/db/schema";

export const runtime = "nodejs";

function normalizeEmail(raw?: string) {
  return raw?.trim().toLowerCase() || "";
}

/**
 * 中文注释：当系统尚无管理员时，允许配置邮箱对应的首个登录用户领取管理员角色。
 */
export async function POST(request: Request) {
  const user = await resolveAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const configuredAdminEmail = normalizeEmail(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL);
  if (!configuredAdminEmail) {
    return NextResponse.json({ ok: true, claimed: false, reason: "bootstrap_email_not_configured" });
  }

  if (normalizeEmail(user.email) !== configuredAdminEmail) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [existingAdmin] = await db
    .select({ userId: adminRoles.userId })
    .from(adminRoles)
    .limit(1);
  if (existingAdmin) {
    return NextResponse.json({ ok: true, claimed: false, reason: "admin_already_exists" });
  }

  const now = new Date();
  await db
    .insert(adminRoles)
    .values({
      id: `admin-role-${user.id}`,
      userId: user.id,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: adminRoles.userId,
      set: {
        role: "admin",
        updatedAt: now,
      },
    });

  await db.insert(adminAuditLogs).values({
    id: randomUUID(),
    actorUserId: user.id,
    action: "bootstrap_claim_first_admin",
    targetType: "user",
    targetId: user.id,
    detail: JSON.stringify({
      via: "first-sign-in",
      email: user.email,
    }),
    createdAt: now,
  });

  return NextResponse.json({ ok: true, claimed: true });
}
