#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
};

const COLLAPSED_WIDTH: u32 = 34;
const COLLAPSED_HEIGHT: u32 = 64;
const HANDLE_GUTTER: u32 = 34;
const RIGHT_MARGIN: i32 = 5;
const HEIGHT_RATIO: f64 = 0.90;
const APP_FOLDER: &str = "TODOCompanion";
const DB_FILE: &str = "data.sqlite";
const GITHUB_API_LATEST: &str =
    "https://api.github.com/repos/RafaelNegrao/TodoApp/releases/latest";
const USER_AGENT: &str = "TodoApp-Updater";
#[cfg(target_os = "windows")]
const AUTOSTART_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
#[cfg(target_os = "windows")]
const AUTOSTART_VALUE: &str = "TODOCompanion";

struct DbState(Mutex<Connection>);

#[derive(Serialize)]
struct PanelGeometry {
    collapsed_width: u32,
    expanded_width: u32,
    height: u32,
    x: i32,
    y: i32,
}

#[derive(Serialize)]
struct AttachmentInfo {
    file: String,
    original_name: String,
    size: u64,
}

#[derive(Clone, Serialize, Deserialize)]
struct UpdateInfo {
    current_version: String,
    latest_version: String,
    download_url: String,
    asset_name: String,
    size: u64,
}

#[tauri::command]
fn initialize_panel(app: tauri::AppHandle) -> Result<PanelGeometry, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window was not found".to_string())?;

    position_panel(&window, false)
}

#[tauri::command]
fn set_panel_expanded(app: tauri::AppHandle, expanded: bool) -> Result<PanelGeometry, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window was not found".to_string())?;

    let geometry = position_panel(&window, expanded)?;
    if expanded {
        let _ = window.set_focus();
    }

    Ok(geometry)
}

#[tauri::command]
fn state_load(db: State<'_, DbState>) -> Result<Option<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT json FROM state WHERE id = 1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let json: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(json))
    } else {
        Ok(None)
    }
}

