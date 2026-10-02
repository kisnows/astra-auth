import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminAuditLogs, authSessions } from "@/server/db/schema";
import { upsertCredentialPassword } from "@/server/services/auth/session";
import { hashPassword } from "@/server/services/identity/password";

export const runtime = "nodejs";

/**
 * 中文注释：管理员重置邮箱密码登录凭证，并强制清理用户现有会话。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { userId } = await context.params;
  const payload = (await request.json().catch(() => null)) as
    | { newPassword?: string }
    | null;

  const newPassword = payload?.newPassword?.trim() || "";
  if (newPassword.length < 8) {
    return NextResponse.json({ error: "password_too_short" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);

  await upsertCredentialPassword({
    userId,
    passwordHash,
    mustChangePassword: true,
  });

  // 中文注释：重置密码后立即失效旧会话，避免旧 token 继续可用。
  await db.delete(authSessions).where(eq(authSessions.userId, userId));

  await db.insert(adminAuditLogs).values({
    actorUserId: admin.id,
    action: "user_password_reset",
    targetType: "user",
    targetId: userId,
    detail: JSON.stringify({ resetBy: admin.id, forceChangeOnNextLogin: true }),
  });

  return NextResponse.json({ ok: true });
}
