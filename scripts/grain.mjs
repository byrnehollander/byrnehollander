// Generates the paper-grain tile used as the page background (--grain in
// index.html) and prints it as a CSS url("data:...") value.
//
// Usage: node scripts/grain.mjs [--freq 0.5] [--oct 2] [--curve 2] [--amp 2] [--floor 0.15] [--size 240] [--svg]
//
// The tile is fractal noise, reduced to one channel and split at the
// median into black and white specks whose opacity grows with distance
// from the median: alpha = min(1, floor + amp * |2n - 1| ^ curve). With
// curve > 1 only the noise tails reach full opacity, so a sparse minority
// of specks reads as paper tooth; the small floor keeps every pixel a
// level or two off the gradient, which is what dithers away Firefox's
// gradient banding. The page sets how strong the whole tile is with
// --grain-a (see the CSS).
//   --freq   baseFrequency, in CSS px (browsers render the tile at device
//            resolution). 0.5 gives specks of 1-2 device px on a 2x
//            screen, finer than a 1px contour line. At 0.9 and up the
//            noise is below one device px on 2x screens and averages out
//            to nothing visible. Below ~0.4 the specks join into small
//            worms that read as dirt.
//   --oct    numOctaves: more octaves add finer detail on top
//   --curve  sparsity: 1 = dense even noise, 2-3 = sparse specks
//   --amp    gain on the tails before clipping at full opacity
//   --floor  minimum speck opacity (the dither)
//   --size   tile edge in px (stitchTiles rounds freq so it repeats seamlessly)
// No dependencies; deterministic (fixed seed).
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const f = arg('freq', 0.5), oct = arg('oct', 2), curve = arg('curve', 2), amp = arg('amp', 2), floor = arg('floor', 0.15), size = arg('size', 240);
const svg =
  `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
  `<filter id='g' x='0' y='0' width='1' height='1' color-interpolation-filters='sRGB'>` +
  `<feTurbulence type='fractalNoise' baseFrequency='${f}' numOctaves='${oct}' stitchTiles='stitch'/>` +
  // one channel into all four: grey noise n, alpha n
  `<feColorMatrix values='1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0'/>` +
  // colour: black below the median, white above; alpha: |2n - 1|
  `<feComponentTransfer><feFuncR type='discrete' tableValues='0 1'/><feFuncG type='discrete' tableValues='0 1'/>` +
  `<feFuncB type='discrete' tableValues='0 1'/><feFuncA type='table' tableValues='1 0 1'/></feComponentTransfer>` +
  // sparsity curve
  `<feComponentTransfer><feFuncA type='gamma' amplitude='${amp}' exponent='${curve}' offset='${floor}'/></feComponentTransfer>` +
  `</filter><rect width='${size}' height='${size}' filter='url(%23g)'/></svg>`;
if (process.argv.includes('--svg')) console.log(svg.replace('%23', '#'));
else {
  const uri = 'data:image/svg+xml,' + svg.replace(/</g, '%3C').replace(/>/g, '%3E');
  console.log(`url("${uri}")`);
  console.error(`${uri.length} bytes`);
}
