#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::fs;
use std::collections::HashMap;
use std::io::{BufWriter, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use std::thread;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

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

#[derive(Clone, Copy)]
struct SavedMainWindowBounds {
    was_maximized: bool,
    position: Option<tauri::PhysicalPosition<i32>>,
    size: Option<tauri::PhysicalSize<u32>>,
}

#[derive(Default)]
struct FloatingTranslatorState(Mutex<Option<SavedMainWindowBounds>>);

#[tauri::command]
fn set_translator_floating_mode(
    app: tauri::AppHandle,
    state: State<'_, FloatingTranslatorState>,
    floating: bool,
    mode: Option<String>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Main window not found".to_string());
    };

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Floating translator state lock poisoned".to_string())?;

    if floating {
        let is_chat = mode.as_deref() == Some("chat");
        if guard.is_none() {
            let was_maximized = window.is_maximized().unwrap_or(false);
            let position = window.outer_position().ok();
            let size = window.inner_size().ok();
            *guard = Some(SavedMainWindowBounds {
                was_maximized,
                position,
                size,
            });
            if was_maximized {
                let _ = window.unmaximize();
            }
        }
        let (min_w, min_h, width, height) = if is_chat {
            (300.0, 340.0, 400.0, 560.0)
        } else {
            (240.0, 220.0, 340.0, 320.0)
        };
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(min_w, min_h)));
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.set_always_on_top(true);
        let _ = window.set_resizable(true);
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(820.0, 540.0)));
        if let Some(saved) = guard.take() {
            if saved.was_maximized {
                let _ = window.maximize();
            } else {
                if let Some(sz) = saved.size {
                    let _ = window.set_size(sz);
                } else {
                    let _ = window.set_size(tauri::LogicalSize::new(1180.0, 760.0));
                }
                if let Some(pos) = saved.position {
                    let _ = window.set_position(pos);
                }
            }
        } else {
            let _ = window.set_size(tauri::LogicalSize::new(1180.0, 760.0));
        }
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

#[tauri::command]
fn minimize_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
fn toggle_maximize_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_maximized().unwrap_or(false) {
            let _ = window.unmaximize();
        } else {
            let _ = window.maximize();
        }
    }
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

#[derive(Clone, Serialize, Deserialize, Default)]
struct AiChatAttachment {
    name: String,
    mime_type: String,
    #[serde(default)]
    data_base64: Option<String>,
    #[serde(default)]
    text_content: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct AiChatMessage {
    role: String,
    text: String,
    #[serde(default)]
    attachments: Vec<AiChatAttachment>,
}

fn build_schannel_agent(connect_timeout: Duration, total_timeout: Duration) -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(connect_timeout)
        .timeout(total_timeout);
    if let Ok(tls) = native_tls::TlsConnector::new() {
        builder = builder.tls_connector(Arc::new(tls));
    }
    builder.build()
}

fn default_http_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| build_schannel_agent(Duration::from_secs(10), Duration::from_secs(180)))
}

fn gemini_http_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| build_schannel_agent(Duration::from_secs(5), Duration::from_secs(25)))
}

fn gemini_translate_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| build_schannel_agent(Duration::from_secs(3), Duration::from_secs(5)))
}

// Cascata completa de modelos de texto da API Gemini/Gemma ordenada por velocidade real
// (benchmark medido) + maior cota diaria (RPD):
// 1. Top rapidos e alta cota (500 RPD, ~800ms): gemini-3.1-flash-lite, gemini-3.5-flash-lite
// 2. Fallbacks rapidos com cota ativa (20 RPD): robotics-er-2, 3-flash, 3.6-flash, 4-hydrogen, 3.8-flash
// 3. Cota gigante de seguranca (14.4K RPD): gemma-4-26b-a4b-it, gemma-4-31b-it
// 4. Demais modelos de texto da API como ultimo recurso caso tenham cota liberada
const GEMINI_MODEL_CASCADE: &[&str] = &[
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-3.1-pro-preview",
    "gemini-pro-latest",
    "gemma-3-27b-it",
    "gemma-3-12b-it",
    "gemma-3-4b-it",
];

fn is_deprecated_gemini_model(model: &str) -> bool {
    let lower = model.trim().to_lowercase();
    lower.starts_with("gemini-2.0")
        || lower.starts_with("gemini-1.5")
        || lower.starts_with("gemini-1.0")
}

fn gemini_dead_models() -> &'static Mutex<std::collections::HashSet<String>> {
    static DEAD: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    DEAD.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn mark_model_unavailable(model: &str) {
    if let Ok(mut set) = gemini_dead_models().lock() {
        set.insert(model.to_string());
    }
}

fn is_model_marked_unavailable(model: &str) -> bool {
    gemini_dead_models()
        .lock()
        .map(|set| set.contains(model))
        .unwrap_or(false)
}

fn discover_available_gemini_models(key: &str) -> Vec<String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models?key={}&pageSize=100",
        key
    );
    let Ok(resp) = gemini_translate_agent().get(&url).call() else {
        return Vec::new();
    };
    let Ok(body) = resp.into_json::<serde_json::Value>() else {
        return Vec::new();
    };
    let Some(arr) = body["models"].as_array() else {
        return Vec::new();
    };

    let mut flash = Vec::new();
    let mut pro = Vec::new();
    let mut other = Vec::new();

    for item in arr {
        let supports_gen = item["supportedGenerationMethods"]
            .as_array()
            .map(|methods| methods.iter().any(|m| m.as_str() == Some("generateContent")))
            .unwrap_or(false);
        if !supports_gen {
            continue;
        }
        let Some(raw_name) = item["name"].as_str() else {
            continue;
        };
        let name = raw_name.strip_prefix("models/").unwrap_or(raw_name).trim();
        let lower = name.to_lowercase();
        if name.is_empty()
            || is_deprecated_gemini_model(name)
            || is_model_marked_unavailable(name)
            || lower.contains("embedding")
            || lower.contains("imagen")
            || lower.contains("veo")
            || lower.contains("tts")
            || lower.contains("audio")
            || lower.contains("robotics")
            || lower.contains("computer-use")
        {
            continue;
        }
        if lower.contains("flash") {
            flash.push(name.to_string());
        } else if lower.contains("pro") {
            pro.push(name.to_string());
        } else if lower.starts_with("gemini-") || lower.starts_with("gemma-") {
            other.push(name.to_string());
        }
    }

    let mut combined = Vec::new();
    combined.extend(flash);
    combined.extend(pro);
    combined.extend(other);
    combined
}

fn model_prefers_minimal_thinking(model: &str) -> bool {
    matches!(
        model,
        "gemini-3-flash-preview" | "gemini-flash-latest"
    )
}

fn gemini_model_cooldowns() -> &'static Mutex<HashMap<String, Instant>> {
    static COOLDOWNS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    COOLDOWNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn mark_model_cooldown(model: &str, duration: Duration) {
    if let Ok(mut map) = gemini_model_cooldowns().lock() {
        map.insert(model.to_string(), Instant::now() + duration);
    }
}

fn is_token_limit_error(status: u16, err_lower: &str) -> bool {
    let mentions_tokens = err_lower.contains("token")
        || err_lower.contains("payload size")
        || err_lower.contains("request payload")
        || err_lower.contains("too large")
        || err_lower.contains("context length");
    if status == 429 && mentions_tokens {
        return true;
    }
    if matches!(status, 400 | 413) && mentions_tokens {
        return true;
    }
    false
}

fn is_gemini_supported_inline_mime(mime: &str) -> bool {
    let m = mime.trim().to_lowercase();
    matches!(
        m.as_str(),
        "image/png"
            | "image/jpeg"
            | "image/jpg"
            | "image/webp"
            | "image/gif"
            | "image/heic"
            | "image/heif"
            | "application/pdf"
            | "audio/wav"
            | "audio/mp3"
            | "audio/mpeg"
            | "audio/aiff"
            | "audio/aac"
            | "audio/ogg"
            | "audio/flac"
            | "audio/mp4"
            | "audio/x-m4a"
            | "video/mp4"
            | "video/mpeg"
            | "video/mov"
            | "video/quicktime"
            | "video/avi"
            | "video/x-flv"
            | "video/mpg"
            | "video/webm"
            | "video/wmv"
            | "video/3gpp"
    )
}

fn is_gemma_supported_inline_mime(mime: &str) -> bool {
    let m = mime.trim().to_lowercase();
    matches!(m.as_str(), "image/png" | "image/jpeg" | "image/jpg" | "image/webp" | "image/gif")
}

fn sanitize_payload_for_gemma(mut payload: serde_json::Value) -> serde_json::Value {
    if let Some(contents) = payload.get_mut("contents").and_then(|c| c.as_array_mut()) {
        for entry in contents.iter_mut() {
            if let Some(parts) = entry.get_mut("parts").and_then(|p| p.as_array_mut()) {
                for part in parts.iter_mut() {
                    let unsupported_mime = part
                        .get("inlineData")
                        .and_then(|d| d.get("mimeType"))
                        .and_then(|m| m.as_str())
                        .filter(|mime| !is_gemma_supported_inline_mime(mime))
                        .map(|m| m.to_string());
                    if let Some(mime) = unsupported_mime {
                        *part = serde_json::json!({
                            "text": format!("[Anexo binário ({mime}) não suportado diretamente por este modelo de fallback]")
                        });
                    }
                }
            }
        }
    }
    payload
}

fn truncate_utf8_chars(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let truncated: String = input.chars().take(max_chars).collect();
    format!("{truncated}\n...[conteúdo resumido para caber no limite de tokens do modelo]")
}

fn compact_payload_for_token_budget(
    payload: &serde_json::Value,
    max_part_chars: usize,
    keep_only_last_inline_data: bool,
) -> serde_json::Value {
    let mut compacted = payload.clone();

    if let Some(sys_parts) = compacted
        .get_mut("systemInstruction")
        .and_then(|s| s.get_mut("parts"))
        .and_then(|p| p.as_array_mut())
    {
        for part in sys_parts.iter_mut() {
            if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                let trimmed = truncate_utf8_chars(txt, 8000);
                part["text"] = serde_json::Value::String(trimmed);
            }
        }
    }

    if let Some(contents) = compacted.get_mut("contents").and_then(|c| c.as_array_mut()) {
        let last_idx = contents.len().saturating_sub(1);
        for (idx, entry) in contents.iter_mut().enumerate() {
            let is_last = idx == last_idx;
            let limit = if is_last { max_part_chars } else { 1800 };
            if let Some(parts) = entry.get_mut("parts").and_then(|p| p.as_array_mut()) {
                for part in parts.iter_mut() {
                    if let Some(txt) = part.get("text").and_then(|t| t.as_str()) {
                        if txt.chars().count() > limit {
                            part["text"] = serde_json::Value::String(truncate_utf8_chars(txt, limit));
                        }
                    } else if keep_only_last_inline_data && !is_last && part.get("inlineData").is_some() {
                        let mime = part["inlineData"]["mimeType"]
                            .as_str()
                            .unwrap_or("application/octet-stream");
                        *part = serde_json::json!({
                            "text": format!("[Anexo anterior ({mime}) omitido para economizar tokens]")
                        });
                    }
                }
            }
        }
    }

    compacted
}

fn is_quota_exhausted_error(status: u16, err_lower: &str) -> bool {
    if status == 429 {
        return true;
    }
    if matches!(status, 403 | 503) {
        return err_lower.contains("resource_exhausted")
            || err_lower.contains("quota")
            || err_lower.contains("rate limit")
            || err_lower.contains("rate_limit")
            || err_lower.contains("too many requests")
            || err_lower.contains("requests per minute")
            || err_lower.contains("requests per day")
            || err_lower.contains("tokens per minute");
    }
    false
}

fn quota_cooldown_duration(err_lower: &str) -> Duration {
    let is_daily_or_zero_limit = err_lower.contains("perday")
        || err_lower.contains("per_day")
        || err_lower.contains("per day")
        || err_lower.contains("daily")
        || err_lower.contains("limit: 0")
        || err_lower.contains("free_tier_requests")
        || err_lower.contains("generaterequestsperday");

    if is_daily_or_zero_limit {
        Duration::from_secs(1800)
    } else {
        Duration::from_secs(65)
    }
}

fn partition_models_by_availability(candidates: Vec<String>) -> (Vec<String>, Vec<String>) {
    let now = Instant::now();
    let mut ready = Vec::new();
    let mut cooling: Vec<(String, Instant)> = Vec::new();

    if let Ok(mut map) = gemini_model_cooldowns().lock() {
        map.retain(|_, &mut until| until > now);
        for m in candidates {
            if let Some(&until) = map.get(&m) {
                if until > now {
                    cooling.push((m, until));
                    continue;
                }
            }
            ready.push(m);
        }
    } else {
        return (candidates, Vec::new());
    }

    cooling.sort_by_key(|(_, until)| *until);
    let cooling_ordered = cooling.into_iter().map(|(m, _)| m).collect();
    (ready, cooling_ordered)
}

fn order_models_by_availability(candidates: Vec<String>) -> Vec<String> {
    let (mut ready, cooling) = partition_models_by_availability(candidates);
    ready.extend(cooling);
    ready
}

fn normalize_gemini_contents(raw_contents: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let mut normalized: Vec<serde_json::Value> = Vec::new();

    for entry in raw_contents {
        let role = entry
            .get("role")
            .and_then(|r| r.as_str())
            .unwrap_or("user")
            .to_string();
        let parts = entry
            .get("parts")
            .and_then(|p| p.as_array())
            .cloned()
            .unwrap_or_default();
        if parts.is_empty() {
            continue;
        }
        if normalized.is_empty() && role != "user" {
            continue;
        }
        if let Some(last) = normalized.last_mut() {
            let last_role = last.get("role").and_then(|r| r.as_str()).unwrap_or("");
            if last_role == role {
                if let Some(last_parts) = last.get_mut("parts").and_then(|p| p.as_array_mut()) {
                    last_parts.extend(parts);
                    continue;
                }
            }
        }
        normalized.push(serde_json::json!({
            "role": role,
            "parts": parts
        }));
    }

    normalized
}

fn resolve_gemini_key_and_models(api_key: Option<String>) -> Result<(String, Vec<String>), String> {
    let env_vars = load_dotenv_vars();
    let provided = api_key.unwrap_or_default().trim().to_string();
    let key = if !provided.is_empty() {
        provided
    } else {
        env_vars.get("GEMINI_API_KEY").cloned().unwrap_or_default()
    };

    if key.is_empty() {
        return Err("GEMINI_API_KEY nao encontrada no .env ou Settings".to_string());
    }

    let env_model = env_vars
        .get("GEMINI_MODEL")
        .cloned()
        .unwrap_or_else(|| "gemini-2.5-flash".to_string());

    let mut models = Vec::new();
    let trimmed_env = env_model.trim();
    if !trimmed_env.is_empty() && !is_deprecated_gemini_model(trimmed_env) {
        models.push(trimmed_env.to_string());
    }
    for &fb in GEMINI_MODEL_CASCADE {
        if !models.iter().any(|m| m == fb) {
            models.push(fb.to_string());
        }
    }

    let active_models: Vec<String> = models
        .into_iter()
        .filter(|m| !is_model_marked_unavailable(m))
        .collect();

    Ok((key, order_models_by_availability(active_models)))
}

fn describe_formality(formality: u8) -> &'static str {
    match formality {
        0..=20 => "very natural, casual, conversational everyday native speech (contractions, idioms, relaxed tone)",
        21..=44 => "natural and friendly everyday spoken/chat tone (clear, modern, not stiff)",
        45..=65 => "balanced, clear, natural professional tone suitable for workplace chat (e.g. Microsoft Teams/Slack)",
        66..=85 => "formal, polished corporate/business tone suitable for professional emails and presentations",
        _ => "highly formal, executive, diplomatic and rigorous corporate register",
    }
}

