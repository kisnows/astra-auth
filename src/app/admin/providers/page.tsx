import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveAdminUserFromRequest } from "@/server/admin/guard";
import { providerCallback, publicOrigin, readProviders } from "@/server/federation/config";
export const dynamic = "force-dynamic";

/** 管理员查看已部署身份源与回调；服务端密钥始终不进入页面属性。 */
export default async function ProvidersPage() {
  const user = await resolveAdminUserFromRequest(new Request(`${publicOrigin()}/admin/providers`, { headers: await headers() }));
  if (!user) redirect("/sign-in?callbackUrl=%2Fadmin%2Fproviders");
  let providers;
  try { providers = readProviders(); }
  catch { return <main className="admin-page"><h1>第三方登录</h1><p className="admin-alert">服务端身份源配置有误，请检查配置文件格式。</p></main>; }
  return <main className="admin-page"><header><h1 className="admin-page-title">第三方登录</h1><p className="admin-page-description">配置 GitHub、Google、微信网站扫码或通用 OIDC，供用户绑定并登录统一账号。</p></header>
    <section className="admin-panel"><h2>已配置身份源</h2>{providers.length ? providers.map((p) => <article key={p.id} className="federation-section"><h3>{p.name} · {p.enabled ? "已启用" : "已停用"}</h3><p>{p.type} · {p.id}</p><p className="provider-callback">回调地址：<code>{providerCallback(p)}</code></p></article>) : <p>尚未配置身份源。</p>}</section>
    <section className="admin-panel"><h2>配置步骤</h2><ol><li>在第三方平台创建应用，获取 Client ID 和 Client Secret；微信使用 AppID 和 AppSecret。</li><li>参考仓库 apps/auth/docs/upstream-providers.example.json，在服务器创建权限为 0600 的配置文件。</li><li>将 AUTH_UPSTREAM_PROVIDERS_FILE 指向容器内文件路径，填写 enabled、id、类型与应用凭据；通用 OIDC 还需 issuer。</li><li>在平台登记本页列出的完整回调地址，并使用普通测试账号验证绑定、登录和解绑。</li></ol><p>GitHub、Google 首次授权可用已验证邮箱自动注册；邮箱冲突需登录原账号后绑定。微信、通用 OIDC 仍需先绑定已有账号。第三方登录不授予管理员角色或应用访问权限。</p></section>
  </main>;
}
