const scene = document.querySelector("#scene");
const sceneInner = document.querySelector("#sceneInner");
const sceneWeb = document.querySelector("#sceneWeb");
const sceneBadge = document.querySelector(".scene-badge");
const indexReadout = document.querySelector("#indexReadout");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Coarse-pointer devices (phones/tablets) are typically weaker GPUs/CPUs
// rendering at a higher devicePixelRatio, and the O(n^2) connecting-web
// lines below (~300 stroke() calls/frame for 25 nodes) is the single
// heaviest part of this scene. Cheapen both on touch devices.
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

const catalogue = JSON.parse(document.querySelector("#catalogue").textContent);

// ---------- live-figure flash ----------
// Reference: Spotify for Artists' "All-time streams · LIVE" readout — the
// number itself flashes to the hot accent every few seconds and eases back,
// reading as a live counter rather than a printed total. Timing is
// irregular on purpose (real ticks don't land on a metronome); gated behind
// reduceMotion like every other ambient loop in this file.
// The dot's expanding ring is a plain infinite CSS animation (see
// .impact-live-dot::before/::after in page.css) — no JS needed for it.
const impactTotalEl = document.querySelector("#impactTotal");
if (impactTotalEl && !reduceMotion) {
  const FLASH_ON_MS = 620; // full length of the impact-total-glow/-ring keyframe cycle (measured off the Spotify for Artists reference) — the class must outlive its own animation, not cut it off mid-flight
  const FLASH_GAP_MIN_MS = 2000;
  const FLASH_GAP_MAX_MS = 2600; // measured reference cadence (was 3500-7000, much slower than the real thing)
  const scheduleLiveFlash = () => {
    const gap = FLASH_GAP_MIN_MS + Math.random() * (FLASH_GAP_MAX_MS - FLASH_GAP_MIN_MS);
    setTimeout(() => {
      impactTotalEl.classList.add("is-live-flash");
      setTimeout(() => {
        impactTotalEl.classList.remove("is-live-flash");
        scheduleLiveFlash();
      }, FLASH_ON_MS);
    }, gap);
  };
  scheduleLiveFlash();
}

// Renders a title with its last word in the outline accent face (see
// .accent-outline in styles.css) — the same treatment as the static
// headings, applied here because detail-title's text is data-driven.
function setAccentTitle(el, text) {
  el.textContent = "";
  const words = text.trim().split(/\s+/);
  const last = words.pop();
  if (words.length) {
    el.appendChild(document.createTextNode(words.join(" ") + " "));
  }
  const accent = document.createElement("span");
  accent.className = "accent-outline";
  accent.textContent = last;
  el.appendChild(accent);
}

// ---------- dominant-color sampling (drives the per-cover glow) ----------

const FALLBACK_GLOW = "224, 27, 27";
const coverGlow = catalogue.map(() => FALLBACK_GLOW);
const sampleCanvas = document.createElement("canvas");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
const SAMPLE_SIZE = 24;
sampleCanvas.width = SAMPLE_SIZE;
sampleCanvas.height = SAMPLE_SIZE;

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }

  return [h, s, l];
};

const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;

  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
};

const sampleCoverGlow = (img, index, node) => {
  if (!sampleContext) return;

  try {
    sampleContext.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    sampleContext.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = sampleContext.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    let rSum = 0, gSum = 0, bSum = 0, count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;

      if (lightness < 0.08 || lightness > 0.94) continue;

      rSum += r;
      gSum += g;
      bSum += b;
      count += 1;
    }

    if (!count) return;

    const [h, s] = rgbToHsl(rSum / count, gSum / count, bSum / count);
    const [r, g, b] = hslToRgb(h, Math.min(1, s * 1.35 + 0.25), 0.56);
    const glow = `${r}, ${g}, ${b}`;
    coverGlow[index] = glow;
    node.style.setProperty("--glow-rgb", glow);
  } catch (error) {
    // Canvas sampling failed (e.g. tainted source); keep the fallback glow,
    // but log it — this used to fail completely silently, which made a
    // per-machine glow regression impossible to diagnose from a report.
    console.warn(`[scene] glow sampling failed for cover ${index}:`, error);
  }
};

// ---------- build cover nodes ----------

const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const points = [];
const lastZIndex = [];
// The badge's own point on the unit sphere — dead center of the "front"
// face, radius 1 like every cover point. rotatePoint() carries it through
// the same yaw/pitch/roll as the cards, so it's a real point on the globe,
// not a screen-space overlay.
const badgePoint = { x: 0, y: 0, z: 1 };
let lastBadgeZIndex = null;

const nodes = catalogue.map((item, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cover-node";
  button.dataset.index = String(index);
  button.setAttribute("aria-label", `Open ${item.title || "Untitled — " + item.id}`);

  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.width = 480;
  img.height = 480;
  // loading/decoding must be set BEFORE src — some browsers latch the
  // lazy/eager decision at src-assignment time, so setting it after src (as
  // this used to) eager-loads on Chromium but can lazy-load the same node on
  // Safari/Firefox. That inconsistency is what made covers occasionally fail
  // to appear until a refresh warmed the cache.
  img.loading = index < 6 ? "eager" : "lazy";
  img.decoding = "async";
  img.src = `assets/covers/thumb/${item.file}`;
  button.appendChild(img);

  sceneInner.appendChild(button);

  if (img.complete && img.naturalWidth) {
    sampleCoverGlow(img, index, button);
  } else {
    img.addEventListener("load", () => sampleCoverGlow(img, index, button), { once: true });
    img.addEventListener(
      "error",
      () => console.warn(`[scene] cover thumb failed to load: ${img.src}`),
      { once: true }
    );
  }

  const y = 1 - (index / Math.max(catalogue.length - 1, 1)) * 2;
  const ringRadius = Math.sqrt(1 - y * y);
  const theta = index * goldenAngle;

  points.push({
    x: Math.cos(theta) * ringRadius,
    y,
    z: Math.sin(theta) * ringRadius,
  });

  return button;
});

if (indexReadout) {
  indexReadout.textContent = `— / ${String(catalogue.length).padStart(3, "0")}`;
}

// ---------- 3D rotation ----------

let targetRotationX = -10;
let targetRotationY = 0;
// Was -6: a permanent screen roll on top of the per-tile cant below (see
// `roll` in render()). Pure decoration that tilted "straight up" 6° off
// vertical and fought the up-means-up fix — cut it.
let targetRotationZ = 0;
let currentRotationX = targetRotationX;
let currentRotationY = targetRotationY;
let currentRotationZ = targetRotationZ;
let idleSpin = reduceMotion ? 0 : 0.045;

