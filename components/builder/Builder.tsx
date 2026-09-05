"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";
import Link from "next/link";
import {
  Canvas,
  ThreeEvent,
  useThree
} from "@react-three/fiber";
import {
  Grid,
  GizmoHelper,
  GizmoViewport,
  OrbitControls
} from "@react-three/drei";
import * as THREE from "three";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  MousePointer2,
  Move,
  RotateCw,
  Trash2,
  Undo2,
  Redo2,
  Plus,
  Eraser,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown
} from "lucide-react";
import {
  BrickVisual,
  type BrickShape,
  STUD,
  BRICK_HEIGHT
} from "./BrickVisual";

type Brick = {
  id: number;
  size: [number, number, number];
  footprint: [number, number];
  position: [number, number, number];
  color: string;
  shape: BrickShape;
  rotationY: number;
};

type BrickKind =
  | "1x1"
  | "2x2"
  | "2x4"
  | "cone"
  | "round"
  | "micro";

// Numero massimo di pezzi piazzabili in una creazione. Alzato rispetto al
// vecchio limite di 100: un modello "professionale" in stile vetrina (vedi
// il T-Rex di riferimento) richiede facilmente qualche centinaio di pezzi,
// specialmente usando il pezzo MICRO per i dettagli fini.
const STARTER_LIMIT = 4000;

// Passo reale della griglia di piazzamento: 1/3 di uno STUD. Vedi il
// commento sopra la tabella "sizes" per il perché.
const CELL = STUD / 3;

type HistoryState = Brick[];

const palette = [
  "#ef4444",
  "#f59e0b",
  "#facc15",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#e5e7eb"
];

const shapeOf: Record<
  BrickKind,
  BrickShape
> = {
  "1x1": "box",
  "2x2": "box",
  "2x4": "box",
  cone: "cone",
  round: "cylinder",
  micro: "box"
};

const kindLabel: Record<
  BrickKind,
  string
> = {
  "1x1": "1×1",
  "2x2": "2×2",
  "2x4": "2×4",
  cone: "CONE",
  round: "ROUND",
  micro: "MICRO"
};

// CELL è il vero passo della griglia di piazzamento: 1/3 di STUD. Tutti i
// brick "storici" (1x1/2x2/2x4/cone/round) restano fisicamente della stessa
// dimensione di sempre (in world units), ma il loro footprint viene ora
// espresso in celle CELL (quindi ×3) invece che in STUD. Questo apre lo
// spazio per il pezzo MICRO, che occupa 1 sola cella: 1/3×1/3 di un 1x1,
// la vera unità per scolpire dettagli fini (curve, texture, piccoli rilievi)
// come nel modello di riferimento caricato dall'utente.
const sizes: Record<
  BrickKind,
  [number, number, number]
> = {
  "1x1": [
    STUD,
    BRICK_HEIGHT,
    STUD
  ],
  "2x2": [
    STUD * 2,
    BRICK_HEIGHT,
    STUD * 2
  ],
  "2x4": [
    STUD * 4,
    BRICK_HEIGHT,
    STUD * 2
  ],
  cone: [
    STUD,
    BRICK_HEIGHT,
    STUD
  ],
  round: [
    STUD,
    BRICK_HEIGHT,
    STUD
  ],
  micro: [
    CELL,
    BRICK_HEIGHT / 3,
    CELL
  ]
};

const footprints: Record<
  BrickKind,
  [number, number]
> = {
  "1x1": [3, 3],
  "2x2": [6, 6],
  "2x4": [12, 6],
  cone: [3, 3],
  round: [3, 3],
  micro: [1, 1]
};

const basicKinds: BrickKind[] = [
  "1x1",
  "2x2",
  "2x4"
];

const specialKinds: BrickKind[] = [
  "cone",
  "round",
  "micro"
];

/*
 * ---------------------------------------------------------
 * GRID / SNAPPING
 * ---------------------------------------------------------
 *
 * I brick vengono allineati sulle celle reali della griglia, il cui
 * passo è CELL (1/3 di STUD) — non STUD stesso: questo è ciò che rende
 * possibile il pezzo MICRO, che occupa una singola cella.
 *
 * Il centro può trovarsi anche a mezza CELL:
 *
 * 1x1 -> centro su 0, 1 STUD, 2 STUD...
 * 2x2 -> centro su 0, 1 STUD, 2 STUD...
 * 2x4 -> centro su 0, 1 STUD, 2 STUD...
 * MICRO -> centro su 0, 1 CELL, 2 CELL...
 *
 * Per l'adiacenza usiamo invece il footprint reale.
 */

const CENTER_SNAP =
  CELL / 2;

function snapCenter(
  value: number
): number {
  return (
    Math.round(
      value / CENTER_SNAP
    ) * CENTER_SNAP
  );
}

function footprintSize(
  footprint: [number, number]
): [number, number] {
  return [
    footprint[0] * CELL,
    footprint[1] * CELL
  ];
}

function getRotatedFootprint(
  brick: Brick
): [number, number] {
  const quarterTurns =
    Math.round(
      (brick.rotationY ?? 0) /
        (Math.PI / 2)
    );

  return Math.abs(
    quarterTurns
  ) % 2 === 0
    ? [
        brick.footprint[0],
        brick.footprint[1]
      ]
    : [
        brick.footprint[1],
        brick.footprint[0]
      ];
}

function getFootprint(
  brick: Brick
): [number, number] {
  return getRotatedFootprint(
    brick
  );
}

/*
 * Restituisce i limiti occupati dal brick
 * sul piano X/Z.
 */
function getBounds(
  brick: Brick
) {
  const [w, d] =
    footprintSize(
      getFootprint(brick)
    );

  return {
    minX:
      brick.position[0] -
      w / 2,
    maxX:
      brick.position[0] +
      w / 2,
    minZ:
      brick.position[2] -
      d / 2,
    maxZ:
      brick.position[2] +
      d / 2
  };
}

/*
 * Collisione 2D precisa sul footprint.
 *
 * <= viene usato per permettere:
 *
 * [BRICK][BRICK]
 *
 * senza considerarli sovrapposti.
 */
