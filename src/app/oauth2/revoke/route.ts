import { NextResponse } from "next/server";
import { revokeOAuthToken, verifyOAuthClientSecret } from "@/server/oidc/service";

export const runtime = "nodejs";
/** 中文注释：撤销必须由原机密客户端发起；令牌状态不通过响应泄露。 */
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = await request.formData();
  const clientId = String(body.get("client_id") || "");
  if (!await verifyOAuthClientSecret(clientId, String(body.get("client_secret") || ""))) {
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
  revokeOAuthToken(String(body.get("token") || ""), clientId);
  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
