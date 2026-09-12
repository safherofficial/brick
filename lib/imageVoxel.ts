export type ImageMode =
  | "solid"
  | "flat"
  | "relief"
  | "model";

export type ImageVoxel = {
  x: number;
  y: number;
  z: number;
  c: number;
};

export type ImageImport = {
  width: number;
  height: number;
  voxels: ImageVoxel[];
  palette: string[];
  count: number;
};

export type ImageVoxelOptions = {
  volumeSize?: number;
  mode?: ImageMode;
  heightMax?: number;
  maxVoxels?: number;
  symmetrize?: boolean;
};

export type ImageViews = {
  front: File;
  side?: File;
  back?: File;
};

type Raster = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

type Sample = {
  r: number;
  g: number;
  b: number;
  a: number;
  visible: boolean;
};

type ContentBoundsLike = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width?: number;
  height?: number;
};

const DEFAULT_PALETTE = [
  "#111111",
  "#ffffff",
  "#d9d9d9",
  "#8a8a8a",
  "#3f3f3f",
  "#d72d32",
  "#ff6b2d",
  "#f0c52b",
  "#4fae4f",
  "#1596d1",
  "#3456c1",
  "#754bc4",
  "#d34893",
  "#7a4b2a",
  "#5a9b47",
  "#9e6a3a"
];

//
// MODEL quality settings.
//
// The previous implementation used a 320px raster and then estimated
// depth from luminance / a thickness ratio. MODEL now uses the actual
// silhouette information from the additional views.
//
const MAX_RASTER_EDGE = 512;
const MIN_ALPHA = 20;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function hexOf(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) =>
      clamp(Math.round(v), 0, 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

function rgbDistance(
  a: [number, number, number],
  b: [number, number, number]
) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];

  return dr * dr + dg * dg + db * db;
}

function loadImage(file: File): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      try {
        const scale = Math.min(
          1,
          MAX_RASTER_EDGE /
            Math.max(
              img.naturalWidth,
              img.naturalHeight
            )
        );

        const width = Math.max(
          1,
          Math.round(img.naturalWidth * scale)
        );

        const height = Math.max(
          1,
          Math.round(img.naturalHeight * scale)
        );

        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true
        });

        if (!ctx) {
          throw new Error("Canvas unavailable");
        }

        ctx.clearRect(
          0,
          0,
          width,
          height
        );

        ctx.drawImage(
          img,
          0,
          0,
          width,
          height
        );

        resolve({
          width,
          height,
          rgba: ctx.getImageData(
            0,
            0,
            width,
            height
          ).data
        });
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(
        new Error("Unable to read image")
      );
    };

    img.src = url;
  });
}

function sampleAt(
  raster: Raster,
  x: number,
  y: number
): Sample {
  const xx = clamp(
    Math.round(x),
    0,
    raster.width - 1
  );

  const yy = clamp(
    Math.round(y),
    0,
    raster.height - 1
  );

  const i =
    (yy * raster.width + xx) * 4;

  const r = raster.rgba[i];
  const g = raster.rgba[i + 1];
  const b = raster.rgba[i + 2];
  const a = raster.rgba[i + 3];

  return {
    r,
    g,
    b,
    a,
    visible: a >= MIN_ALPHA
  };
}

function looksLikeBackground(
  raster: Raster
): [number, number, number] {
  const points = [
    [0, 0],
    [raster.width - 1, 0],
    [0, raster.height - 1],
    [raster.width - 1, raster.height - 1],
    [Math.floor(raster.width / 2), 0],
    [0, Math.floor(raster.height / 2)],
    [
      raster.width - 1,
      Math.floor(raster.height / 2)
    ],
    [
      Math.floor(raster.width / 2),
      raster.height - 1
    ]
  ];

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (const [x, y] of points) {
    const s = sampleAt(
      raster,
      x,
      y
    );

    if (s.a < MIN_ALPHA) continue;

    r += s.r;
    g += s.g;
    b += s.b;
    count += 1;
  }

  if (!count) {
    return [255, 255, 255];
  }

  return [
    r / count,
    g / count,
    b / count
  ];
}

function backgroundLike(
  s: Sample,
  bg: [number, number, number],
  mode: ImageMode
) {
  if (!s.visible) return true;

  const dr = s.r - bg[0];
  const dg = s.g - bg[1];
  const db = s.b - bg[2];

  const dist = Math.sqrt(
    dr * dr +
      dg * dg +
      db * db
  );

  const bgL =
    0.299 * bg[0] +
    0.587 * bg[1] +
    0.114 * bg[2];

  const l =
    0.299 * s.r +
    0.587 * s.g +
    0.114 * s.b;

  const saturation =
    Math.max(s.r, s.g, s.b) -
    Math.min(s.r, s.g, s.b);

  const tolerance =
    mode === "flat"
      ? 24
      : 34;

  return (
    dist < tolerance &&
    Math.abs(l - bgL) < 26 &&
    saturation < 245
  );
}

