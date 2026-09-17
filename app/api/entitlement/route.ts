import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const DEV_WALLET = "4GKjWC5gtFEYDsEH4y5dKuHLLMCBduoGYUPc6yhKq19p";
const FREE_IMAGE_APPLIES = 5;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

type Apply = { hash: string; at: number };

function planOf(wallet: string, rowPlan?: string) {
  if (wallet === DEV_WALLET) return "monthly" as const;
  return rowPlan === "monthly" ? ("monthly" as const) : ("free" as const);
}

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  if (wallet === DEV_WALLET) {
    return NextResponse.json({ ok: true, plan: "monthly", remaining: Number.POSITIVE_INFINITY });
  }

  const url = process.env.POSTGRES_URL;
  if (!url) return NextResponse.json({ ok: true, plan: "free", remaining: null, offline: true });
  const db = neon(url);
  const rows = await db`
    SELECT plan, applies FROM entitlements WHERE wallet = ${wallet} LIMIT 1
  `;
  const plan = planOf(wallet, rows[0]?.plan as string | undefined);
  const applies = Array.isArray(rows[0]?.applies) ? (rows[0].applies as Apply[]) : [];
  const unique = new Set(applies.map((a) => a.hash)).size;
  const remaining = plan === "monthly" ? Number.POSITIVE_INFINITY : Math.max(0, FREE_IMAGE_APPLIES - unique);
  return NextResponse.json({ ok: true, plan, remaining });
}

export async function POST(req: Request) {
  let body: { wallet?: string; hash?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  }
  const wallet = body.wallet?.trim();
  const hash = body.hash?.trim();
  if (!wallet || !hash) {
    return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  }
  if (wallet === DEV_WALLET) {
    return NextResponse.json({
      ok: true,
      plan: "monthly",
      reason: "subscribed",
      remaining: Number.POSITIVE_INFINITY
    });
  }

  const url = process.env.POSTGRES_URL;
  if (!url) {
    return NextResponse.json({ ok: true, plan: "free", reason: "offline", remaining: null, offline: true });
  }

  const db = neon(url);
  const now = Date.now();
  const rows = await db`
    SELECT plan, applies FROM entitlements WHERE wallet = ${wallet} LIMIT 1
  `;
  const plan = planOf(wallet, rows[0]?.plan as string | undefined);
  const applies: Apply[] = Array.isArray(rows[0]?.applies) ? [...(rows[0].applies as Apply[])] : [];

  if (plan === "monthly") {
    return NextResponse.json({
      ok: true,
      plan,
      reason: "subscribed",
      remaining: Number.POSITIVE_INFINITY
    });
  }

  if (applies.some((a) => a.hash === hash && now - a.at < REPEAT_WINDOW_MS)) {
    const unique = new Set(applies.map((a) => a.hash)).size;
    return NextResponse.json({
      ok: true,
      plan,
      reason: "repeat",
      remaining: Math.max(0, FREE_IMAGE_APPLIES - unique)
    });
  }

  const unique = new Set(applies.map((a) => a.hash)).size;
  if (unique >= FREE_IMAGE_APPLIES) {
    return NextResponse.json({
      ok: false,
      plan,
      reason: "blocked",
      remaining: 0,
      message: "SUBSCRIBE TO APPLY"
    });
  }

  applies.push({ hash, at: now });
  await db`
    INSERT INTO entitlements (wallet, plan, applies, updated_at)
    VALUES (${wallet}, ${plan}, ${JSON.stringify(applies)}::jsonb, NOW())
    ON CONFLICT (wallet)
    DO UPDATE SET applies = ${JSON.stringify(applies)}::jsonb, updated_at = NOW()
  `;
  return NextResponse.json({
    ok: true,
    plan,
    reason: "quota",
    remaining: Math.max(0, FREE_IMAGE_APPLIES - unique - 1)
  });
}
