import Link from "next/link";

export default function CreationPage() {
  return (
    <main>
      <header className="siteHeader">
        <Link href="/" className="brand"><span className="brandMark">◆</span> BRICK BUILDER</Link>
        <nav><Link href="/build">BUILD</Link><Link href="/gallery">GALLERY</Link><button className="walletButton">CONNECT WALLET</button></nav>
      </header>
      <section className="creationDetail">
        <div>
          <div className="detailArtwork">🏰</div>
          <div className="previewStrip"><span>🏰</span><span>🏰</span><span>🏰</span><span>+6</span></div>
        </div>
        <aside className="detailPanel">
          <p className="eyebrow">CREATION</p>
          <h1>Medieval Castle</h1>
          <p className="creator">by <b>@brick_king</b></p>
          <p className="description">A mighty castle built one brick at a time.</p>
          <div className="detailStats">
            <span>♥ 4.6K<small>LIKES</small></span><span>◉ 22.1K<small>VIEWS</small></span><span>◆ 1.2K<small>BRICKS</small></span>
          </div>
          <div className="detailActions"><button className="primaryButton">♥ LIKE</button><button className="secondaryButton">↗ SHARE</button></div>
        </aside>
      </section>
    </main>
  );
}
