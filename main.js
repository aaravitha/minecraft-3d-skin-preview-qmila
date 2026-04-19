import { SkinViewer } from "skinview3d";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const container = document.getElementById("skin_container");
const statusEl = document.getElementById("status");
const setStatus = (m) => (statusEl.textContent = m);

const LS = { lastSkin: "sv:lastSkinDataUrl", settings: "sv:settings" };

// WebGL check
(() => {
  const c = document.createElement("canvas");
  const ok = !!(c.getContext("webgl") || c.getContext("experimental-webgl"));
  if (!ok) {
    setStatus("WebGL is blocked/disabled. Enable WebGL / hardware acceleration.");
    throw new Error("WebGL not available");
  }
})();

setStatus("Initializing…");

// Viewer
const viewer = new SkinViewer({
  width: container.clientWidth,
  height: container.clientHeight
});
container.appendChild(viewer.canvas);

viewer.background = 0x0b1020;

// Controls
const controls = new OrbitControls(viewer.camera, viewer.canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.rotateSpeed = 0.7;
controls.autoRotate = true;

// Camera (tune these)
const DEFAULT_VIEW = {
  target: { x: 0, y: 2, z: 0 },
  radius: 52,
  azimuthDeg: 0,
  polarDeg: 90,
  fov: 45
};

function setDefaultCamera() {
  viewer.fov = DEFAULT_VIEW.fov;

  const az = (DEFAULT_VIEW.azimuthDeg * Math.PI) / 180;
  const pol = (DEFAULT_VIEW.polarDeg * Math.PI) / 180;

  const r = DEFAULT_VIEW.radius;
  const { x: tx, y: ty, z: tz } = DEFAULT_VIEW.target;

  const x = tx + r * Math.sin(pol) * Math.sin(az);
  const y = ty + r * Math.cos(pol);
  const z = tz + r * Math.sin(pol) * Math.cos(az);

  viewer.camera.position.set(x, y, z);
  controls.target.set(tx, ty, tz);
  viewer.camera.lookAt(controls.target);
  controls.update();
}

function resize() {
  const r = container.getBoundingClientRect();
  viewer.setSize(Math.max(1, r.width), Math.max(1, r.height));
}
window.addEventListener("resize", resize);
resize();

// UI
const skinFile = document.getElementById("skinFile");
const bulkFiles = document.getElementById("bulkFiles");
const bulkGrid = document.getElementById("bulkGrid");
const bulkStatus = document.getElementById("bulkStatus");

const modelType = document.getElementById("modelType");
const animationSel = document.getElementById("animation");
const speedEl = document.getElementById("speed");
const zoomEl = document.getElementById("zoom");

const outerLayerToggle = document.getElementById("outerLayerToggle");
const autoRotateEl = document.getElementById("autoRotate");
const autoAdvanceSec = document.getElementById("autoAdvanceSec");
const bgColor = document.getElementById("bgColor");

const prevSkin = document.getElementById("prevSkin");
const nextSkin = document.getElementById("nextSkin");
const resetBtn = document.getElementById("resetBtn");
const resetPoseBtn = document.getElementById("resetPoseBtn");
const playPauseBtn = document.getElementById("playPauseBtn");
const screenshotBtn = document.getElementById("screenshotBtn");

// State
let animationName = animationSel.value; // idle | walk
let animSpeed = Number(speedEl.value);
let paused = false;

// remember current skin so classic/slim can reload
let currentSkinUrl = null;

// bulk
let bulk = [];
let bulkIndex = -1;
let autoAdvanceTimer = null;

// parts + poses
const parts = { head:null, body:null, leftArm:null, rightArm:null, leftLeg:null, rightLeg:null };
let basePose = null;
let straightPose = null;

const normName = (s) => String(s || "").toLowerCase();
function capturePoseFor(obj){ return {rx:obj.rotation.x, ry:obj.rotation.y, rz:obj.rotation.z, px:obj.position.x, py:obj.position.y, pz:obj.position.z}; }
function applyPoseTo(obj, pose){ obj.rotation.set(pose.rx, pose.ry, pose.rz); obj.position.set(pose.px, pose.py, pose.pz); }

function discoverParts() {
  const p = viewer.playerObject;
  if (!p) return false;

  for (const k of Object.keys(parts)) parts[k] = null;
  for (const k of Object.keys(parts)) if (p[k]) parts[k] = p[k];

  p.traverse((obj) => {
    const n = normName(obj.name);
    if (!n) return;
    if (!parts.head && n.includes("head")) parts.head = obj;
    if (!parts.body && (n === "body" || n.includes("body") || n.includes("torso"))) parts.body = obj;
    if (!parts.leftArm && (n.includes("left") && n.includes("arm"))) parts.leftArm = obj;
    if (!parts.rightArm && (n.includes("right") && n.includes("arm"))) parts.rightArm = obj;
    if (!parts.leftLeg && (n.includes("left") && n.includes("leg"))) parts.leftLeg = obj;
    if (!parts.rightLeg && (n.includes("right") && n.includes("leg"))) parts.rightLeg = obj;
  });

  return true;
}

function captureBasePose() {
  const p = viewer.playerObject;
  if (!p) return false;
  basePose = {};
  for (const k of Object.keys(parts)) if (parts[k]) basePose[k] = capturePoseFor(parts[k]);
  basePose.__root = capturePoseFor(p);
  return true;
}

function captureStraightPose() {
  if (!basePose) return false;
  straightPose = JSON.parse(JSON.stringify(basePose));
  straightPose.__root.rx = 0; straightPose.__root.ry = 0; straightPose.__root.rz = 0;
  for (const k of Object.keys(parts)) {
    if (!straightPose[k]) continue;
    straightPose[k].rx = 0; straightPose[k].ry = 0; straightPose[k].rz = 0;
  }
  return true;
}

function applyBasePose() {
  const p = viewer.playerObject;
  if (!p || !basePose) return;
  applyPoseTo(p, basePose.__root);
  for (const k of Object.keys(parts)) if (parts[k] && basePose[k]) applyPoseTo(parts[k], basePose[k]);
}

function applyStraightPose() {
  const p = viewer.playerObject;
  if (!p || !straightPose) return;
  applyPoseTo(p, straightPose.__root);
  for (const k of Object.keys(parts)) if (parts[k] && straightPose[k]) applyPoseTo(parts[k], straightPose[k]);
}

function rebuildRigAndPoses() {
  discoverParts();
  captureBasePose();
  captureStraightPose();
}

// outer layer toggle (heuristic)
function applyOuterLayerToggle() {
  const p = viewer.playerObject;
  if (!p) return;
  const showOuter = !!outerLayerToggle?.checked;

  p.traverse((obj) => {
    if (!obj.isMesh) return;
    const n = normName(obj.name);
    const isOuter =
      n.includes("outer") || n.includes("overlay") || n.includes("hat") ||
      n.includes("jacket") || n.includes("sleeve") || n.includes("pants") ||
      n.includes("layer2") || n.includes("second");
    if (isOuter) obj.visible = showOuter;
  });
}

// settings
function applyZoom() { viewer.fov = Number(zoomEl.value); }
function applyBackground() { viewer.background = parseInt(bgColor.value.slice(1), 16); }

// animation
function animateAt(tSec) {
  const p = viewer.playerObject;
  if (!p || !basePose || !straightPose) return;

  if (paused) {
    applyStraightPose();
    return;
  }

  applyBasePose();

  const t = tSec * Math.max(0, animSpeed);
  const s = Math.sin(t);

  const head = parts.head, body = parts.body, la = parts.leftArm, ra = parts.rightArm, ll = parts.leftLeg, rl = parts.rightLeg;

  const addRotX = (obj, base, v) => { if (obj && base) obj.rotation.x = base.rx + v; };
  const addRotY = (obj, base, v) => { if (obj && base) obj.rotation.y = base.ry + v; };
  const addRotZ = (obj, base, v) => { if (obj && base) obj.rotation.z = base.rz + v; };

  switch (animationName) {
    case "walk": {
      const swing = Math.sin(t * 6) * 0.9;
      addRotX(la, basePose.leftArm, swing);
      addRotX(ra, basePose.rightArm, -swing);
      addRotX(ll, basePose.leftLeg, -swing);
      addRotX(rl, basePose.rightLeg, swing);
      addRotY(body, basePose.body, Math.sin(t * 2) * 0.06);
      break;
    }
    case "idle":
    default: {
      // only head + arms
      addRotY(head, basePose.head, Math.sin(t * 1.2) * 0.12);
      addRotZ(la, basePose.leftArm, -0.05 - s * 0.06);
      addRotZ(ra, basePose.rightArm,  0.05 + s * 0.06);
      addRotX(la, basePose.leftArm,  Math.sin(t * 1.6) * 0.03);
      addRotX(ra, basePose.rightArm, -Math.sin(t * 1.6) * 0.03);
      break;
    }
  }
}

// IMPORTANT: classic/slim is applied by re-loading skin with model option
function skinModelOption() {
  return modelType.value === "slim" ? "slim" : "default";
}

async function loadSkinUrl(url) {
  setStatus("Loading skin…");
  try {
    currentSkinUrl = url;
    await viewer.loadSkin(url, { model: skinModelOption() });

    rebuildRigAndPoses();
    applyOuterLayerToggle();
    setDefaultCamera();

    setStatus(`Skin loaded (${skinModelOption()}).`);
  } catch (e) {
    console.error(e);
    setStatus("Failed to load skin (see Console).");
  }
}

async function reloadCurrentSkinWithModel() {
  if (!currentSkinUrl) return;
  await loadSkinUrl(currentSkinUrl);
}

// ---------- persistence ----------
function saveSettings() {
  const data = {
    modelType: modelType.value,
    animation: animationSel.value,
    speed: Number(speedEl.value),
    zoom: Number(zoomEl.value),
    outerLayer: !!outerLayerToggle.checked,
    autoRotate: !!autoRotateEl.checked,
    bgColor: bgColor.value
  };
  localStorage.setItem(LS.settings, JSON.stringify(data));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS.settings);
    if (!raw) return;
    const s = JSON.parse(raw);

    if (s.modelType) modelType.value = s.modelType;
    if (s.animation) animationSel.value = s.animation;
    if (typeof s.speed === "number") speedEl.value = String(s.speed);
    if (typeof s.zoom === "number") zoomEl.value = String(s.zoom);
    if (typeof s.outerLayer === "boolean") outerLayerToggle.checked = s.outerLayer;
    if (typeof s.autoRotate === "boolean") autoRotateEl.checked = s.autoRotate;
    if (typeof s.bgColor === "string") bgColor.value = s.bgColor;

    animationName = animationSel.value;
    animSpeed = Number(speedEl.value);
    controls.autoRotate = autoRotateEl.checked;
    applyZoom();
    applyBackground();
  } catch {}
}

