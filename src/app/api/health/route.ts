import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "auth", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
