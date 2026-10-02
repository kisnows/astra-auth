import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import db from "@/server/db";
import { users } from "@/server/db/schema";
import { verifyInternalRequest } from "@/server/internal-auth";

export const runtime = "nodejs";

type UpdateUserPayload = {
  name?: string;
  image?: string | null;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!verifyInternalRequest(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let payload: UpdateUserPayload;
  try {
    payload = (await request.json()) as UpdateUserPayload;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    const normalized = payload.name.trim();
    patch.name = normalized.length > 0 ? normalized : "";
  }
  if (payload.image !== undefined) {
    patch.image = payload.image;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  const { id } = await context.params;
  const [updated] = await db
    .update(users)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      emailVerified: users.emailVerified,
    });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json(
    {
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        image: updated.image,
        emailVerified: Boolean(updated.emailVerified),
      },
    },
    { status: 200 },
  );
}
