import { NextResponse } from "next/server";
import { readProviders } from "@/server/federation/config";
import { noStore } from "@/server/federation/http";
export const runtime = "nodejs";
export function GET() {
  try { return noStore(NextResponse.json(readProviders().filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name })))); }
  catch { return noStore(NextResponse.json({ error: "provider_unavailable" }, { status: 503 })); }
}
