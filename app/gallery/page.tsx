import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { creations } from "@/lib/creations";

export default function GalleryPage() {
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
          <button className="walletButton">
            CONNECT WALLET
          </button>
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
          <button className="filterActive">TRENDING</button>
          <button>LATEST</button>
          <button>MOST LIKED</button>

          <span className="filterSpacer" />

          <input placeholder="Search creations..." />

          <button>ALL CATEGORIES</button>
        </div>

        <div className="creationGrid large">
          {creations.map((creation) => (
            <article
              className="creationCard"
              key={creation.slug}
            >
              <Link href={`/creation/${creation.slug}`}>
                <div className="cardArtwork">
                  <ShowcaseThumb creation={creation} />
                </div>
              </Link>

              <div className="cardMeta">
                <div>
                  <h3>{creation.title}</h3>
                  <p>{creation.author}</p>
                </div>

                <span>
                  ♥ {creation.likes} · ◉ {creation.views}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