function buildMask(
  raster: Raster,
  mode: ImageMode
): boolean[][] {
  const bg =
    looksLikeBackground(raster);

  const w = raster.width;
  const h = raster.height;

  // Candidati "sfondo" per colore, non ancora la maschera finale: una zona in
  // ombra del soggetto può avere un colore vicino allo sfondo pur non
  // essendolo. La differenza tra soggetto e sfondo la fa la connettività,
  // non solo il colore.
  const candidate = Array.from(
    { length: h },
    () => Array<boolean>(w).fill(false)
  );

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      candidate[y][x] = backgroundLike(
        sampleAt(raster, x, y),
        bg,
        mode
      );
    }
  }

  // Flood-fill a 4 vicini a partire dal solo bordo dell'immagine: un pixel
  // diventa sfondo solo se raggiungibile dal bordo attraverso una catena di
  // pixel "simili allo sfondo". Una regione in ombra del soggetto (stesso
  // tono dello sfondo ma circondata dal soggetto stesso) non è collegata al
  // bordo e resta quindi parte del soggetto: non taglia più la sagoma in due.
  const isBackground = Array.from(
    { length: h },
    () => Array<boolean>(w).fill(false)
  );

  const stack: [number, number][] = [];

  const seed = (x: number, y: number) => {
    if (candidate[y][x] && !isBackground[y][x]) {
      isBackground[y][x] = true;
      stack.push([x, y]);
    }
  };

  for (let x = 0; x < w; x += 1) {
    seed(x, 0);
    seed(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    seed(0, y);
    seed(w - 1, y);
  }

  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isBackground[ny][nx] || !candidate[ny][nx]) continue;
      isBackground[ny][nx] = true;
      stack.push([nx, ny]);
    }
  }

  const mask = Array.from(
    { length: h },
    (_, y) => Array.from({ length: w }, (_, x) => !isBackground[y][x])
  );

  //
  // Remove isolated single-pixel noise.
  //
  // Do not perform aggressive erosion/dilation here because
  // thin character parts, weapons and props are important.
  //
  for (
    let y = 0;
    y < raster.height;
    y += 1
  ) {
    for (
      let x = 0;
      x < raster.width;
      x += 1
    ) {
      if (!mask[y][x]) continue;

      let neighbours = 0;

      for (
        let oy = -1;
        oy <= 1;
        oy += 1
      ) {
        for (
          let ox = -1;
          ox <= 1;
          ox += 1
        ) {
          if (!ox && !oy) continue;

          const yy = y + oy;
          const xx = x + ox;

          if (
            yy >= 0 &&
            yy < raster.height &&
            xx >= 0 &&
            xx < raster.width &&
            mask[yy][xx]
          ) {
            neighbours += 1;
          }
        }
      }

      if (neighbours === 0) {
        mask[y][x] = false;
      }
    }
  }

  return mask;
}

function findBounds(
  mask: boolean[][]
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (
    let y = 0;
    y < mask.length;
    y += 1
  ) {
    for (
      let x = 0;
      x < mask[y].length;
      x += 1
    ) {
      if (!mask[y][x]) continue;

      minX = Math.min(
        minX,
        x
      );

      minY = Math.min(
        minY,
        y
      );

      maxX = Math.max(
        maxX,
        x
      );

      maxY = Math.max(
        maxY,
        y
      );
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width:
      maxX - minX + 1,
    height:
      maxY - minY + 1
  };
}

function normalizedX(
  x: number,
  bounds: {
    minX: number;
    width: number;
  }
) {
  if (bounds.width <= 1) {
    return 0.5;
  }

  return clamp(
    (x - bounds.minX) /
      (bounds.width - 1),
    0,
    1
  );
}

function dominantPalette(
  samples: {
    r: number;
    g: number;
    b: number;
    weight: number;
  }[],
  size: number
): string[] {
  if (!samples.length) {
    return DEFAULT_PALETTE.slice(
      0,
      size
    );
  }

  const sorted =
    samples
      .slice()
      .sort(
        (a, b) =>
          b.weight - a.weight
      );

  const chosen: [
    number,
    number,
    number
  ][] = [];

  for (
    const item of sorted
  ) {
    const rgb: [
      number,
      number,
      number
    ] = [
      item.r,
      item.g,
      item.b
    ];

    if (
      chosen.every(
        (c) =>
          rgbDistance(
            rgb,
            c
          ) > 900
      )
    ) {
      chosen.push(rgb);
    }

    if (
      chosen.length >= size
    ) {
      break;
    }
  }

  if (
    chosen.length < size
  ) {
    for (
      const base of DEFAULT_PALETTE
    ) {
      if (
        chosen.length >=
        size
      ) {
        break;
      }

      const hex =
        base.replace(
          "#",
          ""
        );

      const rgb: [
        number,
        number,
        number
      ] = [
        Number.parseInt(
          hex.slice(0, 2),
          16
        ),
        Number.parseInt(
          hex.slice(2, 4),
          16
        ),
        Number.parseInt(
          hex.slice(4, 6),
          16
        )
      ];

      if (
        chosen.every(
          (c) =>
            rgbDistance(
              rgb,
              c
            ) > 400
        )
      ) {
        chosen.push(rgb);
      }
    }
  }

  return chosen.map(
    ([r, g, b]) =>
      hexOf(r, g, b)
  );
}

function createPalette(
  rasters: Raster[],
  masks: boolean[][][],
  size = 48
) {
  const buckets =
    new Map<
      string,
      {
        r: number;
        g: number;
        b: number;
        weight: number;
      }
    >();

  for (
    let view = 0;
    view < rasters.length;
    view += 1
  ) {
    const raster =
      rasters[view];

    const mask =
      masks[view];

    const stride = Math.max(
      1,
      Math.floor(
        Math.sqrt(
          (raster.width *
            raster.height) /
            50000
        )
      )
    );

    for (
      let y = 0;
      y < raster.height;
      y += stride
    ) {
      for (
        let x = 0;
        x < raster.width;
        x += stride
      ) {
        if (
          !mask[y]?.[x]
        ) {
          continue;
        }

        const s =
          sampleAt(
            raster,
            x,
            y
          );

        if (!s.visible) {
          continue;
        }

        const r =
          Math.round(
            s.r / 8
          ) * 8;

        const g =
          Math.round(
            s.g / 8
          ) * 8;

        const b =
          Math.round(
            s.b / 8
          ) * 8;

        const key =
          `${r}:${g}:${b}`;

        const existing =
          buckets.get(key);

        if (existing) {
          existing.weight += 1;
        } else {
          buckets.set(
            key,
            {
              r,
              g,
              b,
              weight: 1
            }
          );
        }
      }
    }
  }

  return dominantPalette(
    [
      ...buckets.values()
    ],
    size
  );
}

function paletteRgb(
  palette: string[]
) {
  return palette.map(
    (hex) => {
      const value =
        hex.replace(
          "#",
          ""
        );

      return [
        Number.parseInt(
          value.slice(0, 2),
          16
        ),
        Number.parseInt(
          value.slice(2, 4),
          16
        ),
        Number.parseInt(
          value.slice(4, 6),
          16
        )
      ] as [
        number,
        number,
        number
      ];
    }
  );
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5]
];