let isDragging = false;
let dragMoved = 0;
let startX = 0;
let startY = 0;
let startRotationX = 0;
let startRotationY = 0;
let activeIndex = -1;
let loadProgress = reduceMotion ? 1 : 0;

const rotatePoint = (point, rotationX, rotationY, rotationZ) => {
  const xRad = (rotationX * Math.PI) / 180;
  const yRad = (rotationY * Math.PI) / 180;
  const zRad = (rotationZ * Math.PI) / 180;

  let { x, y, z } = point;

  // 1. Yaw, about the globe's own vertical axis. This must happen BEFORE
  //    pitch so the pitch axis below stays pinned to the screen instead of
  //    being carried around by the spin. With pitch applied first (the old
  //    order), the pitch axis drifted as the globe idle-spun — at some yaw
  //    angles a vertical drag tilted correctly, at others it rotated about
  //    the view axis and pinwheeled the whole cloud sideways.
  const nextX = x * Math.cos(yRad) + z * Math.sin(yRad);
  const nextZ1 = -x * Math.sin(yRad) + z * Math.cos(yRad);
  x = nextX;
  z = nextZ1;

  // 2. Pitch, about the screen-horizontal axis. Up is up at every yaw angle.
  const nextY = y * Math.cos(xRad) - z * Math.sin(xRad);
  const nextZ2 = y * Math.sin(xRad) + z * Math.cos(xRad);
  y = nextY;
  z = nextZ2;

  // 3. Roll, in screen space.
  return {
    x: x * Math.cos(zRad) - y * Math.sin(zRad),
    y: x * Math.sin(zRad) + y * Math.cos(zRad),
    z,
  };
};

const setActiveCover = (index) => {
  if (index === activeIndex) return;
  activeIndex = index;
  nodes.forEach((node, i) => node.classList.toggle("is-active", i === index));
  if (indexReadout) {
    indexReadout.textContent = `${String(index + 1).padStart(3, "0")} / ${String(catalogue.length).padStart(3, "0")}`;
  }
};

// ---------- connecting web (canvas) ----------

const webContext = sceneWeb?.getContext("2d");
let webWidth = 0;
let webHeight = 0;

// Geometry cache: sceneInner/scene only change size on window resize (or a
// device-orientation change), never per animation frame. Reading
// getBoundingClientRect() inside render() forces a synchronous layout 60x/sec
// for no reason — Safari in particular pays a much bigger tax for that than
// Chromium. Compute it once here and only refresh on resize.
let cachedBoxWidth = 0;
let cachedBoxHeight = 0;
let cachedSceneOffsetLeft = 0;
let cachedSceneOffsetTop = 0;
// Sphere radius in px, refreshed alongside the rest of the geometry cache.
// Pointer drag reads this to convert a screen-pixel delta into degrees, so
// the drag tracks the finger 1:1 at any viewport size instead of using a
// fixed, arbitrary deg-per-pixel constant.
let sphereRadius = 0;
// Half-width of the .scene-badge mark, read off the live element so render()
// never needs a second hard-coded copy of styles.css's `--sphere` ratio (that
// ratio now differs by breakpoint — see the @media block in styles.css).
let cachedBadgeHalfWidth = 0;

const resizeSceneWeb = () => {
  if (!sceneWeb || !scene) return;
  // Cap the backing-store ratio on phones — a 3x-DPR phone screen otherwise
  // asks the canvas to fill 9x the pixels of a 1x screen for no visible gain
  // at this element's on-screen size.
  const ratio = Math.min(window.devicePixelRatio || 1, isCoarsePointer ? 1.5 : 3);
  const rect = scene.getBoundingClientRect();
  const innerRect = sceneInner.getBoundingClientRect();
  webWidth = rect.width;
  webHeight = rect.height;
  sceneWeb.width = Math.max(1, Math.round(rect.width * ratio));
  sceneWeb.height = Math.max(1, Math.round(rect.height * ratio));
  sceneWeb.style.width = `${rect.width}px`;
  sceneWeb.style.height = `${rect.height}px`;
  if (webContext) webContext.setTransform(ratio, 0, 0, ratio, 0, 0);

  cachedBoxWidth = innerRect.width;
  cachedBoxHeight = innerRect.height;
  cachedSceneOffsetLeft = innerRect.left - rect.left + innerRect.width / 2;
  cachedSceneOffsetTop = innerRect.top - rect.top + innerRect.height / 2;
  sphereRadius = Math.min(cachedBoxWidth, cachedBoxHeight) * 0.5;
  if (sceneBadge) cachedBadgeHalfWidth = sceneBadge.getBoundingClientRect().width / 2;
};

resizeSceneWeb();
window.addEventListener("resize", resizeSceneWeb);

// Reveal duration in wall-clock ms, independent of refresh rate (see below).
const REVEAL_MS = 820;
// 0 means "no previous frame yet" — render() computes a safe first-frame dt.
let lastFrameTime = 0;

