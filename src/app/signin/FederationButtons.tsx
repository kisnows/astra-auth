"use client";
import { useEffect, useState } from "react";
export const federationMessages: Record<string, string> = {
  identity_not_linked: "此平台需要先登录已有账号，再到账户中心绑定。",
  verified_email_required: "平台未提供已验证邮箱。请先在平台验证邮箱，或使用邮箱注册后绑定。",
  email_already_registered: "此邮箱已有账号。请用原登录方式登录，再到账户中心绑定此平台。",
  reauthentication_required: "身份验证已过期，请重新验证后继续。",
  identity_already_linked: "此第三方账号已绑定其他用户，无法再次绑定。",
  provider_already_linked: "你已绑定此平台的账号，请先解绑原账号。",
  session_changed: "登录状态发生变化，请重新发起操作。",
  account_unavailable: "当前账号不可用，请联系管理员。",
  federation_failed: "第三方登录未完成或已过期，请重新尝试。",
};

/** 登录方式只展示服务端启用的平台，按钮通过 POST 发起，避免链接预取。 */
export function FederationButtons({ returnTo }: { returnTo: string }) {
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("federationError");
    if (code) setError(federationMessages[code] ?? federationMessages.federation_failed);
    fetch("/api/federation/providers").then((r) => r.ok ? r.json() : []).then(setProviders).catch(() => {});
  }, []);
  async function start(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/federation/${id}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intent: "login", returnTo }) });
      const data = await response.json();
      if (!response.ok) throw new Error();
      window.location.assign(data.url);
    } catch { setError("此登录方式暂不可用，请稍后重试或使用邮箱登录。"); setBusy(false); }
  }
  return <>
    {providers.length > 0 && <div className="federation-section"><p className="auth-subtitle">或使用第三方账号登录 · GitHub / Google 首次使用自动注册</p><div className="auth-form">{providers.map((p) => <button type="button" className="admin-btn" key={p.id} disabled={busy} onClick={() => start(p.id)}>{p.name}</button>)}</div></div>}
    {error && <p className="auth-alert" role="alert">{error}</p>}
    <div className="auth-footer"><a className="auth-link" href="/account">账户与登录方式</a></div>
  </>;
}
