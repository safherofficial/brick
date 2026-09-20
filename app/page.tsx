"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Float, Sparkles, OrbitControls, ContactShadows } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useRef } from "react";

const PRO_SOL_PRICE = 0.08;
const REFERENCE_SOL_USD = 113;

function Block({ position, scale = [1, 1, 1], color = "#8090ff", metalness = 0.45 }: { position: [number, number, number]; scale?: [number, number, number]; color?: string; metalness?: number }) {
  return (
    <mesh position={position} scale={scale} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={color} roughness={0.34} metalness={metalness} />
    </mesh>
  );
}

function VoxelGun({ active = false }: { active?: boolean }) {
  return (
    <group rotation={[0.06, -0.32, -0.12]} scale={active ? 1.05 : 0.78}>
      <Block position={[0, 0.45, 0]} scale={[2.35, 0.55, 0.65]} color="#9aa5bf" />
      <Block position={[0.72, 0.88, 0]} scale={[0.82, 0.24, 0.74]} color="#68738e" />
      <Block position={[1.38, 0.73, 0]} scale={[1.45, 0.22, 0.34]} color="#4e5870" metalness={0.7} />
      <Block position={[2.07, 0.73, 0]} scale={[0.35, 0.3, 0.24]} color="#b5c0d8" />
      <Block position={[-0.55, -0.25, 0]} scale={[0.54, 1.22, 0.58]} color="#59647d" />
      <Block position={[-0.24, -0.74, 0]} scale={[0.86, 0.35, 0.5]} color="#444d64" />
      <Block position={[0.55, -0.1, 0]} scale={[0.38, 0.16, 0.76]} color="#343b4e" metalness={0.8} />
      <mesh position={[-0.2, 0.48, 0.34]} castShadow>
        <boxGeometry args={[0.58, 0.18, 0.09]} />
        <meshStandardMaterial color="#8899ff" emissive="#3444d8" emissiveIntensity={1.4} />
      </mesh>
    </group>
  );
}

function VoxelSword() {
  return (
    <group rotation={[0.05, 0.28, -0.42]} scale={0.72}>
      <Block position={[0, 1.95, 0]} scale={[0.32, 3.65, 0.32]} color="#b3bed3" metalness={0.75} />
      <Block position={[0, 3.62, 0]} scale={[0.58, 0.24, 0.5]} color="#dae2ee" metalness={0.8} />
      <Block position={[0, 3.9, 0]} scale={[0.34, 0.24, 0.34]} color="#8f9cff" />
      <Block position={[0, 0.03, 0]} scale={[1.22, 0.25, 0.46]} color="#56617a" />
      <Block position={[0, -0.75, 0]} scale={[0.32, 1.38, 0.32]} color="#30384a" />
    </group>
  );
}

function VoxelCrate() {
  return (
    <group rotation={[0.08, 0.15, 0.12]} scale={0.9}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.8, 1.8]} />
        <meshStandardMaterial color="#586279" roughness={0.55} metalness={0.15} />
      </mesh>
      <Block position={[0, 0, 0.95]} scale={[1.35, 0.2, 0.12]} color="#7c88a4" />
      <Block position={[0, 0, -0.95]} scale={[1.35, 0.2, 0.12]} color="#7c88a4" />
      <Block position={[0, 0.6, 0]} scale={[0.2, 1.35, 0.12]} color="#7783a0" />
      <Block position={[0, -0.6, 0]} scale={[0.2, 1.35, 0.12]} color="#7783a0" />
      <Block position={[0, 0, 0]} scale={[0.18, 1.45, 0.18]} color="#9ba8c3" />
    </group>
  );
}

function SceneRig() {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.getElapsedTime();
    group.current.rotation.y = Math.sin(t * 0.35) * 0.08 + state.pointer.x * 0.12;
    group.current.rotation.x = Math.sin(t * 0.25) * 0.025 - state.pointer.y * 0.035;
  });

  return (
    <group ref={group} position={[0.35, 0.25, 0]}>
      <Float speed={1.2} rotationIntensity={0.12} floatIntensity={0.18}>
        <VoxelGun active />
      </Float>
      <Float speed={1.05} rotationIntensity={0.18} floatIntensity={0.35}>
        <group position={[-2.2, 1.45, -0.9]}>
          <VoxelSword />
        </group>
      </Float>
      <Float speed={1.15} rotationIntensity={0.2} floatIntensity={0.26}>
        <group position={[2.35, -1.05, -0.7]}>
          <VoxelCrate />
        </group>
      </Float>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.75, 0]} receiveShadow>
        <circleGeometry args={[4.6, 96]} />
        <meshBasicMaterial color="#0b0e14" transparent opacity={0.76} />
      </mesh>
    </group>
  );
}