fn fold_system_instruction_into_user(mut payload: serde_json::Value) -> serde_json::Value {
    let sys_text = payload
        .get("systemInstruction")
        .and_then(|s| s.get("parts"))
        .and_then(|p| p.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if let Some(obj) = payload.as_object_mut() {
        obj.remove("systemInstruction");
    }

    if !sys_text.is_empty() {
        if let Some(parts) = payload
            .get_mut("contents")
            .and_then(|c| c.as_array_mut())
            .and_then(|arr| arr.first_mut())
            .and_then(|first| first.get_mut("parts"))
            .and_then(|p| p.as_array_mut())
        {
            parts.insert(0, serde_json::json!({ "text": format!("{sys_text}\n\n---\n") }));
        }
    }
    payload
}

fn execute_gemini_fast_payload(
    key: &str,
    models: &[String],
    payload: serde_json::Value,
    use_short_timeout: bool,
) -> Result<String, String> {
    execute_gemini_fast_payload_with_model(key, models, payload, use_short_timeout)
        .map(|(text, _)| text)
}

fn execute_gemini_fast_payload_with_model(
    key: &str,
    models: &[String],
    payload: serde_json::Value,
    use_short_timeout: bool,
) -> Result<(String, String), String> {
    let agent = if use_short_timeout {
        gemini_translate_agent()
    } else {
        gemini_http_agent()
    };
    let mut last_err = String::from("Falha ao contatar a API do Gemini");

    let mut payload_fast_think = payload.clone();
    payload_fast_think["generationConfig"]["thinkingConfig"] = serde_json::json!({
        "thinkingLevel": "MINIMAL"
    });
    let payload_compat = fold_system_instruction_into_user(payload.clone());
    let payload_compact = compact_payload_for_token_budget(&payload, 14000, true);
    let payload_gemma = sanitize_payload_for_gemma(payload_compat.clone());
    let payload_gemma_compact = sanitize_payload_for_gemma(fold_system_instruction_into_user(
        compact_payload_for_token_budget(&payload, 10000, true),
    ));

    let mut tried = std::collections::HashSet::<String>::new();
    let filtered_models: Vec<String> = models
        .iter()
        .filter(|m| !is_deprecated_gemini_model(m) && !is_model_marked_unavailable(m))
        .cloned()
        .collect();
    let (mut ready_queue, mut cooling_queue) = partition_models_by_availability(filtered_models);
    let mut discovered_fallback = false;
    let mut tried_cooling_fallback = false;
    let mut saw_rate_limit = false;
    let mut saw_token_limit = false;
    let mut saw_auth_error = false;

    loop {
        if ready_queue.is_empty() {
            if !discovered_fallback {
                discovered_fallback = true;
                let fresh: Vec<String> = discover_available_gemini_models(key)
                    .into_iter()
                    .filter(|m| !tried.contains(m))
                    .collect();
                if !fresh.is_empty() {
                    let (fresh_ready, fresh_cooling) = partition_models_by_availability(fresh);
                    ready_queue.extend(fresh_ready);
                    for m in fresh_cooling {
                        if !cooling_queue.iter().any(|existing| existing == &m) {
                            cooling_queue.push(m);
                        }
                    }
                    if !ready_queue.is_empty() {
                        continue;
                    }
                }
            }
            if !tried_cooling_fallback && !cooling_queue.is_empty() {
                tried_cooling_fallback = true;
                ready_queue.extend(cooling_queue.drain(..));
                continue;
            }
            break;
        }

        let model = ready_queue.remove(0);
        if !tried.insert(model.clone()) {
            continue;
        }

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, key
        );

        let candidates = if model.starts_with("gemma-") {
            vec![&payload_gemma, &payload_gemma_compact]
        } else if model_prefers_minimal_thinking(&model) {
            vec![&payload_fast_think, &payload, &payload_compat, &payload_compact]
        } else {
            vec![&payload, &payload_compat, &payload_compact]
        };

        for (cand_idx, candidate_payload) in candidates.iter().enumerate() {
            match agent
                .post(&url)
                .set("Content-Type", "application/json")
                .send_json((*candidate_payload).clone())
            {
                Ok(resp) => {
                    let body: serde_json::Value = resp
                        .into_json()
                        .map_err(|e| format!("Resposta invalida do Gemini: {e}"))?;
                    let mut combined = String::new();
                    if let Some(parts) = body["candidates"][0]["content"]["parts"].as_array() {
                        for p in parts {
                            if p.get("thought").and_then(|v| v.as_bool()).unwrap_or(false) {
                                continue;
                            }
                            if let Some(t) = p["text"].as_str() {
                                combined.push_str(t);
                            }
                        }
                    }
                    let final_text = combined.trim();
                    if !final_text.is_empty() {
                        return Ok((final_text.to_string(), model.clone()));
                    }
                }
                Err(ureq::Error::Status(code, resp)) => {
                    let err_body = resp.into_string().unwrap_or_default();
                    let err_lower = err_body.to_lowercase();
                    last_err = format!("Gemini HTTP {code} ({model}): {err_body}");
                    if is_token_limit_error(code, &err_lower) {
                        saw_token_limit = true;
                        if cand_idx + 1 < candidates.len() {
                            continue;
                        }
                        mark_model_cooldown(&model, Duration::from_secs(20));
                        break;
                    }
                    if is_quota_exhausted_error(code, &err_lower) {
                        saw_rate_limit = true;
                        mark_model_cooldown(&model, quota_cooldown_duration(&err_lower));
                        break;
                    }
                    if code == 401 || code == 403 {
                        if err_lower.contains("api key") || err_lower.contains("invalid") {
                            saw_auth_error = true;
                            break;
                        }
                    }
                    if code == 503 || code == 502 || code == 500 || code == 504 {
                        mark_model_cooldown(&model, Duration::from_secs(45));
                        break;
                    }
                    if code == 404
                        || code == 410
                        || err_lower.contains("no longer available")
                        || err_lower.contains("not found")
                        || err_lower.contains("deprecated")
                    {
                        mark_model_unavailable(&model);
                        break;
                    }
                    if code == 400
                        && (err_body.contains("thinkingConfig")
                            || err_body.contains("systemInstruction")
                            || err_body.contains("Developer instruction"))
                    {
                        continue;
                    }
                    break;
                }
                Err(e) => {
                    last_err = format!("Erro de rede ao chamar Gemini ({model}): {e}");
                    mark_model_cooldown(&model, Duration::from_secs(15));
                    break;
                }
            }
        }
    }

    if saw_auth_error {
        return Err("Chave da API Gemini inválida ou sem permissão. Verifique em Configurações.".to_string());
    }
    if saw_token_limit && !saw_rate_limit {
        return Err("Os arquivos anexados excederam o limite de tokens/tamanho da API Gemini. Tente enviar arquivos menores ou menos arquivos por vez.".to_string());
    }
    if saw_rate_limit {
        return Err("Limite temporário de requisições da API Gemini atingido. Aguarde alguns segundos e tente novamente.".to_string());
    }
    Err(last_err)
}

fn sanitize_translation_output(source: &str, raw_output: String) -> String {
    let trimmed_src = source.trim();
    let trimmed_out = raw_output.trim();
    if trimmed_src.is_empty() || trimmed_out.is_empty() {
        return trimmed_out.to_string();
    }

    // Se a entrada for de linha unica e o modelo tiver repetido a frase original na primeira linha
    // seguida da traducao na linha de baixo, remove o eco da linha original.
    if !trimmed_src.contains('\n') && trimmed_out.contains('\n') {
        let lines: Vec<&str> = trimmed_out
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .collect();
        if lines.len() >= 2 && lines[0].eq_ignore_ascii_case(trimmed_src) {
            return lines[1..].join("\n");
        }
        if lines.len() >= 2 && lines[0].to_lowercase() == trimmed_src.to_lowercase() {
            return lines[1..].join("\n");
        }
    }

    trimmed_out.to_string()
}

#[tauri::command]
async fn ai_translate_fast(
    text: String,
    formality: u8,
    direction: String,
    api_key: Option<String>,
) -> Result<String, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let (key, mut models) = resolve_gemini_key_and_models(api_key)?;
    // Cascata completa de modelos ordenados por velocidade e disponibilidade:
    // Se um modelo der HTTP 429 (cota excedida) ou 503, o sistema desce automaticamente
    // para o proximo modelo disponivel e memoriza o cooldown para nao travar as proximas traducoes.
    let fast_priority = GEMINI_MODEL_CASCADE;
    let mut ordered_models: Vec<String> = fast_priority.iter().map(|s| (*s).to_string()).collect();
    for m in models.drain(..) {
        if !ordered_models.iter().any(|existing| existing == &m) {
            ordered_models.push(m);
        }
    }
    let ordered_models = order_models_by_availability(ordered_models);

    let tone = describe_formality(formality);
    let dir_instruction = match direction.as_str() {
        "pt-en" => "Translate the user's text from Brazilian Portuguese into English.",
        "en-pt" => "Translate the user's text from English into Brazilian Portuguese.",
        _ => "Auto-detect the input language: if it is in Portuguese, translate it into English. If it is in English, translate it into Brazilian Portuguese.",
    };

    tauri::async_runtime::spawn_blocking(move || {
        let system_prompt = format!(
            "You are an instant real-time translator between Brazilian Portuguese and English.\n\
             Task: {dir_instruction}\n\
             Register / Formality ({formality}/100): Use a {tone}.\n\
             Strict Rules:\n\
             1. Output ONLY the translated text in the target language. NEVER repeat or echo the original input text.\n\
             2. Even for short phrases or titles, noticeably adapt vocabulary and phrasing to match the requested register ({tone}).\n\
             3. Preserve original line breaks when translating multi-line text."
        );

        let payload = serde_json::json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": [{
                "role": "user",
                "parts": [{ "text": trimmed.clone() }]
            }],
            "generationConfig": {
                "temperature": 0.2
            }
        });

        let raw = execute_gemini_fast_payload(&key, &ordered_models, payload, true)?;
        Ok(sanitize_translation_output(&trimmed, raw))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct AiChatReply {
    text: String,
    model: String,
}

#[cfg(target_os = "windows")]
mod win_screen_snapshot {
    use super::encode_base64;
    use std::ptr;
    use std::thread;
    use std::time::Duration;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC,
        GetMonitorInfoW, MonitorFromWindow, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt,
        BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HALFTONE, HGDIOBJ, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SetWindowDisplayAffinity, SM_CXSCREEN, SM_CYSCREEN,
        WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    const MAX_CAPTURE_WIDTH: i32 = 1440;

    fn encode_rgb_to_png(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity((width * height) as usize);
        {
            let mut encoder = png::Encoder::new(&mut out, width, height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_compression(png::Compression::Fast);
            let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
            writer.write_image_data(rgb).map_err(|e| e.to_string())?;
        }
        Ok(out)
    }

    pub fn capture_monitor_png_base64(raw_hwnd: isize) -> Result<String, String> {
        unsafe {
            let hwnd = HWND(raw_hwnd as *mut std::ffi::c_void);
            let excluded = if !hwnd.0.is_null() {
                let ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE).is_ok();
                if ok {
                    thread::sleep(Duration::from_millis(20));
                }
                ok
            } else {
                false
            };

            let capture_res = capture_monitor_inner(hwnd);

            if excluded {
                let _ = SetWindowDisplayAffinity(hwnd, WDA_NONE);
            }

            capture_res
        }
    }

    unsafe fn capture_monitor_inner(hwnd: HWND) -> Result<String, String> {
        let mut left = 0;
        let mut top = 0;
        let mut src_w = GetSystemMetrics(SM_CXSCREEN).max(640);
        let mut src_h = GetSystemMetrics(SM_CYSCREEN).max(480);

        if !hwnd.0.is_null() {
            let hmon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(hmon, &mut mi).as_bool() {
                let r = mi.rcMonitor;
                let w = r.right - r.left;
                let h = r.bottom - r.top;
                if w > 0 && h > 0 {
                    left = r.left;
                    top = r.top;
                    src_w = w;
                    src_h = h;
                }
            }
        }

        let (out_w, out_h) = if src_w > MAX_CAPTURE_WIDTH {
            let scale = (MAX_CAPTURE_WIDTH as f64) / (src_w as f64);
            (
                MAX_CAPTURE_WIDTH,
                ((src_h as f64) * scale).round().max(1.0) as i32,
            )
        } else {
            (src_w, src_h)
        };

        let hdc_screen = GetDC(None);
        if hdc_screen.is_invalid() {
            return Err("Nao foi possivel obter DC da tela".to_string());
        }
        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.is_invalid() {
            let _ = ReleaseDC(None, hdc_screen);
            return Err("Falha ao criar DC em memoria".to_string());
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: out_w,
                biHeight: -out_h, // Top-down DIB para conversao direta em PNG
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: (out_w * out_h * 4) as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut dib_bits: *mut std::ffi::c_void = ptr::null_mut();
        let Ok(hbitmap) = CreateDIBSection(
            Some(hdc_mem),
            &bmi,
            DIB_RGB_COLORS,
            &mut dib_bits,
            None,
            0,
        ) else {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return Err("Falha ao alocar DIBSection".to_string());
        };
        if hbitmap.is_invalid() || dib_bits.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return Err("DIBSection invalida".to_string());
        }

        let old_obj: HGDIOBJ = SelectObject(hdc_mem, hbitmap.into());
        let blit_ok = if out_w == src_w && out_h == src_h {
            BitBlt(
                hdc_mem,
                0,
                0,
                out_w,
                out_h,
                Some(hdc_screen),
                left,
                top,
                SRCCOPY,
            )
            .is_ok()
        } else {
            let _ = SetStretchBltMode(hdc_mem, HALFTONE);
            StretchBlt(
                hdc_mem,
                0,
                0,
                out_w,
                out_h,
                Some(hdc_screen),
                left,
                top,
                src_w,
                src_h,
                SRCCOPY,
            )
            .as_bool()
        };

        let result = if blit_ok {
            let pixel_count = (out_w * out_h) as usize;
            let bgra = std::slice::from_raw_parts(dib_bits as *const u8, pixel_count * 4);
            let mut rgb = Vec::with_capacity(pixel_count * 3);
            for px in bgra.chunks_exact(4) {
                rgb.push(px[2]); // R
                rgb.push(px[1]); // G
                rgb.push(px[0]); // B
            }
            encode_rgb_to_png(&rgb, out_w as u32, out_h as u32).map(|png| encode_base64(&png))
        } else {
            Err("Falha ao capturar tela".to_string())
        };

        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        result
    }
}

#[tauri::command]
async fn capture_current_monitor_png(app: tauri::AppHandle) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Err("Captura de tela disponivel apenas no Windows".to_string())
    }

    #[cfg(target_os = "windows")]
    {
        let raw_hwnd = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize)
            .unwrap_or(0);
        tauri::async_runtime::spawn_blocking(move || {
            win_screen_snapshot::capture_monitor_png_base64(raw_hwnd)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
async fn ai_chat_english(
    messages: Vec<AiChatMessage>,
    formality: u8,
    api_key: Option<String>,
    app_context: Option<String>,
) -> Result<AiChatReply, String> {
    if messages.is_empty() {
        return Ok(AiChatReply {
            text: String::new(),
            model: String::new(),
        });
    }

    let (key, models) = resolve_gemini_key_and_models(api_key)?;
    let _ = formality;
    let ctx_json = app_context.unwrap_or_else(|| "{}".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let system_prompt = format!(
            "You are the integrated AI Agent of TODOCompanion with full visibility and control over the entire application.\n\
             You can hold natural multi-turn conversations, ask clarifying questions, suggest improvements, analyze attached images/PDFs/audio/files, summarize tasks/cards across the entire app, AND propose actions to control the app (users, tasks, action cards, Excel table cards, Todo List table cards, checklists, per-row connections, canvas layout, clipboard copy, navigation, and settings).\n\
             Always reply in the same language the user writes in.\n\n\
             APP FEATURES & CAPABILITIES (know everything the app has):\n\
             1. Hierarchy: Users -> Main Tasks (status: ongoing|stopped|complete, priority: low|normal|high|urgent, criticality: 0|1|2, startDate, endDate, attachments) -> Canvas Cards & Links.\n\
             2. Card Types:\n\
                - Action Card (type: \"action\"): plain text with '\\n' for line breaks, optional inline checklists (\"[ ] item\" / \"[x] item\"), inline images, inline video player (\"![video](userId/file)\" for recorded/attached videos), attachment chips (\"@[name](attachment:id)\"). NEVER put HTML tags like <br>, <p>, <div>, <strong>, <em>, <span> in card bodies or table cells — always use '\\n' for line breaks and plain text.\n\
                - Table Card (type: \"table\", hasCheckboxes: false): the table itself IS the card (compact minimal borders, no bottom format bar, auto-fit height, individual input & output connection ports on EVERY ROW, horizontal resize).\n\
                - Todo List Table Card (type: \"table\", hasCheckboxes: true): same clean table-card style with interactive checkboxes (\"[ ]\" / \"[x]\") in column A + per-row input/output connection ports.\n\
                - Image Card (type: \"image\"): standalone visual image card with fullscreen preview.\n\
             3. Excel Formula Engine in Tables (EN & PT-BR, supports nested formulas, ';'/',' separators, '%', '&', '$A$1', ranges A1:C5, and checkbox booleans TRUE/FALSE in Todo tables):\n\
                - Math/Aggregation: SUM/SOMA, AVERAGE/AVG/MEDIA, MIN/MINIMO, MAX/MAXIMO, MEDIAN/MED, PRODUCT/MULT, COUNT/CONT/CONT.NUM, COUNTA/CONT.VALORES, COUNTBLANK/CONTAR.VAZIO, ABS, ROUND/ARRED, ROUNDUP, ROUNDDOWN, INT, SQRT/RAIZ, POWER/POTENCIA, MOD.\n\
                - Logic & Conditional: IF/SE, AND/E, OR/OU, NOT/NAO, IFERROR/SEERRO, SUMIF/SOMASE, COUNTIF/CONT.SE, AVERAGEIF/MEDIASE.\n\
                - Text, Lookup & Date: CONCAT/CONCATENAR, UPPER/MAIUSCULA, LOWER/MINUSCULA, LEN/NUM.CARACT, TRIM/ARRUMAR, LEFT/ESQUERDA, RIGHT/DIREITA, MID/EXT.TEXTO, VLOOKUP/PROCV, TODAY/HOJE, NOW/AGORA.\n\
             4. Per-row Connections: Table cards and Todo List table cards have input & output ports on every row (0-indexed: fromRow, toRow in connect_cards).\n\
             5. Attachments & Recordings: Native screen+audio (.mp4) and audio-only (.m4a) recording saved in task's anexos folder, automatic sync with disk folder, rename/delete with confirmation, AI transcription, and inline video playback directly inside cards (use \"![video](userId/file)\" referencing an existing attachment from task.attachments).\n\
             6. IMPORTANT CARD SELECTION RULE:\n\
                - Whenever the user asks to create a table (\"tabela\", \"planilha\", \"orçamento\", \"cronograma em tabela\") -> ALWAYS use \"create_table_card\" with \"hasCheckboxes\": false (and use real Excel formulas like =SOMA(B2:B4) when totals/calculations make sense!).\n\
                - Whenever the user asks to create a Todo List table (\"todo list\", \"lista de todo\", \"tabela de tarefas\", \"tabela com checkbox\") -> ALWAYS use \"create_table_card\" with \"hasCheckboxes\": true (put \"[ ]\" or \"[x]\" in column 0, followed by task columns).\n\
                - NEVER use plain text \"create_card\" when the user asks for a table or Todo List table!\n\
             7. Live Screen Vision (Floating Mini-Chat):\n\
                - When the user asks a question from the floating mini-chat, a live screenshot of their current monitor (current_screen.png) is automatically attached.\n\
                - Look directly at what is visible on the user's screen (fields, labels, forms, buttons, errors, code, processes) and answer directly, clearly, and concisely about what you see.\n\
                - Do NOT propose [[APP_ACTIONS]] when the user is just asking about what is on their screen, unless they explicitly ask to create/edit something in TODOCompanion.\n\n\
             INTERACTIVE QUESTIONS & CLARIFICATION RULE:\n\
             - NEVER ask a plain-text 'Você tem certeza?' / 'Are you sure?' when the user's request is already clear (including destructive requests like deleting tasks/cards/users). Instead, go straight to [[APP_ACTIONS]] — the UI already shows an interactive confirmation card with 'Permitir e executar' and 'Recusar' buttons.\n\
             - Whenever you DO need to ask the user a question (ambiguous request, multiple matching tasks/cards/users, choosing between options, collecting parameters/dates/priorities/quantities, or offering next steps), you MUST include ONE interactive question block at the end of your reply using EXACTLY these tags and valid JSON (and omit [[APP_ACTIONS]] until the user answers):\n\
             [[APP_QUESTIONS]]\n\
             {{\"questions\":[{{\"id\":\"q1\",\"type\":\"choice|checkbox|chips|toggle|slider|rating|text|date\",\"prompt\":\"Question text\",\"multiSelect\":false,\"allowCustom\":true,\"options\":[{{\"label\":\"Option A\",\"value\":\"Option A\",\"description\":\"Short detail\",\"badge\":\"Recomendado\"}}]}}]}}\n\
             [[/APP_QUESTIONS]]\n\
             - Pick the richest control type for each question:\n\
               * \"choice\": single-select radio cards (supports label, description, optional badge).\n\
               * \"checkbox\": multi-select checkboxes (user checks several items and clicks Enviar).\n\
               * \"chips\": compact clickable tag pills (single or multiSelect:true, ideal for status/priority/columns/tags).\n\
               * \"toggle\": Yes/No sliding switch (optional onLabel, offLabel, defaultValue: true|false).\n\
               * \"slider\": numeric range slider (min, max, step, defaultValue, unit — e.g. rows/columns/percentage).\n\
               * \"rating\": 1-5 interactive star rating.\n\
               * \"text\" or \"date\": inline text input (placeholder, defaultValue) or date picker (YYYY-MM-DD).\n\
             - You can combine multiple different control types in the same [[APP_QUESTIONS]] card (e.g. a text title + chips for priority + toggle for checkboxes + date for deadline)!\n\n\
             CRITICAL ACTION & PERMISSION RULE:\n\
             Once the user's intent is clear and they want you to CREATE, EDIT, DELETE, DUPLICATE, MOVE, CONNECT, SHOW/OPEN, COPY, ORGANIZE, or CHANGE SETTINGS in the app, include ONE structured action block at the end of your reply using EXACTLY these tags and valid JSON:\n\
             [[APP_ACTIONS]]\n\
             {{\"summary\":\"Short description of what will be executed\",\"actions\":[...]}}\n\
             [[/APP_ACTIONS]]\n\
             - Non-destructive actions (creating users/tasks/cards/tables, editing, connecting, organizing, focusing, settings) execute AUTOMATICALLY right away — explain concisely what you are creating/doing without telling the user to click 'Permitir'.\n\
             - Destructive actions (delete_user, delete_task, delete_card, disconnect_cards) automatically show a confirmation card so the user can click 'Permitir e executar' or 'Recusar'.\n\
             If the user only asks a read-only question, answer directly without [[APP_ACTIONS]] (you may optionally include [[APP_QUESTIONS]] if offering clickable next steps).\n\n\
             AVAILABLE ACTION TYPES:\n\
             - {{\"type\":\"create_user\",\"name\":\"...\"}}\n\
             - {{\"type\":\"rename_user\",\"userId\":\"...\",\"userName\":\"...\",\"newName\":\"...\"}}\n\
             - {{\"type\":\"delete_user\",\"userId\":\"...\",\"userName\":\"...\"}}\n\
             - {{\"type\":\"select_user\",\"userId\":\"...\",\"userName\":\"...\"}}\n\
             - {{\"type\":\"create_task\",\"userId\":\"...\",\"userName\":\"...\",\"title\":\"...\",\"status\":\"ongoing|stopped|complete\",\"priority\":\"low|normal|high|urgent\",\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\"}}\n\
             - {{\"type\":\"update_task\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"title\":\"...\",\"status\":\"ongoing|stopped|complete\",\"priority\":\"low|normal|high|urgent\",\"criticality\":0|1|2,\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\"}}\n\
             - {{\"type\":\"delete_task\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"duplicate_task\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"select_task\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"userName\":\"...\"}}\n\
             - {{\"type\":\"create_table_card\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"userName\":\"...\",\"hasCheckboxes\":false|true,\"rows\":[[\"Item\",\"Qtd\",\"Valor\"],[\"A\",\"2\",\"10\"],[\"Total\",\"=SOMA(B2:B2)\",\"=SOMA(C2:C2)\"]],\"parentCardId\":\"...|$LAST_CARD\",\"parentRow\":0}}\n\
             - {{\"type\":\"create_card\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"userName\":\"...\",\"body\":\"...\",\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2,\"parentCardId\":\"...|$LAST_CARD\"}}\n\
             - {{\"type\":\"update_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"body\":\"...\",\"appendBody\":\"...\",\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2}}\n\
             - {{\"type\":\"delete_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"duplicate_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"copy_card_to_task\",\"sourceCardId\":\"...\",\"sourceTaskId\":\"...\",\"sourceTaskTitle\":\"...\",\"targetTaskId\":\"...\",\"targetTaskTitle\":\"...\",\"targetUserName\":\"...\"}}\n\
             - {{\"type\":\"move_card_to_task\",\"sourceCardId\":\"...\",\"sourceTaskId\":\"...\",\"sourceTaskTitle\":\"...\",\"targetTaskId\":\"...\",\"targetTaskTitle\":\"...\",\"targetUserName\":\"...\"}}\n\
             - {{\"type\":\"focus_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"connect_cards\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"fromCardId\":\"...|$LAST_CARD\",\"toCardId\":\"...|$LAST_CARD\",\"fromRow\":0,\"toRow\":0}}\n\
             - {{\"type\":\"disconnect_cards\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"fromCardId\":\"...\",\"toCardId\":\"...\"}}\n\
             - {{\"type\":\"organize_canvas\"}}\n\
             - {{\"type\":\"center_canvas\"}}\n\
             - {{\"type\":\"copy_text\",\"text\":\"...\"}}\n\
             - {{\"type\":\"set_status_filter\",\"filter\":\"all|ongoing|stopped|complete\"}}\n\
             - {{\"type\":\"open_translator\",\"floating\":true|false}}\n\
             - {{\"type\":\"open_settings\"}}\n\
             - {{\"type\":\"update_settings\",\"theme\":\"claude-dark|light-claude|dracula\",\"cardFontSize\":14,\"linkStyle\":\"orthogonal|bezier\",\"linkArrows\":true|false,\"translatorMode\":\"auto|manual\"}}\n\n\
             LIVE APP STATE (JSON):\n{ctx_json}"
        );

        let contents = normalize_gemini_contents(
            messages
                .into_iter()
                .filter(|m| !m.text.trim().is_empty() || !m.attachments.is_empty())
                .map(|m| {
                    let role = if m.role == "model" || m.role == "assistant" {
                        "model"
                    } else {
                        "user"
                    };

                    let mut parts: Vec<serde_json::Value> = Vec::new();

                    for att in m.attachments {
                        if let Some(txt) = att.text_content {
                            if !txt.trim().is_empty() {
                                parts.push(serde_json::json!({
                                    "text": format!("--- Attachment: {} ---\n{}\n--- End of {} ---", att.name, txt, att.name)
                                }));
                                continue;
                            }
                        }
                        if let Some(b64) = att.data_base64 {
                            let clean_b64 = b64.trim();
                            if !clean_b64.is_empty() {
                                let clean_mime = att
                                    .mime_type
                                    .split(';')
                                    .next()
                                    .unwrap_or("application/octet-stream")
                                    .trim()
                                    .to_string();
                                if is_gemini_supported_inline_mime(&clean_mime) {
                                    parts.push(serde_json::json!({
                                        "inlineData": {
                                            "mimeType": clean_mime,
                                            "data": clean_b64
                                        }
                                    }));
                                } else {
                                    parts.push(serde_json::json!({
                                        "text": format!(
                                            "[Arquivo anexado: {} (tipo {} não suportado como binário direto pela API Gemini)]",
                                            att.name, clean_mime
                                        )
                                    }));
                                }
                            }
                        }
                    }

                    if !m.text.trim().is_empty() {
                        parts.push(serde_json::json!({ "text": m.text }));
                    } else if parts.is_empty() {
                        parts.push(serde_json::json!({ "text": "Analyze the attached file(s)." }));
                    }

                    serde_json::json!({
                        "role": role,
                        "parts": parts
                    })
                })
                .collect(),
        );

        let payload = serde_json::json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": contents,
            "generationConfig": {
                "temperature": 0.4
            }
        });

        let (text, model) = execute_gemini_fast_payload_with_model(&key, &models, payload, false)?;
        Ok(AiChatReply { text, model })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
    Ok(buffer)
}

fn parse_dotenv_content(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = trimmed.split_once('=') {
            let key = k.trim().to_string();
            let val = v
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .trim()
                .to_string();
            if !key.is_empty() && !val.is_empty() {
                map.insert(key, val);
            }
        }
    }
    map
}

