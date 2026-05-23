// Updater orchestrator. Call runUpdaterFlow() once on app startup.
//
// Flow:
//   1. silently query GitHub Releases for a newer TodoApp-{version}.exe
//   2. if none, exit
//   3. show "Update available" modal — user can cancel without consequence
//   4. on accept, open the progress modal and stream download events
//   5. Rust spawns the new exe (which deletes the old one) and exits this one
//   6. on any failure, surface a friendly error in the progress modal

import {
  isUpdaterAvailable,
  checkForUpdate,
  downloadAndApplyUpdate,
} from "./updaterService.js";
import { showUpdateAvailableModal } from "./updateAvailableModal.js";
import {
  openUpdateProgressModal,
  setUpdateProgressPhase,
  updateProgressFromDownload,
  showUpdateProgressError,
} from "./updateProgressModal.js";

function describeError(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

export async function runUpdaterFlow() {
  if (!isUpdaterAvailable()) {
    return;
  }

  let update = null;
  try {
    update = await checkForUpdate();
  } catch (error) {
    console.warn("[updater] check failed:", describeError(error));
    return;
  }

  if (!update) {
    return;
  }

  let accepted = false;
  try {
    accepted = await showUpdateAvailableModal({
      currentVersion: update.currentVersion,
      version: update.latestVersion,
    });
  } catch (error) {
    console.warn("[updater] available modal failed:", describeError(error));
    return;
  }

  if (!accepted) {
    return;
  }

  openUpdateProgressModal();
  setUpdateProgressPhase("preparing");

  try {
    await downloadAndApplyUpdate(update, (event) => {
      try {
        updateProgressFromDownload(event);
      } catch (renderError) {
        console.warn("[updater] progress render failed:", describeError(renderError));
      }
    });
    setUpdateProgressPhase("restarting");
  } catch (error) {
    console.error("[updater] install failed:", describeError(error));
    await showUpdateProgressError(
      "Não foi possível baixar a atualização. Verifique sua conexão e tente novamente."
    );
  }
}
