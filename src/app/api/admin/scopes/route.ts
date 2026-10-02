import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import { resolveSupportedScopes } from "@/server/oidc/config";

export const runtime = "nodejs";

/** 中文注释：提供管理后台可选 scope 列表，避免手工自由输入导致拼写错误。 */
export async function GET(request: Request) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return NextResponse.json({ items: resolveSupportedScopes() });
}
