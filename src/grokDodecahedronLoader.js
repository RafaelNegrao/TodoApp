const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;
const TWIST_ANGLE = (72 * Math.PI) / 180;
const MOVE_DURATION_SEC = 0.42;
const PAUSE_DURATION_SEC = 0.14;

const CAM_CX = Math.cos(0.34);
const CAM_SX = Math.sin(0.34);
const CAM_CY = Math.cos(-0.28);
const CAM_SY = Math.sin(-0.28);
const CAM_CZ = Math.cos(0.12);
const CAM_SZ = Math.sin(0.12);

function normalizeVector(x, y, z) {
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

const BASE_VERTICES = [
  [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
  [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
  [0, -INV_PHI, -PHI], [0, -INV_PHI, PHI], [0, INV_PHI, -PHI], [0, INV_PHI, PHI],
  [-INV_PHI, -PHI, 0], [-INV_PHI, PHI, 0], [INV_PHI, -PHI, 0], [INV_PHI, PHI, 0],
  [-PHI, 0, -INV_PHI], [-PHI, 0, INV_PHI], [PHI, 0, -INV_PHI], [PHI, 0, INV_PHI]
].map(([x, y, z]) => normalizeVector(x, y, z));

const PENTAGON_AXES = [
  { vec: normalizeVector(0, -PHI, -1), dir: 1 },
  { vec: normalizeVector(PHI, 1, 0), dir: 1 },
  { vec: normalizeVector(1, 0, PHI), dir: -1 },
  { vec: normalizeVector(0, PHI, 1), dir: 1 },
  { vec: normalizeVector(-PHI, -1, 0), dir: -1 },
  { vec: normalizeVector(-1, 0, -PHI), dir: 1 }
];

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function twistSlice(vertices, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return vertices.map(v => {
    const dot = v.x * axis.x + v.y * axis.y + v.z * axis.z;
    if (dot <= 0.15) return v;

    const cx = axis.y * v.z - axis.z * v.y;
    const cy = axis.z * v.x - axis.x * v.z;
    const cz = axis.x * v.y - axis.y * v.x;

    return {
      x: v.x * cos + cx * sin + axis.x * dot * (1 - cos),
      y: v.y * cos + cy * sin + axis.y * dot * (1 - cos),
      z: v.z * cos + cz * sin + axis.z * dot * (1 - cos)
    };
  });
}

function isLightThemeActive() {
  return document.documentElement?.dataset?.theme === "light-claude";
}

function isInsideActiveButton(canvas) {
  return Boolean(canvas?.closest?.(".topbar-action.active, .canvas-ai-fab.active"));
}

export class GrokDodecahedronRenderer {
  constructor(canvas, { size = 20, speed = 1, intensity = 1, colorRgb = null } = {}) {
    this.canvas = canvas;
    this.size = size;
    this.speed = speed;
    this.intensity = intensity;
    this.colorRgb = colorRgb;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.rafId = 0;
    this.lastFrameTime = 0;
    this.phaseSec = 0;
    this.running = false;
    this._configureCanvas();
  }

  setState({ speed, intensity, colorRgb } = {}) {
    if (typeof speed === "number" && Number.isFinite(speed) && speed >= 0) {
      this.speed = speed;
    }
    if (typeof intensity === "number" && Number.isFinite(intensity)) {
      this.intensity = Math.max(0.1, Math.min(1, intensity));
    }
    if (colorRgb !== undefined) {
      this.colorRgb = colorRgb || null;
    }
  }

  _configureCanvas() {
    if (!this.canvas || !this.ctx) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _computeVertices(elapsedSec) {
    const stepDur = MOVE_DURATION_SEC + PAUSE_DURATION_SEC;
    const axisCount = PENTAGON_AXES.length;
    const totalSteps = axisCount * 2;
    const totalCycle = stepDur * totalSteps;

    const tCycle = ((elapsedSec % totalCycle) + totalCycle) % totalCycle;
    const step = Math.min(Math.floor(tCycle / stepDur), totalSteps - 1);
    const localTime = Math.max(0, tCycle - step * stepDur);
    const progress = easeInOutCubic(Math.min(localTime / MOVE_DURATION_SEC, 1));

    let verts = BASE_VERTICES.map(v => ({ ...v }));
    if (step < axisCount) {
      for (let i = 0; i < step; i++) {
        verts = twistSlice(verts, PENTAGON_AXES[i].vec, TWIST_ANGLE * PENTAGON_AXES[i].dir);
      }
      verts = twistSlice(verts, PENTAGON_AXES[step].vec, TWIST_ANGLE * PENTAGON_AXES[step].dir * progress);
    } else {
      const target = Math.max(0, Math.min(axisCount - 1, axisCount - 1 - (step - axisCount)));
      for (let i = 0; i < target; i++) {
        verts = twistSlice(verts, PENTAGON_AXES[i].vec, TWIST_ANGLE * PENTAGON_AXES[i].dir);
      }
      verts = twistSlice(verts, PENTAGON_AXES[target].vec, TWIST_ANGLE * PENTAGON_AXES[target].dir * (1 - progress));
    }
    return verts;
  }

  _drawFrame(now) {
    if (!this.running || !this.ctx) return;
    if (!this.canvas?.isConnected) {
      this.stop();
      return;
    }

    const dt = this.lastFrameTime ? Math.min(0.1, Math.max(0, (now - this.lastFrameTime) / 1000)) : 0;
    this.lastFrameTime = now;
    this.phaseSec += dt * this.speed;

    if (document.hidden) {
      this.rafId = requestAnimationFrame(ts => this._drawFrame(ts));
      return;
    }

    const verts = this._computeVertices(this.phaseSec);
    const half = this.size / 2;
    const scale = this.size * 0.39;
    const radiusScale = this.size / 22;
    const activeButton = isInsideActiveButton(this.canvas);
    const rgb = this.colorRgb
      ? this.colorRgb
      : activeButton
        ? "0, 0, 0"
        : isLightThemeActive()
          ? "24, 24, 27"
          : "244, 244, 245";

    this.ctx.clearRect(0, 0, this.size, this.size);

    const projected = verts
      .map(v => {
        const y1 = v.y * CAM_CX - v.z * CAM_SX;
        const z1 = v.y * CAM_SX + v.z * CAM_CX;
        const x2 = v.x * CAM_CY + z1 * CAM_SY;
        const z2 = -v.x * CAM_SY + z1 * CAM_CY;
        const x3 = x2 * CAM_CZ - y1 * CAM_SZ;
        const y3 = x2 * CAM_SZ + y1 * CAM_CZ;

        const persp = 3.2 / (3.2 - z2);
        return {
          x: half + x3 * scale * persp,
          y: half + y3 * scale * persp,
          z: z2,
          depth: (z2 + 1) / 2
        };
      })
      .sort((a, b) => a.z - b.z);

    for (const pt of projected) {
      const radius = (0.72 + Math.pow(pt.depth, 1.25) * 0.78) * radiusScale;
      const alpha = activeButton
        ? 0.55 + Math.pow(pt.depth, 1.1) * 0.45
        : Math.min(1, (0.28 + Math.pow(pt.depth, 1.2) * 0.72) * this.intensity);
      this.ctx.fillStyle = `rgba(${rgb}, ${alpha.toFixed(2)})`;
      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.rafId = requestAnimationFrame(ts => this._drawFrame(ts));
  }

  start() {
    if (this.running || !this.ctx) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this._configureCanvas();
    this.rafId = requestAnimationFrame(ts => this._drawFrame(ts));
  }

  stop() {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.size, this.size);
    }
  }
}

export const AI_CHAT_THINKING_PHRASES = [
  "Thinking...",
  "Planning next steps...",
  "Analyzing context...",
  "Reasoning...",
  "Connecting ideas...",
  "Reviewing details...",
  "Evaluating options...",
  "Structuring response...",
  "Synthesizing...",
  "Crafting answer..."
];

export const AI_TRANSLATOR_THINKING_PHRASES = [
  "Translating...",
  "Adapting tone...",
  "Refining phrasing...",
  "Polishing expression...",
  "Choosing best words..."
];

export class ThinkingPhraseCycler {
  constructor(phrases, { intervalMs = 2200, startRandom = true } = {}) {
    this.phrases = Array.isArray(phrases) && phrases.length ? phrases : ["Thinking..."];
    this.intervalMs = intervalMs;
    this.startRandom = startRandom;
    this.timerId = 0;
    this.index = 0;
    this.targetEl = null;
  }

  start(targetEl) {
    this.stop();
    if (!targetEl) return;
    this.targetEl = targetEl;
    this.index = this.startRandom ? Math.floor(Math.random() * this.phrases.length) : 0;
    this.targetEl.textContent = this.phrases[this.index];
    this.timerId = window.setInterval(() => {
      if (!this.targetEl?.isConnected) {
        this.stop();
        return;
      }
      this.index = (this.index + 1) % this.phrases.length;
      this.targetEl.textContent = this.phrases[this.index];
    }, this.intervalMs);
  }

  stop() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
    this.targetEl = null;
  }
}
