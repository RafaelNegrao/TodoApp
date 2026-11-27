export function formatLocalDateTimeInput(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function normalizeReminder(raw) {
  if (!raw || typeof raw !== "object") return null;
  const dateTime = String(raw.dateTime || "").trim();
  if (!dateTime) return null;
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) return null;
  const mode = raw.mode === "alarm" ? "alarm" : "reminder";
  const repeat = ["none", "interval", "daily", "weekly"].includes(raw.repeat) ? raw.repeat : "none";
  const parsedInterval = parseInt(raw.intervalMinutes, 10);
  const intervalMinutes = Number.isFinite(parsedInterval)
    ? Math.min(1440, Math.max(1, parsedInterval))
    : 30;
  return {
    enabled: raw.enabled !== false,
    mode,
    dateTime,
    repeat,
    intervalMinutes,
    note: String(raw.note || "").trim().slice(0, 220),
    lastTriggeredFor: raw.lastTriggeredFor ? String(raw.lastTriggeredFor) : null
  };
}

export function isReminderDue(reminder, nowMs = Date.now()) {
  const norm = normalizeReminder(reminder);
  if (!norm || !norm.enabled) return false;
  const targetMs = new Date(norm.dateTime).getTime();
  if (!Number.isFinite(targetMs)) return false;
  if (norm.lastTriggeredFor === norm.dateTime) return false;
  return targetMs <= nowMs;
}

export function advanceReminderOccurrence(reminder, nowMs = Date.now()) {
  const norm = normalizeReminder(reminder);
  if (!norm) return null;
  if (norm.repeat === "none") {
    return {
      ...norm,
      enabled: false,
      lastTriggeredFor: norm.dateTime
    };
  }
  const stepMs = norm.repeat === "interval"
    ? norm.intervalMinutes * 60 * 1000
    : norm.repeat === "weekly"
      ? 7 * 24 * 60 * 60 * 1000
      : 24 * 60 * 60 * 1000;
  let nextMs = new Date(norm.dateTime).getTime() + stepMs;
  while (nextMs <= nowMs) {
    nextMs += stepMs;
  }
  return {
    ...norm,
    enabled: true,
    dateTime: formatLocalDateTimeInput(new Date(nextMs)),
    lastTriggeredFor: norm.dateTime
  };
}

export function formatReminderSummary(reminder) {
  const norm = normalizeReminder(reminder);
  if (!norm || !norm.enabled) return "";
  const d = new Date(norm.dateTime);
  const datePart = d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  const timePart = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const kind = norm.mode === "alarm" ? "Alarme" : "Lembrete";
  const rep = norm.repeat === "interval"
    ? ` · A cada ${norm.intervalMinutes} min`
    : norm.repeat === "daily"
      ? " · Diário"
      : norm.repeat === "weekly"
        ? " · Semanal"
        : "";
  return `${kind}: ${datePart} às ${timePart}${rep}`;
}

export const ALARM_SOUND_KEY = "todocompanion.settings.alarmSound";

export const ALARM_SOUND_OPTIONS = [
  { id: "classic", label: "Clássico" },
  { id: "chime", label: "Sino Cristal" },
  { id: "pulse", label: "Pulso Digital" },
  { id: "radar", label: "Radar" },
  { id: "marimba", label: "Marimba" },
  { id: "urgent", label: "Urgente" }
];

const ALARM_SOUND_PROFILES = {
  classic: { type: "triangle", step: 0.16, dur: 0.15, gain: 0.16, notes: [880, 1108.73, 880, 1108.73] },
  chime: { type: "sine", step: 0.14, dur: 0.34, gain: 0.14, notes: [523.25, 659.25, 783.99, 1046.5] },
  pulse: { type: "square", step: 0.12, dur: 0.08, gain: 0.08, notes: [1046.5, 1046.5, 1318.5, 1046.5] },
  radar: { type: "sine", step: 0.18, dur: 0.16, gain: 0.15, notes: [740, 987.77, 740, 987.77, 1174.66] },
  marimba: { type: "triangle", step: 0.13, dur: 0.22, gain: 0.18, notes: [440, 554.37, 659.25, 880, 659.25] },
  urgent: { type: "sawtooth", step: 0.11, dur: 0.1, gain: 0.09, notes: [1174.66, 1567.98, 1174.66, 1567.98, 1174.66] }
};

