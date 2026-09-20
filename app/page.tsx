"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import VoxelThumb from "@/components/gallery/VoxelThumb";
import type { CreationSummary } from "@/lib/creationsApi";

const PRO_SOL_PRICE = 0.08;
const REFERENCE_SOL_USD = 113;
const HOME_ROTATION_MS = 4 * 60 * 60 * 1000;

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function selectRotatingAssets(creations: CreationSummary[], bucket: number, count: number) {
  return [...creations]
    .sort((a, b) => hashString(`${bucket}:${a.id}`) - hashString(`${bucket}:${b.id}`))
    .slice(0, count);
}

function PublishedAssetPreview({
  asset,
  interactive = false
}: {
  asset: CreationSummary | undefined;
  interactive?: boolean;
}) {
  if (!asset) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "grid",
          placeItems: "center",
          color: "#69758a",
          font: '700 9px var(--font-mono)',
          letterSpacing: ".12em",
          textAlign: "center",
          padding: 30
        }}
      >
        NO PUBLISHED ASSETS YET
      </div>
    );
  }

  return (
    <VoxelThumb
      size={asset.construction_data.size}
      voxels={asset.construction_data.voxels}
      palette={asset.construction_data.palette}
      interactive={interactive}
    />
  );
}

function HomePublishedAsset({ asset }: { asset: CreationSummary | undefined }) {
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <PublishedAssetPreview asset={asset} />
    </div>
  );
}

function HeroScene({ asset }: { asset: CreationSummary | undefined }) {
  return (
    <div className="proSceneWrap">
      <div className="proSceneChrome">
        <span>LIVE PUBLISHED ASSET</span>
        <span className="sceneStatus"><i /> WEBGL</span>
      </div>
      <div style={{ position: "absolute", inset: 0, paddingTop: 34, paddingBottom: 52 }}>
        <PublishedAssetPreview asset={asset} interactive />
      </div>
      <div className="sceneReadout">
        <span>PUBLISHED ASSET</span>
        <strong>{asset?.name || "NONE"}</strong>
        <em>{asset ? "BUILDER / PUBLISH" : "WAITING FOR CREATION"}</em>
      </div>
    </div>
  );
}

