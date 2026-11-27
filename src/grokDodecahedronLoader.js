const PHI = (1 + Math.sqrt(5)) / 2;
const RAD = Math.PI / 180;
const PENTAGON_STEP = (Math.PI * 2) / 5;

export const AI_ICON_STYLE_KEY = "todocompanion.settings.aiIconStyle";
export const AI_ICON_COLOR_KEY = "todocompanion.settings.aiIconColor";
export const AI_ICON_STYLES = Object.freeze(["dodecahedron", "flat-eyes"]);
export const DEFAULT_AI_ICON_STYLE = "dodecahedron";
export const DEFAULT_AI_ICON_COLOR = "#6366f1";

const MOOD_COLORS = Object.freeze({
  thinking: "#a855f7",
  listening: "#06b6d4",
  happy: "#22c55e",
  angry: "#ef4444",
  alert: "#f97316",
  speaking: "#0ea5e9"
});

const aiIconMoodState = {
  mood: "normal",
  revertTimer: 0
};

export function getAiIconMood() {
  return aiIconMoodState.mood;
}

export function setAiIconMood(mood = "normal", { durationMs = 0 } = {}) {
  const validMoods = ["normal", "thinking", "listening", "happy", "angry", "alert", "speaking"];
  const next = validMoods.includes(mood) ? mood : "normal";
  if (aiIconMoodState.revertTimer) {
    clearTimeout(aiIconMoodState.revertTimer);
    aiIconMoodState.revertTimer = 0;
  }
  aiIconMoodState.mood = next;
  if (durationMs > 0 && next !== "normal") {
    aiIconMoodState.revertTimer = setTimeout(() => {
      aiIconMoodState.revertTimer = 0;
      aiIconMoodState.mood = "normal";
    }, durationMs);
  }
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return [99, 102, 241];
  const n = parseInt(clean, 16);
  if (!Number.isFinite(n)) return [99, 102, 241];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function getSelectedAiIconStyle() {
  if (typeof localStorage === "undefined") return DEFAULT_AI_ICON_STYLE;
  const stored = localStorage.getItem(AI_ICON_STYLE_KEY);
  return AI_ICON_STYLES.includes(stored) ? stored : DEFAULT_AI_ICON_STYLE;
}

export function getSelectedAiIconColor() {
  if (typeof localStorage === "undefined") return DEFAULT_AI_ICON_COLOR;
  const stored = String(localStorage.getItem(AI_ICON_COLOR_KEY) || "").trim();
  return /^#[0-9a-f]{6}$/i.test(stored) ? stored : DEFAULT_AI_ICON_COLOR;
}

const globalPointer = {
  x: 0,
  y: 0,
  lastMoveAt: 0,
  bound: false
};

function ensureGlobalPointerTracking() {
  if (globalPointer.bound || typeof window === "undefined") return;
  globalPointer.bound = true;
  window.addEventListener(
    "mousemove",
    event => {
      globalPointer.x = event.clientX;
      globalPointer.y = event.clientY;
      globalPointer.lastMoveAt = Date.now();
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    event => {
      if (event.touches && event.touches.length > 0) {
        globalPointer.x = event.touches[0].clientX;
        globalPointer.y = event.touches[0].clientY;
        globalPointer.lastMoveAt = Date.now();
      }
    },
    { passive: true }
  );
}

class FlatEyesSphereAnimator {
  constructor() {
    const initAngle = Math.random() * Math.PI * 2;
    const initRadius = 0.2 + Math.random() * 0.55;
    this.posAtual = {
      x: Math.cos(initAngle) * initRadius,
      y: Math.sin(initAngle) * initRadius
    };
    this.posAlvo = { ...this.posAtual };
    this.currentRgb = hexToRgb(getSelectedAiIconColor());
    this.lerpBase = 0.10 + Math.random() * 0.06;
    this.autoMoveIntervalMs = 1050 + Math.random() * 1150;
    this.mouseRadiusPx = 220 + Math.random() * 130;
    this.breathFreq = 2.1 + Math.random() * 0.9;
    this.thinkingDir = Math.random() < 0.5 ? 1 : -1;
    this.moodGazeOffset = {
      x: (Math.random() - 0.5) * 0.18,
      y: (Math.random() - 0.5) * 0.12
    };
    this.nextAutoMoveAt = Date.now() + 300 + Math.random() * 1100;
    this.nextBlinkAt = Date.now() + 700 + Math.random() * 2400;
    this.blinkUntil = 0;
    this.pendingDoubleBlinkAt = 0;
    this.curiousEyeBias = 0;
    this.elapsedSec = Math.random() * 12;
    this.happyBlend = 0;
    this.angryBlend = 0;
    this.eyeAnim = [
      { xScale: 1, yScale: 1, yShift: 0 },
      { xScale: 1, yScale: 1, yShift: 0 }
    ];
  }

  _resolveEffectiveMood(isThinking) {
    const globalMood = getAiIconMood();
    if (globalMood !== "normal") return globalMood;
    return isThinking ? "thinking" : "normal";
  }

  _resolveTargetRgb(mood) {
    const hex = MOOD_COLORS[mood] || getSelectedAiIconColor();
    return hexToRgb(hex);
  }

  _updateTarget(canvas, nowMs, mood) {
    if (mood === "thinking") {
      // Movimento orbital em figura-8 suave enquanto pensa
      this.posAlvo.x = Math.cos(this.elapsedSec * 2.4 * this.thinkingDir) * 0.52;
      this.posAlvo.y = -0.26 + Math.sin(this.elapsedSec * 4.8) * 0.18;
      return;
    }
    if (mood === "angry") {
      this.posAlvo.x = this.moodGazeOffset.x + Math.sin(this.elapsedSec * 3.5) * 0.12;
      this.posAlvo.y = 0.08 + this.moodGazeOffset.y;
      return;
    }
    if (mood === "happy") {
      this.posAlvo.x = this.moodGazeOffset.x + Math.sin(this.elapsedSec * 4.2) * 0.14;
      this.posAlvo.y = -0.14 + Math.cos(this.elapsedSec * 8.4) * 0.08;
      return;
    }
    if (mood === "alert") {
      this.posAlvo.x = Math.sin(this.elapsedSec * 6.0) * 0.18;
      this.posAlvo.y = -0.04;
      return;
    }

    const idleMs = nowMs - globalPointer.lastMoveAt;
    if (globalPointer.lastMoveAt > 0 && idleMs <= 1800 && canvas) {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = (globalPointer.x - cx) / this.mouseRadiusPx;
        const dy = (globalPointer.y - cy) / this.mouseRadiusPx;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          this.posAlvo.x = dx / dist;
          this.posAlvo.y = dy / dist;
        } else {
          this.posAlvo.x = dx;
          this.posAlvo.y = dy;
        }
        this.curiousEyeBias = this.posAlvo.x * 0.12;
        return;
      }
    }

    if (nowMs >= this.nextAutoMoveAt) {
      const angle = Math.random() * Math.PI * 2;
      const intensity = 0.25 + Math.random() * 0.68;
      this.posAlvo.x = Math.cos(angle) * intensity;
      this.posAlvo.y = Math.sin(angle) * intensity;
      this.curiousEyeBias = (Math.random() - 0.5) * 0.24;
      this.nextAutoMoveAt = nowMs + this.autoMoveIntervalMs * (0.65 + Math.random() * 0.65);
    }
  }

  _drawPill(ctx, cx, cy, w, h) {
    const r = Math.min(w, h) / 2;
    const x = cx - w / 2;
    const y = cy - h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  _drawHappyEye(ctx, cx, cy, w, h, bounce, blend) {
    if (blend <= 0.01) return;
    const arcRadius = Math.max(2.2, w * (0.58 + 0.16 * blend));
    ctx.save();
    ctx.globalAlpha = Math.min(1, blend);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.8, w * 0.42);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy + arcRadius * 0.35 + bounce * blend, arcRadius, Math.PI * 1.12, Math.PI * 1.88, false);
    ctx.stroke();
    ctx.restore();
  }

  _drawAngryBrowCut(ctx, cx, cy, w, h, isRightEye, blend) {
    if (blend <= 0.01) return;
    ctx.save();
    ctx.fillStyle = "#09090b";
    ctx.beginPath();
    const halfW = w * 0.92;
    const topY = cy - h * 0.58;
    // Desce suavemente a palpebra diagonal de fora do olho ate o angulo bravo (\ /)
    const cutDepth = h * (-0.08 + 0.58 * blend);
    if (!isRightEye) {
      ctx.moveTo(cx - halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY + cutDepth);
    } else {
      ctx.moveTo(cx - halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY - h * 0.15);
      ctx.lineTo(cx - halfW, topY + cutDepth);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  render(ctx, canvas, size, rawDt, isThinking) {
    ensureGlobalPointerTracking();
    const nowMs = Date.now();
    this.elapsedSec += rawDt;
    const mood = this._resolveEffectiveMood(isThinking);

    this._updateTarget(canvas, nowMs, mood);

    const frameScale = Math.max(0.5, rawDt * 60);
    const lerpFactor = 1 - Math.pow(1 - this.lerpBase, frameScale);
    this.posAtual.x += (this.posAlvo.x - this.posAtual.x) * lerpFactor;
    this.posAtual.y += (this.posAlvo.y - this.posAtual.y) * lerpFactor;

    // Interpolacao suave da cor do anel e dos pesos de expressao (happy / angry)
    const targetRgb = this._resolveTargetRgb(mood);
    const colorLerp = 1 - Math.pow(1 - 0.065, frameScale);
    for (let i = 0; i < 3; i += 1) {
      this.currentRgb[i] += (targetRgb[i] - this.currentRgb[i]) * colorLerp;
    }
    const ringColor = `rgb(${Math.round(this.currentRgb[0])}, ${Math.round(this.currentRgb[1])}, ${Math.round(this.currentRgb[2])})`;

    const exprLerp = 1 - Math.pow(1 - 0.11, frameScale);
    this.happyBlend += ((mood === "happy" ? 1 : 0) - this.happyBlend) * exprLerp;
    this.angryBlend += ((mood === "angry" ? 1 : 0) - this.angryBlend) * exprLerp;

    const canBlink = mood === "normal" || mood === "listening";
    if (canBlink) {
      if (this.pendingDoubleBlinkAt > 0 && nowMs >= this.pendingDoubleBlinkAt) {
        this.blinkUntil = nowMs + 120;
        this.pendingDoubleBlinkAt = 0;
      } else if (nowMs >= this.nextBlinkAt) {
        this.blinkUntil = nowMs + 135;
        if (Math.random() < 0.28) {
          this.pendingDoubleBlinkAt = nowMs + 230;
        }
        this.nextBlinkAt = nowMs + 1500 + Math.random() * 2400;
      }
    }
    const isBlinking = canBlink && nowMs < this.blinkUntil;

    const half = size / 2;
    const breathWave = Math.sin(this.elapsedSec * this.breathFreq);
    const idleFloatY = breathWave * (size * 0.022);

    ctx.clearRect(0, 0, size, size);
    ctx.save();

    // 1. Esfera externa flat com recorte circular
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ringColor;
    ctx.fillRect(0, 0, size, size);

    // 2. Visor interno escuro (#09090b, 78% do tamanho) com rotacao geometrica 3D + respiracao
    const visorRadius = (size * 0.78) / 2;
    const angryShakeX = Math.sin(this.elapsedSec * 42) * (size * 0.018) * this.angryBlend;
    const vx = this.posAtual.x * size * 0.16 + angryShakeX;
    const vy = this.posAtual.y * size * 0.16 + idleFloatY;
    const rotYRad = this.posAtual.x * 26 * RAD;
    const rotXRad = -this.posAtual.y * 26 * RAD;
    const scaleX = Math.cos(rotYRad);
    const scaleY = Math.cos(rotXRad);

    ctx.save();
    ctx.translate(half + vx, half + vy);
    ctx.scale(scaleX, scaleY);
    ctx.beginPath();
    ctx.arc(0, 0, visorRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#09090b";
    ctx.fill();
    ctx.restore();

    // 3. Olhos brancos expressivos com paralaxe 3D extra e transicao suave entre humores
    const ox = this.posAtual.x * size * 0.08;
    const oy = this.posAtual.y * size * 0.08 + idleFloatY * 0.5;
    const eyeW = Math.max(1.7, size * 0.088);
    const eyeH = Math.max(3.8, size * 0.22);
    const eyeGap = size * 0.14;
    const centerOffsetX = (eyeW + eyeGap) / 2;
    const eyeMorphLerp = 1 - Math.pow(1 - (isBlinking ? 0.38 : 0.14), frameScale);

    for (let idx = 0; idx < 2; idx += 1) {
      const ex = half + vx + ox + (idx === 0 ? -centerOffsetX : centerOffsetX);
      const ey = half + vy + oy;

      let targetShift = 0;
      let targetXScale = 1;
      let targetYScale = isBlinking ? 0.08 : 1 + breathWave * 0.055;

      if (mood === "normal") {
        const bias = idx === 0 ? -this.curiousEyeBias : this.curiousEyeBias;
        if (!isBlinking) {
          targetYScale = Math.max(0.75, Math.min(1.22, targetYScale + bias));
        }
      } else if (mood === "thinking") {
        const phase = ((this.elapsedSec * 1.25 - idx * 0.22) % 1.0 + 1.0) % 1.0;
        const wave = Math.sin(phase * Math.PI);
        targetShift = -wave * (size * 0.065);
        targetXScale = 1 + wave * 0.1;
        targetYScale = 1 - wave * 0.28;
      } else if (mood === "listening") {
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 5.2);
        targetXScale = 1.1 + pulse * 0.14;
        targetYScale = isBlinking ? 0.08 : 1.14 + pulse * 0.16;
      } else if (mood === "speaking") {
        const wave = 0.5 + 0.5 * Math.sin(this.elapsedSec * 20 - idx * 1.1);
        targetXScale = 1.14 - wave * 0.2;
        targetYScale = 0.55 + wave * 0.65;
      } else if (mood === "alert") {
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 11);
        targetXScale = 1.16 + pulse * 0.16;
        targetYScale = 1.2 + pulse * 0.18;
      } else if (mood === "angry") {
        targetXScale = 1.08;
        targetYScale = 0.88;
      } else if (mood === "happy") {
        targetXScale = 1.15;
        targetYScale = 0.45;
      }

      const st = this.eyeAnim[idx];
      st.xScale += (targetXScale - st.xScale) * eyeMorphLerp;
      st.yScale += (targetYScale - st.yScale) * eyeMorphLerp;
      st.yShift += (targetShift - st.yShift) * eyeMorphLerp;

      const pillAlpha = Math.max(0, 1 - this.happyBlend * 1.25);
      const drawW = Math.max(1.4, eyeW * st.xScale);
      const drawH = Math.max(1.1, eyeH * st.yScale);

      if (pillAlpha > 0.01) {
        ctx.save();
        ctx.globalAlpha = pillAlpha;
        ctx.fillStyle = "#ffffff";
        this._drawPill(ctx, ex, ey + st.yShift, drawW, drawH);
        ctx.restore();

        if (this.angryBlend > 0.01) {
          this._drawAngryBrowCut(ctx, ex, ey + st.yShift, drawW, drawH, idx === 1, this.angryBlend);
        }
      }

      if (this.happyBlend > 0.01) {
        const bounce = -Math.abs(Math.sin(this.elapsedSec * 6.5)) * (size * 0.042);
        this._drawHappyEye(ctx, ex, ey, eyeW * 1.5, eyeH, bounce, this.happyBlend);
      }
    }

    ctx.restore();
  }
}

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
  dotRadius: 1.05,
  sphereRadius: 0.37,
  fov: 3.2,
  sizeBack: 0.46,
  backAlpha: 0.05,
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
    this._flatEyes = new FlatEyesSphereAnimator();

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
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
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
      const frontRamp = Math.min(1, Math.pow(dn / 0.72, 2.2));
      const baseAlpha = c.backAlpha + (1 - c.backAlpha) * frontRamp;
      const al = dn >= 0.72
        ? 1
        : activeButton
          ? Math.min(1, 0.12 + 0.88 * frontRamp)
          : Math.min(1, baseAlpha * Math.max(this.intensity, 0.85));

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

      const aaRadius = r + 0.55;
      const dotGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, aaRadius);
      const coreStop = Math.max(0.45, Math.min(0.78, (r - 0.25) / aaRadius));
      dotGrad.addColorStop(0, `rgba(${bs},${al.toFixed(3)})`);
      dotGrad.addColorStop(coreStop, `rgba(${bs},${al.toFixed(3)})`);
      dotGrad.addColorStop(1, `rgba(${bs},0)`);
      ctx.beginPath();
      ctx.arc(p.x, p.y, aaRadius, 0, Math.PI * 2);
      ctx.fillStyle = dotGrad;
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

    if (getSelectedAiIconStyle() === "flat-eyes") {
      this._flatEyes.render(this.ctx, this.canvas, this.size, rawDt || 0.016, this.speed > 1.15);
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
      if (getSelectedAiIconStyle() === "flat-eyes") {
        this._flatEyes.render(this.ctx, this.canvas, this.size, 0.016, this.speed > 1.15);
      } else {
        this.prev = this.curr.map(v => ({ ...v }));
        this._renderSphere();
      }
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
