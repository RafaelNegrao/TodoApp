// "Update available" modal. Reuses the existing .modal-backdrop / .canvas-modal
// look so it sits naturally inside the app's design language.
//
// Resolves a Promise<boolean>: true if the user clicked "Atualizar", false
// otherwise (Cancel button, ESC, or backdrop click).

let backdropEl = null;

function build() {
  if (backdropEl) return backdropEl;

  const root = document.createElement("div");
  root.className = "modal-backdrop updater-modal-backdrop";
  root.hidden = true;
  root.innerHTML = `
    <div class="canvas-modal updater-modal" role="dialog" aria-modal="true" aria-labelledby="updaterAvailableTitle">
      <header>
        <strong id="updaterAvailableTitle">Atualização disponível</strong>
      </header>
      <p class="updater-modal-text" id="updaterAvailableText">Uma nova versão está disponível. Deseja atualizar agora?</p>
      <div class="updater-version-row" id="updaterAvailableVersion" hidden></div>
      <footer>
        <button type="button" class="modal-button secondary" data-action="cancel">Cancelar</button>
        <button type="button" class="modal-button primary" data-action="update">Atualizar</button>
      </footer>
    </div>
  `;
  document.body.appendChild(root);
  backdropEl = root;
  return root;
}

export function showUpdateAvailableModal({ currentVersion, version } = {}) {
  const root = build();
  const versionRow = root.querySelector("#updaterAvailableVersion");
  if (currentVersion && version) {
    versionRow.hidden = false;
    versionRow.textContent = `Versão ${currentVersion} → ${version}`;
  } else {
    versionRow.hidden = true;
    versionRow.textContent = "";
  }
  root.hidden = false;

  return new Promise((resolve) => {
    let done = false;
    const finish = (accepted) => {
      if (done) return;
      done = true;
      root.hidden = true;
      root.removeEventListener("click", onClick);
      root.removeEventListener("pointerdown", onBackdrop);
      window.removeEventListener("keydown", onKey);
      resolve(accepted);
    };

    const onClick = (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      finish(action === "update");
    };

    const onBackdrop = (event) => {
      if (event.target === root) finish(false);
    };

    const onKey = (event) => {
      if (event.key === "Escape") finish(false);
    };

    root.addEventListener("click", onClick);
    root.addEventListener("pointerdown", onBackdrop);
    window.addEventListener("keydown", onKey);
  });
}
