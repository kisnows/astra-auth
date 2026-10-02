import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import db from "@/server/db";
import { users } from "@/server/db/schema";
import { verifyInternalRequest } from "@/server/internal-auth";

export const runtime = "nodejs";

function parseUserIds(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("ids") ?? "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request: Request) {
  if (!verifyInternalRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const userIds = parseUserIds(request);
  if (userIds.length === 0) {
    return NextResponse.json({ items: [] }, { status: 200 });
  }

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      emailVerified: users.emailVerified,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  return NextResponse.json(
    {
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        image: row.image,
        emailVerified: Boolean(row.emailVerified),
      })),
    },
    { status: 200 },
  );
}
