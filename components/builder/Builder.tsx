"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import {
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  RoundedBox
} from "@react-three/drei";
import * as THREE from "three";
import {
  ChevronLeft,
  ChevronRight,
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
  ArrowDown,
  Layers3,
  Grid3X3,
  Box,
  Eye,
  EyeOff,
  Maximize2
} from "lucide-react";

type BrickKind =
  | "1x1"
  | "1x2"
  | "2x2"
  | "2x4"
  | "2x6"
  | "round"
  | "cone";

type BrickShape =
  | "box"
  | "cylinder"
  | "cone";

type ViewMode =
  | "iso"
  | "top"
  | "front"
  | "side";

type Vec3 = [
  number,
  number,
  number
];

type Footprint = [
  number,
  number
];

type Brick = {
  id: number;
  kind: BrickKind;
  shape: BrickShape;
  footprint: Footprint;
  size: Vec3;
  position: Vec3;
  rotation: 0 | 90 | 180 | 270;
  color: string;
  layer: number;
};

type Snapshot = Brick[];

const BRICK_HEIGHT = 0.44;
const STUD_SPACING = 0.92;
const STUD_RADIUS = 0.145;
const STUD_HEIGHT = 0.105;
const STARTER_LIMIT = 100;

const palette = [
  "#C91F2D",
  "#E35B19",
  "#F6B800",
  "#F2D64B",
  "#168B4B",
  "#53B84A",
  "#0877B9",
  "#2E58B8",
  "#6B42A8",
  "#D84C9B",
  "#111827",
  "#F2F0E8"
];

const brickDefs: Record<
  BrickKind,
  {
    footprint: Footprint;
    shape: BrickShape;
    label: string;
  }
> = {
  "1x1": {
    footprint: [1, 1],
    shape: "box",
    label: "1×1"
  },

  "1x2": {
    footprint: [2, 1],
    shape: "box",
    label: "1×2"
  },

  "2x2": {
    footprint: [2, 2],
    shape: "box",
    label: "2×2"
  },

  "2x4": {
    footprint: [4, 2],
    shape: "box",
    label: "2×4"
  },

  "2x6": {
    footprint: [6, 2],
    shape: "box",
    label: "2×6"
  },

  round: {
    footprint: [1, 1],
    shape: "cylinder",
    label: "ROUND"
  },

  cone: {
    footprint: [1, 1],
    shape: "cone",
    label: "CONE"
  }
};

const basicKinds: BrickKind[] = [
  "1x1",
  "1x2",
  "2x2",
  "2x4",
  "2x6"
];

const specialKinds: BrickKind[] = [
  "round",
  "cone"
];

function sizeFor(
  footprint: Footprint
): Vec3 {
  return [
    footprint[0] * STUD_SPACING,
    BRICK_HEIGHT,
    footprint[1] * STUD_SPACING
  ];
}

function effectiveFootprint(
  kind: BrickKind,
  rotation: 0 | 90 | 180 | 270
): Footprint {
  const [w, d] =
    brickDefs[kind].footprint;

  return rotation % 180 === 0
    ? [w, d]
    : [d, w];
}

function cellAnchor(
  position: Vec3,
  footprint: Footprint
): [number, number] {
  return [
    Math.round(
      position[0] -
        (footprint[0] - 1) / 2
    ),
    Math.round(
      position[2] -
        (footprint[1] - 1) / 2
    )
  ];
}

function cellsFor(
  brick: Brick
): string[] {
  const [w, d] =
    brick.footprint;

  const [ax, az] =
    cellAnchor(
      brick.position,
      brick.footprint
    );

  const cells: string[] = [];

  for (
    let x = ax;
    x < ax + w;
    x++
  ) {
    for (
      let z = az;
      z < az + d;
      z++
    ) {
      cells.push(
        `${x}:${z}`
      );
    }
  }

  return cells;
}

function layerFromY(
  y: number
) {
  return Math.max(
    0,
    Math.round(
      (y - BRICK_HEIGHT / 2) /
        BRICK_HEIGHT
    )
  );
}

function occupied(
  bricks: Brick[],
  ignoreId?: number
) {
  const map =
    new Map<string, number>();

  for (const brick of bricks) {
    if (
      brick.id === ignoreId
    ) {
      continue;
    }

    for (
      const cell of cellsFor(
        brick
      )
    ) {
      map.set(
        `${brick.layer}:${cell}`,
        brick.id
      );
    }
  }

  return map;
}

function highestSupportedLayer(
  candidate: Brick,
  bricks: Brick[]
) {
  const cells =
    cellsFor(candidate);

  let layer = 0;

  const map =
    occupied(
      bricks,
      candidate.id
    );

  for (
    let test = 0;
    test < 60;
    test++
  ) {
    const supported =
      test === 0 ||
      cells.every(
        (cell) =>
          map.has(
            `${test - 1}:${cell}`
          )
      );

    const clear =
      cells.every(
        (cell) =>
          !map.has(
            `${test}:${cell}`
          )
      );

    if (
      supported &&
      clear
    ) {
      layer = test;
    } else if (
      test >
      layer + 1
    ) {
      break;
    }
  }

  return layer;
}

