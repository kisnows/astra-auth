import { NextResponse } from "next/server";
import { getOidcConfig, resolveDefaultScopes } from "@/server/oidc/config";

export const runtime = "nodejs";

export async function GET() {
  const config = getOidcConfig();
  return NextResponse.json({
    issuer: config.issuer,
    authorization_endpoint: config.authorizationEndpoint,
    token_endpoint: config.tokenEndpoint,
    userinfo_endpoint: config.userinfoEndpoint,
    jwks_uri: config.jwksUri,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: resolveDefaultScopes().split(" "),
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: ["sub", "email", "email_verified", "name", "nonce", "role"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
}
