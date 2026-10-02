"use client";

import type { LoginApplication } from "@/lib/login-application";
import { LoginApplicationHeader } from "@/app/login-application-header";

import { DEFAULT_AUTH_REDIRECT, resolveAuthRedirect } from "@/lib/auth-redirect";

import { Suspense, useEffect, useState } from "react";
import { FederationButtons } from "./FederationButtons";
import { useSearchParams } from "next/navigation";

type SignInClientProps = {
  redirectAllowlist: string[];
  application?: LoginApplication | null;
};

const DEFAULT_REDIRECT = DEFAULT_AUTH_REDIRECT;

async function tryClaimFirstAdminRole() {
  try {
    await fetch("/api/bootstrap/claim-first-admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
  } catch {
    // 中文注释：领取管理员角色失败不阻塞登录主流程，避免影响普通用户可用性。
  }
}

function replaceAfterAuth(url: string) {
  // 登录后的跨应用跳转必须交给浏览器处理，确保跨子域 Cookie 写入后再访问 Wealth
  if (/^https?:\/\//.test(url)) {
    window.location.replace(url);
    return;
  }
  window.location.replace(url || DEFAULT_REDIRECT);
}

/** 登录页外层：用 Suspense 包裹以兼容 useSearchParams 的 SSR 要求 */
export function SignInClient({ redirectAllowlist, application }: SignInClientProps) {
  return (
    <Suspense>
      <SignInContent redirectAllowlist={redirectAllowlist} application={application} />
    </Suspense>
  );
}

function SignInContent({ redirectAllowlist, application }: SignInClientProps) {
  const searchParams = useSearchParams();
  // 中文注释：先用稳定默认值渲染，避免首屏 SSR/CSR 因 query 差异导致 hydration mismatch。
  const [callbackUrl, setCallbackUrl] = useState(DEFAULT_REDIRECT);
  const [form, setForm] = useState({ email: "", password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // 客户端事件绑定完成前禁用提交，避免浏览器原生 GET 提交把密码暴露在 URL 中。
    setHydrated(true);
    setCallbackUrl(
      resolveAuthRedirect({
        raw: searchParams.get("callbackUrl"),
        redirectAllowlist,
        currentOrigin: window.location.origin,
      }),
    );
  }, [redirectAllowlist, searchParams]);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });

      if (!response.ok) {
        setError(
          response.status === 401
            ? "邮箱或密码错误"
            : "登录失败，请稍后重试",
        );
        return;
      }

      await tryClaimFirstAdminRole();
      replaceAfterAuth(callbackUrl || DEFAULT_REDIRECT);
    } catch (err) {
      console.error("auth sign in failed", err);
      setError("登录失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-main">
      <section className="auth-shell">
        <div className="auth-card">
          <LoginApplicationHeader application={application} />
          <form className="auth-form" method="post" onSubmit={submit}>
            <label className="auth-label" htmlFor="email">
              邮箱
            </label>
            <input
              className="auth-input"
              id="email"
              name="email"
              placeholder="you@example.com"
              onChange={onChange}
              value={form.email}
              type="email"
              autoComplete="email"
              required
            />
            <label className="auth-label" htmlFor="password">
              密码
            </label>
            <input
              className="auth-input"
              id="password"
              name="password"
              placeholder="••••••••"
              onChange={onChange}
              value={form.password}
              type="password"
              autoComplete="current-password"
              required
            />
            <button
              className="auth-button"
              type="submit"
              disabled={submitting || !hydrated}
            >
              {submitting ? "正在登录…" : hydrated ? "登录" : "加载中…"}
            </button>
          </form>
          <FederationButtons returnTo={callbackUrl} />
          {error ? <div className="auth-alert">{error}</div> : null}
          <div className="auth-footer">
            <span>还没有账号？</span>
            <a
              className="auth-link"
              href={`/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            >
              前往注册
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
