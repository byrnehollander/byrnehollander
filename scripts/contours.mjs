// Generates the topographic contour paths used as the page background
// (the three <svg> elements inside <div class="contours"> in index.html).
//
// Usage: node scripts/contours.mjs > /tmp/contours.svg
//
// How it works: build an elevation field from a few curving ridges (each
// a spine polyline with a height and half-width that vary along it, so
// crests rise and dip and two ridges that meet leave a saddle), plus a
// gentle regional slope, all domain-warped by smooth value noise so
// neighbouring lines wobble together. Trace iso-lines with marching
// squares, resample each line to a handful of points and emit it as a
// Catmull-Rom spline (one `C`, then `s` segments). Every 5th level gets
// class "i" (index contour). Short closed loops are dropped so the map
// reads as long ridges, not a field of bullseyes. Tweak RIDGES / LEVELS /
// SEED and paste the output back in. No dependencies; deterministic.

const W = 1600, H = 1000; // viewBox
const PAD = 560; // field extends past the viewBox so loops close off-screen
const STEP = 8; // grid resolution in viewBox units
const SPACING = 108; // target distance between spline points
const MIN_LOOP = 260; // drop closed loops shorter than this (viewBox units)
const SEED = 11;

// Each ridge: spine points [x, y, crest height, half-width]. Height and
// width are interpolated along the spine; ends are rounded.
const RIDGES = [
  // west: a long main ridge curving down the left margin with a long, level crest
  [[-260, 20, 0.42, 200], [30, 220, 0.8, 165], [210, 470, 0.97, 150], [250, 700, 0.93, 155], [120, 1000, 0.6, 190], [0, 1250, 0.4, 220]],
  // west spur dropping south-east off the main crest
  [[230, 560, 0.45, 110], [450, 720, 0.4, 130], [620, 980, 0.3, 160]],
  // east: a long crest rising from the south, dipping to a saddle, rising again toward the top-right corner
  [[1150, 1220, 0.4, 200], [1280, 970, 0.84, 140], [1370, 790, 0.82, 130], [1460, 640, 0.5, 115], [1640, 380, 0.82, 160], [1900, 250, 0.6, 220]],
  // north-east: a low broad shoulder sweeping along the top edge, well clear of the photo
  [[1050, -280, 0.28, 300], [1450, -80, 0.42, 250], [1900, 0, 0.45, 250]],
];
const LEVELS = Array.from({ length: 16 }, (_, k) => 0.07 + k * 0.058);
const INDEX_EVERY = 5;
// narrow screens show two windows onto the same map (viewBox x y w h)
const TOP = '1150 700 450 210'; // above the heading: the east crest's long summit loops
const FOOT = '200 760 560 240'; // below the footnote: the nose of the west spur

// ---- seeded value noise ----
let s = SEED;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const G = 64, grid = Array.from({ length: G * G }, rand);
const smooth = (t) => t * t * (3 - 2 * t);
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = smooth(x - xi), fy = smooth(y - yi);
  const g = (a, b) => grid[(((a % G) + G) % G) * G + (((b % G) + G) % G)];
  const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
  return (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy) * 2 - 1;
}

// nearest point on a ridge spine: distance and interpolated height / width
function ridge(spine, x, y) {
  let best = { d2: Infinity, h: 0, w: 1 };
  for (let k = 0; k < spine.length - 1; k++) {
    const [ax, ay, ah, aw] = spine[k], [bx, by, bh, bw] = spine[k + 1];
    const vx = bx - ax, vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
    const dx = x - (ax + t * vx), dy = y - (ay + t * vy), d2 = dx * dx + dy * dy;
    if (d2 < best.d2) best = { d2, h: ah + t * (bh - ah), w: aw + t * (bw - aw) };
  }
  return best.h * Math.exp(-best.d2 / (best.w * best.w));
}

