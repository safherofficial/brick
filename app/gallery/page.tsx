import Link from "next/link";

const creations = [
  ["Cyberpunk City", "@pixel_master", "🌃", "2.4K", "12.6K"],
  ["Floating Island", "@sky_brick", "🏝️", "3.1K", "18.2K"],
  ["Samurai Mech", "@mech_legend", "🤖", "1.8K", "9.3K"],
  ["Cute Shiba", "@voxel_pets", "🐕", "2.2K", "11.7K"],
  ["Medieval Castle", "@brick_king", "🏰", "4.6K", "22.1K"],
  ["Dragon's Lair", "@dragon_brick", "🐉", "5.2K", "23.4K"],
  ["Cozy Cabin", "@forest_builder", "🏡", "1.6K", "7.8K"],
  ["Space Station", "@galactic", "🚀", "2.9K", "15.3K"]
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
          {creations.map(([title, creator, art, likes, views]) => (
            <article className="creationCard" key={title}>
              <Link href="/creation/demo"><div className="cardArtwork">{art}</div></Link>
              <div className="cardMeta">
                <div><h3>{title}</h3><p>{creator}</p></div>
                <span>♥ {likes} · ◉ {views}</span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}