function MiniAssetCanvas({ children }: { children: ReactNode }) {
  return (
    <Canvas camera={{ position: [4.8, 2.8, 5.4], fov: 38 }} dpr={[1, 1.4]} shadows>
      <ambientLight intensity={1.65} />
      <directionalLight position={[4, 5, 4]} intensity={3.2} color="#e4e9ff" castShadow />
      <pointLight position={[-2, 1, 2]} intensity={12} distance={7} color="#6573ff" />
      <Float speed={1.05} rotationIntensity={0.12} floatIntensity={0.15}>{children}</Float>
      <ContactShadows position={[0, -1.4, 0]} opacity={0.42} scale={5} blur={2.5} far={3.5} />
    </Canvas>
  );
}

function HeroScene() {
  return (
    <div className="proSceneWrap">
      <div className="proSceneChrome">
        <span>LIVE ASSET PREVIEW</span>
        <span className="sceneStatus"><i /> WEBGL</span>
      </div>
      <Canvas camera={{ position: [6.6, 3.8, 7.4], fov: 34 }} dpr={[1, 1.6]} shadows>
        <color attach="background" args={["#07090e"]} />
        <fog attach="fog" args={["#07090e", 8, 15]} />
        <ambientLight intensity={1.55} />
        <directionalLight position={[4, 7, 5]} intensity={3.3} color="#dfe6ff" castShadow />
        <pointLight position={[-3, 2, 2]} intensity={18} distance={8} color="#586cff" />
        <pointLight position={[3, -1, -1]} intensity={12} distance={7} color="#50d7ff" />
        <SceneRig />
        <gridHelper args={[16, 32, "#20263b", "#101522"]} position={[0, -1.82, 0]} />
        <ContactShadows position={[0, -1.78, 0]} opacity={0.55} scale={8} blur={2.8} far={4.5} />
        <Sparkles count={75} scale={[8, 4.5, 8]} size={1.1} speed={0.22} opacity={0.34} color="#8793ff" />
        <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={1.12} maxPolarAngle={1.75} minAzimuthAngle={-0.45} maxAzimuthAngle={0.45} />
      </Canvas>
      <div className="sceneReadout">
        <span>PRIMARY ASSET</span>
        <strong>VOXEL WEAPON</strong>
        <em>2D / 2.5D READY</em>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [monthlySub, setMonthlySub] = useState(50);
  const [solPrice, setSolPrice] = useState(REFERENCE_SOL_USD);

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
          </div>
          <HeroScene />
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
        <div className="proAssetGrid">
          <article className="proAssetCard proAssetWeapon"><div className="assetArt"><MiniAssetCanvas><VoxelGun active /></MiniAssetCanvas></div><div className="assetMeta"><span>WEAPONS</span><strong>Combat assets</strong><p>Guns, rifles, swords and stylized equipment.</p></div></article>
          <article className="proAssetCard proAssetSword"><div className="assetArt"><MiniAssetCanvas><VoxelSword /></MiniAssetCanvas></div><div className="assetMeta"><span>OBJECTS</span><strong>Inventory assets</strong><p>Items, pickups, tools and collectible objects.</p></div></article>
          <article className="proAssetCard proAssetProp"><div className="assetArt"><MiniAssetCanvas><VoxelCrate /></MiniAssetCanvas></div><div className="assetMeta"><span>PROPS</span><strong>World objects</strong><p>Crates, blocks and gameplay environment pieces.</p></div></article>
        </div>
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
              <span className="frameLabel">PRIVATE PROJECT</span>
              <div className="frameScene"><MiniAssetCanvas><VoxelGun active /></MiniAssetCanvas></div>
              <div className="frameFooter"><span>CLIENT ASSET / 014</span><strong>EXPORT GLB</strong></div>
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
            <input aria-label="Current monthly subscription cost" type="range" min="5" max="150" step="1" value={monthlySub} onChange={(e) => setMonthlySub(Number(e.target.value))} />
            <div className="calcInputs">
              <label><span>Monthly subscription</span><input type="number" min="0" step="1" value={monthlySub} onChange={(e) => setMonthlySub(Number(e.target.value) || 0)} /></label>
              <label><span>SOL reference price</span><input type="number" min="0" step="1" value={solPrice} onChange={(e) => setSolPrice(Number(e.target.value) || 0)} /></label>
            </div>
            <div className="calcFoot"><span>Brick Pro</span><strong>{PRO_SOL_PRICE.toFixed(2)} SOL / mo ≈ ${brickMonthlyUsd.toFixed(2)}</strong></div>
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
