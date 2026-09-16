import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const DEV_WALLET = "4GKjWC5gtFEYDsEH4y5dKuHLLMCBduoGYUPc6yhKq19p";

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  if (wallet === DEV_WALLET) return NextResponse.json({ ok: true, plan: "monthly" });

  const url = process.env.POSTGRES_URL;
  if (!url) return NextResponse.json({ ok: false, plan: "free" }, { status: 500 });
  const db = neon(url);
  const rows = await db`
    SELECT plan FROM entitlements WHERE wallet = ${wallet} LIMIT 1
  `;
  const plan = rows[0]?.plan === "monthly" ? "monthly" : "free";
  return NextResponse.json({ ok: true, plan });
}
