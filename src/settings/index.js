const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || null;

const openButton = document.querySelector("#openSettingsButton");
const closeButton = document.querySelector("#closeAppButton");
const modal = document.querySelector("#settingsModal");
const closeIcon = document.querySelector("#settingsCloseIcon");
const doneButton = document.querySelector("#settingsDoneButton");
const versionEl = document.querySelector("#settingsVersionValue");
const autostartInput = document.querySelector("#settingsAutostartInput");
const linkStyleInput = document.querySelector("#settingsLinkStyleInput");
const linkArrowsInput = document.querySelector("#settingsLinkArrowsInput");
const themeInput = document.querySelector("#settingsThemeInput");
const cardFontSizeInput = document.querySelector("#settingsCardFontSizeInput");
const lineageHoverInput = document.querySelector("#settingsLineageHoverInput");

const LINK_STYLE_KEY = "todocompanion.settings.linkStyle";
const LINK_ARROWS_KEY = "todocompanion.settings.linkArrows";
const LINEAGE_HOVER_KEY = "todocompanion.settings.lineageHover";
const THEME_KEY = "todocompanion.settings.theme";
const CARD_FONT_SIZE_KEY = "todocompanion.settings.cardFontSize";
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
  localStorage.setItem(THEME_KEY, theme);
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
}

function persistCardFontSize(event) {
  const rawValue = event.target.value;
  if (!rawValue && event.type === "input") return;
  const size = parseCardFontSize(rawValue);
  if (event.type === "change") {
    event.target.value = size;
  }
  localStorage.setItem(CARD_FONT_SIZE_KEY, String(size));
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
    cardFontSizeInput.value = currentCardFontSize();
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
  localStorage.setItem(LINK_STYLE_KEY, event.target.checked ? "orthogonal" : "bezier");
  window.dispatchEvent(new CustomEvent("app:link-style-changed"));
}

function persistLinkArrows(event) {
  localStorage.setItem(LINK_ARROWS_KEY, event.target.checked ? "true" : "false");
  window.dispatchEvent(new CustomEvent("app:link-style-changed"));
}

function persistLineageHover(event) {
  localStorage.setItem(LINEAGE_HOVER_KEY, event.target.checked ? "true" : "false");
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
  linkStyleInput?.addEventListener("change", persistLinkStyle);
  linkArrowsInput?.addEventListener("change", persistLinkArrows);
  themeInput?.addEventListener("change", persistTheme);
  lineageHoverInput?.addEventListener("change", persistLineageHover);
  cardFontSizeInput?.addEventListener("change", persistCardFontSize);
  cardFontSizeInput?.addEventListener("input", persistCardFontSize);
  applyTheme(currentTheme());
  applyCardFontSize(currentCardFontSize());

  closeButton?.addEventListener("click", hideApp);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      close();
    }
  });
}
