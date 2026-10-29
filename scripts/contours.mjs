// Generates the topographic contour paths used as the page background
// (the two <svg> elements inside <div class="contours"> in index.html).
//
// Usage: node scripts/contours.mjs > /tmp/contours.svg
//
// How it works: build a small elevation field (a few skewed Gaussian
// "peaks", domain-warped by smooth value noise so the rings wobble
// together), trace iso-lines with marching squares, resample each loop
// to a handful of points and emit it as a closed Catmull-Rom spline
// (one `C`, then `s` segments). Every 5th level gets class "i" (index
// contour). Tweak PEAKS / LEVELS / SEED and paste the output back in.
// No dependencies; deterministic for a given SEED.

const W = 1600, H = 1000; // viewBox
const PAD = 560; // field extends past the viewBox so loops close off-screen
const STEP = 8; // grid resolution in viewBox units
const SPACING = 84; // target distance between spline points
const SEED = 7;

// x, y, height, radius x, radius y, rotation (rad), skew (0 = symmetric)
const PEAKS = [
  [250, 650, 1.0, 330, 250, -0.5, 0.35], // west summit
  [1390, 280, 0.82, 280, 220, 0.4, 0.3], // east summit
  [1520, 980, 0.55, 220, 170, -0.2, 0.25], // south-east knoll
  [800, 1240, 0.62, 520, 230, 0.05, 0.1], // shoulder off the bottom edge
  [780, -230, 0.55, 520, 220, -0.08, 0.1], // shoulder off the top edge
];
const LEVELS = Array.from({ length: 16 }, (_, k) => 0.07 + k * 0.058);
const INDEX_EVERY = 5;
const FOOT = '1150 820 450 180'; // viewBox of the mobile footer strip

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

function field(x, y) {
  // domain warp: neighbouring rings bend the same way
  const wx = x + 70 * noise(x / 380, y / 380) + 25 * noise(x / 150 + 9, y / 150);
  const wy = y + 70 * noise(x / 380 + 31, y / 380 + 17) + 25 * noise(x / 150, y / 150 + 5);
  let v = 0;
  for (const [px, py, h, rx, ry, rot, skew] of PEAKS) {
    const dx = wx - px, dy = wy - py;
    const u = (dx * Math.cos(rot) + dy * Math.sin(rot)) / rx;
    const w = (-dx * Math.sin(rot) + dy * Math.cos(rot)) / ry;
    const ang = Math.atan2(w, u);
    const r2 = (u * u + w * w) * (1 + skew * Math.cos(ang - 0.8)) ** 2;
    v = Math.max(v, h * Math.exp(-r2)); // max(): peaks stay distinct
  }
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
  return { pts: out, total };
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

const LAYERS = LEVELS.map((level, k) => {
  const d = trace(level)
    .map(resample)
    .filter(({ total }) => total >= 90)
    .map(({ pts }) => toPath(pts))
    .join('');
  return d && `<path${(k + 1) % INDEX_EVERY === 0 ? ' class="i"' : ''} d="${d}"/>`;
}).filter(Boolean);

const out =
  `<svg class="map" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">\n<g id="topo">\n` +
  LAYERS.join('\n') + '\n</g>\n</svg>\n' +
  // narrow screens: a second window onto the same map for the footer band
  `<svg class="foot" viewBox="${FOOT}" preserveAspectRatio="xMidYMax slice"><use href="#topo"/></svg>`;
process.stdout.write(out + '\n');
process.stderr.write(`${LAYERS.length} levels, ${out.length} bytes\n`);
