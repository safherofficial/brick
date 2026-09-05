import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { findCreation } from "@/lib/creations";

const creations = [
  {
    title: "Cyberpunk Megacity",
    author: "@future_builder",
    slug: "cyberpunk-megacity",
    likes: "8.9K"
  },
  {
    title: "Orbital Command Station",
    author: "@orbitalworks",
    slug: "orbital-command-station",
    likes: "7.4K"
  },
  {
    title: "Imperial Japanese Castle",
    author: "@heritage_builder",
    slug: "imperial-japanese-castle",
    likes: "10.2K"
  },
  {
    title: "Steampunk Airship",
    author: "@clockworklab",
    slug: "steampunk-airship",
    likes: "6.8K"
  }
];

export default function Home() {
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
          {creations.map(({ title, author, slug, likes }) => {
            const creation = findCreation(slug);

            return (
              <article className="creationCard" key={title}>
                <div className="cardArtwork">
                  {creation && (
                    <ShowcaseThumb creation={creation} />
                  )}
                </div>

                <div className="cardMeta">
                  <div>
                    <h3>{title}</h3>
                    <p>{author}</p>
                  </div>

                  <span>♥ {likes}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
