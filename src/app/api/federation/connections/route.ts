import { NextResponse } from "next/server";
import { getAccountOverview } from "@/server/federation/overview";
import { noStore, reauthenticate, requestSession, sameOrigin } from "@/server/federation/http";
import { unlinkIdentity } from "@/server/federation/identity";
export const runtime = "nodejs";

/** 返回本人绑定概览，不暴露上游 token、原始 subject 或密码字段。 */
export async function GET(request: Request) {
  const { session } = await requestSession(request);
  if (!session) return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
  return noStore(NextResponse.json(await getAccountOverview(session.user)));
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return noStore(NextResponse.json({ error: "forbidden_origin" }, { status: 403 }));
    const body = await request.json();
    const user = await reauthenticate(request, body.password);
    if (typeof body.accountId !== "string") throw new Error();
    unlinkIdentity(user.id, body.accountId);
    return noStore(NextResponse.json({ ok: true }));
  } catch (error) {
    const code = error instanceof Error && error.message === "last_login_method" ? "last_login_method" : "reauthentication_required";
    return noStore(NextResponse.json({ error: code }, { status: 400 }));
  }
}
