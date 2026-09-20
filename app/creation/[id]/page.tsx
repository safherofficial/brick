import Link from "next/link";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import LikeButton from "@/components/gallery/LikeButton";
import { sql } from "@/lib/db";
import type { CreationSummary } from "@/lib/creationsApi";

async function getPublishedCreation(id: string): Promise<CreationSummary | null> {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

export default async function CreationPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const creation = await getPublishedCreation(id);

  if (!creation) {
    return (
      <main className="proCreationPage">
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
            <Link href="/gallery">GALLERY</Link>
            <Link href="/build" className="proNavCta">OPEN BUILDER</Link>
          </nav>
        </header>

        <section className="proCreationEmpty">
          <span className="proSectionNo">ASSET NOT AVAILABLE</span>
          <h1>This creation is not published.</h1>
          <p>The asset may have been removed or the link may be invalid. Only real published Builder creations are available here.</p>
          <div className="proCreationActions">
            <Link href="/gallery" className="proButton proButtonGhost">BACK TO GALLERY</Link>
            <Link href="/build" className="proButton proButtonPrimary">OPEN BUILDER <b>↗</b></Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="proCreationPage">
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
          <Link href="/gallery">GALLERY</Link>
          <Link href="/build" className="proNavCta">OPEN BUILDER</Link>
        </nav>
      </header>

      <section className="proCreationHero">
        <div className="proCreationArtwork">
          <div className="proCreationArtworkChrome">
            <span>LIVE PUBLISHED ASSET</span>
            <span><i /> WEBGL</span>
          </div>
          <div className="proCreationCanvas">
            <VoxelThumb
              size={creation.construction_data.size}
              voxels={creation.construction_data.voxels}
              palette={creation.construction_data.palette}
              interactive
            />
          </div>
          <div className="proCreationArtworkFooter">
            <span>BUILT WITH BRICK</span>
            <span>2D / 2.5D GAME ASSET</span>
          </div>
        </div>

        <aside className="proCreationInfo">
          <div>
            <span className="proSectionNo">PUBLISHED CREATION</span>
            <h1>{creation.name}</h1>
            <p className="proCreationAuthor">
              by <strong>{creation.author ?? "Anonymous creator"}</strong>
            </p>
            <p className="proCreationDescription">
              {creation.description?.trim() || "Published from the Brick Builder."}
            </p>
          </div>

          <div className="proCreationStats">
            <div><strong>{creation.brick_count.toLocaleString()}</strong><span>VOXELS</span></div>
            <div><strong>{creation.likes_count.toLocaleString()}</strong><span>LIKES</span></div>
            <div><strong>{creation.views_count.toLocaleString()}</strong><span>VIEWS</span></div>
          </div>

          <div className="proCreationMeta">
            <span>PUBLISHED</span>
            <strong>{formatDate(creation.created_at)}</strong>
          </div>

          <div className="proCreationActions">
            <LikeButton creationId={creation.id} initialLikes={creation.likes_count} />
            <Link href="/build" className="proButton proButtonPrimary">CREATE YOUR OWN <b>↗</b></Link>
          </div>

          <div className="proCreationNotice">
            <span>PRIVATE / COMMERCIAL USE</span>
            <p>Use Brick to create assets for your own games or for private client commissions and asset delivery.</p>
          </div>
        </aside>
      </section>

      <footer className="proFooter">
        <div><span className="proBrandMark">◆</span> BRICK</div>
        <span>REAL USER CREATION · 2D / 2.5D · SOLANA</span>
        <div><Link href="/gallery">Gallery</Link><Link href="/build">Builder</Link></div>
      </footer>
    </main>
  );
}