function ditheredColor(
  rgb: [number, number, number],
  px: number,
  py: number,
  strength = 14
): [number, number, number] {
  // Una palette piccola (48-72 colori) su un degradé morbido (l'ombreggiatura
  // di un render 3D, un'illuminazione ambientale) crea bande nette visibili
  // quando ogni pixel viene arrotondato al colore più vicino allo stesso modo.
  // Un dither ordinato (matrice di Bayer) sposta leggermente il colore prima
  // dell'arrotondamento in modo diverso pixel per pixel: le bande nette
  // diventano una transizione granulare, molto meno visibile all'occhio, e la
  // geometria/silhouette non cambia in alcun modo.
  const offset =
    (BAYER_4X4[py & 3][px & 3] / 16 - 0.5) * strength;

  return [
    clamp(rgb[0] + offset, 0, 255),
    clamp(rgb[1] + offset, 0, 255),
    clamp(rgb[2] + offset, 0, 255)
  ];
}

function nearestColor(
  rgb: [
    number,
    number,
    number
  ],
  palette: [
    number,
    number,
    number
  ][]
) {
  let best = 0;
  let distance =
    Infinity;

  for (
    let i = 0;
    i < palette.length;
    i += 1
  ) {
    const d =
      rgbDistance(
        rgb,
        palette[i]
      );

    if (
      d < distance
    ) {
      distance = d;
      best = i;
    }
  }

  return best;
}

function resizeMask(
  mask: boolean[][],
  targetWidth: number,
  targetHeight: number
) {
  if (
    !mask.length ||
    !mask[0]?.length
  ) {
    return Array.from(
      {
        length:
          targetHeight
      },
      () =>
        Array<boolean>(
          targetWidth
        ).fill(false)
    );
  }

  const sourceHeight =
    mask.length;

  const sourceWidth =
    mask[0].length;

  return Array.from(
    {
      length:
        targetHeight
    },
    (_, y) => {
      const sy =
        (y /
          Math.max(
            1,
            targetHeight - 1
          )) *
        (sourceHeight - 1);

      return Array.from(
        {
          length:
            targetWidth
        },
        (_, x) => {
          const sx =
            (x /
              Math.max(
                1,
                targetWidth - 1
              )) *
            (sourceWidth - 1);

          const ix =
            Math.round(sx);

          const iy =
            Math.round(sy);

          if (
            mask[iy]?.[ix]
          ) {
            return true;
          }

          //
          // Small resampling dilation preserves thin
          // extremities without globally blurring the mask.
          //
          for (
            const [ox, oy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1]
            ]
          ) {
            if (
              mask[
                iy + oy
              ]?.[
                ix + ox
              ]
            ) {
              return true;
            }
          }

          return false;
        }
      );
    }
  );
}

function sampleMapped(
  raster: Raster,
  bounds: ContentBoundsLike,
  nx: number,
  ny: number
): Sample {
  const x =
    bounds.minX +
    clamp(nx, 0, 1) *
      (bounds.maxX -
        bounds.minX);

  const y =
    bounds.minY +
    clamp(ny, 0, 1) *
      (bounds.maxY -
        bounds.minY);

  return sampleAt(
    raster,
    x,
    y
  );
}

function maskMapped(
  mask: boolean[][],
  bounds: ContentBoundsLike,
  nx: number,
  ny: number
) {
  const x = Math.round(
    bounds.minX +
      clamp(nx, 0, 1) *
        (bounds.maxX -
          bounds.minX)
  );

  const y = Math.round(
    bounds.minY +
      clamp(ny, 0, 1) *
        (bounds.maxY -
          bounds.minY)
  );

  if (
    mask[y]?.[x]
  ) {
    return true;
  }

  //
  // Small tolerance around a mapped silhouette pixel.
  // This prevents holes caused by different aspect ratios
  // between FRONT and SIDE photographs.
  //
  for (
    let oy = -1;
    oy <= 1;
    oy += 1
  ) {
    for (
      let ox = -1;
      ox <= 1;
      ox += 1
    ) {
      if (
        mask[
          y + oy
        ]?.[
          x + ox
        ]
      ) {
        return true;
      }
    }
  }

  return false;
}

