"use client";

import { DEFAULT_AUTH_REDIRECT, resolveAuthRedirect } from "@/lib/auth-redirect";

import { ReauthenticateButtons } from "../ReauthenticateButtons";
import type { getAccountOverview } from "@/server/federation/overview";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const DEFAULT_REDIRECT = DEFAULT_AUTH_REDIRECT;

/** 中文注释：密码修改后仅回到本站安全路径，拒绝协议相对跳转。 */
function resolveCallbackUrl(raw?: string | null) {
  return resolveAuthRedirect({ raw, currentOrigin: typeof window !== "undefined" ? window.location.origin : null });
}

export default function PasswordResetPage() {
  return (
    <Suspense>
      <PasswordResetContent />
    </Suspense>
  );
}

function PasswordResetContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () => resolveCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams],
  );

  const [account, setAccount] = useState<Awaited<ReturnType<typeof getAccountOverview>> | null>(null);
  const [verified, setVerified] = useState(searchParams.get("verified") === "1");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/federation/connections", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (response.status === 401) { router.replace("/sign-in?callbackUrl=%2Faccount"); return; }
      if (!response.ok) throw new Error();
      setAccount(await response.json());
    }).catch(() => { if (!controller.signal.aborted) setError("读取账号信息失败，请刷新重试。"); });
    return () => controller.abort();
  }, [router]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (newPassword.length < 8) {
      setError("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/account/password/change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (payload?.error === "reauthentication_required") {
          setVerified(false);
          setError("身份验证已过期，请重新验证。");
        } else if (payload?.error === "invalid_current_password") {
          setError("当前密码错误");
        } else if (payload?.error === "unauthorized") {
          router.replace(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        } else {
          setError("密码更新失败，请稍后重试");
        }
        return;
      }

      router.replace(callbackUrl || DEFAULT_REDIRECT);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-main">
      <section className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">{account?.passwordEnabled ? "更新密码" : "设置密码"}</h1>
          <p className="auth-subtitle">
            {account?.passwordEnabled ? "验证当前密码后设置新密码。临时密码用户需完成修改才能继续。" : "设置密码后，也可以使用邮箱登录，作为第三方登录的备用方式。"}
          </p>
          {!account ? <p className="auth-subtitle">正在读取账号信息…</p> : !account.passwordEnabled && !verified
            ? <ReauthenticateButtons providers={account.connections.flatMap((item) => item.enabled && item.providerId ? [{ id: item.providerId, name: item.name }] : [])}
              returnTo={`/account/password-reset?verified=1&callbackUrl=${encodeURIComponent(callbackUrl)}`} />
            : <form className="auth-form" onSubmit={submit}>
            {account.passwordEnabled && <><label className="auth-label" htmlFor="currentPassword">
              当前密码
            </label>
            <input
              id="currentPassword"
              className="auth-input"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              required
            /></>}

            <label className="auth-label" htmlFor="newPassword">
              新密码
            </label>
            <input
              id="newPassword"
              className="auth-input"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              required
            />

            <label className="auth-label" htmlFor="confirmPassword">
              确认新密码
            </label>
            <input
              id="confirmPassword"
              className="auth-input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              required
            />

            <button className="auth-button" type="submit" disabled={submitting}>
              {submitting ? "提交中..." : "更新并继续"}
            </button>
          </form>}
          {error ? <div className="auth-alert">{error}</div> : null}
        </div>
      </section>
    </main>
  );
}