const render = () => {
  const now = performance.now();
  // Elapsed time since the last frame, clamped so a stalled tab or a long
  // scroll-away doesn't produce one giant catch-up jump when it resumes.
  const dt = lastFrameTime ? Math.min(now - lastFrameTime, 64) : 16.7;
  lastFrameTime = now;
  // Frame-equivalents at a 60Hz baseline — every per-frame constant below
  // used to advance a fixed amount every requestAnimationFrame callback, so
  // the reveal and the rotation settle ran 2-4x faster on a 120-240Hz
  // display than on 60Hz. Scaling by elapsed time instead makes the motion
  // take the same wall-clock time everywhere.
  const frames = dt / 16.667;

  if (loadProgress < 1) {
    loadProgress = Math.min(1, loadProgress + dt / REVEAL_MS);
  }

  // No momentum/coasting after release — target rotation only moves from
  // direct input (drag or arrows) or this idle spin while untouched.
  if (!isDragging) {
    targetRotationY += idleSpin * frames;
  }

  const settleEase = 1 - Math.pow(1 - 0.14, frames);
  currentRotationX += (targetRotationX - currentRotationX) * settleEase;
  currentRotationY += (targetRotationY - currentRotationY) * settleEase;
  currentRotationZ += (targetRotationZ - currentRotationZ) * settleEase;

  const radius = sphereRadius;
  // Smoothstep, not linear — a linear reveal is fine for opacity but reads
  // as mechanical for motion. Same curve drives the rise and the fade.
  const eased = loadProgress * loadProgress * (3 - 2 * loadProgress);
  // How far below rest the globe starts, collapsing to 0 once settled — this
  // is the whole reveal. Previously x AND y were both scaled by loadProgress,
  // which stacked every tile at dead-centre and let them fly outward toward
  // their own resting angle (left tiles left, right tiles right, bottom
  // tiles down) — that's what read as "coming up from the sides". Now every
  // tile sits at its final x from frame one and only travels vertically.
  const rise = (1 - eased) * radius * 0.6;
  const projectedPoints = [];
  let closestIndex = 0;
  let closestDepth = -Infinity;

  // Camera distance for the perspective divide below. Was 2.75, which gave
  // the nearest tile ~2.1x the perspective multiplier of the farthest one —
  // strong enough that the front tile visibly ballooned forward while
  // everything else swung around IT, so the eye read that tile as the pivot
  // instead of the sphere's actual center. Pulled back to 4.5 (~1.6x
  // near/far spread) so the whole cluster reads as one rigid body orbiting
  // its own center; still enough spread to keep the 3D depth cue.
  const CAMERA_DISTANCE = 4.5;

  // Half-width of the static .scene-badge mark sitting in the hub. Read from
  // the live element (cached in resizeSceneWeb, not measured every frame) so
  // it tracks styles.css's `width: calc(var(--sphere) * ...)` through every
  // breakpoint instead of a second hard-coded ratio going stale at one of them.
  const BADGE_HALF_WIDTH = cachedBadgeHalfWidth;
  // Half-width of a tile at JS scale 1 (var(--tile) = sphere*0.21, so half
  // is sphere*0.105 = radius*0.21).
  const TILE_HALF_WIDTH = radius * 0.21;
  // Keeping every tile off dead-center (the earlier HUB_RADIUS push) reads
  // as the whole sphere being anchored to that one fixed point — not what
  // was wanted. Most covers are free to pass in front of/behind the badge
  // like any other point on the sphere now. Only the two specific covers
  // that were photographed sitting on top of the badge (Fixing/image copy
  // 4.png: Mama Mia in front, Drippin Funk behind) get pushed clear.
  const KEEP_CLEAR_OF_BADGE = new Set(["cover-20-mama-mia.jpg", "cover-21-drippin-funk.jpg"]);

  // The badge sits dead center on screen always — it's the sphere's own
  // polar axis (0,0,1), and rotatePoint() swings a pole's x/y out toward the
  // rim at 90° yaw same as any other point (that's correct sphere math, but
  // it read as the mark drifting off to the edge, not "locked to the globe").
  // What we actually want is a point that spins in place, front-to-back,
  // without leaving the hub — so only its z (depth) comes from rotatePoint;
  // x/y stay pinned at center (plus the same intro "rise" every tile gets).
  let badgeX = 0;
  let badgeY = rise;
  if (sceneBadge) {
    const bp = rotatePoint(badgePoint, currentRotationX, currentRotationY, currentRotationZ);
    const bPerspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - bp.z);
    const bScale = (0.80 + bPerspective * 0.2) * (0.55 + eased * 0.45);
    // No depth-based fade here — the badge's x/y are pinned to center (it
    // never actually travels to the back of the sphere), so fading it by
    // simulated z alone vanished it in place for no visible reason. The
    // z-index below already lets real cards occlude it when they're in
    // front; that's the only "hidden" state that should exist.
    const bOpacity = eased;

    sceneBadge.style.transform = `translate3d(calc(-50% + ${badgeX}px), calc(-50% + ${badgeY}px), 0) scale(${bScale})`;
    sceneBadge.style.opacity = String(bOpacity);

    const badgeZIndex = Math.round((bp.z + 1) * 500);
    if (lastBadgeZIndex !== badgeZIndex) {
      lastBadgeZIndex = badgeZIndex;
      sceneBadge.style.zIndex = String(badgeZIndex);
    }
  }

  nodes.forEach((node, index) => {
    const point = rotatePoint(points[index], currentRotationX, currentRotationY, currentRotationZ);
    const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - point.z);
    // 0.20, was 0.25 (and 0.80 base, was 0.5) — the old range (0.70-0.82 once
    // multiplied through) never let a cover reach its own --tile size on
    // screen. Raised so the near/far spread still reads as depth (perspective
    // spans 0.818-1.286 at CAMERA_DISTANCE=4.5) but tiles land close to 1:1.
    const scale = (0.80 + perspective * 0.2) * (0.55 + eased * 0.45);

    // Rim de-crowding: projected radius r (0..1) remapped to r^SPREAD, which
    // is >= r for r in [0,1] — pulls mid/outer points outward while pinning
    // the center (r=0) and the silhouette (r=1). Counters how the sphere's
    // even surface distribution (see goldenAngle above) still bunches up
    // visually once foreshortened by the projection below.
    const SPREAD = 0.82;
    const r = Math.hypot(point.x, point.y);
    const spread = r > 0.0001 ? Math.pow(r, SPREAD) / r : 1;

    let x = point.x * spread * radius * perspective;
    let y = point.y * spread * radius * perspective;

    if (KEEP_CLEAR_OF_BADGE.has(catalogue[index].file)) {
      // activeIndex still holds last frame's closest tile (this frame's
      // isn't known until after this loop) — a one-frame lag that's never
      // visible, and the same value projectedPoints.active uses below.
      const isActive = index === activeIndex;
      // .cover-node.is-active/:hover scales the inner img by 1.18x in CSS,
      // on top of this translate/scale — account for it here too, or this
      // tile could still grow into the badge post-hoc when it goes active.
      const tileHalfWidth = TILE_HALF_WIDTH * scale * (isActive ? 1.18 : 1);
      const hubRadius = tileHalfWidth + BADGE_HALF_WIDTH;
      // Distance from the badge's own live position now, not the origin —
      // the badge is a moving sphere point too (see badgeX/badgeY above).
      const dx = x - badgeX;
      const dy = y - badgeY;
      const distFromCenter = Math.hypot(dx, dy);
      if (distFromCenter < hubRadius) {
        if (distFromCenter > 0.01) {
          const push = hubRadius / distFromCenter;
          x = badgeX + dx * push;
          y = badgeY + dy * push;
        } else {
          // Point landed essentially exactly on the badge's axis — no
          // stable direction to push along, so fall back to this tile's
          // own fixed golden-angle bearing rather than have it jitter
          // frame to frame.
          const bearing = index * goldenAngle;
          x = badgeX + Math.cos(bearing) * hubRadius;
          y = badgeY + Math.sin(bearing) * hubRadius;
        }
      }
    }
    y += rise;
    // Was 0.28 base / 0.46 depth swing / 0.36 flat add — back tiles floored
    // at 0.34, bright enough to visually compete with the front cover sitting
    // in front of them. Widened the swing so the back hemisphere goes quiet
    // (front z=1 -> ~1.0, equator z=0 -> ~0.58, back z=-0.6 -> ~0.21).
    const opacity = (0.16 + Math.max(point.z, -0.6) * 0.62 + 0.42) * eased;
    const roll = currentRotationZ * 0.08 + point.x * 6;

    node.style.transform = `translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale}) rotate(${roll}deg)`;
    node.style.opacity = String(Math.max(0.05, Math.min(1, opacity)));

    // z-index is NOT a compositor-only property — writing it every frame
    // forces the browser to re-resolve paint/stacking order for all 25
    // siblings, on every single frame, even when the front-to-back order
    // hasn't actually changed. Skip the write unless the rounded value moved.
    const zIndexValue = Math.round((point.z + 1) * 500);
    if (lastZIndex[index] !== zIndexValue) {
      lastZIndex[index] = zIndexValue;
      node.style.zIndex = String(zIndexValue);
    }

    projectedPoints.push({
      x: cachedSceneOffsetLeft + x,
      y: cachedSceneOffsetTop + y,
      z: point.z,
      active: index === activeIndex,
    });

    if (point.z > closestDepth) {
      closestDepth = point.z;
      closestIndex = index;
    }
  });

  setActiveCover(closestIndex);

  if (webContext && projectedPoints.length && loadProgress > 0.05) {
    webContext.clearRect(0, 0, webWidth, webHeight);
    webContext.lineCap = "round";
    const activeGlow = coverGlow[activeIndex] || FALLBACK_GLOW;

    // Full n^2 pairing (~300 stroke() calls for 25 nodes) is the costliest
    // part of this render. On coarse-pointer devices only pair each node
    // with its next few neighbours in draw order — visually still a dense
    // web (points are already spread by the golden-angle layout, so nearby
    // indices are nearby in space) but a fraction of the stroke calls.
    const neighbourSpan = isCoarsePointer ? 4 : projectedPoints.length;

    projectedPoints.forEach((point, index) => {
      const end = Math.min(index + neighbourSpan, projectedPoints.length);
      for (let nextIndex = index + 1; nextIndex < end; nextIndex += 1) {
        const nextPoint = projectedPoints[nextIndex];
        const dx = point.x - nextPoint.x;
        const dy = point.y - nextPoint.y;
        const distance = Math.hypot(dx, dy);
        const averageDepth = (point.z + nextPoint.z) / 2;

        if (distance > radius * 0.72 || averageDepth < -0.42) continue;

        const isActiveConnection = point.active || nextPoint.active;
        // Alpha floor was 0.24/0.42 — with covers now ~30% bigger the web's
        // exposed (non-occluded) segments read as clutter across the
        // artwork at that floor. Dropped so the web stays a quiet backdrop.
        const alpha = Math.max(
          isActiveConnection ? 0.3 : 0.14,
          Math.min(0.88, (1.18 + averageDepth) * (1 - distance / (radius * 0.78)) * (isActiveConnection ? 0.82 : 0.6))
        ) * loadProgress;

        webContext.beginPath();
        webContext.moveTo(point.x, point.y);
        webContext.lineTo(nextPoint.x, nextPoint.y);
        webContext.strokeStyle = isActiveConnection
          ? `rgba(${activeGlow}, ${alpha})`
          : `rgba(220, 221, 225, ${alpha * 0.8})`;
        webContext.lineWidth = isActiveConnection ? 2.6 : 1.3;
        webContext.stroke();
      }
    });

    projectedPoints.forEach((point) => {
      if (point.z < -0.38) return;
      webContext.beginPath();
      webContext.arc(point.x, point.y, point.active ? 3.6 : 1.8, 0, Math.PI * 2);
      webContext.fillStyle = point.active
        ? `rgba(${activeGlow}, 0.9)`
        : "rgba(220, 221, 225, 0.35)";
      webContext.fill();
    });
  }

  renderLoopId = sceneVisible ? requestAnimationFrame(render) : null;
};

