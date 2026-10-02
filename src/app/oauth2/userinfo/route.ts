import { NextResponse } from "next/server";
import { findAccessToken } from "@/server/oidc/service";

export const runtime = "nodejs";

function readBearerToken(header: string | null) {
  if (!header) return null;
  const [schema, token] = header.split(" ");
  if (schema?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function GET(request: Request) {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  const record = await findAccessToken(token);
  if (!record) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }

  return NextResponse.json({
    sub: record.userId,
    email: record.email,
    email_verified: Boolean(record.emailVerified),
    name: record.name,
    role: record.role,
  });
}
