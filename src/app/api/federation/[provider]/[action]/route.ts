import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { identityNamespace, providerCallback, publicOrigin, requireProvider, safeReturnTo } from "@/server/federation/config";
import { consumeFlow, createFlow, digest, flowCookieName, flowCookieOptions, type FederationFlow } from "@/server/federation/flow";
import { authorizationUrl, exchangeIdentity } from "@/server/federation/providers";
import { linkIdentity, loginOrRegisterIdentity, userForIdentity } from "@/server/federation/identity";
import { noStore, reauthenticate, requestSession, sameOrigin } from "@/server/federation/http";
import { createSession } from "@/server/services/auth/session";
import { resolveAuthCookieOptions } from "@/server/services/auth/config";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import { grantReauthentication } from "@/server/federation/reauthentication";
export const runtime = "nodejs";
type Context = { params: Promise<{ provider: string; action: string }> };

/** 同源 POST 发起登录或绑定；服务端保存流程，不接受 GET 隐式绑定。 */
export async function POST(request: NextRequest, context: Context) {
  const params = await context.params;
  if (params.action !== "start") return noStore(NextResponse.json({ error: "not_found" }, { status: 404 }));
  try {
    if (!sameOrigin(request)) return noStore(NextResponse.json({ error: "forbidden_origin" }, { status: 403 }));
    const provider = requireProvider(params.provider);
    const body = await request.json();
    if (!["login", "link", "reauthenticate"].includes(body.intent)) throw new Error("invalid_request");
    const { token, session } = await requestSession(request);
    const user = body.intent === "link" ? await reauthenticate(request, body.password)
      : body.intent === "reauthenticate" ? await resolveAuthenticatedUserFromRequest(request) : null;
    if (body.intent === "reauthenticate" && (!user || user.mustChangePassword)) throw new Error("reauthentication_required");
    const flow: FederationFlow = {
      intent: body.intent, providerId: provider.id, namespace: identityNamespace(provider),
      returnTo: body.intent === "link" ? "/account?result=linked" : safeReturnTo(body.returnTo),
      verifier: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"),
      userId: user?.id ?? null, sessionHash: session && token ? digest(token) : null,
    };
    const { state, proof } = await createFlow(flow);
    const url = await authorizationUrl(provider, flow, state);
    const response = noStore(NextResponse.json({ url }));
    response.cookies.set(flowCookieName(provider.id), proof, flowCookieOptions());
    return response;
  } catch (error) {
    const message = error instanceof Error && error.message === "reauthentication_required" ? "reauthentication_required" : "provider_unavailable";
    return noStore(NextResponse.json({ error: message }, { status: 400 }));
  }
}

/** 回调先核对浏览器和原会话，再兑换身份并建立 Auth 本地会话。 */
export async function GET(request: NextRequest, context: Context) {
  const params = await context.params;
  if (params.action !== "callback") return noStore(NextResponse.json({ error: "not_found" }, { status: 404 }));
  let response: NextResponse;
  let binding = false;
  try {
    const provider = requireProvider(params.provider);
    const state = request.nextUrl.searchParams.get("state") ?? "";
    if (request.nextUrl.searchParams.getAll("state").length !== 1 || request.nextUrl.searchParams.getAll("code").length > 1) throw new Error("invalid_flow");
    const flow = await consumeFlow(state, request.cookies.get(flowCookieName(provider.id))?.value ?? "");
    binding = Boolean(flow.userId);
    if (flow.providerId !== provider.id || flow.namespace !== identityNamespace(provider)) throw new Error("invalid_flow");
    const { token, session } = await requestSession(request);
    if ((session && token ? digest(token) : null) !== flow.sessionHash) throw new Error("session_changed");
    if (flow.userId && session?.user.id !== flow.userId) throw new Error("session_changed");
    // 代理内部 host 不参与上游 redirect_uri 校验，始终使用部署配置的公开地址。
    const callback = new URL(providerCallback(provider));
    callback.search = request.nextUrl.search;
    const identity = await exchangeIdentity(provider, flow, callback, state);
    // 网络交换期间会话可能退出或切换，登录和绑定都再次复核发起会话。
    const current = await requestSession(request);
    if ((current.session && current.token ? digest(current.token) : null) !== flow.sessionHash) throw new Error("session_changed");
    if (flow.userId) {
      if (current.session?.user.id !== flow.userId) throw new Error("session_changed");
      if (flow.intent === "reauthenticate") {
        const owner = await userForIdentity(flow.namespace, identity.subject);
        if (owner.id !== flow.userId || owner.mustChangePassword) throw new Error("reauthentication_required");
        response = NextResponse.redirect(new URL(flow.returnTo, publicOrigin()), 303);
        await grantReauthentication(response, owner.id, current.token!, flow.namespace, identity.subject);
        response.cookies.set(flowCookieName(provider.id), "", { ...flowCookieOptions(), maxAge: 0 });
        return noStore(response);
      }
      linkIdentity(flow.userId, flow.namespace, identity.subject);
    } else {
      const user = loginOrRegisterIdentity(provider, identity, current.session?.user.id);
      if (session && session.user.id !== user.id) throw new Error("session_changed");
      const created = await createSession({ userId: user.id, userAgent: request.headers.get("user-agent") });
      const target = user.mustChangePassword ? `/account/password-reset?callbackUrl=${encodeURIComponent(flow.returnTo)}` : flow.returnTo;
      response = NextResponse.redirect(new URL(target, publicOrigin()), 303);
      const options = resolveAuthCookieOptions();
      response.cookies.set(options.name, created.token, options);
      response.cookies.set(flowCookieName(provider.id), "", { ...flowCookieOptions(), maxAge: 0 });
      return noStore(response);
    }
    response = NextResponse.redirect(new URL(flow.returnTo, publicOrigin()), 303);
  } catch (error) {
    const code = error instanceof Error && ["identity_not_linked", "identity_already_linked", "provider_already_linked", "session_changed", "account_unavailable", "verified_email_required", "email_already_registered", "reauthentication_required"].includes(error.message) ? error.message : "federation_failed";
    const target = new URL(binding ? "/account" : "/sign-in", publicOrigin());
    target.searchParams.set("federationError", code);
    response = NextResponse.redirect(target, 303);
  }
  if (/^[a-z][a-z0-9-]{0,39}$/.test(params.provider)) response.cookies.set(flowCookieName(params.provider), "", { ...flowCookieOptions(), maxAge: 0 });
  return noStore(response);
}