function overlaps(
  a: Brick,
  b: Brick
): boolean {
  const aBounds =
    getBounds(a);

  const bBounds =
    getBounds(b);

  return (
    aBounds.minX <
      bBounds.maxX &&
    aBounds.maxX >
      bBounds.minX &&
    aBounds.minZ <
      bBounds.maxZ &&
    aBounds.maxZ >
      bBounds.minZ
  );
}

function sameLayer(
  a: Brick,
  b: Brick
): boolean {
  return (
    Math.abs(
      a.position[1] -
        b.position[1]
    ) < 0.01
  );
}

function validPlacement(
  candidate: Brick,
  bricks: Brick[]
): boolean {
  return !bricks.some(
    (brick) =>
      sameLayer(
        candidate,
        brick
      ) &&
      overlaps(
        candidate,
        brick
      )
  );
}

/*
 * Converte ogni posizione occupata dal brick
 * in una coordinata di cella stabile.
 *
 * Questo evita il problema dei brick pari:
 *
 * 2x2 centrato su 0
 * occupa:
 * -0.45 / +0.45
 *
 * che NON deve diventare due volte la stessa cella.
 */
function getCoveredCells(
  brick: Brick
): Array<[number, number]> {
  const [w, d] =
    getRotatedFootprint(
      brick
    );

  const cells: Array<
    [number, number]
  > = [];

  const centerX =
    brick.position[0] /
    CELL;

  const centerZ =
    brick.position[2] /
    CELL;

  const startX =
    centerX -
    (w - 1) / 2;

  const startZ =
    centerZ -
    (d - 1) / 2;

  for (
    let ix = 0;
    ix < w;
    ix++
  ) {
    for (
      let iz = 0;
      iz < d;
      iz++
    ) {
      cells.push([
        Math.round(
          startX + ix
        ),
        Math.round(
          startZ + iz
        )
      ]);
    }
  }

  return cells;
}

function cellKey(
  x: number,
  z: number
): string {
  return `${x},${z}`;
}

/*
 * Trova la quota (Y) della superficie di appoggio superiore.
 *
 * A differenza del vecchio sistema "a livelli interi" (che assumeva
 * un'unica altezza fissa uguale per ogni brick), questo calcolo usa
 * l'altezza REALE di ciascun brick coprente. È necessario da quando
 * esiste il pezzo MICRO, alto solo 1/3 di un brick standard: un
 * indice di layer fisso non saprebbe più dire dove finisce la sua
 * superficie. Un brick viene impilato solo quando tutte le sue celle
 * hanno un supporto.
 */
function supportedTop(
  candidate: Brick,
  bricks: Brick[]
): number {
  const candidateCells =
    getCoveredCells(
      candidate
    ).map(
      ([x, z]) =>
        cellKey(x, z)
    );

  if (
    candidateCells.length ===
    0
  ) {
    return 0;
  }

  let bestTop = 0;

  for (const brick of bricks) {
    const top =
      brick.position[1] +
      brick.size[1] / 2;

    const supportCells =
      new Set(
        getCoveredCells(
          brick
        ).map(
          ([x, z]) =>
            cellKey(x, z)
        )
      );

    const covers =
      candidateCells.every(
        (key) =>
          supportCells.has(
            key
          )
      );

    if (covers) {
      bestTop =
        Math.max(
          bestTop,
          top
        );
    }
  }

  return bestTop;
}

/*
 * Costruisce un brick con snapping
 * coerente per tutte le operazioni:
 *
 * - ADD
 * - GHOST
 * - DRAG
 * - ARROWS
 * - DUPLICATE
 */
function buildCandidate(
  kind: BrickKind,
  color: string,
  point: THREE.Vector3,
  bricks: Brick[],
  forcedTop?: number,
  forcedRotation = 0
): Brick {
  const x =
    snapCenter(point.x);

  const z =
    snapCenter(point.z);

  const height =
    sizes[kind][1];

  const base: Brick = {
    id:
      Date.now() +
      Math.floor(
        Math.random() * 100000
      ),
    size:
      sizes[kind],
    footprint:
      footprints[kind],
    position: [
      x,
      height / 2,
      z
    ],
    color,
    shape:
      shapeOf[kind],
    rotationY:
      forcedRotation
  };

  const top =
    forcedTop ??
    supportedTop(
      base,
      bricks
    );

  return {
    ...base,
    position: [
      x,
      top +
        height / 2,
      z
    ]
  };
}

function GhostBrick({
  position,
  size,
  footprint,
  shape,
  color,
  valid
}: {
  position: [
    number,
    number,
    number
  ];
  size: [
    number,
    number,
    number
  ];
  footprint: [
    number,
    number
  ];
  shape: BrickShape;
  color: string;
  valid: boolean;
}) {
  return (
    <group
      position={position}
    >
      <BrickVisual
        shape={shape}
        size={size}
        footprint={footprint}
        color={
          valid
            ? color
            : "#ef4444"
        }
        opacity={0.3}
      />
    </group>
  );
}