// The sphere sits well down the page now, so its rAF loop only needs to run
// while it's actually on screen — pause it the rest of the time instead of
// spinning 25 nodes + the web canvas for a section nobody can see.
//
// Starts false: the observer is the sole starter of the loop (see the
// bottom of this file, where the old code also called render() once
// unconditionally). That bare extra call used to run ahead of the
// observer's first async callback, burning real reveal time — dt-scaled
// per Fix 5 — against a globe nobody could see yet. On a slow main thread
// loadProgress could reach 1 before the user ever scrolled to it, so some
// visitors never saw the entrance at all.
let sceneVisible = false;
let renderLoopId = null;

const sceneVisibilityObserver = new IntersectionObserver(
  ([entry]) => {
    sceneVisible = entry.isIntersecting;
    if (sceneVisible && renderLoopId === null) {
      resizeSceneWeb();
      // Force a fresh dt baseline — otherwise the elapsed time since the
      // loop last stopped (potentially minutes, if the user scrolled away
      // and back) would be clamped but still stale relative to now.
      lastFrameTime = 0;
      renderLoopId = requestAnimationFrame(render);
    }
  },
  { threshold: 0.01 }
);
sceneVisibilityObserver.observe(scene);

// ---------- pointer interaction ----------

// Drag only starts when the press actually lands on the sphere's own hit-box
// (.scene-inner, CSS touch-action: none). .scene itself is much taller than
// the sphere (room for the connecting-web canvas + layout breathing room),
// and stays touch-action: pan-y — so a touch that lands in that surrounding
// space (not on the globe) falls through here and scrolls the page normally
// instead of being grabbed.
scene.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (!event.target.closest("#sceneInner")) return;
  isDragging = true;
  dragMoved = 0;
  startX = event.clientX;
  startY = event.clientY;
  startRotationX = targetRotationX;
  startRotationY = targetRotationY;
  scene.classList.add("is-dragging");
  scene.setPointerCapture(event.pointerId);
});

// How many degrees one screen pixel of drag is worth. Derived from the
// sphere's own on-screen radius so the point under the cursor stays under
// the cursor at any viewport size, instead of the old fixed 0.24/0.2
// constants (tuned for one screen size, then patched with a separate 1.6x
// multiplier for touch — three magic numbers standing in for one fact about
// the sphere's geometry).
const MAX_PITCH = 72;
const clampPitch = (value) => Math.min(MAX_PITCH, Math.max(-MAX_PITCH, value));
const degreesPerPixel = () => (sphereRadius > 0 ? 57.29578 / sphereRadius : 0.2);

