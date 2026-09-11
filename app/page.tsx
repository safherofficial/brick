"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const STEPS = [
  { n: "01", t: "Drop a PNG", d: "Open a photo. Preview is free. Nothing is written until you apply." },
  { n: "02", t: "Apply + FIT", d: "Voxels land on the ground. Volume snaps to 32 / 64 / 128 / 256." },
  { n: "03", t: "Export once", d: "GLB, VOX or OBJ ZIP. Y-up. Bottom-center pivot. 0.1m per voxel." }
];

const SAVES = [
  { k: "0.08 SOL", v: "Monthly", h: "About $8. Meshy Pro starts at $16–20." },
  { k: "5", v: "Free applies", h: "Same image stays free for 24 hours." },
  { k: "3", v: "Engine files", h: "GLB · VOX · OBJ. Not a preview render." },
  { k: "1", v: "Click path", h: "Open → Apply → Export. No DCC roundtrip." }
];

export default function HomePage() {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 280);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="home">
      <header className="siteHeader homeHeader">
        <Link href="/" className="brand">
          <span className="brandMark">◆</span> VOXEL
        </Link>
        <nav>
          <Link href="/build">BUILD</Link>
          <Link href="/gallery">GALLERY</Link>
          <a href="#pricing">PRICING</a>
          <Link href="/build" className="primaryButton">
            OPEN BUILDER
          </Link>
        </nav>
      </header>

      <section className="homeHero">
        <div className="homeHeroCopy">
          <p className="eyebrow">PNG → GAME-READY VOXELS</p>
          <h1>
            Ship assets
            <span> without the $20 tools.</span>
          </h1>
          <p className="heroText">
            One image in. A file an engine can load out. Preview free. Apply counted.
            Built for props, pickups, weapons and blocks — not moodboards.
          </p>
          <div className="heroActions">
            <Link href="/build" className="primaryButton">
              START FREE →
            </Link>
            <a href="#flow" className="secondaryButton">
              SEE THE FLOW
            </a>
          </div>
          <div className="homePills">
            <span>GLB</span>
            <span>VOX</span>
            <span>OBJ ZIP</span>
            <span>Phantom · SOL</span>
          </div>
        </div>
        <div className="homeHeroArt" aria-hidden>
          <div className="homeStage">
            <div className="homeShot homeShotIn">PNG</div>
            <div className="homeArrow">→</div>
            <div className="homeShot homeShotOut">GLB</div>
          </div>
          <p className="homeStageCaption">Open · Apply · Export</p>
        </div>
      </section>

      <section className="homeStrip">
        {SAVES.map((item) => (
          <div key={item.v}>
            <strong>{item.k}</strong>
            <em>{item.v}</em>
            <span>{item.h}</span>
          </div>
        ))}
      </section>

      <section className="homeFlow" id="flow">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">PIPELINE</p>
            <h2>Three steps. Then you ship.</h2>
          </div>
        </div>
        <div className="homeSteps">
          {STEPS.map((step) => (
            <article key={step.n}>
              <small>{step.n}</small>
              <h3>{step.t}</h3>
              <p>{step.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="homeCompare" id="pricing">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">WHY THIS EXISTS</p>
            <h2>Stop renting a mesh studio for a crate.</h2>
          </div>
        </div>
        <div className="homeCompareGrid">
          <article>
            <p className="eyebrow">OTHER TOOLS</p>
            <h3>$16–20 / mo</h3>
            <ul>
              <li>Credits that vanish</li>
              <li>Pretty mesh, weak game pivot</li>
              <li>Queue behind Pro seats</li>
              <li>Export gated on the paid tier</li>
            </ul>
          </article>
          <article className="homeCompareOn">
            <p className="eyebrow">HERE</p>
            <h3>0.08 SOL / mo</h3>
            <ul>
              <li>5 unique applies free</li>
              <li>Same photo free for 24h</li>
              <li>Export always on: GLB / VOX / OBJ</li>
              <li>Y-up, ground pivot, 0.1m / voxel</li>
            </ul>
            <Link href="/build" className="primaryButton">
              BUILD A PROP NOW
            </Link>
          </article>
        </div>
      </section>

      <footer className="homeFoot">
        <span>VOXEL · game-ready from a PNG</span>
        <Link href="/build">Open builder</Link>
      </footer>

      {showTop && (
        <button
          className="scrollTop"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          ↑
        </button>
      )}
    </main>
  );
}
