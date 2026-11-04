// Counts items laid out on the floor in a photo, with plain image processing (no AI):
//  1. the floor's colour is read from the photo's edges;
//  2. pixels far enough from that colour are "item" (the cut-off picked by Otsu's method, moved by sensitivity);
//  3. specks are taken out and small holes filled (opening and closing);
//  4. touching item pixels are grouped into blobs;
//  5. one item's size is the typical blob (or one the user taps), and a blob twice that size counts as 2.
// Works best with one layer of items, not stacked, on a plain floor that contrasts with them, from above.

export type Photo = { data: Uint8ClampedArray; width: number; height: number };

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
};

/** Floor colour: the middle value of each channel along the photo's edges */
function floorColour({ data, width, height }: Photo): [number, number, number] {
  const band = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  const channels: number[][] = [[], [], []];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) channels[c].push(data[i + c]);
    }
  }
  return channels.map((v) => v.sort((a, b) => a - b)[v.length >> 1] ?? 0) as [number, number, number];
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

/**
 * Counts the items in a photo. `sensitivity` −50…50: higher finds fainter items (and more floor marks).
 * `unitArea` overrides one item's size (e.g. from a blob the user tapped).
 */
export function countItems(photo: Photo, { sensitivity = 0, unitArea }: { sensitivity?: number; unitArea?: number } = {}): CountResult {
  const { data, width, height } = photo;
  const n = width * height;
  const [fr, fg, fb] = floorColour(photo);

  // How far each pixel's colour is from the floor's (0–255), smoothed over its neighbours
  const raw = new Float32Array(n);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    raw[p] = Math.hypot(data[i] - fr, data[i + 1] - fg, data[i + 2] - fb);
  }
  const dist = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          s += raw[yy * width + xx];
          c++;
        }
      }
      dist[y * width + x] = Math.min(255, Math.round((s / c) * (255 / 441)));
    }
  }

  const cut = Math.max(4, otsu(dist) * (1 - sensitivity / 100));
  let mask = new Uint8Array(n);
  for (let p = 0; p < n; p++) mask[p] = dist[p] > cut ? 1 : 0;

  // Take out specks, then fill small holes and gaps inside items
  const r = Math.max(1, Math.round(Math.max(width, height) / 400));
  mask = morph(morph(mask, width, height, r, false), width, height, r, true);
  mask = morph(morph(mask, width, height, r, true), width, height, r, false);

  // Blobs of touching item pixels
  const label = new Int32Array(n);
  const found: Omit<CountBlob, "count">[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start]) continue;
    const id = found.length + 1;
    let area = 0;
    let sx = 0;
    let sy = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p - x) / width;
      area++;
      sx += x;
      sy += y;
      const next = [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, y > 0 ? p - width : -1, y < height - 1 ? p + width : -1];
      for (const q of next) {
        if (q >= 0 && mask[q] && !label[q]) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    found.push({ id, area, x: sx / area, y: sy / area });
  }

  // Leftover marks smaller than a tiny part of the photo aren't items
  const minArea = n * 0.0004;
  const real = found.filter((b) => b.area >= minArea);
  // One item: the typical blob (the middle size), unless given
  const sizes = real.map((b) => b.area).sort((a, b) => a - b);
  const unit = unitArea && unitArea > 0 ? unitArea : (sizes[sizes.length >> 1] ?? 0);
  // Much smaller than one item: a mark on the floor, not an item
  const blobs = real
    .filter((b) => !unit || b.area >= unit * 0.35)
    .map((b) => ({ ...b, count: unit ? Math.max(1, Math.round(b.area / unit)) : 1 }));
  return { blobs, unitArea: unit, mask };
}