fn load_dotenv_vars() -> HashMap<String, String> {
    let mut vars = parse_dotenv_content(include_str!("../../.env"));

    let mut candidate_paths: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        candidate_paths.push(cwd.join(".env"));
        if let Some(parent) = cwd.parent() {
            candidate_paths.push(parent.join(".env"));
        }
    }
    if let Ok(exe) = env::current_exe() {
        let mut dir_opt = exe.parent();
        for _ in 0..5 {
            if let Some(dir) = dir_opt {
                candidate_paths.push(dir.join(".env"));
                dir_opt = dir.parent();
            }
        }
    }

    for path in candidate_paths {
        if let Ok(content) = fs::read_to_string(&path) {
            for (k, v) in parse_dotenv_content(&content) {
                vars.insert(k, v);
            }
            break;
        }
    }

    if let Ok(k) = env::var("GEMINI_API_KEY") {
        if !k.trim().is_empty() {
            vars.insert("GEMINI_API_KEY".to_string(), k.trim().to_string());
        }
    }
    if let Ok(m) = env::var("GEMINI_MODEL") {
        if !m.trim().is_empty() {
            vars.insert("GEMINI_MODEL".to_string(), m.trim().to_string());
        }
    }

    vars
}

const TARGET_SAMPLE_RATE: u32 = 16_000;

struct ActiveAiAudioCapture {
    running: Arc<AtomicBool>,
    mic_samples: Arc<Mutex<Vec<f32>>>,
    sys_samples: Arc<Mutex<Vec<f32>>>,
    chunk_start: Arc<Mutex<Instant>>,
    join_handle: Option<thread::JoinHandle<()>>,
}

#[derive(Default)]
struct AiAudioCaptureState(Mutex<Option<ActiveAiAudioCapture>>);

struct ActiveNativeScreenRecording {
    running: Arc<AtomicBool>,
    path: PathBuf,
    relative_file: String,
    original_name: String,
    join_handle: Option<thread::JoinHandle<Result<(), String>>>,
}

#[derive(Default)]
struct NativeScreenRecorderState(Mutex<Option<ActiveNativeScreenRecording>>);

