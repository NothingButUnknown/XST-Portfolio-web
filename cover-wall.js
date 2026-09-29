// Scroll reveal for the cover wall (.cover-wall, styles.css).
//
// Writes --wall-reveal on .cover-wall at most once per animation frame. It
// rises from 0 at the top of the page to 1 once the hero is ~60% scrolled
// away, and falls back to 0 as the contact footer comes up, reaching 0 when
// the footer's top meets the top of the screen. The footer paints a
// near-black ground over the wall anyway (page.css), so keeping it animating
// under there would only cost battery. CSS multiplies the value by
// --wall-strength. At 0 the wall also gets .is-off, which hides it and
// pauses its CSS rise animations.
//
// The upward drift itself is pure CSS (cover-wall-rise). Nothing here runs
// while the page is still.
(() => {
  const wall = document.querySelector(".cover-wall");
  if (!wall) return;
  const footer = document.querySelector("#contact");

  const REVEAL_BY = 0.6; // fraction of one viewport height of scroll
  const FADE_FROM = 0.6; // footer top, as a fraction of viewport height, where the fade-out starts

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  let queued = false;
  const update = () => {
    queued = false;
    const vh = window.innerHeight;
    const fadeIn = clamp01(window.scrollY / (vh * REVEAL_BY));
    const fadeOut = footer ? clamp01(footer.getBoundingClientRect().top / (vh * FADE_FROM)) : 1;
    const reveal = Math.min(fadeIn, fadeOut);
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
