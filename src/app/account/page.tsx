import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import { getAccountOverview } from "@/server/federation/overview";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

/** 中文注释：账户资料在服务端验证会话后读取，避免未登录首屏泄露资料。 */
export default async function AccountPage() {
  const request = new Request("http://auth.internal/account", { headers: await headers() });
  const user = await resolveAuthenticatedUserFromRequest(request);
  if (!user) redirect("/sign-in?callbackUrl=%2Faccount");
  if (user.mustChangePassword) redirect("/account/password-reset?callbackUrl=%2Faccount");
  const [data, admin] = await Promise.all([
    getAccountOverview({ id: user.id, email: user.email, name: user.name }), resolveAdminUserFromRequest(request),
  ]);
  return <AccountClient initialData={data} isAdmin={Boolean(admin)} />;
}
