import { setLocalPlan } from "@/lib/entitlement";

export const MONTHLY_SOL = 0.05;
const TREASURY = process.env.NEXT_PUBLIC_SOLANA_TREASURY ?? "";
const RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";

type Phantom = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string }>;
};

function getPhantom(): Phantom {
  const provider = (window as Window & { solana?: Phantom }).solana;
  if (!provider?.isPhantom) throw new Error("Install Phantom");
  return provider;
}

export async function subscribeWithSol() {
  if (!TREASURY) throw new Error("Missing treasury");
  const web3 = await import("@solana/web3.js");
  const phantom = getPhantom();
  const session = await phantom.connect();
  const from = new web3.PublicKey(session.publicKey.toString());
  const to = new web3.PublicKey(TREASURY);
  const connection = new web3.Connection(RPC, "confirmed");
  const lamports = Math.round(MONTHLY_SOL * web3.LAMPORTS_PER_SOL);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new web3.Transaction({
    feePayer: from,
    blockhash,
    lastValidBlockHeight
  }).add(
    web3.SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports
    })
  );
  const signed = await phantom.signAndSendTransaction(tx);
  await connection.confirmTransaction(
    { signature: signed.signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  setLocalPlan("monthly");
  return { signature: signed.signature, wallet: from.toBase58() };
}
