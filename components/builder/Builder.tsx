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

  size: [
    number,
    number,
    number
  ];

  /**
   * Footprint CANONICO del brick.
   *
   * IMPORTANTE:
   * non viene modificato durante la rotazione.
   * La footprint effettivamente occupata dalla
   * rotazione viene calcolata tramite
   * getRotatedFootprint().
   */
  footprint: [
    number,
    number
  ];

  position: [
    number,
    number,
    number
  ];

  color: string;

  shape: BrickShape;

  /**
   * Rotazione reale Three.js sul pivot centrale
   * del group BrickMesh.
   */
  rotationY: number;
};

type BrickKind =
  | "1x1"
  | "2x2"
  | "2x4"
  | "cone"
  | "round";

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
  round: "cylinder"
};

const kindLabel: Record<
  BrickKind,
  string
> = {
  "1x1": "1×1",
  "2x2": "2×2",
  "2x4": "2×4",
  cone: "CONE",
  round: "ROUND"
};

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
  ]
};

const footprints: Record<
  BrickKind,
  [number, number]
> = {
  "1x1": [1, 1],
  "2x2": [2, 2],
  "2x4": [4, 2],
  cone: [1, 1],
  round: [1, 1]
};

const basicKinds: BrickKind[] = [
  "1x1",
  "2x2",
  "2x4"
];

const specialKinds: BrickKind[] = [
  "cone",
  "round"
];

/**
 * Converte un footprint espresso in studs
 * nella dimensione reale in world units.
 *
 * Esempio:
 * [4,2] -> [3.6,1.8]
 */
function footprintSize(
  footprint: [number, number]
): [number, number] {
  return [
    footprint[0] * STUD,
    footprint[1] * STUD
  ];
}

/**
 * Restituisce il footprint canonico del brick.
 *
 * Il valore memorizzato nel brick NON cambia
 * durante la rotazione.
 */
function getFootprint(
  brick: Brick
): [number, number] {
  return [
    brick.footprint[0],
    brick.footprint[1]
  ];
}

/**
 * Restituisce il footprint effettivamente occupato
 * dal brick considerando la rotazione.
 *
 * 0° / 180°:
 *   4x2 -> 4x2
 *
 * 90° / 270°:
 *   4x2 -> 2x4
 *
 * Questa funzione viene usata esclusivamente
 * dalla logica di collisione e stacking.
 *
 * NON modifica il brick e NON modifica la geometria.
 */
function getRotatedFootprint(
  brick: Brick
): [number, number] {
  const quarterTurns =
    Math.round(
      (brick.rotationY ?? 0) /
        (Math.PI / 2)
    );

  return (
    Math.abs(quarterTurns) % 2 === 0
  )
    ? [
        brick.footprint[0],
        brick.footprint[1]
      ]
    : [
        brick.footprint[1],
        brick.footprint[0]
      ];
}

/**
 * Collisione 2D sulla griglia reale.
 *
 * Il footprint è espresso in studs,
 * ma le coordinate Three.js sono espresse
 * in world units.
 *
 * La footprint viene ruotata logicamente
 * senza modificare size o footprint canonici.
 */
function overlaps(
  a: Brick,
  b: Brick
) {
  const [aw, ad] =
    footprintSize(
      getRotatedFootprint(a)
    );

  const [bw, bd] =
    footprintSize(
      getRotatedFootprint(b)
    );

  const ax = Math.abs(
    a.position[0] -
      b.position[0]
  );

  const az = Math.abs(
    a.position[2] -
      b.position[2]
  );

  return (
    ax < (aw + bw) / 2 &&
    az < (ad + bd) / 2
  );
}

