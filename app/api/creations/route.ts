import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type PublishBody = {
  wallet?: string;
  title?: string;
  description?: string;
  size?: number;
  palette?: string[];
  voxels?: { x: number; y: number; z: number; c: number }[];
};

const MAX_VOXELS = 150_000;

export async function GET(req: Request) {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json({ ok: true, creations: [] });
  }

  const { searchParams } = new URL(req.url);
  const sort = searchParams.get("sort") === "liked" ? "liked" : "latest";
  const limit = Math.min(60, Math.max(1, Number(searchParams.get("limit")) || 24));

  const db = sql();
  const rows =
    sort === "liked"
      ? await db`
          SELECT c.id, c.name, c.description, c.brick_count, c.likes_count,
                 c.views_count, c.created_at, c.construction_data,
                 u.username AS author
          FROM creations c
          LEFT JOIN users u ON u.id = c.user_id
          WHERE c.published = TRUE
          ORDER BY c.likes_count DESC, c.created_at DESC
          LIMIT ${limit}
        `
      : await db`
          SELECT c.id, c.name, c.description, c.brick_count, c.likes_count,
                 c.views_count, c.created_at, c.construction_data,
                 u.username AS author
          FROM creations c
          LEFT JOIN users u ON u.id = c.user_id
          WHERE c.published = TRUE
          ORDER BY c.created_at DESC
          LIMIT ${limit}
        `;

  return NextResponse.json({ ok: true, creations: rows });
}

export async function POST(req: Request) {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: "PERSISTENCE_NOT_CONFIGURED" },
      { status: 500 }
    );
  }

  const body = (await req.json().catch(() => null)) as PublishBody | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const wallet = body.wallet?.trim();
  const title = body.title?.trim().slice(0, 80);
  const voxels = Array.isArray(body.voxels) ? body.voxels : null;

  if (!wallet) {
    return NextResponse.json({ ok: false, error: "WALLET_REQUIRED" }, { status: 401 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "TITLE_REQUIRED" }, { status: 400 });
  }
  if (!voxels || voxels.length === 0) {
    return NextResponse.json({ ok: false, error: "EMPTY_CREATION" }, { status: 400 });
  }
  if (voxels.length > MAX_VOXELS) {
    return NextResponse.json({ ok: false, error: "TOO_LARGE" }, { status: 413 });
  }

  const db = sql();

  const userRows = await db`
    INSERT INTO users (username, wallet_address)
    VALUES (${`builder-${wallet.slice(0, 4)}${wallet.slice(-4)}`}, ${wallet})
    ON CONFLICT (wallet_address) DO UPDATE SET wallet_address = EXCLUDED.wallet_address
    RETURNING id
  `;
  const userId = userRows[0]?.id;

  const constructionData = {
    v: 1,
    size: body.size ?? 64,
    palette: body.palette ?? [],
    voxels
  };

  const rows = await db`
    INSERT INTO creations (user_id, name, description, construction_data, brick_count, published)
    VALUES (
      ${userId},
      ${title},
      ${body.description?.trim().slice(0, 280) ?? null},
      ${JSON.stringify(constructionData)}::jsonb,
      ${voxels.length},
      TRUE
    )
    RETURNING id
  `;

  return NextResponse.json({ ok: true, id: rows[0]?.id });
}
