import { NextResponse } from "next/server";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { sql } from "@/lib/db";

const TREASURY = "4GKjWC5gtFEYDsEH4y5dKuHLLMCBduoGYUPc6yhKq19p";
const MONTHLY_SOL = 0.08;
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

function keyString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "pubkey" in value) {
    const pub = (value as { pubkey: { toString(): string } | string }).pubkey;
    return typeof pub === "string" ? pub : pub.toString();
  }
  if (value && typeof value === "object" && "toString" in value) {
    return String((value as { toString(): string }).toString());
  }
  return "";
}

export async function POST(req: Request) {
  const body = (await req.json()) as { wallet?: string; signature?: string };
  const wallet = body.wallet?.trim();
  const signature = body.signature?.trim();
  if (!wallet || !signature) {
    return NextResponse.json({ ok: false, error: "INVALID" }, { status: 400 });
  }

  const connection = new Connection(RPC, "confirmed");
  const tx = await connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0
  });
  if (!tx || tx.meta?.err) {
    return NextResponse.json({ ok: false, error: "TX_NOT_FOUND" }, { status: 400 });
  }

  const keys = tx.transaction.message.accountKeys.map((entry) => keyString(entry));
  if (!keys.includes(wallet) || !keys.includes(TREASURY)) {
    return NextResponse.json({ ok: false, error: "TX_MISMATCH" }, { status: 400 });
  }

  const treasuryIdx = keys.indexOf(TREASURY);
  const received = (tx.meta?.postBalances?.[treasuryIdx] ?? 0) - (tx.meta?.preBalances?.[treasuryIdx] ?? 0);
  if (received < Math.round(MONTHLY_SOL * LAMPORTS_PER_SOL)) {
    return NextResponse.json({ ok: false, error: "AMOUNT" }, { status: 400 });
  }

  const db = sql();
  await db`
    INSERT INTO entitlements (wallet, plan, signature, updated_at)
    VALUES (${wallet}, 'monthly', ${signature}, NOW())
    ON CONFLICT (wallet)
    DO UPDATE SET plan = 'monthly', signature = EXCLUDED.signature, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true, plan: "monthly" });
}