function BrickMesh({
  brick,
  selected,
  dragging,
  onSelect,
  onHover,
  onPlace,
  onDragStart,
  onDragMove,
  onDragEnd
}: {
  brick: Brick;
  selected: boolean;
  dragging: boolean;
  onSelect: (
    id: number
  ) => void;
  onHover: (
    point: THREE.Vector3
  ) => void;
  onPlace: (
    point: THREE.Vector3
  ) => void;
  onDragStart: (
    id: number
  ) => void;
  onDragMove: (
    point: THREE.Vector3
  ) => void;
  onDragEnd: () => void;
}) {
  return (
    <group
      position={
        brick.position
      }
      rotation={[
        0,
        brick.rotationY,
        0
      ]}
      onClick={(e) => {
        e.stopPropagation();

        if (
          dragging
        ) {
          return;
        }

        if (e.shiftKey) {
          onPlace(e.point);
        } else {
          onSelect(
            brick.id
          );
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();

        if (
          e.button !== 0
        ) {
          return;
        }

        onSelect(
          brick.id
        );

        onDragStart(
          brick.id
        );
      }}
      onPointerMove={(e) => {
        e.stopPropagation();

        if (
          dragging
        ) {
          onDragMove(
            e.point
          );
        } else {
          onHover(
            e.point
          );
        }
      }}
      onPointerUp={(e) => {
        e.stopPropagation();

        onDragEnd();
      }}
      onPointerCancel={() => {
        onDragEnd();
      }}
    >
      <BrickVisual
        shape={
          brick.shape
        }
        size={
          brick.size
        }
        footprint={
          brick.footprint
        }
        color={
          brick.color
        }
      />

      {selected && (
        <mesh
          position={[
            0,
            brick.size[1] / 2 +
              0.13,
            0
          ]}
        >
          <boxGeometry
            args={[
              brick.size[0] +
                0.08,
              0.04,
              brick.size[2] +
                0.08
            ]}
          />
          <meshBasicMaterial
            color="#c084fc"
            wireframe
          />
        </mesh>
      )}
    </group>
  );
}

function CameraController({
  viewMode
}: {
  viewMode:
    | "iso"
    | "top";
}) {
  const { camera } =
    useThree();

  useEffect(() => {
    const target =
      new THREE.Vector3(
        0,
        0.8,
        0
      );

    if (
      viewMode === "top"
    ) {
      camera.position.set(
        0.01,
        11,
        0.01
      );
    } else {
      camera.position.set(
        8,
        7,
        9
      );
    }

    camera.lookAt(
      target
    );
  }, [
    camera,
    viewMode
  ]);

  return null;
}

function CameraCapture({
  onReady
}: {
  onReady: (
    capture: () => string
  ) => void;
}) {
  const { gl } =
    useThree();

  useEffect(() => {
    onReady(() =>
      gl.domElement.toDataURL(
        "image/png"
      )
    );
  }, [
    gl,
    onReady
  ]);

  return null;
}

function Scene({
  bricks,
  selectedId,
  draggingId,
  ghost,
  ghostValid,
  onSelect,
  onPointer,
  onCaptureReady,
  onPlace,
  onDragStart,
  onDragMove,
  onDragEnd,
  viewMode,
  gridVisible
}: {
  bricks: Brick[];
  selectedId:
    | number
    | null;
  draggingId:
    | number
    | null;
  ghost: Brick | null;
  ghostValid: boolean;
  onSelect: (
    id: number
  ) => void;
  onPointer: (
    point: THREE.Vector3
  ) => void;
  onCaptureReady: (
    capture: () => string
  ) => void;
  onPlace: (
    point: THREE.Vector3
  ) => void;
  onDragStart: (
    id: number
  ) => void;
  onDragMove: (
    point: THREE.Vector3
  ) => void;
  onDragEnd: () => void;
  viewMode:
    | "iso"
    | "top";
  gridVisible: boolean;
}) {
  const groundHover = (
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();

    if (
      draggingId !== null
    ) {
      onDragMove(
        e.point
      );

      return;
    }

    onPointer(
      e.point
    );
  };

  const groundClick = (
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();

    if (
      draggingId !== null
    ) {
      onDragEnd();

      return;
    }

    onPlace(
      e.point
    );
  };

  return (
    <Canvas
      shadows
      camera={{
        position: [
          8,
          7,
          9
        ],
        fov: 45
      }}
      gl={{
        preserveDrawingBuffer:
          true
      }}
      dpr={[1, 2]}
    >
      <color
        attach="background"
        args={[
          "#080b14"
        ]}
      />

      <ambientLight
        intensity={1.1}
      />

      <directionalLight
        position={[
          5,
          9,
          4
        ]}
        intensity={3.1}
        castShadow
        shadow-mapSize={[
          2048,
          2048
        ]}
      />

      <hemisphereLight
        intensity={0.42}
      />

      {gridVisible && (
        <Grid
          args={[
            30,
            30
          ]}
          cellSize={STUD}
          cellThickness={0.5}
          cellColor="#252b3a"
          sectionSize={
            STUD * 5
          }
          sectionThickness={1}
          sectionColor="#3d4660"
          fadeDistance={30}
        />
      )}

      <mesh
        rotation={[
          -Math.PI / 2,
          0,
          0
        ]}
        position={[
          0,
          -0.03,
          0
        ]}
        onPointerMove={
          groundHover
        }
        onClick={
          groundClick
        }
        receiveShadow
      >
        <planeGeometry
          args={[
            30,
            30
          ]}
        />
        <shadowMaterial
          opacity={0.18}
        />
      </mesh>

      {bricks.map(
        (brick) => (
          <BrickMesh
            key={brick.id}
            brick={brick}
            selected={
              selectedId ===
              brick.id
            }
            dragging={
              draggingId ===
              brick.id
            }
            onSelect={
              onSelect
            }
            onHover={
              onPointer
            }
            onPlace={
              onPlace
            }
            onDragStart={
              onDragStart
            }
            onDragMove={
              onDragMove
            }
            onDragEnd={
              onDragEnd
            }
          />
        )
      )}

      {ghost && (
        <GhostBrick
          position={
            ghost.position
          }
          size={
            ghost.size
          }
          footprint={
            ghost.footprint
          }
          shape={
            ghost.shape
          }
          color={
            ghost.color
          }
          valid={
            ghostValid
          }
        />
      )}

      <CameraController
        viewMode={
          viewMode
        }
      />

      <CameraCapture
        onReady={
          onCaptureReady
        }
      />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[
          0,
          0.8,
          0
        ]}
      />

      <GizmoHelper
        alignment="bottom-right"
        margin={[
          64,
          64
        ]}
      >
        <GizmoViewport
          axisColors={[
            "#f87171",
            "#4ade80",
            "#60a5fa"
          ]}
          labelColor="#0a0e18"
          hideNegativeAxes
        />
      </GizmoHelper>
    </Canvas>
  );
}