function buildSingleView(
  raster: Raster,
  options: Required<ImageVoxelOptions>,
  palette: string[]
): ImageImport {
  const mode =
    options.mode;

  const mask =
    buildMask(
      raster,
      mode
    );

  const bounds =
    findBounds(mask);

  if (!bounds) {
    throw new Error(
      "No visible subject found"
    );
  }

  const longest =
    Math.max(
      bounds.width,
      bounds.height
    );

  const scale =
    Math.min(
      1,
      (options.volumeSize - 8) /
        Math.max(
          1,
          longest
        )
    );

  const sx =
    Math.max(
      1,
      Math.round(
        bounds.width *
          scale
      )
    );

  const sy =
    Math.max(
      1,
      Math.round(
        bounds.height *
          scale
      )
    );

  const resized =
    resizeMask(
      mask,
      sx,
      sy
    );

  const paletteValues =
    paletteRgb(
      palette
    );

  const voxels:
    ImageVoxel[] = [];

  //
  // Keep the old modes behaving as expected.
  //
  const depthLayers =
    (() => {
      switch (mode) {
        case "flat":
          return 1;

        case "relief":
          return Math.max(
            2,
            Math.round(
              options.heightMax *
                0.35
            )
          );

        case "model":
          return Math.max(
            4,
            Math.min(
              options.volumeSize -
                8,
              Math.round(
                options.heightMax *
                  1.05
              )
            )
          );

        case "solid":
        default:
          return Math.max(
            2,
            Math.round(
              options.heightMax *
                0.65
            )
          );
      }
    })();

  for (
    let y = 0;
    y < sy;
    y += 1
  ) {
    for (
      let x = 0;
      x < sx;
      x += 1
    ) {
      if (
        !resized[y]?.[x]
      ) {
        continue;
      }

      const nx =
        x /
        Math.max(
          1,
          sx - 1
        );

      const ny =
        y /
        Math.max(
          1,
          sy - 1
        );

      const sourceX =
        bounds.minX +
        nx *
          (bounds.width - 1);

      const sourceY =
        bounds.minY +
        ny *
          (bounds.height - 1);

      const sample =
        sampleAt(
          raster,
          sourceX,
          sourceY
        );

      //
      // MODEL single-view is now a controlled 2.5D volume.
      //
      // It does not pretend that luminance is depth.
      // Instead, depth is thicker in the body/core and thinner
      // towards the silhouette boundary.
      //
      const edgeX =
        Math.min(
          nx,
          1 - nx
        );

      const edgeY =
        Math.min(
          ny,
          1 - ny
        );

      const radial =
        clamp(
          Math.min(
            edgeX,
            edgeY
          ) * 4,
          0,
          1
        );

      let localDepth =
        depthLayers;

      if (
        mode === "model"
      ) {
        localDepth =
          Math.max(
            2,
            Math.round(
              depthLayers *
                (0.58 +
                  radial *
                    0.42)
            )
          );
      }

      for (
        let z = 0;
        z < localDepth;
        z += 1
      ) {
        const c =
          nearestColor(
            ditheredColor(
              [sample.r, sample.g, sample.b],
              x,
              y
            ),
            paletteValues
          );

        voxels.push({
          x,
          y: Math.round(
            ny *
              (options.volumeSize -
                1)
          ),
          z,
          c
        });
      }
    }
  }

  if (
    options.symmetrize &&
    mode === "model"
  ) {
    symmetrizeVoxels(
      voxels,
      options.volumeSize,
      paletteValues.length
    );
  }

  const limited =
    enforceVoxelBudget(
      voxels,
      options.maxVoxels,
      mode
    );

  const normalized =
    normalizeToVolume(
      limited,
      options.volumeSize,
      sx,
      depthLayers
    );

  return {
    width:
      raster.width,
    height:
      raster.height,
    voxels:
      normalized,
    palette,
    count:
      normalized.length
  };
}

function blendRgb(
  a: Sample,
  b: Sample,
  t: number
): [
  number,
  number,
  number
] {
  const amount =
    clamp(t, 0, 1);

  return [
    a.r * (1 - amount) +
      b.r * amount,
    a.g * (1 - amount) +
      b.g * amount,
    a.b * (1 - amount) +
      b.b * amount
  ];
}