function field(x, y) {
  // domain warp: neighbouring lines bend the same way
  const wx = x + 80 * noise(x / 420, y / 420) + 22 * noise(x / 140 + 9, y / 140);
  const wy = y + 80 * noise(x / 420 + 31, y / 420 + 17) + 22 * noise(x / 140, y / 140 + 5);
  let v = 0.03 * noise(wx / 600 + 3, wy / 600 + 7); // broad, low undulation (stays under the lowest level)
  for (const spine of RIDGES) v += ridge(spine, wx, wy);
  return v;
}

// ---- marching squares ----
const nx = Math.ceil((W + 2 * PAD) / STEP) + 1, ny = Math.ceil((H + 2 * PAD) / STEP) + 1;
const X = (i) => -PAD + i * STEP, Y = (j) => -PAD + j * STEP;
const F = new Float64Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[j * nx + i] = field(X(i), Y(j));

function trace(level) {
  const pt = new Map(), next = new Map();
  // edge ids: horizontal edge (i,j)-(i+1,j) = h, vertical (i,j)-(i,j+1) = v
  const key = (t, i, j) => `${t}${i},${j}`;
  const interp = (t, i, j) => {
    const a = F[j * nx + i], b = t === 'h' ? F[j * nx + i + 1] : F[(j + 1) * nx + i];
    const f = (level - a) / (b - a);
    return t === 'h' ? [X(i) + f * STEP, Y(j)] : [X(i), Y(j) + f * STEP];
  };
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const tl = F[j * nx + i] > level, tr = F[j * nx + i + 1] > level;
      const br = F[(j + 1) * nx + i + 1] > level, bl = F[(j + 1) * nx + i] > level;
      const c = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (c === 0 || c === 15) continue;
      const T = key('h', i, j), B = key('h', i, j + 1), L = key('v', i, j), R = key('v', i + 1, j);
      for (const [k, t, a, b] of [[T, 'h', i, j], [B, 'h', i, j + 1], [L, 'v', i, j], [R, 'v', i + 1, j]])
        if (!pt.has(k)) pt.set(k, interp(t, a, b));
      // orient segments so "high" ground is on the left (consistent chaining)
      const segs = {
        1: [[L, B]], 2: [[B, R]], 3: [[L, R]], 4: [[R, T]], 5: [[L, T], [R, B]],
        6: [[B, T]], 7: [[L, T]], 8: [[T, L]], 9: [[T, B]], 10: [[T, R], [B, L]],
        11: [[T, R]], 12: [[R, L]], 13: [[R, B]], 14: [[B, L]],
      }[c];
      for (const [a, b] of segs) next.set(a, b);
    }
  const loops = [];
  for (const start of next.keys()) {
    if (!next.has(start)) continue;
    const loop = [];
    let k = start;
    while (next.has(k)) { loop.push(pt.get(k)); const n = next.get(k); next.delete(k); k = n; }
    if (k === start && loop.length > 3) loops.push(loop);
  }
  return loops;
}

function resample(loop) {
  const len = [0];
  for (let i = 1; i <= loop.length; i++) {
    const [ax, ay] = loop[i - 1], [bx, by] = loop[i % loop.length];
    len.push(len[i - 1] + Math.hypot(bx - ax, by - ay));
  }
  const total = len[len.length - 1];
  const n = Math.max(6, Math.round(total / SPACING));
  const out = [];
  for (let k = 0, i = 0; k < n; k++) {
    const d = (k / n) * total;
    while (len[i + 1] < d) i++;
    const f = (d - len[i]) / (len[i + 1] - len[i] || 1);
    const [ax, ay] = loop[i], [bx, by] = loop[(i + 1) % loop.length];
    out.push([ax + f * (bx - ax), ay + f * (by - ay)]);
  }
  // fully on-screen loops are the ones that read as bullseyes
  const closed = loop.every(([x, y]) => x > 0 && x < W && y > 0 && y < H);
  return { pts: out, total, closed };
}

const num = (n) => String(Math.round(n));
const fmt = (arr) => arr.map(num).join(' ').replace(/ -/g, '-');

