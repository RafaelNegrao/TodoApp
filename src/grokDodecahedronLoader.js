const PHI = (1 + Math.sqrt(5)) / 2;
const RAD = Math.PI / 180;
const PENTAGON_STEP = (Math.PI * 2) / 5;

const DEFAULT_SPHERE_CONFIG = Object.freeze({
  slowSpeed: 0.85,
  fastSpeed: 6.5,
  burstDur: 0.10,
  burstChance: 0.25,
  slowArc: 16,
  fastArc: 28,
  axisSmooth: 5,
  ease: 0.45,
  pause: 0,
  layerProb: 0.45,
  layerSpeed: 1,
  layerCap: 0.25,
  dotRadius: 1.17,
  sphereRadius: 0.37,
  fov: 3.2,
  sizeBack: 0.46,
  backAlpha: 0.14,
  trail: 2.4,
  trailAlpha: 0.6
});

const WHOLE_AXES = [
  [0, 1, 0], [1, 0, 0], [0, 0, 1],
  [0.7071, 0.7071, 0], [-0.7071, 0.7071, 0], [0.7071, 0, 0.7071], [0, 0.7071, 0.7071],
  [0.5773, 0.5773, 0.5773], [-0.5773, 0.5773, 0.5773], [0.5773, -0.5773, 0.5773], [0.5773, 0.5773, -0.5773]
];

