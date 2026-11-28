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
  speaking: "#0ea5e9",
  curious: "#06b6d4",
  sleepy: "#818cf8",
  sleeping: "#4f46e5",
  worried: "#f59e0b",
  surprised: "#f59e0b",
  wink: "#ec4899",
  love: "#f43f5e"
});

const AUTONOMOUS_MOOD_POOL = Object.freeze([
  "happy",
  "curious",
  "sleepy",
  "surprised",
  "wink",
  "love",
  "angry",
  "thinking"
]);

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
  lastActivityAt: Date.now(),
  bound: false
};

function ensureGlobalPointerTracking() {
  if (globalPointer.bound || typeof window === "undefined") return;
  globalPointer.bound = true;
  const updateFromPointer = event => {
    const now = Date.now();
    globalPointer.lastActivityAt = now;
    if (typeof event.clientX === "number" && typeof event.clientY === "number") {
      globalPointer.x = event.clientX;
      globalPointer.y = event.clientY;
      globalPointer.lastMoveAt = now;
    }
  };
  const markActivity = () => {
    globalPointer.lastActivityAt = Date.now();
  };
  window.addEventListener("pointermove", updateFromPointer, { passive: true, capture: true });
  window.addEventListener("mousemove", updateFromPointer, { passive: true, capture: true });
  window.addEventListener("pointerdown", markActivity, { passive: true, capture: true });
  window.addEventListener("keydown", markActivity, { passive: true, capture: true });
  window.addEventListener("wheel", markActivity, { passive: true, capture: true });
  window.addEventListener(
    "touchmove",
    event => {
      const now = Date.now();
      globalPointer.lastActivityAt = now;
      if (event.touches && event.touches.length > 0) {
        globalPointer.x = event.touches[0].clientX;
        globalPointer.y = event.touches[0].clientY;
        globalPointer.lastMoveAt = now;
      }
    },
    { passive: true, capture: true }
  );
}

const THINKING_EYE_MODES = Object.freeze([
  "classic-bounce",
  "orbit-chase",
  "ping-pong-scan",
  "figure-eight",
  "heartbeat-pulse",
  "curious-tilt",
  "typewriter-read",
  "juggle-hop",
  "squint-focus",
  "spiral-dizzy",
  "sync-wink",
  "pendulum-swing",
  "matrix-blink",
  "breath-expand",
  "radar-look",
  "elastic-squash"
]);

const THINKING_FX_MODES = Object.freeze([
  "comet-arc",
  "dual-orbit-arcs",
  "orbit-dots",
  "sonar-ripple",
  "radar-sweep",
  "sparkle-stars",
  "dna-helix",
  "loading-segments",
  "color-prism",
  "neural-links",
  "equalizer-halo",
  "ellipsis-bounce",
  "orbit-satellites",
  "scanline-beam",
  "magnetic-ring",
  "firefly-swarm"
]);

/**
 * Generates 256 (16 eye choreographies × 16 ring/visor FX) non-repeating
 * thinking/loading micro-interactions using a shuffled deck.
 */
class ThinkingInteractionEngine {
  constructor() {
    this.deck = [];
    this.eyeMode = THINKING_EYE_MODES[0];
    this.fxMode = THINKING_FX_MODES[0];
    this.wasThinking = false;
    this.nextSwitchAt = 0;
    this.seed = Math.random() * 100;
    this._refillDeck();
    this._pickNext(Date.now());
  }

  _refillDeck() {
    const total = THINKING_EYE_MODES.length * THINKING_FX_MODES.length;
    const arr = new Array(total);
    for (let i = 0; i < total; i += 1) arr[i] = i;
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    this.deck = arr;
  }

  _pickNext(nowMs) {
    if (this.deck.length === 0) this._refillDeck();
    const prevEye = this.eyeMode;
    const prevFx = this.fxMode;
    let chosen = this.deck.pop();
    for (let tries = 0; tries < 6 && this.deck.length > 0; tries += 1) {
      const e = THINKING_EYE_MODES[Math.floor(chosen / THINKING_FX_MODES.length)];
      const f = THINKING_FX_MODES[chosen % THINKING_FX_MODES.length];
      if (e !== prevEye && f !== prevFx) break;
      this.deck.unshift(chosen);
      chosen = this.deck.pop();
    }
    this.eyeMode = THINKING_EYE_MODES[Math.floor(chosen / THINKING_FX_MODES.length)];
    this.fxMode = THINKING_FX_MODES[chosen % THINKING_FX_MODES.length];
    this.nextSwitchAt = nowMs + 2400 + Math.random() * 1500;
  }

  update(nowMs, isThinking) {
    if (isThinking && !this.wasThinking) {
      this._pickNext(nowMs);
    } else if (isThinking && nowMs >= this.nextSwitchAt) {
      this._pickNext(nowMs);
    }
    this.wasThinking = isThinking;
  }