function BrickThumb({
  footprint,
  shape
}: {
  footprint: [
    number,
    number
  ];
  shape: BrickShape;
}) {
  if (
    shape === "cone"
  ) {
    return (
      <div className="brickThumbCone" />
    );
  }

  if (
    shape === "cylinder"
  ) {
    return (
      <div className="brickThumbRound" />
    );
  }

  const [w, d] =
    footprint;

  const studs =
    Array.from({
      length: w * d
    });

  return (
    <div
      className="brickThumbBox"
      style={{
        aspectRatio: `${w} / ${d}`
      }}
    >
      <div
        className="brickThumbStuds"
        style={{
          gridTemplateColumns:
            `repeat(${w}, 1fr)`
        }}
      >
        {studs.map(
          (_, i) => (
            <span
              key={i}
            />
          )
        )}
      </div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  title
}: {
  checked: boolean;
  onChange?: (
    value: boolean
  ) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={
        checked
      }
      disabled={
        disabled
      }
      title={title}
      className={`switchTrack ${
        checked
          ? "switchOn"
          : ""
      }`}
      onClick={() =>
        onChange?.(
          !checked
        )
      }
    >
      <span className="switchThumb" />
    </button>
  );
}

const cloneBricks = (
  bricks: Brick[]
): Brick[] =>
  bricks.map(
    (b) => ({
      ...b,
      position: [
        ...b.position
      ] as [
        number,
        number,
        number
      ],
      size: [
        ...b.size
      ] as [
        number,
        number,
        number
      ],
      footprint: [
        ...b.footprint
      ] as [
        number,
        number
      ],
      rotationY:
        b.rotationY ??
        0
    })
  );

