// Counts items laid out on the floor in a camera frame, with plain image processing (no AI):
//  1. the floor's look is estimated area by area (the middle colour around each spot, leaving the items out),
//     so shine, uneven light and dark corners on the floor cancel out;
//  2. each pixel's difference from the floor there: its colour difference, plus how much lighter (or darker)
//     it is. Only one direction counts (items lighter or darker than the floor), so shadows are left out;
//  3. pixels clearly different (Otsu's cut, never below a minimum contrast) are "item"; specks are taken out
//     and small holes filled;
//  4. touching item pixels are grouped into blobs. Blobs touching the frame's edge (cut off), tiny ones
//     (marks) and huge ones (a patch of floor) aren't items;
//  5. one item's size is the typical blob (or one the user taps); a blob twice that size counts as 2.
// Works best with one layer of items, not stacked, fully inside the frame.

export type Photo = { data: Uint8ClampedArray; width: number; height: number };

/** Whether items look lighter or darker than the floor ("auto": worked out from the frame) */
export type Polarity = "auto" | "light" | "dark";

export type CountBlob = {
  id: number;
  /** Pixels in the blob */
  area: number;
  /** Centre, in photo pixels */
  x: number;
  y: number;
  /** Items this blob counts as (area ÷ one item's area, at least 1) */
  count: number;
};

export type CountResult = {
  blobs: CountBlob[];
  /** One item's area used, in pixels */
  unitArea: number;
  /** 1 where an item is, per pixel */
  mask: Uint8Array;
  /** The direction used */
  polarity: "light" | "dark";
};

/** Smallest difference from the floor (0–255) that can be an item, whatever the sensitivity */
const MIN_CONTRAST = 22;
/** The floor is estimated on a grid this many cells across the long side… */
const GRID = 8;
/** …each from the pixels within this many cells around it (wide enough that items don't fill it) */
const REACH = 1.5;

const middle = (v: number[]) => {
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
};

/**
 * The floor's colour at every pixel: the middle colour of the pixels around each grid point (items left out
 * where `skip` marks them), then blended smoothly between grid points.
 */
function floorEstimate({ data, width, height }: Photo, skip?: Uint8Array): Float32Array {
  const cell = Math.max(width, height) / GRID;
  const cols = Math.max(2, Math.round(width / cell) + 1);
  const rows = Math.max(2, Math.round(height / cell) + 1);
  const reach = cell * REACH;
  // About 100 samples per channel per grid point: plenty for a middle value, and quick
  const step = Math.max(1, Math.round((reach * 2) / 10));
  const grid = new Float32Array(cols * rows * 3);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cx = (gx / (cols - 1)) * (width - 1);
      const cy = (gy / (rows - 1)) * (height - 1);
      const ch: number[][] = [[], [], []];
      const fallback: number[][] = [[], [], []];
      for (let y = Math.max(0, Math.round(cy - reach)); y <= Math.min(height - 1, cy + reach); y += step) {
        for (let x = Math.max(0, Math.round(cx - reach)); x <= Math.min(width - 1, cx + reach); x += step) {
          const p = y * width + x;
          const target = skip?.[p] ? fallback : ch;
          for (let c = 0; c < 3; c++) target[c].push(data[p * 4 + c]);
        }
      }
      // Mostly items here: use everything rather than a handful of pixels
      const use = ch[0].length >= 12 ? ch : [ch[0].concat(fallback[0]), ch[1].concat(fallback[1]), ch[2].concat(fallback[2])];
      for (let c = 0; c < 3; c++) grid[(gy * cols + gx) * 3 + c] = middle(use[c]);
    }
  }
  // Blend between grid points
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const fy = (y / Math.max(1, height - 1)) * (rows - 1);
    const y0 = Math.min(rows - 2, Math.floor(fy));
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = (x / Math.max(1, width - 1)) * (cols - 1);
      const x0 = Math.min(cols - 2, Math.floor(fx));
      const tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const a = grid[(y0 * cols + x0) * 3 + c];
        const b = grid[(y0 * cols + x0 + 1) * 3 + c];
        const d = grid[((y0 + 1) * cols + x0) * 3 + c];
        const e = grid[((y0 + 1) * cols + x0 + 1) * 3 + c];
        out[(y * width + x) * 3 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

/** Otsu's threshold over values 0–255: the cut that best splits them into two groups */
function otsu(values: Uint8Array) {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let weightB = 0;
  let best = 0;
  let cut = 0;
  for (let t = 0; t < 256; t++) {
    weightB += hist[t];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += t * hist[t];
    const between = weightB * weightF * (sumB / weightB - (sum - sumB) / weightF) ** 2;
    if (between > best) {
      best = between;
      cut = t;
    }
  }
  return cut;
}

/** Grows (`grow`) or shrinks the item area by r pixels: a square window, done row then column */
function morph(mask: Uint8Array, width: number, height: number, r: number, grow: boolean) {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length);
    const [outer, inner] = horizontal ? [height, width] : [width, height];
    for (let a = 0; a < outer; a++) {
      for (let b = 0; b < inner; b++) {
        let hit = !grow;
        for (let d = -r; d <= r; d++) {
          const k = b + d;
          if (k < 0 || k >= inner) continue;
          const v = horizontal ? src[a * width + k] : src[k * width + a];
          if (grow ? v : !v) {
            hit = grow;
            break;
          }
        }
        out[horizontal ? a * width + b : b * width + a] = hit ? 1 : 0;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** How different each pixel is from the floor there (0–255), counting only lighter or darker */
function difference({ data, width, height }: Photo, floor: Float32Array, polarity: "light" | "dark") {
  const n = width * height;
  const raw = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const dr = data[p * 4] - floor[p * 3];
    const dg = data[p * 4 + 1] - floor[p * 3 + 1];
    const db = data[p * 4 + 2] - floor[p * 3 + 2];
    const dl = 0.299 * dr + 0.587 * dg + 0.114 * db;
    // Colour difference (not brightness), plus brightness only in the items' direction: a shadow is just darker
    const colour = Math.hypot(dr - dl, dg - dl, db - dl);
    raw[p] = colour * 1.5 + Math.max(0, polarity === "light" ? dl : -dl);
  }
  // Smoothed over each pixel's neighbours, so camera grain doesn't count
  const out = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          s += raw[yy * width + xx];
          c++;
        }
      }
      out[y * width + x] = Math.min(255, Math.round(s / c));
    }
  }
  return out;
}