function normalizeVec(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function buildIcosahedronBase() {
  return [
    [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
    [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
    [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]
  ].map(([x, y, z]) => normalizeVec(x, y, z));
}

function buildSubdividedSphereVertices(base) {
  const verts = base.map(v => ({ ...v }));
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const dist = Math.hypot(base[i].x - base[j].x, base[i].y - base[j].y, base[i].z - base[j].z);
      if (Math.abs(dist - 1.05146) < 0.05) {
        verts.push(normalizeVec(
          (base[i].x + base[j].x) / 2,
          (base[i].y + base[j].y) / 2,
          (base[i].z + base[j].z) / 2
        ));
      }
    }
  }
  return verts;
}

const ICOSA_BASE = buildIcosahedronBase();
const SPHERE_VERTICES = buildSubdividedSphereVertices(ICOSA_BASE);

function rotateAroundAxis(v, [ux, uy, uz], angle) {
  const co = Math.cos(angle);
  const s = Math.sin(angle);
  const d = ux * v.x + uy * v.y + uz * v.z;
  return {
    x: v.x * co + (uy * v.z - uz * v.y) * s + ux * d * (1 - co),
    y: v.y * co + (uz * v.x - ux * v.z) * s + uy * d * (1 - co),
    z: v.z * co + (ux * v.y - uy * v.x) * s + uz * d * (1 - co)
  };
}

function snapLayerToGrid(snapshot, axis, dir, cap) {
  const angle = PENTAGON_STEP * dir;
  return snapshot.map(origin => {
    if (origin.x * axis[0] + origin.y * axis[1] + origin.z * axis[2] > cap) {
      const rotated = rotateAroundAxis(origin, axis, angle);
      let best = rotated;
      let minDist = Infinity;
      for (const candidate of snapshot) {
        const dist = Math.hypot(rotated.x - candidate.x, rotated.y - candidate.y, rotated.z - candidate.z);
        if (dist < minDist) {
          minDist = dist;
          best = candidate;
        }
      }
      return { ...best };
    }
    return { ...origin };
  });
}

function parseRgbTuple(rgbString) {
  if (!rgbString || typeof rgbString !== "string") return null;
  const parts = rgbString.split(",").map(part => Number(part.trim()));
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  return parts.map(n => Math.max(0, Math.min(255, Math.round(n))));
}

function isLightThemeActive() {
  return document.documentElement?.dataset?.theme === "light-claude";
}

function isInsideActiveButton(canvas) {
  return Boolean(canvas?.closest?.(".topbar-action.active, .canvas-ai-fab.active"));
}

export class GrokDodecahedronRenderer {
  constructor(canvas, { size = 20, speed = 1, intensity = 1, colorRgb = null, config = {} } = {}) {
    this.canvas = canvas;
    this.size = size;
    this.speed = speed;
    this.intensity = intensity;
    this.colorRgb = colorRgb;
    this.cfg = { ...DEFAULT_SPHERE_CONFIG, ...config };
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this.rafId = 0;
    this.lastFrameTime = 0;
    this.running = false;
    this.reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    this._resetSimulation();
    this._configureCanvas();
  }

  _resetSimulation() {
    const c = this.cfg;
    this.curr = SPHERE_VERTICES.map(v => ({ ...v }));
    this.prev = this.curr.map(v => ({ ...v }));
    this.symAxes = ICOSA_BASE.map(v => ({ ...v }));
    this.axCur = WHOLE_AXES[0].slice();
    this.axTgt = WHOLE_AXES[0].slice();
    this.axIdx = 0;
    this.symIdx = 0;
    this.isLayer = false;
    this.snap = null;
    this.layerDir = 1;
    this.cap = c.layerCap;
    this.layerRem = 0;
    this.layerTotal = 1;
    this.wholeTotal = c.slowArc * RAD;
    this.wholeRem = this.wholeTotal;
    this.isBurst = false;
    this.accelRem = 1;
    this.pauseRem = 0;
  }

  setState({ speed, intensity, colorRgb } = {}) {
    const wasFast = this.speed > 1.15;
    if (typeof speed === "number" && Number.isFinite(speed) && speed >= 0) {
      this.speed = speed;
    }
    if (typeof intensity === "number" && Number.isFinite(intensity)) {
      this.intensity = Math.max(0.1, Math.min(1, intensity));
    }
    if (colorRgb !== undefined) {
      this.colorRgb = colorRgb || null;
    }
    if (!wasFast && this.speed > 1.15) {
      this.accelRem = Math.min(this.accelRem, 0.12);
    }
  }

  _configureCanvas() {
    if (!this.canvas || !this.ctx) return;
    const dpr = Math.max(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _ease(progress) {
    const e = this.cfg.ease;
    const clamped = Math.min(1, Math.max(0, progress));
    return Math.max(0.08, (1 - e) + e * Math.sin(Math.PI * clamped));
  }

  _pickNextMove() {
    const c = this.cfg;
    this.pauseRem = c.pause * (0.5 + Math.random());
    this.isLayer = Math.random() < c.layerProb;
    if (this.isLayer) {
      this.symIdx = (this.symIdx + 1 + Math.floor(Math.random() * (this.symAxes.length - 1))) % this.symAxes.length;
      this.layerTotal = PENTAGON_STEP;
      this.layerRem = PENTAGON_STEP;
      this.layerDir = Math.random() < 0.5 ? 1 : -1;
      this.cap = c.layerCap;
      this.snap = this.curr.map(v => ({ ...v }));
    } else {
      this.axIdx = (this.axIdx + 1 + Math.floor(Math.random() * (WHOLE_AXES.length - 1))) % WHOLE_AXES.length;
      this.axTgt = WHOLE_AXES[this.axIdx];
      this.wholeTotal = (this.isBurst ? c.fastArc : c.slowArc) * RAD;
      this.wholeRem = this.wholeTotal;
      this.snap = null;
    }
  }

  _resolveDotRgb() {
    const customDot = parseRgbTuple(this.colorRgb);
    if (customDot) return customDot;
    if (isInsideActiveButton(this.canvas)) return [0, 0, 0];
    if (isLightThemeActive()) return [24, 24, 27];
    return [244, 244, 245];
  }

  _stepSimulation(rawDt) {
    const c = this.cfg;
    const isThinking = this.speed > 1.15;
    const speedMult = Math.max(0.35, this.speed);
    const dt = rawDt * speedMult;

    this.accelRem -= rawDt * (isThinking ? 1.85 : 1);
    if (this.accelRem <= 0) {
      const wasBurst = this.isBurst;
      const burstChance = isThinking ? Math.min(0.55, c.burstChance * 2) : c.burstChance;
      this.isBurst = Math.random() < burstChance;
      const calmWait = isThinking
        ? 0.22 + Math.random() * 0.45
        : 0.55 + Math.random() * 1.45;
      this.accelRem = this.isBurst ? (isThinking ? c.burstDur * 1.35 : c.burstDur) : calmWait;
      if (!this.isLayer && wasBurst !== this.isBurst) {
        this.wholeRem = Math.min(this.wholeRem, (this.isBurst ? c.fastArc : c.slowArc) * RAD);
      }
    }

    const activeSlowSpeed = isThinking ? c.slowSpeed * 2.2 : c.slowSpeed;
    const step = (this.isBurst ? c.fastSpeed : activeSlowSpeed) * dt;
    this.prev = this.curr.map(v => ({ ...v }));

    if (this.pauseRem > 0) {
      this.pauseRem -= rawDt;
      return;
    }

    if (this.isLayer) {
      const axis = [this.symAxes[this.symIdx].x, this.symAxes[this.symIdx].y, this.symAxes[this.symIdx].z];
      const delta = Math.min(
        step * c.layerSpeed * (this.isBurst ? 1 : this._ease(1 - this.layerRem / this.layerTotal)),
        this.layerRem
      );
      this.curr = this.curr.map((v, i) => (
        this.snap[i].x * axis[0] + this.snap[i].y * axis[1] + this.snap[i].z * axis[2] > this.cap
          ? rotateAroundAxis(v, axis, delta * this.layerDir)
          : v
      ));
      this.layerRem -= delta;
      if (this.layerRem <= 0.0001) {
        this.curr = snapLayerToGrid(this.snap, axis, this.layerDir, this.cap);
        this._pickNextMove();
      }
    } else {
      const k = 1 - Math.exp(-rawDt * c.axisSmooth * (this.isBurst ? 3 : isThinking ? 1.8 : 1));
      this.axCur = this.axCur.map((v, i) => v + (this.axTgt[i] - v) * k);
      const len = Math.hypot(...this.axCur) || 1;
      this.axCur = this.axCur.map(v => v / len);

      const delta = Math.min(
        step * (this.isBurst ? 1 : this._ease(1 - this.wholeRem / this.wholeTotal)),
        this.wholeRem
      );
      this.curr = this.curr.map(v => rotateAroundAxis(v, this.axCur, delta));
      this.symAxes = this.symAxes.map(v => rotateAroundAxis(v, this.axCur, delta));
      this.wholeRem -= delta;
      if (this.wholeRem <= 0.0001) {
        if (this.isBurst) {
          this.isBurst = false;
          this.accelRem = isThinking ? 0.2 + Math.random() * 0.4 : 0.4 + Math.random();
        }
        this._pickNextMove();
      }
    }
  }

  _renderSphere() {
    const ctx = this.ctx;
    const size = this.size;
    const c = this.cfg;
    const K = size / 20;
    const cx = size / 2;
    const cy = size / 2;
    const rad = size * c.sphereRadius;
    const fov = c.fov;
    const activeButton = isInsideActiveButton(this.canvas);
    const bs = this._resolveDotRgb().join(",");

    ctx.clearRect(0, 0, size, size);

    const projected = this.curr
      .map((v, i) => {
        const s = fov / (fov - v.z);
        const ps = fov / (fov - this.prev[i].z);
        return {
          x: cx + v.x * rad * s,
          y: cy + v.y * rad * s,
          px: cx + this.prev[i].x * rad * ps,
          py: cy + this.prev[i].y * rad * ps,
          z: v.z
        };
      })
      .sort((a, d) => a.z - d.z);

    for (const p of projected) {
      const dn = Math.max(0, Math.min(1, (p.z + 1) * 0.5));
      const r = Math.max(
        0.35 * K,
        c.dotRadius * K * (c.sizeBack + (1.24 - c.sizeBack) * Math.pow(dn, 1.15))
      );
      const baseAlpha = c.backAlpha + (1 - c.backAlpha) * Math.pow(dn, 1.5);
      const al = activeButton
        ? Math.min(1, 0.32 + 0.68 * Math.pow(dn, 1.25))
        : Math.min(1, baseAlpha * this.intensity);

      if (this.isBurst && c.trail > 0) {
        const tx = p.x - (p.x - p.px) * c.trail;
        const ty = p.y - (p.y - p.py) * c.trail;
        const grad = ctx.createLinearGradient(tx, ty, p.x, p.y);
        grad.addColorStop(0, `rgba(${bs},0)`);
        grad.addColorStop(1, `rgba(${bs},${(al * c.trailAlpha).toFixed(3)})`);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = grad;
        ctx.lineWidth = r * 1.6;
        ctx.lineCap = "round";
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${bs},${al.toFixed(3)})`;
      ctx.fill();
    }
  }

  _drawFrame(now) {
    if (!this.running || !this.ctx) return;
    if (!this.canvas?.isConnected) {
      this.stop();
      return;
    }

    const rawDt = this.lastFrameTime ? Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000)) : 0;
    this.lastFrameTime = now;

    if (document.hidden) {
      this.rafId = requestAnimationFrame(ts => this._drawFrame(ts));
      return;
    }

    if (rawDt > 0) {
      this._stepSimulation(rawDt);
    }
    this._renderSphere();
    this.rafId = requestAnimationFrame(ts => this._drawFrame(ts));
  }

  start() {
    if (this.running || !this.ctx) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    this._configureCanvas();
    if (this.reducedMotion) {
      this.prev = this.curr.map(v => ({ ...v }));
      this._renderSphere();
      return;
    }
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
  "Reading context...",
  "Reasoning through details...",
  "Structuring answer...",
  "Refining response..."
];

export const AI_TRANSLATOR_THINKING_PHRASES = [
  "Reading text...",
  "Translating...",
  "Adapting tone...",
  "Polishing phrasing..."
];

export class ThinkingPhraseCycler {
  constructor(phrases, { intervalMs = 3800, startRandom = false, loop = false } = {}) {
    this.phrases = Array.isArray(phrases) && phrases.length ? [...phrases] : ["Thinking..."];
    this.intervalMs = intervalMs;
    this.startRandom = startRandom;
    this.loop = loop;
    this.timerId = 0;
    this.swapTimerId = 0;
    this.index = 0;
    this.targetEl = null;
  }

  setPhrases(phrases) {
    if (!Array.isArray(phrases) || !phrases.length) return;
    this.phrases = [...phrases];
    this.index = 0;
    if (this.targetEl?.isConnected) {
      this._applyTextWithFade(this.phrases[0]);
      this._scheduleNext();
    }
  }

  _applyTextWithFade(nextText) {
    if (!this.targetEl?.isConnected) return;
    if (this.swapTimerId) {
      window.clearTimeout(this.swapTimerId);
      this.swapTimerId = 0;
    }
    if (this.targetEl.textContent === nextText) return;
    this.targetEl.classList.add("swap");
    this.swapTimerId = window.setTimeout(() => {
      this.swapTimerId = 0;
      if (!this.targetEl?.isConnected) return;
      this.targetEl.textContent = nextText;
      this.targetEl.classList.remove("swap");
    }, 240);
  }

  _scheduleNext() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
    this.timerId = window.setInterval(() => {
      if (!this.targetEl?.isConnected) {
        this.stop();
        return;
      }
      if (this.index + 1 < this.phrases.length) {
        this.index += 1;
        this._applyTextWithFade(this.phrases[this.index]);
      } else if (this.loop && this.phrases.length > 1) {
        this.index = 0;
        this._applyTextWithFade(this.phrases[this.index]);
      } else {
        window.clearInterval(this.timerId);
        this.timerId = 0;
      }
    }, this.intervalMs);
  }

  start(targetEl, overridePhrases = null) {
    this.stop();
    if (!targetEl) return;
    if (Array.isArray(overridePhrases) && overridePhrases.length) {
      this.phrases = [...overridePhrases];
    }
    this.targetEl = targetEl;
    this.index = this.startRandom ? Math.floor(Math.random() * this.phrases.length) : 0;
    this.targetEl.classList.remove("swap");
    this.targetEl.textContent = this.phrases[this.index];
    this._scheduleNext();
  }

  stop() {
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
    if (this.swapTimerId) {
      window.clearTimeout(this.swapTimerId);
      this.swapTimerId = 0;
    }
    this.targetEl?.classList?.remove("swap");
    this.targetEl = null;
  }
}