  computeEyeMotion(idx, t, size) {
    const p = t + this.seed;
    let shiftX = 0;
    let shiftY = 0;
    let xScale = 1;
    let yScale = 1;
    let rot = 0;

    switch (this.eyeMode) {
      case "orbit-chase": {
        const a = p * 4.2 + idx * Math.PI;
        shiftX = Math.cos(a) * size * 0.045;
        shiftY = Math.sin(a) * size * 0.045;
        xScale = 1.05;
        yScale = 0.92;
        break;
      }
      case "ping-pong-scan": {
        const scan = Math.sin(p * 5.2);
        shiftX = scan * size * 0.075;
        yScale = 0.85 + Math.abs(scan) * 0.18;
        break;
      }
      case "figure-eight": {
        shiftX = Math.sin(p * 2.8) * size * 0.065;
        shiftY = Math.sin(p * 5.6) * size * 0.038;
        xScale = 1 + Math.cos(p * 2.8) * 0.08;
        break;
      }
      case "heartbeat-pulse": {
        const c = (p * 1.35) % 1;
        const beat = (c < 0.15 ? Math.sin((c / 0.15) * Math.PI) : 0) +
          (c > 0.22 && c < 0.36 ? Math.sin(((c - 0.22) / 0.14) * Math.PI) * 0.72 : 0);
        xScale = 1 + beat * 0.28;
        yScale = 1 + beat * 0.24;
        break;
      }
      case "curious-tilt": {
        const sway = Math.sin(p * 2.6);
        const side = idx === 0 ? sway : -sway;
        xScale = 1 + side * 0.22;
        yScale = 1 + side * 0.24;
        shiftY = -side * size * 0.028;
        break;
      }
      case "typewriter-read": {
        const step = Math.floor((p * 4.5) % 4);
        shiftX = (-0.06 + step * 0.04) * size;
        shiftY = (step === 3 ? -0.025 : 0.008) * size;
        yScale = step === 3 ? 0.65 : 0.95;
        break;
      }
      case "juggle-hop": {
        const hop = Math.abs(Math.sin(p * 4.4 + idx * (Math.PI / 2)));
        shiftY = -hop * size * 0.085;
        xScale = 1 - hop * 0.12;
        yScale = 1 + hop * 0.18;
        break;
      }
      case "squint-focus": {
        const f = 0.5 + 0.5 * Math.sin(p * 3.8);
        xScale = 1.25 + f * 0.12;
        yScale = 0.36 + f * 0.18;
        break;
      }
      case "spiral-dizzy": {
        const a = p * 6.5 * (idx === 0 ? 1 : -1);
        shiftX = Math.cos(a) * size * 0.032;
        shiftY = Math.sin(a) * size * 0.032;
        rot = a * 0.35;
        xScale = 1.08;
        yScale = 0.82;
        break;
      }
      case "sync-wink": {
        const w = (p * 1.4) % 2;
        const winkThis = (idx === 0 && w < 0.35) || (idx === 1 && w >= 1 && w < 1.35);
        yScale = winkThis ? 0.16 : 1.06;
        xScale = winkThis ? 1.24 : 1;
        break;
      }
      case "pendulum-swing": {
        const ang = Math.sin(p * 3.2) * 0.85;
        shiftX = Math.sin(ang) * size * 0.07;
        shiftY = (1 - Math.cos(ang)) * size * 0.06;
        rot = -ang * 0.25;
        break;
      }
      case "matrix-blink": {
        const bit = Math.sin(p * 11.0 + idx * 2.1) > 0.35;
        yScale = bit ? 1.12 : 0.25;
        xScale = bit ? 0.92 : 1.18;
        break;
      }
      case "breath-expand": {
        const b = 0.5 + 0.5 * Math.sin(p * 2.2);
        xScale = 0.86 + b * 0.34;
        yScale = 0.86 + b * 0.34;
        break;
      }
      case "radar-look": {
        const quad = Math.floor((p * 1.6) % 4);
        const dirs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        shiftX = dirs[quad][0] * size * 0.055;
        shiftY = dirs[quad][1] * size * 0.045;
        break;
      }
      case "elastic-squash": {
        const w = Math.sin(p * 6.0 + idx * 0.65);
        shiftY = -Math.abs(w) * size * 0.06;
        xScale = 1 + w * 0.24;
        yScale = 1 - w * 0.24;
        break;
      }
      default: {
        const phase = ((t * 1.25 - idx * 0.22) % 1.0 + 1.0) % 1.0;
        const wave = Math.sin(phase * Math.PI);
        shiftY = -wave * (size * 0.065);
        xScale = 1 + wave * 0.1;
        yScale = 1 - wave * 0.28;
        break;
      }
    }

    return { shiftX, shiftY, xScale, yScale, rot };
  }