async function saveLastSkinFromFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  localStorage.setItem(LS.lastSkin, dataUrl);
}

async function restoreLastSkinIfAny() {
  const dataUrl = localStorage.getItem(LS.lastSkin);
  if (!dataUrl) return;
  setStatus("Restoring last skin…");
  await loadSkinUrl(dataUrl);
}

// ---------- bulk helpers ----------
function stopAutoAdvance(){ if (autoAdvanceTimer) clearInterval(autoAdvanceTimer); autoAdvanceTimer = null; }
function updateBulkStatus(){
  bulkStatus.textContent = (!bulk.length || bulkIndex < 0)
    ? ""
    : `Showing ${bulkIndex + 1}/${bulk.length}: ${bulk[bulkIndex].name}`;
}
function selectThumb(i){
  const nodes = bulkGrid.querySelectorAll(".thumb");
  nodes.forEach((n) => n.classList.remove("selected"));
  if (nodes[i]) nodes[i].classList.add("selected");
}
async function showBulkIndex(i){
  if (!bulk.length) return;
  if (i < 0) i = bulk.length - 1;
  if (i >= bulk.length) i = 0;
  bulkIndex = i;
  selectThumb(i);
  updateBulkStatus();
  await loadSkinUrl(bulk[i].url);
}
function rebuildGrid(){
  bulkGrid.innerHTML = "";
  bulk.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "thumb";
    div.title = item.name;

    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;

    div.appendChild(img);
    div.addEventListener("click", () => { stopAutoAdvance(); showBulkIndex(i); });
    bulkGrid.appendChild(div);
  });
}
function startAutoAdvanceIfNeeded(){
  stopAutoAdvance();
  const sec = Number(autoAdvanceSec.value);
  if (!bulk.length || !sec || sec <= 0) return;
  autoAdvanceTimer = setInterval(() => showBulkIndex(bulkIndex + 1), sec * 1000);
}

