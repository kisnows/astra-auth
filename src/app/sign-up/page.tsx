import { SignUpClient } from "@/app/signup/SignUpClient";
import { resolveRedirectAllowlistFromConfig } from "@/server/oidc/redirect-origins";

import { resolveLoginApplication } from "@/server/oidc/login-application";

export const dynamic = "force-dynamic";

export default async function AuthSignUpPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const redirectAllowlist = await resolveRedirectAllowlistFromConfig();
  const application = await resolveLoginApplication((await searchParams).callbackUrl);
  return <SignUpClient redirectAllowlist={redirectAllowlist} application={application} />;
}