function isValid(
  candidate: Brick,
  bricks: Brick[]
) {
  const map =
    occupied(
      bricks,
      candidate.id
    );

  return (
    cellsFor(candidate).every(
      (cell) =>
        !map.has(
          `${candidate.layer}:${cell}`
        )
    ) &&
    (
      candidate.layer === 0 ||
      cellsFor(candidate).every(
        (cell) =>
          map.has(
            `${candidate.layer - 1}:${cell}`
          )
      )
    )
  );
}

function id() {
  return (
    Date.now() +
    Math.floor(
      Math.random() * 100000
    )
  );
}

/*
 * Snap del centro del brick.
 *
 * Brick con dimensione dispari:
 *   1 stud -> centro su intero
 *
 * Brick con dimensione pari:
 *   2/4/6 stud -> centro su mezzo stud
 *
 * Questo permette di mantenere il brick perfettamente
 * allineato alla griglia indipendentemente dalla dimensione.
 */
function snapCenter(
  value: number,
  span: number
) {
  const offset =
    (span - 1) / 2;

  return (
    Math.round(
      value - offset
    ) + offset
  );
}

/*
 * Piano orizzontale utilizzato esclusivamente durante
 * il drag.
 *
 * Il mouse viene trasformato in un punto X/Z indipendente
 * dalla geometria del brick.
 */
function dragPlanePoint(
  ray: THREE.Ray
): THREE.Vector3 | null {
  const plane =
    new THREE.Plane(
      new THREE.Vector3(
        0,
        1,
        0
      ),
      0
    );

  const point =
    new THREE.Vector3();

  return ray.intersectPlane(
    plane,
    point
  );
}

function makeBrick(
  kind: BrickKind,
  color: string,
  point: THREE.Vector3,
  bricks: Brick[],
  rotation:
    | 0
    | 90
    | 180
    | 270 = 0,
  forcedLayer?: number
): Brick {
  const footprint =
    effectiveFootprint(
      kind,
      rotation
    );

  const [w, d] =
    footprint;

  const ax =
    Math.round(
      point.x -
        (w - 1) / 2
    );

  const az =
    Math.round(
      point.z -
        (d - 1) / 2
    );

  const center: Vec3 = [
    ax + (w - 1) / 2,
    0,
    az + (d - 1) / 2
  ];

  const provisional: Brick = {
    id: id(),
    kind,
    shape:
      brickDefs[kind].shape,
    footprint,
    size:
      sizeFor(footprint),
    position:
      center,
    rotation,
    color,
    layer: 0
  };

  const layer =
    forcedLayer ??
    highestSupportedLayer(
      provisional,
      bricks
    );

  provisional.layer =
    layer;

  provisional.position = [
    center[0],
    layer *
      BRICK_HEIGHT +
      BRICK_HEIGHT / 2,
    center[2]
  ];

  return provisional;
}

function cloneBricks(
  bricks: Brick[]
): Brick[] {
  return bricks.map(
    (b) => ({
      ...b,
      position: [
        ...b.position
      ] as Vec3,
      footprint: [
        ...b.footprint
      ] as Footprint,
      size: [
        ...b.size
      ] as Vec3
    })
  );
}

function initialScene(): Brick[] {
  const add = (
    kind: BrickKind,
    color: string,
    x: number,
    z: number,
    layer: number,
    rotation:
      | 0
      | 90
      | 180
      | 270 = 0,
    idValue = id()
  ): Brick => {
    const footprint =
      effectiveFootprint(
        kind,
        rotation
      );

    return {
      id: idValue,
      kind,
      shape:
        brickDefs[kind].shape,
      footprint,
      size:
        sizeFor(footprint),
      position: [
        x,
        layer *
          BRICK_HEIGHT +
          BRICK_HEIGHT / 2,
        z
      ],
      rotation,
      color,
      layer
    };
  };

  return [
    add(
      "2x4",
      "#168B4B",
      -1.5,
      0,
      0,
      0,
      101
    ),

    add(
      "2x4",
      "#168B4B",
      2.5,
      0,
      0,
      0,
      102
    ),

    add(
      "2x2",
      "#0877B9",
      0,
      0,
      1,
      0,
      103
    ),

    add(
      "2x2",
      "#0877B9",
      2,
      0,
      1,
      0,
      104
    ),

    add(
      "2x2",
      "#F6B800",
      1,
      0,
      2,
      0,
      105
    ),

    add(
      "1x2",
      "#D84C9B",
      1,
      1,
      3,
      90,
      106
    )
  ];
}

