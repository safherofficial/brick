import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import LikeButton from "@/components/gallery/LikeButton";
import { findCreation } from "@/lib/creations";
import { sql } from "@/lib/db";
import type { CreationSummary } from "@/lib/creationsApi";

async function getRealCreation(id: string): Promise<CreationSummary | null> {
  const url = process.env.POSTGRES_URL;
  if (!url) return null;
  try {
    const db = sql();
    const rows = await db`
      SELECT c.id, c.name, c.description, c.brick_count, c.likes_count,
             c.views_count, c.created_at, c.construction_data,
             u.username AS author
      FROM creations c
      LEFT JOIN users u ON u.id = c.user_id
      WHERE c.id = ${id} AND c.published = TRUE
      LIMIT 1
    `;
    const creation = rows[0] as unknown as CreationSummary | undefined;
    if (!creation) return null;
    await db`UPDATE creations SET views_count = views_count + 1 WHERE id = ${id}`;
    return creation;
  } catch {
    return null;
  }
}

export default async function CreationPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const real = await getRealCreation(id);
  const example = real ? null : findCreation(id);

  if (!real && !example) {
    return (
      <main>
        <header className="siteHeader">
          <Link href="/" className="brand">
            <span className="brandMark">◆</span> BRICK BUILDER
          </Link>
          <nav>
            <Link href="/build">BUILD</Link>
            <Link href="/gallery">GALLERY</Link>
            <button className="walletButton">CONNECT WALLET</button>
          </nav>
        </header>
        <section className="creationDetail">
          <p>Questa creazione non esiste o non è stata pubblicata.</p>
          <Link href="/gallery">← Torna alla gallery</Link>
        </section>
      </main>
    );
  }

  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand">
          <span className="brandMark">◆</span> BRICK BUILDER
        </Link>
        <nav>
          <Link href="/build">BUILD</Link>
          <Link href="/gallery">GALLERY</Link>
          <button className="walletButton">CONNECT WALLET</button>
        </nav>
      </header>
      <section className="creationDetail">
        <div>
          <div className="detailArtwork">
            {real ? (
              <VoxelThumb
                size={real.construction_data.size}
                voxels={real.construction_data.voxels}
                palette={real.construction_data.palette}
                interactive
              />
            ) : (
              <ShowcaseThumb creation={example!} interactive />
            )}
          </div>
        </div>
        <aside className="detailPanel">
          <p className="eyebrow">{real ? "CREAZIONE" : "ESEMPIO"}</p>
          <h1>{real ? real.name : example!.title}</h1>
          <p className="creator">
            {real ? (
              <>by <b>{real.author ?? "anonimo"}</b></>
            ) : (
              "esempio curato, non una creazione della community"
            )}
          </p>
          <p className="description">
            {real ? real.description ?? "" : example!.description}
          </p>
          <div className="detailStats">
            {real && (
              <>
                <span>
                  ♥ {real.likes_count}
                  <small>LIKES</small>
                </span>
                <span>
                  ◉ {real.views_count}
                  <small>VIEWS</small>
                </span>
                <span>
                  ◆ {real.brick_count}
                  <small>VOXEL</small>
                </span>
              </>
            )}
          </div>
          {real && <LikeButton creationId={real.id} initialLikes={real.likes_count} />}
        </aside>
      </section>
    </main>
  );
}