#[cfg(target_os = "windows")]
mod win_screen_recorder {
    use super::*;
    use std::collections::VecDeque;
    use std::ptr;
    use std::sync::mpsc;
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
    use windows::Win32::Graphics::Direct3D11::{
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11Texture2D,
        D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAPPED_SUBRESOURCE,
        D3D11_MAP_READ, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
    };
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
    use windows::Win32::Graphics::Dxgi::{
        IDXGIAdapter, IDXGIDevice, IDXGIOutput, IDXGIOutput1, IDXGIOutputDuplication,
        IDXGIResource, DXGI_OUTDUPL_FRAME_INFO,
    };
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC,
        GetDeviceCaps, ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, COLORONCOLOR, DESKTOPHORZRES, DESKTOPVERTRES, DIB_RGB_COLORS,
        HGDIOBJ, SRCCOPY,
    };
    use windows::Win32::Media::MediaFoundation::{
        IMFAttributes, IMFMediaBuffer, IMFMediaType, IMFSample, IMFSinkWriter,
        MFAudioFormat_AAC, MFAudioFormat_PCM, MFCreateAttributes, MFCreateMediaType,
        MFCreateMemoryBuffer, MFCreateSample, MFCreateSinkWriterFromURL, MFMediaType_Audio,
        MFMediaType_Video, MFShutdown, MFStartup, MFVideoFormat_H264, MFVideoFormat_RGB32,
        MFVideoInterlace_Progressive, MFSTARTUP_NOSOCKET, MF_LOW_LATENCY,
        MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, MF_MT_AAC_PAYLOAD_TYPE,
        MF_MT_ALL_SAMPLES_INDEPENDENT, MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
        MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS,
        MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_AVG_BITRATE, MF_MT_FRAME_RATE, MF_MT_FRAME_SIZE,
        MF_MT_INTERLACE_MODE, MF_MT_MAJOR_TYPE, MF_MT_MPEG2_PROFILE, MF_MT_SUBTYPE,
        MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, MF_SINK_WRITER_DISABLE_THROTTLING, MF_VERSION,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN,
    };

    // Gravacao compacta e nitida (Full HD 1:1 com H.264 High Profile a 800 kbps @ 10 fps):
    // - ~6.5 MB/min (~125 MB em 20 min, ~8x menor que 6.5 Mbps) mantendo textos e codigo nitidos.
    // - O encoding H.264 roda via hardware (Intel QuickSync / GPU) quando disponivel.
    const VIDEO_FPS: u32 = 10;
    const VIDEO_BITRATE: u32 = 800_000;
    const MAX_VIDEO_WIDTH: i32 = 1920;
    const MAX_VIDEO_HEIGHT: i32 = 1200;
    const H264_PROFILE_HIGH: u32 = 100;
    const AUDIO_SAMPLE_RATE: u32 = 48_000;
    const AUDIO_CHANNELS: u32 = 2;
    const AUDIO_BITS_PER_SAMPLE: u32 = 16;
    const AUDIO_AVG_BYTES_PER_SEC: u32 = 16_000; // 128 kbps AAC-LC estereo (~0.96 MB/min, compatibilidade total WebView2)
    const HNS_PER_SEC: i64 = 10_000_000;
    // Buffer circular maximo de 1 segundo por canal (evita crescimento de RAM em gravacoes longas)
    const MAX_RING_SAMPLES: usize = AUDIO_SAMPLE_RATE as usize;
    const AUDIO_PREROLL_MS: u64 = 60;
    const MIC_START_BUFFER_SAMPLES: usize = (AUDIO_SAMPLE_RATE as usize) / 50; // 20 ms
    const SYS_START_BUFFER_SAMPLES: usize = (AUDIO_SAMPLE_RATE as usize) / 25; // 40 ms
    const MAX_CHANNEL_LATENCY_SAMPLES: usize = (AUDIO_SAMPLE_RATE as usize) / 4; // 250 ms
    const FADE_IN_SAMPLES: usize = (AUDIO_SAMPLE_RATE as usize) / 500; // 2 ms

    fn pack_u32_pair(hi: u32, lo: u32) -> u64 {
        ((hi as u64) << 32) | (lo as u64)
    }

    fn soft_limit(sample: f32) -> f32 {
        const THRESHOLD: f32 = 0.85;
        let abs_val = sample.abs();
        if abs_val <= THRESHOLD {
            return sample;
        }
        let excess = (abs_val - THRESHOLD) / (1.0 - THRESHOLD);
        let limited = THRESHOLD + (1.0 - THRESHOLD) * excess.tanh();
        limited.copysign(sample)
    }

    struct LinearResampler {
        in_rate: u32,
        out_rate: u32,
        step: f64,
        phase: f64,
        prev_sample: f32,
        lp_state: f32,
        lp_alpha: f32,
    }

    impl LinearResampler {
        fn new(in_rate: u32, out_rate: u32) -> Self {
            let safe_in = in_rate.max(1);
            let safe_out = out_rate.max(1);
            let lp_alpha = if safe_in > safe_out {
                let cutoff = 0.45 * (safe_out as f32);
                let rc = 1.0 / (2.0 * std::f32::consts::PI * cutoff);
                let dt = 1.0 / (safe_in as f32);
                dt / (rc + dt)
            } else {
                1.0
            };

            Self {
                in_rate: safe_in,
                out_rate: safe_out,
                step: (safe_in as f64) / (safe_out as f64),
                phase: 0.0,
                prev_sample: 0.0,
                lp_state: 0.0,
                lp_alpha,
            }
        }

        fn resample_into(&mut self, input: &[f32], output: &mut Vec<f32>) {
            output.clear();
            if input.is_empty() {
                return;
            }
            if self.in_rate == self.out_rate {
                output.extend_from_slice(input);
                return;
            }

            let needs_lowpass = self.in_rate > self.out_rate;
            for &raw in input {
                let sample = if needs_lowpass {
                    self.lp_state += self.lp_alpha * (raw - self.lp_state);
                    self.lp_state
                } else {
                    raw
                };

                while self.phase < 1.0 {
                    let interp = self.prev_sample + (sample - self.prev_sample) * (self.phase as f32);
                    output.push(interp);
                    self.phase += self.step;
                }
                self.phase -= 1.0;
                self.prev_sample = sample;
            }
        }
    }

    struct MicrophoneConditioner {
        hp_alpha: f32,
        hp_prev_in: f32,
        hp_prev_out: f32,
        envelope: f32,
        env_attack: f32,
        env_release: f32,
        gain: f32,
        gain_attack: f32,
        gain_release: f32,
        hold_remaining: usize,
        hold_samples: usize,
    }

    impl MicrophoneConditioner {
        fn new(sample_rate: u32) -> Self {
            let sr = sample_rate.max(1) as f32;
            let rc = 1.0 / (2.0 * std::f32::consts::PI * 80.0);
            let dt = 1.0 / sr;
            Self {
                hp_alpha: rc / (rc + dt),
                hp_prev_in: 0.0,
                hp_prev_out: 0.0,
                envelope: 0.0,
                env_attack: 1.0 - (-1.0 / (0.004 * sr)).exp(),
                env_release: 1.0 - (-1.0 / (0.060 * sr)).exp(),
                gain: 0.04,
                gain_attack: 1.0 - (-1.0 / (0.005 * sr)).exp(),
                gain_release: 1.0 - (-1.0 / (0.180 * sr)).exp(),
                hold_remaining: 0,
                hold_samples: (0.150 * sr) as usize,
            }
        }

        fn process(&mut self, sample: f32) -> f32 {
            const OPEN_THRESHOLD: f32 = 0.0045;
            const CLOSE_THRESHOLD: f32 = 0.0020;
            const FLOOR_GAIN: f32 = 0.12;
            const VOICE_GAIN: f32 = 1.15;

            let hp = self.hp_alpha * (self.hp_prev_out + sample - self.hp_prev_in);
            self.hp_prev_in = sample;
            self.hp_prev_out = hp;

            let level = hp.abs();
            let env_coeff = if level > self.envelope {
                self.env_attack
            } else {
                self.env_release
            };
            self.envelope += env_coeff * (level - self.envelope);

            let target_gain = if self.envelope >= OPEN_THRESHOLD {
                self.hold_remaining = self.hold_samples;
                VOICE_GAIN
            } else if self.hold_remaining > 0 {
                self.hold_remaining -= 1;
                VOICE_GAIN
            } else if self.envelope <= CLOSE_THRESHOLD {
                FLOOR_GAIN
            } else {
                let t = (self.envelope - CLOSE_THRESHOLD) / (OPEN_THRESHOLD - CLOSE_THRESHOLD);
                FLOOR_GAIN + t * (VOICE_GAIN - FLOOR_GAIN)
            };

            let gain_coeff = if target_gain > self.gain {
                self.gain_attack
            } else {
                self.gain_release
            };
            self.gain += gain_coeff * (target_gain - self.gain);

            hp * self.gain
        }
    }

    struct ChannelStreamBuffer {
        active: bool,
        min_start_samples: usize,
        max_latency_samples: usize,
        last_sample: f32,
        fade_in_remaining: usize,
    }

    impl ChannelStreamBuffer {
        fn new(min_start_samples: usize, max_latency_samples: usize) -> Self {
            Self {
                active: false,
                min_start_samples,
                max_latency_samples,
                last_sample: 0.0,
                fade_in_remaining: 0,
            }
        }

        fn prepare_for_drain(&mut self, queue: &mut VecDeque<f32>) {
            if queue.len() > self.max_latency_samples {
                let keep = self.max_latency_samples / 2;
                let excess = queue.len().saturating_sub(keep);
                queue.drain(..excess);
            }
            if !self.active && queue.len() >= self.min_start_samples {
                self.active = true;
                self.fade_in_remaining = FADE_IN_SAMPLES;
            }
        }

        fn next_sample(&mut self, queue: &mut VecDeque<f32>) -> f32 {
            if self.active {
                if let Some(sample) = queue.pop_front() {
                    let out = if self.fade_in_remaining > 0 {
                        let progress =
                            1.0 - (self.fade_in_remaining as f32) / (FADE_IN_SAMPLES.max(1) as f32);
                        self.fade_in_remaining -= 1;
                        sample * progress
                    } else {
                        sample
                    };
                    self.last_sample = out;
                    return out;
                }
                self.active = false;
            }

            self.last_sample *= 0.985;
            if self.last_sample.abs() < 1e-5 {
                self.last_sample = 0.0;
            }
            self.last_sample
        }
    }

    struct AudioCaptureSession {
        _mic_stream: Option<cpal::Stream>,
        _sys_stream: Option<cpal::Stream>,
        mic_queue: Arc<Mutex<VecDeque<f32>>>,
        sys_queue: Arc<Mutex<VecDeque<f32>>>,
        mic_channel: ChannelStreamBuffer,
        sys_channel: ChannelStreamBuffer,
        mic_conditioner: MicrophoneConditioner,
    }

    impl AudioCaptureSession {
        fn start() -> Self {
            let mic_queue = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
            let sys_queue = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
            let host = cpal::default_host();

            let _mic_stream = host.default_input_device().and_then(|dev| {
                let cfg = dev.default_input_config().ok()?;
                let stream = build_48k_stream(&dev, &cfg, Arc::clone(&mic_queue))?;
                stream.play().ok()?;
                Some(stream)
            });

            let _sys_stream = host.default_output_device().and_then(|dev| {
                let cfg = dev.default_output_config().ok()?;
                let stream = build_48k_stream(&dev, &cfg, Arc::clone(&sys_queue))?;
                stream.play().ok()?;
                Some(stream)
            });

            if _mic_stream.is_some() || _sys_stream.is_some() {
                thread::sleep(Duration::from_millis(AUDIO_PREROLL_MS));
            }

            Self {
                _mic_stream,
                _sys_stream,
                mic_queue,
                sys_queue,
                mic_channel: ChannelStreamBuffer::new(
                    MIC_START_BUFFER_SAMPLES,
                    MAX_CHANNEL_LATENCY_SAMPLES,
                ),
                sys_channel: ChannelStreamBuffer::new(
                    SYS_START_BUFFER_SAMPLES,
                    MAX_CHANNEL_LATENCY_SAMPLES,
                ),
                mic_conditioner: MicrophoneConditioner::new(AUDIO_SAMPLE_RATE),
            }
        }

        fn mix_into_pcm(&mut self, sample_count: usize, pcm_out: &mut Vec<u8>) {
            pcm_out.clear();
            let mut mic_guard = self.mic_queue.lock().ok();
            let mut sys_guard = self.sys_queue.lock().ok();

            if let Some(ref mut q) = mic_guard {
                self.mic_channel.prepare_for_drain(q);
            }
            if let Some(ref mut q) = sys_guard {
                self.sys_channel.prepare_for_drain(q);
            }

            for _ in 0..sample_count {
                let mic_raw = mic_guard
                    .as_mut()
                    .map(|q| self.mic_channel.next_sample(q))
                    .unwrap_or(0.0);
                let sys_raw = sys_guard
                    .as_mut()
                    .map(|q| self.sys_channel.next_sample(q))
                    .unwrap_or(0.0);

                let mic_clean = self.mic_conditioner.process(mic_raw);
                let mixed = soft_limit(mic_clean + sys_raw);
                let sample_i16 = (mixed.clamp(-1.0, 1.0) * 32767.0).round() as i16;
                let le = sample_i16.to_le_bytes();
                pcm_out.extend_from_slice(&le);
                pcm_out.extend_from_slice(&le);
            }
        }
    }

    fn samples_to_hns(sample_count: u64) -> i64 {
        (((sample_count as i128) * (HNS_PER_SEC as i128)) / (AUDIO_SAMPLE_RATE as i128)) as i64
    }

    fn push_samples_to_ring(dest: &Arc<Mutex<VecDeque<f32>>>, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let Ok(mut buf) = dest.lock() else {
            return;
        };
        let total = buf.len() + samples.len();
        if total > MAX_RING_SAMPLES {
            let drop_count = (total - MAX_RING_SAMPLES).min(buf.len());
            buf.drain(..drop_count);
        }
        buf.extend(samples.iter().copied());
    }

    fn build_48k_stream(
        device: &cpal::Device,
        config: &cpal::SupportedStreamConfig,
        dest: Arc<Mutex<VecDeque<f32>>>,
    ) -> Option<cpal::Stream> {
        let channels = config.channels() as usize;
        let in_rate = config.sample_rate().0;
        let sample_format = config.sample_format();
        let stream_config: cpal::StreamConfig = config.clone().into();
        let err_fn = |err| eprintln!("[screen-rec-audio] stream error: {err}");

        match sample_format {
            cpal::SampleFormat::F32 => {
                let mut mono_scratch = Vec::<f32>::with_capacity(2048);
                let mut resampled = Vec::<f32>::with_capacity(2400);
                let mut resampler = LinearResampler::new(in_rate, AUDIO_SAMPLE_RATE);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[f32], _| {
                            if channels == 0 {
                                return;
                            }
                            mono_scratch.clear();
                            mono_scratch.extend(
                                data.chunks(channels)
                                    .map(|f| f.iter().copied().sum::<f32>() / (f.len() as f32)),
                            );
                            resampler.resample_into(&mono_scratch, &mut resampled);
                            push_samples_to_ring(&dest, &resampled);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::I16 => {
                let mut mono_scratch = Vec::<f32>::with_capacity(2048);
                let mut resampled = Vec::<f32>::with_capacity(2400);
                let mut resampler = LinearResampler::new(in_rate, AUDIO_SAMPLE_RATE);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| {
                            if channels == 0 {
                                return;
                            }
                            mono_scratch.clear();
                            mono_scratch.extend(data.chunks(channels).map(|f| {
                                let sum: f32 = f.iter().map(|&s| (s as f32) / 32768.0).sum();
                                sum / (f.len() as f32)
                            }));
                            resampler.resample_into(&mono_scratch, &mut resampled);
                            push_samples_to_ring(&dest, &resampled);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::U16 => {
                let mut mono_scratch = Vec::<f32>::with_capacity(2048);
                let mut resampled = Vec::<f32>::with_capacity(2400);
                let mut resampler = LinearResampler::new(in_rate, AUDIO_SAMPLE_RATE);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[u16], _| {
                            if channels == 0 {
                                return;
                            }
                            mono_scratch.clear();
                            mono_scratch.extend(data.chunks(channels).map(|f| {
                                let sum: f32 =
                                    f.iter().map(|&s| ((s as f32) - 32768.0) / 32768.0).sum();
                                sum / (f.len() as f32)
                            }));
                            resampler.resample_into(&mono_scratch, &mut resampled);
                            push_samples_to_ring(&dest, &resampled);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            _ => None,
        }
    }

    unsafe fn create_optimized_sink_writer(wide_url: &[u16]) -> Result<IMFSinkWriter, String> {
        let mut attrs_opt: Option<IMFAttributes> = None;
        if MFCreateAttributes(&mut attrs_opt, 3).is_ok() {
            if let Some(ref attrs) = attrs_opt {
                // Ativa Intel QuickSync / GPU hardware encoding quando disponivel
                let _ = attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
                // Modo de baixa latencia: reduz uso de CPU/RAM desativando reordenacao longa de B-frames
                let _ = attrs.SetUINT32(&MF_LOW_LATENCY, 1);
                // Evita que o SinkWriter bloqueie a thread artificialmente
                let _ = attrs.SetUINT32(&MF_SINK_WRITER_DISABLE_THROTTLING, 1);
            }
        }

        if let Some(ref attrs) = attrs_opt {
            if let Ok(writer) = MFCreateSinkWriterFromURL(PCWSTR(wide_url.as_ptr()), None, attrs) {
                return Ok(writer);
            }
        }

        MFCreateSinkWriterFromURL(PCWSTR(wide_url.as_ptr()), None, None::<&IMFAttributes>)
            .map_err(|e| format!("Falha ao criar SinkWriter MP4: {e}"))
    }

    unsafe fn configure_video_streams(
        writer: &IMFSinkWriter,
        width: u32,
        height: u32,
    ) -> Result<u32, String> {
        let out_type: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
        out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| e.to_string())?;
        out_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_H264).map_err(|e| e.to_string())?;
        out_type.SetUINT32(&MF_MT_AVG_BITRATE, VIDEO_BITRATE).map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(VIDEO_FPS, 1))
            .map_err(|e| e.to_string())?;
        let _ = out_type.SetUINT32(&MF_MT_MPEG2_PROFILE, H264_PROFILE_HIGH);

        let stream_index = match writer.AddStream(&out_type) {
            Ok(idx) => idx,
            Err(_) => {
                let _ = out_type.DeleteItem(&MF_MT_MPEG2_PROFILE);
                writer.AddStream(&out_type).map_err(|e| e.to_string())?
            }
        };

        let in_type: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
        in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video).map_err(|e| e.to_string())?;
        in_type.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32).map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT64(&MF_MT_FRAME_SIZE, pack_u32_pair(width, height))
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT64(&MF_MT_FRAME_RATE, pack_u32_pair(VIDEO_FPS, 1))
            .map_err(|e| e.to_string())?;

        writer
            .SetInputMediaType(stream_index, &in_type, None::<&IMFAttributes>)
            .map_err(|e| e.to_string())?;

        Ok(stream_index)
    }

    unsafe fn configure_audio_streams(writer: &IMFSinkWriter) -> Result<u32, String> {
        let out_type: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
        out_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| e.to_string())?;
        out_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_AAC).map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, AUDIO_BITS_PER_SAMPLE)
            .map_err(|e| e.to_string())?;
        out_type
            .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, AUDIO_AVG_BYTES_PER_SEC)
            .map_err(|e| e.to_string())?;
        let _ = out_type.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 1);
        let _ = out_type.SetUINT32(&MF_MT_AAC_PAYLOAD_TYPE, 0);
        let _ = out_type.SetUINT32(&MF_MT_AAC_AUDIO_PROFILE_LEVEL_INDICATION, 0x29);

        let stream_index = writer.AddStream(&out_type).map_err(|e| e.to_string())?;

        let block_align = AUDIO_CHANNELS * (AUDIO_BITS_PER_SAMPLE / 8);
        let avg_bytes = AUDIO_SAMPLE_RATE * block_align;

        let in_type: IMFMediaType = MFCreateMediaType().map_err(|e| e.to_string())?;
        in_type.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| e.to_string())?;
        in_type.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_PCM).map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, AUDIO_SAMPLE_RATE)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, AUDIO_CHANNELS)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, AUDIO_BITS_PER_SAMPLE)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, block_align)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, avg_bytes)
            .map_err(|e| e.to_string())?;
        in_type
            .SetUINT32(&MF_MT_ALL_SAMPLES_INDEPENDENT, 1)
            .map_err(|e| e.to_string())?;

        writer
            .SetInputMediaType(stream_index, &in_type, None::<&IMFAttributes>)
            .map_err(|e| e.to_string())?;

        Ok(stream_index)
    }

    unsafe fn write_mf_sample(
        writer: &IMFSinkWriter,
        stream_index: u32,
        bytes: &[u8],
        timestamp_hns: i64,
        duration_hns: i64,
    ) -> Result<(), String> {
        let buffer: IMFMediaBuffer =
            MFCreateMemoryBuffer(bytes.len() as u32).map_err(|e| e.to_string())?;
        let mut dest_ptr: *mut u8 = ptr::null_mut();
        buffer
            .Lock(&mut dest_ptr, None, None)
            .map_err(|e| e.to_string())?;
        ptr::copy_nonoverlapping(bytes.as_ptr(), dest_ptr, bytes.len());
        buffer.Unlock().map_err(|e| e.to_string())?;
        buffer
            .SetCurrentLength(bytes.len() as u32)
            .map_err(|e| e.to_string())?;

        let sample: IMFSample = MFCreateSample().map_err(|e| e.to_string())?;
        sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
        sample
            .SetSampleTime(timestamp_hns)
            .map_err(|e| e.to_string())?;
        sample
            .SetSampleDuration(duration_hns.max(1))
            .map_err(|e| e.to_string())?;

        writer
            .WriteSample(stream_index, &sample)
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    struct DxgiDuplicator {
        context: ID3D11DeviceContext,
        dupl: IDXGIOutputDuplication,
        staging: ID3D11Texture2D,
        src_w: u32,
        src_h: u32,
        has_frame: bool,
    }

    unsafe fn init_dxgi_duplicator() -> Option<DxgiDuplicator> {
        let mut device_opt: Option<ID3D11Device> = None;
        let mut context_opt: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            windows::Win32::Foundation::HMODULE::default(),
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device_opt),
            None,
            Some(&mut context_opt),
        )
        .ok()?;

        let device = device_opt?;
        let context = context_opt?;
        let dxgi_device: IDXGIDevice = device.cast().ok()?;
        let adapter: IDXGIAdapter = dxgi_device.GetAdapter().ok()?;
        let output: IDXGIOutput = adapter.EnumOutputs(0).ok()?;
        let output_desc = output.GetDesc().ok()?;
        let rect = output_desc.DesktopCoordinates;
        let src_w = (rect.right - rect.left).max(1) as u32;
        let src_h = (rect.bottom - rect.top).max(1) as u32;

        let output1: IDXGIOutput1 = output.cast().ok()?;
        let dupl: IDXGIOutputDuplication = output1.DuplicateOutput(&device).ok()?;

        let desc = D3D11_TEXTURE2D_DESC {
            Width: src_w,
            Height: src_h,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
        };

        let mut staging_opt: Option<ID3D11Texture2D> = None;
        device
            .CreateTexture2D(&desc, None, Some(&mut staging_opt))
            .ok()?;
        let staging = staging_opt?;

        Some(DxgiDuplicator {
            context,
            dupl,
            staging,
            src_w,
            src_h,
            has_frame: false,
        })
    }

    // Desenha um cursor vetorial limpo (seta branca com contorno escuro) diretamente no buffer de memoria
    // bottom-up (BGRA), sem tocar em GDI/DrawIconEx/GetCursorInfo — eliminando 100% da piscada do cursor na tela!
    fn draw_synthetic_cursor_bottom_up(
        buf: &mut [u8],
        out_w: i32,
        out_h: i32,
        cx: i32,
        cy: i32,
    ) {
        // Mapa 12x18 de seta de cursor (1 = borda preta, 2 = preenchimento branco)
        const ARROW: [&[u8]; 18] = [
            b"100000000000",
            b"110000000000",
            b"121000000000",
            b"122100000000",
            b"122210000000",
            b"122221000000",
            b"122222100000",
            b"122222210000",
            b"122222221000",
            b"122222222100",
            b"122222222210",
            b"122222111111",
            b"122122100000",
            b"121012210000",
            b"110012210000",
            b"100001221000",
            b"000001221000",
            b"000000110000",
        ];

        for (dy, row) in ARROW.iter().enumerate() {
            let py = cy + (dy as i32);
            if py < 0 || py >= out_h {
                continue;
            }
            // No buffer bottom-up, a linha Y da tela fica em (out_h - 1 - py)
            let buf_row = (out_h - 1 - py) as usize;
            for (dx, &cell) in row.iter().enumerate() {
                if cell == b'0' {
                    continue;
                }
                let px = cx + (dx as i32);
                if px < 0 || px >= out_w {
                    continue;
                }
                let offset = (buf_row * (out_w as usize) + (px as usize)) * 4;
                if offset + 3 < buf.len() {
                    if cell == b'1' {
                        buf[offset] = 18;
                        buf[offset + 1] = 18;
                        buf[offset + 2] = 20;
                        buf[offset + 3] = 255;
                    } else {
                        buf[offset] = 255;
                        buf[offset + 1] = 255;
                        buf[offset + 2] = 255;
                        buf[offset + 3] = 255;
                    }
                }
            }
        }
    }

    unsafe fn capture_dxgi_into_bottom_up(
        dxgi: &mut DxgiDuplicator,
        dest_bottom_up: &mut [u8],
        out_w: u32,
        out_h: u32,
    ) -> bool {
        let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource_opt: Option<IDXGIResource> = None;

        if dxgi
            .dupl
            .AcquireNextFrame(0, &mut frame_info, &mut resource_opt)
            .is_ok()
        {
            if let Some(res) = resource_opt {
                if let Ok(tex) = res.cast::<ID3D11Texture2D>() {
                    let staging_res: Result<ID3D11Resource, _> = dxgi.staging.cast();
                    let tex_res: Result<ID3D11Resource, _> = tex.cast();
                    if let (Ok(dst), Ok(src)) = (staging_res, tex_res) {
                        dxgi.context.CopyResource(&dst, &src);
                        dxgi.has_frame = true;
                    }
                }
            }
            let _ = dxgi.dupl.ReleaseFrame();
        }

        if !dxgi.has_frame {
            return false;
        }

        let Ok(staging_res) = dxgi.staging.cast::<ID3D11Resource>() else {
            return false;
        };
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        if dxgi
            .context
            .Map(&staging_res, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
            .is_err()
        {
            return false;
        }

        let src_ptr = mapped.pData as *const u8;
        let pitch = mapped.RowPitch as usize;
        let src_w = dxgi.src_w as usize;
        let src_h = dxgi.src_h as usize;
        let dst_w = out_w as usize;
        let dst_h = out_h as usize;

        if !src_ptr.is_null() && dst_w > 0 && dst_h > 0 {
            if src_w == dst_w && src_h == dst_h {
                let row_bytes = dst_w * 4;
                for y in 0..dst_h {
                    let src_row = src_ptr.add(y * pitch);
                    let dst_row_idx = (dst_h - 1 - y) * row_bytes;
                    ptr::copy_nonoverlapping(
                        src_row,
                        dest_bottom_up.as_mut_ptr().add(dst_row_idx),
                        row_bytes,
                    );
                }
            } else {
                // Filtro bilinear 2x2 suave caso o monitor seja 4K (>1920x1200) para manter textos legiveis
                for y in 0..dst_h {
                    let sy0 = ((y * src_h) / dst_h).min(src_h - 1);
                    let sy1 = (sy0 + 1).min(src_h - 1);
                    let row0 = src_ptr.add(sy0 * pitch);
                    let row1 = src_ptr.add(sy1 * pitch);
                    let dst_row_offset = (dst_h - 1 - y) * dst_w * 4;
                    for x in 0..dst_w {
                        let sx0 = ((x * src_w) / dst_w).min(src_w - 1);
                        let sx1 = (sx0 + 1).min(src_w - 1);
                        let p00 = row0.add(sx0 * 4);
                        let p10 = row0.add(sx1 * 4);
                        let p01 = row1.add(sx0 * 4);
                        let p11 = row1.add(sx1 * 4);
                        let d = dest_bottom_up.as_mut_ptr().add(dst_row_offset + x * 4);
                        for c in 0..3 {
                            let avg = ((*p00.add(c) as u32)
                                + (*p10.add(c) as u32)
                                + (*p01.add(c) as u32)
                                + (*p11.add(c) as u32)
                                + 2)
                                >> 2;
                            *d.add(c) = avg as u8;
                        }
                        *d.add(3) = 255;
                    }
                }
            }
        }

        dxgi.context.Unmap(&staging_res, 0);
        true
    }

    pub fn spawn_screen_recorder(
        output_path: PathBuf,
        running: Arc<AtomicBool>,
        ready_tx: mpsc::Sender<Result<(), String>>,
        audio_only: bool,
    ) -> thread::JoinHandle<Result<(), String>> {
        thread::spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let result = run_recorder_loop(&output_path, &running, &ready_tx, audio_only);
            CoUninitialize();
            result
        })
    }

    unsafe fn run_recorder_loop(
        output_path: &Path,
        running: &Arc<AtomicBool>,
        ready_tx: &mpsc::Sender<Result<(), String>>,
        audio_only: bool,
    ) -> Result<(), String> {
        MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).map_err(|e| {
            let msg = format!("MFStartup falhou: {e}");
            let _ = ready_tx.send(Err(msg.clone()));
            msg
        })?;

        let res = if audio_only {
            run_audio_only_inner(output_path, running, ready_tx)
        } else {
            run_recorder_inner(output_path, running, ready_tx)
        };
        let _ = MFShutdown();
        res
    }

    unsafe fn run_audio_only_inner(
        output_path: &Path,
        running: &Arc<AtomicBool>,
        ready_tx: &mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        let wide_url: Vec<u16> = output_path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let writer: IMFSinkWriter = match create_optimized_sink_writer(&wide_url) {
            Ok(w) => w,
            Err(err) => {
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        let audio_stream = match configure_audio_streams(&writer) {
            Ok(idx) => idx,
            Err(err) => {
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        if let Err(e) = writer.BeginWriting() {
            let err = format!("BeginWriting (audio) falhou: {e}");
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }

        let mut audio_session = AudioCaptureSession::start();

        let _ = ready_tx.send(Ok(()));

        let start_instant = Instant::now();
        let tick_interval = Duration::from_millis(50);
        let mut total_audio_samples: u64 = 0;
        let mut pcm_bytes = Vec::<u8>::with_capacity((AUDIO_SAMPLE_RATE as usize / 2) * 2);

        while running.load(Ordering::Relaxed) {
            let loop_tick = Instant::now();
            let elapsed_hns =
                (start_instant.elapsed().as_secs_f64() * (HNS_PER_SEC as f64)) as i64;
            let target_samples = (((elapsed_hns.max(0) as i128) * (AUDIO_SAMPLE_RATE as i128))
                / (HNS_PER_SEC as i128)) as u64;
            let needed_samples = target_samples.saturating_sub(total_audio_samples);

            if needed_samples >= 480 {
                let step_samples = needed_samples.min((AUDIO_SAMPLE_RATE as u64) / 3) as usize;
                let sample_ts_hns = samples_to_hns(total_audio_samples);
                let next_ts_hns = samples_to_hns(total_audio_samples + (step_samples as u64));
                let exact_dur_hns = (next_ts_hns - sample_ts_hns).max(1);

                audio_session.mix_into_pcm(step_samples, &mut pcm_bytes);

                let _ = write_mf_sample(
                    &writer,
                    audio_stream,
                    &pcm_bytes,
                    sample_ts_hns,
                    exact_dur_hns,
                );

                total_audio_samples += step_samples as u64;
            }

            let spent = loop_tick.elapsed();
            if spent < tick_interval {
                thread::sleep(tick_interval - spent);
            }
        }

        drop(audio_session);

        if let Err(e) = writer.Finalize() {
            eprintln!("[audio-rec] writer.Finalize warning/error: {e}");
        }

        Ok(())
    }

    unsafe fn run_recorder_inner(
        output_path: &Path,
        running: &Arc<AtomicBool>,
        ready_tx: &mpsc::Sender<Result<(), String>>,
    ) -> Result<(), String> {
        // Inicializa o DXGI Desktop Duplication primeiro para usar a resolucao fisica exata da GPU
        let mut dxgi_opt = init_dxgi_duplicator();

        let hdc_screen = GetDC(None);
        if hdc_screen.is_invalid() {
            let err = "Nao foi possivel obter o DC da tela".to_string();
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }

        let phys_w = GetDeviceCaps(Some(hdc_screen), DESKTOPHORZRES);
        let phys_h = GetDeviceCaps(Some(hdc_screen), DESKTOPVERTRES);
        let log_w = GetSystemMetrics(SM_CXSCREEN);
        let log_h = GetSystemMetrics(SM_CYSCREEN);

        let (src_w, src_h) = if let Some(ref dxgi) = dxgi_opt {
            (dxgi.src_w as i32, dxgi.src_h as i32)
        } else {
            (
                if phys_w > 0 { phys_w } else { log_w.max(640) },
                if phys_h > 0 { phys_h } else { log_h.max(480) },
            )
        };

        // Mantem a resolucao nativa 1:1 (ate 1920x1200 Full HD/WUXGA) para nitidez perfeita pixel-a-pixel!
        let (mut out_w, mut out_h) = if src_w > MAX_VIDEO_WIDTH || src_h > MAX_VIDEO_HEIGHT {
            let scale =
                (MAX_VIDEO_WIDTH as f64 / (src_w as f64)).min(MAX_VIDEO_HEIGHT as f64 / (src_h as f64));
            (
                ((src_w as f64) * scale).round() as i32,
                ((src_h as f64) * scale).round() as i32,
            )
        } else {
            (src_w, src_h)
        };
        out_w = (out_w & !1).max(320);
        out_h = (out_h & !1).max(240);

        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.is_invalid() {
            let _ = ReleaseDC(None, hdc_screen);
            let err = "Falha ao criar DC em memoria".to_string();
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: out_w,
                biHeight: out_h, // Positivo = bottom-up DIB, layout nativo esperado pelo MFVideoFormat_RGB32
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: (out_w * out_h * 4) as u32,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut dib_bits: *mut std::ffi::c_void = ptr::null_mut();
        let hbitmap_res = CreateDIBSection(
            Some(hdc_mem),
            &bmi,
            DIB_RGB_COLORS,
            &mut dib_bits,
            None,
            0,
        );
        let Ok(hbitmap) = hbitmap_res else {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            let err = "Falha ao alocar DIBSection da tela".to_string();
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        };
        if hbitmap.is_invalid() || dib_bits.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            let err = "DIBSection invalida".to_string();
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }

        let old_obj: HGDIOBJ = SelectObject(hdc_mem, hbitmap.into());
        // COLORONCOLOR e ~5x mais leve que HALFTONE na CPU a cada frame
        let _ = SetStretchBltMode(hdc_mem, COLORONCOLOR);

        let wide_url: Vec<u16> = output_path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();

        let writer: IMFSinkWriter = match create_optimized_sink_writer(&wide_url) {
            Ok(w) => w,
            Err(err) => {
                SelectObject(hdc_mem, old_obj);
                let _ = DeleteObject(hbitmap.into());
                let _ = DeleteDC(hdc_mem);
                let _ = ReleaseDC(None, hdc_screen);
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        let video_stream = match configure_video_streams(&writer, out_w as u32, out_h as u32) {
            Ok(idx) => idx,
            Err(err) => {
                SelectObject(hdc_mem, old_obj);
                let _ = DeleteObject(hbitmap.into());
                let _ = DeleteDC(hdc_mem);
                let _ = ReleaseDC(None, hdc_screen);
                let _ = ready_tx.send(Err(err.clone()));
                return Err(err);
            }
        };

        let audio_stream = configure_audio_streams(&writer).ok();

        if let Err(e) = writer.BeginWriting() {
            SelectObject(hdc_mem, old_obj);
            let _ = DeleteObject(hbitmap.into());
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            let err = format!("BeginWriting falhou: {e}");
            let _ = ready_tx.send(Err(err.clone()));
            return Err(err);
        }

        // Inicia a captura simultanea de Microfone + Audio do Sistema (WASAPI Loopback)
        let mut audio_session = AudioCaptureSession::start();

        // Sinaliza que a gravacao comecou com sucesso!
        let _ = ready_tx.send(Ok(()));

        let start_instant = Instant::now();
        let frame_interval = Duration::from_micros(1_000_000 / (VIDEO_FPS as u64));
        let frame_byte_len = (out_w * out_h * 4) as usize;

        let mut prev_wall_hns: i64 = 0;
        let mut video_cursor_hns: i64 = 0;
        let mut total_audio_samples: u64 = 0;
        let mut pcm_bytes = Vec::<u8>::with_capacity((AUDIO_SAMPLE_RATE as usize / 2) * 2);

        while running.load(Ordering::Relaxed) {
            let loop_tick = Instant::now();
            let now_wall_hns = (start_instant.elapsed().as_secs_f64() * (HNS_PER_SEC as f64)) as i64;
            let raw_delta_hns = (now_wall_hns - prev_wall_hns).max(HNS_PER_SEC / 60);
            prev_wall_hns = now_wall_hns;

            // Limita saltos individuais a no maximo 333ms caso a CPU tenha congelado momentaneamente,
            // evitando pacotes gigantes ou buracos que corrompem o Finalize() do MP4
            let video_dur_hns = raw_delta_hns.clamp(HNS_PER_SEC / 30, HNS_PER_SEC / 3);

            let frame_slice_mut =
                std::slice::from_raw_parts_mut(dib_bits as *mut u8, frame_byte_len);

            // 1. Captura a tela via DXGI Desktop Duplication (sem tocar no GDI da tela)
            let mut captured_via_dxgi = false;
            if let Some(ref mut dxgi) = dxgi_opt {
                captured_via_dxgi = capture_dxgi_into_bottom_up(
                    dxgi,
                    frame_slice_mut,
                    out_w as u32,
                    out_h as u32,
                );
            }

            // Fallback GDI apenas se o primeiro frame DXGI ainda nao tiver chegado
            if !captured_via_dxgi {
                if out_w == src_w && out_h == src_h {
                    let _ = BitBlt(
                        hdc_mem,
                        0,
                        0,
                        out_w,
                        out_h,
                        Some(hdc_screen),
                        0,
                        0,
                        SRCCOPY,
                    );
                } else {
                    let _ = StretchBlt(
                        hdc_mem,
                        0,
                        0,
                        out_w,
                        out_h,
                        Some(hdc_screen),
                        0,
                        0,
                        src_w,
                        src_h,
                        SRCCOPY,
                    );
                }
            }

            // Desenha o cursor diretamente em memoria usando apenas GetCursorPos (nao bloqueia o hardware cursor!)
            let mut pt = windows::Win32::Foundation::POINT::default();
            if GetCursorPos(&mut pt).is_ok() {
                let cx = ((pt.x as i64 * out_w as i64) / (src_w.max(1) as i64)) as i32;
                let cy = ((pt.y as i64 * out_h as i64) / (src_h.max(1) as i64)) as i32;
                draw_synthetic_cursor_bottom_up(frame_slice_mut, out_w, out_h, cx, cy);
            }

            let _ = write_mf_sample(
                &writer,
                video_stream,
                frame_slice_mut,
                video_cursor_hns,
                video_dur_hns,
            );
            video_cursor_hns += video_dur_hns;

            // 2. Mixa o audio (Microfone + Audio do PC) com linha do tempo exata por amostra
            if let Some(a_stream) = audio_stream {
                let audio_now_hns =
                    (start_instant.elapsed().as_secs_f64() * (HNS_PER_SEC as f64)) as i64;
                let target_samples =
                    (((audio_now_hns.max(0) as i128) * (AUDIO_SAMPLE_RATE as i128))
                        / (HNS_PER_SEC as i128)) as u64;
                let needed_samples = target_samples.saturating_sub(total_audio_samples);

                if needed_samples >= 480 {
                    let step_samples = needed_samples.min((AUDIO_SAMPLE_RATE as u64) / 3) as usize;
                    let sample_ts_hns = samples_to_hns(total_audio_samples);
                    let next_ts_hns = samples_to_hns(total_audio_samples + (step_samples as u64));
                    let exact_dur_hns = (next_ts_hns - sample_ts_hns).max(1);

                    audio_session.mix_into_pcm(step_samples, &mut pcm_bytes);

                    let _ = write_mf_sample(
                        &writer,
                        a_stream,
                        &pcm_bytes,
                        sample_ts_hns,
                        exact_dur_hns,
                    );

                    total_audio_samples += step_samples as u64;
                }
            }

            let spent = loop_tick.elapsed();
            if spent < frame_interval {
                thread::sleep(frame_interval - spent);
            }
        }

        // Para os streams de audio antes do Finalize para liberar a CPU imediatamente
        drop(audio_session);

        if let Err(e) = writer.Finalize() {
            eprintln!("[screen-rec] writer.Finalize warning/error: {e}");
        }

        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn resampler_44100_to_48000_is_continuous_and_drift_free() {
            let mut resampler = LinearResampler::new(44_100, 48_000);
            let mut out = Vec::new();
            let mut all_out = Vec::new();
            let freq = 440.0_f32;

            // 1 segundo em blocos de 441 amostras (10 ms cada), simulando callbacks WASAPI
            for chunk_idx in 0..100 {
                let mut chunk = Vec::with_capacity(441);
                for i in 0..441 {
                    let n = (chunk_idx * 441 + i) as f32;
                    chunk.push((2.0 * std::f32::consts::PI * freq * n / 44_100.0).sin() * 0.5);
                }
                resampler.resample_into(&chunk, &mut out);
                all_out.extend_from_slice(&out);
            }

            assert!(
                (all_out.len() as isize - 48_000).abs() <= 2,
                "expected ~48000 samples, got {}",
                all_out.len()
            );

            // Verifica que nao ha saltos bruscos (clicks) entre blocos adjacentes
            let max_step = all_out
                .windows(2)
                .skip(10)
                .map(|w| (w[1] - w[0]).abs())
                .fold(0.0_f32, f32::max);
            assert!(max_step < 0.05, "unexpected discontinuity: max_step={max_step}");
        }

        #[test]
        fn mic_conditioner_suppresses_dc_and_low_hiss_but_passes_voice() {
            let mut cond = MicrophoneConditioner::new(48_000);
            let mut hiss_peak = 0.0_f32;

            // Simula 750 ms de offset DC + chiado baixo (-56 dBFS) para o filtro HP e release assentarem
            for i in 0..36_000 {
                let hiss = if i % 2 == 0 { 0.0015 } else { -0.0015 };
                let out = cond.process(0.15 + hiss);
                if i > 28_800 {
                    hiss_peak = hiss_peak.max(out.abs());
                }
            }
            assert!(hiss_peak < 0.001, "expected hiss suppressed, got {hiss_peak}");

            // Simula 200 ms de voz (senoide 400 Hz a 0.25 de amplitude)
            let mut voice_peak = 0.0_f32;
            for i in 0..9_600 {
                let sample = (2.0 * std::f32::consts::PI * 400.0 * (i as f32) / 48_000.0).sin() * 0.25;
                let out = cond.process(sample);
                if i > 2_400 {
                    voice_peak = voice_peak.max(out.abs());
                }
            }
            assert!(voice_peak > 0.20, "expected voice preserved, got {voice_peak}");
        }

        #[test]
        fn channel_buffer_fades_out_smoothly_on_underrun() {
            let mut channel = ChannelStreamBuffer::new(4, 100);
            let mut queue: VecDeque<f32> = (0..10).map(|_| 0.5_f32).collect();
            channel.prepare_for_drain(&mut queue);

            let mut prev = 0.0_f32;
            for _ in 0..10 {
                prev = channel.next_sample(&mut queue);
            }
            // Proxima amostra e underrun: deve decair suavemente em vez de cair direto para 0.0
            let after_underrun = channel.next_sample(&mut queue);
            assert!(
                (prev - after_underrun).abs() < 0.02 && after_underrun > 0.0,
                "expected smooth fade-out from {prev}, got {after_underrun}"
            );
        }

        #[test]
        fn soft_limiter_is_linear_below_threshold_and_bounded_above() {
            assert!((soft_limit(0.5) - 0.5).abs() < 1e-6);
            assert!((soft_limit(-0.8) - (-0.8)).abs() < 1e-6);
            assert!(soft_limit(2.0) < 1.0 && soft_limit(2.0) > 0.85);
            assert!(soft_limit(-2.0) > -1.0 && soft_limit(-2.0) < -0.85);
        }

        #[test]
        fn mf_sink_writer_configures_video_and_audio_streams() {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
                MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET).expect("MFStartup failed");
                let temp_path = std::env::temp_dir().join("todocompanion_mf_audio_test.mp4");
                let wide_url: Vec<u16> = temp_path
                    .as_os_str()
                    .to_string_lossy()
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let writer = create_optimized_sink_writer(&wide_url).expect("sink writer failed");
                let v_idx = configure_video_streams(&writer, 640, 360).expect("video stream failed");
                let a_res = configure_audio_streams(&writer);
                println!("video_stream={v_idx}, audio_stream={a_res:?}");
                let a_idx = a_res.expect("audio stream failed");
                writer.BeginWriting().expect("BeginWriting failed");
                let pcm = vec![0u8; 4800 * (AUDIO_CHANNELS as usize) * 2];
                write_mf_sample(&writer, a_idx, &pcm, 0, 1_000_000).expect("write audio failed");
                let _ = writer.Finalize();
                drop(writer);
                let _ = std::fs::remove_file(&temp_path);
                let _ = MFShutdown();
                CoUninitialize();
            }
        }
    }
}

#[tauri::command]
async fn native_screen_recording_start(
    app: tauri::AppHandle,
    state: State<'_, NativeScreenRecorderState>,
    user_id: String,
    sub_dir: Option<String>,
    file_name: String,
    audio_only: Option<bool>,
) -> Result<RecordingTarget, String> {
    let is_audio_only = audio_only.unwrap_or(false);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, user_id, sub_dir, file_name, is_audio_only);
        return Err("Gravacao nativa disponivel apenas no Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "NativeScreenRecorderState poisoned".to_string())?;
        if let Some(mut prev) = guard.take() {
            prev.running.store(false, Ordering::Relaxed);
            if let Some(h) = prev.join_handle.take() {
                let _ = h.join();
            }
        }

        let user_dir = ensure_user_dir(&app, &user_id)?;
        let relative_dir = sanitize_sub_dir(sub_dir.as_deref());
        let mut dir = user_dir;
        for segment in &relative_dir {
            dir = dir.join(segment);
        }
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        let target_ext = if is_audio_only { ".m4a" } else { ".mp4" };
        let default_stem = if is_audio_only { "Audio" } else { "Recording" };
        let media_name = if file_name.to_lowercase().ends_with(target_ext) {
            file_name
        } else {
            let stem = Path::new(&file_name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| default_stem.to_string());
            format!("{stem}{target_ext}")
        };

        let stored_name = unique_filename(&dir, &media_name);
        let path = dir.join(&stored_name);

        let mut parts = relative_dir;
        parts.push(stored_name.clone());
        let relative_file = parts.join("/");

        let running = Arc::new(AtomicBool::new(true));
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let join_handle = win_screen_recorder::spawn_screen_recorder(
            path.clone(),
            Arc::clone(&running),
            ready_tx,
            is_audio_only,
        );

        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                running.store(false, Ordering::Relaxed);
                let _ = join_handle.join();
                let _ = fs::remove_file(&path);
                return Err(err);
            }
            Err(_) => {
                running.store(false, Ordering::Relaxed);
                let _ = join_handle.join();
                let _ = fs::remove_file(&path);
                return Err("Timeout ao iniciar gravador nativo".to_string());
            }
        }

        *guard = Some(ActiveNativeScreenRecording {
            running,
            path,
            relative_file: relative_file.clone(),
            original_name: media_name,
            join_handle: Some(join_handle),
        });

        Ok(RecordingTarget {
            session_id: "native".to_string(),
            file: relative_file,
            stored_name,
        })
    }
}

