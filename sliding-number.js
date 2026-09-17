// Sliding-number counter for the "Catalog impact" total (#impactTotalNumber).
//
// Ported from a React/motion component (motion/react's useSpring +
// react-use-measure) into vanilla JS/CSS, since this site has no build step
// or component framework to host that component as-is (see plan notes).
// The digit-roll technique is kept faithfully:
//   - one fixed-width column per digit place (.sliding-digit, 1ch wide,
//     clipped vertically)
//   - all ten numerals 0-9 stacked absolutely inside each column
//   - a spring per column translates the right numeral into view, wrapping
//     9->0 the short way instead of scrolling back through 8,7,6...
//
// Behaviour (agreed with Calen): count up to 634 when the impact panel
// scrolls into view, count back down toward 0 (slower, 3.4s) when it
// scrolls out — and reverse cleanly from wherever it is if the user
// scrolls back before it finishes.
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mount = document.querySelector("#impactTotalNumber");
  const panel = document.querySelector(".impact-panel");
  if (!mount || reduceMotion) return; // static "634" from index.html stands as-is

  const TARGET = Number(mount.dataset.value) || 634;
  const UP_MS = 1200;
  const DOWN_MS = 3400;

  // Spring constants ported from the component's TRANSITION (stiffness 280,
  // damping 18, mass 0.3) — used per digit column so each numeral settles
  // into place with a little give rather than snapping.
  const SPRING = { stiffness: 280, damping: 18, mass: 0.3 };

  // ---------- master value tween (0 <-> TARGET) ----------
  // Not a spring — a plain eased tween, because the up/down legs need
  // deliberately different durations (1.2s vs 3.4s) and springs don't have
  // a fixed duration to hand.
  let value = 0;
  let tweenFrom = 0;
  let tweenTo = 0;
  let tweenStart = 0;
  let tweenDuration = UP_MS;
  let tweenActive = false;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function setTarget(target) {
    if (target === tweenTo && tweenActive) return;
    tweenFrom = value;
    tweenTo = target;
    tweenDuration = target > value ? UP_MS : DOWN_MS;
    tweenStart = performance.now();
    tweenActive = true;
    ensureLoop();
  }

  // ---------- digit columns ----------
  // One entry per currently-rendered place value, ordered most-significant
  // first. Each holds the spring state driving that column's numerals.
  let columns = [];

  function makeColumn() {
    const el = document.createElement("span");
    el.className = "sliding-digit";

    const spacer = document.createElement("span");
    spacer.className = "sliding-digit-spacer";
    spacer.textContent = "0";
    spacer.setAttribute("aria-hidden", "true");
    el.appendChild(spacer);

    const numerals = [];
    for (let n = 0; n < 10; n++) {
      const s = document.createElement("span");
      s.className = "sliding-digit-numeral";
      s.textContent = String(n);
      s.setAttribute("aria-hidden", "true");
      el.appendChild(s);
      numerals.push(s);
    }

    return {
      el,
      spacer,
      numerals,
      height: 0,
      // spring state: current digit position (0-9, fractional while moving)
      pos: 0,
      vel: 0,
      target: 0,
    };
  }

  function measure(col) {
    col.height = col.spacer.offsetHeight || col.el.offsetHeight;
  }

  function layoutColumn(col) {
    const h = col.height;
    if (!h) return;
    for (let n = 0; n < 10; n++) {
      const offset = (10 + n - col.pos) % 10;
      let y = offset * h;
      if (offset > 5) y -= 10 * h;
      col.numerals[n].style.transform = `translateY(${y}px)`;
    }
  }

  // Rebuild the visible column count to match the number of digits in
  // Math.round(value) — reusing existing column objects (and their spring
  // state) for places that survive, so a surviving column doesn't snap when
  // a new leading digit appears (0 -> 6 -> 63 -> 634).
  function syncColumnCount(digitCount) {
    while (columns.length < digitCount) {
      const col = makeColumn();
      columns.unshift(col); // new columns are always more-significant (prepended)
      mount.insertBefore(col.el, mount.firstChild);
      measure(col);
      layoutColumn(col);
    }
    while (columns.length > digitCount) {
      const col = columns.shift(); // drop the most-significant (leftmost)
      col.el.remove();
    }
  }

  function applyValue(v) {
    const rounded = Math.max(0, Math.round(v));
    const digits = String(rounded).split("").map(Number);
    syncColumnCount(digits.length);
    digits.forEach((d, i) => {
      columns[i].target = d;
    });
    mount.dataset.current = String(rounded); // debug/inspection hook only, not read by CSS/JS elsewhere
  }

  // ---------- animation loop ----------
  let rafId = null;

  function ensureLoop() {
    if (rafId != null) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      let stillMoving = false;

      if (tweenActive) {
        const t = Math.min((now - tweenStart) / tweenDuration, 1);
        value = tweenFrom + (tweenTo - tweenFrom) * easeOutCubic(t);
        applyValue(value);
        if (t >= 1) {
          value = tweenTo;
          applyValue(value);
          tweenActive = false;
        } else {
          stillMoving = true;
        }
      }

      // Integrate each column's spring toward its target digit, taking the
      // short way around the 0-9 wheel (matches the component's offset math
      // in layoutColumn, just applied to the driving position itself).
      for (const col of columns) {
        let delta = col.target - col.pos;
        delta = ((delta + 5) % 10 + 10) % 10 - 5; // shortest signed distance on a 10-wheel
        const accel = (SPRING.stiffness * delta - SPRING.damping * col.vel) / SPRING.mass;
        col.vel += accel * dt;
        col.pos += col.vel * dt;

        if (Math.abs(delta) > 0.01 || Math.abs(col.vel) > 0.01) {
          stillMoving = true;
        } else {
          col.pos = col.target;
          col.vel = 0;
        }

        // keep pos in [0, 10)
        col.pos = ((col.pos % 10) + 10) % 10;
        layoutColumn(col);
      }

      if (stillMoving) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null; // idle — restarted by ensureLoop() on the next trigger
      }
    };
    rafId = requestAnimationFrame(step);
  }

  // ---------- resize: re-measure column height (font-size is a clamp()) ----------
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      columns.forEach((col) => {
        measure(col);
        layoutColumn(col);
      });
    }, 150);
  });

  // ---------- init ----------
  mount.textContent = ""; // clear the static "634" fallback text
  applyValue(0);

  // ---------- scroll trigger ----------
  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      setTarget(entry.isIntersecting ? TARGET : 0);
    },
    { threshold: 0.25 }
  );
  observer.observe(panel || mount);
})();
