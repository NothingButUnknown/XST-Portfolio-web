// ---------- per-line split for the hero fade-up ----------
// Wraps an element's text into <span class="line"><span class="line-inner">
// so each *rendered* line (not each hard-coded <br>) can fade up on its own
// stagger — the mask/inner-translate pattern (page.css .line/.line-inner)
// only works if each line has its own overflow-hidden wrapper.
//
// Re-splits on width change (ResizeObserver) so a resize/orientation change
// re-buckets words into whatever lines the new width actually produces.
// Exposed as window.xstSplitLines so the inline orchestration script in
// index.html can call it right before arming .is-ready.
//
// data-accent="word" (optional, space-separated for more than one) marks
// exact words that get wrapped in an accent span on rebuild — the serif
// outline/gradient treatment (see .accent-outline/.accent-italic/.accent-fade
// in styles.css) applied to the headline's payoff word(s). data-accent-class
// overrides the default span class (default "accent-outline") for any word
// in the list that doesn't specify its own. A single token can pin its own
// class inline as "word:class" (e.g. data-accent="stops:accent-fade
// scroll.:accent-outline") so one headline can mix voices per word.

(function () {
  function splitLines(el) {
    if (!el || !el.textContent.trim()) return;

    // First run: remember the plain text so re-splits (resize) start clean
    // instead of re-splitting already-wrapped markup.
    if (!el.dataset.text) {
      el.dataset.text = el.textContent;
    }
    const words = el.dataset.text.trim().split(/\s+/);
    const defaultAccentClass = el.dataset.accentClass || "accent-outline";
    // Map of word -> class. A bare token ("scroll.") uses defaultAccentClass;
    // a "word:class" token (e.g. "stops:accent-fade") pins its own class so a
    // single headline can mix accent voices per word.
    const accentWords = new Map();
    (el.dataset.accent || "").split(/\s+/).filter(Boolean).forEach((token) => {
      const sep = token.indexOf(":");
      if (sep === -1) {
        accentWords.set(token, defaultAccentClass);
      } else {
        accentWords.set(token.slice(0, sep), token.slice(sep + 1));
      }
    });

    // Measure pass: lay the words out as plain inline spans first so their
    // natural offsetTop tells us where the browser actually wrapped —
    // that's the only reliable way to find line breaks for text that
    // reflows at arbitrary widths.
    el.textContent = "";
    const measureSpans = words.map((word, i) => {
      const span = document.createElement("span");
      span.textContent = word + (i < words.length - 1 ? " " : "");
      span.style.display = "inline";
      el.appendChild(span);
      return span;
    });

    const lineTops = [];
    const buckets = [];
    measureSpans.forEach((span) => {
      const top = span.offsetTop;
      let idx = lineTops.indexOf(top);
      if (idx === -1) {
        lineTops.push(top);
        buckets.push([]);
        idx = lineTops.length - 1;
      }
      buckets[idx].push(span.textContent);
    });

    // Rebuild: one .line (the overflow-hidden mask) per bucket, wrapping a
    // .line-inner (the thing that actually translates/opacity-fades). Words
    // matching data-accent get wrapped in their own span instead of being
    // folded into the line-inner's plain text.
    el.textContent = "";
    buckets.forEach((lineWords, i) => {
      const line = document.createElement("span");
      line.className = "line";
      line.style.setProperty("--line-i", i);
      const inner = document.createElement("span");
      inner.className = "line-inner";
      lineWords.forEach((word) => {
        const trimmed = word.trim();
        const trailingSpace = word.endsWith(" ") ? " " : "";
        if (accentWords.has(trimmed)) {
          const accent = document.createElement("span");
          accent.className = accentWords.get(trimmed);
          accent.textContent = trimmed;
          inner.appendChild(accent);
          if (trailingSpace) inner.appendChild(document.createTextNode(trailingSpace));
        } else {
          inner.appendChild(document.createTextNode(word));
        }
      });
      line.appendChild(inner);
      el.appendChild(line);
    });
  }

  window.xstSplitLines = function (selector) {
    document.querySelectorAll(selector).forEach((el) => {
      splitLines(el);
      if (!el.dataset.lineObserved) {
        el.dataset.lineObserved = "1";
        const ro = new ResizeObserver(() => {
          // Only re-split before the reveal has locked in — once .is-ready
          // has fired the lines are meant to stay put (they're already
          // visible; a resize-triggered re-split would restart the mask
          // structure and be visible as a flicker for no benefit).
          if (!document.documentElement.classList.contains("is-ready")) {
            splitLines(el);
          }
        });
        ro.observe(el);
      }
    });
  };
})();
