"use client";

import type { LoginApplication } from "@/lib/login-application";
import { FederationButtons } from "@/app/signin/FederationButtons";
import { LoginApplicationHeader } from "@/app/login-application-header";

import { DEFAULT_AUTH_REDIRECT, resolveAuthRedirect } from "@/lib/auth-redirect";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SignUpClientProps = {
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
    // 中文注释：领取管理员角色失败不阻塞注册主流程，避免影响首访注册体验。
  }
}

function replaceAfterAuth(url: string) {
  // 注册后的跨应用跳转必须交给浏览器处理，确保跨子域 Cookie 写入后再访问 Wealth
  if (/^https?:\/\//.test(url)) {
    window.location.replace(url);
    return;
  }
  window.location.replace(url || DEFAULT_REDIRECT);
}

/** 注册页外层：用 Suspense 包裹以兼容 useSearchParams 的 SSR 要求 */
export function SignUpClient({ redirectAllowlist, application }: SignUpClientProps) {
  return (
    <Suspense>
      <SignUpContent redirectAllowlist={redirectAllowlist} application={application} />
    </Suspense>
  );
}

function SignUpContent({ redirectAllowlist, application }: SignUpClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = useMemo(
    () =>
      resolveAuthRedirect({
        raw: searchParams.get("callbackUrl"),
        currentOrigin: typeof window !== "undefined" ? window.location.origin : null,
        redirectAllowlist,
      }),
    [redirectAllowlist, searchParams],
  );
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    confirmPassword: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // 客户端事件绑定完成前禁用提交，避免浏览器走原生提交。
    setHydrated(true);
  }, []);

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          name: form.name.trim() || undefined,
          password: form.password,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        if (payload?.message === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
          setError("邮箱已被占用");
          return;
        }
        setError("注册失败，请稍后重试");
        return;
      }

      const signInResponse = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
        }),
      });

      if (!signInResponse.ok) {
        setError("注册完成，请手动登录");
        router.replace(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
        return;
      }

      await tryClaimFirstAdminRole();

      replaceAfterAuth(callbackUrl || DEFAULT_REDIRECT);
    } catch (submitError) {
      console.error("auth sign up failed", submitError);
      setError("注册失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-main">
      <section className="auth-shell">
        <div className="auth-card">
          <LoginApplicationHeader application={application} signup />
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
            <label className="auth-label" htmlFor="name">
              姓名（可选）
            </label>
            <input
              className="auth-input"
              id="name"
              name="name"
              placeholder="你的昵称"
              onChange={onChange}
              value={form.name}
              type="text"
            />
            <label className="auth-label" htmlFor="password">
              密码
            </label>
            <input
              className="auth-input"
              id="password"
              name="password"
              placeholder="至少 8 位"
              onChange={onChange}
              value={form.password}
              type="password"
              autoComplete="new-password"
              required
            />
            <label className="auth-label" htmlFor="confirmPassword">
              确认密码
            </label>
            <input
              className="auth-input"
              id="confirmPassword"
              name="confirmPassword"
              placeholder="再次输入密码"
              onChange={onChange}
              value={form.confirmPassword}
              type="password"
              autoComplete="new-password"
              required
            />
            <button
              className="auth-button"
              type="submit"
              disabled={submitting || !hydrated}
            >
              {submitting ? "正在注册…" : hydrated ? "注册" : "加载中…"}
            </button>
          </form>
          {error ? <div className="auth-alert">{error}</div> : null}
          <FederationButtons returnTo={callbackUrl} />
          <div className="auth-footer">
            <span>已经有账号？</span>
            <a
              className="auth-link"
              href={`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`}
            >
              返回登录
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