scene.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dragX = event.clientX - startX;
  const dragY = event.clientY - startY;

  dragMoved = Math.max(dragMoved, Math.hypot(dragX, dragY));
  // Direct 1:1-feeling mapping, no momentum: drag right spins right, drag
  // down brings the content down, and rotation stops the instant the
  // pointer stops. (Vertical used to be inverted relative to horizontal —
  // dragging down raised the content — which combined with the axis-order
  // bug in rotatePoint() to make "up" depend on which way the globe
  // happened to be facing.)
  const degPerPx = degreesPerPixel();
  targetRotationY = startRotationY + dragX * degPerPx;
  targetRotationX = clampPitch(startRotationX - dragY * degPerPx);
});

const finishDrag = (event) => {
  if (!isDragging) return;
  isDragging = false;
  scene.classList.remove("is-dragging");
  if (event.pointerId !== undefined && scene.hasPointerCapture(event.pointerId)) {
    scene.releasePointerCapture(event.pointerId);
  }

  // A near-stationary press+release counts as a click on whatever node is under the pointer.
  // Touch taps jitter more than a mouse click, so give them a looser tolerance.
  const clickTolerance = event.pointerType === "touch" ? 10 : 6;
  if (dragMoved < clickTolerance) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const node = target?.closest(".cover-node");
    if (node) {
      openDetail(Number(node.dataset.index));
    }
  }
};

scene.addEventListener("pointerup", finishDrag);
scene.addEventListener("pointercancel", finishDrag);
scene.addEventListener("lostpointercapture", finishDrag);

// Shared by the keyboard arrows and the on-screen arrow buttons, so a tap
// on a button eases the same way a keypress does.
const rotateStep = (deltaX, deltaY) => {
  targetRotationX = clampPitch(targetRotationX + deltaX);
  targetRotationY += deltaY;
};

// Arrow keys only spin the sphere when focus is actually inside it (or the
// detail lightbox is open over it) — anywhere else on the page they do their
// normal job, which on a scrolling page means scrolling.
document.addEventListener("keydown", (event) => {
  const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown";
  if (!isArrow && event.key !== "Enter") return;

  const targetTag = event.target.tagName;
  if (targetTag === "INPUT" || targetTag === "TEXTAREA" || event.target.isContentEditable) return;

  // With the detail overlay open, left/right step to the previous/next
  // piece instead of spinning the (hidden) sphere behind it.
  if (overlays.detail?.classList.contains("is-open")) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (currentDetailIndex < 0) return;
      const next =
        event.key === "ArrowRight"
          ? (currentDetailIndex + 1) % catalogue.length
          : (currentDetailIndex - 1 + catalogue.length) % catalogue.length;
      openDetail(next);
    }
    return;
  }

  // Nothing to do with the sphere unless it (or something inside it, like a
  // focused cover-node) is the actual focus target.
  if (document.activeElement !== scene && !scene.contains(document.activeElement)) return;

  const step = 6;
  if (event.key === "ArrowLeft") {
    rotateStep(0, -step);
  } else if (event.key === "ArrowRight") {
    rotateStep(0, step);
  } else if (event.key === "ArrowUp") {
    // Matches drag: Up raises the content, Down lowers it.
    rotateStep(step, 0);
  } else if (event.key === "ArrowDown") {
    rotateStep(-step, 0);
  } else if (event.key === "Enter") {
    // A focused cover-node/button handles its own Enter via the native
    // click it fires; only open the active piece when the scene itself has
    // focus.
    if (event.target === scene) openDetail(activeIndex);
    return;
  } else {
    return;
  }
  event.preventDefault();
});

// Pointer clicks are already opened by the drag-distance check in finishDrag
// above. This click listener is what makes keyboard activation (Enter/Space
// on a focused button) work; calling openDetail twice for a pointer click is
// harmless since it just re-renders the same content.
nodes.forEach((node, index) => {
  node.addEventListener("click", () => openDetail(index));
});

// ---------- overlays ----------
// About/Artists/Contact are inline page sections now — only the cover
// detail lightbox still needs the open/close overlay treatment.

const overlays = {
  detail: document.querySelector("#detailOverlay"),
};

const contactSection = document.querySelector("#contact");

// ---------- flickering grid (contact footer background) ----------
// Vanilla-JS take on magicui's FlickeringGrid, scoped to #workGrid. Runs
// only while the footer is actually scrolled into view (see the
// IntersectionObserver wiring below), not tied to an overlay open/close
// anymore.

const workGrid = (() => {
  const canvas = document.querySelector("#workGrid");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;

  const SQUARE_SIZE = 4;
  const GRID_GAP = 6;
  const GLOW_RGB = "224, 27, 27"; // --xst-red, matches the sitewide glow
  const MAX_OPACITY = 0.5;
  const FLICKER_CHANCE = 0.1;

  let cols = 0;
  let rows = 0;
  let opacities = new Float32Array(0);
  let dpr = window.devicePixelRatio || 1;
  let rafId = null;
  let lastTime = 0;

  const resize = () => {
    if (!contactSection) return;
    const rect = contactSection.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, isCoarsePointer ? 1.5 : 3);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const cell = SQUARE_SIZE + GRID_GAP;
    cols = Math.ceil(rect.width / cell) + 1;
    rows = Math.ceil(rect.height / cell) + 1;
    opacities = new Float32Array(cols * rows).map(() => Math.random() * MAX_OPACITY);
  };

  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const cell = (SQUARE_SIZE + GRID_GAP) * dpr;
    const size = SQUARE_SIZE * dpr;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const opacity = opacities[i * rows + j];
        context.fillStyle = `rgba(${GLOW_RGB}, ${opacity.toFixed(3)})`;
        context.fillRect(i * cell, j * cell, size, size);
      }
    }
  };

  const tick = (time) => {
    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
    lastTime = time;

    for (let k = 0; k < opacities.length; k++) {
      if (Math.random() < FLICKER_CHANCE * dt * 60) {
        opacities[k] = Math.random() * MAX_OPACITY;
      }
    }

    draw();
    rafId = requestAnimationFrame(tick);
  };

  window.addEventListener("resize", () => {
    if (rafId) resize();
  });

  return {
    start() {
      resize();
      if (reduceMotion) {
        draw(); // one static frame, no loop
        return;
      }
      lastTime = 0;
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
})();

const detailImg = document.querySelector("#detailImg");
const detailEyebrow = document.querySelector("#detailEyebrow");
const detailTitle = document.querySelector("#detailTitle");
const detailNote = document.querySelector("#detailNote");
const detailSpecs = document.querySelector("#detailSpecs");
const detailCta = document.querySelector("#detailCta");
const filmstrip = document.querySelector("#filmstrip");
const detailSide = document.querySelector("#detailSide");

