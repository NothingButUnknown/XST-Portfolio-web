// Scroll-linked motion for the cover wall (.cover-wall, styles.css).
//
// Two CSS variables, both written once per animation frame at most:
//   --wall-reveal on .cover-wall: 0 at the top of the page, 1 once the hero
//     is ~60% scrolled away. CSS multiplies it by --wall-strength, so the
//     wall arrives with the rest of the page instead of sitting under the
//     hero from the first frame.
//   --wall-y on .cover-wall-plane: the wall slides up at DRIFT times scroll
//     speed, so it reads as a slower plane behind the content (the promo's
//     upward drift, tied to scroll instead of time). The value wraps at one
//     tile height, and the tile repeats, so the jump back is invisible and
//     the plane never runs out.
//
// No loop runs while the page is still. Reduced motion keeps the reveal
// (a fade, not motion) and drops the drift.
(() => {
  const wall = document.querySelector(".cover-wall");
  const plane = wall && wall.querySelector(".cover-wall-plane");
  if (!plane) return;

  const DRIFT = 0.22;
  const REVEAL_BY = 0.6; // fraction of one viewport height of scroll
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // One tile height in px, read back from the resolved background-size
  // ("1715px 1470px") so the clamp() in CSS stays the only source of truth.
  let period = 0;
  const measure = () => {
    const size = getComputedStyle(plane).backgroundSize.split(" ");
    period = parseFloat(size[1]) || parseFloat(size[0]) || 0;
  };

  let queued = false;
  const update = () => {
    queued = false;
    const y = window.scrollY;
    const reveal = Math.min(1, Math.max(0, y / (window.innerHeight * REVEAL_BY)));
    wall.style.setProperty("--wall-reveal", reveal.toFixed(3));
    if (!reduceMotion.matches && period > 0) {
      const travelled = (y * DRIFT) % period;
      plane.style.setProperty("--wall-y", (period / 2 - travelled).toFixed(1) + "px");
    } else {
      plane.style.removeProperty("--wall-y");
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  measure();
  update();
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", () => {
    measure();
    queue();
  });
  reduceMotion.addEventListener("change", queue);
})();
