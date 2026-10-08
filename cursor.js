// ---------- site-wide cursor (mouse-with-hover, 768px+ only) ----------
//
// An inverting dot that follows the pointer site-wide, grows over links, and
// morphs into the red "Drag" / "View" bubble over the sphere / a cover. Only
// the outer element's transform is written per frame; every size or state
// change is a class toggle that CSS animates with transform + opacity.

(() => {
  "use strict";

  const cursor = document.getElementById("xstCursor");
  if (!cursor) return;

  const label = cursor.querySelector(".xst-cursor__label");
  const root = document.documentElement;
  const gate = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const LINK = 'a, button, [role="button"], [data-cursor="pointer"], label, summary';
  const LERP = 0.16; // per 60fps frame
  const FRAME = 1000 / 60;

  let on = false; // gate passed + listeners attached
  let shown = false; // a real mouse move has happened since the last hide
  let mode = ""; // "" | link | drag | view | field
  let down = false;
  let dragLock = false; // pointerdown on the sphere keeps "drag" until release
  let lastTarget = null;
  let reduce = motion.matches;

  let raf = 0;
  let last = 0;
  let tx = 0;
  let ty = 0;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let angle = 0;
  let p = 1;

  let curClass = "";
  let curTransform = "";

  const r2 = (n) => Math.round(n * 100) / 100;

  // Hover state is classified on pointerover (once per element change), not
  // on every pointermove.
  function classify(t) {
    if (!t || !t.closest) return "";
    if (t.closest(FIELD)) return "field";
    if (t.closest(".cover-node")) return "view";
    if (t.closest("#scene")) return "drag";
    if (t.closest(LINK)) return "link";
    return "";
  }

  // Touches the DOM only when the class string or label actually changes.
  function render() {
    const m = dragLock ? "drag" : mode;
    const live = on && shown && m !== "field";
    const cls =
      "xst-cursor" +
      (live ? " is-visible" : "") +
      (m && m !== "field" ? " is-" + m : "") +
      (down ? " is-down" : "");
    if (cls === curClass) return;
    if ((m === "drag" || m === "view") && label) {
      const text = m === "view" ? "View" : "Drag";
      if (label.textContent !== text) label.textContent = text;
    }
    cursor.className = curClass = cls;
  }

  function paint() {
    const t =
      "translate3d(" + r2(x) + "px," + r2(y) + "px,0) rotate(" + r2(angle) +
      "deg) scale(" + r2(p) + "," + r2(1 / Math.sqrt(p)) + ")";
    if (t === curTransform) return;
    cursor.style.transform = curTransform = t;
  }

  function frame(now) {
    // Clamp so a background-tab stall or a late rAF timestamp can't jump.
    const dt = Math.max(1, Math.min(now - last, 50));
    last = now;

    // Frame-rate-independent lerp: same feel at 60 / 120 / 144 Hz.
    const k = reduce ? 1 : 1 - Math.pow(1 - LERP, dt / FRAME);
    const px = x;
    const py = y;
    x += (tx - x) * k;
    y += (ty - y) * k;

    // No stretch over link/drag/view or under reduced motion.
    if (reduce || dragLock || mode === "link" || mode === "drag" || mode === "view") {
      vx = vy = 0;
      p = 1;
      angle = 0;
    } else {
      // Smoothed velocity in px per 60fps frame.
      const f = FRAME / dt;
      const s = 1 - Math.pow(0.75, dt / FRAME);
      vx += ((x - px) * f - vx) * s;
      vy += ((y - py) * f - vy) * s;
      const speed = Math.hypot(vx, vy);
      p = Math.min(1 + speed * 0.04, 1.8);
      if (speed > 0.3) angle = (Math.atan2(vy, vx) * 180) / Math.PI;
    }

    // Idle: settled on the target and unstretched, so stop the loop.
    if (Math.hypot(tx - x, ty - y) < 0.1 && p - 1 < 0.005) {
      x = tx;
      y = ty;
      vx = vy = 0;
      p = 1;
      paint();
      raf = 0;
      return;
    }

    paint();
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (raf || !on) return;
    last = performance.now(); // fresh clock so the first frame after idle doesn't jump
    raf = requestAnimationFrame(frame);
  }

  function hide() {
    shown = false;
    render();
  }

  function onMove(e) {
    if (e.pointerType !== "mouse") {
      hide(); // touch / pen: never drives the dot
      return;
    }
    tx = e.clientX;
    ty = e.clientY;
    if (!shown) {
      // Reappearing: snap to the pointer rather than gliding from the old spot.
      x = tx;
      y = ty;
      vx = vy = 0;
      p = 1;
      angle = 0;
      shown = true;
      paint();
      render();
    }
    kick();
  }

  function onOver(e) {
    if (e.pointerType !== "mouse" || e.target === lastTarget) return;
    lastTarget = e.target;
    if (dragLock) return;
    mode = classify(e.target);
    render();
  }

  function onOut(e) {
    if (e.pointerType !== "mouse") return;
    // Left the window, or entered an iframe (Spotify embeds swallow events).
    if (!e.relatedTarget || e.relatedTarget.tagName === "IFRAME") hide();
  }

  function onDown(e) {
    if (e.pointerType !== "mouse") return;
    down = true;
    if (e.target.closest && e.target.closest("#scene")) dragLock = true;
    render();
  }

  function onUp() {
    if (!down && !dragLock) return;
    down = false;
    if (dragLock) {
      dragLock = false;
      mode = classify(lastTarget);
    }
    render();
  }

  function onBlur() {
    down = dragLock = false;
    hide();
  }

  function onVisibility() {
    if (!document.hidden) return;
    cancelAnimationFrame(raf);
    raf = 0;
    hide();
  }

  const listeners = [
    [window, "pointermove", onMove],
    [window, "pointerdown", onDown],
    [window, "pointerup", onUp],
    [window, "pointercancel", onUp],
    [window, "blur", onBlur],
    [document, "pointerover", onOver],
    [document, "pointerout", onOut],
    [document, "visibilitychange", onVisibility],
  ];

  function enable() {
    if (on) return;
    on = true;
    listeners.forEach(([t, type, fn]) => t.addEventListener(type, fn, { passive: true }));
    root.classList.add("xst-cursor-on"); // native cursor only goes away once we're live
  }

  function disable() {
    if (!on) return;
    on = false;
    listeners.forEach(([t, type, fn]) => t.removeEventListener(type, fn));
    root.classList.remove("xst-cursor-on");
    cancelAnimationFrame(raf);
    raf = 0;
    shown = down = dragLock = false;
    mode = "";
    lastTarget = null;
    render();
  }

  const sync = () => (gate.matches ? enable() : disable());
  gate.addEventListener("change", sync);
  motion.addEventListener("change", (e) => {
    reduce = e.matches;
  });
  sync();
})();