// Closed Catmull-Rom spline through pts, drawn only where it is on-screen:
// loops that leave the viewBox are cut into open runs (one point of
// overshoot each side) so off-screen geometry costs no bytes.
function toPath(pts) {
  const n = pts.length, P = (i) => pts[((i % n) + n) % n];
  const r = Math.round;
  const ctrl = (i) => {
    const [ax, ay] = P(i - 1), [bx, by] = P(i), [cx, cy] = P(i + 1), [dx, dy] = P(i + 2);
    return [bx + (cx - ax) / 6, by + (cy - ay) / 6, cx - (dx - bx) / 6, cy - (dy - by) / 6].map(r);
  };
  const seg = (from, to) => { // segments from..to-1, i.e. points from..to
    let [cx, cy] = P(from).map(r);
    let d = `M${fmt([cx, cy])}`;
    for (let i = from; i < to; i++) {
      const [c1x, c1y, c2x, c2y] = ctrl(i);
      const [ex, ey] = P(i + 1).map(r);
      d += i === from
        ? `C${fmt([c1x, c1y, c2x, c2y, ex, ey])}`
        : `s${fmt([c2x - cx, c2y - cy, ex - cx, ey - cy])}`;
      cx = ex; cy = ey;
    }
    return d;
  };
  const inside = pts.map(([x, y]) => x > -8 && x < W + 8 && y > -8 && y < H + 8);
  if (inside.every(Boolean)) return seg(0, n) + 'z';
  const o = inside.indexOf(false); // start scanning at an off-screen point
  let d = '';
  for (let k = 0; k < n; k++) {
    if (!inside[(o + k) % n]) continue;
    let e = k;
    while (e + 1 < n && inside[(o + e + 1) % n]) e++;
    d += seg(o + k - 1, o + e + 1);
    k = e;
  }
  return d;
}

// Draw-on reveal (see the .contours CSS): every path gets pathLength="1" so a
// dash of length 1 can be slid along it without measuring, plus a --d delay.
// Order, like a plotter sketching the terrain: the index contours (the
// stronger lines) go down first, highest first, INDEX_STEP apart; then the
// rest follow from the crests outward (highest level first), spread evenly
// from REST_FROM to REST_TO seconds.
const INDEX_STEP = 0.12, REST_FROM = 0.35, REST_TO = 1.1;
const isIndex = (k) => (k + 1) % INDEX_EVERY === 0;
const traced = LEVELS.map((level, k) => ({
  k,
  d: trace(level)
    .map(resample)
    .filter(({ total, closed }) => total >= (closed ? MIN_LOOP : 90))
    .map(({ pts }) => toPath(pts))
    .join(''),
})).filter(({ d }) => d);
const idx = traced.map(({ k }) => k).filter(isIndex).reverse();
const rest = traced.map(({ k }) => k).filter((k) => !isIndex(k)).reverse();
const secs = (n) => String(+n.toFixed(2)).replace(/^0\./, '.');
const delay = (k) => isIndex(k)
  ? secs(INDEX_STEP * idx.indexOf(k))
  : secs(REST_FROM + ((REST_TO - REST_FROM) * rest.indexOf(k)) / (rest.length - 1));
const LAYERS = traced.map(({ k, d }) =>
  `<path${isIndex(k) ? ' class="i"' : ''} pathLength="1" style="--d:${delay(k)}s" d="${d}"/>`);

const out =
  `<svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">\n<g id="topo">\n` +
  LAYERS.join('\n') + '\n</g>\n</svg>\n' +
  // narrow screens: two more windows onto the same paths for the top and bottom bands
  `<svg class="top" viewBox="${TOP}" preserveAspectRatio="xMidYMin slice"><use href="#topo"/></svg>\n` +
  `<svg class="foot" viewBox="${FOOT}" preserveAspectRatio="xMidYMax slice"><use href="#topo"/></svg>`;
process.stdout.write(out + '\n');
process.stderr.write(`${LAYERS.length} levels, ${out.length} bytes\n`);
