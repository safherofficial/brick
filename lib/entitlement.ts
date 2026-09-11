import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const TREASURY = "4GKjWC5gtFEYDsEH4y5dKuHLLMCBduoGYUPc6yhKq19p";
const MONTHLY_SOL = 0.08;
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

export async function POST(req: Request) {
  const url = process.env.POSTGRES_URL;
  if (!url) return NextResponse.json({ ok: false, error: "NO_DB" }, { status: 500 });

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

  const keys =
    "accountKeys" in tx.transaction.message
      ? tx.transaction.message.accountKeys.map((k) =>
          typeof k === "string" ? k : "pubkey" in k ? k.pubkey.toString() : String(k)
        )
      : [];

  const fromOk = keys.includes(wallet);
  const toOk = keys.includes(TREASURY);
  if (!fromOk || !toOk) {
    return NextResponse.json({ ok: false, error: "TX_MISMATCH" }, { status: 400 });
  }

  const treasuryIdx = keys.indexOf(TREASURY);
  const pre = tx.meta?.preBalances?.[treasuryIdx] ?? 0;
  const post = tx.meta?.postBalances?.[treasuryIdx] ?? 0;
  const received = post - pre;
  if (received < Math.round(MONTHLY_SOL * LAMPORTS_PER_SOL)) {
    return NextResponse.json({ ok: false, error: "AMOUNT" }, { status: 400 });
  }

  const db = neon(url);
  await db`
    INSERT INTO entitlements (wallet, plan, signature, updated_at)
    VALUES (${wallet}, 'monthly', ${signature}, NOW())
    ON CONFLICT (wallet)
    DO UPDATE SET plan = 'monthly', signature = EXCLUDED.signature, updated_at = NOW()
  `;
  return NextResponse.json({ ok: true, plan: "monthly" });
}