const spotifyCard = detailSide && window.XSTSpotifyCard
  ? window.XSTSpotifyCard.create(detailSide, {
      onPrev: () => document.querySelector("#detailPrev")?.click(),
      onNext: () => document.querySelector("#detailNext")?.click(),
    })
  : null;

// Lets the sticky mini-player (spotify-card.js) reopen the cover whose
// track is still playing after the detail overlay was closed.
if (window.__xstSpotifyEmbed) {
  window.__xstSpotifyEmbed.reopenDetail = () => {
    if (currentDetailIndex >= 0) openDetail(currentDetailIndex);
  };
}

let lastFocusedNode = null;

const thumbs = catalogue.map((item, index) => {
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy"; // set before src, see the note in the node-build loop above
  img.decoding = "async";
  img.src = `assets/covers/thumb/${item.file}`;
  img.tabIndex = 0;
  img.setAttribute("role", "option");
  img.setAttribute("aria-label", item.title || `Untitled — ${item.id}`);
  img.addEventListener("click", () => openDetail(index));
  img.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(index);
    }
  });
  filmstrip.appendChild(img);
  return img;
});

function openOverlay(name, triggerNode) {
  const overlay = overlays[name];
  if (!overlay) return;
  lastFocusedNode = triggerNode || document.activeElement;
  overlay.classList.add("is-open");
  overlay.setAttribute("aria-hidden", "false");
  overlay.querySelector(".overlay-close")?.focus();
}

function closeOverlay(name) {
  const overlay = overlays[name];
  if (!overlay) return;
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  lastFocusedNode?.focus();
}

// Keeps Tab/Shift+Tab cycling inside whichever overlay is open instead of
// leaking into the page underneath — the overlay visually covers the whole
// viewport (see .overlay in styles.css), but without this the rest of the
// page (nav, sphere, footer) stays in the natural tab order behind it, so a
// keyboard user could tab focus onto controls they can't see.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"]), input, select, textarea, iframe';

document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab") return;
  const openOverlayEl = Object.values(overlays).find((overlay) =>
    overlay?.classList.contains("is-open")
  );
  if (!openOverlayEl) return;

  const focusable = [...openOverlayEl.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (el) => el.offsetParent !== null
  );
  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!openOverlayEl.contains(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
});

// The footer's flickering grid + letter-magnify effect used to start/stop
// with the contact overlay opening and closing; now they run whenever the
// footer is actually scrolled into view.
if (contactSection) {
  const contactVisibilityObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        workGrid?.start();
        letterMagnet?.start();
      } else {
        workGrid?.stop();
        letterMagnet?.stop();
      }
    },
    { threshold: 0.01 }
  );
  contactVisibilityObserver.observe(contactSection);
}

let currentDetailIndex = -1;
// Bumped on every openDetail() call. A pending full-size load compares its
// own token against the current one before writing anything — if the user
// has already arrowed on to a different cover, a slow-to-resolve earlier
// load just quietly drops instead of overwriting detailSpecs (or the image)
// with stale data. The old code had no such guard: rapid prev/next fired
// overlapping un-cancelled loads, and whichever resolved last won, right or
// wrong.
let detailToken = 0;

// The globe/filmstrip already fetched and decoded this cover's thumb, so
// painting it first is free and instant. The full-size (175-450KB, never
// preloaded) loads in the background and is swapped in only once it's fully
// decoded — so the overlay never shows the previous cover's artwork under
// the new title, which is what "it grabs the image [wrong]" was.
function setDetailImage(item) {
  const token = ++detailToken;
  const thumbSrc = `assets/covers/thumb/${item.file}`;
  const fullSrc = `assets/covers/${item.file}`;

  detailImg.src = thumbSrc;
  detailImg.alt = item.title || `Untitled — ${item.id}`;
  detailImg.classList.add("is-provisional");
  detailSpecs.textContent = "Loading specs…";

  const settle = (specs) => {
    if (token !== detailToken) return; // a later openDetail() already won
    detailImg.classList.remove("is-provisional");
    detailSpecs.textContent = specs;
  };

  const full = new Image();
  full.decoding = "async";
  full.onerror = () => settle("JPG");
  full.onload = () => {
    const swap = () => {
      if (token !== detailToken) return;
      detailImg.src = fullSrc; // already fetched + decoded — paints with no gap
      settle(`${full.naturalWidth} × ${full.naturalHeight} · JPG`);
    };
    full.decode ? full.decode().then(swap, swap) : swap();
  };
  full.src = fullSrc;

  return thumbSrc;
}

function openDetail(index) {
  const item = catalogue[index];
  if (!item) return;

  currentDetailIndex = index;

  const thumbSrc = setDetailImage(item);
  detailEyebrow.textContent = `${item.id} · ${item.kind.toUpperCase()}`;
  setAccentTitle(detailTitle, item.title || `Untitled — ${item.id}`);
  detailNote.textContent = item.note || "";
  detailCta.textContent = "Commission a cover like this";

  spotifyCard?.update({
    title: item.title || `Untitled — ${item.id}`,
    artist: item.note || "XST",
    duration: item.duration || 180,
    albumArt: thumbSrc,
    spotify: item.spotify || "",
    spotifyId: item.spotifyId || "",
  });

  thumbs.forEach((thumb, i) => {
    thumb.classList.toggle("is-active", i === index);
    thumb.setAttribute("aria-selected", String(i === index));
  });

  // Stepping with the prev/next arrows swaps the content in place — only a
  // fresh open (from the sphere or filmstrip) should re-focus and re-animate
  // the overlay.
  if (overlays.detail?.classList.contains("is-open")) return;
  openOverlay("detail", nodes[index]);
}

document.querySelector("#detailPrev")?.addEventListener("click", () => {
  if (currentDetailIndex < 0) return;
  openDetail((currentDetailIndex - 1 + catalogue.length) % catalogue.length);
});

document.querySelector("#detailNext")?.addEventListener("click", () => {
  if (currentDetailIndex < 0) return;
  openDetail((currentDetailIndex + 1) % catalogue.length);
});

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => closeOverlay(button.dataset.close));
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  Object.entries(overlays).forEach(([name, overlay]) => {
    if (overlay.classList.contains("is-open")) closeOverlay(name);
  });
});

// The artist coverflow (data read from #artistsData) now lives entirely in
// carousel.js.

// ---------- nav ----------
//
// Sticky nav's links are plain #hash anchors — the browser does the
// scrolling. The only JS job left is marking which section is current as
// the page scrolls past it.

const siteNav = document.querySelector("#siteNav");
if (siteNav) {
  const NAV_SCROLL_THRESHOLD = 24;
  const updateNavScrollState = () => {
    siteNav.classList.toggle("is-scrolled", window.scrollY > NAV_SCROLL_THRESHOLD);
  };
  updateNavScrollState();
  window.addEventListener("scroll", updateNavScrollState, { passive: true });
}

