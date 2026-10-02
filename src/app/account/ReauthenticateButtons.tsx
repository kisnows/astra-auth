"use client";
import { useState } from "react";

/** 无密码用户通过已有登录方式重新验证；证明由服务端绑定浏览器和原会话。 */
export function ReauthenticateButtons({ providers, returnTo }: { providers: { id: string; name: string }[]; returnTo: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function verify(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/federation/${id}/start`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "reauthenticate", returnTo }) });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error();
      window.location.assign(result.url);
    } catch { setError("身份验证未完成，请重试。"); setBusy(false); }
  }
  return <div className="auth-form">
    <p className="auth-subtitle">请使用已绑定的第三方账号重新验证身份，再继续操作。</p>
    {providers.map((provider) => <button key={provider.id} className="admin-btn" type="button" disabled={busy} onClick={() => verify(provider.id)}>使用 {provider.name} 验证身份</button>)}
    {!providers.length && <p className="auth-alert">当前没有可用的第三方登录方式，请联系管理员恢复账号。</p>}
    {error && <p className="auth-alert" role="alert">{error}</p>}
  </div>;
}
