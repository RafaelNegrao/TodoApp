#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

const COLLAPSED_WIDTH: u32 = 34;
const COLLAPSED_HEIGHT: u32 = 64;
const HANDLE_GUTTER: u32 = 34;
const RIGHT_MARGIN: i32 = 5;
const HEIGHT_RATIO: f64 = 0.90;
const APP_FOLDER: &str = "TODOCompanion";
const DB_FILE: &str = "data.sqlite";

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

fn main() {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running TODOCompanion");
}
