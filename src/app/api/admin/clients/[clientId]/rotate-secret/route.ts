import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import { rotateOAuthClientSecret } from "@/server/oidc/service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ clientId: string }> },
) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { clientId } = await context.params;
  const rotated = await rotateOAuthClientSecret({
    actorUserId: admin.id,
    clientId,
  });

  if (!rotated) {
    return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    item: rotated.client,
    clientSecret: rotated.clientSecret,
  });
}