function threshold(diff: Uint8Array, sensitivity: number) {
  // Sensitivity moves the cut by at most a fifth either way, so it can't turn the floor into items
  const cut = Math.max(MIN_CONTRAST * (1 - sensitivity / 250), otsu(diff) * (1 - sensitivity / 250));
  const mask = new Uint8Array(diff.length);
  for (let p = 0; p < diff.length; p++) mask[p] = diff[p] > cut ? 1 : 0;
  return mask;
}

/** Lighter or darker than the floor: whichever has more clearly different pixels */
function guessPolarity({ data, width, height }: Photo, floor: Float32Array): "light" | "dark" {
  let light = 0;
  let dark = 0;
  for (let p = 0; p < width * height; p += 2) {
    const dl = 0.299 * (data[p * 4] - floor[p * 3]) + 0.587 * (data[p * 4 + 1] - floor[p * 3 + 1]) + 0.114 * (data[p * 4 + 2] - floor[p * 3 + 2]);
    if (dl > MIN_CONTRAST * 1.5) light += dl;
    else if (dl < -MIN_CONTRAST * 1.5) dark -= dl;
  }
  return light >= dark ? "light" : "dark";
}

/**
 * Counts the items in a frame. `sensitivity` −50…50: higher finds fainter items (and more floor marks).
 * `unitArea` overrides one item's size (e.g. from a blob the user tapped).
 */
export function countItems(
  photo: Photo,
  { sensitivity = 0, unitArea, polarity = "auto" }: { sensitivity?: number; unitArea?: number; polarity?: Polarity } = {},
): CountResult {
  const { width, height } = photo;
  const n = width * height;

  // The floor, then again with the items found left out, so big items don't tint it
  let floor = floorEstimate(photo);
  const way = polarity === "auto" ? guessPolarity(photo, floor) : polarity;
  let mask = threshold(difference(photo, floor, way), sensitivity);
  floor = floorEstimate(photo, morph(mask, width, height, 2, true));
  mask = threshold(difference(photo, floor, way), sensitivity);

  // Take out specks, then fill small holes and gaps inside items
  const r = Math.max(1, Math.round(Math.max(width, height) / 300));
  mask = morph(morph(mask, width, height, r, false), width, height, r, true);
  mask = morph(morph(mask, width, height, r, true), width, height, r, false);

  // Blobs of touching item pixels
  const label = new Int32Array(n);
  const found: (Omit<CountBlob, "count"> & { edge: boolean })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start]) continue;
    const id = found.length + 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    let edge = false;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area++;
      sx += x;
      sy += y;
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) edge = true;
      const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of next) {
        if (q >= 0 && mask[q] && !label[q]) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    found.push({ id, area, x: sx / area, y: sy / area, edge });
  }

  // Not items: cut off by the frame's edge, tiny marks, or a patch bigger than a quarter of the frame
  const real = found.filter((b) => !b.edge && b.area >= n * 0.0006 && b.area <= n * 0.25);
  // One item: the typical blob (the middle size), unless given
  const sizes = real.map((b) => b.area).sort((a, b) => a - b);
  const unit = unitArea && unitArea > 0 ? unitArea : (sizes[sizes.length >> 1] ?? 0);
  // Much smaller than one item: a mark on the floor, not an item
  const blobs = real
    .filter((b) => !unit || b.area >= unit * 0.35)
    .map((b) => ({ id: b.id, area: b.area, x: b.x, y: b.y, count: unit ? Math.max(1, Math.round(b.area / unit)) : 1 }));
  // The mask shows only what was counted
  const kept = new Set(blobs.map((b) => b.id));
  for (let p = 0; p < n; p++) if (mask[p] && !kept.has(label[p])) mask[p] = 0;
  return { blobs, unitArea: unit, mask, polarity: way };
}
