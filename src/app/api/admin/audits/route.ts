import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import db from "@/server/db";
import { adminAuditLogs } from "@/server/db/schema";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const items = await db
    .select()
    .from(adminAuditLogs)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(100);

  return NextResponse.json({ items });
}