// Buttons
function togglePlayPause() {
  paused = !paused;
  playPauseBtn.textContent = paused ? "Play animation" : "Pause animation";
  setStatus(paused ? "Paused (straight pose)." : "Animation playing.");
}
function downloadScreenshot() {
  viewer.render();
  const a = document.createElement("a");
  a.download = "skin-preview.png";
  a.href = viewer.canvas.toDataURL("image/png");
  a.click();
}

// wire events
skinFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  await saveLastSkinFromFile(file);
  await loadSkinUrl(URL.createObjectURL(file));
});

bulkFiles.addEventListener("change", async (e) => {
  stopAutoAdvance();
  const files = Array.from(e.target.files || [])
    .filter((f) => f.type === "image/png")
    .sort((a, b) => a.name.localeCompare(b.name));

  bulk.forEach((x) => URL.revokeObjectURL(x.url));
  bulk = files.map((file) => ({ name: file.webkitRelativePath || file.name, url: URL.createObjectURL(file) }));

  rebuildGrid();

  if (bulk.length) { await showBulkIndex(0); startAutoAdvanceIfNeeded(); }
  else { bulkIndex = -1; updateBulkStatus(); }
});

prevSkin.addEventListener("click", () => { stopAutoAdvance(); showBulkIndex(bulkIndex - 1); });
nextSkin.addEventListener("click", () => { stopAutoAdvance(); showBulkIndex(bulkIndex + 1); });
autoAdvanceSec.addEventListener("input", () => { startAutoAdvanceIfNeeded(); saveSettings(); });