export function getSelectedAlarmSound() {
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(ALARM_SOUND_KEY) : null;
    return stored && ALARM_SOUND_PROFILES[stored] ? stored : "classic";
  } catch (_) {
    return "classic";
  }
}

export class AlarmSoundPlayer {
  constructor() {
    this.audioCtx = null;
    this.loopTimer = null;
    this.activeAlarmIds = new Set();
  }

  ensureContext() {
    if (typeof window === "undefined") return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.audioCtx) {
      this.audioCtx = new AudioCtx();
    }
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  playChime(isAlarm = false, soundOverride = null) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const profile = isAlarm
      ? (ALARM_SOUND_PROFILES[soundOverride || getSelectedAlarmSound()] || ALARM_SOUND_PROFILES.classic)
      : { type: "sine", step: 0.16, dur: 0.18, gain: 0.11, notes: [659.25, 880] };

    profile.notes.forEach((freq, idx) => {
      const start = now + idx * profile.step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = profile.type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(profile.gain, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + profile.dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + profile.dur + 0.02);
    });
  }

  startAlarm(alertId) {
    this.activeAlarmIds.add(alertId);
    this.playChime(true);
    if (!this.loopTimer) {
      this.loopTimer = setInterval(() => {
        if (this.activeAlarmIds.size === 0) {
          this.stopAll();
          return;
        }
        this.playChime(true);
      }, 2800);
    }
  }

  stopAlarm(alertId) {
    this.activeAlarmIds.delete(alertId);
    if (this.activeAlarmIds.size === 0) {
      this.stopAll();
    }
  }

  stopAll() {
    this.activeAlarmIds.clear();
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }
  }
}

export class TaskReminderService {
  constructor({ getState, onStateMutated, onTrigger, invokeFn = null, pollIntervalMs = 5000 }) {
    this.getState = getState;
    this.onStateMutated = onStateMutated;
    this.onTrigger = onTrigger;
    this.invoke = invokeFn;
    this.pollIntervalMs = pollIntervalMs;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.checkDueReminders();
    this.timer = setInterval(() => this.checkDueReminders(), this.pollIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkDueReminders(nowMs = Date.now()) {
    const state = this.getState?.();
    if (!state || !Array.isArray(state.users)) return [];
    const fired = [];
    let mutated = false;

    for (const user of state.users) {
      for (const task of user.tasks || []) {
        if (!task.reminder || !isReminderDue(task.reminder, nowMs)) continue;
        const snapshot = normalizeReminder(task.reminder);
        task.reminder = advanceReminderOccurrence(snapshot, nowMs);
        mutated = true;
        fired.push({ user, task, reminder: snapshot });
      }
    }

    if (mutated) {
      this.onStateMutated?.();
    }

    for (const item of fired) {
      this.dispatchWindowsNotification(item);
      this.onTrigger?.(item);
    }
    return fired;
  }

  dispatchWindowsNotification({ user, task, reminder }) {
    if (typeof this.invoke !== "function") return;
    const isAlarm = reminder.mode === "alarm";
    const prefix = isAlarm ? "Alarme" : "Lembrete";
    const title = `${prefix} · ${task.title || "Task"}`;
    const body = reminder.note || (user?.name ? `Projeto: ${user.name}` : "Hora da sua tarefa no TODOCompanion.");
    this.invoke("send_windows_notification", { title, body, isAlarm }).catch(err => {
      console.warn("[reminder] send_windows_notification failed", err);
    });
  }
}