#[tauri::command]
fn state_save(db: State<'_, DbState>, json: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO state (id, json, updated_at) VALUES (1, ?1, strftime('%s', 'now')) \
         ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at",
        params![json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn attachment_save_from_path(
    app: tauri::AppHandle,
    user_id: String,
    source_path: String,
) -> Result<AttachmentInfo, String> {
    let src = PathBuf::from(&source_path);
    let original_name = src
        .file_name()
        .ok_or_else(|| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();
    let user_dir = ensure_user_dir(&app, &user_id)?;
    let stored_name = unique_filename(&user_dir, &original_name);
    let dest = user_dir.join(&stored_name);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(AttachmentInfo {
        file: stored_name,
        original_name,
        size,
    })
}

#[tauri::command]
fn attachment_save_from_bytes(
    app: tauri::AppHandle,
    user_id: String,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<AttachmentInfo, String> {
    let user_dir = ensure_user_dir(&app, &user_id)?;
    let stored_name = unique_filename(&user_dir, &file_name);
    let dest = user_dir.join(&stored_name);
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(AttachmentInfo {
        file: stored_name,
        original_name: file_name,
        size: bytes.len() as u64,
    })
}

#[tauri::command]
fn attachment_delete(
    app: tauri::AppHandle,
    user_id: String,
    file: String,
) -> Result<(), String> {
    let path = app_root(&app)?.join(&user_id).join(&file);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn attachment_open(
    app: tauri::AppHandle,
    user_id: String,
    file: String,
) -> Result<(), String> {
    let path = app_root(&app)?.join(&user_id).join(&file);
    if !path.exists() {
        return Err("Arquivo nao encontrado".to_string());
    }
    open_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_autostart_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        match hkcu.open_subkey(AUTOSTART_KEY) {
            Ok(key) => Ok(key.get_value::<String, _>(AUTOSTART_VALUE).is_ok()),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_autostart_enabled(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        write_autostart(enabled).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_autostart(enabled: bool) -> std::io::Result<()> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(AUTOSTART_KEY)?;
    if enabled {
        let exe = env::current_exe()?;
        let value = format!("\"{}\"", exe.to_string_lossy());
        key.set_value(AUTOSTART_VALUE, &value)?;
    } else {
        let _ = key.delete_value(AUTOSTART_VALUE);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn refresh_autostart_path_if_needed() {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey_with_flags(AUTOSTART_KEY, KEY_READ | KEY_WRITE) else {
        return;
    };
    let Ok(current_value): Result<String, _> = key.get_value(AUTOSTART_VALUE) else {
        return;
    };
    let Ok(exe) = env::current_exe() else {
        return;
    };
    let expected = format!("\"{}\"", exe.to_string_lossy());
    if current_value != expected {
        let _ = key.set_value(AUTOSTART_VALUE, &expected);
    }
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.to_string();

    let result: Result<Option<UpdateInfo>, String> =
        tauri::async_runtime::spawn_blocking(move || fetch_latest_release(&current))
            .await
            .map_err(|e| e.to_string())?;

    result
}

#[tauri::command]
async fn download_and_apply_update(
    window: tauri::WebviewWindow,
    info: UpdateInfo,
) -> Result<(), String> {
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let dir = current_exe
        .parent()
        .ok_or_else(|| "Diretorio do executavel nao encontrado".to_string())?
        .to_path_buf();
    let new_exe_path = dir.join(&info.asset_name);

    if new_exe_path == current_exe {
        return Err("O executavel atual ja possui o nome da nova versao".to_string());
    }

    let url = info.download_url.clone();
    let dest = new_exe_path.clone();
    let emit_window = window.clone();

    tauri::async_runtime::spawn_blocking(move || download_to_file(&url, &dest, &emit_window))
        .await
        .map_err(|e| e.to_string())??;

    // Spawn the new exe, asking it to delete the old one once we exit.
    std::process::Command::new(&new_exe_path)
        .arg("--cleanup-old")
        .arg(current_exe.as_os_str())
        .spawn()
        .map_err(|e| format!("Falha ao iniciar o novo executavel: {e}"))?;

    // Exit the current process so the file lock releases and the new exe's
    // cleanup loop can delete the old binary.
    window.app_handle().exit(0);

    Ok(())
}

fn fetch_latest_release(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    let response = ureq::get(GITHUB_API_LATEST)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|e| format!("Falha ao consultar GitHub: {e}"))?;

    let release: serde_json::Value = response
        .into_json()
        .map_err(|e| format!("Resposta invalida: {e}"))?;

    let tag = release["tag_name"].as_str().unwrap_or("").trim();
    let latest = tag.trim_start_matches('v').trim_start_matches('V');
    if latest.is_empty() {
        return Ok(None);
    }
    if compare_versions(latest, current_version) <= 0 {
        return Ok(None);
    }

    let expected_name = format!("TodoApp-{}.exe", latest);
    let assets = release["assets"].as_array().cloned().unwrap_or_default();

    let asset = assets
        .iter()
        .find(|a| a["name"].as_str() == Some(expected_name.as_str()))
        .ok_or_else(|| format!("Asset '{expected_name}' nao encontrado no release"))?;

    let url = asset["browser_download_url"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if url.is_empty() {
        return Err("URL de download ausente".to_string());
    }

    let size = asset["size"].as_u64().unwrap_or(0);

    Ok(Some(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest.to_string(),
        download_url: url,
        asset_name: expected_name,
        size,
    }))
}

fn download_to_file(
    url: &str,
    dest: &Path,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let response = ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(60))
        .call()
        .map_err(|e| format!("Falha no download: {e}"))?;

    let total: u64 = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let _ = window.emit(
        "update-progress",
        serde_json::json!({ "phase": "started", "total": total }),
    );

    let mut reader = response.into_reader();
    let mut file = fs::File::create(dest).map_err(|e| format!("Falha ao criar arquivo: {e}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    loop {
        let n = reader
            .read(&mut buf)
            .map_err(|e| format!("Falha ao ler resposta: {e}"))?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n])
            .map_err(|e| format!("Falha ao escrever arquivo: {e}"))?;
        downloaded += n as u64;

        if downloaded - last_emit >= 128 * 1024 {
            last_emit = downloaded;
            let _ = window.emit(
                "update-progress",
                serde_json::json!({
                    "phase": "progress",
                    "downloaded": downloaded,
                    "total": total
                }),
            );
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    let _ = window.emit(
        "update-progress",
        serde_json::json!({
            "phase": "finished",
            "downloaded": downloaded,
            "total": total.max(downloaded)
        }),
    );

    Ok(())
}

fn compare_versions(a: &str, b: &str) -> i32 {
    let parse = |v: &str| -> Vec<u32> {
        v.split(|c: char| c == '.' || c == '-')
            .take(4)
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>())
            .map(|s| s.parse::<u32>().unwrap_or(0))
            .collect()
    };
    let va = parse(a);
    let vb = parse(b);
    for i in 0..va.len().max(vb.len()) {
        let na = *va.get(i).unwrap_or(&0);
        let nb = *vb.get(i).unwrap_or(&0);
        if na > nb {
            return 1;
        }
        if na < nb {
            return -1;
        }
    }
    0
}

fn cleanup_old_executable(path: &Path) {
    for _ in 0..60 {
        if !path.exists() {
            return;
        }
        if fs::remove_file(path).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

#[cfg(target_os = "windows")]
fn open_path(path: &Path) -> std::io::Result<()> {
    use std::process::Command;
    Command::new("cmd")
        .args(["/C", "start", "", &path.to_string_lossy()])
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_path(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_path(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

fn app_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(APP_FOLDER);
    fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(base)
}

fn ensure_user_dir(app: &tauri::AppHandle, user_id: &str) -> Result<PathBuf, String> {
    let dir = app_root(app)?.join(sanitize_segment(user_id));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sanitize_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn unique_filename(dir: &Path, requested: &str) -> String {
    if !dir.join(requested).exists() {
        return requested.to_string();
    }
    let path = PathBuf::from(requested);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut i = 2;
    loop {
        let candidate = format!("{}-{}{}", stem, i, ext);
        if !dir.join(&candidate).exists() {
            return candidate;
        }
        i += 1;
    }
}

fn init_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let root = app_root(app)?;
    let db_path = root.join(DB_FILE);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            json TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        );",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn position_panel(window: &WebviewWindow, expanded: bool) -> Result<PanelGeometry, String> {
    let monitor = window
        .current_monitor()
        .map_err(|err| err.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "No monitor is available".to_string())?;

    let screen_size = monitor.size();
    let screen_pos = monitor.position();
    let screen_width = screen_size.width;
    let screen_height = screen_size.height;

    let expanded_height = ((screen_height as f64) * HEIGHT_RATIO).round() as u32;
    let height = if expanded {
        expanded_height
    } else {
        COLLAPSED_HEIGHT
    };
    let y = screen_pos.y + ((screen_height.saturating_sub(height)) / 2) as i32;

    let max_width = screen_width.saturating_sub(24).max(COLLAPSED_WIDTH);
    let preferred_width = ((screen_width as f64) * 0.50).round() as u32;
    let max_panel_width = max_width.saturating_sub(HANDLE_GUTTER).max(COLLAPSED_WIDTH);
    let panel_width = preferred_width.clamp(620, 2000).min(max_panel_width);
    let expanded_width = panel_width + HANDLE_GUTTER;
    let width = if expanded {
        expanded_width
    } else {
        COLLAPSED_WIDTH
    };

    let x = screen_pos.x + screen_width as i32 - width as i32 - RIGHT_MARGIN;

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|err| err.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|err| err.to_string())?;

    Ok(PanelGeometry {
        collapsed_width: COLLAPSED_WIDTH,
        expanded_width,
        height,
        x,
        y,
    })
}

fn tray_icon_image() -> Option<tauri::image::Image<'static>> {
    static DATA: OnceLock<Option<(Vec<u8>, u32, u32)>> = OnceLock::new();
    let entry = DATA.get_or_init(|| {
        let bytes = include_bytes!("../../assets/icon.ico");
        let dir = ico::IconDir::read(Cursor::new(bytes.as_ref())).ok()?;
        let largest = dir.entries().iter().max_by_key(|e| e.width())?;
        let img = largest.decode().ok()?;
        Some((img.rgba_data().to_vec(), img.width(), img.height()))
    });
    entry
        .as_ref()
        .map(|(rgba, w, h)| tauri::image::Image::new(rgba.as_slice(), *w, *h))
}

fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show_item = MenuItemBuilder::with_id("tray_show", "Mostrar").build(app)?;
    let hide_item = MenuItemBuilder::with_id("tray_hide", "Ocultar").build(app)?;
    let quit_item = MenuItemBuilder::with_id("tray_quit", "Sair").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .item(&hide_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = tray_icon_image()
        .or_else(|| app.default_window_icon().cloned())
        .expect("Tray icon could not be loaded from assets/icon.ico");

    TrayIconBuilder::with_id("main-tray")
        .tooltip("TODOCompanion")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = position_panel(&window, true);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray_hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "tray_quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = position_panel(&window, true);
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() >= 3 && args[1] == "--cleanup-old" {
        cleanup_old_executable(Path::new(&args[2]));
    }

    #[cfg(target_os = "windows")]
    refresh_autostart_path_if_needed();

    tauri::Builder::default()
        .setup(|app| {
            let conn = init_db(app.handle()).map_err(|e| {
                eprintln!("Failed to initialize TODOCompanion database: {e}");
                e
            })?;
            app.manage(DbState(Mutex::new(conn)));

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_always_on_top(true);
                if let Err(err) = position_panel(&window, false) {
                    eprintln!("Failed to position TODOCompanion: {err}");
                }

                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            if let Err(err) = build_tray(app.handle()) {
                eprintln!("Failed to build system tray: {err}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            initialize_panel,
            set_panel_expanded,
            state_load,
            state_save,
            attachment_save_from_path,
            attachment_save_from_bytes,
            attachment_delete,
            attachment_open,
            check_for_update,
            download_and_apply_update,
            get_app_version,
            quit_app,
            get_autostart_enabled,
            set_autostart_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TODOCompanion");
}