#[tauri::command]
async fn native_screen_recording_stop(
    state: State<'_, NativeScreenRecorderState>,
) -> Result<AttachmentInfo, String> {
    let active_opt = {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| "NativeScreenRecorderState poisoned".to_string())?;
        guard.take()
    };

    let Some(mut active) = active_opt else {
        return Err("Nenhuma gravacao nativa em andamento".to_string());
    };

    active.running.store(false, Ordering::Relaxed);

    tauri::async_runtime::spawn_blocking(move || {
        if let Some(handle) = active.join_handle.take() {
            let _ = handle.join();
        }
        let size = fs::metadata(&active.path).map(|m| m.len()).unwrap_or(0);
        if size == 0 {
            let _ = fs::remove_file(&active.path);
            return Err("Arquivo de gravacao vazio".to_string());
        }
        Ok(AttachmentInfo {
            file: active.relative_file,
            original_name: active.original_name,
            size,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn push_resampled_mono(
    dest: &Arc<Mutex<Vec<f32>>>,
    mono_chunk: &[f32],
    in_rate: u32,
    chunk_start: &Arc<Mutex<Instant>>,
) {
    if mono_chunk.is_empty() || in_rate == 0 {
        return;
    }

    let ratio = TARGET_SAMPLE_RATE as f64 / in_rate as f64;
    let out_len = ((mono_chunk.len() as f64) * ratio).max(1.0).round() as usize;
    let mut resampled = Vec::with_capacity(out_len);

    for i in 0..out_len {
        let src_pos = (i as f64) / ratio;
        let idx = src_pos.floor() as usize;
        let frac = (src_pos - (idx as f64)) as f32;
        let s0 = mono_chunk.get(idx).copied().unwrap_or(0.0);
        let s1 = mono_chunk.get(idx + 1).copied().unwrap_or(s0);
        resampled.push(s0 + (s1 - s0) * frac);
    }

    let elapsed_secs = chunk_start
        .lock()
        .map(|t| t.elapsed().as_secs_f64())
        .unwrap_or(0.0);

    if let Ok(mut buf) = dest.lock() {
        let expected_total = (elapsed_secs * (TARGET_SAMPLE_RATE as f64)) as usize;
        // Se houve silencio longo (comum no WASAPI loopback quando nenhum som toca no PC),
        // preenche com silencio para manter sincronia temporal com o microfone.
        if buf.len() + resampled.len() + (TARGET_SAMPLE_RATE as usize / 5) < expected_total {
            let target_len = expected_total.saturating_sub(resampled.len());
            if target_len > buf.len() && target_len - buf.len() < TARGET_SAMPLE_RATE as usize * 600 {
                buf.resize(target_len, 0.0);
            }
        }
        buf.extend_from_slice(&resampled);
    }
}

fn build_cpal_capture_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    dest: Arc<Mutex<Vec<f32>>>,
    chunk_start: Arc<Mutex<Instant>>,
) -> Option<cpal::Stream> {
    let channels = config.channels() as usize;
    let in_rate = config.sample_rate().0;
    let sample_format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.clone().into();
    let err_fn = |err| eprintln!("[ai-audio] stream error: {err}");

    match sample_format {
        cpal::SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    if channels == 0 {
                        return;
                    }
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| frame.iter().copied().sum::<f32>() / (frame.len() as f32))
                        .collect();
                    push_resampled_mono(&dest, &mono, in_rate, &chunk_start);
                },
                err_fn,
                None,
            )
            .ok(),
        cpal::SampleFormat::I16 => device
            .build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    if channels == 0 {
                        return;
                    }
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            let sum: f32 = frame.iter().map(|&s| (s as f32) / 32768.0).sum();
                            sum / (frame.len() as f32)
                        })
                        .collect();
                    push_resampled_mono(&dest, &mono, in_rate, &chunk_start);
                },
                err_fn,
                None,
            )
            .ok(),
        cpal::SampleFormat::U16 => device
            .build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    if channels == 0 {
                        return;
                    }
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            let sum: f32 = frame
                                .iter()
                                .map(|&s| ((s as f32) - 32768.0) / 32768.0)
                                .sum();
                            sum / (frame.len() as f32)
                        })
                        .collect();
                    push_resampled_mono(&dest, &mono, in_rate, &chunk_start);
                },
                err_fn,
                None,
            )
            .ok(),
        _ => None,
    }
}

