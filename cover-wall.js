// Scroll reveal for the cover wall (.cover-wall, styles.css).
//
// Writes the reveal at most once per animation frame, and only when it
// changes. It rises from 0 at the top of the page to 1 once the hero is
// ~60% scrolled away, and falls back to 0 as the contact footer comes up,
// reaching 0 when the footer's top meets the top of the screen. The footer
// paints a near-black ground over the wall anyway (page.css), so keeping it
// animating under there would only cost battery. At 0 the wall also gets
// .is-off, which pauses its CSS rise animation.
//
// The reveal goes straight onto the opacity of .cover-wall-tile (times
// --wall-strength) and .cover-wall-shade. Plain opacity on a composited
// layer is a compositor-only update. The old version wrote a --wall-reveal
// custom property that CSS read through calc(), and every change of it
// repainted the whole wall tile (see the note in styles.css).
//
// The upward drift itself is pure CSS (cover-wall-rise). Nothing here runs
// while the page is still.
(() => {
  const wall = document.querySelector(".cover-wall");
  if (!wall) return;
  const tile = wall.querySelector(".cover-wall-tile");
  const shade = wall.querySelector(".cover-wall-shade");
  const footer = document.querySelector("#contact");

  const REVEAL_BY = 0.6; // fraction of one viewport height of scroll
  const FADE_FROM = 0.6; // footer top, as a fraction of viewport height, where the fade-out starts

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // --wall-strength changes at the phone breakpoint, so re-read on resize.
  let strength = 0;
  const readStrength = () => {
    strength = parseFloat(getComputedStyle(wall).getPropertyValue("--wall-strength")) || 0;
  };

  // The footer's document position, cached. Reading its rect inside the
  // rAF callback ran right after scene.js / carousel.js wrote styles in the
  // same frame and forced a synchronous style + layout pass. A
  // ResizeObserver on <body> refreshes it after any layout change (fonts,
  // images, resize) without forcing one.
  let footerDocTop = Infinity;
  const measureFooter = () => {
    if (footer) footerDocTop = footer.getBoundingClientRect().top + window.scrollY;
  };

  let shown = -1;
  let shownStrength = -1;
  let queued = false;
  const update = () => {
    queued = false;
    const vh = window.innerHeight;
    const fadeIn = clamp01(window.scrollY / (vh * REVEAL_BY));
    const fadeOut = footer ? clamp01((footerDocTop - window.scrollY) / (vh * FADE_FROM)) : 1;
    const reveal = Math.round(Math.min(fadeIn, fadeOut) * 1000) / 1000;
    if (reveal === shown && strength === shownStrength) return;
    shown = reveal;
    shownStrength = strength;
    if (tile) tile.style.opacity = String(reveal * strength);
    if (shade) shade.style.opacity = String(reveal);
    wall.classList.toggle("is-off", reveal === 0);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  // Touch devices and phone widths: paint the tile once into a canvas at 1
  // CSS px per px instead of letting the browser rasterize the repeating
  // background at the screen's 2-3x density. The image is pre-blurred, so
  // the extra density was invisible, but the layer is taller than the
  // screen and drifts: at 3x every step brought new tiles into view to
  // rasterize, and a phone paid ~9x the pixels for each. A canvas is one
  // texture the compositor just moves. Desktop keeps the CSS background,
  // where the tilted plane at 1x density is cheap and a canvas that size
  // would only cost memory.
  const lowRes = window.matchMedia("(max-width: 700px), (pointer: coarse)");
  const img = new Image();
  let canvas = null;
  let drawnW = 0;
  let drawnH = 0;
  let drawnCell = 0;

  const paintCanvas = () => {
    if (!tile || !lowRes.matches || !img.naturalWidth) return;
    const w = Math.round(tile.offsetWidth);
    const h = Math.round(tile.offsetHeight);
    // --wall-cell is a length like 30vw. Custom properties read back
    // unresolved, so measure it through a probe instead.
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;width:var(--wall-cell)";
    wall.appendChild(probe);
    const cell = probe.getBoundingClientRect().width;
    probe.remove();
    if (!w || !h || !cell) return;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "cover-wall-canvas";
      tile.appendChild(canvas);
    }
    if (w === drawnW && h === drawnH && cell === drawnCell) return;
    drawnW = canvas.width = w;
    drawnH = canvas.height = h;
    drawnCell = cell;
    const ctx = canvas.getContext("2d");
    const pattern = ctx.createPattern(img, "repeat");
    // Same sizing as the CSS background: one image per 7 x 6 cells, from 0 0.
    pattern.setTransform(new DOMMatrix().scale((7 * cell) / img.naturalWidth, (6 * cell) / img.naturalHeight));
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, w, h);
    tile.classList.add("is-canvas");
  };

  const syncMode = () => {
    if (lowRes.matches) {
      if (!img.src) {
        img.onload = paintCanvas;
        img.src = "assets/cover-wall.webp";
      } else {
        paintCanvas();
      }
    } else if (canvas) {
      canvas.remove();
      canvas = null;
      drawnW = drawnH = drawnCell = 0;
      tile.classList.remove("is-canvas");
    }
  };
  lowRes.addEventListener("change", syncMode);

  readStrength();
  syncMode();
  measureFooter();
  update();
  if (footer && "ResizeObserver" in window) {
    new ResizeObserver(() => {
      measureFooter();
      queue();
    }).observe(document.body);
  }
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", () => {
    readStrength();
    measureFooter();
    if (canvas) paintCanvas();
    queue();
  });
})();
