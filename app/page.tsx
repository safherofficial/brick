import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import { creations as curatedExamples } from "@/lib/creations";
import { sql } from "@/lib/db";
import type { CreationSummary } from "@/lib/creationsApi";

async function getCommunityData() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    return { creations: [] as CreationSummary[], totals: null };
  }
  try {
    const db = sql();
    const [rows, totalsRows] = await Promise.all([
      db`
        SELECT c.id, c.name, c.description, c.brick_count, c.likes_count,
               c.views_count, c.created_at, c.construction_data,
               u.username AS author
        FROM creations c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.published = TRUE
        ORDER BY c.likes_count DESC, c.created_at DESC
        LIMIT 4
      `,
      db`
        SELECT
          COUNT(*)::int AS creations,
          COUNT(DISTINCT user_id)::int AS creators,
          COALESCE(SUM(likes_count), 0)::int AS likes,
          COALESCE(SUM(views_count), 0)::int AS views
        FROM creations
        WHERE published = TRUE
      `
    ]);
    return {
      creations: rows as unknown as CreationSummary[],
      totals: totalsRows[0] as
        | { creations: number; creators: number; likes: number; views: number }
        | undefined
    };
  } catch {
    // DB non raggiungibile: la home resta comunque utilizzabile.
    return { creations: [] as CreationSummary[], totals: null };
  }
}

export default async function Home() {
  const { creations: featured, totals } = await getCommunityData();

  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand">
          <span className="brandMark">◆</span> BRICK BUILDER
        </Link>

        <nav>
          <Link href="/build">BUILD</Link>
          <Link href="/gallery">GALLERY</Link>
          <a href="#about">ABOUT</a>
          <button className="walletButton">CONNECT WALLET</button>
        </nav>
      </header>

      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">A NEW KIND OF CREATIVE GAME</p>

          <h1>
            BUILD <span>ANYTHING.</span>
            <br />
            SHARE <span>EVERYTHING.</span>
          </h1>

          <p className="heroText">
            Create your own masterpiece, one brick at a time. Build freely,
            capture your favorite view and show it to the world.
          </p>

          <div className="heroActions">
            <Link className="primaryButton" href="/build">
              START BUILDING →
            </Link>

            <Link className="secondaryButton" href="/gallery">
              EXPLORE GALLERY
            </Link>
          </div>

          {totals && totals.creations > 0 && (
            <div className="stats">
              <div>
                <strong>{totals.creations}</strong>
                <span>CREATIONS</span>
              </div>
              <div>
                <strong>{totals.creators}</strong>
                <span>CREATORS</span>
              </div>
              <div>
                <strong>{totals.likes}</strong>
                <span>LIKES</span>
              </div>
              <div>
                <strong>{totals.views}</strong>
                <span>VIEWS</span>
              </div>
            </div>
          )}
        </div>

        <div className="heroArtwork">
          <div className="floatingBrick b1">◆</div>
          <div className="floatingBrick b2">◆</div>
          <div className="floatingBrick b3">◆</div>

          <div className="island">
            <div className="tree treeA">🌳</div>
            <div className="house">🏠</div>
            <div className="tree treeB">🌳</div>
            <div className="waterfall" />
          </div>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="showcase">
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">DALLA COMMUNITY</p>
              <h2>CREAZIONI PUBBLICATE</h2>
            </div>
            <Link href="/gallery" className="textLink">
              VIEW ALL →
            </Link>
          </div>

          <div className="creationGrid">
            {featured.map((creation) => (
              <Link
                key={creation.id}
                href={`/creation/${creation.id}`}
                className="creationCard"
              >
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
        </section>
      )}

      <section className="showcase" id="about">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">ESEMPI</p>
            <h2>COSA PUOI COSTRUIRE</h2>
          </div>
        </div>

        <div className="creationGrid">
          {curatedExamples.slice(-4).map((creation) => (
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
    </main>
  );
}
