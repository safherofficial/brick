import Link from "next/link";
import type { CSSProperties } from "react";

type ModelType = "castle" | "ship" | "pizza" | "astronaut" | "treehouse" | "tv";

type Creation = {
  title: string;
  creator: string;
  likes: string;
  views: string;
  type: ModelType;
  tag: string;
};

const creations: Creation[] = [
  { title: "Medieval Castle", creator: "@brick_king", type: "castle", tag: "ARCHITECTURE", likes: "2.3K", views: "14.8K" },
  { title: "Black Sea Raider", creator: "@oceanbuilder", type: "ship", tag: "VEHICLES", likes: "1.8K", views: "10.4K" },
  { title: "City Pizza Shop", creator: "@citybrick", type: "pizza", tag: "CITY", likes: "1.2K", views: "8.7K" },
  { title: "Space Explorer", creator: "@galaxybuilder", type: "astronaut", tag: "CHARACTERS", likes: "3.1K", views: "18.9K" },
  { title: "Tree House", creator: "@naturebrick", type: "treehouse", tag: "NATURE", likes: "1.6K", views: "11.2K" },
  { title: "Retro TV", creator: "@vintagebrick", type: "tv", tag: "OBJECTS", likes: "987", views: "6.3K" }
];

function Brick({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span className={`mockBrick ${className}`} style={style}><i /><i /><i /><i /></span>;
}

function MockupScene({ type }: { type: ModelType }) {
  if (type === "castle") return <div className="mockupScene castleScene">
    <div className="castleGround" />
    <div className="castleWall" />
    <div className="castleTower towerLeft"><b /><em /></div>
    <div className="castleTower towerRight"><b /><em /></div>
    <div className="castleGate" />
    <div className="castleFlag">◆</div>
    <Brick className="castleBrickOne" /><Brick className="castleBrickTwo" />
  </div>;
  if (type === "ship") return <div className="mockupScene shipScene">
    <div className="sea" /><div className="shipHull" /><div className="shipDeck" />
    <div className="mast mastOne" /><div className="mast mastTwo" />
    <div className="sail sailOne">◆</div><div className="sail sailTwo">◆</div>
    <div className="shipFlag" />
  </div>;
  if (type === "pizza") return <div className="mockupScene pizzaScene">
    <div className="shopShadow" /><div className="shopBody" /><div className="shopRoof" />
    <div className="shopAwning"><span /><span /><span /><span /><span /></div>
    <div className="shopWindow windowOne" /><div className="shopWindow windowTwo" /><div className="shopDoor" />
    <div className="pizzaSign">PIZZA</div><div className="street" />
  </div>;
  if (type === "astronaut") return <div className="mockupScene astronautScene">
    <div className="planet" /><div className="astronautHelmet"><b /></div><div className="astronautBody" />
    <div className="astronautArm armLeft" /><div className="astronautArm armRight" />
    <div className="astronautLeg legLeft" /><div className="astronautLeg legRight" />
    <div className="backpack" /><span className="star starOne">✦</span><span className="star starTwo">✦</span><span className="star starThree">✦</span>
  </div>;
  if (type === "treehouse") return <div className="mockupScene treeScene">
    <div className="treeGround" /><div className="treeTrunk" /><div className="treeBranch branchOne" /><div className="treeBranch branchTwo" />
    <div className="treeCanopy canopyOne" /><div className="treeCanopy canopyTwo" /><div className="treeCanopy canopyThree" />
    <div className="treeHouseBody" /><div className="treeHouseRoof" /><div className="treeHouseWindow" /><div className="treeHouseLadder" />
  </div>;
  return <div className="mockupScene tvScene">
    <div className="tvCabinet" /><div className="tvScreen"><span>BRICK</span></div><div className="tvDial dialOne" /><div className="tvDial dialTwo" />
    <div className="tvAntenna antennaLeft" /><div className="tvAntenna antennaRight" /><div className="tvLeg legA" /><div className="tvLeg legB" />
  </div>;
}

export default function GalleryPage() {
  return <main>
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
        <div><p className="eyebrow">THE SHOWCASE</p><h1>EXPLORE CREATIONS</h1><p className="galleryIntro">A curated wall of brick-built worlds, vehicles, characters and architectural models.</p></div>
        <Link href="/build" className="primaryButton">CREATE YOURS →</Link>
      </div>
      <div className="filterBar">
        <button className="filterActive">TRENDING</button><button>LATEST</button><button>MOST LIKED</button>
        <span className="filterSpacer" /><input placeholder="Search creations..." /><button>ALL CATEGORIES</button>
      </div>
      <div className="creationGrid large">
        {creations.map((creation) => <article className="creationCard mockupCard" key={creation.title}>
          <Link href="/creation/demo" className="mockupLink"><MockupScene type={creation.type} /><span className="modelTag">{creation.tag}</span><span className="viewModel">VIEW MODEL ↗</span></Link>
          <div className="cardMeta"><div><h3>{creation.title}</h3><p>{creation.creator}</p></div><span>♥ {creation.likes} · ◉ {creation.views}</span></div>
        </article>)}
      </div>
    </section>
  </main>;
}