  drawRingEffect(ctx, half, size, t, blend) {
    if (blend <= 0.02) return;
    const p = t + this.seed;
    const ringR = half * 0.89;
    const lw = Math.max(1.2, size * 0.09);

    ctx.save();
    ctx.globalAlpha = blend * 0.85;
    ctx.lineCap = "round";

    if (this.fxMode === "comet-arc") {
      const a = p * 3.8;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(half, half, ringR, a, a + 1.15);
      ctx.stroke();
    } else if (this.fxMode === "dual-orbit-arcs") {
      const a = p * 3.2;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.86)";
      ctx.lineWidth = lw * 0.85;
      ctx.beginPath();
      ctx.arc(half, half, ringR, a, a + 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(half, half, ringR, a + Math.PI, a + Math.PI + 0.85);
      ctx.stroke();
    } else if (this.fxMode === "color-prism") {
      const hue = (p * 110) % 360;
      ctx.strokeStyle = `hsla(${hue.toFixed(0)}, 92%, 68%, 0.9)`;
      ctx.lineWidth = lw * 1.15;
      ctx.beginPath();
      ctx.arc(half, half, ringR, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.fxMode === "magnetic-ring") {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
      ctx.lineWidth = lw * 0.75;
      ctx.setLineDash([Math.max(2, size * 0.14), Math.max(2, size * 0.11)]);
      ctx.lineDashOffset = -p * size * 0.6;
      ctx.beginPath();
      ctx.arc(half, half, ringR, 0, Math.PI * 2);
      ctx.stroke();
    } else if (this.fxMode === "loading-segments") {
      const count = 8;
      const active = Math.floor((p * 7) % count);
      ctx.lineWidth = lw * 0.85;
      for (let i = 0; i < count; i += 1) {
        const dist = (i - active + count) % count;
        const segAlpha = dist === 0 ? 1 : dist === 1 ? 0.55 : dist === 2 ? 0.25 : 0.08;
        ctx.strokeStyle = `rgba(255, 255, 255, ${segAlpha})`;
        const a0 = (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(half, half, ringR, a0, a0 + 0.42);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawVisorEffect(ctx, cx, cy, visorRadius, size, t, blend) {
    if (blend <= 0.02) return;
    const p = t + this.seed;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, visorRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = blend;

    if (this.fxMode === "orbit-dots" || this.fxMode === "orbit-satellites") {
      const count = this.fxMode === "orbit-dots" ? 3 : 2;
      for (let i = 0; i < count; i += 1) {
        const speed = this.fxMode === "orbit-satellites" ? (i === 0 ? 4.8 : -2.6) : 3.6;
        const r = visorRadius * (this.fxMode === "orbit-satellites" ? (i === 0 ? 0.76 : 0.56) : 0.78);
        const a = p * speed + (i * Math.PI * 2) / count;
        ctx.fillStyle = i % 2 === 0 ? "rgba(196, 181, 253, 0.92)" : "rgba(103, 232, 249, 0.92)";
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(0.9, size * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.fxMode === "sonar-ripple") {
      for (let i = 0; i < 2; i += 1) {
        const cycle = ((p * 0.9 + i * 0.5) % 1 + 1) % 1;
        ctx.strokeStyle = `rgba(167, 139, 250, ${(1 - cycle) * 0.65})`;
        ctx.lineWidth = Math.max(0.8, size * 0.035);
        ctx.beginPath();
        ctx.arc(cx, cy, visorRadius * (0.2 + cycle * 0.85), 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (this.fxMode === "radar-sweep") {
      const a = p * 3.4;
      ctx.fillStyle = "rgba(56, 189, 248, 0.24)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, visorRadius, a, a + 0.95);
      ctx.closePath();
      ctx.fill();
    } else if (this.fxMode === "sparkle-stars") {
      for (let i = 0; i < 4; i += 1) {
        const phase = 0.5 + 0.5 * Math.sin(p * 5.2 + i * 1.7);
        const a = i * 1.57 + 0.6 + Math.sin(p * 0.7 + i) * 0.2;
        const sx = cx + Math.cos(a) * visorRadius * 0.72;
        const sy = cy + Math.sin(a) * visorRadius * 0.72;
        const sr = Math.max(0.9, size * 0.05 * phase);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + phase * 0.75})`;
        ctx.beginPath();
        ctx.moveTo(sx, sy - sr * 1.4);
        ctx.lineTo(sx + sr * 0.45, sy - sr * 0.45);
        ctx.lineTo(sx + sr * 1.4, sy);
        ctx.lineTo(sx + sr * 0.45, sy + sr * 0.45);
        ctx.lineTo(sx, sy + sr * 1.4);
        ctx.lineTo(sx - sr * 0.45, sy + sr * 0.45);
        ctx.lineTo(sx - sr * 1.4, sy);
        ctx.lineTo(sx - sr * 0.45, sy - sr * 0.45);
        ctx.closePath();
        ctx.fill();
      }
    } else if (this.fxMode === "dna-helix") {
      for (let i = 0; i < 5; i += 1) {
        const frac = (i / 4) * 2 - 1;
        const dx = frac * visorRadius * 0.72;
        const dy = Math.sin(p * 4.5 + i * 1.1) * visorRadius * 0.32;
        ctx.fillStyle = "rgba(167, 139, 250, 0.72)";
        ctx.beginPath();
        ctx.arc(cx + dx, cy + dy + visorRadius * 0.45, Math.max(0.8, size * 0.036), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(56, 189, 248, 0.72)";
        ctx.beginPath();
        ctx.arc(cx + dx, cy - dy + visorRadius * 0.45, Math.max(0.8, size * 0.036), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.fxMode === "neural-links") {
      const pts = [];
      for (let i = 0; i < 4; i += 1) {
        const a = p * 1.4 + i * 1.57;
        pts.push([cx + Math.cos(a) * visorRadius * 0.72, cy + Math.sin(a) * visorRadius * 0.72]);
      }
      ctx.strokeStyle = "rgba(168, 85, 247, 0.48)";
      ctx.lineWidth = Math.max(0.7, size * 0.028);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 1) {
        const next = pts[(i + 1) % pts.length];
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(next[0], next[1]);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(216, 180, 254, 0.9)";
      pts.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.8, size * 0.036), 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (this.fxMode === "equalizer-halo") {
      const bars = 12;
      ctx.strokeStyle = "rgba(129, 140, 248, 0.75)";
      ctx.lineWidth = Math.max(0.9, size * 0.034);
      ctx.lineCap = "round";
      for (let i = 0; i < bars; i += 1) {
        const a = (i / bars) * Math.PI * 2 + p * 0.8;
        const h = (0.12 + 0.16 * (0.5 + 0.5 * Math.sin(p * 7 + i * 1.3))) * visorRadius;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (visorRadius - h), cy + Math.sin(a) * (visorRadius - h));
        ctx.lineTo(cx + Math.cos(a) * visorRadius, cy + Math.sin(a) * visorRadius);
        ctx.stroke();
      }
    } else if (this.fxMode === "ellipsis-bounce") {
      const dotR = Math.max(0.9, size * 0.04);
      const spacing = size * 0.12;
      for (let i = 0; i < 3; i += 1) {
        const hop = Math.max(0, Math.sin(p * 6.5 - i * 0.85));
        ctx.fillStyle = `rgba(255, 255, 255, ${0.45 + hop * 0.55})`;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * spacing, cy + visorRadius * 0.56 - hop * size * 0.055, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (this.fxMode === "scanline-beam") {
      const sy = cy + Math.sin(p * 3.6) * visorRadius * 0.82;
      ctx.strokeStyle = "rgba(56, 189, 248, 0.45)";
      ctx.lineWidth = Math.max(1.0, size * 0.042);
      ctx.beginPath();
      ctx.moveTo(cx - visorRadius, sy);
      ctx.lineTo(cx + visorRadius, sy);
      ctx.stroke();
    } else if (this.fxMode === "firefly-swarm") {
      for (let i = 0; i < 5; i += 1) {
        const a = p * (1.8 + i * 0.35) + i * 1.3;
        const rad = visorRadius * (0.45 + 0.35 * Math.sin(p * 2.1 + i));
        const alpha = 0.35 + 0.6 * (0.5 + 0.5 * Math.sin(p * 6 + i * 2));
        ctx.fillStyle = `rgba(250, 204, 21, ${alpha})`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, Math.max(0.75, size * 0.032), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

class FlatEyesSphereAnimator {
  constructor(initialMood = "normal", { autonomousMoods = false, getAmbientMood = null, monochrome = false, subtle = false } = {}) {
    const initAngle = Math.random() * Math.PI * 2;
    const initRadius = subtle ? (0.05 + Math.random() * 0.15) : (0.2 + Math.random() * 0.55);
    this.posAtual = {
      x: Math.cos(initAngle) * initRadius,
      y: Math.sin(initAngle) * initRadius
    };
    this.posAlvo = { ...this.posAtual };
    this.localMood = initialMood || "normal";
    this.moodRevertTimer = 0;
    this.autonomousMoods = Boolean(autonomousMoods);
    this.getAmbientMood = typeof getAmbientMood === "function" ? getAmbientMood : null;
    this.monochrome = Boolean(monochrome);
    this.subtle = Boolean(subtle);
    this.wasSleeping = false;
    this.wakeSurprisedUntil = 0;
    this.autoMood = "normal";
    this.lastAutoMood = "";
    this.autoMoodUntil = 0;
    this.nextAutoMoodAt = Date.now() + 20000 + Math.random() * 18000;
    this.currentRgb = this.monochrome
      ? [148, 163, 184]
      : hexToRgb(MOOD_COLORS[this.localMood] || getSelectedAiIconColor());
    this.lerpBase = this.subtle ? 0.05 : (0.10 + Math.random() * 0.06);
    this.autoMoveIntervalMs = this.subtle ? (3200 + Math.random() * 2400) : (1050 + Math.random() * 1150);
    this.mouseRadiusPx = this.subtle ? 420 : (220 + Math.random() * 130);
    this.breathFreq = this.subtle ? 1.2 : (2.1 + Math.random() * 0.9);
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
    this.happyBlend = this.localMood === "happy" ? 1 : 0;
    this.angryBlend = this.localMood === "angry" ? 1 : 0;
    this.worriedBlend = this.localMood === "worried" ? 1 : 0;
    this.waveBlend = this.localMood === "listening" ? 1 : 0;
    this.sleepyBlend = this.localMood === "sleepy" ? 1 : 0;
    this.sleepingBlend = this.localMood === "sleeping" ? 1 : 0;
    this.thinkingBlend = this.localMood === "thinking" ? 1 : 0;
    this.thinkingEngine = new ThinkingInteractionEngine();
    this.winkBlend = this.localMood === "wink" ? 1 : 0;
    this.loveBlend = this.localMood === "love" ? 1 : 0;
    this.arrowBlend = 0;
    this.arrowTarget = 0;
    this.stopBlend = 0;
    this.stopTarget = 0;
    this.typingUntil = 0;
    this.typingReadStep = 0;
    this.eyeAnim = [
      { xScale: 1, yScale: 1, yShift: 0 },
      { xScale: 1, yScale: 1, yShift: 0 }
    ];
  }

  setMood(mood = "normal", { durationMs = 0 } = {}) {
    const validMoods = [
      "normal", "thinking", "listening", "happy", "angry", "alert", "speaking",
      "curious", "sleepy", "sleeping", "worried", "surprised", "wink", "love"
    ];
    const next = validMoods.includes(mood) ? mood : "normal";
    if (this.moodRevertTimer) {
      clearTimeout(this.moodRevertTimer);
      this.moodRevertTimer = 0;
    }
    this.localMood = next;
    if (durationMs > 0 && next !== "normal") {
      this.moodRevertTimer = setTimeout(() => {
        this.moodRevertTimer = 0;
        this.localMood = "normal";
      }, durationMs);
    }
  }

  setArrowMorph(active) {
    this.arrowTarget = active ? 1 : 0;
  }

  setStopMorph(active) {
    this.stopTarget = active ? 1 : 0;
  }

  triggerTypingPulse() {
    this.typingUntil = Date.now() + 1100;
    this.typingReadStep = (this.typingReadStep + 1) % 14;
  }

  _resolveEffectiveMood(isThinking, nowMs) {
    if (this.localMood !== "normal") return this.localMood;
    if (isThinking) return "thinking";
    if (this.autonomousMoods) {
      const inactivityMs = nowMs - globalPointer.lastActivityAt;
      // Inatividade prolongada: fica sonolento aos 55s e dorme aos 90s
      if (inactivityMs >= 90000) {
        this.wasSleeping = true;
        return "sleeping";
      }
      if (this.wasSleeping) {
        this.wasSleeping = false;
        this.wakeSurprisedUntil = nowMs + 900;
      }
      if (nowMs < this.wakeSurprisedUntil) {
        return "surprised";
      }
      if (inactivityMs >= 55000) {
        return "sleepy";
      }

      const ambient = this.getAmbientMood ? (this.getAmbientMood() || "normal") : "normal";

      if (this.autoMood !== "normal") {
        if (nowMs >= this.autoMoodUntil) {
          this.autoMood = "normal";
          this.nextAutoMoodAt = nowMs + 25000 + Math.random() * 20000;
        }
        return this.autoMood;
      }

      if (nowMs >= this.nextAutoMoodAt) {
        let picked = "happy";
        if (ambient === "worried" && Math.random() < 0.45 && this.lastAutoMood !== "worried") {
          picked = "worried";
        } else if (ambient === "happy" && Math.random() < 0.45 && this.lastAutoMood !== "happy") {
          picked = "happy";
        } else {
          const candidates = AUTONOMOUS_MOOD_POOL.filter(m => m !== this.lastAutoMood);
          picked = candidates[Math.floor(Math.random() * candidates.length)] || "happy";
        }
        this.autoMood = picked;
        this.lastAutoMood = picked;
        this.autoMoodUntil = nowMs + 3500 + Math.random() * 1800;
        return this.autoMood;
      }
    }
    return "normal";
  }

  _resolveTargetRgb(mood) {
    if (this.stopTarget > 0.5) {
      return hexToRgb("#ef4444");
    }
    if (this.monochrome) {
      return isLightThemeActive() ? [100, 116, 139] : [148, 163, 184];
    }
    const hex = MOOD_COLORS[mood] || getSelectedAiIconColor();
    return hexToRgb(hex);
  }

  _updateTarget(canvas, nowMs, mood) {
    if (this.arrowTarget > 0.5 || this.stopTarget > 0.5) {
      this.posAlvo.x = 0;
      this.posAlvo.y = 0;
      return;
    }
    if (nowMs < this.typingUntil) {
      // Acompanha suavemente a leitura do texto da esquerda para a direita
      const progress = this.typingReadStep / 13;
      this.posAlvo.x = -0.58 + progress * 0.68;
      this.posAlvo.y = 0.14;
      return;
    }
    if (mood === "sleeping") {
      this.posAlvo.x = 0;
      this.posAlvo.y = 0.22 + Math.sin(this.elapsedSec * 1.1) * 0.06;
      return;
    }
    if (mood === "thinking") {
      // Movimento orbital em figura-8 suave enquanto pensa
      this.posAlvo.x = Math.cos(this.elapsedSec * 2.4 * this.thinkingDir) * 0.52;
      this.posAlvo.y = -0.26 + Math.sin(this.elapsedSec * 4.8) * 0.18;
      return;
    }

    // Quando acordado e o mouse se moveu recentemente, acompanha o cursor em qualquer humor
    const idleMs = nowMs - globalPointer.lastMoveAt;
    if (globalPointer.lastMoveAt > 0 && idleMs <= 3500 && canvas) {
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

    // Sem movimento recente do mouse: usa o olhar autonomo proprio de cada humor
    if (mood === "worried") {
      this.posAlvo.x = Math.sin(this.elapsedSec * 2.1) * 0.34;
      this.posAlvo.y = -0.06;
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

  _drawWorriedBrowCut(ctx, cx, cy, w, h, isRightEye, blend) {
    if (blend <= 0.01) return;
    ctx.save();
    ctx.fillStyle = "#09090b";
    ctx.beginPath();
    const halfW = w * 0.92;
    const topY = cy - h * 0.58;
    // Corte diagonal externo (/ \) criando expressao preocupada
    const cutDepth = h * (-0.08 + 0.52 * blend);
    if (!isRightEye) {
      ctx.moveTo(cx - halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY - h * 0.15);
      ctx.lineTo(cx - halfW, topY + cutDepth);
    } else {
      ctx.moveTo(cx - halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY - h * 0.15);
      ctx.lineTo(cx + halfW, topY + cutDepth);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  _drawSleepingEye(ctx, cx, cy, w, h, blend) {
    if (blend <= 0.01) return;
    const arcRadius = Math.max(2.0, w * 0.65);
    ctx.save();
    ctx.globalAlpha = Math.min(1, blend);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.6, w * 0.36);
    ctx.lineCap = "round";
    ctx.beginPath();
    // Arco para baixo (u u) de olho fechado dormindo
    ctx.arc(cx, cy - arcRadius * 0.25, arcRadius, Math.PI * 0.14, Math.PI * 0.86, false);
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
    const mood = this._resolveEffectiveMood(isThinking, nowMs);

    this._updateTarget(canvas, nowMs, mood);

    const frameScale = Math.max(0.5, rawDt * 60);
    const lerpFactor = 1 - Math.pow(1 - this.lerpBase, frameScale);
    this.posAtual.x += (this.posAlvo.x - this.posAtual.x) * lerpFactor;
    this.posAtual.y += (this.posAlvo.y - this.posAtual.y) * lerpFactor;

    // Interpolacao suave da cor do anel e dos pesos de expressao
    const targetRgb = this._resolveTargetRgb(mood);
    const colorLerp = 1 - Math.pow(1 - 0.065, frameScale);
    for (let i = 0; i < 3; i += 1) {
      this.currentRgb[i] += (targetRgb[i] - this.currentRgb[i]) * colorLerp;
    }
    const ringColor = `rgb(${Math.round(this.currentRgb[0])}, ${Math.round(this.currentRgb[1])}, ${Math.round(this.currentRgb[2])})`;

    const exprLerp = 1 - Math.pow(1 - 0.11, frameScale);
    const arrowLerp = 1 - Math.pow(1 - 0.20, frameScale);
    this.arrowBlend += (this.arrowTarget - this.arrowBlend) * arrowLerp;
    this.stopBlend += (this.stopTarget - this.stopBlend) * arrowLerp;
    const morphBlend = Math.min(1, Math.max(this.arrowBlend, this.stopBlend));
    const isTypingNow = nowMs < this.typingUntil && morphBlend < 0.25;
    const suppression = 1 - morphBlend;
    const allowExpr = this.arrowTarget < 0.5 && this.stopTarget < 0.5;
    this.happyBlend += ((mood === "happy" && allowExpr ? 1 : 0) - this.happyBlend) * exprLerp;
    this.angryBlend += ((mood === "angry" && allowExpr ? 1 : 0) - this.angryBlend) * exprLerp;
    this.worriedBlend += ((mood === "worried" && allowExpr ? 1 : 0) - this.worriedBlend) * exprLerp;
    this.waveBlend += ((mood === "listening" && allowExpr ? 1 : 0) - this.waveBlend) * exprLerp;
    this.sleepyBlend += ((mood === "sleepy" && allowExpr ? 1 : 0) - this.sleepyBlend) * exprLerp;
    this.sleepingBlend += ((mood === "sleeping" && allowExpr ? 1 : 0) - this.sleepingBlend) * exprLerp;
    this.winkBlend += ((mood === "wink" && allowExpr ? 1 : 0) - this.winkBlend) * exprLerp;
    this.loveBlend += ((mood === "love" && allowExpr ? 1 : 0) - this.loveBlend) * exprLerp;
    const isThinkingActive = mood === "thinking" && allowExpr;
    this.thinkingBlend += ((isThinkingActive ? 1 : 0) - this.thinkingBlend) * exprLerp;
    this.thinkingEngine.update(nowMs, isThinkingActive);

    const canBlink = mood === "normal" && morphBlend < 0.15 && this.waveBlend < 0.15;
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
    const motionScale = this.subtle ? 0.5 : 1;
    const idleFloatY = breathWave * (size * 0.022) * suppression * motionScale;

    ctx.clearRect(0, 0, size, size);
    ctx.save();

    // 1. Esfera externa flat com recorte circular
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = ringColor;
    ctx.fillRect(0, 0, size, size);

    if (this.thinkingBlend * suppression > 0.02) {
      this.thinkingEngine.drawRingEffect(ctx, half, size, this.elapsedSec, this.thinkingBlend * suppression);
    }

    // 2. Visor interno escuro (#09090b, 78% do tamanho) com rotacao geometrica 3D + respiracao
    const visorRadius = (size * 0.78) / 2;
    const angryShakeX = Math.sin(this.elapsedSec * 42) * (size * 0.018) * this.angryBlend * suppression;
    const vx = (this.posAtual.x * size * 0.16 * motionScale + angryShakeX) * suppression;
    const vy = (this.posAtual.y * size * 0.16 * motionScale + idleFloatY) * suppression;
    const rotYRad = this.posAtual.x * 26 * RAD * suppression * motionScale;
    const rotXRad = -this.posAtual.y * 26 * RAD * suppression * motionScale;
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

    if (this.thinkingBlend * suppression > 0.02) {
      this.thinkingEngine.drawVisorEffect(
        ctx,
        half + vx,
        half + vy,
        visorRadius,
        size,
        this.elapsedSec,
        this.thinkingBlend * suppression
      );
    }

    // 3. Olhos brancos expressivos que tambem se transformam geometricamente em seta (↑) no hover
    const ox = this.posAtual.x * size * 0.08 * suppression * motionScale;
    const oy = (this.posAtual.y * size * 0.08 * motionScale + idleFloatY * 0.5) * suppression;
    const eyeW = Math.max(1.7, size * 0.088);
    const eyeH = Math.max(3.8, size * 0.22);
    const eyeGap = size * 0.14;
    const centerOffsetX = (eyeW + eyeGap) / 2;
    const eyeMorphLerp = 1 - Math.pow(1 - (isBlinking ? 0.38 : 0.16), frameScale);

    // Haste central da seta (emerge suavemente entre os dois olhos quando arrowBlend -> 1)
    if (this.arrowBlend > 0.02) {
      const shaftW = Math.max(1.8, size * 0.085);
      const shaftH = size * 0.38 * this.arrowBlend;
      const shaftCy = half + size * 0.04 + (1 - this.arrowBlend) * (size * 0.12);
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.arrowBlend * 1.15);
      ctx.fillStyle = "#ffffff";
      this._drawPill(ctx, half, shaftCy, shaftW, Math.max(1.5, shaftH));
      ctx.restore();
    }

    // Barra central das 3 ondas de som (emerge entre os dois olhos no estado listening)
    const activeWaveBlend = this.waveBlend * suppression;
    if (activeWaveBlend > 0.02) {
      const midPulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 9.5);
      const barW = Math.max(1.5, size * 0.072);
      const midH = size * (0.20 + 0.22 * midPulse) * activeWaveBlend;
      ctx.save();
      ctx.globalAlpha = Math.min(1, activeWaveBlend * 1.15);
      ctx.fillStyle = "#ffffff";
      this._drawPill(ctx, half + vx + ox, half + vy + oy, barW, Math.max(1.4, midH));
      ctx.restore();
    }

    const wingLen = size * 0.24;
    const arrowTipY = half - size * 0.19;
    const wingDelta = wingLen * 0.3535;
    const waveSideSpacing = size * 0.145;

    for (let idx = 0; idx < 2; idx += 1) {
      const eyeOffsetX = idx === 0 ? -centerOffsetX : centerOffsetX;
      const waveOffsetX = idx === 0 ? -waveSideSpacing : waveSideSpacing;
      const blendedOffsetX = eyeOffsetX + (waveOffsetX - eyeOffsetX) * activeWaveBlend;
      const baseEx = half + vx + ox + blendedOffsetX;
      const baseEy = half + vy + oy;

      let targetShiftX = 0;
      let targetShift = 0;
      let targetRot = 0;
      let targetXScale = 1;
      let targetYScale = isBlinking ? 0.08 : 1 + breathWave * 0.055;

      if (isTypingNow) {
        // Olhos calmos, focados e levemente atentos enquanto le o que voce digita
        targetShift = size * 0.012;
        targetXScale = 1.04;
        targetYScale = isBlinking ? 0.08 : 0.90;
      } else if (mood === "normal") {
        const bias = idx === 0 ? -this.curiousEyeBias : this.curiousEyeBias;
        if (!isBlinking) {
          targetYScale = Math.max(0.75, Math.min(1.22, targetYScale + bias));
        }
      } else if (mood === "thinking") {
        const eyeMod = this.thinkingEngine.computeEyeMotion(idx, this.elapsedSec, size);
        targetShiftX = eyeMod.shiftX;
        targetShift = eyeMod.shiftY;
        targetXScale = eyeMod.xScale;
        targetYScale = eyeMod.yScale;
        targetRot = eyeMod.rot;
      } else if (mood === "listening") {
        // Barras laterais das 3 ondas de som pulsando fora de fase com a barra central
        const sidePulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 9.5 + (idx === 0 ? 1.7 : 3.4));
        targetXScale = 0.82;
        targetYScale = 0.52 + sidePulse * 0.78;
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
      } else if (mood === "curious") {
        // Olho direito maior e mais alto que o esquerdo (o O)
        targetXScale = idx === 1 ? 1.24 : 0.88;
        targetYScale = idx === 1 ? 1.22 : 0.78;
        targetShift = idx === 1 ? -size * 0.032 : size * 0.018;
      } else if (mood === "sleepy") {
        // Palpebras pesadas semi-fechadas com respiracao bem lenta
        const slowBreath = 0.5 + 0.5 * Math.sin(this.elapsedSec * 1.6);
        targetXScale = 1.22;
        targetYScale = 0.28 + slowBreath * 0.14;
        targetShift = size * 0.035;
      } else if (mood === "sleeping") {
        targetXScale = 1.15;
        targetYScale = 0.22;
        targetShift = size * 0.05;
      } else if (mood === "worried") {
        const worryPulse = Math.sin(this.elapsedSec * 3.8);
        targetXScale = 1.06;
        targetYScale = 0.94 + worryPulse * 0.05;
        targetShift = size * 0.015;
      } else if (mood === "surprised") {
        // Olhos bem redondos e arregalados com leve pulo de surpresa
        const pop = Math.abs(Math.sin(this.elapsedSec * 4.5));
        targetXScale = 1.42 + pop * 0.12;
        targetYScale = 1.18 + pop * 0.1;
        targetShift = -size * 0.025 * pop;
      } else if (mood === "wink") {
        // Olho esquerdo pisca em arco sorridente, olho direito fica bem aberto
        targetXScale = idx === 0 ? 1.18 : 1.12;
        targetYScale = idx === 0 ? 0.42 : 1.12;
      } else if (mood === "love") {
        // Olhos brilhantes e fofos com leve saltito carinhoso
        const pulse = 0.5 + 0.5 * Math.sin(this.elapsedSec * 5.0);
        targetXScale = 1.18 + pulse * 0.1;
        targetYScale = 1.12 + pulse * 0.1;
        targetShift = -pulse * (size * 0.022);
      }

      const st = this.eyeAnim[idx];
      st.xScale += (targetXScale - st.xScale) * eyeMorphLerp;
      st.yScale += (targetYScale - st.yScale) * eyeMorphLerp;
      st.yShift += (targetShift - st.yShift) * eyeMorphLerp;
      st.xShift = (st.xShift || 0) + (targetShiftX - (st.xShift || 0)) * eyeMorphLerp;
      st.rot = (st.rot || 0) + (targetRot - (st.rot || 0)) * eyeMorphLerp;

      // Posicao e rotacao alvo para a asa da seta (arrowBlend) ou fusao no quadrado Stop (stopBlend)
      const arrowX = idx === 0 ? half - wingDelta : half + wingDelta;
      const arrowY = arrowTipY + wingDelta;
      const eyeX = baseEx + st.xShift * suppression;
      const eyeY = baseEy + st.yShift * suppression;
      let ex = eyeX + (arrowX - eyeX) * this.arrowBlend;
      let ey = eyeY + (arrowY - eyeY) * this.arrowBlend;
      ex = ex + (half - ex) * this.stopBlend;
      ey = ey + (half - ey) * this.stopBlend;
      const rotAngle = st.rot * suppression + (idx === 0 ? Math.PI / 4 : -Math.PI / 4) * this.arrowBlend * (1 - this.stopBlend);

      const eyeArcBlend = idx === 0 ? Math.max(this.happyBlend, this.winkBlend) : this.happyBlend;
      const pillAlpha =
        Math.max(0, 1 - eyeArcBlend * 1.25 * suppression) *
        Math.max(0, 1 - this.sleepingBlend * 1.3 * suppression) *
        Math.max(0, 1 - this.stopBlend * 1.35);
      const drawW = Math.max(1.4, eyeW * (st.xScale * suppression + 1.0 * this.arrowBlend));
      const drawH = Math.max(1.1, eyeH * st.yScale * suppression + wingLen * this.arrowBlend);

      if (pillAlpha > 0.01) {
        ctx.save();
        ctx.translate(ex, ey);
        if (Math.abs(rotAngle) > 0.001) {
          ctx.rotate(rotAngle);
        }
        ctx.globalAlpha = pillAlpha;
        ctx.fillStyle = "#ffffff";
        this._drawPill(ctx, 0, 0, drawW, drawH);
        ctx.restore();

        if (this.angryBlend > 0.01 && suppression > 0.05) {
          this._drawAngryBrowCut(ctx, ex, ey, drawW, drawH, idx === 1, this.angryBlend * suppression);
        }
        if (this.worriedBlend > 0.01 && suppression > 0.05) {
          this._drawWorriedBrowCut(ctx, ex, ey, drawW, drawH, idx === 1, this.worriedBlend * suppression);
        }
      }

      if (this.sleepingBlend > 0.01 && suppression > 0.05) {
        this._drawSleepingEye(ctx, ex, ey, eyeW * 1.4, eyeH, this.sleepingBlend * suppression);
      }

      if (eyeArcBlend > 0.01 && suppression > 0.05) {
        const bounce = -Math.abs(Math.sin(this.elapsedSec * 6.5)) * (size * 0.042) * (this.happyBlend > 0.2 ? 1 : 0.35);
        this._drawHappyEye(ctx, ex, ey, eyeW * 1.5, eyeH, bounce, eyeArcBlend * suppression);
      }

      if (this.loveBlend > 0.02 && suppression > 0.05) {
        ctx.save();
        ctx.globalAlpha = 0.55 * this.loveBlend * suppression;
        ctx.fillStyle = "#fb7185";
        ctx.beginPath();
        ctx.ellipse(ex, ey + eyeH * 0.68, eyeW * 0.85, eyeW * 0.42, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Pequenos "z" flutuando suavemente quando esta dormindo (sleepingBlend -> 1)
    if (this.sleepingBlend > 0.1 && suppression > 0.2) {
      ctx.save();
      ctx.fillStyle = "#c7d2fe";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let k = 0; k < 2; k += 1) {
        const cycle = ((this.elapsedSec * 0.45 + k * 0.5) % 1 + 1) % 1;
        const alpha = Math.sin(cycle * Math.PI) * this.sleepingBlend * suppression * 0.9;
        const zx = half + size * (0.14 + cycle * 0.14);
        const zy = half - size * (0.04 + cycle * 0.28);
        const fontSize = Math.max(5.5, size * (0.14 + cycle * 0.08));
        ctx.globalAlpha = alpha;
        ctx.font = `700 ${fontSize.toFixed(1)}px system-ui, sans-serif`;
        ctx.fillText("z", zx, zy);
      }
      ctx.restore();
    }

    // Quadrado arredondado central de Stop (emerge quando stopBlend -> 1 no hover durante chatBusy)
    if (this.stopBlend > 0.02) {
      const sqSize = size * (0.16 + 0.14 * this.stopBlend);
      const r = Math.max(1.5, sqSize * 0.24);
      const sx = half - sqSize / 2;
      const sy = half - sqSize / 2;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.stopBlend * 1.15);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(sx + r, sy);
      ctx.lineTo(sx + sqSize - r, sy);
      ctx.quadraticCurveTo(sx + sqSize, sy, sx + sqSize, sy + r);
      ctx.lineTo(sx + sqSize, sy + sqSize - r);
      ctx.quadraticCurveTo(sx + sqSize, sy + sqSize, sx + sqSize - r, sy + sqSize);
      ctx.lineTo(sx + r, sy + sqSize);
      ctx.quadraticCurveTo(sx, sy + sqSize, sx, sy + sqSize - r);
      ctx.lineTo(sx, sy + r);
      ctx.quadraticCurveTo(sx, sy, sx + r, sy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
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
  constructor(canvas, { size = 20, speed = 1, intensity = 1, colorRgb = null, mood = "normal", autonomousMoods = false, getAmbientMood = null, monochrome = false, subtle = false, config = {} } = {}) {
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
    this._flatEyes = new FlatEyesSphereAnimator(mood, { autonomousMoods, getAmbientMood, monochrome, subtle });

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

  setMood(mood, opts) {
    this._flatEyes?.setMood(mood, opts);
  }

  setArrowMorph(active) {
    this._flatEyes?.setArrowMorph(active);
  }

  setStopMorph(active) {
    this._flatEyes?.setStopMorph(active);
  }

  triggerTypingPulse() {
    this._flatEyes?.triggerTypingPulse();
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
