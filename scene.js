const scene = document.querySelector("#scene");
const sceneInner = document.querySelector("#sceneInner");
const sceneWeb = document.querySelector("#sceneWeb");
const indexReadout = document.querySelector("#indexReadout");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Coarse-pointer devices (phones/tablets) are typically weaker GPUs/CPUs
// rendering at a higher devicePixelRatio, and the O(n^2) connecting-web
// lines below (~300 stroke() calls/frame for 25 nodes) is the single
// heaviest part of this scene. Cheapen both on touch devices.
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

const catalogue = JSON.parse(document.querySelector("#catalogue").textContent);

// ---------- stream counts (hero total + per-cover, both derived from
// catalogue[i].streams — never hand-typed, so they can't go stale when
// Calen adds a cover) ----------

function formatStreams(n) {
  if (!n) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

const impactTotal = document.querySelector("#impactTotal");
if (impactTotal) {
  const totalStreams = catalogue.reduce((sum, item) => sum + (item.streams || 0), 0);
  const bestCover = catalogue.reduce(
    (best, item) => ((item.streams || 0) > (best.streams || 0) ? item : best),
    catalogue[0]
  );
  const avgStreams = catalogue.length ? Math.round(totalStreams / catalogue.length) : 0;

  impactTotal.innerHTML = `${formatStreams(totalStreams)}<span>+</span>`;
  document.querySelector("#impactCovers").textContent = String(catalogue.length);
  document.querySelector("#impactBest").textContent = formatStreams(bestCover.streams || 0);
  document.querySelector("#impactBestLabel").textContent = bestCover.title
    ? `Best-performing cover · ${bestCover.title}`
    : "Best-performing cover";
  document.querySelector("#impactAvg").textContent = formatStreams(avgStreams);
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
    // Canvas sampling failed (e.g. tainted source); keep the fallback glow.
  }
};

// ---------- build cover nodes ----------

const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const points = [];
const lastZIndex = [];

