import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { findCreation } from "@/lib/creations";

const creations = [
  { title: "Cyberpunk City", author: "@pixel_master", art: "🌃", likes: "2.4K", views: "12.6K" },
  { title: "Floating Island", author: "@sky_brick", art: "🏝️", likes: "3.1K", views: "18.2K" },
  { title: "Samurai Mech", author: "@mech_legend", slug: "pixel-robot", likes: "1.8K", views: "9.3K" },
  { title: "Cute Shiba", author: "@voxel_pets", art: "🐕", likes: "2.2K", views: "11.7K" },
  { title: "Medieval Castle", author: "@brick_king", slug: "medieval-castle", likes: "4.6K", views: "22.1K" },
  { title: "Dragon's Lair", author: "@dragon_brick", art: "🐉", likes: "5.2K", views: "23.4K" },
  { title: "Cozy Cabin", author: "@forest_builder", slug: "cozy-cabin", likes: "1.6K", views: "7.8K" },
  { title: "Space Rocket", author: "@galactic", slug: "space-rocket", likes: "2.9K", views: "15.3K" }
];

export default function GalleryPage() {
  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand"><span className="brandMark">◆</span> BRICK BUILDER</Link>
        <nav>
          <Link href="/build">BUILD</Link>
          <Link className="activeNav" href="/gallery">GALLERY</Link>
          <a href="/#about">ABOUT</a>
          <button className="walletButton">CONNECT WALLET</button>
        </nav>
      </header>
      <section className="galleryPage">
        <div className="sectionHeading">
          <div><p className="eyebrow">THE SHOWCASE</p><h1>EXPLORE CREATIONS</h1></div>
          <Link href="/build" className="primaryButton">CREATE YOURS →</Link>
        </div>
        <div className="filterBar">
          <button className="filterActive">TRENDING</button><button>LATEST</button><button>MOST LIKED</button>
          <span className="filterSpacer" />
          <input placeholder="Search creations..." />
          <button>ALL CATEGORIES</button>
        </div>
        <div className="creationGrid large">
          {creations.map(({ title, author, art, slug, likes, views }) => {
            const creation = slug ? findCreation(slug) : null;
            return (
              <article className="creationCard" key={title}>
                <Link href={creation ? `/creation/${creation.slug}` : "/creation/demo"}>
                  <div className="cardArtwork">{creation ? <ShowcaseThumb creation={creation} /> : art}</div>
                </Link>
                <div className="cardMeta">
                  <div><h3>{title}</h3><p>{author}</p></div>
                  <span>♥ {likes} · ◉ {views}</span>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
