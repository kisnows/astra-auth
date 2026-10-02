"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DEFAULT_REDIRECT = "/sign-in";

function resolveToken(raw?: string | null) {
  return raw?.trim() || "";
}

function resolveCallbackUrl(raw?: string | null) {
  if (!raw) return DEFAULT_REDIRECT;
  if (raw.startsWith("/")) return raw;
  try {
    const parsed = new URL(raw);
    if (typeof window !== "undefined" && parsed.origin === window.location.origin) {
      return raw;
    }
  } catch {
    return DEFAULT_REDIRECT;
  }
  return DEFAULT_REDIRECT;
}

export default function PasswordResetByTokenPage() {
  return (
    <Suspense>
      <PasswordResetByTokenContent />
    </Suspense>
  );
}

function PasswordResetByTokenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => resolveToken(searchParams.get("token")), [searchParams]);
  const callbackUrl = useMemo(
    () => resolveCallbackUrl(searchParams.get("callbackUrl")),
    [searchParams],
  );

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError("重置链接无效或缺少 token");
      return;
    }
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
      const response = await fetch("/api/account/password/reset-by-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (payload?.error === "token_invalid_or_expired") {
          setError("重置链接已过期或无效，请重新生成");
        } else {
          setError("重置失败，请稍后重试");
        }
        return;
      }

      setSuccess(true);
      setTimeout(() => {
        router.replace(callbackUrl || DEFAULT_REDIRECT);
      }, 800);
    } catch {
      setError("重置失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-main">
      <section className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">重置管理员密码</h1>
          <p className="auth-subtitle">请设置新的登录密码，提交后旧会话将全部失效。</p>
          <form className="auth-form" onSubmit={submit}>
            <label className="auth-label" htmlFor="newPassword">
              新密码
            </label>
            <input
              id="newPassword"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
            <label className="auth-label" htmlFor="confirmPassword">
              确认新密码
            </label>
            <input
              id="confirmPassword"
              className="auth-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            <button className="auth-button" type="submit" disabled={submitting || success}>
              {submitting ? "提交中..." : success ? "重置成功，跳转中..." : "确认重置"}
            </button>
          </form>
          {error ? <div className="auth-alert">{error}</div> : null}
          {!token ? <div className="auth-alert">缺少 token，请使用完整重置链接访问。</div> : null}
        </div>
      </section>
    </main>
  );
}