fn normalize_channel_peak(samples: &mut [f32], min_peak_threshold: f32, target_peak: f32) {
    let peak = samples
        .iter()
        .fold(0.0_f32, |acc, &x| acc.max(x.abs()));
    if peak >= min_peak_threshold && peak > 0.0 {
        let gain = (target_peak / peak).min(12.0);
        for s in samples.iter_mut() {
            *s = (*s * gain).clamp(-1.0, 1.0);
        }
    }
}

fn encode_wav_16khz_mono(mut mic: Vec<f32>, mut sys: Vec<f32>) -> Vec<u8> {
    normalize_channel_peak(&mut mic, 0.006, 0.82);
    normalize_channel_peak(&mut sys, 0.003, 0.82);

    let total_len = mic.len().max(sys.len());
    let mut pcm_bytes = Vec::with_capacity(total_len * 2);

    for i in 0..total_len {
        let m = mic.get(i).copied().unwrap_or(0.0);
        let s = sys.get(i).copied().unwrap_or(0.0);
        let mixed = if m.abs() > 0.001 && s.abs() > 0.001 {
            (m + s) * 0.72
        } else {
            m + s
        };
        let clamped = mixed.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * 32767.0) as i16;
        pcm_bytes.extend_from_slice(&sample_i16.to_le_bytes());
    }

    let data_len = pcm_bytes.len() as u32;
    let file_len = 36 + data_len;
    let byte_rate = TARGET_SAMPLE_RATE * 2;
    let block_align: u16 = 2;

    let mut wav = Vec::with_capacity(44 + pcm_bytes.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_len.to_le_bytes());
    wav.extend_from_slice(b"WAVE");
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // 1 channel (mixed & normalized)
    wav.extend_from_slice(&TARGET_SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes()); // 16-bit
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    wav.extend_from_slice(&pcm_bytes);
    wav
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(triple & 0x3F) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[tauri::command]
fn ai_audio_capture_start(state: State<'_, AiAudioCaptureState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Audio capture lock poisoned".to_string())?;
    if let Some(mut prev) = guard.take() {
        prev.running.store(false, Ordering::Relaxed);
        if let Some(handle) = prev.join_handle.take() {
            let _ = handle.join();
        }
    }

    let running = Arc::new(AtomicBool::new(true));
    let mic_samples = Arc::new(Mutex::new(Vec::with_capacity(TARGET_SAMPLE_RATE as usize * 15)));
    let sys_samples = Arc::new(Mutex::new(Vec::with_capacity(TARGET_SAMPLE_RATE as usize * 15)));
    let chunk_start = Arc::new(Mutex::new(Instant::now()));

    let run_flag = Arc::clone(&running);
    let mic_buf = Arc::clone(&mic_samples);
    let sys_buf = Arc::clone(&sys_samples);
    let mic_clock = Arc::clone(&chunk_start);
    let sys_clock = Arc::clone(&chunk_start);

    let join_handle = thread::spawn(move || {
        let host = cpal::default_host();

        let _mic_stream = host
            .default_input_device()
            .and_then(|dev| {
                let cfg = dev.default_input_config().ok()?;
                let s = build_cpal_capture_stream(&dev, &cfg, mic_buf, mic_clock)?;
                s.play().ok()?;
                Some(s)
            });

        // No Windows (WASAPI), abrir um input_stream no default_output_device ativa
        // automaticamente AUDCLNT_STREAMFLAGS_LOOPBACK, capturando todo o audio do PC/videos/reunioes
        // sem precisar de nenhum popup de compartilhamento de tela!
        let _sys_stream = host
            .default_output_device()
            .and_then(|dev| {
                let cfg = dev.default_output_config().ok()?;
                let s = build_cpal_capture_stream(&dev, &cfg, sys_buf, sys_clock)?;
                s.play().ok()?;
                Some(s)
            });

        while run_flag.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(25));
        }
    });

    *guard = Some(ActiveAiAudioCapture {
        running,
        mic_samples,
        sys_samples,
        chunk_start,
        join_handle: Some(join_handle),
    });

    Ok(())
}

fn drain_ai_audio_capture(
    state: &State<'_, AiAudioCaptureState>,
    stop: bool,
) -> Result<(Vec<f32>, Vec<f32>), String> {
    let mut guard = state.0.lock().map_err(|_| "Audio capture lock poisoned".to_string())?;
    if stop {
        if let Some(mut active) = guard.take() {
            active.running.store(false, Ordering::Relaxed);
            if let Some(handle) = active.join_handle.take() {
                let _ = handle.join();
            }
            let m = active.mic_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
            let s = active.sys_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
            return Ok((m, s));
        }
        return Ok((Vec::new(), Vec::new()));
    }
    if let Some(active) = guard.as_ref() {
        let m = active.mic_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
        let s = active.sys_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
        if let Ok(mut clock) = active.chunk_start.lock() {
            *clock = Instant::now();
        }
        return Ok((m, s));
    }
    Ok((Vec::new(), Vec::new()))
}

#[tauri::command]
async fn ai_audio_capture_flush_and_transcribe(
    state: State<'_, AiAudioCaptureState>,
    stop: bool,
    fallback_mime_type: Option<String>,
    fallback_audio_base64: Option<String>,
) -> Result<String, String> {
    let (mic_vec, sys_vec) = drain_ai_audio_capture(&state, stop)?;

    let mic_peak = mic_vec.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs()));
    let sys_peak = sys_vec.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs()));

    let has_native_speech = (mic_vec.len() > (TARGET_SAMPLE_RATE as usize / 4) && mic_peak >= 0.008)
        || (sys_vec.len() > (TARGET_SAMPLE_RATE as usize / 4) && sys_peak >= 0.003);

    if has_native_speech {
        let wav_bytes = encode_wav_16khz_mono(mic_vec, sys_vec);
        let b64 = encode_base64(&wav_bytes);
        return transcribe_audio_gemini(None, "audio/wav".to_string(), b64).await;
    }

    if let Some(fb_b64) = fallback_audio_base64 {
        if !fb_b64.trim().is_empty() {
            let mime = fallback_mime_type.unwrap_or_else(|| "audio/webm".to_string());
            return transcribe_audio_gemini(None, mime, fb_b64).await;
        }
    }

    Ok(String::new())
}

#[tauri::command]
async fn ai_audio_capture_stop_and_transcribe(
    state: State<'_, AiAudioCaptureState>,
    fallback_mime_type: Option<String>,
    fallback_audio_base64: Option<String>,
) -> Result<String, String> {
    ai_audio_capture_flush_and_transcribe(state, true, fallback_mime_type, fallback_audio_base64).await
}

