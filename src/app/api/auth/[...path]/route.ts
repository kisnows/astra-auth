import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  resolveAllowedOrigins,
  resolveAuthCookieOptions,
} from "@/server/services/auth/config";
import {
  createSession,
  createUserWithPassword,
  deleteSessionByToken,
  getSessionByToken,
  updateCurrentUser,
  verifyEmailPassword,
} from "@/server/services/auth/session";

export const runtime = "nodejs";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signUpSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
});

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function readSessionToken(req: NextRequest) {
  // 同时兼容 Secure 与非 Secure cookie 名，方便本地和生产环境切换
  const options = resolveAuthCookieOptions();
  const fallbackName = `${process.env.AUTH_COOKIE_PREFIX || "astraos-auth"}.session_token`;
  return (
    req.cookies.get(options.name)?.value ??
    req.cookies.get(fallbackName)?.value ??
    null
  );
}

function json(data: unknown, init?: ResponseInit) {
  // 统一 JSON 响应，后续需要 CORS 时集中扩展
  return NextResponse.json(data, init);
}

function setSessionCookie(response: NextResponse, token: string) {
  // 登录成功后写入跨子域 HttpOnly session cookie
  const options = resolveAuthCookieOptions();
  response.cookies.set(options.name, token, options);
}

function clearSessionCookie(response: NextResponse) {
  // 退出登录清理当前部署使用的 cookie 名，同时清理非 Secure 旧名
  const options = resolveAuthCookieOptions();
  const base = {
    domain: options.domain,
    httpOnly: true as const,
    path: "/",
    sameSite: options.sameSite,
    secure: options.secure,
    maxAge: 0,
    expires: new Date(0),
  };
  response.cookies.set(options.name, "", base);
  response.cookies.set(
    `${process.env.AUTH_COOKIE_PREFIX || "astraos-auth"}.session_token`,
    "",
    base,
  );
}

function assertTrustedOrigin(req: NextRequest) {
  // 浏览器写请求必须来自可信 origin；服务端调用通常没有 Origin，允许通过
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return resolveAllowedOrigins().has(origin);
}

function resolveClientIp(req: NextRequest) {
  // 从代理头取第一个 IP，用于会话审计信息
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip")
  );
}

async function handleGetSession(req: NextRequest) {
  const authSession = await getSessionByToken(readSessionToken(req));
  if (!authSession) {
    return json(null, { status: 401 });
  }
  return json(authSession);
}

async function handleSignUp(req: NextRequest) {
  if (!assertTrustedOrigin(req)) {
    return json({ error: "forbidden_origin" }, { status: 403 });
  }

  const parsed = signUpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "validation_failed" }, { status: 400 });
  }

  try {
    const user = await createUserWithPassword(parsed.data);
    return json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "user_exists") {
      return json(
        { message: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "password_too_short") {
      return json({ error: "password_too_short" }, { status: 400 });
    }
    console.error("auth sign up failed", error);
    return json({ error: "internal_server_error" }, { status: 500 });
  }
}

async function handleSignIn(req: NextRequest) {
  if (!assertTrustedOrigin(req)) {
    return json({ error: "forbidden_origin" }, { status: 403 });
  }

  const parsed = signInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "validation_failed" }, { status: 400 });
  }

  const user = await verifyEmailPassword(parsed.data);
  if (!user) {
    return json({ error: "invalid_credentials" }, { status: 401 });
  }

  const session = await createSession({
    userId: user.id,
    ipAddress: resolveClientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  const response = json({
    user,
    session: { expiresAt: session.expiresAt },
  });
  setSessionCookie(response, session.token);
  return response;
}

async function handleSignOut(req: NextRequest) {
  if (!assertTrustedOrigin(req)) {
    return json({ error: "forbidden_origin" }, { status: 403 });
  }

  await deleteSessionByToken(readSessionToken(req));
  const response = json({ ok: true });
  clearSessionCookie(response);
  return response;
}

async function handleUpdateUser(req: NextRequest) {
  if (!assertTrustedOrigin(req)) {
    return json({ error: "forbidden_origin" }, { status: 403 });
  }

  const authSession = await getSessionByToken(readSessionToken(req));
  if (!authSession) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = updateUserSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return json({ error: "validation_failed" }, { status: 400 });
  }

  const user = await updateCurrentUser({
    userId: authSession.user.id,
    name: parsed.data.name,
  });
  if (!user) {
    return json({ error: "user_not_found" }, { status: 404 });
  }
  return json({ user });
}

async function route(
  req: NextRequest,
  context: RouteContext,
) {
  const params = await context.params;
  const path = params.path?.join("/") ?? "";

  if (req.method === "GET" && path === "get-session") {
    return handleGetSession(req);
  }
  if (req.method === "POST" && path === "sign-up/email") {
    return handleSignUp(req);
  }
  if (req.method === "POST" && path === "sign-in/email") {
    return handleSignIn(req);
  }
  if (req.method === "POST" && path === "sign-out") {
    return handleSignOut(req);
  }
  if (req.method === "POST" && path === "update-user") {
    return handleUpdateUser(req);
  }

  return json({ error: "not_found" }, { status: 404 });
}

export function OPTIONS() {
  return new Response(null, { status: 204 });
}

export const GET = route;
export const POST = route;
