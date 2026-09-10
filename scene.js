const scene = document.querySelector("#scene");
const sceneInner = document.querySelector("#sceneInner");
const sceneWeb = document.querySelector("#sceneWeb");
const indexReadout = document.querySelector("#indexReadout");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const catalogue = JSON.parse(document.querySelector("#catalogue").textContent);

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
  const ratio = window.devicePixelRatio || 1;
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
    node.style.zIndex = String(Math.round((point.z + 1) * 500));

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

    projectedPoints.forEach((point, index) => {
      for (let nextIndex = index + 1; nextIndex < projectedPoints.length; nextIndex += 1) {
        const nextPoint = projectedPoints[nextIndex];
        const dx = point.x - nextPoint.x;
        const dy = point.y - nextPoint.y;
        const distance = Math.hypot(dx, dy);
        const averageDepth = (point.z + nextPoint.z) / 2;

        if (distance > radius * 0.72 || averageDepth < -0.42) continue;

        const isActiveConnection = point.active || nextPoint.active;
        const alpha = Math.max(
          isActiveConnection ? 0.34 : 0.14,
          Math.min(0.82, (1.18 + averageDepth) * (1 - distance / (radius * 0.78)) * (isActiveConnection ? 0.78 : 0.46))
        ) * loadProgress;

        webContext.beginPath();
        webContext.moveTo(point.x, point.y);
        webContext.lineTo(nextPoint.x, nextPoint.y);
        webContext.strokeStyle = isActiveConnection
          ? `rgba(${activeGlow}, ${alpha})`
          : `rgba(220, 221, 225, ${alpha * 0.55})`;
        webContext.lineWidth = isActiveConnection ? 2.4 : 1;
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

  requestAnimationFrame(render);
};

// ---------- pointer interaction ----------

scene.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
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
  idleSpin = 0;
  scene.classList.add("is-dragging");
  scene.setPointerCapture(event.pointerId);
});

scene.addEventListener("pointermove", (event) => {
  if (!isDragging) return;
  const dragX = event.clientX - startX;
  const dragY = event.clientY - startY;
  const frameX = event.clientX - lastX;
  const frameY = event.clientY - lastY;

  dragMoved = Math.max(dragMoved, Math.hypot(dragX, dragY));
  targetRotationY = startRotationY + dragX * 0.24;
  targetRotationX = startRotationX + dragY * 0.2;
  velocityY = frameX * 0.24;
  velocityX = frameY * 0.2;
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

// Scroll tilts the sphere up/down the same way dragging left/right spins it
// sideways — no click-drag needed for the vertical axis.
scene.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    idleSpin = 0;
    velocityX = 0;
    targetRotationX += event.deltaY * 0.05;
  },
  { passive: false }
);

// Shared by the keyboard arrows and the on-screen arrow buttons, so a tap
// on a button eases the same way a keypress does.
const rotateStep = (deltaX, deltaY) => {
  idleSpin = 0;
  velocityX = 0;
  velocityY = 0;
  targetRotationX += deltaX;
  targetRotationY += deltaY;
};

// Arrow keys work anywhere on the page, not just while the sphere has
// focus — clicking into a card's own buttons (filmstrip thumb, rail pill,
// bar link) still lets that element handle its own Enter/Space normally.
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

  // With the artists overlay open, left/right step the carousel instead of
  // spinning the (hidden) sphere behind it.
  if (overlays.artists?.classList.contains("is-open")) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      stepArtist(event.key === "ArrowRight" ? 1 : -1);
    }
    return;
  }

  // Any other overlay (about/contact) open: don't fight its own controls.
  if (overlays.about?.classList.contains("is-open") || overlays.contact?.classList.contains("is-open")) return;

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
    // click it fires; only open the active piece when nothing else (or the
    // scene itself) has focus.
    if (event.target === scene || event.target === document.body) openDetail(activeIndex);
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

const overlays = {
  detail: document.querySelector("#detailOverlay"),
  about: document.querySelector("#aboutOverlay"),
  artists: document.querySelector("#artistsOverlay"),
  contact: document.querySelector("#contactOverlay"),
};

// ---------- flickering grid (contact overlay background) ----------
// Vanilla-JS take on magicui's FlickeringGrid, scoped to #workGrid so it
// only ever runs while the contact overlay is open.

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
    const rect = overlays.contact.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
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
  if (name === "contact") {
    workGrid?.start();
    letterMagnet?.start();
  }
}

function closeOverlay(name) {
  const overlay = overlays[name];
  if (!overlay) return;
  overlay.classList.remove("is-open");
  overlay.setAttribute("aria-hidden", "true");
  lastFocusedNode?.focus();
  if (name === "contact") {
    workGrid?.stop();
    letterMagnet?.stop();
  }
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
    detailSpecs.textContent = `${probe.naturalWidth} × ${probe.naturalHeight} · JPG`;
  };
  probe.src = src;

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