function reconstructModelVolume(
  frontRaster: Raster,
  frontMask: boolean[][],
  frontBounds: NonNullable<
    ReturnType<typeof findBounds>
  >,
  sideRaster:
    | Raster
    | undefined,
  sideMask:
    | boolean[][]
    | undefined,
  sideBounds:
    | NonNullable<
        ReturnType<
          typeof findBounds
        >
      >
    | null,
  backRaster:
    | Raster
    | undefined,
  backMask:
    | boolean[][]
    | undefined,
  backBounds:
    | NonNullable<
        ReturnType<
          typeof findBounds
        >
      >
    | null,
  options: Required<ImageVoxelOptions>,
  paletteValues: [
    number,
    number,
    number
  ][],
  targetWidth: number,
  targetHeight: number,
  targetDepth: number
) {
  const frontResized =
    resizeMask(
      frontMask,
      targetWidth,
      targetHeight
    );

  const sideResized =
    sideMask
      ? resizeMask(
          sideMask,
          targetDepth,
          targetHeight
        )
      : undefined;

  const backResized =
    backMask
      ? resizeMask(
          backMask,
          targetWidth,
          targetHeight
        )
      : undefined;

  const voxels:
    ImageVoxel[] = [];

  //
  // Visual hull reconstruction.
  //
  // Coordinate system:
  //
  // FRONT:
  //   x = model X
  //   y = model Y
  //
  // SIDE:
  //   x = model Z
  //   y = model Y
  //
  // Therefore a voxel survives only when both projections
  // agree that the point belongs to the subject.
  //
  for (
    let y = 0;
    y < targetHeight;
    y += 1
  ) {
    const ny =
      y /
      Math.max(
        1,
        targetHeight - 1
      );

    for (
      let x = 0;
      x < targetWidth;
      x += 1
    ) {
      if (
        !frontResized[y]?.[x]
      ) {
        continue;
      }

      const nx =
        x /
        Math.max(
          1,
          targetWidth - 1
        );

      const frontColor =
        sampleMapped(
          frontRaster,
          frontBounds,
          nx,
          ny
        );

      for (
        let z = 0;
        z < targetDepth;
        z += 1
      ) {
        const nz =
          z /
          Math.max(
            1,
            targetDepth - 1
          );

        //
        // FRONT + SIDE intersection.
        //
        if (
          sideResized &&
          !sideResized[
            y
          ]?.[z]
        ) {
          continue;
        }

        //
        // BACK is used as a second silhouette constraint only
        // when it clearly contains the mapped point.
        //
        // We use a soft rule here rather than hard intersection
        // because real FRONT/BACK photographs are frequently
        // a few pixels misaligned.
        //
        let backVisible =
          true;

        if (
          backResized
        ) {
          backVisible =
            Boolean(
              backResized[
                y
              ]?.[x]
            );
        }

        if (
          backResized &&
          !backVisible
        ) {
          //
          // Do not immediately discard it. FRONT remains the
          // authoritative silhouette; BACK only weakens the
          // far side of the volume.
          //
          if (
            nz > 0.78
          ) {
            continue;
          }
        }

        let color:
          [
            number,
            number,
            number
          ];

        if (
          sideRaster &&
          sideBounds &&
          sideResized?.[y]?.[z]
        ) {
          const sideColor =
            sampleMapped(
              sideRaster,
              sideBounds,
              nz,
              ny
            );

          //
          // FRONT dominates near the camera.
          // SIDE contributes increasingly towards the center.
          //
          const sideWeight =
            sideResized
              ? 0.18 +
                nz * 0.32
              : 0;

          color =
            blendRgb(
              frontColor,
              sideColor,
              sideWeight
            );
        } else {
          color = [
            frontColor.r,
            frontColor.g,
            frontColor.b
          ];
        }

        //
        // BACK colour becomes dominant towards the rear.
        //
        if (
          backRaster &&
          backBounds &&
          backResized?.[y]?.[x]
        ) {
          const backColor =
            sampleMapped(
              backRaster,
              backBounds,
              nx,
              ny
            );

          const backWeight =
            nz * 0.72;

          color =
            blendRgb(
              {
                r: color[0],
                g: color[1],
                b: color[2],
                a: 255,
                visible: true
              },
              backColor,
              backWeight
            );
        } else {
          // Nessuna foto del retro: il colore del fronte (o del fronte+side
          // già miscelato) resterebbe identico dall'altra parte del modello.
          // Lo scuriamo in modo progressivo verso z alto per simulare l'ombra
          // propria, così il retro non è indistinguibile dal fronte quando si
          // ruota il modello.
          const shade = 1 - nz * 0.42;
          color = [
            color[0] * shade,
            color[1] * shade,
            color[2] * shade
          ];
        }

        voxels.push({
          x,
          y: Math.round(
            ny *
              (options.volumeSize -
                1)
          ),
          z,
          c: nearestColor(
            ditheredColor(color, x, y + z),
            paletteValues
          )
        });
      }
    }
  }

  return voxels;
}

function normalizeToVolume(
  voxels: ImageVoxel[],
  volumeSize: number,
  _sx: number,
  _sz: number
) {
  if (!voxels.length) {
    return voxels;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (
    const v of voxels
  ) {
    minX = Math.min(
      minX,
      v.x
    );

    maxX = Math.max(
      maxX,
      v.x
    );

    maxY = Math.max(
      maxY,
      v.y
    );

    maxZ = Math.max(
      maxZ,
      v.z
    );
  }

  const width =
    Math.max(
      1,
      maxX - minX + 1
    );

  const depth =
    Math.max(
      1,
      maxZ + 1
    );

  const centerOffset =
    Math.floor(
      (volumeSize -
        width) /
        2
    ) - minX;

  const depthOffset =
    Math.floor(
      (volumeSize -
        depth) /
        2
    );

  //
  // Keep the subject slightly above the exact vertical centre.
  //
  const yOffset =
    Math.max(
      0,
      Math.floor(
        (volumeSize -
          maxY -
          1) *
          0.10
      )
    );

  //
  // Raster Y grows downwards.
  // World/voxel Y grows upwards.
  //
  return voxels.map(
    (v) => ({
      x: clamp(
        v.x +
          centerOffset,
        0,
        volumeSize - 1
      ),

      y: clamp(
        maxY -
          v.y +
          yOffset,
        0,
        volumeSize - 1
      ),

      z: clamp(
        v.z +
          depthOffset,
        0,
        volumeSize - 1
      ),

      c: v.c
    })
  );
}

function symmetrizeVoxels(
  voxels: ImageVoxel[],
  volumeSize: number,
  paletteSize: number
) {
  const existing =
    new Set(
      voxels.map(
        (v) =>
          `${v.x}:${v.y}:${v.z}`
      )
    );

  let minX =
    Infinity;

  let maxX =
    -Infinity;

  for (
    const voxel of voxels
  ) {
    minX = Math.min(
      minX,
      voxel.x
    );

    maxX = Math.max(
      maxX,
      voxel.x
    );
  }

  if (
    !Number.isFinite(
      minX
    ) ||
    !Number.isFinite(
      maxX
    )
  ) {
    return;
  }

  const center =
    (minX + maxX) / 2;

  const additions:
    ImageVoxel[] = [];

  for (
    const voxel of voxels
  ) {
    const mirroredX =
      Math.round(
        center * 2 -
          voxel.x
      );

    if (
      mirroredX < 0 ||
      mirroredX >=
        volumeSize
    ) {
      continue;
    }

    const key =
      `${mirroredX}:${voxel.y}:${voxel.z}`;

    if (
      existing.has(key)
    ) {
      continue;
    }

    additions.push({
      x: mirroredX,
      y: voxel.y,
      z: voxel.z,
      c: Math.max(
        0,
        Math.min(
          paletteSize - 1,
          voxel.c
        )
      )
    });

    existing.add(key);
  }

  voxels.push(
    ...additions
  );
}

function voxelKey(
  voxel: ImageVoxel
) {
  return `${voxel.x}:${voxel.y}:${voxel.z}`;
}

function keepLargestComponents(
  voxels: ImageVoxel[]
): ImageVoxel[] {
  // Un asset "game ready" non può avere voxel fluttuanti scollegati dal corpo
  // (rumore residuo dalla maschera, un pixel di sfondo mal classificato che
  // dopo il carving finisce isolato). Raggruppiamo per connettività a 6 vicini
  // e teniamo solo le componenti abbastanza grandi da essere parte del
  // soggetto, scartando le schegge.
  if (voxels.length < 2) return voxels;

  const map = new Map<string, ImageVoxel>();
  for (const v of voxels) map.set(voxelKey(v), v);

  const neighbours: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  const visited = new Set<string>();
  const components: ImageVoxel[][] = [];

  for (const start of voxels) {
    const startKey = voxelKey(start);
    if (visited.has(startKey)) continue;

    const stack = [start];
    visited.add(startKey);
    const component: ImageVoxel[] = [];

    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);

      for (const [dx, dy, dz] of neighbours) {
        const key = `${current.x + dx}:${current.y + dy}:${current.z + dz}`;
        if (visited.has(key)) continue;
        const neighbour = map.get(key);
        if (!neighbour) continue;
        visited.add(key);
        stack.push(neighbour);
      }
    }

    components.push(component);
  }

  if (components.length <= 1) return voxels;

  const largest = Math.max(...components.map((c) => c.length));
  const threshold = Math.max(6, Math.round(largest * 0.015));

  return components
    .filter((c) => c.length >= threshold)
    .flat();
}

