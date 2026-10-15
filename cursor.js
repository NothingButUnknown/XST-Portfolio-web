// ---------- site-wide cursor (mouse-with-hover, 768px+ only) ----------
//
// A red knockout dot locked to the pointer site-wide. It grows over links and
// morphs into the red "Drag" / "View" bubble over the sphere / a cover. It
// stays a circle at all times: no smear, no trailing, so it is always exactly
// where the click lands. One style write per frame (--x / --y on the wrapper,
// read by the parts as translate); every size or state change is a class
// toggle CSS animates with transform + opacity.

(() => {
  "use strict";

  const cursor = document.getElementById("xstCursor");
  if (!cursor) return;

  const root = document.documentElement;
  const gate = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 768px)");

  const FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
  const LINK = 'a, button, [role="button"], [data-cursor="pointer"], label, summary';

  let on = false; // gate passed + listeners attached
  let shown = false; // a real mouse move has happened since the last hide
  let mode = ""; // "" | link | drag | view | field
  let down = false;
  let dragLock = false; // pointerdown on the sphere keeps "drag" until release
  let lastTarget = null;

  let raf = 0;
  let x = 0;
  let y = 0;

  let curClass = "";

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

  // Touches the DOM only when the class string actually changes.
  function render() {
    const m = dragLock ? "drag" : mode;
    const live = on && shown && m !== "field";
    const cls =
      "xst-cursor" +
      (live ? " is-visible" : "") +
      (m && m !== "field" ? " is-" + m : "") +
      (down ? " is-down" : "");
    if (cls === curClass) return;
    cursor.className = curClass = cls;
  }

  // High-rate mice fire pointermove several times a frame; write once per frame.
  function paint() {
    raf = 0;
    cursor.style.cssText = "--x:" + x + "px;--y:" + y + "px";
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
    x = e.clientX;
    y = e.clientY;
    if (!shown) {
      // Reappearing: place it before it fades in, so it never flashes elsewhere.
      shown = true;
      cancelAnimationFrame(raf);
      paint();
      render();
      return;
    }
    if (!raf) raf = requestAnimationFrame(paint);
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
  sync();
})();
