import { exportJWK, exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, SignJWT } from "jose";
import { readFile, mkdir, writeFile, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

type RuntimeKeys = {
  privateKey: CryptoKey;
  publicJwk: Record<string, unknown>;
};

let runtimeKeysPromise: Promise<RuntimeKeys> | null = null;

async function loadKeysFromEnv() {
  const privatePem = process.env.OIDC_JWT_PRIVATE_KEY?.trim();
  const publicPem = process.env.OIDC_JWT_PUBLIC_KEY?.trim();
  if (!privatePem && !publicPem) return null;
  if (!privatePem || !publicPem) throw new Error("OIDC 公私钥必须同时配置");

  const privateKey = await importPKCS8(privatePem, "RS256");
  const publicKey = await importSPKI(publicPem, "RS256");
  const publicJwk = await exportJWK(publicKey);

  return {
    privateKey,
    publicJwk: {
      ...publicJwk,
      use: "sig",
      alg: "RS256",
      kid: process.env.OIDC_JWT_KID || "astraos-auth-k1",
    },
  } satisfies RuntimeKeys;
}

/** 中文注释：签名密钥在持久卷中保存，保证多路由、重启和外部客户端 JWKS 缓存一致。 */
async function loadPersistentKeys(): Promise<RuntimeKeys> {
  const dbPath = process.env.AUTH_SQLITE_PATH?.replace(/^file:/, "") ||
    (process.env.NODE_ENV === "production" ? "/app/data/auth.sqlite" : "infra/db/auth.sqlite");
  const keyPath = process.env.AUTH_SIGNING_KEY_PATH || path.join(path.dirname(dbPath), "oidc-signing-key.json");
  let source: string;
  try { source = await readFile(keyPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const generated = await generateKeyPair("RS256", { extractable: true });
    const material = JSON.stringify({
      privatePem: await exportPKCS8(generated.privateKey), publicPem: await exportSPKI(generated.publicKey),
      kid: process.env.OIDC_JWT_KID || `astra-${randomUUID()}`,
    });
    await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const temporary = `${keyPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, material, { mode: 0o600, flag: "wx" });
    try {
      // 中文注释：原子发布完整文件；并发初始化采用已存在的胜出密钥，不覆盖。
      try { await link(temporary, keyPath); }
      catch (publishError) { if ((publishError as NodeJS.ErrnoException).code !== "EEXIST") throw publishError; }
    } finally { await unlink(temporary); }
    source = await readFile(keyPath, "utf8");
  }
  const stored = JSON.parse(source) as { privatePem: string; publicPem: string; kid: string };
  const privateKey = await importPKCS8(stored.privatePem, "RS256");
  const publicKey = await importSPKI(stored.publicPem, "RS256");
  return { privateKey, publicJwk: { ...await exportJWK(publicKey), use: "sig", alg: "RS256", kid: stored.kid } };
}

async function resolveRuntimeKeys() {
  const fromEnv = await loadKeysFromEnv();
  if (fromEnv) return fromEnv;
  return loadPersistentKeys();
}

/**
 * 中文注释：按进程缓存运行时密钥，避免每个请求重复初始化。
 */
export function getRuntimeKeys() {
  if (!runtimeKeysPromise) {
    runtimeKeysPromise = resolveRuntimeKeys();
  }
  return runtimeKeysPromise;
}

export async function getPublicJwks() {
  const runtime = await getRuntimeKeys();
  return {
    keys: [runtime.publicJwk],
  };
}

export async function signIdToken(payload: {
  issuer: string;
  audience: string;
  subject: string;
  email?: string | null;
  emailVerified?: boolean;
  name?: string | null;
  nonce?: string | null;
  role: "admin" | "user";
}) {
  const runtime = await getRuntimeKeys();
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: payload.email ?? undefined,
    email_verified: payload.emailVerified ?? false,
    name: payload.name ?? undefined,
    nonce: payload.nonce ?? undefined,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "RS256", kid: String(runtime.publicJwk.kid) })
    .setIssuer(payload.issuer)
    .setAudience(payload.audience)
    .setSubject(payload.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .setNotBefore(now - 5)
    .sign(runtime.privateKey);
}
