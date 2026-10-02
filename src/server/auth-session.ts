import { eq } from "drizzle-orm";
import db from "@/server/db";
import { users } from "@/server/db/schema";
import { readSessionTokenFromCookieHeader } from "@/server/internal-auth";
import { getSessionByToken } from "@/server/services/auth/session";

/**
 * 中文注释：从 AuthService 会话 cookie 解析登录用户，供 OIDC 授权流程复用。
 */
export async function resolveAuthenticatedUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const sessionToken = readSessionTokenFromCookieHeader(cookieHeader);
  if (!sessionToken) return null;

  const authSession = await getSessionByToken(sessionToken);
  if (!authSession) return null;

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, authSession.user.id))
    .limit(1);

  if (!row || row.isDisabled) {
    return null;
  }

  return row;
}