const navLinks = [...document.querySelectorAll(".site-nav a[href^='#']")];
const navSections = navLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if (navLinks.length && navSections.length) {
  const setActiveNavLink = (id) => {
    navLinks.forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${id}`);
    });
  };

  const navObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveNavLink(visible.target.id);
    },
    { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
  );
  navSections.forEach((section) => navObserver.observe(section));
}

// render() is started solely by the IntersectionObserver above once the
// sphere actually enters the viewport — see the sceneVisible comment there.

// ---------- custom cursor (mouse-with-hover devices only) ----------
//
// Hovering the sphere swaps the pointer for a filled "Drag" bubble; hovering
// a specific cover swaps the label to "View". The bubble eases toward the
// real pointer position rather than snapping to it, which is what reads as
// motion rather than a static badge.

const cursorDot = document.querySelector("#cursorDot");
const cursorLabel = cursorDot?.querySelector(".cursor-label");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

if (cursorDot && finePointer && !reduceMotion) {
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let renderXPos = pointerX;
  let renderYPos = pointerY;

  window.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    pointerX = event.clientX;
    pointerY = event.clientY;

    const overScene = Boolean(event.target.closest("#scene"));
    const overNode = Boolean(event.target.closest(".cover-node"));

    cursorDot.classList.toggle("is-visible", overScene);
    cursorDot.classList.toggle("is-dragmode", overScene && !overNode);
    cursorDot.classList.toggle("is-nodehover", overNode);
    if (cursorLabel) cursorLabel.textContent = overNode ? "View" : "Drag";
    scene.classList.toggle("has-custom-cursor", overScene);
  });

  document.addEventListener("pointerout", (event) => {
    if (event.pointerType !== "mouse" || event.relatedTarget) return;
    cursorDot.classList.remove("is-visible");
    scene.classList.remove("has-custom-cursor");
  });

  const renderCursor = () => {
    renderXPos += (pointerX - renderXPos) * 0.22;
    renderYPos += (pointerY - renderYPos) * 0.22;
    cursorDot.style.transform = `translate3d(${renderXPos}px, ${renderYPos}px, 0)`;
    requestAnimationFrame(renderCursor);
  };
  renderCursor();
}

// ---------- letter hover magnify (mouse-with-hover devices only) ----------
//
// Splits a heading's text into per-glyph spans so a pointer-distance scale
// can ride on top of it — dock-style magnification. Shared by the footer's
// "Let's work together.", the "Catalog impact" eyebrow, and the hero
// headline. wrapLetters() is idempotent (skips text already under a
// .letter span) so it's safe to call again after something downstream
// (word-cycle.js) drops fresh plain text into the subtree.

function wrapLetters(container) {
  if (!container) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentNode?.classList?.contains("letter")) continue;
    // The cycling payoff word (word-cycle.js) paints one continuous diagonal
    // shine across its own full text run via background-clip:text. Splitting
    // that into per-letter spans gives each letter its own copy of the
    // gradient instead of one sweep across the word — reads as a repeated
    // white streak/barcode rather than a single blended highlight. Leave it
    // as plain text; it already animates on its own each swap.
    if (node.parentNode?.classList?.contains("cycle-word")) continue;
    // Skip nodes with no non-space character — rewrapping these is a no-op
    // that would still trigger a childList mutation for nothing.
    if (![...node.textContent].some((char) => char !== " ")) continue;
    textNodes.push(node);
  }
  textNodes.forEach((textNode) => {
    const frag = document.createDocumentFragment();
    [...textNode.textContent].forEach((char) => {
      if (char === " ") {
        frag.appendChild(document.createTextNode(" "));
        return;
      }
      const span = document.createElement("span");
      span.className = "letter";
      span.textContent = char;
      frag.appendChild(span);
    });
    textNode.replaceWith(frag);
  });
}

function createLetterMagnet(container, options) {
  if (!container || !finePointer || reduceMotion) return null;
  const RADIUS = options?.radius ?? 120;
  const MAX_SCALE = options?.maxScale ?? 1.28;
  const EASE = options?.ease ?? 0.16;

  const scaleByLetter = new WeakMap();
  let pointerX = null;
  let pointerY = null;
  let rafId = null;

  const onMove = (event) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
  };
  const onLeave = () => {
    pointerX = null;
    pointerY = null;
  };

  const tick = () => {
    container.querySelectorAll(".letter").forEach((el) => {
      let entry = scaleByLetter.get(el);
      if (!entry) {
        entry = { current: 1, target: 1 };
        scaleByLetter.set(el, entry);
      }
      if (pointerX === null) {
        entry.target = 1;
      } else {
        const rect = el.getBoundingClientRect();
        const dx = pointerX - (rect.left + rect.width / 2);
        const dy = pointerY - (rect.top + rect.height / 2);
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) / RADIUS);
        entry.target = 1 + falloff * falloff * (MAX_SCALE - 1);
      }
      entry.current += (entry.target - entry.current) * EASE;
      el.style.transform = `scale(${entry.current.toFixed(3)})`;
    });
    rafId = requestAnimationFrame(tick);
  };

  return {
    start() {
      document.addEventListener("pointermove", onMove);
      container.addEventListener("pointerleave", onLeave);
      if (!rafId) rafId = requestAnimationFrame(tick);
    },
    stop() {
      document.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerleave", onLeave);
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      pointerX = null;
      pointerY = null;
      container.querySelectorAll(".letter").forEach((el) => {
        el.style.transform = "";
      });
    },
  };
}

const workTitle = document.querySelector(".work-title");
wrapLetters(workTitle);
const letterMagnet = createLetterMagnet(workTitle);

// "Catalog impact" eyebrow only — the "Cover art" eyebrow further down
// keeps the plain static look. Sits in the always-visible hero, so it
// just runs from load rather than waiting on a scroll observer.
const impactEyebrow = document.querySelector(".impact-lead-head .section-eyebrow");
wrapLetters(impactEyebrow);
const impactEyebrowMagnet = createLetterMagnet(impactEyebrow);
impactEyebrowMagnet?.start();

// Same treatment for the panel's other headers — the per-stat labels
// ("Covers shipped" / "Best-performing cover..."). Static text, no
// runtime rewrites, so wrap once and go.
document.querySelectorAll(".impact-stat-label").forEach((label) => {
  wrapLetters(label);
  createLetterMagnet(label)?.start();
});

// Hero headline — has to wait for lines.js (per-line split) and
// word-cycle.js (payoff-word rotator) to finish setting up the DOM first,
// otherwise wrapping letters now gets wiped the moment either of those
// rebuilds the heading. index.html dispatches "xst:hero-ready" right after
// both have run. wrapLetters() itself skips the cycling payoff word (see
// its "cycle-word" check above), so nothing here needs to re-run later.
const heroHeading = document.querySelector(".hero-heading");
if (heroHeading) {
  document.addEventListener(
    "xst:hero-ready",
    () => {
      wrapLetters(heroHeading);
      createLetterMagnet(heroHeading)?.start();

      // The cycling payoff word's box is min-width-locked to the WIDEST
      // variant (word-cycle.js's reserveWidth) so swapping to a longer word
      // never reflows the line — but that means every word, short or long,
      // sits in the same fixed-width box. --metal-cycle's background-image
      // stretches to that box (background-size:100% 100%), so a short word
      // like "see." only ever shows the image's dark left edge; the bright
      // band further along the image never falls under its glyphs. Size the
      // background to each word's own rendered width instead so the full
      // image sweep — dark to bright to dark — always lands on the text.
      const cycleWord = heroHeading.querySelector(".cycle-word");
      if (cycleWord) {
        const sizeSheenToWord = () => {
          const probe = cycleWord.cloneNode(false);
          probe.style.position = "absolute";
          probe.style.visibility = "hidden";
          probe.style.left = "-9999px";
          probe.style.minWidth = "0";
          probe.style.display = "inline-block";
          probe.textContent = cycleWord.textContent;
          // Appended inside heroHeading, not document.body — font-size,
          // font-weight, text-transform and letter-spacing all come from
          // .hero-heading via inheritance, so measuring outside that
          // subtree gives back the tiny default-font width instead of the
          // real rendered glyph width.
          heroHeading.appendChild(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          if (width > 0) {
            const w = `${Math.ceil(width)}px 100%`;
            // Six layers in page.css's .is-cycling order: grain, vignette,
            // bloom A, bloom B, sheen, base (see --metal-cycle, styles.css).
            // backgroundSize/backgroundPosition are shorthands — setting
            // them to a single value applies that value to EVERY layer,
            // which used to blow away the grain's fixed 96px tile and
            // stretch it into a horizontal smear across the whole word box.
            // The grain (first layer) stays untouched; only the
            // width-dependent layers after it get sized to the word.
            cycleWord.style.backgroundSize = `96px 96px, ${w}, ${w}, ${w}, ${w}, ${w}`;
            cycleWord.style.backgroundPosition = `center, left center, left center, left center, left center, left center`;
          }
        };
        sizeSheenToWord();
        new MutationObserver(sizeSheenToWord).observe(cycleWord, { childList: true });
      }
    },
    { once: true }
  );
}

// ---------- easter egg: hold the wordmark to spray the catalogue ----------
//
// Ported from a pasted React "CoolMode" component. Physics kept verbatim;
// the shell (React, TS, cleanup-on-unmount) is stripped since this page
// never unmounts. Particles are the actual cover art instead of the
// source's random-hue circles. Desktop only, on purpose — no touch
// listeners are ever bound, so there is no path to a spray on mobile.

const wordmark = document.querySelector(".wordmark");

// Not gated on reduceMotion: unlike the ambient idle spin and custom cursor,
// this only fires from an explicit press-and-hold gesture, never automatic.
if (wordmark && finePointer) {
  const sizes = [15, 20, 25, 35, 45];
  const limit = 45;
  const particleGenerationDelay = 30;

  let particles = [];
  let autoAddParticle = false;
  let mouseX = 0;
  let mouseY = 0;

  const getEggContainer = () => {
    const id = "_coolMode_effect";
    const existing = document.getElementById(id);
    if (existing) return existing;

    const container = document.createElement("div");
    container.id = id;
    document.body.appendChild(container);
    return container;
  };

  const eggContainer = getEggContainer();

  function generateParticle() {
    const size = sizes[Math.floor(Math.random() * sizes.length)];
    const speedHorz = Math.random() * 10;
    const speedUp = Math.random() * 25;
    const spinVal = Math.random() * 360;
    const spinSpeed = Math.random() * 35 * (Math.random() <= 0.5 ? -1 : 1);
    const top = mouseY - size / 2;
    const left = mouseX - size / 2;
    const direction = Math.random() <= 0.5 ? -1 : 1;
    const cover = catalogue[Math.floor(Math.random() * catalogue.length)];

    const particle = document.createElement("div");
    const img = document.createElement("img");
    img.src = `assets/covers/thumb/${cover.file}`;
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    img.width = size;
    img.height = size;
    img.style.borderRadius = "4px";
    img.style.display = "block";
    particle.appendChild(img);

    particle.style.position = "absolute";
    particle.style.transform = `translate3d(${left}px, ${top}px, 0px) rotate(${spinVal}deg)`;

    eggContainer.appendChild(particle);

    particles.push({
      direction,
      element: particle,
      left,
      size,
      speedHorz,
      speedUp,
      spinSpeed,
      spinVal,
      top,
    });
  }

  function refreshParticles() {
    particles.forEach((p) => {
      p.left = p.left - p.speedHorz * p.direction;
      p.top = p.top - p.speedUp;
      p.speedUp = Math.min(p.size, p.speedUp - 1);
      p.spinVal = p.spinVal + p.spinSpeed;

      if (p.top >= Math.max(window.innerHeight, document.body.clientHeight) + p.size) {
        particles = particles.filter((o) => o !== p);
        p.element.remove();
      }

      p.element.setAttribute(
        "style",
        [
          "position:absolute",
          "will-change:transform",
          `top:${p.top}px`,
          `left:${p.left}px`,
          `transform:rotate(${p.spinVal}deg)`,
        ].join(";")
      );
    });
  }

  let lastParticleTimestamp = 0;

  function eggLoop() {
    const currentTime = performance.now();
    if (
      autoAddParticle &&
      particles.length < limit &&
      currentTime - lastParticleTimestamp > particleGenerationDelay
    ) {
      generateParticle();
      lastParticleTimestamp = currentTime;
    }

    refreshParticles();
    requestAnimationFrame(eggLoop);
  }

  eggLoop();

  const updateEggPointer = (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  };

  wordmark.addEventListener("mousemove", updateEggPointer, { passive: true });
  wordmark.addEventListener(
    "mousedown",
    (event) => {
      updateEggPointer(event);
      autoAddParticle = true;
    },
    { passive: true }
  );
  wordmark.addEventListener("mouseup", () => (autoAddParticle = false), { passive: true });
  wordmark.addEventListener("mouseleave", () => (autoAddParticle = false), { passive: true });
}
