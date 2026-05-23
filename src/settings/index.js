// Wires the gear button in the topbar to the settings modal, plus the
// close button (which collapses the panel). Loads version + autostart
// state on open, persists autostart changes immediately.

const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || null;

const openButton = document.querySelector("#openSettingsButton");
const closeButton = document.querySelector("#closeAppButton");
const modal = document.querySelector("#settingsModal");
const closeIcon = document.querySelector("#settingsCloseIcon");
const doneButton = document.querySelector("#settingsDoneButton");
const versionEl = document.querySelector("#settingsVersionValue");
const autostartInput = document.querySelector("#settingsAutostartInput");

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

function collapseApp() {
  window.dispatchEvent(new CustomEvent("app:collapse"));
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

  closeButton?.addEventListener("click", collapseApp);

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      close();
    }
  });
}