const nodes = catalogue.map((item, index) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cover-node";
  button.dataset.index = String(index);
  button.setAttribute("aria-label", `Open ${item.title || "Untitled — " + item.id}`);

  const img = document.createElement("img");
  img.src = `assets/covers/thumb/${item.file}`;
  img.alt = "";
  img.draggable = false;
  img.width = 480;
  img.height = 480;
  img.loading = index < 6 ? "eager" : "lazy";
  img.decoding = "async";
  button.appendChild(img);

  sceneInner.appendChild(button);

  if (img.complete && img.naturalWidth) {
    sampleCoverGlow(img, index, button);
  } else {
    img.addEventListener("load", () => sampleCoverGlow(img, index, button), { once: true });
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
let targetRotationZ = -6;
let currentRotationX = targetRotationX;
let currentRotationY = targetRotationY;
let currentRotationZ = targetRotationZ;
let velocityX = 0;
let velocityY = 0;
let idleSpin = reduceMotion ? 0 : 0.045;

let isDragging = false;
let dragMoved = 0;
let startX = 0;
let startY = 0;
let startRotationX = 0;
let startRotationY = 0;
let lastX = 0;
let lastY = 0;
let activeIndex = -1;
let loadProgress = reduceMotion ? 1 : 0;

const rotatePoint = (point, rotationX, rotationY, rotationZ) => {
  const xRad = (rotationX * Math.PI) / 180;
  const yRad = (rotationY * Math.PI) / 180;
  const zRad = (rotationZ * Math.PI) / 180;

  let { x, y, z } = point;
  let nextY = y * Math.cos(xRad) - z * Math.sin(xRad);
  let nextZ = y * Math.sin(xRad) + z * Math.cos(xRad);
  y = nextY;
  z = nextZ;

  let nextX = x * Math.cos(yRad) + z * Math.sin(yRad);
  nextZ = -x * Math.sin(yRad) + z * Math.cos(yRad);
  x = nextX;
  z = nextZ;

  nextX = x * Math.cos(zRad) - y * Math.sin(zRad);
  nextY = x * Math.sin(zRad) + y * Math.cos(zRad);

  return { x: nextX, y: nextY, z };
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
};

resizeSceneWeb();
window.addEventListener("resize", resizeSceneWeb);

const render = () => {
  if (loadProgress < 1) {
    loadProgress = Math.min(1, loadProgress + 0.035);
  }

  if (!isDragging) {
    targetRotationY += velocityY + idleSpin;
    targetRotationX += velocityX;
    velocityX *= 0.94;
    velocityY *= 0.94;
    if (Math.abs(velocityX) < 0.001) velocityX = 0;
    if (Math.abs(velocityY) < 0.001) velocityY = 0;
  }

  currentRotationX += (targetRotationX - currentRotationX) * 0.14;
  currentRotationY += (targetRotationY - currentRotationY) * 0.14;
  currentRotationZ += (targetRotationZ - currentRotationZ) * 0.14;

  const radius = Math.min(cachedBoxWidth, cachedBoxHeight) * 0.5;
  const projectedPoints = [];
  let closestIndex = 0;
  let closestDepth = -Infinity;

  nodes.forEach((node, index) => {
    const point = rotatePoint(points[index], currentRotationX, currentRotationY, currentRotationZ);
    const perspective = 2.75 / (2.75 - point.z);
    const settle = loadProgress;
    const x = point.x * radius * perspective * settle;
    const y = point.y * radius * perspective * settle;
    const scale = (0.5 + perspective * 0.4) * (0.4 + settle * 0.6);
    const opacity = (0.28 + Math.max(point.z, -0.65) * 0.46 + 0.36) * settle;
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
        const alpha = Math.max(
          isActiveConnection ? 0.42 : 0.24,
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
let sceneVisible = true;
let renderLoopId = null;

const sceneVisibilityObserver = new IntersectionObserver(
  ([entry]) => {
    sceneVisible = entry.isIntersecting;
    if (sceneVisible && renderLoopId === null) {
      resizeSceneWeb();
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
  lastX = event.clientX;
  lastY = event.clientY;
  startRotationX = targetRotationX;
  startRotationY = targetRotationY;
  velocityX = 0;
  velocityY = 0;
  scene.classList.add("is-dragging");
  scene.setPointerCapture(event.pointerId);
});

// Touch fingers cover less screen distance per gesture than a mouse does, so
// the same degrees-per-pixel factor that feels right with a mouse reads as
// sluggish on a phone. Scale it up for coarse (touch) pointers only.
const dragSensitivity = isCoarsePointer ? 1.6 : 1;

scene.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dragX = event.clientX - startX;
  const dragY = event.clientY - startY;
  const frameX = event.clientX - lastX;
  const frameY = event.clientY - lastY;

  dragMoved = Math.max(dragMoved, Math.hypot(dragX, dragY));
  targetRotationY = startRotationY + dragX * 0.24 * dragSensitivity;
  targetRotationX = startRotationX + dragY * 0.2 * dragSensitivity;
  velocityY = frameX * 0.24 * dragSensitivity;
  velocityX = frameY * 0.2 * dragSensitivity;
  lastX = event.clientX;
  lastY = event.clientY;
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
  velocityX = 0;
  velocityY = 0;
  targetRotationX += deltaX;
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
    rotateStep(-step, 0);
  } else if (event.key === "ArrowDown") {
    rotateStep(step, 0);
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

let lastFocusedNode = null;

const thumbs = catalogue.map((item, index) => {
  const img = document.createElement("img");
  img.src = `assets/covers/thumb/${item.file}`;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.tabIndex = 0;
  img.setAttribute("role", "option");
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

function openDetail(index) {
  const item = catalogue[index];
  if (!item) return;

  currentDetailIndex = index;

  const src = `assets/covers/${item.file}`;
  detailImg.src = src;
  detailImg.alt = item.title || `Untitled — ${item.id}`;
  detailEyebrow.textContent = `${item.id} · ${item.kind.toUpperCase()}`;
  detailTitle.textContent = item.title || `Untitled — ${item.id}`;
  detailNote.textContent = item.note || "";
  detailSpecs.textContent = "Loading specs…";
  detailCta.textContent = "Commission a cover like this";

  const probe = new Image();
  probe.onload = () => {
    const streamsPart = item.streams ? ` · ${formatStreams(item.streams)} streams` : "";
    detailSpecs.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} · JPG${streamsPart}`;
  };
  probe.src = src;

  spotifyCard?.update({
    title: item.title || `Untitled — ${item.id}`,
    artist: item.note || "XST",
    duration: item.duration || 180,
    albumArt: src,
    spotify: item.spotify || "",
    spotifyId: item.spotifyId || "",
  });

  thumbs.forEach((thumb, i) => thumb.classList.toggle("is-active", i === index));

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

render();

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

// ---------- work-title hover magnify (mouse-with-hover devices only) ----------
//
// Splits the contact overlay's big display line into per-glyph spans so a
// pointer-distance scale can ride on top of it — dock-style magnification,
// only running while the contact overlay is open.

const workTitle = document.querySelector(".work-title");

if (workTitle) {
  const walker = document.createTreeWalker(workTitle, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    const frag = document.createDocumentFragment();
    [...node.textContent].forEach((char) => {
      if (char === " ") {
        frag.appendChild(document.createTextNode(" "));
        return;
      }
      const span = document.createElement("span");
      span.className = "letter";
      span.textContent = char;
      frag.appendChild(span);
    });
    node.replaceWith(frag);
  });
}

const letterMagnet = (() => {
  if (!workTitle || !finePointer || reduceMotion) return null;
  const letters = [...workTitle.querySelectorAll(".letter")];
  if (!letters.length) return null;

  const RADIUS = 120;
  const MAX_SCALE = 1.28;
  const EASE = 0.16;

  const current = letters.map(() => 1);
  const target = letters.map(() => 1);
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
    letters.forEach((el, i) => {
      if (pointerX === null) {
        target[i] = 1;
      } else {
        const rect = el.getBoundingClientRect();
        const dx = pointerX - (rect.left + rect.width / 2);
        const dy = pointerY - (rect.top + rect.height / 2);
        const falloff = Math.max(0, 1 - Math.hypot(dx, dy) / RADIUS);
        target[i] = 1 + falloff * falloff * (MAX_SCALE - 1);
      }
      current[i] += (target[i] - current[i]) * EASE;
      el.style.transform = `scale(${current[i].toFixed(3)})`;
    });
    rafId = requestAnimationFrame(tick);
  };

  return {
    start() {
      document.addEventListener("pointermove", onMove);
      workTitle.addEventListener("pointerleave", onLeave);
      if (!rafId) rafId = requestAnimationFrame(tick);
    },
    stop() {
      document.removeEventListener("pointermove", onMove);
      workTitle.removeEventListener("pointerleave", onLeave);
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      pointerX = null;
      pointerY = null;
      letters.forEach((el) => {
        el.style.transform = "";
      });
    },
  };
})();

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
