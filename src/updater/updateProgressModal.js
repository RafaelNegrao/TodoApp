// Custom update progress modal:
//   - phase status text
//   - animated progress bar (fill + shimmer)
//   - percentage and bytes counter
//   - error state with a "Fechar" button so the user is never stuck

const PHASES = {
  preparing: "Preparando atualização…",
  downloading: "Baixando nova versão…",
  installing: "Aplicando atualização…",
  restarting: "Abrindo nova versão…",
};

const state = {
  total: 0,
  downloaded: 0,
};

let backdropEl = null;

function build() {
  if (backdropEl) return backdropEl;

  const root = document.createElement("div");
  root.className = "modal-backdrop updater-modal-backdrop";
  root.hidden = true;
  root.innerHTML = `
    <div class="canvas-modal updater-progress-modal" role="dialog" aria-modal="true" aria-labelledby="updaterProgressTitle" aria-live="polite">
      <header>
        <strong id="updaterProgressTitle">Atualizando</strong>
      </header>
      <div class="updater-progress-body">
        <div class="updater-progress-status" id="updaterProgressStatus">${PHASES.preparing}</div>
        <div class="updater-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100">
          <div class="updater-progress-bar-fill" id="updaterProgressFill"></div>
          <div class="updater-progress-bar-glow" id="updaterProgressGlow"></div>
        </div>
        <div class="updater-progress-meta">
          <span class="updater-progress-percent" id="updaterProgressPercent">0%</span>
          <span class="updater-progress-bytes" id="updaterProgressBytes"></span>
        </div>
      </div>
      <footer class="updater-progress-footer" hidden>
        <button type="button" class="modal-button secondary" data-action="close">Fechar</button>
      </footer>
    </div>
  `;
  document.body.appendChild(root);
  backdropEl = root;
  return root;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function openUpdateProgressModal() {
  const root = build();
  state.total = 0;
  state.downloaded = 0;
  root.classList.remove("updater-error", "updater-busy");
  root.querySelector("#updaterProgressFill").style.width = "0%";
  root.querySelector("#updaterProgressPercent").textContent = "0%";
  root.querySelector("#updaterProgressBytes").textContent = "";
  root.querySelector("#updaterProgressStatus").textContent = PHASES.preparing;
  root.querySelector("#updaterProgressTitle").textContent = "Atualizando";
  root.querySelector(".updater-progress-footer").hidden = true;
  root.hidden = false;
}

export function setUpdateProgressPhase(phase) {
  const root = build();
  const status = root.querySelector("#updaterProgressStatus");
  status.textContent = PHASES[phase] ?? phase;

  if (phase === "installing" || phase === "restarting") {
    root.querySelector("#updaterProgressFill").style.width = "100%";
    root.querySelector("#updaterProgressPercent").textContent = "100%";
  }
  if (phase === "restarting") {
    root.classList.add("updater-busy");
  }
}

export function updateProgressFromDownload(event) {
  const root = build();
  const fill = root.querySelector("#updaterProgressFill");
  const percentEl = root.querySelector("#updaterProgressPercent");
  const bytesEl = root.querySelector("#updaterProgressBytes");
  const statusEl = root.querySelector("#updaterProgressStatus");

  if (event.phase === "started") {
    state.total = event.total || 0;
    state.downloaded = 0;
    statusEl.textContent = PHASES.downloading;
    fill.style.width = "0%";
    percentEl.textContent = state.total > 0 ? "0%" : "…";
    bytesEl.textContent = state.total > 0 ? `0 / ${formatBytes(state.total)}` : "";
    return;
  }

  if (event.phase === "progress") {
    state.downloaded = event.downloaded ?? state.downloaded;
    if (event.total) state.total = event.total;
    if (state.total > 0) {
      const pct = Math.min(100, Math.round((state.downloaded / state.total) * 100));
      fill.style.width = `${pct}%`;
      percentEl.textContent = `${pct}%`;
      bytesEl.textContent = `${formatBytes(state.downloaded)} / ${formatBytes(state.total)}`;
    } else {
      bytesEl.textContent = formatBytes(state.downloaded);
    }
    return;
  }

  if (event.phase === "finished") {
    state.downloaded = event.downloaded ?? state.downloaded;
    if (event.total) state.total = event.total;
    fill.style.width = "100%";
    percentEl.textContent = "100%";
    if (state.total > 0) {
      bytesEl.textContent = `${formatBytes(state.total)} / ${formatBytes(state.total)}`;
    }
    statusEl.textContent = PHASES.installing;
  }
}

export function showUpdateProgressError(message) {
  const root = build();
  root.classList.add("updater-error");
  root.classList.remove("updater-busy");
  root.querySelector("#updaterProgressTitle").textContent = "Erro na atualização";
  root.querySelector("#updaterProgressStatus").textContent =
    message || "Não foi possível concluir a atualização. Tente novamente mais tarde.";
  root.querySelector("#updaterProgressFill").style.width = "100%";

  const footer = root.querySelector(".updater-progress-footer");
  footer.hidden = false;

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closeUpdateProgressModal();
      root.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      resolve();
    };
    const onClick = (event) => {
      if (event.target.closest('[data-action="close"]')) finish();
    };
    const onKey = (event) => {
      if (event.key === "Escape") finish();
    };
    root.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
  });
}

export function closeUpdateProgressModal() {
  if (backdropEl) backdropEl.hidden = true;
}
