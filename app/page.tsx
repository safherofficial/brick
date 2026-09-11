"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import { creations as curatedExamples } from "@/lib/creations";
import { fetchCreations, type CreationSummary } from "@/lib/creationsApi";

type Sort = "latest" | "liked";

export default function GalleryPage() {
  const [sort, setSort] = useState<Sort>("latest");
  const [query, setQuery] = useState("");
  const [creations, setCreations] = useState<CreationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCreations(sort).then((data) => {
      if (!cancelled) {
        setCreations(data);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return creations;
    return creations.filter((c) => c.name.toLowerCase().includes(q));
  }, [creations, query]);

  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand">
          <span className="brandMark">◆</span> BRICK BUILDER
        </Link>
        <nav>
          <Link href="/build">BUILD</Link>
          <Link className="activeNav" href="/gallery">
            GALLERY
          </Link>
          <a href="/#about">ABOUT</a>
          <button className="walletButton">CONNECT WALLET</button>
        </nav>
      </header>

      <section className="galleryPage">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">THE SHOWCASE</p>
            <h1>EXPLORE CREATIONS</h1>
          </div>
          <Link href="/build" className="primaryButton">
            CREATE YOURS →
          </Link>
        </div>

        <div className="filterBar">
          <button className={sort === "liked" ? "filterActive" : ""} onClick={() => setSort("liked")}>
            MOST LIKED
          </button>
          <button className={sort === "latest" ? "filterActive" : ""} onClick={() => setSort("latest")}>
            LATEST
          </button>
          <span className="filterSpacer" />
          <input
            placeholder="Search creations..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="creationGrid large">
          {filtered.map((creation) => (
            <Link key={creation.id} href={`/creation/${creation.id}`} className="creationCard">
              <div className="cardArtwork">
                <VoxelThumb
                  size={creation.construction_data.size}
                  voxels={creation.construction_data.voxels}
                  palette={creation.construction_data.palette}
                />
              </div>
              <div className="cardMeta">
                <div>
                  <h3>{creation.name}</h3>
                  <p>{creation.author ?? "anonimo"}</p>
                </div>
                <span>♥ {creation.likes_count}</span>
              </div>
            </Link>
          ))}
        </div>

        {!loading && filtered.length === 0 && (
          <p className="emptyState">
            Nessuna creazione pubblicata ancora — sii il primo a <Link href="/build">pubblicarne una</Link>.
          </p>
        )}
      </section>

      <section className="showcase" id="examples">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">ESEMPI</p>
            <h2>COSA PUOI COSTRUIRE</h2>
          </div>
        </div>
        <div className="creationGrid">
          {curatedExamples.map((creation) => (
            <article className="creationCard" key={creation.slug}>
              <div className="cardArtwork">
                <ShowcaseThumb creation={creation} />
              </div>
              <div className="cardMeta">
                <div>
                  <h3>{creation.title}</h3>
                  <p>esempio</p>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {showTop && (
        <button
          className="scrollTop"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑
        </button>
      )}
    </main>
  );
}
