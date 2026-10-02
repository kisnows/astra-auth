import { randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { NextResponse } from "next/server";
import db from "@/server/db";
import { authVerifications } from "@/server/db/schema";
import { readSessionTokenFromCookieHeader } from "@/server/internal-auth";
import { identityNamespace, readProviders } from "./config";
import { digest, flowCookieOptions } from "./flow";
import { userForIdentity } from "./identity";

const identifier = "federation-reauth-v1";
const ttl = 300;
function cookieName() { return `${flowCookieOptions().secure ? "__Host-" : ""}astra-reauth`; }

/** 重新授权成功后发放当前浏览器和会话专属的一次性操作证明。 */
export async function grantReauthentication(response: NextResponse, userId: string, sessionToken: string, namespace: string, subject: string) {
  const proof = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(authVerifications).where(and(eq(authVerifications.identifier, identifier), lt(authVerifications.expiresAt, now)));
  await db.insert(authVerifications).values({ id: digest(`${identifier}:${proof}`), identifier,
    value: JSON.stringify({ userId, sessionHash: digest(sessionToken), namespace, subject }), expiresAt: new Date(now.getTime() + ttl * 1000) });
  response.cookies.set(cookieName(), proof, { ...flowCookieOptions(), maxAge: ttl });
}

/** 密码缺省时仍需消费近期的上游证明；单独持有会话 Cookie 不能修改登录方式。 */
export async function consumeReauthentication(request: Request, userId: string) {
  const token = readSessionTokenFromCookieHeader(request.headers.get("cookie"));
  const proof = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName()}=`))?.slice(cookieName().length + 1);
  if (!token || !proof || !/^[\w-]{43}$/.test(proof)) throw new Error("reauthentication_required");
  const [row] = await db.delete(authVerifications).where(and(eq(authVerifications.id, digest(`${identifier}:${proof}`)),
    eq(authVerifications.identifier, identifier), gt(authVerifications.expiresAt, new Date()))).returning();
  if (!row) throw new Error("reauthentication_required");
  const value = JSON.parse(row.value) as { userId: string; sessionHash: string; namespace: string; subject: string };
  if (value.userId !== userId || value.sessionHash !== digest(token)
    || !readProviders().some((p) => p.enabled && identityNamespace(p) === value.namespace)
    || (await userForIdentity(value.namespace, value.subject)).id !== userId) throw new Error("reauthentication_required");
}
