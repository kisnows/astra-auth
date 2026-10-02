import { NextResponse } from "next/server";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import { getOidcConfig, resolveSupportedScopes } from "@/server/oidc/config";
import { clientInputSchema } from "@/server/oidc/client-input";
import { createOAuthClient, listOAuthClients, publicOAuthClient, updateOAuthClient, validateClientUserIds } from "@/server/oidc/service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const clients = await listOAuthClients();
  return NextResponse.json({ items: clients.map(publicOAuthClient), issuer: getOidcConfig().issuer }, { headers });
}

/** 中文注释：应用管理写操作同时验证管理员、同源和完整输入，避免无效配置扩大访问范围。 */
async function saveClient(request: Request, editing: boolean) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(getOidcConfig().issuer).origin) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403, headers });
  }
  const admin = await resolveAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const raw: unknown = await request.json().catch(() => null);
  const parsed = clientInputSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "invalid_client_configuration" }, { status: 400, headers });
  const data = parsed.data;
  const scopes = [...new Set(data.scopes.split(/\s+/))];
  const supported = resolveSupportedScopes();
  if (!scopes.includes("openid") || scopes.some((scope) => !supported.includes(scope))) {
    return NextResponse.json({ error: "invalid_scopes" }, { status: 400, headers });
  }
  if (!await validateClientUserIds(data.allowedUserIds)) {
    return NextResponse.json({ error: "unknown_user" }, { status: 400, headers });
  }
  const input = { ...data, actorUserId: admin.id, scopes: scopes.join(" ") };
  if (editing) {
    const clientId = (raw as Record<string, unknown>).clientId;
    if (typeof clientId !== "string" || !clientId) return NextResponse.json({ error: "client_id_required" }, { status: 400, headers });
    const item = updateOAuthClient({ ...input, clientId });
    return item ? NextResponse.json({ item: publicOAuthClient(item) }, { headers })
      : NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }
  const created = await createOAuthClient(input);
  return NextResponse.json({ item: publicOAuthClient(created.client), clientSecret: created.clientSecret }, { headers });
}

export async function POST(request: Request) { return saveClient(request, false); }
export async function PATCH(request: Request) { return saveClient(request, true); }
