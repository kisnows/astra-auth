import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveAuthenticatedUserFromRequest } from "@/server/auth-session";
import {
  resolveCredentialPasswordHash,
  upsertCredentialPassword,
  setInitialCredentialPassword,
} from "@/server/services/auth/session";
import { hashPassword, verifyPassword } from "@/server/services/identity/password";

import { noStore, reauthenticate, sameOrigin } from "@/server/federation/http";
export const runtime = "nodejs";

/**
 * 中文注释：已登录用户修改密码，并清除首次登录强制改密标记。
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return noStore(NextResponse.json({ error: "forbidden_origin" }, { status: 403 }));
  const user = await resolveAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = z.object({ currentPassword: z.string().max(1024).optional(), newPassword: z.string().min(8).max(1024) })
    .safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { currentPassword = "", newPassword } = payload.data;
  const currentPasswordHash = await resolveCredentialPasswordHash({
    userId: user.id,
    passwordHash: user.passwordHash,
  });
  if (!currentPasswordHash) {
    try {
      await reauthenticate(request, undefined);
      const passwordHash = await hashPassword(newPassword);
      if (!(await resolveAuthenticatedUserFromRequest(request))) throw new Error("reauthentication_required");
      setInitialCredentialPassword(user.id, passwordHash);
      return noStore(NextResponse.json({ ok: true }));
    } catch { return noStore(NextResponse.json({ error: "reauthentication_required" }, { status: 400 })); }
  }

  const isCurrentPasswordValid = await verifyPassword(
    currentPassword,
    currentPasswordHash,
  );
  if (!isCurrentPasswordValid) {
    return NextResponse.json({ error: "invalid_current_password" }, { status: 400 });
  }

  const passwordHash = await hashPassword(newPassword);

  await upsertCredentialPassword({
    userId: user.id,
    passwordHash,
    mustChangePassword: false,
  });

  return NextResponse.json({ ok: true });
}
