// Generates the topographic contour paths used as the page background
// (the three <svg> elements inside <div class="contours"> in index.html)
// from real elevation data: a contour map of an actual place.
//
// Usage: node scripts/topo.mjs [place] [key=value ...] > /tmp/topo.svg
//   place      one of PLACES below (default: franconia)
//   key=value  override a PLACES field for a quick experiment, e.g.
//              interval=20, widthKm=7.5, lat=44.15, lon=-71.67, zoom=13
// Prints exactly what goes between <div class="contours" aria-hidden="true">
// and its </div>; size and path counts go to stderr.
//
// Data: AWS Terrain Tiles (the public Mapzen "terrarium" tile set, no key):
//   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
// 256 px Web Mercator PNG tiles; each pixel encodes elevation in metres as
//   elevation = (R * 256 + G + B / 256) - 32768
// In the US the source is USGS 3DEP (~10 m). Tiles are cached on disk
// (TOPO_CACHE, default <os tmpdir>/topo-tiles) so reruns are offline.
//
// How it works: assemble the tile mosaic around the place, cut a window
// 1.6x as wide as tall (Web Mercator is conformal, so shapes are true; the
// window is centred on lat/lon and widthKm of ground across), lightly
// Gaussian-blur the elevation grid (SIGMA px) to remove the stair-steps of
// the source DEM, trace iso-lines every `interval` metres with marching
// squares (linear interpolation, saddles resolved by the cell mean), chain
// the segments into polylines, Chaikin-smooth them, Douglas-Peucker
// simplify (TOLERANCE viewBox units), drop small closed loops (rocks and
// knobs that read as specks), clip to the viewBox and write each level as
// one path of relative `m` subpaths with integer coordinates. Levels that
// are a multiple of interval * index get class "i" (index contours).
//
// Composition: on wide screens only the outer thirds of the map are seen
// (the middle is masked under the text column), so each place puts its
// best terrain left and right of a valley that runs down the middle. On
// narrow screens two crops of the same map show instead (`top`, above the
// heading, and `foot`, below the last line); each crop is a viewBox
// "x y w h" in map units, picked to frame one strong feature.
//
// No dependencies (PNG decoding uses node:zlib); deterministic given the
// tiles.

import { inflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Per place: what it is; the window (centre lat/lon in degrees, widthKm of
// ground across; the height follows from the 1.6:1 viewBox); tile zoom (14
// is ~6.9 m/px here); contour interval in metres and every how many levels
// an index contour falls; the two narrow-screen crops; and `peaks`, named
// points whose map position is printed to stderr to check the composition.
const PLACES = {
  franconia: {
    note: "Franconia Notch, NH. Cannon Mountain's summit dome west of the notch (left); Franconia Ridge east of it (right): Mt Lafayette, Mt Lincoln and Little Haystack strung along a knife-edge crest. The notch floor (Profile Lake, I-93), the Cannon Cliffs and the ridge's steep west face (Walker Ravine) fall in the hidden middle.",
    lat: 44.152, lon: -71.6735, widthKm: 5.8, zoom: 14,
    peaks: { Cannon: [44.1567, -71.6981], Lafayette: [44.1607, -71.6444], Lincoln: [44.1489, -71.6447], 'Little Haystack': [44.1406, -71.6454], 'Profile Lake': [44.1631, -71.6813], 'Echo Lake': [44.1745, -71.6884] },
    interval: 30, index: 5,
    top: '100 280 450 210', // Cannon's summit dome above the heading, the cliffs behind the photo
    foot: '1040 100 560 240', // Lafayette's summit rings, the ridge crest running south
  },
  washington: {
    note: 'Mt Washington, NH. Mt Monroe and the Lakes of the Clouds on the west side (left); the summit cone in the hidden middle; Tuckerman and Huntington Ravines, the big glacial cirques of the east face, with Boott Spur between them and the Alpine Garden (right).',
    lat: 44.264, lon: -71.305, widthKm: 5, zoom: 14,
    peaks: { Washington: [44.2706, -71.3033], Monroe: [44.2551, -71.3212], 'Lakes of the Clouds': [44.2590, -71.3186], 'Tuckerman floor': [44.2585, -71.2850], 'Huntington floor': [44.2690, -71.2800], 'Boott Spur': [44.2546, -71.2924], 'Great Gulf': [44.2830, -71.2960] },
    interval: 40, index: 5,
    top: '1080 590 450 210', // Tuckerman Ravine's headwall and bowl
    foot: '150 620 560 240', // Mt Monroe and the Lakes of the Clouds col
  },
  mansfield: {
    note: "Mt Mansfield and Smugglers' Notch, VT. Mansfield's summit ridge running south from the Chin (left; the Nose is just off the bottom edge); the steep east face and the notch's valley in the hidden middle; Spruce Peak and its ridges (right).",
    lat: 44.541, lon: -72.7935, widthKm: 5, zoom: 14,
    peaks: { Chin: [44.5438, -72.8142], Nose: [44.5260, -72.8150], 'Smugglers Notch': [44.5585, -72.7935], 'Spruce Peak': [44.5495, -72.7765], 'Madonna Peak': [44.5650, -72.7760] },
    interval: 30, index: 5,
    top: '60 300 450 210', // the Chin, Mansfield's summit
    foot: '1000 80 560 240', // Spruce Peak across the notch
  },
};

const W = 1600, H = 1000; // viewBox
const SIGMA = 1.2; // DEM blur, in source pixels
const CHAIKIN = 2; // smoothing rounds
const TOLERANCE = 1; // Douglas-Peucker tolerance, viewBox units
const MIN_LOOP = 40; // drop closed loops shorter than this (viewBox units)
const MIN_RUN = 16; // drop open fragments shorter than this
const PAD = 8; // extra source pixels traced past each edge, so lines run off-screen

// ---- arguments ----
const args = process.argv.slice(2);
const name = args.find((a) => !a.includes('=')) || 'franconia';
if (!PLACES[name]) throw new Error(`unknown place "${name}" (have: ${Object.keys(PLACES).join(', ')})`);
const P = { ...PLACES[name] };
for (const a of args.filter((a) => a.includes('='))) {
  const [k, v] = a.split('=');
  P[k] = Number.isNaN(Number(v)) ? v : Number(v);
}

// ---- Web Mercator window, in world pixels at zoom z ----
const z = P.zoom, world = 256 * 2 ** z, rad = Math.PI / 180;
const cx = ((P.lon + 180) / 360) * world;
const cy = ((1 - Math.log(Math.tan(P.lat * rad) + 1 / Math.cos(P.lat * rad)) / Math.PI) / 2) * world;
const mpp = (40075016.686 * Math.cos(P.lat * rad)) / world; // ground metres per pixel here
const wPx = (P.widthKm * 1000) / mpp, hPx = (wPx * H) / W;
const x0 = cx - wPx / 2, y0 = cy - hPx / 2;
const k = W / wPx; // viewBox units per source pixel

// source pixel grid to load: the window plus PAD, plus room for the blur
const R = Math.ceil(3 * SIGMA);
const gx0 = Math.floor(x0) - PAD - R, gy0 = Math.floor(y0) - PAD - R;
const gw = Math.ceil(wPx) + 2 * (PAD + R) + 1, gh = Math.ceil(hPx) + 2 * (PAD + R) + 1;

// ---- PNG decoding (8-bit greyscale/RGB/RGBA, non-interlaced) ----
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width, height, depth, type, interlace;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), tag = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (tag === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; type = data[9]; interlace = data[12];
    } else if (tag === 'IDAT') idat.push(data);
    else if (tag === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, type ${type})`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[row + i - bpp] : 0, b = y ? out[up + i] : 0, c = y && i >= bpp ? out[up + i - bpp] : 0;
      let p = raw[src + i];
      if (f === 1) p += a;
      else if (f === 2) p += b;
      else if (f === 3) p += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        p += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row + i] = p & 255;
    }
  }
  return { width, height, channels, data: out };
}

// ---- tiles -> elevation grid (metres) ----
const cache = process.env.TOPO_CACHE || join(tmpdir(), 'topo-tiles');
mkdirSync(cache, { recursive: true });
async function tile(x, y) {
  const file = join(cache, `terrarium-${z}-${x}-${y}.png`);
  if (!existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return decodePNG(readFileSync(file));
}
const E = new Float64Array(gw * gh);
for (let ty = Math.floor(gy0 / 256); ty <= Math.floor((gy0 + gh - 1) / 256); ty++)
  for (let tx = Math.floor(gx0 / 256); tx <= Math.floor((gx0 + gw - 1) / 256); tx++) {
    const t = await tile(tx, ty);
    if (t.channels < 3) throw new Error('terrarium tiles are RGB');
    for (let py = 0; py < 256; py++) {
      const gy = ty * 256 + py - gy0;
      if (gy < 0 || gy >= gh) continue;
      for (let px = 0; px < 256; px++) {
        const gx = tx * 256 + px - gx0;
        if (gx < 0 || gx >= gw) continue;
        const o = (py * 256 + px) * t.channels;
        E[gy * gw + gx] = t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
      }
    }
  }

// ---- separable Gaussian blur ----
function blur(src, w, h, sigma) {
  const r = Math.ceil(3 * sigma), ker = [];
  for (let i = -r; i <= r; i++) ker.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = ker.reduce((a, b) => a + b);
  const tmp = new Float64Array(w * h), out = new Float64Array(w * h);
  const clamp = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += ker[i + r] * src[y * w + clamp(x + i, w)];
      tmp[y * w + x] = v / sum;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let i = -r; i <= r; i++) v += ker[i + r] * tmp[clamp(y + i, h) * w + x];
      out[y * w + x] = v / sum;
    }
  return out;
}
const F = blur(E, gw, gh, SIGMA);

// grid node (i, j) is the centre of source pixel (gx0 + i, gy0 + j)
const VX = (i) => (gx0 + i + 0.5 - x0) * k, VY = (j) => (gy0 + j + 0.5 - y0) * k;

// ---- marching squares -> polylines ----
function trace(level) {
  const pt = new Map(), next = new Map();
  const key = (t, i, j) => (j * gw + i) * 2 + (t === 'h' ? 0 : 1);
  const interp = (t, i, j) => {
    const a = F[j * gw + i], b = t === 'h' ? F[j * gw + i + 1] : F[(j + 1) * gw + i];
    const f = (level - a) / (b - a);
    return t === 'h' ? [VX(i + f), VY(j)] : [VX(i), VY(j + f)];
  };
  for (let j = 0; j < gh - 1; j++)
    for (let i = 0; i < gw - 1; i++) {
      const a = F[j * gw + i], b = F[j * gw + i + 1], c = F[(j + 1) * gw + i + 1], d = F[(j + 1) * gw + i];
      const tl = a > level, tr = b > level, br = c > level, bl = d > level;
      const n = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (n === 0 || n === 15) continue;
      const T = key('h', i, j), B = key('h', i, j + 1), L = key('v', i, j), Rt = key('v', i + 1, j);
      const mid = (a + b + c + d) / 4 > level;
      // oriented so the high ground is on the left, which makes chaining trivial
      const segs = {
        1: [[L, B]], 2: [[B, Rt]], 3: [[L, Rt]], 4: [[Rt, T]],
        5: mid ? [[L, T], [Rt, B]] : [[Rt, T], [L, B]],
        6: [[B, T]], 7: [[L, T]], 8: [[T, L]], 9: [[T, B]],
        10: mid ? [[T, Rt], [B, L]] : [[T, L], [B, Rt]],
        11: [[T, Rt]], 12: [[Rt, L]], 13: [[Rt, B]], 14: [[B, L]],
      }[n];
      for (const [s, e] of segs) next.set(s, e);
      if (tl !== tr && !pt.has(T)) pt.set(T, interp('h', i, j));
      if (bl !== br && !pt.has(B)) pt.set(B, interp('h', i, j + 1));
      if (tl !== bl && !pt.has(L)) pt.set(L, interp('v', i, j));
      if (tr !== br && !pt.has(Rt)) pt.set(Rt, interp('v', i + 1, j));
    }
  const hasPrev = new Set(next.values());
  const lines = [];
  const follow = (start) => {
    const line = [];
    let kk = start;
    while (next.has(kk)) { line.push(pt.get(kk)); const n = next.get(kk); next.delete(kk); kk = n; }
    const closed = kk === start;
    if (!closed) line.push(pt.get(kk));
    lines.push({ pts: line, closed });
  };
  for (const s of [...next.keys()]) if (!hasPrev.has(s) && next.has(s)) follow(s); // open lines (hit the grid edge)
  for (const s of [...next.keys()]) if (next.has(s)) follow(s); // the rest are loops
  return lines;
}

// ---- line clean-up ----
const length = (pts, closed) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed) L += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]);
  return L;
};
function chaikin(pts, closed) {
  const out = closed ? [] : [pts[0]];
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % n];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function dp(pts, tol) { // Douglas-Peucker on an open polyline
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = pts[s], [bx, by] = pts[e], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let best = -1, bi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([s, bi], [bi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function simplify(pts, closed, tol) {
  if (!closed) return dp(pts, tol);
  // split the loop at its two most distant-from-start points, simplify each half
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(pts.slice(0, far + 1), tol), b = dp([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
// Cut a line into the runs that are on-screen, keeping one point of
// overshoot at each end so lines still reach the edge.
const M = 2;
const inside = ([x, y]) => x > -M && x < W + M && y > -M && y < H + M;
function clip({ pts, closed }) {
  const ins = pts.map(inside);
  if (ins.every(Boolean)) return [{ pts, closed }];
  const n = pts.length, runs = [];
  const o = closed ? ins.indexOf(false) : 0; // closed: start scanning off-screen
  const at = (i) => (closed ? pts[(o + i + n) % n] : pts[i]);
  const isIn = (i) => (closed ? ins[(o + i + n) % n] : ins[i]);
  for (let i = 0; i < n; i++) {
    if (!isIn(i)) continue;
    let e = i;
    while (e + 1 < n && isIn(e + 1)) e++;
    const run = [];
    if (closed || i > 0) run.push(at(i - 1));
    for (let q = i; q <= e; q++) run.push(at(q));
    if (closed || e < n - 1) run.push(at(e + 1));
    runs.push({ pts: run, closed: false });
    i = e;
  }
  return runs;
}

// ---- levels ----
let lo = Infinity, hi = -Infinity;
for (let j = PAD + R; j < gh - PAD - R; j++)
  for (let i = PAD + R; i < gw - PAD - R; i++) { const v = F[j * gw + i]; if (v < lo) lo = v; if (v > hi) hi = v; }
const levels = [];
for (let e = Math.ceil(lo / P.interval) * P.interval; e <= hi; e += P.interval) levels.push(e);
const isIndex = (e) => Math.round(e / P.interval) % P.index === 0;

const num = (v) => String(Math.round(v));
let subpaths = 0;
function encode(lines) {
  // one path, all relative: each subpath is an `m` (relative to where the
  // previous one ended; the path's first `m` counts as absolute) followed by
  // bare coordinate pairs, which after an `m` are relative line-tos
  let d = '', px = 0, py = 0;
  for (const { pts, closed } of lines) {
    const r = [];
    for (const [x, y] of pts) {
      const q = [Math.round(x), Math.round(y)];
      if (!r.length || q[0] !== r.at(-1)[0] || q[1] !== r.at(-1)[1]) r.push(q);
    }
    if (closed && r.length > 1 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1]) r.pop();
    if (r.length < 2) continue;
    const nums = [];
    nums.push(r[0][0] - px, r[0][1] - py);
    for (let i = 1; i < r.length; i++) nums.push(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    d += 'm' + nums.map(num).join(' ').replace(/ -/g, '-');
    if (closed) { d += 'z'; [px, py] = r[0]; } else [px, py] = r.at(-1);
    subpaths++;
  }
  return d;
}

const traced = levels.map((e) => {
  const lines = trace(e)
    .map(({ pts, closed }) => {
      let p = pts;
      for (let r = 0; r < CHAIKIN; r++) p = chaikin(p, closed);
      return { pts: simplify(p, closed, TOLERANCE), closed };
    })
    .filter(({ pts, closed }) => (closed ? length(pts, true) >= MIN_LOOP : true))
    .flatMap(clip)
    .filter(({ pts, closed }) => closed || length(pts, false) >= MIN_RUN);
  return { e, d: encode(lines) };
}).filter(({ d }) => d);

// Draw-on reveal (see the .contours CSS): every path gets pathLength="1" so a
// dash of length 1 can be slid along it without measuring, plus a --d delay.
// The index contours (the stronger lines) go down first, INDEX_STEP apart;
// then the rest follow spread evenly from REST_FROM to REST_TO seconds. Both
// run from the lowest level up, so the mountains rise out of the valley.
const INDEX_STEP = 0.12, REST_FROM = 0.35, REST_TO = 1.1;
const idx = traced.filter(({ e }) => isIndex(e)).map(({ e }) => e);
const rest = traced.filter(({ e }) => !isIndex(e)).map(({ e }) => e);
const secs = (n) => String(+n.toFixed(2)).replace(/^0\./, '.');
const delay = (e) => isIndex(e)
  ? secs(INDEX_STEP * idx.indexOf(e))
  : secs(REST_FROM + ((REST_TO - REST_FROM) * rest.indexOf(e)) / Math.max(1, rest.length - 1));
const LAYERS = traced.map(({ e, d }) =>
  `<path${isIndex(e) ? ' class="i"' : ''} pathLength="1" style="--d:${delay(e)}s" d="${d}"/>`);

const map =
  `<svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">\n<g id="topo">\n` +
  LAYERS.join('\n') + '\n</g>\n</svg>\n';
const out = map +
  // narrow screens: two more windows onto the same paths for the top and bottom bands
  `<svg class="top" viewBox="${P.top}" preserveAspectRatio="xMidYMin slice"><use href="#topo"/></svg>\n` +
  `<svg class="foot" viewBox="${P.foot}" preserveAspectRatio="xMidYMax slice"><use href="#topo"/></svg>`;
process.stdout.write(out + '\n');
// where the named features land, to check the composition (viewBox units)
const toView = ([la, lo]) => [
  (((lo + 180) / 360) * world - x0) * k,
  (((1 - Math.log(Math.tan(la * rad) + 1 / Math.cos(la * rad)) / Math.PI) / 2) * world - y0) * k,
];
for (const [n, ll] of Object.entries(P.peaks || {})) process.stderr.write(`  ${n}: ${toView(ll).map(Math.round).join(', ')}\n`);
process.stderr.write(
  `${name}: ${Math.round(lo)}-${Math.round(hi)} m, every ${P.interval} m (index ${P.interval * P.index} m); ` +
  `${LAYERS.length} paths, ${subpaths} subpaths; map ${Buffer.byteLength(map)} bytes, all ${Buffer.byteLength(out)} bytes; ` +
  `${(wPx * mpp / 1000).toFixed(2)} x ${(hPx * mpp / 1000).toFixed(2)} km at z${z} (${mpp.toFixed(2)} m/px, ${k.toFixed(2)} units/px)\n`,
);
