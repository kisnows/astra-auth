import type { LoginApplication } from "@/lib/login-application";

/** 中文注释：应用介绍统一按纯文本渲染，认证中心标识和真实目标域名始终不可由接入方覆盖。 */
export function LoginApplicationHeader({ application, signup = false }: {
  application?: LoginApplication | null; signup?: boolean;
}) {
  return <>
    {application ? <p className="auth-provider-label">AstraOS 统一账号</p> : null}
    <h1 className="auth-title">{application ? `${signup ? "注册并前往" : "登录到"} ${application.appName}` : signup ? "创建 AstraOS 账号" : "AstraOS 登录"}</h1>
    <p className="auth-subtitle auth-app-description">{application?.description || (application
      ? `使用统一账号，继续前往 ${application.appName}。`
      : signup ? "账号用于统一登录，业务资料会在进入具体应用时引导补全。" : "管理你的统一账号，或继续前往正在登录的应用。")}</p>
    {application ? <p className="auth-app-destination">登录后前往 <span>{application.origin}</span></p> : null}
  </>;
}
