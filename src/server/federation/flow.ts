import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import db from "@/server/db";
import { authVerifications } from "@/server/db/schema";
import { resolveAuthCookieOptions } from "@/server/services/auth/config";

export type FederationFlow = {
  intent?: "login" | "link" | "reauthenticate";
  providerId: string;
  namespace: string;
  returnTo: string;
  verifier: string;
  nonce: string;
  userId: string | null;
  sessionHash: string | null;
};
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const ttl = 600;

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("auth_secret_required");
  return createHash("sha256").update(`federation-v1:${secret}`).digest();
}

/** 流程数据加密落库，不在浏览器或日志中暴露 PKCE 验证值及会话绑定信息。 */
export function seal(value: FederationFlow) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function unseal(value: string): FederationFlow {
  const data = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString());
}

export function flowCookieName(providerId: string) {
  return `${resolveAuthCookieOptions().secure ? "__Host-" : ""}astra-federation-${providerId}`;
}
export function flowCookieOptions() {
  return { httpOnly: true, secure: resolveAuthCookieOptions().secure, sameSite: "lax" as const, path: "/", maxAge: ttl };
}

/** state 与浏览器随机证明共同定位一次性记录，伪造回调不能消费其他浏览器的流程。 */
export async function createFlow(flow: FederationFlow) {
  const state = randomBytes(32).toString("base64url");
  const proof = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.delete(authVerifications).where(and(lt(authVerifications.expiresAt, now), eq(authVerifications.identifier, "federation-v1")));
  await db.insert(authVerifications).values({
    id: digest(`${state}:${proof}`), identifier: "federation-v1", value: seal(flow),
    createdAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + ttl * 1000),
  });
  return { state, proof };
}

/** 在交换授权码前原子删除流程，防止双击、并发回调及授权码重放。 */
export async function consumeFlow(state: string, proof: string) {
  if (!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(proof)) throw new Error("invalid_flow");
  const [row] = await db.delete(authVerifications).where(and(
    eq(authVerifications.id, digest(`${state}:${proof}`)),
    eq(authVerifications.identifier, "federation-v1"), gt(authVerifications.expiresAt, new Date()),
  )).returning();
  if (!row) throw new Error("invalid_flow");
  return unseal(row.value);
}
