import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: "PERSISTENCE_NOT_CONFIGURED" }, { status: 500 });
  }

  const { id } = await params;
  const db = sql();

  const rows = await db`
    SELECT c.id, c.name, c.description, c.brick_count, c.likes_count,
           c.views_count, c.created_at, c.construction_data,
           u.username AS author
    FROM creations c
    LEFT JOIN users u ON u.id = c.user_id
    WHERE c.id = ${id} AND c.published = TRUE
    LIMIT 1
  `;

  const creation = rows[0];
  if (!creation) {
    return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  await db`UPDATE creations SET views_count = views_count + 1 WHERE id = ${id}`;

  return NextResponse.json({ ok: true, creation });
}
