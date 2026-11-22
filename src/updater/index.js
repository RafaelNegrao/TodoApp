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

let updaterInFlight = false;
let lastAutoCheckAt = 0;
const AUTO_CHECK_COOLDOWN_MS = 30_000;

export async function runUpdaterFlow({ manual = false, onBeforeModal = null } = {}) {
  if (!isUpdaterAvailable()) {
    return { status: "unavailable" };
  }
  if (updaterInFlight) {
    return { status: "busy" };
  }
  if (!manual && lastAutoCheckAt > 0 && Date.now() - lastAutoCheckAt < AUTO_CHECK_COOLDOWN_MS) {
    return { status: "throttled" };
  }

  updaterInFlight = true;
  lastAutoCheckAt = Date.now();

  try {
    let update = null;
    try {
      update = await checkForUpdate();
    } catch (error) {
      const msg = describeError(error);
      console.warn("[updater] check failed:", msg);
      return { status: "error", error: msg };
    }

    if (!update) {
      return { status: "up-to-date" };
    }

    if (typeof onBeforeModal === "function") {
      try {
        onBeforeModal();
      } catch (_) { }
    }

    let accepted = false;
    try {
      accepted = await showUpdateAvailableModal({
        currentVersion: update.currentVersion,
        version: update.latestVersion,
      });
    } catch (error) {
      const msg = describeError(error);
      console.warn("[updater] available modal failed:", msg);
      return { status: "error", error: msg };
    }

    if (!accepted) {
      return { status: "declined", version: update.latestVersion };
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
      return { status: "accepted", version: update.latestVersion };
    } catch (error) {
      const msg = describeError(error);
      console.error("[updater] install failed:", msg);
      await showUpdateProgressError(
        "Unable to download update. Check your connection and try again."
      );
      return { status: "error", error: msg };
    }
  } finally {
    updaterInFlight = false;
  }
}
