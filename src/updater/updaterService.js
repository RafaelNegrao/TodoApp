// Thin wrapper around the custom Rust updater commands.
//
// IPC contract:
//   check_for_update            -> null | UpdateInfo
//   download_and_apply_update   -> void, emits "update-progress" events
//
// UpdateInfo shape:
//   { currentVersion, latestVersion, downloadUrl, assetName, size }

function core() {
  return window.__TAURI__?.core ?? null;
}

function event() {
  return window.__TAURI__?.event ?? null;
}

function ipcInvoke(cmd, args) {
  const c = core();
  if (!c?.invoke) {
    throw new Error("Tauri IPC not available");
  }
  return c.invoke(cmd, args);
}

export function isUpdaterAvailable() {
  return Boolean(core()?.invoke);
}

export async function checkForUpdate() {
  const meta = await ipcInvoke("check_for_update");
  if (!meta) return null;
  return {
    currentVersion: meta.current_version,
    latestVersion: meta.latest_version,
    downloadUrl: meta.download_url,
    assetName: meta.asset_name,
    size: meta.size ?? 0,
  };
}

export async function downloadAndApplyUpdate(update, onProgress) {
  const ev = event();
  let unlisten = null;

  if (ev?.listen && onProgress) {
    unlisten = await ev.listen("update-progress", ({ payload }) => {
      if (!payload) return;
      if (payload.phase === "started") {
        onProgress({ phase: "started", total: payload.total ?? 0 });
      } else if (payload.phase === "progress") {
        onProgress({
          phase: "progress",
          downloaded: payload.downloaded ?? 0,
          total: payload.total ?? 0,
        });
      } else if (payload.phase === "finished") {
        onProgress({
          phase: "finished",
          downloaded: payload.downloaded ?? 0,
          total: payload.total ?? 0,
        });
      }
    });
  }

  try {
    await ipcInvoke("download_and_apply_update", {
      info: {
        current_version: update.currentVersion,
        latest_version: update.latestVersion,
        download_url: update.downloadUrl,
        asset_name: update.assetName,
        size: update.size ?? 0,
      },
    });
  } finally {
    if (typeof unlisten === "function") {
      try {
        unlisten();
      } catch {}
    }
  }
}