function isSurfaceVoxel(
  voxel: ImageVoxel,
  occupied: Set<string>
) {
  const neighbours = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1]
  ];

  for (
    const [dx, dy, dz] of neighbours
  ) {
    if (
      !occupied.has(
        `${voxel.x + dx}:${voxel.y + dy}:${voxel.z + dz}`
      )
    ) {
      return true;
    }
  }

  return false;
}

function enforceVoxelBudget(
  voxels: ImageVoxel[],
  maxVoxels: number,
  mode: ImageMode
) {
  const limit =
    Math.max(
      1024,
      Math.floor(
        maxVoxels
      )
    );

  if (
    voxels.length <=
    limit
  ) {
    return voxels;
  }

  //
  // IMPORTANT:
  //
  // The old implementation selected voxels using their array index.
  // Because voxels are generated in raster order, that effectively
  // deleted arbitrary portions of the volume.
  //
  // We now preserve:
  //
  // 1. silhouette/surface voxels
  // 2. extremities / thin geometry
  // 3. interior voxels only after the above
  //
  const occupied =
    new Set(
      voxels.map(
        voxelKey
      )
    );

  const surface:
    ImageVoxel[] = [];

  const interior:
    ImageVoxel[] = [];

  for (
    const voxel of voxels
  ) {
    if (
      isSurfaceVoxel(
        voxel,
        occupied
      )
    ) {
      surface.push(
        voxel
      );
    } else {
      interior.push(
        voxel
      );
    }
  }

  if (
    surface.length >=
    limit
  ) {
    //
    // Surface itself is too large.
    // Sample it spatially using a deterministic 3D hash,
    // rather than array stride.
    //
    const result:
      ImageVoxel[] = [];

    const seen =
      new Set<string>();

    const stride =
      Math.max(
        1,
        Math.ceil(
          surface.length /
            limit
        )
      );

    for (
      const voxel of surface
    ) {
      const hash =
        Math.abs(
          (
            voxel.x * 73856093 +
            voxel.y * 19349663 +
            voxel.z * 83492791
          ) | 0
        );

      if (
        hash % stride !==
        0
      ) {
        continue;
      }

      const key =
        voxelKey(
          voxel
        );

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);
      result.push(
        voxel
      );

      if (
        result.length >=
        limit
      ) {
        break;
      }
    }

    //
    // Deterministic fallback.
    //
    if (
      result.length <
      limit
    ) {
      for (
        const voxel of surface
      ) {
        if (
          result.length >=
          limit
        ) {
          break;
        }

        const key =
          voxelKey(
            voxel
          );

        if (
          seen.has(key)
        ) {
          continue;
        }

        seen.add(key);
        result.push(
          voxel
        );
      }
    }

    return result;
  }

  //
  // Keep every surface voxel and use the remaining budget
  // for interior volume.
  //
  const result =
    surface.slice();

  const remaining =
    limit -
    result.length;

  if (
    remaining <= 0
  ) {
    return result;
  }

  if (
    interior.length <=
    remaining
  ) {
    result.push(
      ...interior
    );

    return result;
  }

  //
  // Deterministic 3D interior sampling.
  //
  const stride =
    Math.max(
      1,
      Math.ceil(
        Math.cbrt(
          interior.length /
            remaining
        )
      )
    );

  const selected =
    new Set<string>();

  for (
    const voxel of interior
  ) {
    const keep =
      (
        voxel.x +
        voxel.y +
        voxel.z
      ) %
        stride ===
      0;

    if (!keep) {
      continue;
    }

    const key =
      voxelKey(
        voxel
      );

    if (
      selected.has(key)
    ) {
      continue;
    }

    selected.add(key);
    result.push(
      voxel
    );

    if (
      result.length >=
      limit
    ) {
      break;
    }
  }

  //
  // Fill remaining slots if the stride was too aggressive.
  //
  if (
    result.length <
    limit
  ) {
    for (
      const voxel of interior
    ) {
      if (
        result.length >=
        limit
      ) {
        break;
      }

      const key =
        voxelKey(
          voxel
        );

      if (
        selected.has(key)
      ) {
        continue;
      }

      selected.add(key);
      result.push(
        voxel
      );
    }
  }

  return result;
}

