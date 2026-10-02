import { NextResponse } from "next/server";
import { getOidcConfig } from "@/server/oidc/config";
import { signIdToken } from "@/server/oidc/keys";
import {
  exchangeAuthorizationCode,
  verifyOAuthClientSecret,
} from "@/server/oidc/service";

export const runtime = "nodejs";

function unauthorized(message = "invalid_client") {
  return NextResponse.json({ error: message }, { status: 401 });
}

function parseBasicAuthorization(authHeader: string | null) {
  if (!authHeader) return null;
  const [schema, encoded] = authHeader.split(" ");
  if (schema?.toLowerCase() !== "basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const index = decoded.indexOf(":");
  if (index < 0) return null;
  return {
    clientId: decoded.slice(0, index),
    clientSecret: decoded.slice(index + 1),
  };
}

/**
 * 中文注释：Token 端点仅支持授权码换取 token，并完成 client 鉴权与 code 校验。
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const body = await request.formData();
  const grantType = body.get("grant_type");
  const code = String(body.get("code") || "");
  const redirectUri = String(body.get("redirect_uri") || "");
  const codeVerifier = body.get("code_verifier")?.toString() || null;

  if (grantType !== "authorization_code") {
    return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  const basic = parseBasicAuthorization(request.headers.get("authorization"));
  const clientId =
    body.get("client_id")?.toString() ||
    basic?.clientId ||
    "";
  const clientSecret =
    body.get("client_secret")?.toString() ||
    basic?.clientSecret ||
    "";

  if (!clientId || !clientSecret) {
    return unauthorized();
  }

  const client = await verifyOAuthClientSecret(clientId, clientSecret);
  if (!client) {
    return unauthorized();
  }

  const exchanged = await exchangeAuthorizationCode({
    code,
    clientId,
    redirectUri,
    codeVerifier,
  });

  if (!exchanged) {
    return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
  }

  const oidc = getOidcConfig();
  const idToken = await signIdToken({
    issuer: oidc.issuer,
    audience: clientId,
    subject: exchanged.user.id,
    email: exchanged.user.email,
    emailVerified: Boolean(exchanged.user.emailVerified),
    name: exchanged.user.name,
    role: exchanged.user.role,
    nonce: exchanged.record.nonce,
  });

  return NextResponse.json({
    access_token: exchanged.accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: exchanged.record.scope,
    id_token: idToken,
  }, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
