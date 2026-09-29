// Scroll reveal for the cover wall (.cover-wall, styles.css).
//
// Writes --wall-reveal on .cover-wall at most once per animation frame: 0 at
// the top of the page, 1 once the hero is ~60% scrolled away. CSS multiplies
// it by --wall-strength, so the wall arrives with the rest of the page
// instead of sitting under the hero from the first frame. At 0 the wall
// also gets .is-off, which hides it and pauses its CSS rise animation.
//
// The upward drift itself is pure CSS (cover-wall-rise). Nothing here runs
// while the page is still.
(() => {
  const wall = document.querySelector(".cover-wall");
  if (!wall) return;

  const REVEAL_BY = 0.6; // fraction of one viewport height of scroll

  let queued = false;
  const update = () => {
    queued = false;
    const reveal = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * REVEAL_BY)));
    wall.style.setProperty("--wall-reveal", reveal.toFixed(3));
    wall.classList.toggle("is-off", reveal === 0);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue);
})();
