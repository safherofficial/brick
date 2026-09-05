import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { findCreation } from "@/lib/creations";

const creations = [
  {
    title: "Cyberpunk Megacity",
    author: "@future_builder",
    slug: "cyberpunk-megacity",
    likes: "8.9K",
    views: "41.7K"
  },
  {
    title: "Orbital Command Station",
    author: "@orbitalworks",
    slug: "orbital-command-station",
    likes: "7.4K",
    views: "36.8K"
  },
  {
    title: "Imperial Japanese Castle",
    author: "@heritage_builder",
    slug: "imperial-japanese-castle",
    likes: "10.2K",
    views: "52.4K"
  },
  {
    title: "Steampunk Airship",
    author: "@clockworklab",
    slug: "steampunk-airship",
    likes: "6.8K",
    views: "31.5K"
  }
];

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
          {creations.map(
            ({ title, author, slug, likes, views }) => {
              const creation = findCreation(slug);

              return (
                <article
                  className="creationCard"
                  key={title}
                >
                  <Link
                    href={
                      creation
                        ? `/creation/${creation.slug}`
                        : "/gallery"
                    }
                  >
                    <div className="cardArtwork">
                      {creation && (
                        <ShowcaseThumb
                          creation={creation}
                        />
                      )}
                    </div>
                  </Link>

                  <div className="cardMeta">
                    <div>
                      <h3>{title}</h3>
                      <p>{author}</p>
                    </div>

                    <span>
                      ♥ {likes} · ◉ {views}
                    </span>
                  </div>
                </article>
              );
            }
          )}
        </div>
      </section>
    </main>
  );
}
