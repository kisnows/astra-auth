import { and, eq, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import db from "@/server/db";
import { authSessions, authVerifications } from "@/server/db/schema";
import { upsertCredentialPassword } from "@/server/services/auth/session";
import { hashPassword } from "@/server/services/identity/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_PASSWORD_RESET_IDENTIFIER_PREFIX = "admin_password_reset:";

function extractUserIdFromIdentifier(identifier: string) {
  if (!identifier.startsWith(ADMIN_PASSWORD_RESET_IDENTIFIER_PREFIX)) return "";
  return identifier.slice(ADMIN_PASSWORD_RESET_IDENTIFIER_PREFIX.length);
}

/**
 * 中文注释：使用一次性 token 完成管理员密码重置（无需旧密码）。
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | { token?: string; newPassword?: string }
    | null;

  const token = payload?.token?.trim() || "";
  const newPassword = payload?.newPassword?.trim() || "";
  if (!token || newPassword.length < 8) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const now = new Date();
  const [verification] = await db
    .select({
      id: authVerifications.id,
      identifier: authVerifications.identifier,
      expiresAt: authVerifications.expiresAt,
    })
    .from(authVerifications)
    .where(
      and(
        like(authVerifications.identifier, `${ADMIN_PASSWORD_RESET_IDENTIFIER_PREFIX}%`),
        eq(authVerifications.value, token),
      ),
    )
    .limit(1);

  if (!verification || !verification.expiresAt || verification.expiresAt <= now) {
    return NextResponse.json({ error: "token_invalid_or_expired" }, { status: 400 });
  }

  const userId = extractUserIdFromIdentifier(verification.identifier);
  if (!userId) {
    return NextResponse.json({ error: "token_invalid_or_expired" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);
  await upsertCredentialPassword({
    userId,
    passwordHash,
    mustChangePassword: false,
  });

  // 中文注释：重置后失效该用户所有旧会话与全部旧 token，确保链接一次性使用。
  await db.delete(authSessions).where(eq(authSessions.userId, userId));
  await db
    .delete(authVerifications)
    .where(eq(authVerifications.identifier, `${ADMIN_PASSWORD_RESET_IDENTIFIER_PREFIX}${userId}`));

  return NextResponse.json({ ok: true });
}