function effectiveBudget(
  volumeSize: number,
  requested: number | undefined,
  mode: ImageMode,
  viewCount: number
) {
  const physical =
    volumeSize *
    volumeSize *
    volumeSize;

  const safety =
    mode === "model"
      ? 0.30
      : mode === "relief"
        ? 0.12
        : mode === "flat"
          ? 0.06
          : 0.16;

  const derived =
    Math.floor(
      physical *
        safety
    );

  const requestedBudget =
    requested ??
    derived;

  //
  // MODEL needs more volume because it is now a real
  // volumetric reconstruction when SIDE is supplied.
  //
  const minimumForViews =
    viewCount >= 3
      ? Math.floor(
          volumeSize *
            volumeSize *
            3
        )
      : viewCount >= 2
        ? Math.floor(
            volumeSize *
              volumeSize *
              2
          )
        : Math.floor(
            volumeSize *
              volumeSize *
              1.5
          );

  return Math.max(
    4096,
    Math.min(
      Math.max(
        requestedBudget,
        minimumForViews
      ),
      Math.floor(
        physical * 0.42
      )
    )
  );
}

export async function imageToVoxels(
  file: File,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  const normalized:
    Required<ImageVoxelOptions> =
    {
      volumeSize:
        options.volumeSize ??
        128,

      mode:
        options.mode ??
        "solid",

      heightMax:
        options.heightMax ??
        16,

      maxVoxels:
        options.maxVoxels ??
        100000,

      symmetrize:
        options.symmetrize ??
        false
    };

  const raster =
    await loadImage(
      file
    );

  const mask =
    buildMask(
      raster,
      normalized.mode
    );

  const palette =
    createPalette(
      [raster],
      [mask],
      normalized.mode ===
        "model"
        ? 64
        : 48
    );

  return buildSingleView(
    raster,
    normalized,
    palette
  );
}

