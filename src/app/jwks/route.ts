import { NextResponse } from "next/server";
import { getPublicJwks } from "@/server/oidc/keys";

export const runtime = "nodejs";

export async function GET() {
  const jwks = await getPublicJwks();
  return NextResponse.json(jwks);
}