function sameLayer(
  a: Brick,
  b: Brick
) {
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
) {
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

/**
 * Determina il livello superiore
 * su cui può essere posizionato il brick.
 *
 * Tutte le coordinate orizzontali
 * utilizzano STUD come unità.
 *
 * La footprint reale tiene conto
 * della rotazione.
 */
function supportedLayer(
  candidate: Brick,
  bricks: Brick[]
) {
  const [cw, cd] =
    getRotatedFootprint(
      candidate
    );

  const cells: Array<
    [number, number]
  > = [];

  /**
   * Genera il centro di ogni cella
   * coperta dal brick.
   *
   * Esempio 2x4:
   *
   * x = -1.35, -0.45, 0.45, 1.35
   * z = -0.45, 0.45
   */
  for (
    let ix = 0;
    ix < cw;
    ix++
  ) {
    for (
      let iz = 0;
      iz < cd;
      iz++
    ) {
      const x =
        candidate.position[0] -
        ((cw - 1) * STUD) / 2 +
        ix * STUD;

      const z =
        candidate.position[2] -
        ((cd - 1) * STUD) / 2 +
        iz * STUD;

      cells.push([
        x,
        z
      ]);
    }
  }

  if (!cells.length) {
    return 0;
  }

  let bestLayer = 0;

  for (const brick of bricks) {
    const layer =
      Math.round(
        (
          brick.position[1] -
          BRICK_HEIGHT / 2
        ) /
          BRICK_HEIGHT
      );

    if (layer < 0) {
      continue;
    }

    const [bw, bd] =
      getRotatedFootprint(
        brick
      );

    /**
     * Limiti reali della superficie
     * occupata dal brick.
     */
    const bMinX =
      brick.position[0] -
      (bw * STUD) / 2;

    const bMaxX =
      brick.position[0] +
      (bw * STUD) / 2;

    const bMinZ =
      brick.position[2] -
      (bd * STUD) / 2;

    const bMaxZ =
      brick.position[2] +
      (bd * STUD) / 2;

    const covers =
      cells.every(
        ([x, z]) =>
          x >= bMinX &&
          x <= bMaxX &&
          z >= bMinZ &&
          z <= bMaxZ
      );

    if (covers) {
      bestLayer =
        Math.max(
          bestLayer,
          layer + 1
        );
    }
  }

  return bestLayer;
}

function buildCandidate(
  kind: BrickKind,
  color: string,
  point: THREE.Vector3,
  bricks: Brick[],
  forcedLayer?: number
): Brick {
  /**
   * Snap reale:
   *
   * 0.00
   * 0.90
   * 1.80
   * 2.70
   * ...
   */
  const x =
    Math.round(
      point.x / STUD
    ) * STUD;

  const z =
    Math.round(
      point.z / STUD
    ) * STUD;

  const layer =
    forcedLayer ??
    supportedLayer(
      {
        id: -1,

        size:
          sizes[kind],

        footprint:
          footprints[kind],

        position: [
          x,
          0,
          z
        ],

        color,

        shape:
          shapeOf[kind],

        rotationY: 0
      },
      bricks
    );

  return {
    id:
      Date.now() +
      Math.floor(
        Math.random() * 1000
      ),

    size:
      sizes[kind],

    footprint:
      footprints[kind],

    position: [
      x,

      BRICK_HEIGHT / 2 +
        layer *
          BRICK_HEIGHT,

      z
    ],

    color,

    shape:
      shapeOf[kind],

    rotationY: 0
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
  onSelect,
  onHover,
  onPlace
}: {
  brick: Brick;

  selected: boolean;

  onSelect: (
    id: number
  ) => void;

  onHover: (
    point: THREE.Vector3
  ) => void;

  onPlace: (
    point: THREE.Vector3
  ) => void;
}) {
  return (
    <group
      position={
        brick.position
      }
      rotation={[
        0,
        brick.rotationY ?? 0,
        0
      ]}
      onClick={(e) => {
        e.stopPropagation();

        if (e.shiftKey) {
          onPlace(e.point);
        } else {
          onSelect(
            brick.id
          );
        }
      }}
      onPointerMove={(e) => {
        e.stopPropagation();

        onHover(
          e.point
        );
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
  ghost,
  ghostValid,
  onSelect,
  onPointer,
  onCaptureReady,
  onPlace,
  viewMode,
  gridVisible
}: {
  bricks: Brick[];

  selectedId:
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

  viewMode:
    | "iso"
    | "top";

  gridVisible: boolean;
}) {
  const groundHover = (
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();

    onPointer(
      e.point
    );
  };

  const groundClick = (
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();

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
            onSelect={
              onSelect
            }
            onHover={
              onPointer
            }
            onPlace={
              onPlace
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

// Miniatura CSS del brick per la palette.
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

// Interruttore a scorrimento.
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
        b.rotationY ?? 0
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
    100 -
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

  /**
   * Ruota il brick di 90°.
   *
   * La geometria NON viene modificata.
   * Il footprint canonico NON viene modificato.
   *
   * La sola proprietà che cambia è rotationY.
   *
   * BrickMesh applica poi realmente la rotazione
   * al group Three.js.
   */
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

        const normalizedRotation =
          (
            currentRotation +
            Math.PI / 2
          ) %
            (Math.PI * 2);

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

        /**
         * La collisione utilizza
         * getRotatedFootprint(),
         * quindi il brick viene verificato
         * con la footprint corretta per
         * l'orientamento corrente.
         */
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

  /**
   * Movimento di una cella reale.
   *
   * dx e dz arrivano già in world units.
   * Tutti i chiamanti utilizzano STUD.
   */
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
                      b.position[0] +
                        dx,

                      b.position[1],

                      b.position[2] +
                        dz
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
          -STUD,
          0
        );
      }

      if (
        e.key ===
        "ArrowRight"
      ) {
        moveSelected(
          STUD,
          0
        );
      }

      if (
        e.key ===
        "ArrowUp"
      ) {
        moveSelected(
          0,
          -STUD
        );
      }

      if (
        e.key ===
        "ArrowDown"
      ) {
        moveSelected(
          0,
          STUD
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
              b.rotationY ?? 0
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
                        setColor(
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
                  {available} / 100
                </b>
              </div>

              <div className="progress">
                <i
                  style={{
                    width: `${available}%`
                  }}
                />
              </div>

              <p className="panelHelp">
                Hover the grid to
                preview placement —
                green is valid, red is
                blocked. Click empty
                grid to place. Click a
                brick to select it,
                Shift+Click a brick to
                stack on top.
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
              {ghost
                ? ghostValid
                  ? "PLACEMENT READY"
                  : "BLOCKED"
                : selected
                ? "BRICK SELECTED"
                : "READY TO BUILD"}
            </span>
          </div>

          <div className="sceneHint">
            HOVER TO PREVIEW · CLICK
            TO PLACE · CLICK BRICK TO
            SELECT · ARROWS MOVE · R
            ROTATE · CTRL/CMD+Z UNDO
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
            >
              <Plus
                size={14}
              />{" "}
              ADD BRICK
            </button>

            <button
              onClick={
                removeSelected
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
                  -STUD,
                  0
                )
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
                  STUD,
                  0
                )
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
                  -STUD
                )
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
                  STUD
                )
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
                      setColor(
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
                -STUD,
                0
              )
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
              removeSelected
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
              {bricks.length} / 100
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
                        e.target
                          .value
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
                        e.target
                          .value
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
