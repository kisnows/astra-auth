import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import db from "@/server/db";
import { users } from "@/server/db/schema";
import {
  readSessionTokenFromCookieHeader,
  verifyInternalRequest,
} from "@/server/internal-auth";
import { getSessionByToken } from "@/server/services/auth/session";

export const runtime = "nodejs";

type SessionResolvePayload = {
  cookieHeader?: string;
  sessionToken?: string;
};

export async function POST(request: Request) {
  if (!verifyInternalRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: SessionResolvePayload = {};
  try {
    payload = (await request.json()) as SessionResolvePayload;
  } catch {
    // 空 body 场景允许直接返回空会话
  }

  const sessionToken =
    payload.sessionToken ??
    readSessionTokenFromCookieHeader(payload.cookieHeader ?? null);
  if (!sessionToken) {
    return NextResponse.json({ session: null, user: null }, { status: 200 });
  }

  const authSession = await getSessionByToken(sessionToken);
  if (!authSession) {
    return NextResponse.json({ session: null, user: null }, { status: 200 });
  }

  const [sessionUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, authSession.user.id))
    .limit(1);

  if (!sessionUser) {
    return NextResponse.json({ session: null, user: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      session: {
        id: authSession.session.id,
        userId: authSession.session.userId,
        expiresAt: authSession.session.expiresAt.toISOString(),
      },
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        name: sessionUser.name,
        image: sessionUser.image,
        emailVerified: Boolean(sessionUser.emailVerified),
      },
    },
    { status: 200 },
  );
}
