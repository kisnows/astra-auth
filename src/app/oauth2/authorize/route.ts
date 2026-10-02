import { NextResponse } from "next/server";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import { getOidcConfig, resolveDefaultScopes } from "@/server/oidc/config";
import {
  clientSupportsRedirectUri,
  clientSupportsScopes,
  getOAuthClientByClientId,
  issueAuthorizationCode,
} from "@/server/oidc/service";

import { clientAllowsUser } from "@/server/oidc/client-access";

export const runtime = "nodejs";

function rejectRedirect(redirectUri: string, state: string | null, error: string) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (state) {
    url.searchParams.set("state", state);
  }
  return NextResponse.redirect(url);
}

/**
 * 中文注释：授权端点负责校验 client/redirect/scope，并签发一次性授权码。
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const responseType = requestUrl.searchParams.get("response_type");
  const clientId = requestUrl.searchParams.get("client_id");
  const redirectUri = requestUrl.searchParams.get("redirect_uri");
  const state = requestUrl.searchParams.get("state");
  const nonce = requestUrl.searchParams.get("nonce");
  const scope = requestUrl.searchParams.get("scope") || resolveDefaultScopes();
  const codeChallenge = requestUrl.searchParams.get("code_challenge");
  const codeChallengeMethod = requestUrl.searchParams.get("code_challenge_method");

  if (!clientId || !redirectUri || responseType !== "code") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const client = await getOAuthClientByClientId(clientId);
  if (!client || client.status !== "active") {
    return NextResponse.json({ error: "unauthorized_client" }, { status: 400 });
  }

  if (!clientSupportsRedirectUri(client, redirectUri)) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  if (!clientSupportsScopes(client, scope)) {
    return rejectRedirect(redirectUri, state, "invalid_scope");
  }

  if (!codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) || codeChallengeMethod !== "S256" || (nonce !== null && (nonce.length === 0 || nonce.length > 512))) {
    return rejectRedirect(redirectUri, state, "invalid_request");
  }

  const user = await resolveAuthenticatedUserFromRequest(request);
  if (!user) {
    const signinUrl = new URL("/sign-in", getOidcConfig().issuer);
    signinUrl.searchParams.set("callbackUrl", `${requestUrl.pathname}${requestUrl.search}`);
    return NextResponse.redirect(signinUrl);
  }
  if (user.mustChangePassword) {
    const resetUrl = new URL("/account/password-reset", getOidcConfig().issuer);
    resetUrl.searchParams.set("callbackUrl", `${requestUrl.pathname}${requestUrl.search}`);
    return NextResponse.redirect(resetUrl);
  }

  if (!clientAllowsUser(client, user.id)) {
    return rejectRedirect(redirectUri, state, "access_denied");
  }

  const code = await issueAuthorizationCode({
    nonce,
    clientId,
    userId: user.id,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
  });

  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return NextResponse.redirect(redirectUrl);
}