#[tauri::command]
async fn ai_live_coach_flush_and_advise(
    state: State<'_, AiAudioCaptureState>,
    api_key: Option<String>,
    recent_context: Option<String>,
    stop: bool,
) -> Result<Option<String>, String> {
    let (mic_vec, sys_vec) = drain_ai_audio_capture(&state, stop)?;
    if stop {
        return Ok(None);
    }

    let mic_peak = mic_vec.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs()));
    let sys_peak = sys_vec.iter().fold(0.0_f32, |acc, &x| acc.max(x.abs()));
    let min_samples = (TARGET_SAMPLE_RATE as usize * 2) / 5; // >= 0.4s

    let has_other = sys_vec.len() >= min_samples && sys_peak >= 0.003;
    let raw_has_user = mic_vec.len() >= min_samples && mic_peak >= 0.010;
    // Evita eco fraco de alto-falante vazando no microfone quando a outra pessoa fala alto
    let has_user = raw_has_user && (!has_other || mic_peak >= sys_peak * 0.28);

    if !has_other && !has_user {
        return Ok(None);
    }

    let (key, all_models) = resolve_gemini_key_and_models(api_key)?;
    let audio_models: Vec<String> = all_models
        .into_iter()
        .filter(|m| !m.starts_with("gemma-"))
        .collect();
    if audio_models.is_empty() {
        return Err("Nenhum modelo Gemini com suporte a áudio disponível.".to_string());
    }

    let sys_b64 = if has_other {
        Some(encode_base64(&encode_wav_16khz_mono(Vec::new(), sys_vec)))
    } else {
        None
    };
    let mic_b64 = if has_user {
        Some(encode_base64(&encode_wav_16khz_mono(mic_vec, Vec::new())))
    } else {
        None
    };
    let context_str = recent_context.unwrap_or_default().trim().to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let mut parts: Vec<serde_json::Value> = Vec::new();

        if let Some(other_audio) = sys_b64 {
            let prompt = format!(
                "You are a real-time English conversation teacher & meeting coach helping a Brazilian Portuguese speaker during a live call.\n\
                 You will receive SEPARATE labeled audio channels:\n\
                 - AUDIO_OTHER_PERSON: the other person speaking on the PC/call. ONLY help the user respond to AUDIO_OTHER_PERSON.\n\
                 - AUDIO_USER (optional): the user speaking into their own microphone. NEVER suggest replying to AUDIO_USER; use it strictly as conversation memory/context.\n\
                 DO NOT output a verbatim transcript.\n\
                 Recent conversation memory:\n{context_str}\n\n\
                 Rules:\n\
                 1. If AUDIO_OTHER_PERSON has only silence, noise, or nothing actionable to respond to, return EXACTLY: {{\"skip\":true,\"userContext\":\"optional 1-sentence PT-BR summary if AUDIO_USER spoke, else empty\"}}\n\
                 2. Otherwise, return ONLY valid JSON (no markdown fences) with this exact schema:\n\
                 {{\"skip\":false,\"heardSummary\":\"Resumo objetivo em PT-BR (1 frase) do que a OUTRA PESSOA acabou de explicar ou perguntar\",\"userContext\":\"Resumo curto em PT-BR do que o usuário disse se AUDIO_USER estiver presente, senão string vazia\",\"suggestions\":[{{\"tone\":\"Natural\",\"en\":\"A complete, specific, natural 1-2 sentence English response (15-28 words) that directly references what they just said and keeps the conversation flowing (e.g. with a reaction + follow-up thought or question)\",\"pt\":\"Tradução fiel em PT-BR\"}},{{\"tone\":\"Detailed\",\"en\":\"A thoughtful, articulate 1-2 sentence English response (18-32 words) suitable for a deeper or more professional exchange on the exact topic being discussed\",\"pt\":\"Tradução fiel em PT-BR\"}}],\"tip\":\"Dica rápida de professor em PT-BR (opcional, 1 frase curta explicando uma expressão útil usada acima)\"}}\n\
                 3. NEVER give generic 2-5 word clichés like 'Sounds good!', 'That's interesting!', or 'I agree.'. Every suggestion MUST be a full, specific, ready-to-speak response tailored to the exact details heard in AUDIO_OTHER_PERSON and the conversation memory."
            );
            parts.push(serde_json::json!({ "text": prompt }));
            parts.push(serde_json::json!({ "text": "AUDIO_OTHER_PERSON:" }));
            parts.push(serde_json::json!({
                "inlineData": {
                    "mimeType": "audio/wav",
                    "data": other_audio
                }
            }));
            if let Some(user_audio) = mic_b64 {
                parts.push(serde_json::json!({ "text": "AUDIO_USER (context only, do NOT reply to this):" }));
                parts.push(serde_json::json!({
                    "inlineData": {
                        "mimeType": "audio/wav",
                        "data": user_audio
                    }
                }));
            }
        } else if let Some(user_audio) = mic_b64 {
            let prompt = format!(
                "You are silently tracking conversation memory for a live English coach.\n\
                 This audio is ONLY the USER speaking into their own microphone (NOT the other person).\n\
                 Recent conversation memory:\n{context_str}\n\n\
                 Return ONLY valid JSON (no markdown fences):\n\
                 {{\"skip\":true,\"userContext\":\"1 short sentence in PT-BR summarizing what the user just said (or empty string if only noise/breathing)\"}}\n\
                 NEVER set skip to false here."
            );
            parts.push(serde_json::json!({ "text": prompt }));
            parts.push(serde_json::json!({
                "inlineData": {
                    "mimeType": "audio/wav",
                    "data": user_audio
                }
            }));
        } else {
            return Ok(None);
        }

        let payload = serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": parts
            }],
            "generationConfig": {
                "temperature": 0.3
            }
        });

        let (text, _model) = execute_gemini_fast_payload_with_model(&key, &audio_models, payload, false)?;
        Ok(Some(text))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn transcribe_audio_gemini(
    api_key: Option<String>,
    mime_type: String,
    audio_base64: String,
) -> Result<String, String> {
    let env_vars = load_dotenv_vars();
    let provided_key = api_key.unwrap_or_default().trim().to_string();
    let key = if !provided_key.is_empty() {
        provided_key
    } else {
        env_vars.get("GEMINI_API_KEY").cloned().unwrap_or_default()
    };

    if key.is_empty() {
        return Err("GEMINI_API_KEY nao encontrada no arquivo .env".to_string());
    }

    let env_model = env_vars
        .get("GEMINI_MODEL")
        .cloned()
        .unwrap_or_else(|| "gemini-2.5-flash".to_string());

    let clean_mime = mime_type
        .split(';')
        .next()
        .unwrap_or("audio/webm")
        .trim()
        .to_string();

    tauri::async_runtime::spawn_blocking(move || {
        let mut models: Vec<String> = vec!["gemini-3.5-transcribe".to_string()];
        if !env_model.trim().is_empty()
            && !env_model.trim().starts_with("gemma-")
            && !models.iter().any(|m| m == env_model.trim())
        {
            models.push(env_model.trim().to_string());
        }
        for &fallback in GEMINI_MODEL_CASCADE {
            if fallback.starts_with("gemma-") {
                continue;
            }
            if !models.iter().any(|m| m == fallback) {
                models.push(fallback.to_string());
            }
        }
        let models = order_models_by_availability(models);

        let prompt = "Transcreva fielmente todo o áudio a seguir no idioma original falado.\n\
                      Regras obrigatórias:\n\
                      1. Diferencie quem está falando (diarização de locutores). Sempre que houver mais de uma pessoa falando (por exemplo, diálogo entre pessoas, reunião ou vídeo com diferentes vozes), identifique cada fala em uma nova linha colocando o identificador do locutor no início, como 'Locutor 1:', 'Locutor 2:' (ou o nome real da pessoa se for mencionado no áudio).\n\
                      2. Se houver apenas uma única pessoa falando durante todo o áudio, transcreva o texto diretamente com pontuação adequada e parágrafos claros.\n\
                      3. Retorne APENAS a transcrição pronta, sem introduções, sem títulos e sem comentários extras. Se não houver fala audível, retorne apenas uma string vazia.";

        let payload = serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": [
                    { "text": prompt },
                    {
                        "inlineData": {
                            "mimeType": clean_mime,
                            "data": audio_base64
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.1
            }
        });

        let endpoints = [
            "https://generativelanguage.googleapis.com/v1beta/models",
            "https://aiplatform.googleapis.com/v1/publishers/google/models",
        ];

        let mut last_err = String::from("Falha ao contatar a API do Gemini");

        for base_url in &endpoints {
            for model in &models {
                let url = format!("{}/{}:generateContent?key={}", base_url, model, key);
                match default_http_agent().post(&url)
                    .set("Content-Type", "application/json")
                    .timeout(Duration::from_secs(120))
                    .send_json(payload.clone())
                {
                    Ok(resp) => {
                        let body: serde_json::Value = resp
                            .into_json()
                            .map_err(|e| format!("Resposta invalida do Gemini: {e}"))?;
                        let mut combined = String::new();
                        if let Some(parts) = body["candidates"][0]["content"]["parts"].as_array() {
                            for p in parts {
                                if p.get("thought").and_then(|v| v.as_bool()).unwrap_or(false) {
                                    continue;
                                }
                                if let Some(t) = p["text"].as_str() {
                                    combined.push_str(t);
                                }
                            }
                        }
                        return Ok(combined.trim().to_string());
                    }
                    Err(ureq::Error::Status(code, resp)) => {
                        let err_body = resp.into_string().unwrap_or_default();
                        last_err = format!("Gemini HTTP {code} ({model}): {err_body}");
                        if code == 429 {
                            mark_model_cooldown(model, Duration::from_secs(30));
                        } else if code == 503 || code == 502 || code == 500 || code == 504 {
                            mark_model_cooldown(model, Duration::from_secs(45));
                        } else if code == 404 {
                            mark_model_cooldown(model, Duration::from_secs(600));
                        }
                    }
                    Err(e) => {
                        last_err = format!("Erro de rede ao chamar Gemini ({model}): {e}");
                    }
                }
            }
        }

        Err(last_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn infer_media_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("webm") => "video/webm",
        Some("ogg") => "audio/ogg",
        Some("ogv") => "video/ogg",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("aac") => "audio/aac",
        Some("flac") => "audio/flac",
        _ => "audio/mp4",
    }
}

fn upload_gemini_media_file(
    key: &str,
    path: &Path,
    mime: &str,
) -> Result<(String, String), String> {
    let file = fs::File::open(path).map_err(|e| format!("Falha ao abrir arquivo: {e}"))?;
    let upload_url = format!(
        "https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=media&key={}",
        key
    );
    let resp = default_http_agent().post(&upload_url)
        .set("Content-Type", mime)
        .timeout(Duration::from_secs(300))
        .send(file)
        .map_err(|e| format!("Falha ao enviar midia para Gemini Files API: {e}"))?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("Resposta invalida do upload Gemini: {e}"))?;
    let file_name = body["file"]["name"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let file_uri = body["file"]["uri"]
        .as_str()
        .unwrap_or("")
        .to_string();
    if file_name.is_empty() || file_uri.is_empty() {
        return Err("Upload Gemini nao retornou URI do arquivo".to_string());
    }

    // Aguarda o processamento do arquivo de video/audio ficar ACTIVE
    let status_url = format!(
        "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
        file_name, key
    );
    for _ in 0..45 {
        let state_str = match default_http_agent().get(&status_url).timeout(Duration::from_secs(15)).call() {
            Ok(r) => r
                .into_json::<serde_json::Value>()
                .ok()
                .and_then(|v| v["state"].as_str().map(|s| s.to_string()))
                .unwrap_or_default(),
            Err(_) => String::new(),
        };
        if state_str == "ACTIVE" {
            return Ok((file_name, file_uri));
        }
        if state_str == "FAILED" {
            return Err("Gemini falhou ao processar o arquivo de midia".to_string());
        }
        thread::sleep(Duration::from_secs(2));
    }

    Ok((file_name, file_uri))
}

#[tauri::command]
async fn transcribe_attachment_zoom_summary(
    app: tauri::AppHandle,
    user_id: String,
    file: String,
    display_name: Option<String>,
    api_key: Option<String>,
) -> Result<String, String> {
    let path = app_root(&app)?.join(&user_id).join(&file);
    if !path.exists() {
        return Err("Arquivo de anexo nao encontrado".to_string());
    }
    let (key, all_models) = resolve_gemini_key_and_models(api_key)?;
    let title = display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Gravação".to_string())
        });

    tauri::async_runtime::spawn_blocking(move || {
        let mime = infer_media_mime(&path);
        let size = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        if size == 0 {
            return Err("Arquivo de midia vazio".to_string());
        }

        let mut uploaded_file_name: Option<String> = None;
        let media_part = if size <= 15 * 1024 * 1024 {
            let bytes = fs::read(&path).map_err(|e| format!("Falha ao ler arquivo: {e}"))?;
            serde_json::json!({
                "inlineData": {
                    "mimeType": mime,
                    "data": encode_base64(&bytes)
                }
            })
        } else {
            let (fname, furi) = upload_gemini_media_file(&key, &path, mime)?;
            uploaded_file_name = Some(fname);
            serde_json::json!({
                "fileData": {
                    "mimeType": mime,
                    "fileUri": furi
                }
            })
        };

        let prompt = format!(
            "Analise o áudio/vídeo anexado ('{title}') e gere uma transcrição e ata executiva super organizada no estilo Zoom AI Companion, no mesmo idioma falado na gravação.\n\
             Regras de formatação (use APENAS texto limpo, tags <b>...</b> para títulos/negrito e '[ ] ' no início dos próximos passos — NÃO use markdown com # ou **):\n\n\
             <b>Resumo — {title}</b>\n\n\
             <b>Objetivo</b>\n\
             (1 a 2 frases claras explicando o propósito principal da gravação/reunião)\n\n\
             <b>Participantes / Quem falou</b>\n\
             • Identifique cada pessoa pelo nome (se mencionado) ou como 'Locutor 1', 'Locutor 2', etc., resumindo brevemente sua participação.\n\n\
             <b>Principais Tópicos e Decisões</b>\n\
             • Liste os pontos mais importantes discutidos e decisões tomadas de forma objetiva.\n\n\
             <b>Próximos Passos</b>\n\
             [ ] Liste ações práticas e pendências mencionadas (com responsável/prazo se citados). Se não houver ações, escreva 'Nenhuma ação pendente mencionada.'\n\n\
             <b>Transcrição Organizada</b>\n\
             Apresente as falas principais organizadas por locutor (ex.: <b>Locutor 1:</b> ...), removendo vícios de linguagem mas preservando fielmente o conteúdo.\n\n\
             Retorne APENAS o conteúdo pronto para o card, sem introduções fora dessa estrutura."
        );

        let payload = serde_json::json!({
            "contents": [{
                "role": "user",
                "parts": [
                    { "text": prompt },
                    media_part
                ]
            }],
            "generationConfig": {
                "temperature": 0.2
            }
        });

        let models: Vec<String> = all_models
            .into_iter()
            .filter(|m| !m.starts_with("gemma-") && m != "gemini-3.5-transcribe")
            .collect();
        let ordered = order_models_by_availability(models);

        let mut last_err = String::from("Falha ao transcrever arquivo com Gemini");
        let mut final_result: Option<String> = None;

        for model in &ordered {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, key
            );
            match default_http_agent().post(&url)
                .set("Content-Type", "application/json")
                .timeout(Duration::from_secs(180))
                .send_json(payload.clone())
            {
                Ok(resp) => {
                    let body: serde_json::Value = resp
                        .into_json()
                        .map_err(|e| format!("Resposta invalida do Gemini: {e}"))?;
                    let mut combined = String::new();
                    if let Some(parts) = body["candidates"][0]["content"]["parts"].as_array() {
                        for p in parts {
                            if p.get("thought").and_then(|v| v.as_bool()).unwrap_or(false) {
                                continue;
                            }
                            if let Some(t) = p["text"].as_str() {
                                combined.push_str(t);
                            }
                        }
                    }
                    let cleaned = combined.trim();
                    if !cleaned.is_empty() {
                        final_result = Some(cleaned.to_string());
                        break;
                    }
                }
                Err(ureq::Error::Status(code, resp)) => {
                    let err_body = resp.into_string().unwrap_or_default();
                    last_err = format!("Gemini HTTP {code} ({model}): {err_body}");
                    if code == 429 {
                        let secs = if err_body.contains("PerDay") || err_body.contains("DAILY") {
                            300
                        } else {
                            30
                        };
                        mark_model_cooldown(model, Duration::from_secs(secs));
                    } else if code == 503 || code == 502 || code == 500 || code == 504 {
                        mark_model_cooldown(model, Duration::from_secs(45));
                    } else if code == 404 {
                        mark_model_cooldown(model, Duration::from_secs(600));
                    }
                }
                Err(e) => {
                    last_err = format!("Erro de rede ao chamar Gemini ({model}): {e}");
                }
            }
        }

        if let Some(fname) = uploaded_file_name {
            let del_url = format!(
                "https://generativelanguage.googleapis.com/v1beta/{}?key={}",
                fname, key
            );
            let _ = default_http_agent().delete(&del_url).timeout(Duration::from_secs(15)).call();
        }

        final_result.ok_or(last_err)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn attachment_save_from_path(
    app: tauri::AppHandle,
    user_id: String,
    sub_dir: Option<String>,
    source_path: String,
) -> Result<AttachmentInfo, String> {
    let src = PathBuf::from(&source_path);
    let original_name = src
        .file_name()
        .ok_or_else(|| "Invalid file path".to_string())?
        .to_string_lossy()
        .to_string();
    let mut dir = ensure_user_dir(&app, &user_id)?;
    if let Some(sub) = sub_dir {
        dir = dir.join(&sub);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }

    // Se o arquivo escolhido ja esta dentro da pasta de anexos desta task, reutiliza sem duplicar
    let already_in_dir = src
        .parent()
        .and_then(|p| p.canonicalize().ok())
        .zip(dir.canonicalize().ok())
        .map(|(src_parent, target_dir)| src_parent == target_dir)
        .unwrap_or(false);

    let (stored_name, dest) = if already_in_dir && src.is_file() {
        (original_name.clone(), src.clone())
    } else {
        let unique = unique_filename(&dir, &original_name);
        let target = dir.join(&unique);
        fs::copy(&src, &target).map_err(|e| e.to_string())?;
        (unique, target)
    };

    // The relative path from the user's directory
    let relative_file = if let Some(sub) = dir.strip_prefix(app_root(&app)?.join(&user_id)).ok() {
        sub.join(&stored_name).to_string_lossy().replace("\\", "/")
    } else {
        stored_name.clone()
    };

    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(AttachmentInfo {
        file: relative_file,
        original_name: stored_name,
        size,
    })
}

fn sanitize_attachment_rename(raw_name: &str, current_name: &str) -> Result<String, String> {
    let cleaned: String = raw_name
        .trim()
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        return Err("Nome de arquivo invalido".to_string());
    }

    let current_ext = Path::new(current_name)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty());
    let new_has_ext = Path::new(trimmed)
        .extension()
        .and_then(|e| e.to_str())
        .filter(|e| !e.is_empty())
        .is_some();

    if !new_has_ext {
        if let Some(ext) = current_ext {
            return Ok(format!("{trimmed}.{ext}"));
        }
    }
    Ok(trimmed.to_string())
}

#[tauri::command]
fn attachment_list_dir(
    app: tauri::AppHandle,
    user_id: String,
    sub_dir: Option<String>,
) -> Result<Vec<AttachmentInfo>, String> {
    let user_root = app_root(&app)?.join(&user_id);
    let mut dir = user_root.clone();
    if let Some(sub) = sub_dir {
        dir = dir.join(&sub);
    }
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for item in read_dir.flatten() {
        let path = item.path();
        if !path.is_file() {
            continue;
        }
        let Some(name_os) = path.file_name() else {
            continue;
        };
        let name = name_os.to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let size = item.metadata().map(|m| m.len()).unwrap_or(0);
        let relative_file = path
            .strip_prefix(&user_root)
            .map(|p| p.to_string_lossy().replace("\\", "/"))
            .unwrap_or_else(|_| name.clone());
        entries.push(AttachmentInfo {
            file: relative_file,
            original_name: name,
            size,
        });
    }

    entries.sort_by(|a, b| {
        a.original_name
            .to_lowercase()
            .cmp(&b.original_name.to_lowercase())
    });
    Ok(entries)
}

#[tauri::command]
fn attachment_rename(
    app: tauri::AppHandle,
    user_id: String,
    file: String,
    new_name: String,
) -> Result<AttachmentInfo, String> {
    let user_root = app_root(&app)?.join(&user_id);
    let old_path = user_root.join(&file);
    if !old_path.is_file() {
        return Err("Arquivo nao encontrado".to_string());
    }
    let canon_root = user_root.canonicalize().map_err(|e| e.to_string())?;
    let canon_old = old_path.canonicalize().map_err(|e| e.to_string())?;
    if !canon_old.starts_with(&canon_root) {
        return Err("Caminho invalido".to_string());
    }

    let current_name = old_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let final_name = sanitize_attachment_rename(&new_name, &current_name)?;

    let parent = old_path
        .parent()
        .ok_or_else(|| "Diretorio invalido".to_string())?;
    let new_path = parent.join(&final_name);

    if final_name != current_name {
        if new_path.exists() && final_name.to_lowercase() != current_name.to_lowercase() {
            return Err("Ja existe um arquivo com esse nome".to_string());
        }
        fs::rename(&old_path, &new_path).map_err(|e| format!("Falha ao renomear: {e}"))?;
    }

    let relative_file = new_path
        .strip_prefix(&user_root)
        .map(|p| p.to_string_lossy().replace("\\", "/"))
        .unwrap_or_else(|_| final_name.clone());
    let size = fs::metadata(&new_path).map(|m| m.len()).unwrap_or(0);

    Ok(AttachmentInfo {
        file: relative_file,
        original_name: final_name,
        size,
    })
}

#[cfg(target_os = "windows")]
fn open_native_file_dialog(initial_dir: &Path, filter_kind: &str) -> Option<String> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::UI::Controls::Dialogs::{
        GetOpenFileNameW, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_NOCHANGEDIR, OFN_PATHMUSTEXIST,
        OPENFILENAMEW,
    };

    let filter_str = match filter_kind {
        "video" => "Videos (*.mp4;*.webm;*.mov;*.mkv;*.m4v;*.avi;*.ogg)\0*.mp4;*.webm;*.mov;*.mkv;*.m4v;*.avi;*.ogg\0Todos os arquivos (*.*)\0*.*\0\0",
        "image" => "Imagens (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.bmp)\0*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.bmp\0Todos os arquivos (*.*)\0*.*\0\0",
        _ => "Todos os arquivos (*.*)\0*.*\0\0",
    };

    let filter_wide: Vec<u16> = filter_str.encode_utf16().collect();
    let dir_wide: Vec<u16> = initial_dir
        .as_os_str()
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut file_buf = vec![0u16; 4096];

    let mut ofn = OPENFILENAMEW {
        lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
        lpstrFilter: PCWSTR(filter_wide.as_ptr()),
        nFilterIndex: 1,
        lpstrFile: PWSTR(file_buf.as_mut_ptr()),
        nMaxFile: file_buf.len() as u32,
        lpstrInitialDir: PCWSTR(dir_wide.as_ptr()),
        Flags: OFN_EXPLORER | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR,
        ..Default::default()
    };

    let ok = unsafe { GetOpenFileNameW(&mut ofn).as_bool() };
    if !ok {
        return None;
    }
    let end = file_buf.iter().position(|&c| c == 0).unwrap_or(file_buf.len());
    if end == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&file_buf[..end]))
}

#[tauri::command]
async fn attachment_pick_file(
    app: tauri::AppHandle,
    user_id: String,
    sub_dir: Option<String>,
    filter_kind: Option<String>,
) -> Result<Option<String>, String> {
    let mut dir = ensure_user_dir(&app, &user_id)?;
    if let Some(sub) = sub_dir {
        dir = dir.join(&sub);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let kind = filter_kind.unwrap_or_default();

    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || open_native_file_dialog(&dir, &kind))
            .await
            .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (dir, kind);
        Ok(None)
    }
}

