import type { NextResponse } from "next/server";
import { publicOrigin } from "./config";
import { consumeReauthentication } from "./reauthentication";
import { readSessionTokenFromCookieHeader } from "@/server/internal-auth";
import { getSessionByToken, resolveCredentialPasswordHash, verifyEmailPassword } from "@/server/services/auth/session";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";

export function noStore(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
export function sameOrigin(request: Request) {
  return request.headers.get("origin") === publicOrigin();
}
export async function requestSession(request: Request) {
  const token = readSessionTokenFromCookieHeader(request.headers.get("cookie"));
  return { token, session: await getSessionByToken(token) };
}

/** 有密码账号验证密码；无密码账号验证近期第三方证明，均须先完成强制改密。 */
export async function reauthenticate(request: Request, password: unknown) {
  const user = await resolveAuthenticatedUserFromRequest(request);
  if (!user || user.mustChangePassword) throw new Error("reauthentication_required");
  const hash = await resolveCredentialPasswordHash({ userId: user.id, passwordHash: user.passwordHash });
  if (!hash) {
    await consumeReauthentication(request, user.id);
    return user;
  }
  if (typeof password !== "string" || password.length > 1024) throw new Error("reauthentication_required");
  const verified = await verifyEmailPassword({ email: user.email, password });
  if (!verified || verified.id !== user.id) throw new Error("reauthentication_required");
  return user;
}
