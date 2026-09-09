import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: Request) {
  const body = (await req.json()) as { wallet?: string; signature?: string };
  const wallet = body.wallet?.trim();
  const signature = body.signature?.trim();
  if (!wallet || !signature) {
    return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  }
  await sql()`
    INSERT INTO entitlements (wallet, plan, signature, updated_at)
    VALUES (${wallet}, 'monthly', ${signature}, NOW())
    ON CONFLICT (wallet)
    DO UPDATE SET plan = 'monthly', signature = EXCLUDED.signature, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true, plan: "monthly" });
}
