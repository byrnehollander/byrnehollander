const canvas = document.getElementById("noiseCanvas"),
const userAgent = navigator.userAgent;
  const isChrome = /Chrome/.test(userAgent) && /Safari/.test(userAgent) && !/Edg/.test(userAgent) && !/OPR/.test(userAgent);
  prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
if (prefersReducedMotion || !isChrome) canvas.style.display = "none";
else {
  let e = canvas.getContext("2d"),
    n = [],
    a,
    i,
    t;
  function c() {
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? ((a = "#121212"), (i = "255, 255, 255"), (t = { min: 0.02, max: 0.2 }))
      : ((a = "#f7fafc"), (i = "0, 0, 0"), (t = { min: 0.03, max: 0.3 })),
      (canvas.style.backgroundColor = a);
  }
  function d() {
    let n = window.devicePixelRatio || 1;
    (canvas.width = window.innerWidth * n),
      (canvas.height = window.innerHeight * n),
      (canvas.style.width = window.innerWidth + "px"),
      (canvas.style.height = window.innerHeight + "px"),
      e.scale(n, n);
  }
  function r() {
    let e = Math.floor((window.innerWidth * window.innerHeight) / 300);
    n = [];
    for (let a = 0; a < e; a++)
      n.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        opacity: Math.random() * (t.max - t.min) + t.min,
        dx: 0.1 * Math.random() - 0.05,
        dy: 0.1 * Math.random() - 0.05,
        dOpacity: 0.005 * Math.random() - 0.0025,
      });
  }
  function o(e) {
    (e.x += e.dx),
      (e.y += e.dy),
      (e.opacity += e.dOpacity),
      (e.opacity = Math.max(t.min, Math.min(e.opacity, t.max)));
  }
  function s() {
    e.clearRect(0, 0, canvas.width, canvas.height),
      n.forEach((n) => {
        o(n),
          (e.fillStyle = `rgba(${i}, ${n.opacity})`),
          e.fillRect(n.x, n.y, 1, 1);
      }),
      requestAnimationFrame(s);
  }
  d(),
    c(),
    r(),
    s(),
    window.addEventListener("resize", function () {
      d();
    }),
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        c();
      });
}
