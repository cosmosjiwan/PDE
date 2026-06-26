import { EQUATIONS, getEquation } from "./equations.js?v=20260626";
import { Solver } from "./solver.js?v=20260626";

const $ = (id) => document.getElementById(id);

const canvas = $("gl");
const overlay = $("overlay-msg");

let solver;
try {
  solver = new Solver(canvas);
} catch (err) {
  overlay.classList.remove("hidden");
  overlay.innerHTML =
    "⚠️ 시뮬레이터를 시작할 수 없습니다.<br><br>" +
    String(err.message || err) +
    "<br><br>최신 데스크톱 브라우저(Chrome / Edge / Firefox / Safari)에서 열어보세요.";
  throw err;
}

let currentEq = EQUATIONS[0];
let running = true;
let substeps = 4;

// ---------------------------------------------------------------------------
// UI: equation selector
// ---------------------------------------------------------------------------
const eqSelect = $("equation-select");
EQUATIONS.forEach((eq) => {
  const opt = document.createElement("option");
  opt.value = eq.id;
  opt.textContent = eq.name;
  eqSelect.appendChild(opt);
});
eqSelect.addEventListener("change", () => selectEquation(eqSelect.value));

function selectEquation(id) {
  currentEq = getEquation(id);
  solver.setEquation(currentEq);
  solver.gain = currentEq.gain;
  substeps = currentEq.substeps;

  $("equation-desc").textContent = currentEq.desc;
  $("equation-formula").textContent = currentEq.formula;
  $("gain").value = currentEq.gain;
  $("substeps").value = currentEq.substeps;
  syncOutputs();
  buildParams();
  pushParams();
  solver.reset(false);
}

// ---------------------------------------------------------------------------
// UI: per-equation parameter sliders
// ---------------------------------------------------------------------------
function buildParams() {
  const wrap = $("params");
  wrap.innerHTML = "";
  currentEq.params.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "param";
    div.innerHTML = `
      <div class="param-head">
        <span class="name">${p.name}</span>
        <span class="val" id="pval-${idx}"></span>
      </div>
      <input type="range" id="pinput-${idx}" min="${p.min}" max="${p.max}"
             step="${p.step}" value="${p.value}" aria-label="${p.name}" />`;
    wrap.appendChild(div);
    const input = div.querySelector("input");
    input.addEventListener("input", () => {
      $(`pval-${idx}`).textContent = (+input.value).toFixed(3);
      pushParams();
    });
    $(`pval-${idx}`).textContent = (+input.value).toFixed(3);
  });
}

function pushParams() {
  const arr = [0, 0, 0, 0];
  currentEq.params.forEach((p, idx) => {
    const input = $(`pinput-${idx}`);
    arr[idx] = input ? +input.value : p.value;
  });
  solver.setParams(arr);
}

// ---------------------------------------------------------------------------
// UI: visualization controls
// ---------------------------------------------------------------------------
$("cmap-select").addEventListener("change", (e) => {
  solver.cmap = +e.target.value;
});
$("gain").addEventListener("input", (e) => {
  solver.gain = +e.target.value;
  syncOutputs();
});
$("substeps").addEventListener("input", (e) => {
  substeps = +e.target.value;
  syncOutputs();
});
$("brush").addEventListener("input", (e) => {
  solver.brushR = +e.target.value;
  syncOutputs();
});
$("grid-select").addEventListener("change", (e) => {
  solver.setResolution(+e.target.value);
  solver.reset(false);
});

function syncOutputs() {
  $("gain-val").textContent = (+$("gain").value).toFixed(2);
  $("substeps-val").textContent = $("substeps").value;
  $("brush-val").textContent = (+$("brush").value).toFixed(3);
}

// ---------------------------------------------------------------------------
// UI: buttons
// ---------------------------------------------------------------------------
$("btn-play").addEventListener("click", () => {
  running = !running;
  $("btn-play").textContent = running ? "⏸ 일시정지" : "▶ 재생";
});
$("btn-clear").addEventListener("click", () => solver.reset(false));

// ---------------------------------------------------------------------------
// Pointer interaction → brush
// ---------------------------------------------------------------------------
let pointerDown = false;

function pointerToUV(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = 1.0 - (e.clientY - rect.top) / rect.height; // flip Y
  return [Math.min(Math.max(x, 0), 1), Math.min(Math.max(y, 0), 1)];
}

function applyBrush(e) {
  const [x, y] = pointerToUV(e);
  solver.setMouse(x, y, currentEq.brushAmp);
}

canvas.addEventListener("pointerdown", (e) => {
  pointerDown = true;
  canvas.setPointerCapture(e.pointerId);
  applyBrush(e);
});
canvas.addEventListener("pointermove", (e) => {
  if (pointerDown) applyBrush(e);
});
function endPointer() {
  pointerDown = false;
  solver.setMouse(0, 0, 0);
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => {
  if (!pointerDown) solver.setMouse(0, 0, 0);
});

// ---------------------------------------------------------------------------
// Canvas sizing — keep it square and crisp.
// ---------------------------------------------------------------------------
function resizeCanvas() {
  const wrap = canvas.parentElement;
  const size = Math.max(64, Math.min(wrap.clientWidth, wrap.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = size + "px";
  canvas.style.height = size + "px";
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
}
window.addEventListener("resize", resizeCanvas);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let frames = 0;
let lastFpsT = performance.now();

function frame() {
  if (running) solver.step(substeps);
  solver.render();

  // FPS counter.
  frames++;
  const now = performance.now();
  if (now - lastFpsT > 500) {
    const fps = Math.round((frames * 1000) / (now - lastFpsT));
    $("status").textContent = `${solver.N}² 격자 · ${fps} FPS`;
    frames = 0;
    lastFpsT = now;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
resizeCanvas();
selectEquation(EQUATIONS[0].id);
syncOutputs();
requestAnimationFrame(frame);
