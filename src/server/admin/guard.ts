import { eq } from "drizzle-orm";
import db from "@/server/db";
import { adminRoles, users } from "@/server/db/schema";
import { readSessionTokenFromCookieHeader } from "@/server/internal-auth";
import { getSessionByToken } from "@/server/services/auth/session";

function parseAllowlist(raw?: string) {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 中文注释：统一解析管理员会话，供管理 API 与管理页面复用。
 */
export async function resolveAdminUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const sessionToken = readSessionTokenFromCookieHeader(cookieHeader);
  if (!sessionToken) return null;

  const authSession = await getSessionByToken(sessionToken);
  if (!authSession) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isDisabled: users.isDisabled,
    })
    .from(users)
    .where(eq(users.id, authSession.user.id))
    .limit(1);

  if (!row || row.isDisabled) {
    return null;
  }

  const [adminRole] = await db
    .select({ role: adminRoles.role })
    .from(adminRoles)
    .where(eq(adminRoles.userId, row.id))
    .limit(1);

  // 中文注释：优先使用数据库角色模型；allowlist 仅作为初始化/应急兜底。
  const allowlist = parseAllowlist(process.env.AUTH_ADMIN_ALLOWLIST);
  const byEmail = row.email && allowlist.includes(row.email);
  const byId = allowlist.includes(row.id);
  const byRole = adminRole?.role === "admin";

  if (!byRole && !byEmail && !byId) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
  };
}
