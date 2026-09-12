"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import {
  applyCells,
  boxCells,
  brushCells,
  cellKey,
  clonePalette,
  floodCells,
  hollowCells,
  History,
  loadDraft,
  MAX_SAFE,
  projectFromVolume,
  saveDraft,
  selectionClipboard,
  SIZES,
  volumeCenter,
  VoxelVolume,
  type BoxMode,
  type Cell,
  type ClipboardVoxel,
  type DraftV1,
  type Delta,
  type Mirror,
  type Tool,
  type ViewMode
} from "@/lib/voxelEngine";
import {
  downloadBytes,
  downloadText,
  exportObjArchive,
  exportVox,
  importVox
} from "@/lib/voxelExport";
import { exportGlb } from "@/lib/voxelGlb";
import {
  imageToVoxels,
  imagesToVoxels,
  type ImageImport,
  type ImageMode
} from "@/lib/imageVoxel";
import {
  consumeImageApply,
  FREE_IMAGE_APPLIES,
  hashImageFile,
  remainingApplies
} from "@/lib/entitlement";
import {
  MONTHLY_SOL,
  restorePlan,
  subscribeWithSol
} from "@/lib/solanaCheckout";
import { connectWallet } from "@/lib/wallet";
import { publishCreation } from "@/lib/creationsApi";
import { VoxelCloud, type Clip, type VoxelHit } from "@/components/builder/VoxelCloud";
import "./builder.css";

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "attach", label: "ATTACH", key: "B" },
  { id: "erase", label: "ERASE", key: "E" },
  { id: "paint", label: "PAINT", key: "P" },
  { id: "fill", label: "FILL", key: "G" },
  { id: "eyedrop", label: "PICK", key: "I" },
  { id: "select", label: "SELECT", key: "Q" },
  { id: "box", label: "BOX", key: "U" }
];

type ContentBounds = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
};

function boundsOfCells(
  list: { x: number; y: number; z: number }[]
): ContentBounds | null {
  if (!list.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;

  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const v of list) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);

    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }

  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ
  };
}

function fitSizeFor(bounds: ContentBounds) {
  const span = Math.max(
    bounds.maxX - bounds.minX + 1,
    bounds.maxY - bounds.minY + 1,
    bounds.maxZ - bounds.minZ + 1
  );

  return (SIZES.find((n) => n >= span + 2) ?? 256) as number;
}

function CameraRig({
  view,
  size,
  focus
}: {
  view: ViewMode;
  size: number;
  focus: [number, number, number];
}) {
  const { camera } = useThree();

  useEffect(() => {
    const dist = Math.max(8, size * 0.9);
    const [cx, cy, cz] = focus;

    if (view === "top") {
      camera.position.set(
        cx,
        dist,
        cz + 0.01
      );
    } else if (view === "front") {
      camera.position.set(
        cx,
        cy + size * 0.2,
        cz + dist
      );
    } else if (view === "side") {
      camera.position.set(
        cx + dist,
        cy + size * 0.2,
        cz
      );
    } else {
      camera.position.set(
        cx + dist * 0.75,
        cy + dist * 0.5,
        cz + dist * 0.75
      );
    }

    camera.lookAt(
      cx,
      cy,
      cz
    );

    camera.updateProjectionMatrix();
  }, [
    camera,
    focus,
    size,
    view
  ]);

  return null;
}

function Ground({
  size,
  onHit,
  onHover
}: {
  size: number;
  onHit: (
    hit: VoxelHit,
    ev: ThreeEvent<PointerEvent>
  ) => void;
  onHover: (
    hit: VoxelHit | null
  ) => void;
}) {
  return (
    <mesh
      rotation={[
        -Math.PI / 2,
        0,
        0
      ]}
      position={[
        (size - 1) / 2,
        -0.5,
        (size - 1) / 2
      ]}
      onPointerDown={(e) => {
        e.stopPropagation();

        onHit(
          {
            kind: "empty",
            cell: {
              x: Math.round(
                e.point.x
              ),
              y: 0,
              z: Math.round(
                e.point.z
              )
            }
          },
          e
        );
      }}
      onPointerMove={(e) => {
        onHover({
          kind: "empty",
          cell: {
            x: Math.round(
              e.point.x
            ),
            y: 0,
            z: Math.round(
              e.point.z
            )
          }
        });
      }}
    >
      <planeGeometry
        args={[
          size + 8,
          size + 8
        ]}
      />
      <shadowMaterial opacity={0.22} />
    </mesh>
  );
}

function Ghost({
  cell,
  color,
  valid
}: {
  cell: Cell;
  color: string;
  valid: boolean;
}) {
  return (
    <mesh
      position={[
        cell.x,
        cell.y,
        cell.z
      ]}
      raycast={() => {}}
    >
      <boxGeometry
        args={[
          0.98,
          0.98,
          0.98
        ]}
      />
      <meshBasicMaterial
        color={
          valid
            ? color
            : "#ff3347"
        }
        transparent
        opacity={0.38}
        depthWrite={false}
      />
    </mesh>
  );
}

function BoxPreview({
  a,
  b
}: {
  a: Cell;
  b: Cell;
}) {
  const x0 = Math.min(
    a.x,
    b.x
  );

  const y0 = Math.min(
    a.y,
    b.y
  );

  const z0 = Math.min(
    a.z,
    b.z
  );

  const sx =
    Math.abs(
      a.x - b.x
    ) + 1;

  const sy =
    Math.abs(
      a.y - b.y
    ) + 1;

  const sz =
    Math.abs(
      a.z - b.z
    ) + 1;

  return (
    <mesh
      position={[
        x0 + (sx - 1) / 2,
        y0 + (sy - 1) / 2,
        z0 + (sz - 1) / 2
      ]}
      raycast={() => {}}
    >
      <boxGeometry
        args={[
          sx,
          sy,
          sz
        ]}
      />
      <meshBasicMaterial
        color="#14f195"
        wireframe
        transparent
        opacity={0.85}
      />
    </mesh>
  );
}

function OffsetGhost({
  items,
  origin
}: {
  items: {
    dx: number;
    dy: number;
    dz: number;
  }[];
  origin: Cell;
}) {
  return (
    <group
      raycast={() => {}}
    >
      {items
        .slice(0, 800)
        .map(
          (
            item,
            i
          ) => (
            <mesh
              key={i}
              position={[
                origin.x +
                  item.dx,
                origin.y +
                  item.dy,
                origin.z +
                  item.dz
              ]}
            >
              <boxGeometry
                args={[
                  1.02,
                  1.02,
                  1.02
                ]}
              />
              <meshBasicMaterial
                color="#9945ff"
                wireframe
                transparent
                opacity={0.7}
              />
            </mesh>
          )
        )}
    </group>
  );
}

function PendingPreview({
  voxels,
  palette
}: {
  voxels: {
    x: number;
    y: number;
    z: number;
    c: number;
  }[];
  palette: string[];
}) {
  const shown =
    voxels.length > 2500
      ? voxels.filter(
          (_, i) => i % 3 === 0
        )
      : voxels;

  return (
    <group
      raycast={() => {}}
    >
      {shown
        .slice(0, 4000)
        .map(
          (
            v,
            i
          ) => (
            <mesh
              key={i}
              position={[
                v.x,
                v.y,
                v.z
              ]}
            >
              <boxGeometry
                args={[
                  0.96,
                  0.96,
                  0.96
                ]}
              />
              <meshBasicMaterial
                color={
                  palette[v.c] ??
                  "#ffffff"
                }
                transparent
                opacity={0.55}
                depthWrite={false}
              />
            </mesh>
          )
        )}
    </group>
  );
}