function Studs({
  footprint,
  color,
  ghost = false
}: {
  footprint: Footprint;
  color: string;
  ghost?: boolean;
}) {
  const [w, d] =
    footprint;

  const xs =
    Array.from(
      { length: w },
      (_, i) =>
        (i - (w - 1) / 2) *
        STUD_SPACING
    );

  const zs =
    Array.from(
      { length: d },
      (_, i) =>
        (i - (d - 1) / 2) *
        STUD_SPACING
    );

  return (
    <group
      position={[
        0,
        BRICK_HEIGHT / 2 +
          STUD_HEIGHT / 2 -
          0.008,
        0
      ]}
    >
      {xs.flatMap(
        (x) =>
          zs.map(
            (z) => (
              <group
                key={`${x}-${z}`}
                position={[
                  x,
                  0,
                  z
                ]}
              >
                <mesh
                  castShadow={!ghost}
                >
                  <cylinderGeometry
                    args={[
                      STUD_RADIUS,
                      STUD_RADIUS *
                        1.04,
                      STUD_HEIGHT,
                      24
                    ]}
                  />

                  <meshStandardMaterial
                    color={color}
                    roughness={0.28}
                    metalness={0.01}
                    transparent={
                      ghost
                    }
                    opacity={
                      ghost
                        ? 0.55
                        : 1
                    }
                  />
                </mesh>

                <mesh
                  position={[
                    0,
                    STUD_HEIGHT / 2 +
                      0.002,
                    0
                  ]}
                >
                  <torusGeometry
                    args={[
                      0.111,
                      0.021,
                      8,
                      20
                    ]}
                  />

                  <meshStandardMaterial
                    color={
                      ghost
                        ? "#ffffff"
                        : color
                    }
                    roughness={0.3}
                    metalness={0.02}
                    transparent={
                      ghost
                    }
                    opacity={
                      ghost
                        ? 0.35
                        : 0.72
                    }
                  />
                </mesh>
              </group>
            )
          )
      )}
    </group>
  );
}

