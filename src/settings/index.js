import { PersistenceService } from "../intelligence/persistenceService.js";
import { AlarmSoundPlayer, ALARM_SOUND_KEY, getSelectedAlarmSound } from "../intelligence/reminderService.js";

const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || null;
const settingsPersistence = new PersistenceService(invoke);
const settingsSoundPreview = new AlarmSoundPlayer();

function writeSetting(key, value) {
  settingsPersistence.saveSetting(key, String(value));
}

const openButton = document.querySelector("#openSettingsButton");
const closeButton = document.querySelector("#closeAppButton");
const modal = document.querySelector("#settingsModal");
const closeIcon = document.querySelector("#settingsCloseIcon");
const doneButton = document.querySelector("#settingsDoneButton");
const versionEl = document.querySelector("#settingsVersionValue");
const autostartInput = document.querySelector("#settingsAutostartInput");
const screenShareProtectionInput = document.querySelector("#settingsScreenShareProtectionInput");
const linkStyleInput = document.querySelector("#settingsLinkStyleInput");
const linkArrowsInput = document.querySelector("#settingsLinkArrowsInput");
const themeInput = document.querySelector("#settingsThemeInput");
const cardFontSizeInput = document.querySelector("#settingsCardFontSizeInput");
const cardFontSizeValue = document.querySelector("#settingsCardFontSizeValue");
const lineageHoverInput = document.querySelector("#settingsLineageHoverInput");
const translatorAutoInput = document.querySelector("#settingsTranslatorAutoInput");
const operatorProfileInput = document.querySelector("#settingsOperatorProfileInput");
const operatorProfileCount = document.querySelector("#settingsOperatorProfileCount");
const checkUpdateButton = document.querySelector("#settingsCheckUpdateButton");
const updateStatusEl = document.querySelector("#settingsUpdateStatus");
const alarmSoundInput = document.querySelector("#settingsAlarmSoundInput");
const alarmSoundTestBtn = document.querySelector("#settingsAlarmSoundTestBtn");

const LINK_STYLE_KEY = "todocompanion.settings.linkStyle";
const LINK_ARROWS_KEY = "todocompanion.settings.linkArrows";
const LINEAGE_HOVER_KEY = "todocompanion.settings.lineageHover";
const THEME_KEY = "todocompanion.settings.theme";
const CARD_FONT_SIZE_KEY = "todocompanion.settings.cardFontSize";
const TRANSLATOR_MODE_KEY = "todocompanion.settings.translatorMode";
const OPERATOR_PROFILE_KEY = "todocompanion.settings.aiOperatorProfile";
const SCREEN_SHARE_PROTECTION_KEY = "todocompanion.settings.hideFromScreenShare";
const OPERATOR_PROFILE_MAX_LEN = 100;
const THEMES = ["claude-dark", "light-claude", "dracula"];
const DEFAULT_THEME = "claude-dark";
const MIN_CARD_FONT_SIZE = 1;
const MAX_CARD_FONT_SIZE = 99;
const DEFAULT_CARD_FONT_SIZE = 14;

function currentTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  return THEMES.includes(stored) ? stored : DEFAULT_THEME;
}