function VolumeFrame({
  size
}: {
  size: number;
}) {
  const points = useMemo(
    () => {
      const s =
        size - 1;

      return [
        0, 0, 0,
        s, 0, 0,
        s, 0, s,
        0, 0, s,
        0, 0, 0,
        0, s, 0,
        s, s, 0,
        s, 0, 0,
        s, 0, s,
        s, s, s,
        s, s, 0,
        s, 0, 0,
        s, s, 0,
        0, s, 0,
        0, 0, 0,
        0, 0, s,
        0, s, s,
        0, s, 0,
        s, s, 0,
        s, s, s,
        0, s, s,
        s, s, s,
        s, 0, s
      ];
    },
    [size]
  );

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[
            new Float32Array(
              points
            ),
            3
          ]}
        />
      </bufferGeometry>

      <lineBasicMaterial
        color="#9945FF"
      />
    </line>
  );
}

function targetCell(
  hit: VoxelHit,
  tool: Tool
): Cell {
  if (
    hit.kind ===
    "empty"
  ) {
    return hit.cell;
  }

  if (
    tool ===
    "attach"
  ) {
    return hit.place;
  }

  return hit.cell;
}

export default function Builder() {
  const volumeRef =
    useRef(
      new VoxelVolume(128)
    );

  const historyRef =
    useRef(
      new History()
    );

  const strokeRef =
    useRef<{
      seen: Set<string>;
      deltas: Delta[];
    } | null>(null);

  const fileRef =
    useRef<HTMLInputElement>(
      null
    );

  const frontRef =
    useRef<HTMLInputElement>(
      null
    );

  const sideRef =
    useRef<HTMLInputElement>(
      null
    );

  const [rev, setRev] =
    useState(0);

  const [title, setTitle] =
    useState("UNTITLED");

  const [tool, setTool] =
    useState<Tool>(
      "attach"
    );

  const [boxMode, setBoxMode] =
    useState<BoxMode>(
      "fill"
    );

  const [boxStart, setBoxStart] =
    useState<Cell | null>(
      null
    );

  const [brush, setBrush] =
    useState(1);

  const [color, setColor] =
    useState(6);

  const [palette, setPalette] =
    useState(() =>
      clonePalette()
    );

  const [mirror, setMirror] =
    useState<Mirror>({
      x: false,
      y: false,
      z: false
    });

  const [view, setView] =
    useState<ViewMode>(
      "iso"
    );

  const [grid, setGrid] =
    useState(true);

  const [hover, setHover] =
    useState<VoxelHit | null>(
      null
    );

  const [selected, setSelected] =
    useState<Set<string>>(
      new Set()
    );

  const [clipboard, setClipboard] =
    useState<ClipboardVoxel[]>(
      []
    );

  const [clip, setClip] =
    useState<Clip>({
    axis: null,
    value: 127
  });

  const [focus, setFocus] =
    useState<
      [number, number, number]
    >(() =>
      volumeCenter(128)
    );

  const [imageMode, setImageMode] =
    useState<ImageMode>(
      "solid"
    );

  const [imageHeight, setImageHeight] =
    useState(16);

  const [symmetrize, setSymmetrize] =
    useState(false);

  const [pendingImage, setPendingImage] =
    useState<ImageImport | null>(
      null
    );

  const [pendingName, setPendingName] =
    useState("");

  const [pendingHash, setPendingHash] =
    useState("");

  const [frontFile, setFrontFile] =
    useState<File | null>(
      null
    );

  const [sideFile, setSideFile] =
    useState<File | null>(
      null
    );

  const [creditsLeft, setCreditsLeft] =
    useState(
      FREE_IMAGE_APPLIES
    );

  const [paywall, setPaywall] =
    useState(false);

  const [busy, setBusy] =
    useState(false);

  const [toast, setToast] =
    useState("");

  const [editingTitle, setEditingTitle] =
    useState(false);

  const [canUndo, setCanUndo] =
    useState(false);

  const [canRedo, setCanRedo] =
    useState(false);

  const saveTimer =
    useRef<number | null>(
      null
    );

  const bump =
    useCallback(() => {
      setRev(
        (n) => n + 1
      );

      setCanUndo(
        historyRef.current.canUndo
      );

      setCanRedo(
        historyRef.current.canRedo
      );
    }, []);

  const notify =
    useCallback(
      (msg: string) => {
        setToast(msg);

        window.setTimeout(
          () => setToast(""),
          1800
        );
      },
      []
    );

  const refreshCredits =
    useCallback(
      () =>
        setCreditsLeft(
          remainingApplies()
        ),
      []
    );

  const subscribe =
    useCallback(
      async () => {
        setBusy(true);

        try {
          notify(
            "CONNECT PHANTOM"
          );

          const paid =
            await subscribeWithSol();

          refreshCredits();
          setPaywall(false);

          notify(
            `PRO ACTIVE · ${paid.signature.slice(
              0,
              8
            )}`
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "PAY FAILED"
          );
        } finally {
          setBusy(false);
        }
      },
      [
        notify,
        refreshCredits
      ]
    );

  const syncPlan =
    useCallback(
      async () => {
        try {
          const state =
            await restorePlan();

          refreshCredits();

          notify(
            state.plan ===
              "monthly"
              ? "PRO RESTORED"
              : "FREE PLAN"
          );
        } catch {
          /* phantom missing or rejected */
        }
      },
      [
        notify,
        refreshCredits
      ]
    );

  const volume =
    volumeRef.current;

  const count =
    volume.count;

  const ghost =
    hover
      ? targetCell(
          hover,
          tool
        )
      : null;

  const [
    cx,
    ,
    cz
  ] =
    volumeCenter(
      volume.size
    );

  const ghostValid =
    !ghost
      ? false
      : tool === "erase" ||
          tool === "paint" ||
          tool === "fill" ||
          tool === "select" ||
          tool === "eyedrop"
        ? volume.has(
            ghost.x,
            ghost.y,
            ghost.z
          )
        : volume.inBounds(
              ghost.x,
              ghost.y,
              ghost.z
            ) &&
            !volume.has(
              ghost.x,
              ghost.y,
              ghost.z
            );

  const viewLabel =
    sideFile
      ? "FRONT+SIDE"
      : frontFile
        ? "FRONT"
        : "NONE";

  const viewCount =
    Number(Boolean(frontFile)) +
    Number(Boolean(sideFile));

  useEffect(() => {
    refreshCredits();
    void syncPlan();

    const draft =
      loadDraft();

    if (!draft) {
      const mid =
        Math.floor(
          volumeRef.current.size /
            2
        );

      applyCells(
        volumeRef.current,
        [
          {
            x: mid,
            y: 0,
            z: mid
          }
        ],
        6,
        {
          x: false,
          y: false,
          z: false
        }
      );

      bump();
      return;
    }

    volumeRef.current.load(
      draft
    );

    setTitle(
      draft.title ||
        "UNTITLED"
    );

    if (
      draft.palette?.length
    ) {
      setPalette(
        clonePalette(
          draft.palette
        )
      );
    }

    setFocus(
      volumeCenter(
        draft.size ||
          128
      )
    );

    setClip({
      axis: null,
      value:
        (draft.size ||
          128) - 1
    });

    bump();
  }, [
    bump,
    refreshCredits,
    syncPlan
  ]);

  useEffect(() => {
    if (saveTimer.current) {
      window.clearTimeout(
        saveTimer.current
      );
    }

    saveTimer.current =
      window.setTimeout(
        () => {
          saveDraft(
            projectFromVolume(
              title,
              volumeRef.current,
              palette
            )
          );
        },
        250
      );

    return () => {
      if (
        saveTimer.current
      ) {
        window.clearTimeout(
          saveTimer.current
        );
      }
    };
  }, [
    title,
    palette,
    rev
  ]);

  const applyNow =
    useCallback(
      (
        cells: Cell[],
        nextColor: number | null,
        recordStroke: boolean
      ) => {
        if (
          volumeRef.current.count >
            MAX_SAFE &&
          nextColor !== null
        ) {
          notify(
            "PERFORMANCE LIMIT"
          );

          return;
        }

        const deltas =
          applyCells(
            volumeRef.current,
            cells,
            nextColor,
            mirror
          );

        if (
          recordStroke &&
          strokeRef.current
        ) {
          strokeRef.current.deltas.push(
            ...deltas
          );
        } else {
          historyRef.current.push(
            deltas
          );
        }

        bump();
      },
      [
        bump,
        mirror,
        notify
      ]
    );

  const beginStroke =
    useCallback(() => {
      if (
        !strokeRef.current
      ) {
        strokeRef.current = {
          seen: new Set(),
          deltas: []
        };
      }
    }, []);

  const endStroke =
    useCallback(() => {
      const stroke =
        strokeRef.current;

      strokeRef.current =
        null;

      if (
        stroke?.deltas.length
      ) {
        historyRef.current.push(
          stroke.deltas
        );
      }

      bump();
    }, [bump]);

  const applyHit =
    useCallback(
      (
        hit: VoxelHit,
        additive: boolean
      ) => {
        const cell =
          targetCell(
            hit,
            tool
          );

        if (
          tool ===
          "eyedrop"
        ) {
          if (
            hit.kind ===
            "voxel"
          ) {
            setColor(
              volumeRef.current.get(
                hit.cell.x,
                hit.cell.y,
                hit.cell.z
              ) ?? color
            );
          }

          return;
        }

        if (
          tool ===
          "select"
        ) {
          const key =
            cellKey(
              hit.kind ===
                "voxel"
                ? hit.cell
                : cell
            );

          setSelected(
            (current) => {
              const next =
                new Set(
                  additive
                    ? current
                    : []
                );

              if (
                next.has(key)
              ) {
                next.delete(
                  key
                );
              } else if (
                hit.kind ===
                "voxel"
              ) {
                next.add(key);
              }

              return next;
            }
          );

          return;
        }

        if (
          tool === "box"
        ) {
          if (!boxStart) {
            setBoxStart(
              cell
            );

            notify(
              "BOX START"
            );

            return;
          }

          const cells =
            boxCells(
              boxStart,
              cell
            );

          setBoxStart(
            null
          );

          if (
            boxMode ===
            "select"
          ) {
            setSelected(
              new Set(
                cells
                  .filter(
                    (c) =>
                      volumeRef.current.has(
                        c.x,
                        c.y,
                        c.z
                      )
                  )
                  .map(
                    cellKey
                  )
              )
            );

            return;
          }

          applyNow(
            cells,
            boxMode ===
              "erase"
              ? null
              : color,
            false
          );

          return;
        }

        if (
          tool ===
          "fill"
        ) {
          if (
            hit.kind !==
            "voxel"
          ) {
            return;
          }

          applyNow(
            floodCells(
              volumeRef.current,
              hit.cell
            ),
            color,
            false
          );

          return;
        }

        beginStroke();

        const patch =
          brush > 1
            ? brushCells(
                cell,
                brush
              )
            : [cell];

        const fresh =
          patch.filter(
            (candidate) => {
              const key =
                cellKey(
                  candidate
                );

              if (
                strokeRef.current?.seen.has(
                  key
                )
              ) {
                return false;
              }

              strokeRef.current?.seen.add(
                key
              );

              return true;
            }
          );

        if (!fresh.length) {
          return;
        }

        if (
          tool === "erase"
        ) {
          applyNow(
            fresh,
            null,
            true
          );
        } else if (
          tool === "paint"
        ) {
          if (
            hit.kind ===
            "voxel"
          ) {
            applyNow(
              fresh,
              color,
              true
            );
          }
        } else {
          applyNow(
            fresh,
            color,
            true
          );
        }
      },
      [
        applyNow,
        beginStroke,
        boxMode,
        boxStart,
        brush,
        color,
        notify,
        tool
      ]
    );

  const onHit =
    useCallback(
      (
        hit: VoxelHit,
        ev: ThreeEvent<PointerEvent>
      ) => {
        if (
          ev.button !== 0
        ) {
          return;
        }

        applyHit(
          hit,
          ev.shiftKey
        );
      },
      [applyHit]
    );

  const onHover =
    useCallback(
      (
        hit: VoxelHit | null
      ) => {
        setHover(hit);

        if (
          !hit ||
          !strokeRef.current
        ) {
          return;
        }

        if (
          tool === "box" ||
          tool === "fill" ||
          tool === "select" ||
          tool === "eyedrop"
        ) {
          return;
        }

        applyHit(
          hit,
          false
        );
      },
      [
        applyHit,
        tool
      ]
    );

  useEffect(() => {
    const up =
      () =>
        endStroke();

    window.addEventListener(
      "pointerup",
      up
    );

    return () =>
      window.removeEventListener(
        "pointerup",
        up
      );
  }, [
    endStroke
  ]);

  const undo =
    useCallback(() => {
      historyRef.current.undo(
        volumeRef.current
      );

      bump();
    }, [bump]);

  const redo =
    useCallback(() => {
      historyRef.current.redo(
        volumeRef.current
      );

      bump();
    }, [bump]);

  const packVolume =
    useCallback(() => {
      const v =
        volumeRef.current;

      const items =
        v.voxels();

      const bounds =
        boundsOfCells(
          items
        );

      if (!bounds) {
        setFocus(
          volumeCenter(
            v.size
          )
        );

        return;
      }

      const next =
        fitSizeFor(
          bounds
        );

      const sx =
        Math.floor(
          (
            next -
            (
              bounds.maxX -
              bounds.minX +
              1
            )
          ) / 2
        ) -
        bounds.minX;

      const sy =
        0 -
        bounds.minY;

      const sz =
        Math.floor(
          (
            next -
            (
              bounds.maxZ -
              bounds.minZ +
              1
            )
          ) / 2
        ) -
        bounds.minZ;

      const shifted =
        items.map(
          (item) => ({
            x:
              item.x +
              sx,
            y:
              item.y +
              sy,
            z:
              item.z +
              sz,
            c: item.c
          })
        );

      v.resize(
        next
      );

      v.load({
        size: next,
        voxels:
          shifted
      });

      const packed =
        boundsOfCells(
          shifted
        );

      setClip(
        (current) => ({
          ...current,
          value: Math.min(
            current.value,
            next - 1
          )
        })
      );

      setFocus(
        packed
          ? [
              (
                packed.minX +
                packed.maxX
              ) / 2,
              Math.max(
                0.5,
                (
                  packed.minY +
                  packed.maxY
                ) / 2
              ),
              (
                packed.minZ +
                packed.maxZ
              ) / 2
            ]
          : volumeCenter(
              next
            )
      );

      bump();
    }, [bump]);

  const clearAll =
    useCallback(() => {
      applyNow(
        volumeRef.current
          .voxels()
          .map(
            (v) => ({
              x: v.x,
              y: v.y,
              z: v.z
            })
          ),
        null,
        false
      );

      setSelected(
        new Set()
      );

      setBoxStart(
        null
      );
    }, [applyNow]);

  const resize =
    useCallback(
      (size: number) => {
        const v =
          volumeRef.current;

        if (
          size ===
          v.size
        ) {
          return;
        }

        const doomed =
          v.voxels()
            .filter(
              (vx) =>
                vx.x >= size ||
                vx.y >= size ||
                vx.z >= size
            )
            .map(
              (vx) => ({
                x: vx.x,
                y: vx.y,
                z: vx.z
              })
            );

        if (
          doomed.length
        ) {
          applyNow(
            doomed,
            null,
            false
          );
        }

        v.resize(
          size
        );

        setClip(
          (current) => ({
            ...current,
            value: Math.min(
              current.value,
              size - 1
            )
          })
        );

        setFocus(
          volumeCenter(
            size
          )
        );

        bump();
      },
      [
        applyNow,
        bump
      ]
    );

  const selectedCells =
    useCallback(
      () =>
        [...selected].map(
          (key) => {
            const [
              x,
              y,
              z
            ] =
              key
                .split(":")
                .map(
                  Number
                );

            return {
              x,
              y,
              z
            };
          }
        ),
      [selected]
    );

  const deleteSelected =
    useCallback(() => {
      applyNow(
        selectedCells(),
        null,
        false
      );

      setSelected(
        new Set()
      );
    }, [
      applyNow,
      selectedCells
    ]);

  const paintSelected =
    useCallback(() => {
      applyNow(
        selectedCells(),
        color,
        false
      );
    }, [
      applyNow,
      color,
      selectedCells
    ]);

  const copySelected =
    useCallback(() => {
      const clipSel =
        selectionClipboard(
          volumeRef.current,
          selected
        );

      setClipboard(
        clipSel
      );

      notify(
        clipSel.length
          ? `COPIED ${clipSel.length}`
          : "NOTHING SELECTED"
      );
    }, [
      notify,
      selected
    ]);

  const pasteClipboard =
    useCallback(
      (
        origin?: Cell
      ) => {
        if (
          !clipboard.length
        ) {
          return;
        }

        const base =
          origin ??
          ghost ??
          {
            x: Math.floor(
              volume.size / 2
            ),
            y: 0,
            z: Math.floor(
              volume.size / 2
            )
          };

        const cells =
          clipboard.map(
            (v) => ({
              x:
                base.x +
                v.dx,
              y:
                base.y +
                v.dy,
              z:
                base.z +
                v.dz
            })
          );

        const deltas: Delta[] =
          [];

        clipboard.forEach(
          (v, i) => {
            deltas.push(
              ...applyCells(
                volumeRef.current,
                [
                  cells[i]
                ],
                v.c,
                mirror
              )
            );
          }
        );

        historyRef.current.push(
          deltas
        );

        setSelected(
          new Set(
            cells.map(
              cellKey
            )
          )
        );

        bump();
      },
      [
        bump,
        clipboard,
        ghost,
        mirror,
        volume.size
      ]
    );

  const duplicateSelected =
    useCallback(() => {
      const clipSel =
        selectionClipboard(
          volumeRef.current,
          selected
        );

      if (!clipSel.length) {
        return;
      }

      setClipboard(
        clipSel
      );

      const cells =
        selectedCells();

      pasteClipboard(
        {
          x:
            Math.min(
              ...cells.map(
                (c) => c.x
              )
            ) + 1,
          y:
            Math.min(
              ...cells.map(
                (c) => c.y
              )
            ),
          z:
            Math.min(
              ...cells.map(
                (c) => c.z
              )
            )
        }
      );
    }, [
      pasteClipboard,
      selected,
      selectedCells
    ]);

  const moveSelected =
    useCallback(
      (
        dx: number,
        dy: number,
        dz: number
      ) => {
        const v =
          volumeRef.current;

        const items =
          selectedCells().map(
            (cell) => ({
              ...cell,
              c:
                v.get(
                  cell.x,
                  cell.y,
                  cell.z
                ) ?? color
            })
          );

        historyRef.current.push(
          [
            ...applyCells(
              v,
              items,
              null,
              {
                x: false,
                y: false,
                z: false
              }
            ),
            ...items.flatMap(
              (item) =>
                applyCells(
                  v,
                  [
                    {
                      x:
                        item.x +
                        dx,
                      y:
                        item.y +
                        dy,
                      z:
                        item.z +
                        dz
                    }
                  ],
                  item.c,
                  {
                    x: false,
                    y: false,
                    z: false
                  }
                )
            )
          ]
        );

        setSelected(
          new Set(
            items.map(
              (item) =>
                cellKey({
                  x:
                    item.x +
                    dx,
                  y:
                    item.y +
                    dy,
                  z:
                    item.z +
                    dz
                })
            )
          )
        );

        bump();
      },
      [
        bump,
        color,
        selectedCells
      ]
    );

  const exportFiles =
    useCallback(
      async (
        kind:
          | "vox"
          | "obj"
          | "json"
          | "glb"
      ) => {
        const name =
          (
            title.trim() ||
            "untitled"
          )
            .toLowerCase()
            .replace(
              /[^a-z0-9]+/g,
              "-"
            )
            .replace(
              /^-+|-+$/g,
              ""
            ) ||
          "untitled";

        const options = {
          name,
          unitMeters: 0.1,
          pivot:
            "bottom-center" as const,
          upAxis:
            "y" as const
        };

        try {
          if (
            kind ===
            "json"
          ) {
            downloadText(
              JSON.stringify(
                projectFromVolume(
                  title,
                  volumeRef.current,
                  palette
                ),
                null,
                2
              ),
              `${name}.json`,
              "application/json"
            );

            notify(
              "PROJECT READY"
            );

            return;
          }

          if (
            kind ===
            "vox"
          ) {
            notify(
              "EXPORTING VOX"
            );

            await new Promise(
              (resolve) =>
                window.setTimeout(
                  resolve,
                  40
                )
            );

            downloadBytes(
              exportVox(
                volumeRef.current,
                palette
              ),
              `${name}.vox`,
              "application/octet-stream"
            );

            notify(
              "VOX READY"
            );

            return;
          }

          if (
            kind ===
            "glb"
          ) {
            notify(
              "EXPORTING GLB"
            );

            await new Promise(
              (resolve) =>
                window.setTimeout(
                  resolve,
                  40
                )
            );

            const bytes =
              await exportGlb(
                volumeRef.current,
                palette,
                options
              );

            downloadBytes(
              new Uint8Array(
                bytes
              ),
              `${name}.glb`,
              "model/gltf-binary"
            );

            notify(
              "GLB READY"
            );

            return;
          }

          notify(
            "EXPORTING OBJ"
          );

          await new Promise(
            (resolve) =>
              window.setTimeout(
                resolve,
                40
              )
          );

          downloadBytes(
            exportObjArchive(
              volumeRef.current,
              palette,
              options
            ),
            `${name}-obj.zip`,
            "application/zip"
          );

          notify(
            "OBJ READY"
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "EXPORT FAILED"
          );
        }
      },
      [
        notify,
        palette,
        title
      ]
    );

  const publish =
    useCallback(
      async () => {
        const v =
          volumeRef.current;

        if (
          v.count === 0
        ) {
          notify(
            "NOTHING TO PUBLISH"
          );

          return;
        }

        setBusy(true);

        try {
          notify(
            "CONNECT PHANTOM"
          );

          const wallet =
            await connectWallet();

          notify(
            "PUBLISHING"
          );

          await publishCreation({
            wallet,
            title:
              title.trim() ||
              "Untitled",
            size:
              v.size,
            palette,
            voxels:
              v.voxels()
          });

          notify(
            "PUBLISHED"
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "PUBLISH FAILED"
          );
        } finally {
          setBusy(false);
        }
      },
      [
        notify,
        palette,
        title
      ]
    );

  const cancelImage =
    useCallback(() => {
      setPendingImage(
        null
      );

      setPendingName(
        ""
      );

      setPendingHash(
        ""
      );

      setFrontFile(
        null
      );

      setSideFile(
        null
      );

      setPaywall(
        false
      );

      notify(
        "IMPORT CANCELED"
      );
    }, [notify]);

  const applyImage =
    useCallback(() => {
      if (
        !pendingImage
      ) {
        return;
      }

      const gate =
        consumeImageApply(
          pendingHash ||
            pendingName ||
            "unknown"
        );

      refreshCredits();

      if (!gate.ok) {
        setPaywall(
          true
        );

        notify(
          gate.message
        );

        return;
      }

      const result =
        pendingImage;

      const bounds =
        boundsOfCells(
          result.voxels
        );

      const next =
        bounds
          ? fitSizeFor(
              bounds
            )
          : volumeRef.current.size;

      const sx =
        bounds
          ? Math.floor(
              (
                next -
                (
                  bounds.maxX -
                  bounds.minX +
                  1
                )
              ) / 2
            ) -
            bounds.minX
          : 0;

      const sy =
        bounds
          ? 0 -
            bounds.minY
          : 0;

      const sz =
        bounds
          ? Math.floor(
              (
                next -
                (
                  bounds.maxZ -
                  bounds.minZ +
                  1
                )
              ) / 2
            ) -
            bounds.minZ
          : 0;

      const packed =
        result.voxels.map(
          (vox) => ({
            x:
              vox.x +
              sx,
            y:
              vox.y +
              sy,
            z:
              vox.z +
              sz,
            c: vox.c
          })
        );

      const packedBounds =
        boundsOfCells(
          packed
        );

      if (
        next !==
        volumeRef.current.size
      ) {
        volumeRef.current.resize(
          next
        );
      }

      setPendingImage(
        null
      );

      setPendingHash(
        ""
      );

      setFrontFile(
        null
      );

      setSideFile(
        null
      );

      setPaywall(
        false
      );

      setPalette(
        result.palette
      );

      const deltas: Delta[] =
        [];

      const existing =
        volumeRef.current
          .voxels()
          .map(
            (v) => ({
              x: v.x,
              y: v.y,
              z: v.z
            })
          );

      if (
        existing.length
      ) {
        deltas.push(
          ...applyCells(
            volumeRef.current,
            existing,
            null,
            {
              x: false,
              y: false,
              z: false
            }
          )
        );
      }

      const byColor =
        new Map<
          number,
          Cell[]
        >();

      for (
        const vox of packed
      ) {
        if (
          vox.x < 0 ||
          vox.y < 0 ||
          vox.z < 0 ||
          vox.x >=
            volumeRef.current.size ||
          vox.y >=
            volumeRef.current.size ||
          vox.z >=
            volumeRef.current.size
        ) {
          continue;
        }

        const list =
          byColor.get(
            vox.c
          ) ?? [];

        list.push({
          x: vox.x,
          y: vox.y,
          z: vox.z
        });

        byColor.set(
          vox.c,
          list
        );
      }

      for (
        const [
          c,
          cells
        ] of byColor
      ) {
        deltas.push(
          ...applyCells(
            volumeRef.current,
            cells,
            c,
            {
              x: false,
              y: false,
              z: false
            }
          )
        );
      }

      historyRef.current.push(
        deltas
      );

      if (
        pendingName
      ) {
        setTitle(
          pendingName
        );
      }

      setPendingName(
        ""
      );

      setSelected(
        new Set()
      );

      setBoxStart(
        null
      );

      setClip(
        (current) => ({
          ...current,
          value: Math.min(
            current.value,
            next - 1
          )
        })
      );

      setFocus(
        packedBounds
          ? [
              (
                packedBounds.minX +
                packedBounds.maxX
              ) / 2,
              Math.max(
                0.5,
                (
                  packedBounds.minY +
                  packedBounds.maxY
                ) / 2
              ),
              (
                packedBounds.minZ +
                packedBounds.maxZ
              ) / 2
            ]
          : volumeCenter(
              next
            )
      );

      bump();

      notify(
        gate.reason ===
          "repeat"
          ? `IMAGE ${
              result.count ??
              result.voxels.length
            } VX · ${next}³`
          : `IMAGE APPLIED · ${
              gate.message
            } · ${next}³`
      );
    }, [
      bump,
      notify,
      pendingHash,
      pendingImage,
      pendingName,
      refreshCredits
    ]);

  const regenerateMultiView =
    useCallback(
      async ({
        front,
        side
      }: {
        front: File;
        side?: File;
      }) => {
        setBusy(
          true
        );

        try {
          const result =
            await imagesToVoxels(
              {
                front,
                side
              },
              {
                volumeSize:
                  volumeRef.current.size,
                mode:
                  imageMode,
                heightMax:
                  imageHeight,
                maxVoxels:
                  MAX_SAFE,
                symmetrize:
                  imageMode ===
                  "model"
                    ? symmetrize
                    : false
              }
            );

          setPendingImage(
            result
          );

          const usedViews =
            Number(Boolean(front)) +
            Number(Boolean(side));

          notify(
            usedViews === 2
              ? `2 VIEWS · ${result.count} VX`
              : `${result.count} VX READY`
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "MULTI-VIEW FAILED"
          );
        } finally {
          setBusy(
            false
          );
        }
      },
      [
        imageHeight,
        imageMode,
        notify,
        symmetrize
      ]
    );

  const rebuildMultiView =
    useCallback(
      async () => {
        if (!frontFile) {
          notify(
            "ADD FRONT PNG FIRST"
          );

          return;
        }

        if (imageMode === "model" && !sideFile) {
          notify(
            "MODEL REQUIRES FRONT + SIDE"
          );

          return;
        }

        await regenerateMultiView({
          front: frontFile,
          side: sideFile ?? undefined
        });
      },
      [
        frontFile,
        imageMode,
        notify,
        regenerateMultiView,
        sideFile
      ]
    );

  const attachFront =
    useCallback(
      async (
        file: File
      ) => {
        setBusy(
          true
        );

        try {
          notify(
            "IMPORTING FRONT"
          );

          const lower =
            file.name.toLowerCase();

          if (
            !(
              lower.endsWith(".png") ||
              lower.endsWith(".jpg") ||
              lower.endsWith(".jpeg") ||
              lower.endsWith(".webp")
            )
          ) {
            throw new Error(
              "Unsupported image"
            );
          }

          setFrontFile(
            file
          );

          /*
           * SIDE survives while FRONT is replaced so the
           * user can correct the main view without rebuilding
           * the workflow from scratch.
           */
          setPendingName(
            file.name.replace(
              /\.(png|jpe?g|webp)$/i,
              ""
            )
          );

          setPendingHash(
            await hashImageFile(file)
          );

          if (imageMode === "model") {
            if (!sideFile) {
              setPendingImage(null);
              notify("FRONT READY · MODEL REQUIRES SIDE");
            } else {
              await regenerateMultiView({
                front: file,
                side: sideFile
              });
            }
          } else {
            const result = await imageToVoxels(
              file,
              {
                volumeSize: volumeRef.current.size,
                mode: imageMode,
                heightMax: imageHeight,
                maxVoxels: MAX_SAFE,
                symmetrize: false
              }
            );

            if (!result.voxels.length) {
              throw new Error("Empty image");
            }

            setPendingImage(result);
            notify(`${result.count ?? result.voxels.length} VX READY`);

            if (sideFile) {
              await regenerateMultiView({
                front: file,
                side: sideFile
              });
            }
          }

          setPaywall(
            false
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "FRONT IMPORT FAILED"
          );
        } finally {
          setBusy(
            false
          );
        }
      },
      [
        imageHeight,
        imageMode,
        notify,
        regenerateMultiView,
        sideFile,
        symmetrize
      ]
    );

  const attachSide =
    useCallback(
      async (
        file: File
      ) => {
        setSideFile(
          file
        );

        if (!frontFile) {
          notify(
            "SIDE READY · ADD FRONT PNG"
          );

          return;
        }

        await regenerateMultiView({
          front: frontFile,
          side: file
        });
      },
      [
        frontFile,
        notify,
        regenerateMultiView
      ]
    );

  const removeSide =
    useCallback(() => {
      setSideFile(
        null
      );

      if (frontFile) {
        void regenerateMultiView({
          front: frontFile,
          side: undefined
        });
      } else {
        notify(
          "SIDE REMOVED"
        );
      }
    }, [
      frontFile,
      notify,
      regenerateMultiView
    ]);

  const openProject =
    useCallback(
      async (
        file: File
      ) => {
        setBusy(
          true
        );

        try {
          const lower =
            file.name.toLowerCase();

          if (
            lower.endsWith(".png") ||
            lower.endsWith(".jpg") ||
            lower.endsWith(".jpeg") ||
            lower.endsWith(".webp")
          ) {
            notify(
              "IMPORTING IMAGE"
            );

            await new Promise(
              (resolve) =>
                window.setTimeout(
                  resolve,
                  40
                )
            );

            if (imageMode === "model") {
              throw new Error("MODEL MODE REQUIRES FRONT + SIDE");
            }

            setFrontFile(
              file
            );

            setSideFile(
              null
            );

            const result =
              await imageToVoxels(
                file,
                {
                  volumeSize:
                    volumeRef.current.size,
                  mode:
                    imageMode,
                  heightMax:
                    imageHeight,
                  maxVoxels:
                    MAX_SAFE,
                  symmetrize:
                    false
                }
              );

            if (
              !result.voxels.length
            ) {
              throw new Error(
                "Empty image"
              );
            }

            setPendingName(
              file.name.replace(
                /\.(png|jpe?g|webp)$/i,
                ""
              )
            );

            setPendingHash(
              await hashImageFile(
                file
              )
            );

            setPendingImage(
              result
            );

            setPaywall(
              false
            );

            notify(
              `${result.count ?? result.voxels.length} VX READY`
            );

            return;
          }

          if (
            lower.endsWith(
              ".vox"
            )
          ) {
            const model =
              importVox(
                await file.arrayBuffer()
              );

            volumeRef.current.load(
              {
                size:
                  model.size,
                voxels:
                  model.voxels
              }
            );

            setPalette(
              clonePalette(
                model.palette
              )
            );

            setTitle(
              file.name.replace(
                /\.vox$/i,
                ""
              )
            );
          } else {
            const parsed =
              JSON.parse(
                await file.text()
              ) as DraftV1;

            if (
              !Array.isArray(
                parsed.voxels
              )
            ) {
              throw new Error(
                "Invalid project"
              );
            }

            volumeRef.current.load(
              parsed
            );

            setTitle(
              parsed.title ||
                file.name.replace(
                  /\.json$/i,
                  ""
                )
            );

            if (
              parsed.palette?.length
            ) {
              setPalette(
                clonePalette(
                  parsed.palette
                )
              );
            }
          }

          historyRef.current.reset();

          setSelected(
            new Set()
          );

          setBoxStart(
            null
          );

          setPendingImage(
            null
          );

          setPendingHash(
            ""
          );

          setFrontFile(
            null
          );

          setSideFile(
            null
          );


          packVolume();

          notify(
            "PROJECT LOADED"
          );
        } catch (error) {
          notify(
            error instanceof Error
              ? error.message.toUpperCase()
              : "OPEN FAILED"
          );
        } finally {
          setBusy(
            false
          );
        }
      },
      [
        imageHeight,
        imageMode,
        notify,
        packVolume,
        symmetrize
      ]
    );

  useEffect(() => {
    const handler = (
      e: KeyboardEvent
    ) => {
      const el =
        e.target as HTMLElement | null;

      if (
        el?.tagName ===
          "INPUT" ||
        el?.tagName ===
          "TEXTAREA"
      ) {
        return;
      }

      const key =
        e.key.toLowerCase();

      const mod =
        e.ctrlKey ||
        e.metaKey;

      if (
        e.key ===
        "Escape"
      ) {
        e.preventDefault();

        setBoxStart(
          null
        );

        setSelected(
          new Set()
        );

        setPendingImage(
          null
        );

        setPendingName(
          ""
        );

        setPendingHash(
          ""
        );

        setFrontFile(
          null
        );

        setSideFile(
          null
        );


        setPaywall(
          false
        );

        strokeRef.current =
          null;

        return;
      }

      if (
        e.key ===
          "Enter" &&
        pendingImage
      ) {
        e.preventDefault();
        applyImage();
        return;
      }

      if (
        key ===
          "f" &&
        !mod
      ) {
        e.preventDefault();
        packVolume();
        notify(
          "FIT"
        );
        return;
      }

      if (
        clip.axis &&
        key === ","
      ) {
        setClip(
          (current) => ({
            ...current,
            value:
              Math.max(
                0,
                current.value -
                  1
              )
          })
        );
      }

      if (
        clip.axis &&
        key === "."
      ) {
        setClip(
          (current) => ({
            ...current,
            value:
              Math.min(
                volume.size -
                  1,
                current.value +
                  1
              )
          })
        );
      }

      if (
        mod &&
        key === "z"
      ) {
        e.preventDefault();

        if (
          e.shiftKey
        ) {
          redo();
        } else {
          undo();
        }

        return;
      }

      if (
        mod &&
        key === "y"
      ) {
        e.preventDefault();
        redo();
        return;
      }

      if (
        mod &&
        key === "c"
      ) {
        e.preventDefault();
        copySelected();
        return;
      }

      if (
        mod &&
        key === "v"
      ) {
        e.preventDefault();
        pasteClipboard();
        return;
      }

      if (
        mod &&
        key === "d"
      ) {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (
        key === "b"
      ) {
        setTool(
          "attach"
        );
      }

      if (
        key === "e"
      ) {
        setTool(
          "erase"
        );
      }

      if (
        key === "p"
      ) {
        setTool(
          "paint"
        );
      }

      if (
        key === "g"
      ) {
        setTool(
          "fill"
        );
      }

      if (
        key === "i"
      ) {
        setTool(
          "eyedrop"
        );
      }

      if (
        key === "q"
      ) {
        setTool(
          "select"
        );
      }

      if (
        key === "u"
      ) {
        setTool(
          "box"
        );
      }

      if (
        key === "x"
      ) {
        setMirror(
          (m) => ({
            ...m,
            x: !m.x
          })
        );
      }

      if (
        key === "y" &&
        !mod
      ) {
        setMirror(
          (m) => ({
            ...m,
            y: !m.y
          })
        );
      }

      if (
        key === "z" &&
        !mod
      ) {
        setMirror(
          (m) => ({
            ...m,
            z: !m.z
          })
        );
      }

      if (
        key === "["
      ) {
        setBrush(
          (n) =>
            Math.max(
              1,
              n - 1
            )
        );
      }

      if (
        key === "]"
      ) {
        setBrush(
          (n) =>
            Math.min(
              5,
              n + 1
            )
        );
      }

      if (
        key === "delete" ||
        key === "backspace"
      ) {
        deleteSelected();
      }

      if (
        e.key ===
        "ArrowLeft"
      ) {
        moveSelected(
          -1,
          0,
          0
        );
      }

      if (
        e.key ===
        "ArrowRight"
      ) {
        moveSelected(
          1,
          0,
          0
        );
      }

      if (
        e.key ===
        "ArrowUp"
      ) {
        moveSelected(
          0,
          e.shiftKey
            ? 1
            : 0,
          e.shiftKey
            ? 0
            : -1
        );
      }

      if (
        e.key ===
        "ArrowDown"
      ) {
        moveSelected(
          0,
          e.shiftKey
            ? -1
            : 0,
          e.shiftKey
            ? 0
            : 1
        );
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
    applyImage,
    clip.axis,
    copySelected,
    deleteSelected,
    duplicateSelected,
    moveSelected,
    notify,
    packVolume,
    pasteClipboard,
    pendingImage,
    redo,
    undo,
    volume.size
  ]);

  const creditLabel =
    creditsLeft ===
    Number.POSITIVE_INFINITY
      ? "PRO"
      : `${creditsLeft}/${FREE_IMAGE_APPLIES}`;

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
            VOXEL
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
                {title}
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
            onClick={undo}
            disabled={
              !canUndo ||
              busy
            }
          >
            UNDO
          </button>

          <button
            onClick={redo}
            disabled={
              !canRedo ||
              busy
            }
          >
            REDO
          </button>

          <button
            onClick={() =>
              fileRef.current?.click()
            }
            disabled={busy}
          >
            OPEN
          </button>

          <button
            onClick={() =>
              void exportFiles(
                "json"
              )
            }
            disabled={busy}
          >
            PROJECT
          </button>

          <button
            onClick={() =>
              void exportFiles(
                "vox"
              )
            }
            disabled={busy}
          >
            VOX
          </button>

          <button
            onClick={() =>
              void exportFiles(
                "glb"
              )
            }
            disabled={busy}
          >
            GLB
          </button>

          <button
            onClick={() =>
              void exportFiles(
                "obj"
              )
            }
            disabled={busy}
          >
            OBJ
          </button>

          <button
            className="primaryButton"
            onClick={() =>
              void publish()
            }
            disabled={busy}
          >
            PUBLISH
          </button>

          <input
            ref={fileRef}
            type="file"
            accept=".json,.vox,.png,.jpg,.jpeg,.webp,application/json,image/png,image/jpeg,image/webp"
            hidden
            onChange={(
              e
            ) => {
              const file =
                e.target.files?.[0];

              if (
                file
              ) {
                void openProject(
                  file
                );
              }

              e.target.value =
                "";
            }}
          />

          <input
            ref={frontRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
            onChange={(
              e
            ) => {
              const file =
                e.target.files?.[0];

              if (
                file
              ) {
                void attachFront(
                  file
                );
              }

              e.target.value =
                "";
            }}
          />
        </div>
      </header>

      <div className="builderBody voxelBody">
        <aside className="brickPanel">
          <p className="panelLabel">
            TOOLS
          </p>

          <div className="toolStack">
            {TOOLS.map(
              (
                item
              ) => (
                <button
                  key={
                    item.id
                  }
                  className={
                    tool ===
                    item.id
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    setTool(
                      item.id
                    )
                  }
                >
                  {
                    item.label
                  }
                  <small>
                    {
                      item.key
                    }
                  </small>
                </button>
              )
            )}
          </div>

          {tool ===
            "box" && (
            <div className="viewRow">
              {(
                [
                  "fill",
                  "erase",
                  "select"
                ] as BoxMode[]
              ).map(
                (
                  mode
                ) => (
                  <button
                    key={
                      mode
                    }
                    className={
                      boxMode ===
                      mode
                        ? "modeOn"
                        : ""
                    }
                    onClick={() =>
                      setBoxMode(
                        mode
                      )
                    }
                  >
                    {mode.toUpperCase()}
                  </button>
                )
              )}
            </div>
          )}

          <details className="fold">
            <summary>
              STATUS ·{" "}
              {
                creditLabel
              }
            </summary>

            <div className="foldBody">
              <p className="foldHint">
                {
                  tool.toUpperCase()
                }{" "}
                ·{" "}
                {
                  imageMode.toUpperCase()
                }{" "}
                ·{" "}
                {count} VX ·{" "}
                {volume.size}³
                {pendingImage
                  ? " · PREVIEW"
                  : ""}
                {sideFile
                  ? " · SIDE"
                  : ""}
                {busy
                  ? " · BUSY"
                  : ""}
              </p>

              <button
                onClick={() =>
                  void syncPlan()
                }
                disabled={
                  busy
                }
              >
                SYNC WALLET
              </button>
            </div>
          </details>

          <p className="category">
            BRUSH{" "}
            {brush}
          </p>

          <div className="viewRow">
            {[1, 2, 3, 4, 5].map(
              (n) => (
                <button
                  key={n}
                  className={
                    brush ===
                    n
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    setBrush(
                      n
                    )
                  }
                >
                  {n}
                </button>
              )
            )}
          </div>

          <p className="category">
            MIRROR
          </p>

          <div className="viewRow">
            {(
              [
                "x",
                "y",
                "z"
              ] as const
            ).map(
              (
                axis
              ) => (
                <button
                  key={
                    axis
                  }
                  className={
                    mirror[
                      axis
                    ]
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    setMirror(
                      (
                        m
                      ) => ({
                        ...m,
                        [axis]:
                          !m[
                            axis
                          ]
                      })
                    )
                  }
                >
                  {axis.toUpperCase()}
                </button>
              )
            )}
          </div>

          <p className="category">
            VOLUME
          </p>

          <div className="viewRow">
            {SIZES.map(
              (size) => (
                <button
                  key={
                    size
                  }
                  className={
                    volume.size ===
                    size
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    resize(
                      size
                    )
                  }
                >
                  {size}
                </button>
              )
            )}
          </div>

          <button
            onClick={
              packVolume
            }
            disabled={
              !count
            }
          >
            FIT
          </button>

          <button
            onClick={() =>
              applyNow(
                hollowCells(
                  volumeRef.current
                ),
                null,
                false
              )
            }
          >
            HOLLOW
          </button>

          <button
            onClick={
              clearAll
            }
          >
            CLEAR
          </button>
        </aside>

        <section className="viewport">
          <Canvas
            shadows
            dpr={[
              1,
              1.75
            ]}
            camera={{
              position: [
                40,
                28,
                40
              ],
              fov: 42,
              near: 0.1,
              far: 4000
            }}
          >
            <color
              attach="background"
              args={[
                "#0b0b12"
              ]}
            />

            <ambientLight
              intensity={
                0.72
              }
            />

            <hemisphereLight
              intensity={
                0.42
              }
              groundColor="#05070c"
            />

            <directionalLight
              position={[
                18,
                32,
                14
              ]}
              intensity={
                2.6
              }
              castShadow
            />

            {grid && (
              <Grid
                args={[
                  volume.size,
                  volume.size
                ]}
                position={[
                  cx,
                  -0.49,
                  cz
                ]}
                cellSize={1}
                cellThickness={
                  0.55
                }
                cellColor="#2a1f40"
                sectionSize={8}
                sectionThickness={
                  1.1
                }
                sectionColor="#9945FF"
                fadeDistance={
                  volume.size *
                  2
                }
              />
            )}

            <Ground
              size={
                volume.size
              }
              onHit={onHit}
              onHover={
                onHover
              }
            />

            <VolumeFrame
              size={
                volume.size
              }
            />

            <VoxelCloud
              volume={
                volume
              }
              palette={
                palette
              }
              revision={
                rev
              }
              selected={
                selected
              }
              clip={
                clip
              }
              onHit={
                onHit
              }
              onHover={
                onHover
              }
            />

            {pendingImage && (
              <PendingPreview
                voxels={
                  pendingImage.voxels
                }
                palette={
                  pendingImage.palette
                }
              />
            )}

            {ghost &&
              tool !==
                "box" &&
              (
                tool ===
                  "attach" ||
                brush > 1
              ) && (
                <Ghost
                  cell={
                    ghost
                  }
                  color={
                    palette[
                      color
                    ]
                  }
                  valid={
                    ghostValid ||
                    tool !==
                      "attach"
                  }
                />
              )}

            {tool ===
              "box" &&
              boxStart &&
              ghost && (
                <BoxPreview
                  a={
                    boxStart
                  }
                  b={
                    ghost
                  }
                />
              )}

            {tool !==
              "box" &&
              clipboard.length >
                0 &&
              ghost && (
                <OffsetGhost
                  items={
                    clipboard
                  }
                  origin={
                    ghost
                  }
                />
              )}

            <CameraRig
              view={
                view
              }
              size={
                volume.size
              }
              focus={
                focus
              }
            />

            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={
                0.08
              }
              target={
                focus
              }
              mouseButtons={{
                LEFT:
                  undefined,
                MIDDLE:
                  THREE.MOUSE.PAN,
                RIGHT:
                  THREE.MOUSE.ROTATE
              }}
              enableRotate={
                view ===
                "iso"
              }
              minDistance={
                4
              }
              maxDistance={
                volume.size *
                4
              }
            />
          </Canvas>

          {toast && (
            <div className="toast">
              {
                toast
              }
            </div>
          )}

          {pendingImage &&
            !paywall && (
              <div
                className="toast"
                style={{
                  bottom: 24,
                  minWidth: 300
                }}
              >
                <div
                  style={{
                    marginBottom: 8
                  }}
                >
                  APPLY IMAGE ·{" "}
                  {
                    pendingImage.count ??
                    pendingImage.voxels.length
                  }{" "}
                  VX ·{" "}
                  {
                    pendingImage.width
                  }
                  ×
                  {
                    pendingImage.height
                  }{" "}
                  ·{" "}
                  {
                    imageMode.toUpperCase()
                  }{" "}
                  ·{" "}
                  {viewLabel}
                </div>

                <div className="viewRow">
                  <button
                    onClick={
                      applyImage
                    }
                    disabled={
                      busy
                    }
                  >
                    APPLY
                  </button>

                  <button
                    onClick={
                      cancelImage
                    }
                    disabled={
                      busy
                    }
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}

          {paywall && (
            <div
              className="toast"
              style={{
                bottom: 24,
                minWidth: 300
              }}
            >
              <div
                style={{
                  marginBottom: 8
                }}
              >
                FREE LIMIT REACHED ·{" "}
                {
                  MONTHLY_SOL
                }{" "}
                SOL / month · Phantom
              </div>

              <div className="viewRow">
                <button
                  onClick={() =>
                    void subscribe()
                  }
                  disabled={
                    busy
                  }
                >
                  PAY{" "}
                  {
                    MONTHLY_SOL
                  }{" "}
                  SOL
                </button>

                <button
                  onClick={
                    cancelImage
                  }
                  disabled={
                    busy
                  }
                >
                  CANCEL
                </button>
              </div>
            </div>
          )}
        </section>

        <aside className="inspector">
          <p className="panelLabel">
            INSPECTOR
          </p>

          <details className="fold">
            <summary>
              GUIDE
            </summary>

            <div className="foldBody">
              <p className="foldHint">
                FRONT / SIDE PNG
                <br />
                MULTI-VIEW RECONSTRUCTION
                <br />
                MODEL + 2 VIEWS = MAX QUALITY
                <br />
                SYMMETRY = CHARACTER / ARMOR
                <br />
                ENTER apply · ESC cancel · F fit
                <br />
                GLB / VOX / OBJ ZIP
              </p>
            </div>
          </details>

          <div className="viewRow">
            {(
              [
                "iso",
                "top",
                "front",
                "side"
              ] as ViewMode[]
            ).map(
              (
                mode
              ) => (
                <button
                  key={
                    mode
                  }
                  className={
                    view ===
                    mode
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    setView(
                      mode
                    )
                  }
                >
                  {mode.toUpperCase()}
                </button>
              )
            )}
          </div>

          <button
            className={
              grid
                ? "modeOn"
                : ""
            }
            onClick={() =>
              setGrid(
                (g) => !g
              )
            }
          >
            GRID{" "}
            {
              grid
                ? "ON"
                : "OFF"
            }
          </button>

          <p className="category">
            CLIP
          </p>

          <div className="viewRow">
            {(
              [
                null,
                "x",
                "y",
                "z"
              ] as const
            ).map(
              (
                axis
              ) => (
                <button
                  key={String(
                    axis
                  )}
                  className={
                    clip.axis ===
                    axis
                      ? "modeOn"
                      : ""
                  }
                  onClick={() =>
                    setClip(
                      {
                        axis,
                        value:
                          axis
                            ? Math.floor(
                                volume.size /
                                  2
                              )
                            : volume.size -
                              1
                      }
                    )
                  }
                >
                  {axis
                    ? axis.toUpperCase()
                    : "OFF"}
                </button>
              )
            )}
          </div>

          {clip.axis && (
            <input
              type="range"
              min={0}
              max={
                volume.size -
                1
              }
              value={
                clip.value
              }
              onChange={(
                e
              ) =>
                setClip(
                  (current) => ({
                    ...current,
                    value:
                      Number(
                        e.target.value
                      )
                  })
                )
              }
            />
          )}

          <p className="category">
            IMAGE IMPORT
          </p>

          <div className="viewRow">
            {(
              [
                "solid",
                "flat",
                "relief",
                "model"
              ] as ImageMode[]
            ).map(
              (
                mode
              ) => (
                <button
                  key={
                    mode
                  }
                  className={
                    imageMode ===
                    mode
                      ? "modeOn"
                      : ""
                  }
                  onClick={() => {
                    setImageMode(
                      mode
                    );

                    setSymmetrize(
                      mode ===
                        "model"
                    );
                  }}
                >
                  {mode.toUpperCase()}
                </button>
              )
            )}
          </div>

          {(imageMode ===
            "solid" ||
            imageMode ===
              "relief" ||
            imageMode ===
              "model") && (
            <div className="viewRow">
              {[4, 8, 12, 16].map(
                (n) => (
                  <button
                    key={
                      n
                    }
                    className={
                      imageHeight ===
                      n
                        ? "modeOn"
                        : ""
                    }
                    onClick={() =>
                      setImageHeight(
                        n
                      )
                    }
                  >
                    H{n}
                  </button>
                )
              )}
            </div>
          )}

          {imageMode ===
            "model" && (
            <button
              className={
                symmetrize
                  ? "modeOn"
                  : ""
              }
              onClick={() =>
                setSymmetrize(
                  (s) =>
                    !s
                )
              }
              title="Specchia la metà meglio ricostruita sull'altra: utile per personaggi e armature simmetriche"
            >
              SYMMETRY{" "}
              {
                symmetrize
                  ? "ON"
                  : "OFF"
              }
            </button>
          )}

          <p className="category">
            MULTI VIEW ·{" "}
            {viewCount}/2
          </p>

          <button
            onClick={() =>
              frontRef.current?.click()
            }
            disabled={
              busy
            }
            className={
              frontFile
                ? "modeOn"
                : ""
            }
          >
            {
              frontFile
                ? "FRONT ON"
                : "ADD FRONT PNG"
            }
          </button>

          <button
            onClick={() =>
              sideRef.current?.click()
            }
            disabled={
              busy
            }
            className={
              sideFile
                ? "modeOn"
                : ""
            }
          >
            {
              sideFile
                ? "SIDE ON"
                : "ADD SIDE PNG"
            }
          </button>

          <button
            onClick={() =>
              void rebuildMultiView()
            }
            disabled={
              busy ||
              !frontFile
            }
          >
            REBUILD 3D
          </button>

          <div className="viewRow">
            <button
              onClick={removeSide}
              disabled={busy || !sideFile}
            >
              REMOVE SIDE
            </button>
          </div>

          <input
            ref={
              sideRef
            }
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            hidden
            onChange={(
              e
            ) => {
              const file =
                e.target.files?.[0];

              if (
                file
              ) {
                void attachSide(
                  file
                );
              }

              e.target.value =
                "";
            }}
          />

          <p className="foldHint">
            {frontFile
              ? "FRONT READY"
              : "FRONT REQUIRED"}
            <br />
            {sideFile
              ? "SIDE READY"
              : imageMode === "model"
                ? "SIDE REQUIRED FOR MODEL"
                : "SIDE OPTIONAL"}
            <br />
            {imageMode === "model"
              ? viewCount === 2
                ? "2-VIEW MODEL READY"
                : "MODEL NEEDS FRONT + SIDE"
              : viewCount === 2
                ? "2-VIEW RECONSTRUCTION READY"
                : viewCount === 1
                  ? "SINGLE-VIEW MODE"
                  : "NO SOURCE IMAGE"}
          </p>

          <p className="category">
            PALETTE
          </p>

          <div className="colorRow dense">
            {palette
              .slice(
                0,
                64
              )
              .map(
                (
                  hex,
                  i
                ) => (
                  <button
                    key={`${hex}-${i}`}
                    className={`swatch ${
                      color === i
                        ? "swatchOn"
                        : ""
                    }`}
                    style={{
                      background:
                        hex
                    }}
                    onClick={() =>
                      setColor(
                        i
                      )
                    }
                  />
                )
              )}
          </div>

          <input
            type="color"
            value={
              palette[
                color
              ]
            }
            onChange={(
              e
            ) => {
              const next =
                palette.slice();

              next[color] =
                e.target.value;

              setPalette(
                next
              );
            }}
          />

          <p className="hint">
            {selected.size
              ? `${selected.size} SELECTED`
              : ghost
                ? `${ghost.x},${ghost.y},${ghost.z}`
                : "NO HIT"}
          </p>

          {selected.size >
            0 && (
            <>
              <button
                onClick={
                  copySelected
                }
              >
                COPY
              </button>

              <button
                onClick={
                  duplicateSelected
                }
              >
                DUPLICATE
              </button>

              <button
                onClick={
                  paintSelected
                }
              >
                PAINT SEL
              </button>

              <button
                onClick={
                  deleteSelected
                }
              >
                DELETE SEL
              </button>
            </>
          )}

          {clipboard.length >
            0 && (
            <button
              onClick={() =>
                pasteClipboard()
              }
            >
              PASTE{" "}
              {
                clipboard.length
              }
            </button>
          )}
        </aside>
      </div>
    </main>
  );
}