function BrickModel({
  brick,
  ghost = false
}: {
  brick: Brick;
  ghost?: boolean;
}) {
  const color =
    ghost
      ? brick.color
      : brick.color;

  const size: Vec3 = [
    brick.footprint[0] *
        STUD_SPACING -
      0.035,

    BRICK_HEIGHT,

    brick.footprint[1] *
        STUD_SPACING -
      0.035
  ];

  const materialColor =
    ghost
      ? color
      : color;

  return (
    <group
      rotation-y={THREE.MathUtils.degToRad(
        brick.rotation
      )}
    >
      <RoundedBox
        args={size}
        radius={0.075}
        smoothness={4}
        castShadow={!ghost}
        receiveShadow={!ghost}
      >
        <meshStandardMaterial
          color={materialColor}
          roughness={0.31}
          metalness={0.015}
          transparent={ghost}
          opacity={
            ghost
              ? 0.42
              : 1
          }
          depthWrite={!ghost}
        />
      </RoundedBox>

      <Studs
        footprint={
          brickDefs[
            brick.kind
          ]?.footprint ??
          brick.footprint
        }
        color={
          materialColor
        }
        ghost={ghost}
      />

      {!ghost && (
        <mesh
          position={[
            0,
            -BRICK_HEIGHT / 2 +
              0.012,
            0
          ]}
          receiveShadow
        >
          <boxGeometry
            args={[
              Math.max(
                0.08,
                size[0] -
                  0.09
              ),
              0.024,
              Math.max(
                0.08,
                size[2] -
                  0.09
              )
            ]}
          />

          <meshStandardMaterial
            color={color}
            roughness={0.42}
          />
        </mesh>
      )}
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
    id: number,
    ray: THREE.Ray
  ) => void;

  onDragMove: (
    ray: THREE.Ray
  ) => void;

  onDragEnd: () => void;
}) {
  const size =
    sizeFor(
      brick.footprint
    );

  return (
    <group
      position={
        brick.position
      }

      onClick={(e) => {
        e.stopPropagation();

        if (dragging) {
          return;
        }

        if (e.shiftKey) {
          onPlace(
            e.point
          );
        } else {
          onSelect(
            brick.id
          );
        }
      }}

      /*
       * LEFT CLICK SU BRICK:
       *
       * - seleziona il pezzo
       * - blocca OrbitControls
       * - avvia il drag
       */
      onPointerDown={(e) => {
        e.stopPropagation();

        if (e.button !== 0) {
          return;
        }

        onSelect(
          brick.id
        );

        onDragStart(
          brick.id,
          e.ray
        );
      }}

      onPointerMove={(e) => {
        e.stopPropagation();

        if (dragging) {
          onDragMove(
            e.ray
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

      onPointerCancel={(e) => {
        e.stopPropagation();
        onDragEnd();
      }}
    >
      <BrickModel
        brick={brick}
      />

      {selected && (
        <mesh
          position={[
            0,
            BRICK_HEIGHT / 2 +
              STUD_HEIGHT +
              0.01,
            0
          ]}
          rotation-y={THREE.MathUtils.degToRad(
            brick.rotation
          )}
        >
          <boxGeometry
            args={[
              size[0] + 0.11,
              0.025,
              size[2] + 0.11
            ]}
          />

          <meshBasicMaterial
            color="#8b5cf6"
            wireframe
          />
        </mesh>
      )}
    </group>
  );
}

function GhostBrick({
  brick,
  valid
}: {
  brick: Brick;
  valid: boolean;
}) {
  const ghost = {
    ...brick,
    color: valid
      ? "#37E38B"
      : "#FF3347"
  };

  return (
    <group
      position={
        brick.position
      }
    >
      <BrickModel
        brick={ghost}
        ghost
      />
    </group>
  );
}

function CameraController({
  viewMode
}: {
  viewMode: ViewMode;
}) {
  const { camera } =
    useThree();

  useEffect(() => {
    const target =
      new THREE.Vector3(
        0,
        0.9,
        0
      );

    if (
      viewMode === "top"
    ) {
      camera.position.set(
        0,
        12,
        0.01
      );
    } else if (
      viewMode === "front"
    ) {
      camera.position.set(
        0,
        4.5,
        11
      );
    } else if (
      viewMode === "side"
    ) {
      camera.position.set(
        11,
        4.5,
        0
      );
    } else {
      camera.position.set(
        8.5,
        6.5,
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

  ghost:
    | Brick
    | null;

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
    id: number,
    ray: THREE.Ray
  ) => void;

  onDragMove: (
    ray: THREE.Ray
  ) => void;

  onDragEnd: () => void;

  viewMode: ViewMode;

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
        e.ray
      );
    } else {
      onPointer(
        e.point
      );
    }
  };

  const groundClick = (
    e: ThreeEvent<PointerEvent>
  ) => {
    e.stopPropagation();

    if (
      draggingId === null
    ) {
      onPlace(
        e.point
      );
    }
  };

  return (
    <Canvas
      shadows
      camera={{
        position: [
          8.5,
          6.5,
          9
        ],
        fov: 42
      }}
      gl={{
        preserveDrawingBuffer:
          true
      }}
    >
      <color
        attach="background"
        args={[
          "#070a11"
        ]}
      />

      <ambientLight
        intensity={0.7}
      />

      <hemisphereLight
        intensity={0.48}
        groundColor="#05070c"
      />

      <directionalLight
        position={[
          6,
          10,
          5
        ]}
        intensity={3.2}
        castShadow
        shadow-mapSize={[
          2048,
          2048
        ]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      <pointLight
        position={[
          -6,
          5,
          -5
        ]}
        intensity={0.55}
        color="#5b7cff"
      />

      {gridVisible && (
        <Grid
          args={[
            32,
            32
          ]}
          cellSize={1}
          cellThickness={0.55}
          cellColor="#273044"
          sectionSize={5}
          sectionThickness={1.1}
          sectionColor="#46516b"
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
          -0.035,
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
            32,
            32
          ]}
        />

        <shadowMaterial
          opacity={0.24}
        />
      </mesh>

      {/*
       * Piano invisibile usato durante il drag.
       *
       * Serve a garantire un riferimento stabile X/Z anche
       * quando il mouse passa sopra altri brick.
       */}
      {draggingId !== null && (
        <mesh
          rotation={[
            -Math.PI / 2,
            0,
            0
          ]}
          position={[
            0,
            0,
            0
          ]}
          onPointerMove={(e) => {
            e.stopPropagation();

            onDragMove(
              e.ray
            );
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            onDragEnd();
          }}
          onPointerCancel={(e) => {
            e.stopPropagation();
            onDragEnd();
          }}
        >
          <planeGeometry
            args={[
              40,
              40
            ]}
          />

          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      )}

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

      {ghost &&
        draggingId ===
          null && (
          <GhostBrick
            brick={ghost}
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

      <CaptureBridge
        onReady={
          onCaptureReady
        }
      />

      {/*
       * BLOCCO CAMERA DURANTE IL DRAG.
       *
       * Questo è il punto principale della correzione:
       * mentre un brick viene trascinato OrbitControls è
       * completamente disabilitato.
       */}
      <OrbitControls
        enabled={
          draggingId ===
          null
        }
        makeDefault
        enableDamping
        dampingFactor={0.075}
        target={[
          0,
          0.9,
          0
        ]}
        minDistance={4}
        maxDistance={25}
      />

      <GizmoHelper
        alignment="bottom-right"
        margin={[
          60,
          60
        ]}
      >
        <GizmoViewport
          axisColors={[
            "#f87171",
            "#4ade80",
            "#60a5fa"
          ]}
          labelColor="#dbe4ff"
          hideNegativeAxes
        />
      </GizmoHelper>
    </Canvas>
  );
}

function CaptureBridge({
  onReady
}: {
  onReady: (
    capture: () => string
  ) => void;
}) {
  const { gl } =
    useThree();

  useEffect(() => {
    onReady(
      () =>
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

function BrickThumb({
  footprint,
  color
}: {
  footprint: Footprint;
  color: string;
}) {
  const [w, d] =
    footprint;

  return (
    <div
      className="brickThumbPro"
      style={{
        aspectRatio:
          `${w}/${d}`,
        background:
          color
      }}
    >
      <div
        className="thumbStuds"
        style={{
          gridTemplateColumns:
            `repeat(${w},1fr)`
        }}
      >
        {Array.from({
          length:
            w * d
        }).map(
          (_, i) => (
            <i
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

export default function Builder() {
  const [
    color,
    setColor
  ] = useState(
    palette[0]
  );

  const [
    kind,
    setKind
  ] =
    useState<BrickKind>(
      "2x2"
    );

  const [
    bricks,
    setBricks
  ] = useState<Brick[]>(
    initialScene
  );

  const [
    selectedId,
    setSelectedId
  ] =
    useState<
      number | null
    >(null);

  /*
   * ID del brick attualmente trascinato.
   */
  const [
    draggingId,
    setDraggingId
  ] =
    useState<
      number | null
    >(null);

  /*
   * Offset tra il punto esatto in cui l'utente
   * ha cliccato e il centro del brick.
   *
   * Evita il classico "salto" quando inizia il drag.
   */
  const dragOffset =
    useRef({
      x: 0,
      z: 0
    });

  /*
   * La cronologia del drag viene salvata solamente
   * quando il brick viene realmente spostato.
   *
   * Un semplice click non genera una voce Undo.
   */
  const dragHistoryCommitted =
    useRef(false);

  const [
    history,
    setHistory
  ] =
    useState<
      Snapshot[]
    >([]);

  const [
    future,
    setFuture
  ] =
    useState<
      Snapshot[]
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
    useState<ViewMode>(
      "iso"
    );

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

  const [
    saved,
    setSaved
  ] =
    useState(false);

  const [
    previewSrc,
    setPreviewSrc
  ] =
    useState<
      string | null
    >(null);

  const [
    title,
    setTitle
  ] =
    useState("");

  const [
    creator,
    setCreator
  ] =
    useState("");

  const [
    editingTitle,
    setEditingTitle
  ] =
    useState(false);

  const [
    toast,
    setToast
  ] =
    useState("");

  const available =
    Math.max(
      0,
      STARTER_LIMIT -
        bricks.length
    );

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
          ? makeBrick(
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
    isValid(
      ghost,
      bricks
    );

  const notify =
    useCallback(
      (
        message: string
      ) => {
        setToast(
          message
        );

        window.setTimeout(
          () =>
            setToast(""),
          1400
        );
      },
      []
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
          notify(
            "STARTER SET EMPTY"
          );
          return;
        }

        const next =
          makeBrick(
            kind,
            color,
            point,
            bricks
          );

        if (
          !isValid(
            next,
            bricks
          )
        ) {
          notify(
            "NO STUD SUPPORT HERE"
          );
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
        kind,
        notify
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

  const rotateSelected =
    useCallback(
      () => {
        if (!selected) {
          return;
        }

        const nextRotation =
          ((
            selected.rotation +
            90
          ) % 360) as
            | 0
            | 90
            | 180
            | 270;

        const footprint =
          effectiveFootprint(
            selected.kind,
            nextRotation
          );

        const rotated: Brick =
          {
            ...selected,
            rotation:
              nextRotation,
            footprint,
            size:
              sizeFor(
                footprint
              )
          };

        const others =
          bricks.filter(
            (b) =>
              b.id !==
              selected.id
          );

        const layer =
          highestSupportedLayer(
            rotated,
            others
          );

        const anchor =
          cellAnchor(
            selected.position,
            selected.footprint
          );

        const center: Vec3 =
          [
            anchor[0] +
              (footprint[0] -
                1) /
                2,

            layer *
                BRICK_HEIGHT +
              BRICK_HEIGHT /
                2,

            anchor[1] +
              (footprint[1] -
                1) /
                2
          ];

        const candidate =
          {
            ...rotated,
            position:
              center,
            layer
          };

        if (
          !isValid(
            candidate,
            others
          )
        ) {
          notify(
            "ROTATION BLOCKED"
          );
          return;
        }

        commit([
          ...others,
          candidate
        ]);
      },
      [
        bricks,
        commit,
        notify,
        selected
      ]
    );

  const moveSelected =
    useCallback(
      (
        dx: number,
        dz: number
      ) => {
        if (!selected) {
          return;
        }

        const others =
          bricks.filter(
            (b) =>
              b.id !==
              selected.id
          );

        const candidate =
          {
            ...selected,
            position: [
              selected.position[0] +
                dx,
              selected.position[1],
              selected.position[2] +
                dz
            ] as Vec3
          };

        if (
          !isValid(
            candidate,
            others
          )
        ) {
          notify(
            "MOVE BLOCKED"
          );
          return;
        }

        commit([
          ...others,
          candidate
        ]);
      },
      [
        bricks,
        commit,
        notify,
        selected
      ]
    );

  /*
   * INIZIO DRAG
   *
   * Calcoliamo il punto del mouse sul piano X/Z
   * e memorizziamo l'offset rispetto al centro del brick.
   */
  const startDragging =
    useCallback(
      (
        idValue: number,
        ray: THREE.Ray
      ) => {
        const brick =
          bricks.find(
            (b) =>
              b.id ===
              idValue
          );

        const point =
          dragPlanePoint(
            ray
          );

        if (
          !brick ||
          !point
        ) {
          return;
        }

        dragOffset.current =
          {
            x:
              brick.position[0] -
              point.x,

            z:
              brick.position[2] -
              point.z
          };

        dragHistoryCommitted.current =
          false;

        setSelectedId(
          idValue
        );

        /*
         * Questo stato disabilita immediatamente
         * OrbitControls.
         */
        setDraggingId(
          idValue
        );
      },
      [bricks]
    );

  /*
   * MOVIMENTO DRAG
   *
   * Il movimento è calcolato sul piano X/Z,
   * non sulla superficie del brick.
   */
  const dragMove =
    useCallback(
      (
        ray: THREE.Ray
      ) => {
        if (
          draggingId ===
          null
        ) {
          return;
        }

        const point =
          dragPlanePoint(
            ray
          );

        if (!point) {
          return;
        }

        setBricks(
          (current) => {
            const currentBrick =
              current.find(
                (b) =>
                  b.id ===
                  draggingId
              );

            if (
              !currentBrick
            ) {
              return current;
            }

            const [
              w,
              d
            ] =
              currentBrick.footprint;

            /*
             * Snap intelligente in base al footprint.
             */
            const x =
              snapCenter(
                point.x +
                  dragOffset
                    .current
                    .x,
                w
              );

            const z =
              snapCenter(
                point.z +
                  dragOffset
                    .current
                    .z,
                d
              );

            /*
             * Nessun aggiornamento React se il brick
             * è già sulla stessa cella.
             */
            if (
              x ===
                currentBrick
                  .position[0] &&
              z ===
                currentBrick
                  .position[2]
            ) {
              return current;
            }

            const candidate:
              Brick = {
              ...currentBrick,

              position: [
                x,
                currentBrick
                  .position[1],
                z
              ]
            };

            const others =
              current.filter(
                (b) =>
                  b.id !==
                  draggingId
              );

            /*
             * Se la posizione non è valida,
             * manteniamo l'ultima posizione valida.
             */
            if (
              !isValid(
                candidate,
                others
              )
            ) {
              return current;
            }

            /*
             * Salviamo lo snapshot Undo solamente
             * al primo movimento reale.
             */
            if (
              !dragHistoryCommitted.current
            ) {
              dragHistoryCommitted.current =
                true;

              setHistory(
                (h) => [
                  ...h.slice(
                    -39
                  ),
                  cloneBricks(
                    current
                  )
                ]
              );

              setFuture([]);
            }

            return current.map(
              (b) =>
                b.id ===
                draggingId
                  ? candidate
                  : b
            );
          }
        );
      },
      [draggingId]
    );

  /*
   * FINE DRAG
   */
  const endDragging =
    useCallback(
      () => {
        setDraggingId(
          null
        );

        dragOffset.current =
          {
            x: 0,
            z: 0
          };

        dragHistoryCommitted.current =
          false;
      },
      []
    );

  /*
   * Safety net:
   * se il mouse esce dal canvas mentre il brick è
   * trascinato, il drag viene comunque chiuso.
   */
  useEffect(() => {
    if (
      draggingId ===
      null
    ) {
      return;
    }

    const handlePointerUp =
      () =>
        endDragging();

    window.addEventListener(
      "pointerup",
      handlePointerUp
    );

    window.addEventListener(
      "pointercancel",
      handlePointerUp
    );

    return () => {
      window.removeEventListener(
        "pointerup",
        handlePointerUp
      );

      window.removeEventListener(
        "pointercancel",
        handlePointerUp
      );
    };
  }, [
    draggingId,
    endDragging
  ]);

  const undo =
    useCallback(
      () => {
        const previous =
          history.at(-1);

        if (!previous) {
          return;
        }

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

        if (!next) {
          return;
        }

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
      },
      [
        bricks,
        future
      ]
    );

  useEffect(() => {
    const raw =
      localStorage.getItem(
        "brick-builder-draft-state"
      );

    if (!raw) {
      return;
    }

    try {
      const parsed =
        JSON.parse(
          raw
        ) as Brick[];

      /*
       * Un pezzo salvato da una versione precedente
       * (es. il vecchio "MICRO") potrebbe non esistere
       * più in brickDefs. Se lo teniamo, il render
       * crasha subito con "Cannot read properties of
       * undefined (reading 'footprint')". Lo scartiamo
       * qui invece di lasciarlo passare.
       */
      const valid =
        Array.isArray(
          parsed
        )
          ? parsed.filter(
              (b) =>
                b &&
                brickDefs[
                  b.kind
                ]
            )
          : [];

      if (
        valid.length
      ) {
        setBricks(
          valid
        );
      } else if (
        parsed?.length
      ) {
        /*
         * C'erano dati ma nessun pezzo era più
         * valido: ripuliamo il draft corrotto.
         */
        localStorage.removeItem(
          "brick-builder-draft-state"
        );
      }
    } catch {
      /*
       * Ignore malformed
       * local draft.
       */
      localStorage.removeItem(
        "brick-builder-draft-state"
      );
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

  useEffect(() => {
    const handler =
      (
        e: KeyboardEvent
      ) => {
        const target =
          e.target as
            | HTMLElement
            | null;

        if (
          target?.tagName ===
            "INPUT" ||
          target?.tagName ===
            "TEXTAREA"
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
            -1,
            0
          );
        }

        if (
          e.key ===
          "ArrowRight"
        ) {
          moveSelected(
            1,
            0
          );
        }

        if (
          e.key ===
          "ArrowUp"
        ) {
          moveSelected(
            0,
            -1
          );
        }

        if (
          e.key ===
          "ArrowDown"
        ) {
          moveSelected(
            0,
            1
          );
        }

        if (
          (e.ctrlKey ||
            e.metaKey) &&
          e.key.toLowerCase() ===
            "z"
        ) {
          e.preventDefault();
          undo();
        }

        if (
          (e.ctrlKey ||
            e.metaKey) &&
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

  const openSave =
    () => {
      setSaved(
        false
      );

      setPreviewSrc(
        capture
          ? capture()
          : null
      );

      setShowSave(
        true
      );
    };

  const confirmSave =
    () => {
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

      setSaved(
        true
      );
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
            BRICK
          </Link>

          <Link
            href="/gallery"
            className="backLink"
          >
            <ChevronLeft
              size={14}
            />
            GALLERY
          </Link>
        </div>

        <div className="creationTitle">
          {editingTitle ? (
            <input
              autoFocus
              className="titleInput"
              value={
                title
              }
              placeholder="UNTITLED CREATION"
              onChange={(
                e
              ) =>
                setTitle(
                  e.target.value
                )
              }
              onBlur={() =>
                setEditingTitle(
                  false
                )
              }
              onKeyDown={(
                e
              ) => {
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
                onClick={() =>
                  setEditingTitle(
                    true
                  )
                }
              >
                EDIT
              </button>
            </>
          )}
        </div>

        <div className="builderActions">
          <button
            onClick={
              undo
            }
            disabled={
              !history.length
            }
          >
            <Undo2
              size={15}
            />
          </button>

          <button
            onClick={
              redo
            }
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
          gridTemplateColumns:
            `${
              panelOpen
                ? 246
                : 58
            }px 1fr 232px`
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
                PARTS LIBRARY
              </p>
            )}

            <button
              className="collapseBtn"
              onClick={() =>
                setPanelOpen(
                  (v) =>
                    !v
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
                BRICKS
              </p>

              <div className="brickPalette proPalette">
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
                        setKind(
                          k
                        )
                      }
                    >
                      <BrickThumb
                        footprint={
                          brickDefs[
                            k
                          ]
                            .footprint
                        }
                        color={
                          color
                        }
                      />

                      <span>
                        {
                          brickDefs[
                            k
                          ].label
                        }
                      </span>
                    </button>
                  )
                )}
              </div>

              <p className="category">
                SPECIAL PARTS
              </p>

              <div className="brickPalette proPalette">
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
                        setKind(
                          k
                        )
                      }
                    >
                      <BrickThumb
                        footprint={
                          brickDefs[
                            k
                          ]
                            .footprint
                        }
                        color={
                          color
                        }
                      />

                      <span>
                        {
                          brickDefs[
                            k
                          ].label
                        }
                      </span>
                    </button>
                  )
                )}
              </div>

              <p className="category">
                COLOR / PLASTIC
              </p>

              <div className="colorPalette proColors">
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

              <div className="materialNote">
                <span
                  className="materialSwatch"
                  style={{
                    background:
                      color
                  }}
                />

                <div>
                  <b>
                    ABS PLASTIC
                  </b>

                  <small>
                    Gloss · molded color
                  </small>
                </div>
              </div>

              <p className="category">
                STARTER SET
              </p>

              <div className="available">
                <span>
                  PIECES LEFT
                </span>

                <b>
                  {available} /{" "}
                  {STARTER_LIMIT}
                </b>
              </div>

              <div className="progress">
                <i
                  style={{
                    width:
                      `${
                        (available /
                          STARTER_LIMIT) *
                        100
                      }%`
                  }}
                />
              </div>

              <p className="panelHelp">
                Click an empty cell
                to place. Hovering a
                brick previews a
                compatible stack on
                its stud surface.
                Shift+Click places
                directly on the hovered
                structure.
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
            onPlace={
              addAt
            }
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
              <Box size={12} />
              {bricks.length} PIECES
            </span>

            <span>
              <Grid3X3
                size={12}
              />
              1 STUD SNAP
            </span>

            <span>
              {ghost
                ? ghostValid
                  ? "PLACEMENT READY"
                  : "BLOCKED"
                : selected
                  ? `SELECTED #${selected.id}`
                  : "READY TO BUILD"}
            </span>
          </div>

          <div className="sceneHint">
            HOVER = LIVE GHOST · CLICK = PLACE · CLICK BRICK = DRAG · SHIFT+CLICK = STACK · R = ROTATE · ARROWS = MOVE
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
              />
              ADD
            </button>

            <button
              onClick={
                removeSelected
              }
            >
              <Eraser
                size={14}
              />
              DELETE
            </button>

            <span className="toolbarDivider" />

            <button
              onClick={() =>
                moveSelected(
                  -1,
                  0
                )
              }
              aria-label="move left"
            >
              <ArrowLeft
                size={14}
              />
            </button>

            <button
              onClick={() =>
                moveSelected(
                  1,
                  0
                )
              }
              aria-label="move right"
            >
              <ArrowRight
                size={14}
              />
            </button>

            <button
              onClick={() =>
                moveSelected(
                  0,
                  -1
                )
              }
              aria-label="move forward"
            >
              <ArrowUp
                size={14}
              />
            </button>

            <button
              onClick={() =>
                moveSelected(
                  0,
                  1
                )
              }
              aria-label="move backward"
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
              />
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
            INSPECTOR
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
                -1,
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
              ROTATE 90°
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

          <label>
            <span>
              SNAP
            </span>

            <Switch
              checked
              disabled
            />
          </label>

          <p className="category">
            CAMERA
          </p>

          <div className="viewGrid">
            {(
              [
                "iso",
                "top",
                "front",
                "side"
              ] as ViewMode[]
            ).map(
              (mode) => (
                <button
                  key={mode}
                  className={
                    viewMode ===
                    mode
                      ? "viewSelected"
                      : ""
                  }
                  onClick={() =>
                    setViewMode(
                      mode
                    )
                  }
                >
                  {mode.toUpperCase()}
                </button>
              )
            )}
          </div>

          <p className="category">
            SELECTED PART
          </p>

          {selected ? (
            <div className="inspectorCard">
              <div
                className="inspectorSwatch"
                style={{
                  background:
                    selected.color
                }}
              >
                <BrickThumb
                  footprint={
                    selected.footprint
                  }
                  color={
                    selected.color
                  }
                />
              </div>

              <b>
                {
                  brickDefs[
                    selected.kind
                  ].label
                }
              </b>

              <span>
                LAYER{" "}
                {selected.layer +
                  1}
              </span>

              <span>
                ROTATION{" "}
                {selected.rotation}°
              </span>

              <span>
                COLOR{" "}
                {selected.color.toUpperCase()}
              </span>

              <span>
                STUDS{" "}
                {
                  selected
                    .footprint[0]
                }{" "}
                ×{" "}
                {
                  selected
                    .footprint[1]
                }
              </span>
            </div>
          ) : (
            <div className="emptyInspector">
              <Layers3
                size={18}
              />

              <span>
                Select a brick to
                inspect it.
              </span>
            </div>
          )}

          <div className="pieceCount">
            <span>
              PIECE COUNT
            </span>

            <b>
              {bricks.length} /{" "}
              {STARTER_LIMIT}
            </b>
          </div>
        </aside>
      </div>

      {toast && (
        <div className="builderToast">
          {toast}
        </div>
      )}

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
                  PUBLISH BUILD
                </p>

                <h2>
                  SAVE TO SHOWCASE
                </h2>

                <p className="modalText">
                  Your current camera
                  becomes the gallery
                  thumbnail.
                </p>

                <label>
                  CREATION NAME

                  <input
                    autoFocus
                    value={
                      title
                    }
                    onChange={(
                      e
                    ) =>
                      setTitle(
                        e.target
                          .value
                      )
                    }
                    placeholder="My masterpiece"
                  />
                </label>

                <label>
                  CREATOR

                  <input
                    value={
                      creator
                    }
                    onChange={(
                      e
                    ) =>
                      setCreator(
                        e.target
                          .value
                      )
                    }
                    placeholder="Your handle"
                  />
                </label>

                <div className="modalPreview">
                  {previewSrc ? (
                    <img
                      src={
                        previewSrc
                      }
                      alt="Build preview"
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
                  SAVED
                </p>

                <h2>
                  READY FOR THE SHOWCASE
                </h2>

                <p className="modalText">
                  Prototype save stored
                  locally. Permanent
                  publishing can be
                  connected to PostgreSQL
                  later.
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
