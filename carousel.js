// ---------- artist row: continuous auto-drift flat marquee ----------
//
// `pos` is a continuous float position (not an integer index), so cards can
// glide frame-by-frame instead of snapping. An ambient drift speed eases
// toward zero on interaction (exponential smoothing, never a hard cut) and
// eases back up after a short idle delay. Arrow clicks and card clicks
// animate `pos` toward a target instead of jumping.
//
// Visually this is a flat row now (uniform card size, no 3D fan) — only the
// per-card transform math and what a card shows changed from the coverflow
// version; the drift/decelerate timing below is untouched.

(function () {
  const artistsDataEl = document.querySelector("#artistsData");
  const artists = artistsDataEl ? JSON.parse(artistsDataEl.textContent) : [];
  const labelsDataEl = document.querySelector("#labelsData");
  const labels = labelsDataEl ? JSON.parse(labelsDataEl.textContent) : [];

  // No real roster or label list yet — hide the whole section (and its nav
  // link) instead of showing an empty carousel shell. A fabricated roster
  // reads as a lie on a real portfolio; an absent one just reads as "coming
  // soon." Fill #artistsData/#labelsData with real data and this section
  // un-hides itself — no code changes needed.
  if (!artists.length && !labels.length) {
    const emptySection = document.querySelector("#artists");
    if (emptySection) emptySection.hidden = true;
    document.querySelector("#navArtists")?.remove();
    return;
  }
  if (!artists.length) return;

  const section = document.querySelector("#artists");
  const stage = document.querySelector(".artist-stage");
  const artistTrack = document.querySelector("#artistTrack");
  const arrowLeft = document.querySelector("#artistArrowLeft");
  const arrowRight = document.querySelector("#artistArrowRight");

  if (!section || !stage || !artistTrack) return;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- tuning (unchanged from the coverflow version) ----------
  const BASE_SPEED = 0.55; // cards per second, ambient idle drift (positive = leftward)
  const SPEED_EASE_K = 2.2; // exponential smoothing constant for speed -> targetSpeed
  const SNAP_EASE_K = 6; // exponential smoothing constant for the idle rest-on-integer spring
  const CHASE_EASE_K = 8; // exponential smoothing constant for arrow/click targetPos chases
  const IDLE_RESUME_MS = 1200; // delay after interaction ends before drift resumes

  const length = artists.length;

  // A short roster (this client has 7) only spans a few hundred px at
  // card-width — nowhere near wide enough to fill a big desktop monitor, so
  // the row left the two edges of the track empty. Render the roster
  // repeated back-to-back (same trick the labels ticker already uses) until
  // there are enough cards to fill a very wide track; on a long roster
  // REPEAT collapses to 1 and nothing changes.
  const MIN_TRACK_CARDS = 24;
  const REPEAT = Math.max(1, Math.ceil(MIN_TRACK_CARDS / length));
  const trackLength = length * REPEAT;

  // How many card-positions to either side stay visible. Used to be a fixed
  // 5, which is enough cards to fill a laptop-width track but leaves the two
  // edges empty (missing cards) on a wide desktop monitor where the track is
  // much wider. Compute it from the actual track width instead, so there's
  // always enough cards rendered on both sides to reach past the edges.
  let VISIBLE_RANGE = 5;

  function updateVisibleRange() {
    const { spacing } = layoutConfig();
    const halfTrack = artistTrack.clientWidth / 2;
    // Cards needed to cover from center to edge, plus a couple extra so
    // cards are already in place (not popping in) as they drift into view.
    const needed = Math.ceil(halfTrack / spacing) + 2;
    VISIBLE_RANGE = Math.max(5, Math.min(needed, Math.floor(trackLength / 2)));
  }

  // ---------- build cards: image + caption (credit line / name / stat line) ----------
  // trackIndex (0..trackLength-1) is this card's fixed slot in the repeated
  // row; artistIndex (0..length-1) is which real artist it shows.
  const cards = [];
  for (let repeat = 0; repeat < REPEAT; repeat += 1) {
    artists.forEach((artist, artistIndex) => {
      const trackIndex = repeat * length + artistIndex;
      const card = document.createElement("button");
      card.type = "button";
      card.className = "artist-card";
      card.dataset.index = String(artistIndex);
      card.setAttribute("role", "option");
      card.setAttribute("aria-label", artist.name);
      if (repeat > 0) {
        // Repeats beyond the first are decorative fill — same content, so
        // hide them from the a11y tree/tab order instead of announcing the
        // same artist several times over.
        card.setAttribute("aria-hidden", "true");
        card.tabIndex = -1;
      }

      const art = document.createElement("div");
      art.className = "artist-card-art";
      const img = document.createElement("img");
      img.src = artist.img;
      img.alt = "";
      img.draggable = false;
      img.loading = trackIndex < 4 ? "eager" : "lazy";
      img.decoding = "async";
      art.appendChild(img);
      card.appendChild(art);

      const caption = document.createElement("div");
      caption.className = "artist-card-caption";

      const credit = document.createElement("p");
      credit.className = "artist-card-credit";
      credit.textContent = artist.role || "";
      caption.appendChild(credit);

      const title = document.createElement("p");
      title.className = "artist-card-title";
      title.textContent = artist.name || "";
      caption.appendChild(title);

      const stat = document.createElement("p");
      stat.className = "artist-card-stat";
      stat.textContent = artist.note || "";
      caption.appendChild(stat);

      card.appendChild(caption);

      card.addEventListener("click", () => chaseToTrack(trackIndex));
      artistTrack.appendChild(card);
      cards.push(card);
    });
  }

  // ---------- state ----------
  let pos = 0; // continuous position (float) — offset = card index - pos
  let speed = 0; // current drift speed, cards/second
  let targetSpeed = reduceMotion ? 0 : BASE_SPEED;
  let targetPos = null; // active arrow/click chase target, or null when ambient
  let idleTimer = null;
  let sectionVisible = true;
  let rafId = null;
  let lastTime = 0;
  let tickerStep = null; // set once the labels ticker below has data to drive

  // ---------- layout tuning per breakpoint (flat row: translate only) ----------
  function layoutConfig() {
    const mobile = window.innerWidth <= 600;
    return {
      spacing: mobile ? 148 : 224,
    };
  }

  function wrapOffset(offset) {
    offset = offset % trackLength;
    if (offset > trackLength / 2) offset -= trackLength;
    if (offset < -trackLength / 2) offset += trackLength;
    return offset;
  }

  function layout() {
    const { spacing } = layoutConfig();

    cards.forEach((card, index) => {
      const offset = wrapOffset(index - pos);
      const abs = Math.abs(offset);
      const visible = abs <= VISIBLE_RANGE;

      card.style.zIndex = String(Math.round(100 - abs));
      card.style.pointerEvents = visible ? "auto" : "none";
      card.style.visibility = visible ? "visible" : "hidden";

      const x = offset * spacing;
      card.style.transform = `translate3d(calc(-50% + ${x}px), -50%, 0)`;
    });
  }

  // ---------- targeted moves (arrows / card click) ----------
  function currentTrackPos() {
    return ((Math.round(pos) % trackLength) + trackLength) % trackLength;
  }

  // Chases straight to the clicked card's own slot (not just "the artist,
  // wherever the nearest copy is") — with the roster repeated, that's the
  // slot the user actually pointed at.
  function chaseToTrack(trackIndex) {
    const roundedPos = Math.round(pos);
    const cur = currentTrackPos();
    let delta = trackIndex - cur;
    if (delta > trackLength / 2) delta -= trackLength;
    if (delta < -trackLength / 2) delta += trackLength;
    targetPos = roundedPos + delta;
    targetSpeed = 0;
    restartIdleTimer();
  }

  function stepArrow(delta) {
    targetPos = Math.round(pos) + delta;
    targetSpeed = 0;
    restartIdleTimer();
  }

  arrowLeft?.addEventListener("click", () => stepArrow(-1));
  arrowRight?.addEventListener("click", () => stepArrow(1));

  // ---------- interaction -> gradual stop / gradual resume ----------
  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function restartIdleTimer() {
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      targetSpeed = reduceMotion ? 0 : BASE_SPEED;
    }, IDLE_RESUME_MS);
  }

  function onInteractStart() {
    targetSpeed = 0;
    clearIdleTimer();
  }

  function onInteractEnd() {
    restartIdleTimer();
  }

  // Mouse-hover pause binds to the track itself, not the full-width stage —
  // .artist-stage spans 100% of the section (including the empty flanks
  // beyond the visible cards), so binding pointerenter there froze the drift
  // whenever the cursor merely rested near the row. Keyboard focus still
  // binds to the whole stage (arrows included) so tabbing to an arrow still
  // pauses drift for a sighted keyboard user.
  artistTrack.addEventListener("pointerenter", onInteractStart);
  artistTrack.addEventListener("pointerleave", onInteractEnd);
  artistTrack.addEventListener("pointerdown", onInteractStart);
  // Touch has no hover, so pointerenter/pointerleave largely don't fire —
  // a tap only gives pointerdown. Without a matching release listener,
  // tapping the track (anywhere that isn't a card, e.g. between cards, or
  // the start of a scroll drag) drops targetSpeed to 0 and nothing ever
  // calls onInteractEnd again: permanently frozen. pointerup/pointercancel
  // on window catch the release even if the finger drags off the track.
  window.addEventListener("pointerup", onInteractEnd);
  window.addEventListener("pointercancel", onInteractEnd);
  stage.addEventListener("focusin", onInteractStart);
  stage.addEventListener("focusout", (event) => {
    if (!stage.contains(event.relatedTarget)) onInteractEnd();
  });

  // ---------- main loop ----------
  function frame(time) {
    if (!lastTime) lastTime = time;
    let dt = (time - lastTime) / 1000;
    lastTime = time;
    if (dt > 0.05) dt = 0.05; // clamp so a throttled/backgrounded tab doesn't jump

    // Ease speed toward targetSpeed — this exponential curve IS the gradual
    // deceleration/re-acceleration; never a hard cut, never a linear ramp.
    speed += (targetSpeed - speed) * (1 - Math.exp(-SPEED_EASE_K * dt));

    if (targetPos !== null) {
      pos += (targetPos - pos) * (1 - Math.exp(-CHASE_EASE_K * dt));
      if (Math.abs(targetPos - pos) < 0.001) {
        pos = targetPos;
        targetPos = null;
      }
    } else {
      pos += speed * dt;

      // Once fully stopped and idle, spring pos to rest on a whole artist
      // instead of leaving it at a fractional position.
      if (targetSpeed === 0 && Math.abs(speed) < 0.01) {
        const rounded = Math.round(pos);
        const diff = rounded - pos;
        if (Math.abs(diff) < 0.001) {
          pos = rounded;
        } else {
          pos += diff * (1 - Math.exp(-SNAP_EASE_K * dt));
        }
      }
    }

    layout();
    if (tickerStep) tickerStep(dt);

    rafId = sectionVisible ? requestAnimationFrame(frame) : null;
  }

  window.addEventListener("resize", () => {
    updateVisibleRange();
    layout();
  });

  updateVisibleRange();
  layout();

  // Start the loop unconditionally on load — don't wait for the observer's
  // first callback. IntersectionObserver callbacks are async and, on some
  // desktop layouts (zoom level, late web-font reflow, initial scroll
  // position), the first report can come back isIntersecting:false even
  // though the section is about to be on-screen. Relying on it alone as the
  // *only* way to ever start the loop meant a bad first read froze the whole
  // row and ticker permanently, with nothing to retry it. The observer still
  // pauses/resumes the loop after this for scroll performance — it's just
  // no longer the sole trigger.
  rafId = requestAnimationFrame(frame);

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      sectionVisible = entry.isIntersecting;
      if (sectionVisible && rafId === null) {
        lastTime = 0;
        rafId = requestAnimationFrame(frame);
      }
    },
    { threshold: 0.01 }
  );
  visibilityObserver.observe(section);

  // ---------- labels ticker: constant drift, decelerates on hover ----------
  //
  // Same rig as the artist row above: a continuous px position eased toward
  // a target speed (exponential smoothing, never a hard cut), so hovering
  // the ticker glides it down to a stop instead of snapping. Runs inside the
  // shared frame() loop / #artists visibility gate above — no separate rAF.
  const labelsTrack = document.querySelector("#labelsTrack");
  const tickerMask = document.querySelector(".ticker-mask");

  const TICKER_SPEED = 42; // px/second, ambient idle drift (leftward)

  let tickerPos = 0; // px, continuous
  let tickerSpeed = 0;
  let tickerTargetSpeed = reduceMotion ? 0 : TICKER_SPEED;
  let tickerHalfWidth = 0;

  if (labels.length && labelsTrack) {
    const renderSet = () => {
      const frag = document.createDocumentFragment();
      labels.forEach((label) => {
        const item = document.createElement("span");
        item.className = "ticker-item";
        item.textContent = label;
        frag.appendChild(item);
      });
      return frag;
    };

    // Twice back-to-back so wrapping at the halfway point is a seamless loop.
    labelsTrack.appendChild(renderSet());
    labelsTrack.appendChild(renderSet());

    const measureTicker = () => {
      tickerHalfWidth = labelsTrack.scrollWidth / 2;
    };
    measureTicker();
    window.addEventListener("resize", measureTicker);

    tickerMask?.addEventListener("pointerenter", () => {
      tickerTargetSpeed = 0;
    });
    tickerMask?.addEventListener("pointerleave", () => {
      tickerTargetSpeed = reduceMotion ? 0 : TICKER_SPEED;
    });

    tickerStep = (dt) => {
      tickerSpeed += (tickerTargetSpeed - tickerSpeed) * (1 - Math.exp(-SPEED_EASE_K * dt));
      tickerPos += tickerSpeed * dt;
      if (tickerHalfWidth > 0 && tickerPos >= tickerHalfWidth) tickerPos -= tickerHalfWidth;
      labelsTrack.style.transform = `translateX(${-tickerPos}px)`;
    };
  }
})();
