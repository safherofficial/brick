import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json({ ok: false, error: "PERSISTENCE_NOT_CONFIGURED" }, { status: 500 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = body?.wallet?.trim();
  if (!wallet) {
    return NextResponse.json({ ok: false, error: "WALLET_REQUIRED" }, { status: 401 });
  }

  const db = sql();

  const userRows = await db`
    INSERT INTO users (username, wallet_address)
    VALUES (${`builder-${wallet.slice(0, 4)}${wallet.slice(-4)}`}, ${wallet})
    ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
    RETURNING id
  `;
  const userId = userRows[0]?.id;

  const existing = await db`
    SELECT id FROM likes WHERE creation_id = ${id} AND user_id = ${userId} LIMIT 1
  `;

  let liked: boolean;
  if (existing.length > 0) {
    await db`DELETE FROM likes WHERE creation_id = ${id} AND user_id = ${userId}`;
    await db`UPDATE creations SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ${id}`;
    liked = false;
  } else {
    await db`INSERT INTO likes (creation_id, user_id) VALUES (${id}, ${userId})`;
    await db`UPDATE creations SET likes_count = likes_count + 1 WHERE id = ${id}`;
    liked = true;
  }

  const rows = await db`SELECT likes_count FROM creations WHERE id = ${id}`;

  return NextResponse.json({ ok: true, liked, likes_count: rows[0]?.likes_count ?? 0 });
}
