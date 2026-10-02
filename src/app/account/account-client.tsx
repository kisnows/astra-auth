"use client";

import { useEffect, useRef, useState } from "react";
import { ReauthenticateButtons } from "./ReauthenticateButtons";
import { federationMessages } from "@/app/signin/FederationButtons";
import type { getAccountOverview } from "@/server/federation/overview";

type AccountData = Awaited<ReturnType<typeof getAccountOverview>>;
type Action = { id: string; name: string; unlink: boolean };

/** 中文注释：账户中心统一呈现登录方式；所有绑定变更均由服务端重新验证身份和归属。 */
export function AccountClient({ initialData, isAdmin }: { initialData: AccountData; isAdmin: boolean }) {
  const [data, setData] = useState(initialData);
  const [action, setAction] = useState<Action | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const availableConnections = data.connections.filter((item) => item.enabled);
  const verificationProviders = availableConnections.flatMap((item) => item.providerId ? [{ id: item.providerId, name: item.name }] : []);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [actionError, setActionError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("federationError");
    if (code) setNotice({ text: federationMessages[code] ?? federationMessages.federation_failed, error: true });
    else if (params.get("result") === "linked") setNotice({ text: "绑定成功，下次可以使用这个第三方账号登录。", error: false });
    if (params.get("verified") === "1" && !initialData.passwordEnabled) {
      const target = params.get("target");
      const unlink = params.get("operation") === "unlink";
      const item = unlink ? initialData.connections.find((c) => c.id === target) : initialData.platforms.find((p) => p.id === target && p.enabled);
      if (item) { setVerified(true); setAction({ id: item.id, name: item.name, unlink }); }
    }
  }, [initialData]);

  useEffect(() => {
    if (action) dialog.current?.showModal();
    else dialog.current?.close();
  }, [action]);

  /** 中文注释：每次绑定操作单独要求密码，取消或提交后立即清除输入。 */
  function choose(next: Action | null) {
    setPassword(""); setActionError(""); setVerified(false); setAction(next);
  }

  async function reload() {
    const response = await fetch("/api/federation/connections", { cache: "no-store" });
    if (response.status === 401) { window.location.replace("/sign-in?callbackUrl=%2Faccount"); return; }
    if (!response.ok) throw new Error();
    setData(await response.json());
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true); setActionError(""); setNotice(null);
    try {
      const response = await fetch(action.unlink ? "/api/federation/connections" : `/api/federation/${action.id}/start`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(action.unlink ? { accountId: action.id, password } : { intent: "link", password }),
      });
      setPassword("");
      const result = await response.json();
      if (!response.ok) {
        setActionError(result.error === "last_login_method" ? "请先设置密码或绑定另一个可用账号，再解除此登录方式。"
          : result.error === "reauthentication_required" ? "密码不正确或身份验证已过期，请重新确认。" : "此登录方式暂不可用，请稍后重试。");
        if (result.error === "reauthentication_required") setVerified(false);
        return;
      }
      if (result.url) window.location.assign(result.url);
      else {
        choose(null);
        setNotice({ text: "已解除绑定，你仍可使用其他登录方式进入账号。", error: false });
        await reload();
      }
    } catch { setActionError("操作未完成，请稍后重试。"); }
    finally { setPassword(""); setBusy(false); }
  }

  /** 中文注释：退出只结束当前 Auth 会话，成功后返回登录页。 */
  async function signOut() {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.replace("/sign-in");
    } catch { setNotice({ text: "退出失败，请重试。", error: true }); setBusy(false); }
  }

  return <main className="account-main">
    <div className="account-shell">
      <header className="account-header">
        <a className="account-brand" href="/account">ASTRAOS <span>账户中心</span></a>
        <nav className="account-nav" aria-label="账户操作">
          {isAdmin && <a className="auth-link" href="/admin">管理控制台</a>}
          <button className="admin-btn" disabled={busy} onClick={signOut}>退出登录</button>
        </nav>
      </header>
      <section className="account-intro" aria-labelledby="account-title">
        <div className="account-avatar" aria-hidden="true">{(data.user.name || data.user.email).slice(0, 1).toUpperCase()}</div>
        <div><p className="account-eyebrow">个人账户</p><h1 id="account-title">{data.user.name || "你的账户"}</h1><p className="account-email">{data.user.email}</p></div>
      </section>
      {notice && <p className={notice.error ? "auth-alert" : "account-notice"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <section className="account-panel" aria-labelledby="security-title">
        <div className="account-section-heading"><h2 id="security-title">账户安全</h2><p>你的统一账号，可使用下方的登录方式进入。</p></div>
        <div className="account-row">
          <div><h3>邮箱与密码</h3><p>{data.user.email}</p></div>
          <div className="account-row-actions"><span className="account-status">{data.passwordEnabled ? "已设置" : "尚未设置密码"}</span><a className="admin-btn account-button-link" href="/account/password-reset?callbackUrl=%2Faccount">{data.passwordEnabled ? "修改密码" : "设置密码"}</a></div>
        </div>
      </section>
      <section className="account-panel" aria-labelledby="connections-title">
        <div className="account-section-heading"><h2 id="connections-title">已绑定的账号 <span className="account-count">{data.connections.length}</span></h2><p>这些第三方身份与当前账号关联，使用同一份数据和权限。</p></div>
        {data.connections.length ? data.connections.map((connection) => <div className="account-row" key={connection.id}>
          <div><h3>{connection.name}</h3><p>{connection.enabled ? "可用于登录" : "平台已停用，暂不可用于登录"}{connection.linkedAt ? ` · ${connection.linkedAt.slice(0, 10)} 绑定` : ""}</p></div>
          <button className="admin-btn" disabled={busy || (!data.passwordEnabled && connection.enabled && availableConnections.length <= 1)} onClick={() => choose({ id: connection.id, name: connection.name, unlink: true })}>解除绑定</button>
        </div>) : <div className="account-empty"><h3>还没有绑定第三方账号</h3><p>你可以继续使用邮箱和密码登录，也可以在下方添加登录方式。</p></div>}
      </section>
      <section className="account-panel" aria-labelledby="platforms-title">
        <div className="account-section-heading"><h2 id="platforms-title">添加登录方式</h2><p>{data.passwordEnabled ? "验证当前密码后，前往对应平台完成授权。" : "先使用已有登录方式验证身份，再绑定另一个平台。"}</p></div>
        {data.platforms.map((platform) => {
          const linked = data.connections.some((connection) => connection.providerId === platform.id);
          return <div className="account-row" key={platform.id}>
            <div className="account-platform"><span className={`account-platform-mark account-platform-${platform.type}`} aria-hidden="true">{({ github: "GH", google: "G", wechat: "微", oidc: "ID" })[platform.type]}</span>
              <div><h3>{platform.name}</h3><p>{!platform.configured ? "管理员配置后即可使用" : !platform.enabled ? "管理员已暂停此登录方式" : linked ? "已与当前账号关联" : "绑定后可用此平台登录"}</p></div>
            </div>
            {linked ? <span className="account-status">已绑定{platform.enabled ? "" : " · 已停用"}</span> : platform.enabled ? <button className="admin-btn" disabled={busy} onClick={() => choose({ id: platform.id, name: platform.name, unlink: false })}>绑定 {platform.name}</button> : <span className="account-status account-status-muted">未启用</span>}
          </div>;
        })}
        {isAdmin && <div className="account-panel-footer"><a className="auth-link" href="/admin/providers">查看平台配置状态与回调地址 →</a></div>}
        {!data.passwordEnabled && <p className="auth-subtitle">建议设置一个密码作为备用登录方式；至少保留一个可用的登录方式。</p>}
      </section>
      <footer className="account-footer">AstraOS · 统一身份与账号管理</footer>
    </div>
    <dialog className="account-dialog" ref={dialog} aria-labelledby="action-title" onCancel={(event) => { if (busy) event.preventDefault(); else choose(null); }}>
      {action && <form onSubmit={submit} className="auth-form" method="post">
        <h2 id="action-title">{action.unlink ? "解除绑定" : "绑定"} {action.name}</h2>
        <p className="auth-subtitle">{action.unlink ? "解除后，此第三方账号将无法登录当前账户。请确保仍有其他可用登录方式。" : "验证当前身份后，将前往平台完成授权。"}</p>
        {data.passwordEnabled ? <><label className="auth-label" htmlFor="account-password">当前账号密码</label>
          <input id="account-password" className="auth-input" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /></>
          : !verified ? <ReauthenticateButtons providers={verificationProviders} returnTo={`/account?verified=1&operation=${action.unlink ? "unlink" : "link"}&target=${encodeURIComponent(action.id)}`} />
          : <p className="account-notice">身份已验证，请确认操作。</p>}
        {actionError && <p className="auth-alert" role="alert">{actionError}</p>}
        <div className="account-dialog-actions"><button className="admin-btn" type="button" disabled={busy} onClick={() => choose(null)}>取消</button><button className="auth-button" type="submit" disabled={busy || (data.passwordEnabled ? !password : !verified)}>{busy ? "正在处理…" : action.unlink ? "确认解绑" : "确认并继续"}</button></div>
      </form>}
    </dialog>
  </main>;
}
