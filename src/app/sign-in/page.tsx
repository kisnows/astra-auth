import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignInClient } from "@/app/signin/SignInClient";
import { resolveRedirectAllowlistFromConfig } from "@/server/oidc/redirect-origins";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import { resolveAuthRedirect } from "@/lib/auth-redirect";

import { resolveLoginApplication } from "@/server/oidc/login-application";

export const dynamic = "force-dynamic";

/** 中文注释：已有会话直接继续业务回跳或进入账户首页，强制改密始终优先。 */
export default async function AuthSignInPage({ searchParams }: {
  searchParams: Promise<{ callbackUrl?: string; federationError?: string }>;
}) {
  const request = new Request("http://auth.internal/sign-in", { headers: await headers() });
  const [redirectAllowlist, user, params] = await Promise.all([
    resolveRedirectAllowlistFromConfig(), resolveAuthenticatedUserFromRequest(request), searchParams,
  ]);
  if (user) {
    const target = resolveAuthRedirect({ raw: params.callbackUrl, redirectAllowlist, currentOrigin: process.env.AUTH_PUBLIC_URL });
    if (user.mustChangePassword) redirect(`/account/password-reset?callbackUrl=${encodeURIComponent(target)}`);
    if (params.federationError) redirect(`/account?federationError=${encodeURIComponent(params.federationError)}`);
    redirect(target);
  }
  const application = await resolveLoginApplication(params.callbackUrl);
  return <SignInClient redirectAllowlist={redirectAllowlist} application={application} />;
}
