// ---------- hero payoff-word cycler ----------
// Cycles the last word of the hero headline through a placeholder list.
// Old word cuts out instantly, new word settles in over ~320ms (fade +
// a short rise, same --ease curve as the line reveal above it) so the
// metallic fill (see --metal-cycle) reads as catching light on the way
// in rather than just switching on. Holds ~2.5s, repeats. One moving
// thing in the hero — no slide, no blur, no stagger.
//
// data-cycle="word|word|word" (pipe-separated) on the same heading that
// carries data-split-lines / data-accent. The FIRST word must match the
// word already in data-accent so lines.js's rebuild and this module agree
// on which span is the rotator. Placeholder text only — swap the list (or
// drop the attribute) when real copy lands.

(function () {
  var HOLD_MS = 2500;
  var FADE_MS = 320;
  var FIRST_DELAY_MS = 1200;
  var EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

  function reducedMotion() {
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function widestWidth(span, words) {
    // Offscreen clone, same classes/font, so measuring never touches
    // layout the user can see.
    var probe = span.cloneNode(false);
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.minWidth = "0";
    probe.style.display = "inline-block";
    document.body.appendChild(probe);

    var max = 0;
    words.forEach(function (word) {
      probe.textContent = word;
      max = Math.max(max, probe.getBoundingClientRect().width);
    });

    document.body.removeChild(probe);
    return max;
  }

  function cycle(heading) {
    var raw = heading.dataset.cycle || "";
    var words = raw.split("|").map(function (w) { return w.trim(); }).filter(Boolean);
    if (words.length < 2) return;

    // .line and .line-inner are spans too, and when the accent word is the
    // only thing on its line their textContent also equals words[0] — so
    // matching on text alone picks the wrapper, not the accent span inside
    // it, and swapping its textContent would blow away the accent span and
    // its font treatment. Leaf spans only.
    var span = null;
    Array.prototype.forEach.call(heading.querySelectorAll("span"), function (el) {
      if (el.children.length === 0 && el.textContent.trim() === words[0]) span = el;
    });
    if (!span) return; // lines.js hasn't produced the accent span — nothing to cycle

    span.classList.add("is-cycling");

    function reserveWidth() {
      var w = widestWidth(span, words);
      if (w > 0) span.style.minWidth = Math.ceil(w) + "px";
    }
    reserveWidth();

    var onResize = function () {
      // A resize can also change font-size (clamp on vw); re-measure rather
      // than trust the old reservation.
      reserveWidth();
    };
    window.addEventListener("resize", onResize);

    if (reducedMotion()) return; // first word stays put, no timer starts

    var visible = true;
    var io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            function (entries) {
              visible = entries[0].isIntersecting;
            },
            { threshold: 0 }
          )
        : null;
    if (io) io.observe(heading);

    var i = 0;
    var timer = null;

    function swap() {
      if (document.visibilityState !== "visible" || !visible) {
        // Skip this tick, try again next interval rather than swapping
        // while nobody can see it.
        return;
      }
      i = (i + 1) % words.length;
      span.style.transition = "none";
      span.style.opacity = "0";
      span.style.transform = "translateY(6px)";
      span.textContent = words[i];
      // Force a reflow so the transition below doesn't get coalesced with
      // the opacity:0/transform set above.
      void span.offsetWidth;
      requestAnimationFrame(function () {
        span.style.transition =
          "opacity " + FADE_MS + "ms " + EASE + ", transform " + FADE_MS + "ms " + EASE;
        span.style.opacity = "1";
        span.style.transform = "translateY(0)";
      });
    }

    setTimeout(function () {
      swap();
      timer = setInterval(swap, HOLD_MS);
    }, FIRST_DELAY_MS);
  }

  window.xstWordCycle = function (selector) {
    document.querySelectorAll(selector).forEach(cycle);
  };
})();