export default function Builder() {
  const [color, setColor] =
    useState(
      palette[3]
    );

  const [kind, setKind] =
    useState<BrickKind>(
      "2x2"
    );

  const [bricks, setBricks] =
    useState<Brick[]>([
      {
        id: 1,
        size:
          sizes["2x4"],
        footprint:
          footprints["2x4"],
        position: [
          0,
          BRICK_HEIGHT / 2,
          0
        ],
        color:
          "#22c55e",
        shape: "box",
        rotationY: 0
      },
      {
        id: 2,
        size:
          sizes["2x2"],
        footprint:
          footprints["2x2"],
        position: [
          0,
          BRICK_HEIGHT / 2 +
            BRICK_HEIGHT,
          0
        ],
        color:
          "#3b82f6",
        shape: "box",
        rotationY: 0
      },
      {
        id: 3,
        size:
          sizes["1x1"],
        footprint:
          footprints["1x1"],
        position: [
          0,
          BRICK_HEIGHT / 2 +
            BRICK_HEIGHT * 2,
          0
        ],
        color:
          "#facc15",
        shape: "box",
        rotationY: 0
      }
    ]);

  const [
    selectedId,
    setSelectedId
  ] =
    useState<
      number | null
    >(null);

  const [
    draggingId,
    setDraggingId
  ] =
    useState<
      number | null
    >(null);

  const [
    capture,
    setCapture
  ] =
    useState<
      (() => string) | null
    >(null);

  const [
    showSave,
    setShowSave
  ] =
    useState(false);

  const [title, setTitle] =
    useState("");

  const [
    editingTitle,
    setEditingTitle
  ] =
    useState(false);

  const [
    creator,
    setCreator
  ] =
    useState("");

  const [saved, setSaved] =
    useState(false);

  const [
    previewSrc,
    setPreviewSrc
  ] =
    useState<
      string | null
    >(null);

  const [
    history,
    setHistory
  ] =
    useState<
      HistoryState[]
    >([]);

  const [
    future,
    setFuture
  ] =
    useState<
      HistoryState[]
    >([]);

  const [
    ghostPoint,
    setGhostPoint
  ] =
    useState<
      THREE.Vector3 | null
    >(null);

  const [
    viewMode,
    setViewMode
  ] =
    useState<
      "iso" | "top"
    >("iso");

  const [
    gridVisible,
    setGridVisible
  ] =
    useState(true);

  const [
    panelOpen,
    setPanelOpen
  ] =
    useState(true);

  const available =
    STARTER_LIMIT -
    bricks.length;

  const selected =
    useMemo(
      () =>
        bricks.find(
          (b) =>
            b.id ===
            selectedId
        ) ?? null,
      [
        bricks,
        selectedId
      ]
    );

  const ghost =
    useMemo(
      () =>
        ghostPoint
          ? buildCandidate(
              kind,
              color,
              ghostPoint,
              bricks
            )
          : null,
      [
        ghostPoint,
        kind,
        color,
        bricks
      ]
    );

  const ghostValid =
    !!ghost &&
    validPlacement(
      ghost,
      bricks
    );

  const commit =
    useCallback(
      (
        next: Brick[]
      ) => {
        setHistory(
          (h) => [
            ...h.slice(
              -39
            ),
            cloneBricks(
              bricks
            )
          ]
        );

        setFuture([]);

        setBricks(
          next
        );
      },
      [bricks]
    );

  const addAt =
    useCallback(
      (
        point: THREE.Vector3
      ) => {
        if (
          available <= 0
        ) {
          return;
        }

        const next =
          buildCandidate(
            kind,
            color,
            point,
            bricks
          );

        if (
          !validPlacement(
            next,
            bricks
          )
        ) {
          return;
        }

        commit([
          ...bricks,
          next
        ]);

        setSelectedId(
          next.id
        );
      },
      [
        available,
        bricks,
        color,
        commit,
        kind
      ]
    );

  const removeSelected =
    useCallback(
      () => {
        if (
          selectedId ===
          null
        ) {
          return;
        }

        commit(
          bricks.filter(
            (b) =>
              b.id !==
              selectedId
          )
        );

        setSelectedId(
          null
        );
      },
      [
        bricks,
        commit,
        selectedId
      ]
    );

  const recolorSelected =
    useCallback(
      (nextColor: string) => {
        setColor(
          nextColor
        );

        if (
          selectedId ===
          null
        ) {
          return;
        }

        const changed =
          bricks.map(
            (brick) =>
              brick.id ===
              selectedId
                ? {
                    ...brick,
                    color:
                      nextColor
                  }
                : brick
          );

        if (
          changed.some(
            (brick, index) =>
              brick.color !==
              bricks[index].color
          )
        ) {
          commit(
            changed
          );
        }
      },
      [
        bricks,
        commit,
        selectedId
      ]
    );

  const duplicateSelected =
    useCallback(
      () => {
        if (
          selectedId ===
            null ||
          available <= 0
        ) {
          return;
        }

        const source =
          bricks.find(
            (b) =>
              b.id ===
              selectedId
          );

        if (!source) {
          return;
        }

        const [
          width,
          depth
        ] =
          getRotatedFootprint(
            source
          );

        const rotation =
          source.rotationY ??
          0;

        const localX =
          Math.round(
            Math.cos(rotation)
          );

        const localZ =
          Math.round(
            Math.sin(rotation)
          );

        /*
         * Adiacenza geometrica:
         *
         * distanza centro =
         * metà larghezza A +
         * metà larghezza B
         *
         * Dato che il duplicato ha lo stesso
         * footprint dell'originale, questo è
         * semplicemente width * CELL (non
         * (width + 1) * STUD / 2: quella
         * formula, rimasta da una versione
         * precedente, spaziava i duplicati in
         * modo scorretto — troppo vicini per i
         * pezzi più grandi di 1x1, causando
         * sovrapposizioni e duplicati "silenti"
         * che fallivano il validPlacement).
         */
        const candidates: Array<
          [number, number]
        > = [
          [
            localX *
              (width * CELL),
            localZ *
              (width * CELL)
          ],
          [
            -localX *
              (width * CELL),
            -localZ *
              (width * CELL)
          ],
          [
            -localZ *
              (depth * CELL),
            localX *
              (depth * CELL)
          ],
          [
            localZ *
              (depth * CELL),
            -localX *
              (depth * CELL)
          ]
        ];

        let duplicate:
          Brick | null =
          null;

        for (const [
          offsetX,
          offsetZ
        ] of candidates) {
          const candidate: Brick =
            {
              ...source,
              id:
                Date.now() +
                Math.floor(
                  Math.random() *
                    100000
                ),
              position: [
                snapCenter(
                  source.position[0] +
                    offsetX
                ),
                source.position[1],
                snapCenter(
                  source.position[2] +
                    offsetZ
                )
              ],
              rotationY:
                source.rotationY ??
                0,
              size: [
                ...source.size
              ] as [
                number,
                number,
                number
              ],
              footprint: [
                ...source.footprint
              ] as [
                number,
                number
              ]
            };

          if (
            validPlacement(
              candidate,
              bricks
            )
          ) {
            duplicate =
              candidate;

            break;
          }
        }

        if (
          !duplicate
        ) {
          return;
        }

        commit([
          ...bricks,
          duplicate
        ]);

        setSelectedId(
          duplicate.id
        );
      },
      [
        available,
        bricks,
        commit,
        selectedId
      ]
    );

  const rotateSelected =
    useCallback(
      () => {
        if (
          selectedId ===
          null
        ) {
          return;
        }

        const selectedBrick =
          bricks.find(
            (b) =>
              b.id ===
              selectedId
          );

        if (
          !selectedBrick
        ) {
          return;
        }

        const currentRotation =
          selectedBrick.rotationY ??
          0;

        const nextRotation =
          currentRotation +
          Math.PI / 2;

        const normalizedRotation =
          (
            nextRotation %
              (Math.PI * 2) +
            Math.PI * 2
          ) %
          (Math.PI * 2);

        /*
         * Dopo la rotazione il centro
         * viene mantenuto.
         *
         * Il footprint viene letto
         * dinamicamente da
         * getRotatedFootprint().
         */
        const next =
          bricks.map(
            (b) =>
              b.id ===
              selectedId
                ? {
                    ...b,
                    rotationY:
                      normalizedRotation
                  }
                : b
          );

        const changed =
          next.find(
            (b) =>
              b.id ===
              selectedId
          )!;

        if (
          validPlacement(
            changed,
            next.filter(
              (b) =>
                b.id !==
                selectedId
            )
          )
        ) {
          commit(
            next
          );
        }
      },
      [
        bricks,
        commit,
        selectedId
      ]
    );

  const moveSelected =
    useCallback(
      (
        dx: number,
        dz: number
      ) => {
        if (
          selectedId ===
          null
        ) {
          return;
        }

        const next =
          bricks.map(
            (b) =>
              b.id ===
              selectedId
                ? {
                    ...b,
                    position: [
                      snapCenter(
                        b.position[0] +
                          dx
                      ),
                      b.position[1],
                      snapCenter(
                        b.position[2] +
                          dz
                      )
                    ] as [
                      number,
                      number,
                      number
                    ]
                  }
                : b
          );

        const moved =
          next.find(
            (b) =>
              b.id ===
              selectedId
          )!;

        if (
          validPlacement(
            moved,
            next.filter(
              (b) =>
                b.id !==
                selectedId
            )
          )
        ) {
          commit(
            next
          );
        }
      },
      [
        bricks,
        commit,
        selectedId
      ]
    );

  const startDragging =
    useCallback(
      (id: number) => {
        const brick =
          bricks.find(
            (b) =>
              b.id === id
          );

        if (!brick) {
          return;
        }

        setSelectedId(
          id
        );

        setDraggingId(
          id
        );

        setHistory(
          (h) => [
            ...h.slice(
              -39
            ),
            cloneBricks(
              bricks
            )
          ]
        );

        setFuture([]);
      },
      [bricks]
    );

  const dragMove =
    useCallback(
      (
        point: THREE.Vector3
      ) => {
        if (
          draggingId ===
          null
        ) {
          return;
        }

        const x =
          snapCenter(
            point.x
          );

        const z =
          snapCenter(
            point.z
          );

        setBricks(
          (currentBricks) => {
            const current =
              currentBricks.find(
                (b) =>
                  b.id ===
                  draggingId
              );

            if (!current) {
              return currentBricks;
            }

            const moved: Brick =
              {
                ...current,
                position: [
                  x,
                  current.position[1],
                  z
                ]
              };

            const others =
              currentBricks.filter(
                (b) =>
                  b.id !==
                  draggingId
              );

            if (
              !validPlacement(
                moved,
                others
              )
            ) {
              return currentBricks;
            }

            return currentBricks.map(
              (b) =>
                b.id ===
                draggingId
                  ? moved
                  : b
            );
          }
        );
      },
      [draggingId]
    );

  const endDragging =
    useCallback(
      () => {
        setDraggingId(
          null
        );
      },
      []
    );

  const undo =
    useCallback(
      () => {
        const previous =
          history.at(-1);

        if (!previous)
          return;

        setFuture(
          (f) => [
            ...f,
            cloneBricks(
              bricks
            )
          ]
        );

        setHistory(
          (h) =>
            h.slice(
              0,
              -1
            )
        );

        setBricks(
          cloneBricks(
            previous
          )
        );

        setSelectedId(
          null
        );
      },
      [
        bricks,
        history
      ]
    );

  const redo =
    useCallback(
      () => {
        const next =
          future.at(-1);

        if (!next)
          return;

        setHistory(
          (h) => [
            ...h,
            cloneBricks(
              bricks
            )
          ]
        );

        setFuture(
          (f) =>
            f.slice(
              0,
              -1
            )
        );

        setBricks(
          cloneBricks(
            next
          )
        );

        setSelectedId(
          null
        );
      },
      [
        bricks,
        future
      ]
    );

  useEffect(() => {
    const handler = (
      e: KeyboardEvent
    ) => {
      if (
        (
          e.target as HTMLElement
        )?.tagName ===
        "INPUT"
      ) {
        return;
      }

      if (
        (
          e.ctrlKey ||
          e.metaKey
        ) &&
        e.key.toLowerCase() ===
          "d"
      ) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (
        e.key ===
          "Delete" ||
        e.key ===
          "Backspace"
      ) {
        removeSelected();
      }

      if (
        e.key.toLowerCase() ===
        "r"
      ) {
        rotateSelected();
      }

      if (
        e.key ===
        "ArrowLeft"
      ) {
        moveSelected(
          -CELL,
          0
        );
      }

      if (
        e.key ===
        "ArrowRight"
      ) {
        moveSelected(
          CELL,
          0
        );
      }

      if (
        e.key ===
        "ArrowUp"
      ) {
        moveSelected(
          0,
          -CELL
        );
      }

      if (
        e.key ===
        "ArrowDown"
      ) {
        moveSelected(
          0,
          CELL
        );
      }

      if (
        (
          e.ctrlKey ||
          e.metaKey
        ) &&
        e.key.toLowerCase() ===
          "z"
      ) {
        e.preventDefault();
        undo();
      }

      if (
        (
          e.ctrlKey ||
          e.metaKey
        ) &&
        e.key.toLowerCase() ===
          "y"
      ) {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener(
      "keydown",
      handler
    );

    return () =>
      window.removeEventListener(
        "keydown",
        handler
      );
  }, [
    duplicateSelected,
    moveSelected,
    redo,
    removeSelected,
    rotateSelected,
    undo
  ]);

  useEffect(() => {
    const savedDraft =
      localStorage.getItem(
        "brick-builder-draft-state"
      );

    if (!savedDraft)
      return;

    try {
      const parsed =
        JSON.parse(
          savedDraft
        ) as Brick[];

      setBricks(
        parsed.map(
          (b) => ({
            ...b,
            rotationY:
              b.rotationY ??
              0
          })
        )
      );
    } catch {
      /* ignore malformed local draft */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "brick-builder-draft-state",
      JSON.stringify(
        bricks
      )
    );
  }, [bricks]);

  const openSave = () => {
    setSaved(false);

    setPreviewSrc(
      capture
        ? capture()
        : null
    );

    setShowSave(
      true
    );
  };

  const confirmSave = () => {
    if (
      !title.trim() ||
      !previewSrc
    ) {
      return;
    }

    localStorage.setItem(
      "brick-builder-draft",
      JSON.stringify({
        title:
          title.trim(),
        creator:
          creator.trim() ||
          "Anonymous",
        bricks,
        preview:
          previewSrc,
        savedAt:
          Date.now()
      })
    );

    setSaved(true);
  };

  return (
    <main className="builderShell">
      <header className="builderHeader">
        <div className="headerLeft">
          <Link
            href="/"
            className="brand"
          >
            <span className="brandMark">
              ◆
            </span>{" "}
            BRICK BUILDER
          </Link>

          <Link
            href="/gallery"
            className="backLink"
          >
            <ChevronLeft
              size={14}
            />{" "}
            BACK TO GALLERY
          </Link>
        </div>

        <div className="creationTitle">
          {editingTitle ? (
            <input
              autoFocus
              className="titleInput"
              value={title}
              placeholder="UNTITLED CREATION"
              onChange={(e) =>
                setTitle(
                  e.target.value
                )
              }
              onBlur={() =>
                setEditingTitle(
                  false
                )
              }
              onKeyDown={(e) => {
                if (
                  e.key ===
                  "Enter"
                ) {
                  setEditingTitle(
                    false
                  );
                }
              }}
            />
          ) : (
            <>
              <span>
                {title.trim() ||
                  "UNTITLED CREATION"}
              </span>

              <button
                className="titleEditBtn"
                aria-label="Rename creation"
                onClick={() =>
                  setEditingTitle(
                    true
                  )
                }
              >
                <Pencil
                  size={12}
                />
              </button>
            </>
          )}
        </div>

        <div className="builderActions">
          <button
            aria-label="undo"
            onClick={undo}
            disabled={
              !history.length
            }
          >
            <Undo2
              size={15}
            />
          </button>

          <button
            aria-label="redo"
            onClick={redo}
            disabled={
              !future.length
            }
          >
            <Redo2
              size={15}
            />
          </button>

          <button
            className="primaryButton"
            onClick={
              openSave
            }
          >
            SAVE
          </button>
        </div>
      </header>

      <div
        className="builderBody"
        style={{
          gridTemplateColumns: `${
            panelOpen
              ? 230
              : 64
          }px 1fr 220px`
        }}
      >
        <aside
          className={`brickPanel ${
            panelOpen
              ? ""
              : "panelCollapsed"
          }`}
        >
          <div className="panelHeaderRow">
            {panelOpen && (
              <p className="panelLabel">
                BRICKS
              </p>
            )}

            <button
              className="collapseBtn"
              aria-label="Toggle bricks panel"
              onClick={() =>
                setPanelOpen(
                  (v) => !v
                )
              }
            >
              {panelOpen ? (
                <ChevronLeft
                  size={14}
                />
              ) : (
                <ChevronRight
                  size={14}
                />
              )}
            </button>
          </div>

          {panelOpen && (
            <>
              <p className="category">
                BASIC
              </p>

              <div className="brickPalette">
                {basicKinds.map(
                  (k) => (
                    <button
                      key={k}
                      className={`brickOption ${
                        kind === k
                          ? "selectedOption"
                          : ""
                      }`}
                      onClick={() =>
                        setKind(k)
                      }
                      title={
                        kindLabel[k]
                      }
                    >
                      <BrickThumb
                        footprint={
                          footprints[k]
                        }
                        shape={
                          shapeOf[k]
                        }
                      />

                      <span className="brickOptionLabel">
                        {
                          kindLabel[
                            k
                          ]
                        }
                      </span>
                    </button>
                  )
                )}
              </div>

              <p className="category">
                SPECIAL
              </p>

              <div className="brickPalette">
                {specialKinds.map(
                  (k) => (
                    <button
                      key={k}
                      className={`brickOption ${
                        kind === k
                          ? "selectedOption"
                          : ""
                      }`}
                      onClick={() =>
                        setKind(k)
                      }
                      title={
                        kindLabel[k]
                      }
                    >
                      <BrickThumb
                        footprint={
                          footprints[k]
                        }
                        shape={
                          shapeOf[k]
                        }
                      />

                      <span className="brickOptionLabel">
                        {
                          kindLabel[
                            k
                          ]
                        }
                      </span>
                    </button>
                  )
                )}
              </div>

              <p className="category">
                COLORS
              </p>

              <div className="colorPalette">
                {palette.map(
                  (c) => (
                    <button
                      key={c}
                      aria-label={`Color ${c}`}
                      className={`colorDot ${
                        color === c
                          ? "selectedColor"
                          : ""
                      }`}
                      style={{
                        background:
                          c
                      }}
                      onClick={() =>
                        recolorSelected(
                          c
                        )
                      }
                    />
                  )
                )}
              </div>

              <p className="category">
                STARTER SET
              </p>

              <div className="available">
                <span>
                  AVAILABLE
                </span>

                <b>
                  {available} / {STARTER_LIMIT}
                </b>
              </div>

              <div className="progress">
                <i
                  style={{
                    width: `${(available / STARTER_LIMIT) * 100}%`
                  }}
                />
              </div>

              <p className="panelHelp">
                Drag bricks to move
                them on the grid.
                Green placement is
                valid. Click a brick
                to select it. Shift+Click
                a brick to stack on top.
              </p>
            </>
          )}
        </aside>

        <section className="scene">
          <Scene
            bricks={bricks}
            selectedId={
              selectedId
            }
            draggingId={
              draggingId
            }
            ghost={ghost}
            ghostValid={
              ghostValid
            }
            onSelect={
              setSelectedId
            }
            onPointer={
              setGhostPoint
            }
            onPlace={addAt}
            onCaptureReady={
              setCapture
            }
            onDragStart={
              startDragging
            }
            onDragMove={
              dragMove
            }
            onDragEnd={
              endDragging
            }
            viewMode={
              viewMode
            }
            gridVisible={
              gridVisible
            }
          />

          <div className="sceneHud">
            <span>
              {bricks.length} PIECES
            </span>

            <span>
              GRID 1×1
            </span>

            <span>
              {draggingId !==
              null
                ? "MOVING BRICK"
                : ghost
                ? ghostValid
                  ? "PLACEMENT READY"
                  : "BLOCKED"
                : selected
                ? "BRICK SELECTED"
                : "READY TO BUILD"}
            </span>
          </div>

          <div className="sceneHint">
            DRAG TO MOVE · HOVER TO
            PREVIEW · CLICK TO PLACE ·
            ARROWS MOVE · R ROTATE ·
            CTRL/CMD+D DUPLICATE ·
            CTRL/CMD+Z UNDO
          </div>

          <div className="bottomTools">
            <button
              onClick={() =>
                addAt(
                  ghostPoint ??
                    new THREE.Vector3(
                      0,
                      0,
                      0
                    )
                )
              }
              disabled={
                available <= 0
              }
            >
              <Plus
                size={14}
              />{" "}
              ADD BRICK
            </button>

            <button
              onClick={
                duplicateSelected
              }
              disabled={
                selectedId ===
                  null ||
                available <= 0
              }
            >
              <Plus
                size={14}
              />{" "}
              DUPLICATE
            </button>

            <button
              onClick={
                removeSelected
              }
              disabled={
                selectedId ===
                null
              }
            >
              <Eraser
                size={14}
              />{" "}
              REMOVE
            </button>

            <span className="toolbarDivider" />

            <button
              aria-label="move left"
              onClick={() =>
                moveSelected(
                  -CELL,
                  0
                )
              }
              disabled={
                selectedId ===
                null
              }
            >
              <ArrowLeft
                size={14}
              />
            </button>

            <button
              aria-label="move right"
              onClick={() =>
                moveSelected(
                  CELL,
                  0
                )
              }
              disabled={
                selectedId ===
                null
              }
            >
              <ArrowRight
                size={14}
              />
            </button>

            <button
              aria-label="move up"
              onClick={() =>
                moveSelected(
                  0,
                  -CELL
                )
              }
              disabled={
                selectedId ===
                null
              }
            >
              <ArrowUp
                size={14}
              />
            </button>

            <button
              aria-label="move down"
              onClick={() =>
                moveSelected(
                  0,
                  CELL
                )
              }
              disabled={
                selectedId ===
                null
              }
            >
              <ArrowDown
                size={14}
              />
            </button>

            <button
              onClick={
                rotateSelected
              }
              disabled={
                selectedId ===
                null
              }
            >
              <RotateCw
                size={14}
              />{" "}
              ROTATE
            </button>

            <span className="toolbarDivider" />

            <div className="bottomColors">
              {palette.map(
                (c) => (
                  <button
                    key={c}
                    aria-label={`Color ${c}`}
                    className={`colorDot small ${
                      color === c
                        ? "selectedColor"
                        : ""
                    }`}
                    style={{
                      background:
                        c
                    }}
                    onClick={() =>
                      recolorSelected(
                        c
                      )
                    }
                  />
                )
              )}
            </div>
          </div>
        </section>

        <aside className="toolsPanel">
          <p className="panelLabel">
            TOOLS
          </p>

          <div className="toolRow toolActive">
            <MousePointer2
              size={15}
            />

            <span>
              SELECT
            </span>
          </div>

          <button
            className="toolRow"
            onClick={() =>
              moveSelected(
                -CELL,
                0
              )
            }
            disabled={
              selectedId ===
              null
            }
          >
            <Move
              size={15}
            />

            <span>
              MOVE
            </span>
          </button>

          <button
            className="toolRow"
            onClick={
              rotateSelected
            }
            disabled={
              selectedId ===
              null
            }
          >
            <RotateCw
              size={15}
            />

            <span>
              ROTATE
            </span>
          </button>

          <button
            className="toolRow"
            onClick={
              duplicateSelected
            }
            disabled={
              selectedId ===
                null ||
              available <= 0
            }
          >
            <Plus
              size={15}
            />

            <span>
              DUPLICATE
            </span>
          </button>

          <button
            className="toolRow"
            onClick={
              removeSelected
            }
            disabled={
              selectedId ===
              null
            }
          >
            <Trash2
              size={15}
            />

            <span>
              DELETE
            </span>
          </button>

          <p className="category">
            ACTIONS
          </p>

          <div className="actionsGrid">
            <button
              onClick={undo}
              disabled={
                !history.length
              }
            >
              <Undo2
                size={16}
              />

              <span>
                UNDO
              </span>
            </button>

            <button
              onClick={redo}
              disabled={
                !future.length
              }
            >
              <Redo2
                size={16}
              />

              <span>
                REDO
              </span>
            </button>
          </div>

          <p className="category">
            DISPLAY
          </p>

          <label>
            <span>
              GRID
            </span>

            <Switch
              checked={
                gridVisible
              }
              onChange={
                setGridVisible
              }
            />
          </label>

          <label
            title="Snapping alla griglia sempre attivo: necessario per l'incastro e lo stacking dei brick."
          >
            <span>
              SNAP
            </span>

            <Switch
              checked
              disabled
            />
          </label>

          <p className="category">
            VIEW
          </p>

          <button
            className={`viewButton ${
              viewMode ===
              "iso"
                ? "viewSelected"
                : ""
            }`}
            onClick={() =>
              setViewMode(
                "iso"
              )
            }
          >
            ISOMETRIC
          </button>

          <button
            className={`viewButton ${
              viewMode ===
              "top"
                ? "viewSelected"
                : ""
            }`}
            onClick={() =>
              setViewMode(
                "top"
              )
            }
          >
            TOP VIEW
          </button>

          <div className="pieceCount">
            <span>
              PIECE COUNT
            </span>

            <b>
              {bricks.length} / {STARTER_LIMIT}
            </b>
          </div>

          <div className="selectedInfo">
            <span>
              SELECTED
            </span>

            <b>
              {selected
                ? selected.id
                : "—"}
            </b>
          </div>
        </aside>
      </div>

      {showSave && (
        <div
          className="modalBackdrop"
          onClick={() =>
            setShowSave(
              false
            )
          }
        >
          <div
            className="saveModal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >
            {!saved ? (
              <>
                <p className="eyebrow">
                  FINALIZE CREATION
                </p>

                <h2>
                  SAVE YOUR
                  MASTERPIECE
                </h2>

                <p className="modalText">
                  The current camera
                  view becomes the
                  public thumbnail.
                  Adjust the camera
                  before saving.
                </p>

                <label>
                  CREATION NAME

                  <input
                    autoFocus
                    value={title}
                    onChange={(e) =>
                      setTitle(
                        e.target.value
                      )
                    }
                    placeholder="My masterpiece"
                  />
                </label>

                <label>
                  CREATOR NAME

                  <input
                    value={creator}
                    onChange={(e) =>
                      setCreator(
                        e.target.value
                      )
                    }
                    placeholder="Your name or handle"
                  />
                </label>

                <div className="modalPreview">
                  {previewSrc ? (
                    <img
                      src={
                        previewSrc
                      }
                      alt="Current preview"
                    />
                  ) : (
                    <span>
                      PREVIEW
                    </span>
                  )}
                </div>

                <div className="modalActions">
                  <button
                    className="secondaryButton"
                    onClick={() =>
                      setShowSave(
                        false
                      )
                    }
                  >
                    CANCEL
                  </button>

                  <button
                    className="primaryButton"
                    disabled={
                      !title.trim() ||
                      !previewSrc
                    }
                    onClick={
                      confirmSave
                    }
                  >
                    SAVE CREATION →
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="saveSuccess">
                  ✓
                </div>

                <p className="eyebrow">
                  CREATION SAVED
                </p>

                <h2>
                  READY FOR THE
                  SHOWCASE
                </h2>

                <p className="modalText">
                  Saved locally for
                  this prototype.
                  PostgreSQL, permanent
                  thumbnails and public
                  gallery publishing come
                  next.
                </p>

                <div className="modalActions">
                  <Link
                    href="/gallery"
                    className="primaryButton"
                  >
                    OPEN GALLERY →
                  </Link>

                  <button
                    className="secondaryButton"
                    onClick={() =>
                      setShowSave(
                        false
                      )
                    }
                  >
                    KEEP BUILDING
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
