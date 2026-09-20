"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import type { CreationSummary } from "@/lib/creationsApi";

type SortMode = "latest" | "liked";

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function GalleryPage() {
  const [creations, setCreations] = useState<CreationSummary[]>([]);
  const [sort, setSort] = useState<SortMode>("latest");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/creations?sort=${sort}&limit=60`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load published assets (${response.status}).`);
        const data = await response.json();
        return Array.isArray(data?.creations) ? (data.creations as CreationSummary[]) : [];
      })
      .then((items) => {
        if (!cancelled) setCreations(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load published assets.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sort]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return creations;
    return creations.filter((creation) => {
      const haystack = [creation.name, creation.description, creation.author].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalized);
    });
  }, [creations, query]);

  return (
    <main className="proGalleryPage">
      <header className="proHeader">
        <Link href="/" className="proBrand" aria-label="Home">
          <span className="proBrandMark">◆</span>
          <span>BRICK</span>
        </Link>
        <nav className="proNav">
          <Link href="/#why">WHY</Link>
          <Link href="/#assets">ASSETS</Link>
          <Link href="/#clients">FOR CLIENTS</Link>
          <Link href="/#pricing">COST</Link>
          <Link href="/gallery" className="proGalleryActive">GALLERY</Link>
          <Link href="/build" className="proNavCta">OPEN BUILDER</Link>
        </nav>
      </header>

      <section className="proGalleryHero">
        <div>
          <span className="proSectionNo">06 / PUBLISHED ASSETS</span>
          <h1>Real creations.<br /><span>Published by users.</span></h1>
          <p>Every item here comes from the Builder publish flow. No demo models, no static placeholders.</p>
        </div>
        <Link href="/build" className="proButton proButtonPrimary">CREATE &amp; PUBLISH <b>↗</b></Link>
      </section>

      <section className="proGallerySection">
        <div className="proGalleryToolbar">
          <div className="proGallerySort" role="tablist" aria-label="Gallery sort">
            <button className={sort === "latest" ? "active" : ""} onClick={() => setSort("latest")}>LATEST</button>
            <button className={sort === "liked" ? "active" : ""} onClick={() => setSort("liked")}>MOST LIKED</button>
          </div>
          <div className="proGallerySearch">
            <span>SEARCH</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Weapons, props, creators..." aria-label="Search published assets" />
          </div>
        </div>

        {error ? (
          <div className="proGalleryMessage proGalleryError">{error}</div>
        ) : loading ? (
          <div className="proGalleryMessage">Loading published assets…</div>
        ) : filtered.length === 0 ? (
          <div className="proGalleryMessage">
            <strong>{query ? "No matching published assets." : "No published assets yet."}</strong>
            <span>{query ? "Try another search." : "Build an asset, press Publish in the Builder, and it will appear here."}</span>
          </div>
        ) : (
          <div className="proGalleryGrid">
            {filtered.map((creation) => (
              <article className="proGalleryCard" key={creation.id}>
                <Link href={`/creation/${creation.id}`} className="proGalleryArtwork" aria-label={`Open ${creation.name}`}>
                  <VoxelThumb
                    size={creation.construction_data.size}
                    voxels={creation.construction_data.voxels}
                    palette={creation.construction_data.palette}
                  />
                  <span className="proGalleryOpen">OPEN ↗</span>
                </Link>
                <div className="proGalleryCardMeta">
                  <div>
                    <span className="proGalleryMetaType">PUBLISHED ASSET</span>
                    <h2>{creation.name}</h2>
                    <p>{creation.author || "Anonymous creator"}</p>
                  </div>
                  <div className="proGalleryMetrics">
                    <span>◈ {formatCount(creation.brick_count)} VOXELS</span>
                    <span>♥ {formatCount(creation.likes_count)}</span>
                    <span>◉ {formatCount(creation.views_count)}</span>
                  </div>
                </div>
                <div className="proGalleryCardFooter">
                  <span>{formatDate(creation.created_at)}</span>
                  <Link href={`/creation/${creation.id}`}>VIEW ASSET ↗</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="proFooter">
        <div><span className="proBrandMark">◆</span> BRICK</div>
        <span>REAL USER CREATIONS · 2D / 2.5D · SOLANA</span>
        <div><Link href="/">Home</Link><Link href="/build">Builder</Link></div>
      </footer>
    </main>
  );
}