modelType.addEventListener("change", async () => {
  saveSettings();
  await reloadCurrentSkinWithModel();
});

animationSel.addEventListener("change", () => { animationName = animationSel.value; setStatus(`Animation: ${animationName}`); saveSettings(); });
speedEl.addEventListener("input", () => { animSpeed = Number(speedEl.value); saveSettings(); });

zoomEl.addEventListener("input", () => { applyZoom(); saveSettings(); });
autoRotateEl.addEventListener("change", () => { controls.autoRotate = autoRotateEl.checked; saveSettings(); });
bgColor.addEventListener("input", () => { applyBackground(); saveSettings(); });

outerLayerToggle.addEventListener("change", () => {
  applyOuterLayerToggle();
  setStatus(outerLayerToggle.checked ? "Outer layer ON (3D layers visible)." : "Outer layer OFF (2D-style).");
  saveSettings();
});

resetBtn.addEventListener("click", () => { setDefaultCamera(); setStatus("Camera reset."); });

resetPoseBtn.addEventListener("click", () => {
  paused = true;
  playPauseBtn.textContent = "Play animation";
  applyStraightPose();
  setStatus("Pose reset (straight).");
});

playPauseBtn.addEventListener("click", togglePlayPause);
screenshotBtn.addEventListener("click", downloadScreenshot);

window.addEventListener("keydown", (e) => {
  if (!bulk.length) return;
  if (e.key === "ArrowLeft") { stopAutoAdvance(); showBulkIndex(bulkIndex - 1); }
  if (e.key === "ArrowRight") { stopAutoAdvance(); showBulkIndex(bulkIndex + 1); }
});

// defaults + restore
loadSettings();
setDefaultCamera();
applyBackground();
controls.autoRotate = autoRotateEl.checked;
setStatus("Viewer ready. Upload a skin PNG to begin.");
restoreLastSkinIfAny();

// loop
const start = performance.now();
function frame(now) {
  const t = (now - start) / 1000;
  controls.update();
  animateAt(t);
  viewer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);