function applyTheme(theme) {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

function persistTheme(event) {
  const theme = THEMES.includes(event.target.value) ? event.target.value : DEFAULT_THEME;
  writeSetting(THEME_KEY, theme);
  applyTheme(theme);
}

function parseCardFontSize(val) {
  const num = parseInt(val, 10);
  if (isNaN(num)) return DEFAULT_CARD_FONT_SIZE;
  return Math.min(MAX_CARD_FONT_SIZE, Math.max(MIN_CARD_FONT_SIZE, num));
}

function currentCardFontSize() {
  const stored = localStorage.getItem(CARD_FONT_SIZE_KEY);
  return stored !== null ? parseCardFontSize(stored) : DEFAULT_CARD_FONT_SIZE;
}

function applyCardFontSize(fontSize) {
  const size = parseCardFontSize(fontSize);
  document.documentElement.style.setProperty("--card-font-size", `${size}px`);
  if (cardFontSizeValue) {
    cardFontSizeValue.textContent = `${size}px`;
  }
}

function persistCardFontSize(event) {
  const rawValue = event.target.value;
  if (!rawValue && event.type === "input") return;
  const size = parseCardFontSize(rawValue);
  if (event.type === "change") {
    event.target.value = size;
  }
  writeSetting(CARD_FONT_SIZE_KEY, String(size));
  applyCardFontSize(size);
  window.dispatchEvent(new CustomEvent("app:card-font-size-changed", { detail: { fontSize: size } }));
}

let autostartBusy = false;

function open() {
  if (!modal) return;
  modal.hidden = false;
  loadSettings().catch((err) => console.warn("[settings] load failed", err));
}

function close() {
  if (!modal) return;
  modal.hidden = true;
}

async function loadSettings() {
  if (versionEl) versionEl.textContent = "—";
  if (autostartInput) {
    autostartInput.checked = false;
    autostartInput.disabled = true;
  }
  if (linkStyleInput) {
    linkStyleInput.checked = localStorage.getItem(LINK_STYLE_KEY) !== "bezier";
  }
  if (linkArrowsInput) {
    linkArrowsInput.checked = localStorage.getItem(LINK_ARROWS_KEY) !== "false";
  }
  if (lineageHoverInput) {
    lineageHoverInput.checked = localStorage.getItem(LINEAGE_HOVER_KEY) !== "false";
  }
  if (themeInput) {
    themeInput.value = currentTheme();
  }
  if (cardFontSizeInput) {
    const size = currentCardFontSize();
    cardFontSizeInput.value = String(size);
    if (cardFontSizeValue) {
      cardFontSizeValue.textContent = `${size}px`;
    }
  }
  if (translatorAutoInput) {
    translatorAutoInput.checked = localStorage.getItem(TRANSLATOR_MODE_KEY) === "auto";
  }
  if (operatorProfileInput) {
    const savedProfile = (localStorage.getItem(OPERATOR_PROFILE_KEY) || "").slice(0, OPERATOR_PROFILE_MAX_LEN);
    operatorProfileInput.value = savedProfile;
    syncOperatorProfileCount(savedProfile.length);
  }
  if (screenShareProtectionInput) {
    screenShareProtectionInput.checked = currentScreenShareProtection();
  }
  if (alarmSoundInput) {
    alarmSoundInput.value = getSelectedAlarmSound();
  }

  if (!invoke) return;

  try {
    const version = await invoke("get_app_version");
    if (versionEl) versionEl.textContent = version || "—";
  } catch (err) {
    console.warn("[settings] get_app_version failed", err);
  }

  try {
    const enabled = Boolean(await invoke("get_autostart_enabled"));
    if (autostartInput) {
      autostartInput.checked = enabled;
      autostartInput.disabled = false;
    }
  } catch (err) {
    console.warn("[settings] get_autostart_enabled failed", err);
    if (autostartInput) {
      autostartInput.checked = false;
      autostartInput.disabled = true;
    }
  }
}

async function persistAutostart(event) {
  if (!invoke || autostartBusy) return;
  const checkbox = event.target;
  const desired = checkbox.checked;
  autostartBusy = true;
  checkbox.disabled = true;
  try {
    await invoke("set_autostart_enabled", { enabled: desired });
  } catch (err) {
    console.warn("[settings] set_autostart_enabled failed", err);
    checkbox.checked = !desired;
  } finally {
    autostartBusy = false;
    checkbox.disabled = false;
  }
}

function persistLinkStyle(event) {
  writeSetting(LINK_STYLE_KEY, event.target.checked ? "orthogonal" : "bezier");
  window.dispatchEvent(new CustomEvent("app:link-style-changed"));
}

function persistLinkArrows(event) {
  writeSetting(LINK_ARROWS_KEY, event.target.checked ? "true" : "false");
  window.dispatchEvent(new CustomEvent("app:link-style-changed"));
}

function persistLineageHover(event) {
  writeSetting(LINEAGE_HOVER_KEY, event.target.checked ? "true" : "false");
}

function syncOperatorProfileCount(len) {
  if (operatorProfileCount) {
    operatorProfileCount.textContent = `${Math.min(OPERATOR_PROFILE_MAX_LEN, Math.max(0, len))}/${OPERATOR_PROFILE_MAX_LEN}`;
  }
}

function persistOperatorProfile(event) {
  const raw = String(event.target.value || "").slice(0, OPERATOR_PROFILE_MAX_LEN);
  if (event.target.value !== raw) {
    event.target.value = raw;
  }
  writeSetting(OPERATOR_PROFILE_KEY, raw.trim());
  syncOperatorProfileCount(raw.length);
}

function currentScreenShareProtection() {
  return localStorage.getItem(SCREEN_SHARE_PROTECTION_KEY) === "true";
}

async function applyScreenShareProtection(enabled) {
  if (!invoke) return;
  try {
    await invoke("set_screen_share_protection", { enabled: Boolean(enabled) });
  } catch (err) {
    console.warn("[settings] set_screen_share_protection failed", err);
  }
}

async function persistScreenShareProtection(event) {
  const checkbox = event.target;
  const desired = Boolean(checkbox.checked);
  checkbox.disabled = true;
  try {
    if (invoke) {
      await invoke("set_screen_share_protection", { enabled: desired });
    }
    writeSetting(SCREEN_SHARE_PROTECTION_KEY, desired ? "true" : "false");
  } catch (err) {
    console.warn("[settings] set_screen_share_protection failed", err);
    checkbox.checked = !desired;
  } finally {
    checkbox.disabled = false;
  }
}

function persistTranslatorMode(event) {
  writeSetting(TRANSLATOR_MODE_KEY, event.target.checked ? "auto" : "manual");
  window.dispatchEvent(new CustomEvent("app:translator-mode-changed"));
}

function persistAlarmSound(event) {
  const val = String(event.target.value || "classic");
  writeSetting(ALARM_SOUND_KEY, val);
  settingsSoundPreview.playChime(true, val);
}

function selectSettingsTab(tabName) {
  if (!modal) return;
  modal.querySelectorAll("[data-settings-tab]").forEach((btn) => {
    const isActive = btn.dataset.settingsTab === tabName;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", String(isActive));
  });
  modal.querySelectorAll("[data-settings-pane]").forEach((pane) => {
    const isActive = pane.dataset.settingsPane === tabName;
    pane.hidden = !isActive;
    pane.classList.toggle("active", isActive);
  });
}

function setUpdateStatus(text, tone = "", detail = "") {
  if (!updateStatusEl) return;
  updateStatusEl.textContent = text;
  updateStatusEl.title = detail || "";
  updateStatusEl.classList.remove("status-ok", "status-error");
  if (tone) updateStatusEl.classList.add(tone);
}

async function handleManualUpdateCheck() {
  if (!checkUpdateButton || checkUpdateButton.disabled) return;
  checkUpdateButton.disabled = true;
  checkUpdateButton.textContent = "Verificando...";
  setUpdateStatus("Consultando o GitHub...");

  try {
    const { runUpdaterFlow } = await import("../updater/index.js");
    const result = await runUpdaterFlow({ manual: true, onBeforeModal: close });
    if (result?.status === "up-to-date") {
      setUpdateStatus("Você já está na versão mais recente ✓", "status-ok");
    } else if (result?.status === "declined") {
      setUpdateStatus(`Nova versão v${result.version} disponível`, "status-ok");
    } else if (result?.status === "unavailable") {
      setUpdateStatus("Verificação disponível apenas no app instalado");
    } else if (result?.status === "error") {
      setUpdateStatus("Não foi possível verificar agora", "status-error", result.error || "");
    } else {
      setUpdateStatus("Verifica automaticamente ao abrir o app");
    }
  } catch (err) {
    console.warn("[settings] manual update check failed", err);
    setUpdateStatus("Não foi possível verificar agora", "status-error", String(err?.message || err));
  } finally {
    checkUpdateButton.disabled = false;
    checkUpdateButton.textContent = "Verificar agora";
  }
}

function hideApp() {
  if (invoke) {
    invoke("hide_window").catch(err => console.warn("[settings] hide_window failed", err));
  }
}

export function initSettings() {
  if (!modal) return;

  openButton?.addEventListener("click", open);
  closeIcon?.addEventListener("click", close);
  doneButton?.addEventListener("click", close);
  modal.addEventListener("pointerdown", (event) => {
    if (event.target === modal) close();
  });
  autostartInput?.addEventListener("change", persistAutostart);
  screenShareProtectionInput?.addEventListener("change", persistScreenShareProtection);
  linkStyleInput?.addEventListener("change", persistLinkStyle);
  linkArrowsInput?.addEventListener("change", persistLinkArrows);
  themeInput?.addEventListener("change", persistTheme);
  lineageHoverInput?.addEventListener("change", persistLineageHover);
  cardFontSizeInput?.addEventListener("change", persistCardFontSize);
  cardFontSizeInput?.addEventListener("input", persistCardFontSize);
  translatorAutoInput?.addEventListener("change", persistTranslatorMode);
  operatorProfileInput?.addEventListener("input", persistOperatorProfile);
  operatorProfileInput?.addEventListener("change", persistOperatorProfile);
  alarmSoundInput?.addEventListener("change", persistAlarmSound);
  alarmSoundTestBtn?.addEventListener("click", () => {
    settingsSoundPreview.playChime(true, alarmSoundInput?.value || getSelectedAlarmSound());
  });
  checkUpdateButton?.addEventListener("click", handleManualUpdateCheck);
  modal.querySelectorAll("[data-settings-tab]").forEach((btn) => {
    btn.addEventListener("click", () => selectSettingsTab(btn.dataset.settingsTab));
  });
  applyTheme(currentTheme());
  applyCardFontSize(currentCardFontSize());
  applyScreenShareProtection(currentScreenShareProtection());

  settingsPersistence.hydrateSettingsFromDb([
    LINK_STYLE_KEY,
    LINK_ARROWS_KEY,
    LINEAGE_HOVER_KEY,
    THEME_KEY,
    CARD_FONT_SIZE_KEY,
    TRANSLATOR_MODE_KEY,
    OPERATOR_PROFILE_KEY,
    SCREEN_SHARE_PROTECTION_KEY,
    ALARM_SOUND_KEY
  ]).then(() => {
    applyTheme(currentTheme());
    applyCardFontSize(currentCardFontSize());
    applyScreenShareProtection(currentScreenShareProtection());
  }).catch(() => {});

  closeButton?.addEventListener("click", hideApp);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      close();
    }
  });
}
