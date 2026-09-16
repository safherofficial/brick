"use client";

import { useState } from "react";
import { connectWallet } from "@/lib/wallet";
import { toggleLike } from "@/lib/creationsApi";

export default function LikeButton({
  creationId,
  initialLikes
}: {
  creationId: string;
  initialLikes: number;
}) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const wallet = await connectWallet();
      const result = await toggleLike(creationId, wallet);
      setLiked(Boolean(result.liked));
      setLikes(result.likes_count ?? likes);
    } catch {
      setError("Collega Phantom per mettere like.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="primaryButton" onClick={handleClick} disabled={busy}>
        ♥ {liked ? "LIKED" : "LIKE"} · {likes}
      </button>
      {error && <p className="errorText">{error}</p>}
    </div>
  );
}