export async function imagesToVoxels(
  views: ImageViews,
  options: ImageVoxelOptions = {}
): Promise<ImageImport> {
  if (!views.front) {
    throw new Error(
      "FRONT IMAGE REQUIRED"
    );
  }

  const normalized:
    Required<ImageVoxelOptions> =
    {
      volumeSize:
        options.volumeSize ??
        128,

      mode:
        options.mode ??
        "solid",

      heightMax:
        options.heightMax ??
        16,

      maxVoxels:
        options.maxVoxels ??
        100000,

      symmetrize:
        options.symmetrize ??
        false
    };

  const files = [
    views.front,
    views.side,
    views.back
  ].filter(
    Boolean
  ) as File[];

  const rasters =
    await Promise.all(
      files.map(
        (file) =>
          loadImage(file)
      )
    );

  const masks =
    rasters.map(
      (raster) =>
        buildMask(
          raster,
          normalized.mode
        )
    );

  const palette =
    createPalette(
      rasters,
      masks,
      normalized.mode ===
        "model"
        ? 64
        : 48
    );

  const frontRaster =
    rasters[0];

  const frontMask =
    masks[0];

  const frontBounds =
    findBounds(
      frontMask
    );

  if (!frontBounds) {
    throw new Error(
      "No visible subject found in FRONT"
    );
  }

  const sideRaster =
    views.side
      ? rasters[1]
      : undefined;

  const sideMask =
    views.side
      ? masks[1]
      : undefined;

  const sideBounds =
    sideMask
      ? findBounds(
          sideMask
        )
      : null;

  const backRaster =
    views.back
      ? rasters[
          views.side
            ? 2
            : 1
        ]
      : undefined;

  const backMask =
    views.back
      ? masks[
          views.side
            ? 2
            : 1
        ]
      : undefined;

  const backBounds =
    backMask
      ? findBounds(
          backMask
        )
      : null;

  const viewCount =
    1 +
    Number(
      Boolean(
        sideMask
      )
    ) +
    Number(
      Boolean(
        backMask
      )
    );

  const budget =
    effectiveBudget(
      normalized.volumeSize,
      normalized.maxVoxels,
      normalized.mode,
      viewCount
    );

  //
  // Keep the original aspect ratio of the FRONT subject.
  //
  const widthScale =
    Math.min(
      1,
      (normalized.volumeSize -
        8) /
        Math.max(
          1,
          frontBounds.width
        )
    );

  const targetWidth =
    Math.max(
      4,
      Math.min(
        normalized.volumeSize -
          8,
        Math.round(
          frontBounds.width *
            widthScale
        )
      )
    );

  const targetHeight =
    Math.max(
      4,
      Math.min(
        normalized.volumeSize -
          8,
        Math.round(
          frontBounds.height *
            widthScale
        )
      )
    );

  //
  // ------------------------------------------------------------
  // MODEL
  // ------------------------------------------------------------
  //
  // With SIDE:
  //   FRONT ∩ SIDE = visual hull
  //
  // With FRONT + SIDE + BACK:
  //   FRONT ∩ SIDE + BACK silhouette refinement
  //
  // With FRONT only:
  //   controlled 2.5D reconstruction
  //
  if (
    normalized.mode ===
    "model"
  ) {
    let targetDepth: number;

    if (
      sideBounds
    ) {
      //
      // SIDE width represents the physical depth of the asset.
      //
      const depthScale =
        Math.min(
          1,
          (normalized.volumeSize -
            8) /
            Math.max(
              1,
              sideBounds.width
            )
        );

      targetDepth =
        Math.max(
          4,
          Math.min(
            normalized.volumeSize -
              8,
            Math.round(
              sideBounds.width *
                depthScale
            )
          )
        );
    } else {
      //
      // No SIDE: use a controlled 2.5D depth.
      //
      targetDepth =
        Math.max(
          4,
          Math.min(
            normalized.volumeSize -
              8,
            Math.round(
              normalized.heightMax *
                1.05
            )
          )
        );
    }

    const paletteValues =
      paletteRgb(
        palette
      );

    let voxels =
      reconstructModelVolume(
        frontRaster,
        frontMask,
        frontBounds,
        sideRaster,
        sideMask,
        sideBounds,
        backRaster,
        backMask,
        backBounds,
        normalized,
        paletteValues,
        targetWidth,
        targetHeight,
        targetDepth
      );

    if (
      !voxels.length
    ) {
      throw new Error(
        "No voxels reconstructed"
      );
    }

    voxels = keepLargestComponents(voxels);

    if (
      normalized.symmetrize
    ) {
      symmetrizeVoxels(
        voxels,
        normalized.volumeSize,
        palette.length
      );
    }

    const limited =
      enforceVoxelBudget(
        voxels,
        budget,
        "model"
      );

    const normalizedVoxels =
      normalizeToVolume(
        limited,
        normalized.volumeSize,
        targetWidth,
        targetDepth
      );

    return {
      width:
        frontRaster.width,

      height:
        frontRaster.height,

      voxels:
        normalizedVoxels,

      palette,

      count:
        normalizedVoxels.length
    };
  }

  //
  // ------------------------------------------------------------
  // NON-MODEL MODES
  // ------------------------------------------------------------
  //
  // Keep the existing behaviour for FLAT / RELIEF / SOLID.
  //
  const sourceMask =
    resizeMask(
      frontMask,
      targetWidth,
      targetHeight
    );

  const paletteRgbValues =
    paletteRgb(
      palette
    );

  const voxels:
    ImageVoxel[] = [];

  const depthBase =
    normalized.mode ===
    "flat"
      ? 1
      : normalized.mode ===
        "relief"
        ? Math.max(
            2,
            Math.round(
              normalized.heightMax *
                0.3
            )
          )
        : Math.max(
            2,
            Math.round(
              normalized.heightMax *
                0.62
            )
          );

  for (
    let y = 0;
    y < targetHeight;
    y += 1
  ) {
    const yRatio =
      y /
      Math.max(
        1,
        targetHeight - 1
      );

    for (
      let x = 0;
      x < targetWidth;
      x += 1
    ) {
      if (
        !sourceMask[y]?.[x]
      ) {
        continue;
      }

      const nx =
        x /
        Math.max(
          1,
          targetWidth - 1
        );

      const frontColor =
        sampleMapped(
          frontRaster,
          frontBounds,
          nx,
          yRatio
        );

      let finalDepth =
        depthBase;

      if (
        sideMask &&
        sideBounds
      ) {
        //
        // Preserve the old thickness behaviour for non-MODEL modes.
        //
        const sideSample =
          maskMapped(
            sideMask,
            sideBounds,
            0.5,
            yRatio
          );

        if (
          sideSample
        ) {
          finalDepth =
            Math.max(
              1,
              Math.round(
                depthBase *
                  1.18
              )
            );
        }
      }

      for (
        let z = 0;
        z < finalDepth;
        z += 1
      ) {
        const zRatio =
          finalDepth <= 1
            ? 0
            : z /
              (finalDepth - 1);

        let colorSample =
          frontColor;

        if (
          backRaster &&
          backBounds
        ) {
          const backColor =
            sampleMapped(
              backRaster,
              backBounds,
              nx,
              yRatio
            );

          const blended =
            blendRgb(
              frontColor,
              backColor,
              zRatio
            );

          colorSample = {
            r: blended[0],
            g: blended[1],
            b: blended[2],
            a: 255,
            visible: true
          };
        }

        voxels.push({
          x,

          y: Math.round(
            yRatio *
              (normalized.volumeSize -
                1)
          ),

          z,

          c: nearestColor(
            ditheredColor(
              [colorSample.r, colorSample.g, colorSample.b],
              x,
              y + z
            ),
            paletteRgbValues
          )
        });
      }
    }
  }

  if (!voxels.length) {
    throw new Error(
      "No voxels reconstructed"
    );
  }

  const limited =
    enforceVoxelBudget(
      voxels,
      budget,
      normalized.mode
    );

  const normalizedVoxels =
    normalizeToVolume(
      limited,
      normalized.volumeSize,
      targetWidth,
      depthBase
    );

  return {
    width:
      frontRaster.width,

    height:
      frontRaster.height,

    voxels:
      normalizedVoxels,

    palette,

    count:
      normalizedVoxels.length
  };
}

function finalDepthFromVoxels(
  voxels: ImageVoxel[]
) {
  let maxZ = 0;

  for (
    const voxel of voxels
  ) {
    maxZ = Math.max(
      maxZ,
      voxel.z
    );
  }

  return maxZ + 1;
}