document.querySelectorAll("[data-open]").forEach((button) => {
  button.addEventListener("click", () => openOverlay(button.dataset.open, button));
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

// ---------- artists carousel ----------
//
// A coverflow-style strip: the active artist sits centered and sharp, the
// rest recede to either side, scaled down and dimmed. Arrow buttons, the
// keyboard (wired in above), and clicking a side card all move the same
// index; position/opacity/scale are recomputed from that one number.

const artistsDataEl = document.querySelector("#artistsData");
const artists = artistsDataEl ? JSON.parse(artistsDataEl.textContent) : [];
const artistTrack = document.querySelector("#artistTrack");
const artistIndexEl = document.querySelector("#artistIndex");
const artistNameEl = document.querySelector("#artistName");
const artistRoleEl = document.querySelector("#artistRole");
const artistNoteEl = document.querySelector("#artistNote");

let artistIndex = 0;

const artistCards = artists.map((artist, index) => {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "artist-card";
  card.dataset.index = String(index);
  card.setAttribute("role", "option");
  card.setAttribute("aria-label", artist.name);

  const img = document.createElement("img");
  img.src = artist.img;
  img.alt = "";
  img.draggable = false;
  card.appendChild(img);

  card.addEventListener("click", () => setArtistIndex(index));
  artistTrack?.appendChild(card);
  return card;
});

function layoutArtistCards() {
  const mobile = window.innerWidth <= 600;
  const spacing = mobile ? 108 : 158;
  const rotateStep = 38; // deg per position, so side cards visibly face the centered one
  const depthStep = mobile ? 90 : 130; // px pushed back into the screen per position

  artistCards.forEach((card, index) => {
    let offset = index - artistIndex;
    // Wrap around so the strip loops both directions instead of dead-ending.
    if (offset > artists.length / 2) offset -= artists.length;
    if (offset < -artists.length / 2) offset += artists.length;

    const abs = Math.abs(offset);
    const visible = abs <= 3;

    card.classList.toggle("is-active", offset === 0);
    card.style.zIndex = String(100 - abs);
    card.style.pointerEvents = visible ? "auto" : "none";
    card.style.opacity = visible ? String(1 - abs * 0.3) : "0";

    const scale = Math.max(1 - abs * 0.14, 0.42);
    const x = offset * spacing;
    const z = -abs * depthStep;
    // Rotate opposite the offset direction so left cards turn right and
    // right cards turn left — every card angles in toward the center one.
    const rotateY = Math.max(-56, Math.min(56, -offset * rotateStep));
    card.style.transform = `translate3d(calc(-50% + ${x}px), -50%, ${z}px) rotateY(${rotateY}deg) scale(${scale})`;
  });
}

function setArtistIndex(index) {
  artistIndex = ((index % artists.length) + artists.length) % artists.length;
  layoutArtistCards();

  const artist = artists[artistIndex];
  if (!artist) return;
  if (artistIndexEl) artistIndexEl.textContent = `${String(artistIndex + 1).padStart(2, "0")} / ${String(artists.length).padStart(2, "0")}`;
  if (artistNameEl) artistNameEl.textContent = artist.name;
  if (artistRoleEl) artistRoleEl.textContent = artist.role;
  if (artistNoteEl) artistNoteEl.textContent = artist.note;
}

function stepArtist(delta) {
  setArtistIndex(artistIndex + delta);
}

if (artists.length) {
  setArtistIndex(0);
  window.addEventListener("resize", layoutArtistCards);
}

document.querySelector("#artistArrowLeft")?.addEventListener("click", () => stepArtist(-1));
document.querySelector("#artistArrowRight")?.addEventListener("click", () => stepArtist(1));

// ---------- dock ----------
//
// "Cover art" closes whatever overlay is open and returns focus to the
// gallery — every piece in the catalogue is already cover art, so there is
// nothing to filter, only somewhere to come back to. Artists/Contact open
// their overlays through the generic [data-open] wiring above.

document.querySelector("#dockCover")?.addEventListener("click", () => {
  Object.keys(overlays).forEach((name) => closeOverlay(name));
  scene.focus();
});

// Magnify the hovered dock icon and taper the effect into its neighbours,
// mirroring a macOS-style dock. Distance is measured along the dock's own
// axis (vertical on desktop, horizontal on the mobile layout) so the effect
// still reads correctly after the responsive flip.
const dock = document.querySelector("#dock");
const dockItems = document.querySelectorAll(".dock-item");
const DOCK_SIZE = 40;
const DOCK_MAGNIFY = 60;
const DOCK_DISTANCE = 110;

if (dock && dockItems.length && !reduceMotion) {
  const isRowLayout = () => getComputedStyle(dock).flexDirection === "row";

  const applyMagnify = (pointerCoord) => {
    const rowLayout = isRowLayout();
    dockItems.forEach((item) => {
      const rect = item.getBoundingClientRect();
      const center = rowLayout ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      const dist = pointerCoord === null ? Infinity : Math.abs(pointerCoord - center);
      const t = Math.max(0, 1 - dist / DOCK_DISTANCE);
      const size = DOCK_SIZE + (DOCK_MAGNIFY - DOCK_SIZE) * t;
      item.style.width = `${size}px`;
      item.style.height = `${size}px`;
    });
  };

  dock.addEventListener("pointermove", (event) => {
    applyMagnify(isRowLayout() ? event.clientX : event.clientY);
  });

  dock.addEventListener("pointerleave", () => applyMagnify(null));
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