#[tauri::command]
fn attachment_save_from_bytes(
    app: tauri::AppHandle,
    user_id: String,
    sub_dir: Option<String>,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<AttachmentInfo, String> {
    let mut dir = ensure_user_dir(&app, &user_id)?;
    if let Some(sub) = sub_dir {
        dir = dir.join(&sub);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let stored_name = unique_filename(&dir, &file_name);
    let dest = dir.join(&stored_name);
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;

    let relative_file = if let Some(sub) = dir.strip_prefix(app_root(&app)?.join(&user_id)).ok() {
        sub.join(&stored_name).to_string_lossy().replace("\\", "/")
    } else {
        stored_name.clone()
    };

    Ok(AttachmentInfo {
        file: relative_file,
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
fn attachment_open_folder(
    app: tauri::AppHandle, 
    user_id: String,
    sub_dir: Option<String>,
) -> Result<(), String> {
    let mut dir = ensure_user_dir(&app, &user_id)?;
    if let Some(sub) = sub_dir {
        dir = dir.join(&sub);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    open_path(&dir).map_err(|e| e.to_string())
}

// ------------------------------------------------------------------
// Gravacao de tela em streaming.
//
// O front-end abre uma sessao ANTES de comecar a gravar (o destino fica
// travado na pasta da task escolhida naquele momento), envia os pedacos
// conforme sao produzidos e fecha a sessao no final. Assim nenhum video
// inteiro precisa passar pela memoria/IPC de uma vez, o que travava a
// interface e derrubava gravacoes longas.
// ------------------------------------------------------------------

struct RecordingSession {
    writer: BufWriter<fs::File>,
    path: PathBuf,
    relative_file: String,
    original_name: String,
    bytes: u64,
}

#[derive(Default)]
struct RecordingState(Mutex<HashMap<String, RecordingSession>>);

#[derive(Serialize)]
struct RecordingTarget {
    session_id: String,
    file: String,
    stored_name: String,
}

#[tauri::command]
async fn recording_begin(
    app: tauri::AppHandle,
    state: State<'_, RecordingState>,
    session_id: String,
    user_id: String,
    sub_dir: Option<String>,
    file_name: String,
) -> Result<RecordingTarget, String> {
    let user_dir = ensure_user_dir(&app, &user_id)?;
    let relative_dir = sanitize_sub_dir(sub_dir.as_deref());
    let mut dir = user_dir;
    for segment in &relative_dir {
        dir = dir.join(segment);
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let stored_name = unique_filename(&dir, &file_name);
    let path = dir.join(&stored_name);
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;

    let mut parts = relative_dir;
    parts.push(stored_name.clone());
    let relative_file = parts.join("/");

    let mut sessions = state.0.lock().map_err(|_| "Recording state poisoned".to_string())?;
    sessions.insert(
        session_id.clone(),
        RecordingSession {
            writer: BufWriter::with_capacity(1 << 20, file),
            path,
            relative_file: relative_file.clone(),
            original_name: file_name,
            bytes: 0,
        },
    );

    Ok(RecordingTarget {
        session_id,
        file: relative_file,
        stored_name,
    })
}

#[tauri::command]
async fn recording_append(
    state: State<'_, RecordingState>,
    session_id: String,
    chunk: String,
) -> Result<u64, String> {
    let bytes = decode_base64(&chunk)?;
    let mut sessions = state.0.lock().map_err(|_| "Recording state poisoned".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Sessao de gravacao nao encontrada".to_string())?;
    session.writer.write_all(&bytes).map_err(|e| e.to_string())?;
    session.bytes += bytes.len() as u64;
    Ok(session.bytes)
}

#[tauri::command]
async fn recording_finish(
    state: State<'_, RecordingState>,
    session_id: String,
) -> Result<AttachmentInfo, String> {
    let mut sessions = state.0.lock().map_err(|_| "Recording state poisoned".to_string())?;
    let mut session = sessions
        .remove(&session_id)
        .ok_or_else(|| "Sessao de gravacao nao encontrada".to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    let file = session.writer.into_inner().map_err(|e| e.to_string())?;
    let _ = file.sync_all();
    drop(file);

    let size = fs::metadata(&session.path)
        .map(|m| m.len())
        .unwrap_or(session.bytes);
    if size == 0 {
        let _ = fs::remove_file(&session.path);
        return Err("Gravacao vazia".to_string());
    }

    Ok(AttachmentInfo {
        file: session.relative_file,
        original_name: session.original_name,
        size,
    })
}

#[tauri::command]
async fn recording_abort(
    state: State<'_, RecordingState>,
    session_id: String,
    discard: bool,
) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|_| "Recording state poisoned".to_string())?;
    if let Some(mut session) = sessions.remove(&session_id) {
        let _ = session.writer.flush();
        drop(session.writer);
        if discard {
            let _ = fs::remove_file(&session.path);
        }
    }
    Ok(())
}

fn sanitize_sub_dir(sub_dir: Option<&str>) -> Vec<String> {
    match sub_dir {
        None => Vec::new(),
        Some(raw) => raw
            .split(['/', '\\'])
            .map(str::trim)
            .filter(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
            .map(sanitize_segment)
            .filter(|segment| !segment.is_empty())
            .collect(),
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() / 4 * 3 + 3);
    let mut buffer: u32 = 0;
    let mut bits: u8 = 0;
    for byte in input.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b'\r' | b'\n' | b' ' | b'\t' => continue,
            _ => return Err("Conteudo base64 invalido".to_string()),
        };
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
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
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
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

fn fetch_latest_release_via_web_redirect(
    current_version: &str,
) -> Result<Option<UpdateInfo>, String> {
    let web_url = "https://github.com/RafaelNegrao/TodoApp/releases/latest";
    let resp = default_http_agent().get(web_url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|e| format!("Falha ao consultar GitHub (web): {e}"))?;

    let final_url = resp.get_url().to_string();
    let tag = final_url
        .rsplit("/tag/")
        .next()
        .unwrap_or("")
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim();
    if final_url == web_url || tag.is_empty() {
        return Ok(None);
    }
    let latest = tag.trim_start_matches('v').trim_start_matches('V');
    if latest.is_empty() || compare_versions(latest, current_version) <= 0 {
        return Ok(None);
    }

    let expected_name = format!("TodoApp-{}.exe", latest);
    let download_url = format!(
        "https://github.com/RafaelNegrao/TodoApp/releases/download/{}/{}",
        tag, expected_name
    );

    let size = default_http_agent().head(&download_url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(15))
        .call()
        .ok()
        .and_then(|r| r.header("Content-Length").and_then(|v| v.parse::<u64>().ok()))
        .unwrap_or(0);

    Ok(Some(UpdateInfo {
        current_version: current_version.to_string(),
        latest_version: latest.to_string(),
        download_url,
        asset_name: expected_name,
        size,
    }))
}

fn fetch_latest_release(current_version: &str) -> Result<Option<UpdateInfo>, String> {
    let api_result: Result<Option<UpdateInfo>, String> = (|| {
        let response = default_http_agent().get(GITHUB_API_LATEST)
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
    })();

    match api_result {
        Ok(info) => Ok(info),
        Err(api_err) => fetch_latest_release_via_web_redirect(current_version).map_err(|_| api_err),
    }
}

fn download_to_file(
    url: &str,
    dest: &Path,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    let response = default_http_agent().get(url)
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

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open_url_in_browser(&url).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn open_url_in_browser(url: &str) -> std::io::Result<()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_url_in_browser(url: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url_in_browser(url: &str) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open_path(path: &Path) -> std::io::Result<()> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    Command::new("cmd")
        .args(["/C", "start", "", &path.to_string_lossy()])
        .creation_flags(0x08000000)
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
                    let _ = window.unminimize();
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
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

mod local_media_protocol {
    use super::{app_root, infer_media_mime};
    use std::fs::File;
    use std::io::{Read, Seek, SeekFrom};
    use std::path::{Component, Path, PathBuf};

    const MAX_STREAM_CHUNK_BYTES: u64 = 2 * 1024 * 1024;

    pub fn percent_decode(raw: &str) -> String {
        let bytes = raw.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'%' && i + 2 < bytes.len() {
                if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((hi << 4) | lo);
                    i += 3;
                    continue;
                }
            }
            out.push(bytes[i]);
            i += 1;
        }
        String::from_utf8_lossy(&out).into_owned()
    }

    fn hex_val(b: u8) -> Option<u8> {
        match b {
            b'0'..=b'9' => Some(b - b'0'),
            b'a'..=b'f' => Some(b - b'a' + 10),
            b'A'..=b'F' => Some(b - b'A' + 10),
            _ => None,
        }
    }

    pub fn parse_byte_range(header_val: &str, total_len: u64) -> Option<(u64, u64)> {
        if total_len == 0 {
            return None;
        }
        let spec = header_val.trim().strip_prefix("bytes=")?;
        let first_range = spec.split(',').next()?.trim();
        let (start_str, end_str) = first_range.split_once('-')?;

        let (start, mut end) = if start_str.is_empty() {
            let suffix: u64 = end_str.parse().ok()?;
            if suffix == 0 {
                return None;
            }
            (total_len.saturating_sub(suffix), total_len - 1)
        } else {
            let s: u64 = start_str.parse().ok()?;
            if s >= total_len {
                return None;
            }
            let e = if end_str.is_empty() {
                (s + MAX_STREAM_CHUNK_BYTES - 1).min(total_len - 1)
            } else {
                end_str.parse::<u64>().ok()?.min(total_len - 1)
            };
            (s, e)
        };

        if start > end {
            return None;
        }
        let max_end = (start + MAX_STREAM_CHUNK_BYTES - 1).min(total_len - 1);
        if end > max_end {
            end = max_end;
        }
        Some((start, end))
    }

    fn resolve_safe_path(app: &tauri::AppHandle, request_path: &str) -> Result<PathBuf, String> {
        let decoded = percent_decode(request_path);
        let trimmed = decoded.trim_start_matches('/');
        if trimmed.is_empty() {
            return Err("Empty media path".to_string());
        }

        let rel = Path::new(trimmed);
        let mut safe_rel = PathBuf::new();
        for comp in rel.components() {
            match comp {
                Component::Normal(part) => safe_rel.push(part),
                _ => return Err("Invalid media path".to_string()),
            }
        }

        let root = app_root(app)?;
        let candidate = root.join(safe_rel);
        let canon_root = root.canonicalize().map_err(|e| e.to_string())?;
        let canon_file = candidate.canonicalize().map_err(|e| e.to_string())?;
        if !canon_file.starts_with(&canon_root) || !canon_file.is_file() {
            return Err("Access denied".to_string());
        }
        Ok(canon_file)
    }

    fn error_response(status: u16, body: &str) -> tauri::http::Response<Vec<u8>> {
        tauri::http::Response::builder()
            .status(status)
            .header("Content-Type", "text/plain; charset=utf-8")
            .header("Access-Control-Allow-Origin", "*")
            .body(body.as_bytes().to_vec())
            .unwrap()
    }

    pub fn handle_request(
        app: &tauri::AppHandle,
        request: tauri::http::Request<Vec<u8>>,
    ) -> tauri::http::Response<Vec<u8>> {
        let path = match resolve_safe_path(app, request.uri().path()) {
            Ok(p) => p,
            Err(_) => return error_response(404, "Media not found"),
        };

        let mut file = match File::open(&path) {
            Ok(f) => f,
            Err(_) => return error_response(404, "Media not readable"),
        };
        let total_len = match file.metadata() {
            Ok(m) => m.len(),
            Err(_) => return error_response(500, "Failed to read metadata"),
        };
        let mime = infer_media_mime(&path);

        if request.method() == "HEAD" {
            return tauri::http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Accept-Ranges", "bytes")
                .header("Content-Length", total_len.to_string())
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap();
        }

        if let Some(range_hdr) = request
            .headers()
            .get("range")
            .and_then(|v| v.to_str().ok())
        {
            let Some((start, end)) = parse_byte_range(range_hdr, total_len) else {
                return tauri::http::Response::builder()
                    .status(416)
                    .header("Content-Range", format!("bytes */{total_len}"))
                    .header("Access-Control-Allow-Origin", "*")
                    .body(Vec::new())
                    .unwrap();
            };

            let len = (end - start + 1) as usize;
            let mut buf = vec![0u8; len];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return error_response(500, "Failed to read media range");
            }

            return tauri::http::Response::builder()
                .status(206)
                .header("Content-Type", mime)
                .header("Accept-Ranges", "bytes")
                .header("Content-Range", format!("bytes {start}-{end}/{total_len}"))
                .header("Content-Length", len.to_string())
                .header("Access-Control-Allow-Origin", "*")
                .body(buf)
                .unwrap();
        }

        let mut buf = Vec::with_capacity(total_len.min(MAX_STREAM_CHUNK_BYTES) as usize);
        if file.read_to_end(&mut buf).is_err() {
            return error_response(500, "Failed to read media");
        }

        tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Accept-Ranges", "bytes")
            .header("Content-Length", buf.len().to_string())
            .header("Access-Control-Allow-Origin", "*")
            .body(buf)
            .unwrap()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn percent_decode_handles_spaces_and_utf8() {
            assert_eq!(
                percent_decode("/user1/task1/anexos/Meu%20V%C3%ADdeo.mp4"),
                "/user1/task1/anexos/Meu Vídeo.mp4"
            );
        }

        #[test]
        fn parse_byte_range_caps_large_open_ranges() {
            let total = 50 * 1024 * 1024;
            assert_eq!(
                parse_byte_range("bytes=0-", total),
                Some((0, MAX_STREAM_CHUNK_BYTES - 1))
            );
            assert_eq!(parse_byte_range("bytes=100-199", total), Some((100, 199)));
            assert_eq!(parse_byte_range("bytes=-500", 1000), Some((500, 999)));
            assert_eq!(parse_byte_range("bytes=2000-", 1000), None);
        }

        #[test]
        fn sanitize_attachment_rename_preserves_extension_and_strips_invalid_chars() {
            assert_eq!(
                super::super::sanitize_attachment_rename("Daily 01", "Recording-123.mp4").unwrap(),
                "Daily 01.mp4"
            );
            assert_eq!(
                super::super::sanitize_attachment_rename("aula:1/2*.webm", "old.mp4").unwrap(),
                "aula12.webm"
            );
            assert!(super::super::sanitize_attachment_rename("   ///  ", "old.mp4").is_err());
        }
    }
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() >= 3 && args[1] == "--cleanup-old" {
        cleanup_old_executable(Path::new(&args[2]));
    }

    #[cfg(target_os = "windows")]
    refresh_autostart_path_if_needed();

    tauri::Builder::default()
        .register_uri_scheme_protocol("todomedia", |ctx, request| {
            local_media_protocol::handle_request(ctx.app_handle(), request)
        })
        .setup(|app| {
            let conn = init_db(app.handle()).map_err(|e| {
                eprintln!("Failed to initialize TODOCompanion database: {e}");
                e
            })?;
            app.manage(DbState(Mutex::new(conn)));
            app.manage(RecordingState::default());
            app.manage(AiAudioCaptureState::default());
            app.manage(NativeScreenRecorderState::default());
            app.manage(FloatingTranslatorState::default());

            if let Some(window) = app.get_webview_window("main") {
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
            minimize_window,
            toggle_maximize_window,
            set_translator_floating_mode,
            state_load,
            state_save,
            attachment_save_from_path,
            attachment_save_from_bytes,
            attachment_list_dir,
            attachment_rename,
            attachment_pick_file,
            attachment_delete,
            attachment_open,
            attachment_open_folder,
            recording_begin,
            recording_append,
            recording_finish,
            recording_abort,
            native_screen_recording_start,
            native_screen_recording_stop,
            check_for_update,
            download_and_apply_update,
            get_app_version,
            quit_app,
            get_autostart_enabled,
            set_autostart_enabled,
            open_url,
            hide_window,
            read_file_bytes,
            ai_translate_fast,
            ai_chat_english,
            capture_current_monitor_png,
            transcribe_audio_gemini,
            transcribe_attachment_zoom_summary,
            ai_audio_capture_start,
            ai_audio_capture_flush_and_transcribe,
            ai_audio_capture_stop_and_transcribe,
            ai_live_coach_flush_and_advise,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TODOCompanion");
}

#[cfg(test)]
mod gemini_failover_tests {
    use super::*;

    #[test]
    fn detects_quota_errors_across_status_codes() {
        assert!(is_quota_exhausted_error(429, "anything"));
        assert!(is_quota_exhausted_error(403, "resource_exhausted: quota exceeded"));
        assert!(is_quota_exhausted_error(503, "rate limit reached"));
        assert!(!is_quota_exhausted_error(403, "api key not valid"));
        assert!(!is_quota_exhausted_error(400, "invalid argument"));
    }

    #[test]
    fn assigns_longer_cooldown_for_daily_quota_than_burst() {
        let daily = quota_cooldown_duration("exceeded generaterequestsperdayperprojectpermodel");
        let burst = quota_cooldown_duration("too many requests per minute");
        assert!(daily >= Duration::from_secs(1800));
        assert!(burst >= Duration::from_secs(60));
        assert!(daily > burst);
    }

    #[test]
    fn partitions_cooling_models_out_of_ready_queue() {
        let test_model = "test-quota-cooling-model";
        let ready_model = "test-quota-ready-model";
        mark_model_cooldown(test_model, Duration::from_secs(120));
        let (ready, cooling) = partition_models_by_availability(vec![
            test_model.to_string(),
            ready_model.to_string(),
        ]);
        assert_eq!(ready, vec![ready_model.to_string()]);
        assert_eq!(cooling, vec![test_model.to_string()]);
    }

    #[test]
    fn normalizes_leading_model_and_merges_consecutive_roles() {
        let raw = vec![
            serde_json::json!({ "role": "model", "parts": [{ "text": "stale reply" }] }),
            serde_json::json!({ "role": "user", "parts": [{ "text": "hi" }] }),
            serde_json::json!({ "role": "user", "parts": [{ "text": "still here" }] }),
            serde_json::json!({ "role": "model", "parts": [{ "text": "hello" }] }),
        ];
        let normalized = normalize_gemini_contents(raw);
        assert_eq!(normalized.len(), 2);
        assert_eq!(normalized[0]["role"], "user");
        assert_eq!(normalized[0]["parts"].as_array().unwrap().len(), 2);
        assert_eq!(normalized[1]["role"], "model");
    }

    #[test]
    fn detects_token_limit_errors_separately_from_generic_errors() {
        assert!(is_token_limit_error(429, "resource_exhausted: input tokens per minute exceeded"));
        assert!(is_token_limit_error(400, "request payload size exceeds limit"));
        assert!(is_token_limit_error(413, "payload too large"));
        assert!(!is_token_limit_error(429, "daily requests per project exceeded"));
    }

    #[test]
    fn sanitizes_non_image_inline_data_for_gemma_and_compacts_old_turns() {
        let payload = serde_json::json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        { "inlineData": { "mimeType": "application/pdf", "data": "AAAA" } },
                        { "text": "old msg" }
                    ]
                },
                {
                    "role": "user",
                    "parts": [
                        { "inlineData": { "mimeType": "image/png", "data": "BBBB" } },
                        { "text": "x".repeat(5000) }
                    ]
                }
            ]
        });

        let gemma = sanitize_payload_for_gemma(payload.clone());
        assert!(gemma["contents"][0]["parts"][0]["text"].is_string());
        assert!(gemma["contents"][1]["parts"][0]["inlineData"].is_object());

        let compact = compact_payload_for_token_budget(&payload, 500, true);
        assert!(compact["contents"][0]["parts"][0]["text"].is_string());
        assert!(compact["contents"][1]["parts"][1]["text"].as_str().unwrap().len() < 700);
    }
}
