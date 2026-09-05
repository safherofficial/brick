import Link from "next/link";
import ShowcaseThumb from "@/components/showcase/ShowcaseThumb";
import { findCreation } from "@/lib/creations";

export default async function CreationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creation = findCreation(id);

  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand"><span className="brandMark">◆</span> BRICK BUILDER</Link>
        <nav><Link href="/build">BUILD</Link><Link href="/gallery">GALLERY</Link><button className="walletButton">CONNECT WALLET</button></nav>
      </header>
      <section className="creationDetail">
        <div>
          <div className="detailArtwork">{creation ? <ShowcaseThumb creation={creation} interactive /> : "🏰"}</div>
          <div className="previewStrip"><span>🏰</span><span>🏰</span><span>🏰</span><span>+6</span></div>
        </div>
        <aside className="detailPanel">
          <p className="eyebrow">CREATION</p>
          <h1>{creation?.title ?? "Medieval Castle"}</h1>
          <p className="creator">by <b>{creation?.author ?? "@brick_king"}</b></p>
          <p className="description">{creation?.description ?? "A mighty castle built one brick at a time."}</p>
          <div className="detailStats">
            <span>♥ {creation?.likes ?? "4.6K"}<small>LIKES</small></span>
            <span>◉ {creation?.views ?? "22.1K"}<small>VIEWS</small></span>
            <span>◆ {creation?.bricks.length ?? 1200}<small>BRICKS</small></span>
          </div>
          <div className="detailActions"><button className="primaryButton">♥ LIKE</button><button className="secondaryButton">↗ SHARE</button></div>
        </aside>
      </section>
    </main>
  );
}
