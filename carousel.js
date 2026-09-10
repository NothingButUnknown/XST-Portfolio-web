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
  const VISIBLE_RANGE = 5; // how many card-positions to either side stay visible

  const length = artists.length;

  // ---------- build cards: image + caption (credit line / name / stat line) ----------
  const cards = artists.map((artist, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "artist-card";
    card.dataset.index = String(index);
    card.setAttribute("role", "option");
    card.setAttribute("aria-label", artist.name);

    const art = document.createElement("div");
    art.className = "artist-card-art";
    const img = document.createElement("img");
    img.src = artist.img;
    img.alt = "";
    img.draggable = false;
    img.loading = index < 4 ? "eager" : "lazy";
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

    card.addEventListener("click", () => goToIndex(index));
    artistTrack.appendChild(card);
    return card;
  });

  // ---------- state ----------
  let pos = 0; // continuous position (float) — offset = card index - pos
  let speed = 0; // current drift speed, cards/second
  let targetSpeed = reduceMotion ? 0 : BASE_SPEED;
  let targetPos = null; // active arrow/click chase target, or null when ambient
  let idleTimer = null;
  let sectionVisible = true;
  let rafId = null;
  let lastTime = 0;

  // ---------- layout tuning per breakpoint (flat row: translate only) ----------
  function layoutConfig() {
    const mobile = window.innerWidth <= 600;
    return {
      spacing: mobile ? 148 : 224,
    };
  }

  function wrapOffset(offset) {
    offset = offset % length;
    if (offset > length / 2) offset -= length;
    if (offset < -length / 2) offset += length;
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
  function currentModIndex() {
    return ((Math.round(pos) % length) + length) % length;
  }

  function chaseTo(index) {
    const roundedPos = Math.round(pos);
    const curMod = currentModIndex();
    let delta = index - curMod;
    if (delta > length / 2) delta -= length;
    if (delta < -length / 2) delta += length;
    targetPos = roundedPos + delta;
    targetSpeed = 0;
    restartIdleTimer();
  }

  function goToIndex(index) {
    chaseTo(((index % length) + length) % length);
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

  stage.addEventListener("pointerenter", onInteractStart);
  stage.addEventListener("pointerleave", onInteractEnd);
  stage.addEventListener("pointerdown", onInteractStart);
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

    rafId = sectionVisible ? requestAnimationFrame(frame) : null;
  }

  window.addEventListener("resize", layout);

  layout();

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

  // ---------- labels ticker: decorative CSS-only marquee ----------
  //
  // Not interactive (no click targets, no pause-on-hover) — a constant
  // undisturbed ribbon, per the reference. Content is duplicated once so a
  // `translateX(-50%)` CSS animation loops seamlessly; the animation itself
  // (speed, direction, easing) lives entirely in carousel.css. The only JS
  // job here is populating the list and pausing it in sync with the same
  // #artists IntersectionObserver used above (no separate rAF needed).
  const labelsDataEl = document.querySelector("#labelsData");
  const labels = labelsDataEl ? JSON.parse(labelsDataEl.textContent) : [];
  const labelsTrack = document.querySelector("#labelsTrack");

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

    // Twice back-to-back so translateX(-50%) is a seamless loop point.
    labelsTrack.appendChild(renderSet());
    labelsTrack.appendChild(renderSet());

    const tickerObserver = new IntersectionObserver(
      ([entry]) => {
        labelsTrack.classList.toggle("is-paused", !entry.isIntersecting);
      },
      { threshold: 0.01 }
    );
    tickerObserver.observe(section);
  }
})();
