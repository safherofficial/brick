import Link from "next/link";

type ModelType = "castle" | "manor" | "ship" | "pizzeria" | "treehouse" | "spaceport";
type Creation = { title: string; creator: string; likes: string; views: string; type: ModelType; tag: string; pieces: string };

const creations: Creation[] = [
  { title: "Ravenhold Castle", creator: "BrickMaster", type: "castle", tag: "ARCHITECTURE", pieces: "4,820", likes: "2.8K", views: "18.4K" },
  { title: "Harbor House", creator: "StudioBricks", type: "manor", tag: "ARCHITECTURE", pieces: "3,460", likes: "2.1K", views: "13.2K" },
  { title: "Black Tide Raider", creator: "OceanBuilder", type: "ship", tag: "VEHICLES", pieces: "2,960", likes: "3.4K", views: "21.7K" },
  { title: "Downtown Pizzeria", creator: "CityBrick", type: "pizzeria", tag: "CITY", pieces: "1,840", likes: "1.9K", views: "12.8K" },
  { title: "Canopy Observatory", creator: "NatureBrick", type: "treehouse", tag: "NATURE", pieces: "2,240", likes: "2.6K", views: "16.1K" },
  { title: "Orbital Outpost", creator: "GalaxyBuilder", type: "spaceport", tag: "SCI-FI", pieces: "5,120", likes: "4.2K", views: "28.6K" }
];

const Studs = ({ count = 4 }: { count?: number }) => <span className="modelStuds">{Array.from({ length: count }).map((_, i) => <i key={i} />)}</span>;
const Part = ({ className = "", color = "red", studs = 4 }: { className?: string; color?: string; studs?: number }) => <div className={`mPart ${color} ${className}`}><Studs count={studs} /></div>;

function Castle() { return <div className="proScene castlePro"><div className="basePlate green" /><div className="castleCourtyard" /><div className="castleKeep"><div className="keepRoof" /><div className="keepWindow w1" /><div className="keepWindow w2" /><div className="keepDoor" /></div><div className="castleTowerPro left"><div className="towerRoof" /><div className="towerWindow" /></div><div className="castleTowerPro right"><div className="towerRoof" /><div className="towerWindow" /></div><div className="castleWallPro" /><div className="castleGatePro" /><div className="castleFlagPro" /><Part className="castleLoose c1" color="gray" studs={4} /><Part className="castleLoose c2" color="darkred" studs={4} /></div>; }
function Manor() { return <div className="proScene manorPro"><div className="basePlate green" /><div className="manorBody" /><div className="manorRoof" /><div className="manorRoof2" /><div className="manorWindow mw1" /><div className="manorWindow mw2" /><div className="manorDoor" /><div className="manorBalcony" /><div className="manorTree mt1" /><div className="manorTree mt2" /><Part className="manorCar" color="yellow" studs={4} /></div>; }
function Ship() { return <div className="proScene shipPro"><div className="ocean" /><div className="shipHullPro" /><div className="shipDeckPro" /><div className="shipCabin" /><div className="mastPro m1" /><div className="mastPro m2" /><div className="sailPro s1" /><div className="sailPro s2" /><div className="shipRail" /><Part className="crate cr1" color="brown" studs={4} /><Part className="crate cr2" color="yellow" studs={4} /></div>; }
function Pizzeria() { return <div className="proScene pizzaPro"><div className="streetPlate" /><div className="shopBuilding" /><div className="shopRoof" /><div className="pizzaAwning" /><div className="pizzaSign">PIZZERIA</div><div className="shopWindow sw1" /><div className="shopWindow sw2" /><div className="shopDoor" /><div className="streetTable" /><div className="streetPlant" /><Part className="pizzaBox pb1" color="yellow" studs={4} /></div>; }
function Treehouse() { return <div className="proScene treePro"><div className="forestPlate" /><div className="treeTrunkPro" /><div className="treeBranchPro b1" /><div className="treeBranchPro b2" /><div className="treeHousePro" /><div className="treeRoofPro" /><div className="treeWindowPro" /><div className="treeLadderPro" /><div className="leaf l1" /><div className="leaf l2" /><div className="leaf l3" /><div className="leaf l4" /><Part className="bench" color="brown" studs={3} /></div>; }
function Spaceport() { return <div className="proScene spacePro"><div className="planetPlate" /><div className="hangar" /><div className="hangarRoof" /><div className="controlTower" /><div className="towerGlass" /><div className="launchPad" /><div className="rocket"><div className="nose" /><div className="rocketBody" /><div className="fin f1" /><div className="fin f2" /><div className="flame" /></div><div className="antennaPro" /><Part className="rover" color="white" studs={4} /></div>; }

function Mockup({ type }: { type: ModelType }) {
  if (type === "castle") return <Castle />;
  if (type === "manor") return <Manor />;
  if (type === "ship") return <Ship />;
  if (type === "pizzeria") return <Pizzeria />;
  if (type === "treehouse") return <Treehouse />;
  return <Spaceport />;
}

export default function GalleryPage() {
  return <main className="galleryRoot">
    <header className="siteHeader"><Link href="/" className="brand"><span className="brandMark">◆</span> BRICK</Link><nav><Link href="/build">BUILDER</Link><Link className="activeNav" href="/gallery">GALLERY</Link><Link href="/#about">ABOUT</Link><button className="walletButton">CONNECT WALLET</button></nav></header>
    <section className="galleryPage">
      <div className="sectionHeading"><div><p className="eyebrow">THE SHOWCASE</p><h1>PRO BUILDS</h1><p className="galleryIntro">A curated gallery of detailed brick-built worlds. Every model is presented like a finished collector display.</p></div><Link href="/build" className="primaryButton">START BUILDING →</Link></div>
      <div className="filterBar"><button className="filterActive">FEATURED</button><button>LATEST</button><button>MOST LIKED</button><span className="filterSpacer" /><input placeholder="Search models..." /><button>ALL CATEGORIES</button></div>
      <div className="creationGrid large">{creations.map((creation) => <article className="creationCard proCard" key={creation.title}><Link href="/creation/demo" className="mockupLink"><div className="modelViewport"><Mockup type={creation.type} /></div><span className="modelTag">{creation.tag}</span><span className="viewModel">VIEW MODEL ↗</span></Link><div className="cardMeta"><div><h3>{creation.title}</h3><p>{creation.creator}</p></div><div className="cardStats"><span>{creation.pieces} pcs</span><span>♥ {creation.likes}</span><span>◉ {creation.views}</span></div></div></article>)}</div>
    </section>
  </main>;
}
