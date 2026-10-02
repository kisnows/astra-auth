import { NextResponse } from "next/server";
import { getOidcConfig, resolveDefaultScopes } from "@/server/oidc/config";

export const runtime = "nodejs";

export async function GET() {
  const config = getOidcConfig();
  return NextResponse.json({
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    jwks_uri: config.jwksUri,
    scopes_supported: resolveDefaultScopes().split(" "),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  });
}
