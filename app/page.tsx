import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { creations as catalog, findCreation } from "@/lib/creations";

const featured = [
  "solana-emblem",
  "world-orb",
  "cyberpunk-megacity",
  "imperial-japanese-castle"
];

export default function Home() {
  const hero = findCreation("solana-emblem");

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

          <div className="stats">
            <div>
              <strong>12.5K+</strong>
              <span>CREATIONS</span>
            </div>
            <div>
              <strong>8.2K+</strong>
              <span>CREATORS</span>
            </div>
            <div>
              <strong>95.7K+</strong>
              <span>LIKES</span>
            </div>
            <div>
              <strong>2.1M+</strong>
              <span>VIEWS</span>
            </div>
          </div>
        </div>

        <div className="heroArtwork">
          {hero && <ShowcaseThumb creation={hero} />}
        </div>
      </section>

      <section className="showcase" id="about">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">COMMUNITY</p>
            <h2>EXPLORE CREATIONS</h2>
          </div>
          <Link href="/gallery" className="textLink">
            VIEW ALL →
          </Link>
        </div>

        <div className="creationGrid">
          {featured.map((slug) => {
            const creation = findCreation(slug);
            if (!creation) return null;
            return (
              <article className="creationCard" key={creation.slug}>
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
                  <span>♥ {creation.likes}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
