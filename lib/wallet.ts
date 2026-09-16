// Connessione al wallet Phantom per sola identità (nessun pagamento).
// lib/solanaCheckout.ts ha una propria copia interna di getPhantom() usata
// per il flusso di pagamento: la teniamo separata di proposito per non
// toccare quel percorso già in produzione.

type Phantom = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
};

export function hasPhantom() {
  if (typeof window === "undefined") return false;
  return Boolean((window as Window & { solana?: Phantom }).solana?.isPhantom);
}

export async function connectWallet(): Promise<string> {
  const provider = (window as Window & { solana?: Phantom }).solana;
  if (!provider?.isPhantom) {
    throw new Error("Install Phantom per collegare il wallet.");
  }
  const session = await provider.connect();
  return session.publicKey.toString();
}

export async function connectWalletIfTrusted(): Promise<string | null> {
  const provider = (window as Window & { solana?: Phantom }).solana;
  if (!provider?.isPhantom) return null;
  try {
    const session = await provider.connect({ onlyIfTrusted: true });
    return session.publicKey.toString();
  } catch {
    return null;
  }
}