export default function HomePage() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlHeight = html.style.height;
    const previousBodyHeight = body.style.height;

    // Builder CSS intentionally locks the viewport; release that lock when
    // client-side navigation lands on the public home page.
    html.style.overflow = "auto";
    body.style.overflow = "auto";
    html.style.height = "auto";
    body.style.height = "auto";

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.height = previousHtmlHeight;
      body.style.height = previousBodyHeight;
    };
  }, []);

  const [monthlySub, setMonthlySub] = useState(50);
  const [solPrice, setSolPrice] = useState(REFERENCE_SOL_USD);
  const [publishedAssets, setPublishedAssets] = useState<CreationSummary[]>([]);
  const [rotationKey, setRotationKey] = useState(() => Math.floor(Date.now() / HOME_ROTATION_MS));

  useEffect(() => {
    let cancelled = false;

    fetch("/api/creations?sort=latest&limit=60", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load published assets.");
        const data = await response.json();
        return Array.isArray(data?.creations) ? (data.creations as CreationSummary[]) : [];
      })
      .then((items) => {
        if (!cancelled) setPublishedAssets(items);
      })
      .catch(() => {
        if (!cancelled) setPublishedAssets([]);
      });

    return () => {
      cancelled = true;
    };
  }, [rotationKey]);

  useEffect(() => {
    const now = Date.now();
    const untilNextRotation = HOME_ROTATION_MS - (now % HOME_ROTATION_MS) + 100;
    const timeout = window.setTimeout(() => {
      setRotationKey(Math.floor(Date.now() / HOME_ROTATION_MS));
    }, untilNextRotation);

    return () => window.clearTimeout(timeout);
  }, [rotationKey]);

  const rotatingAssets = useMemo(
    () => selectRotatingAssets(publishedAssets, rotationKey, 4),
    [publishedAssets, rotationKey]
  );
  const heroAsset = rotatingAssets[0];
  const clientAsset = rotatingAssets[1] ?? heroAsset;

  const brickMonthlyUsd = useMemo(() => PRO_SOL_PRICE * solPrice, [solPrice]);
  const annualSubscription = monthlySub * 12;
  const annualBrick = brickMonthlyUsd * 12;
  const annualDifference = annualSubscription - annualBrick;
  const savingsPercent = annualSubscription > 0 ? Math.max(annualDifference / annualSubscription, 0) * 100 : 0;

  return (
    <main className="proHome">
      <header className="proHeader">
        <Link href="/" className="proBrand" aria-label="Home">
          <span className="proBrandMark">◆</span>
          <span>BRICK</span>
        </Link>
        <nav className="proNav">
          <a href="#why">WHY</a>
          <a href="#assets">ASSETS</a>
          <a href="#clients">FOR CLIENTS</a>
          <a href="#pricing">COST</a>
          <Link href="/gallery">GALLERY</Link>
          <Link href="/build" className="proNavCta">OPEN BUILDER</Link>
        </nav>
      </header>

      <section className="proHero">
        <div className="proHeroGrid">
          <div className="proHeroCopy">
            <div className="proEyebrow"><span /> GAME ASSET CREATION ENGINE</div>
            <h1>Build the asset.<br /><span>Not the whole 3D suite.</span></h1>
            <p className="proHeroLead">
              Create voxel game assets manually or turn a PNG/JPEG into a usable asset. Built specifically for weapons, objects and props in stylized 2D / 2.5D games.
            </p>
            <div className="proHeroActions">
              <Link href="/build" className="proButton proButtonPrimary">START BUILDING <b>↗</b></Link>
              <a href="#pricing" className="proButton proButtonGhost">COMPARE COST</a>
            </div>
            <div className="proHeroStats">
              <span><b>01</b> MANUAL VOXEL BUILDER</span>
              <span><b>02</b> PNG / JPEG → ASSET</span>
              <span><b>03</b> GLB / VOX / OBJ</span>
            </div>
            <div className="proBuilderProof" aria-label="Builder strengths">
              <span><b>EDIT</b> Shape &amp; paint voxel-by-voxel</span>
              <span><b>INPUT</b> Single image or FRONT + SIDE</span>
              <span><b>OUTPUT</b> Game-ready formats for Unity workflows</span>
            </div>
          </div>
          <HeroScene asset={heroAsset} />
        </div>
        <div className="proHeroBottom">
          <span>SCROLL TO EXPLORE</span>
          <span>WEAPONS · PROPS · OBJECTS</span>
          <span>SOLANA READY</span>
        </div>
      </section>

      <section className="proTicker" aria-label="Product focus">
        <div>GAME ASSETS</div><div>WEAPONS</div><div>OBJECTS</div><div>2D / 2.5D</div><div>UNITY WORKFLOW</div><div>PRIVATE CLIENT WORK</div>
      </section>

      <section className="proSection proValue" id="why">
        <div className="proSectionHead">
          <div>
            <span className="proSectionNo">01 / VALUE</span>
            <h2>Use a focused tool<br />for a focused job.</h2>
          </div>
          <p>When you only need game assets, paying for an entire general-purpose 3D production stack may be more than the workflow requires.</p>
        </div>
        <div className="proValueGrid">
          <article className="proValueCard">
            <span>01</span><strong>CREATE</strong>
            <h3>Weapons & objects</h3>
            <p>Swords, guns, rifles, props, pickups, inventory items and other gameplay assets.</p>
          </article>
          <article className="proValueCard proValueCardAccent">
            <span>02</span><strong>CONVERT</strong>
            <h3>PNG / JPEG → voxel</h3>
            <p>Start from an image instead of building every block by hand. The pipeline is designed around game-ready output.</p>
          </article>
          <article className="proValueCard">
            <span>03</span><strong>EXPORT</strong>
            <h3>Move it into the game</h3>
            <p>Keep your workflow compact with GLB, VOX and OBJ exports, plus practical Unity-oriented conventions.</p>
          </article>
        </div>
      </section>

      <section className="proSection proAssets" id="assets">
        <div className="proSectionHead">
          <div>
            <span className="proSectionNo">02 / SPECIALIZED</span>
            <h2>Built around<br />the assets games use.</h2>
          </div>
          <Link href="/build" className="proInlineCta">OPEN THE BUILDER ↗</Link>
        </div>
        {rotatingAssets.length ? (
          <div className="proAssetGrid">
            {rotatingAssets.slice(0, 3).map((asset, index) => (
              <article className={`proAssetCard ${index === 0 ? "proAssetWeapon" : index === 1 ? "proAssetSword" : "proAssetProp"}`} key={asset.id}>
                <Link href={`/creation/${asset.id}`} className="assetArt" aria-label={`Open ${asset.name}`}>
                  <HomePublishedAsset asset={asset} />
                </Link>
                <div className="assetMeta">
                  <span>PUBLISHED BY USER</span>
                  <strong>{asset.name}</strong>
                  <p>{asset.author ? `Created by ${asset.author}.` : "Published from the Builder."} {asset.brick_count.toLocaleString()} voxels.</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="proGalleryMessage">
            <strong>No published assets yet.</strong>
            <span>Assets appear here automatically after a user publishes them from the Builder.</span>
          </div>
        )}
      </section>

      <section className="proSection proClient" id="clients">
        <div className="proClientPanel">
          <div className="proClientCopy">
            <span className="proSectionNo">03 / FOR CLIENT WORK</span>
            <h2>Create assets.<br /><span>Sell them privately.</span></h2>
            <p>
              Use the builder as your creation layer for commissions and private asset packs. Create the work, export the files and deliver them directly through your own channels.
            </p>
            <div className="proClientPoints">
              <span>Custom commissions</span>
              <span>Private asset packs</span>
              <span>Direct client delivery</span>
            </div>
          </div>
          <div className="proClientVisual">
            <div className="clientFrame">
              <span className="frameLabel">PUBLISHED PROJECT</span>
              <div className="frameScene">
                <HomePublishedAsset asset={clientAsset} />
              </div>
              <div className="frameFooter"><span>{clientAsset ? clientAsset.name.toUpperCase() : "NO PUBLISHED ASSET"}</span><strong>{clientAsset ? "PUBLISHED" : "WAITING"}</strong></div>
            </div>
          </div>
        </div>
      </section>

      <section className="proSection proPricing" id="pricing">
        <div className="proSectionHead">
          <div>
            <span className="proSectionNo">04 / COST</span>
            <h2>Compare the workflow,<br />not the feature list.</h2>
          </div>
          <p>Example calculator using the current Pro price of 0.08 SOL/month. SOL value changes with the market; edit the reference price below.</p>
        </div>
        <div className="proPricingGrid">
          <div className="proCalcCard">
            <div className="calcHeader"><span>YOUR CURRENT 3D SUBSCRIPTION</span><strong>${monthlySub}<small>/ month</small></strong></div>
            <div className="brickPriceHighlight">
              <div>
                <span>BRICK PRO</span>
                <strong>{PRO_SOL_PRICE.toFixed(2)} <small>SOL / month</small></strong>
              </div>
              <b>≈ ${brickMonthlyUsd.toFixed(2)} / month</b>
            </div>
            <input aria-label="Current monthly subscription cost" type="range" min="5" max="150" step="1" value={monthlySub} onChange={(e) => setMonthlySub(Number(e.target.value))} />
            <div className="calcInputs">
              <label><span>Monthly subscription</span><input type="number" min="0" step="1" value={monthlySub} onChange={(e) => setMonthlySub(Number(e.target.value) || 0)} /></label>
              <label><span>SOL reference price</span><input type="number" min="0" step="1" value={solPrice} onChange={(e) => setSolPrice(Number(e.target.value) || 0)} /></label>
            </div>

          </div>
          <div className="proSavingsCard">
            <span>ESTIMATED ANNUAL DIFFERENCE</span>
            <strong>{annualDifference >= 0 ? `$${annualDifference.toFixed(0)}` : `-$${Math.abs(annualDifference).toFixed(0)}`}</strong>
            <p>{annualDifference >= 0 ? `Based on $${monthlySub}/month for a conventional subscription. At this reference price, the focused workflow uses about ${savingsPercent.toFixed(0)}% less annual spend.` : "At this subscription price, the current reference comparison does not show a saving."}</p>
            <div className="savingsRows"><div><span>Subscription / year</span><b>${annualSubscription.toFixed(0)}</b></div><div><span>Brick Pro / year</span><b>${annualBrick.toFixed(0)}</b></div></div>
          </div>
        </div>
      </section>

      <section className="proSection proWorkflow">
        <div className="proWorkflowIntro">
          <span className="proSectionNo">05 / WORKFLOW</span>
          <h2>From reference<br />to game asset.</h2>
        </div>
        <div className="proWorkflowSteps">
          <div><span>01</span><strong>DROP</strong><p>PNG/JPEG or start from an empty voxel scene.</p></div>
          <div><span>02</span><strong>BUILD</strong><p>Shape, paint and refine the asset manually or use image conversion.</p></div>
          <div><span>03</span><strong>EXPORT</strong><p>Take the result into your game workflow in a practical asset format.</p></div>
          <div><span>04</span><strong>DELIVER</strong><p>Use it yourself, build packs or deliver commissioned work privately.</p></div>
        </div>
      </section>

      <section className="proFinalCta">
        <div className="proFinalGlow" />
        <span className="proSectionNo">BUILD THE ASSET</span>
        <h2>Stop paying for the parts<br />of a 3D pipeline you don't need.</h2>
        <p>Build weapons, objects and props. Start from pixels or from voxels. Export when it is ready.</p>
        <Link href="/build" className="proButton proButtonPrimary">OPEN BUILDER <b>↗</b></Link>
      </section>

      <footer className="proFooter">
        <div><span className="proBrandMark">◆</span> BRICK</div>
        <span>GAME ASSET CREATION ENGINE · 2D / 2.5D · SOLANA</span>
        <div><Link href="/gallery">Gallery</Link><Link href="/build">Builder</Link></div>
      </footer>
    </main>
  );
}
