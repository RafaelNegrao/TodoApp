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
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Main window not found".to_string());
    };

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Floating translator state lock poisoned".to_string())?;

    if floating {
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
        let _ = window.set_min_size(Some(tauri::LogicalSize::new(240.0, 220.0)));
        let _ = window.set_size(tauri::LogicalSize::new(340.0, 320.0));
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

fn gemini_http_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(6))
            .timeout(Duration::from_secs(45))
            .build()
    })
}

fn gemini_translate_agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(3))
            .timeout(Duration::from_secs(5))
            .build()
    })
}

const GEMINI_MODEL_CASCADE: &[&str] = &[
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-3.8-flash",
];

fn model_prefers_minimal_thinking(model: &str) -> bool {
    matches!(model, "gemini-3-flash-preview" | "gemini-3.6-flash")
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

fn order_models_by_availability(candidates: Vec<String>) -> Vec<String> {
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
        return candidates;
    }

    // Os modelos em cooldown vao para o final da fila (ordenados pelo que libera mais cedo),
    // garantindo que o sistema desca imediatamente para um modelo disponivel sem repetir 429,
    // mas ainda tenha fallback caso todos estejam em cooldown.
    cooling.sort_by_key(|(_, until)| *until);
    for (m, _) in cooling {
        ready.push(m);
    }
    ready
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
        .unwrap_or_else(|| "gemini-3-flash-preview".to_string());

    let mut models = Vec::new();
    if !env_model.trim().is_empty() {
        models.push(env_model.trim().to_string());
    }
    for &fb in GEMINI_MODEL_CASCADE {
        if !models.iter().any(|m| m == fb) {
            models.push(fb.to_string());
        }
    }

    Ok((key, order_models_by_availability(models)))
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

    let ordered = order_models_by_availability(models.to_vec());

    for model in &ordered {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, key
        );

        let candidates = if model.starts_with("gemma-") {
            vec![&payload_compat]
        } else if model_prefers_minimal_thinking(model) {
            vec![&payload_fast_think, &payload, &payload_compat]
        } else {
            vec![&payload, &payload_compat]
        };

        for candidate_payload in candidates {
            match agent
                .post(&url)
                .set("Content-Type", "application/json")
                .send_json(candidate_payload.clone())
            {
                Ok(resp) => {
                    let body: serde_json::Value = resp
                        .into_json()
                        .map_err(|e| format!("Resposta invalida do Gemini: {e}"))?;
                    let mut text_parts: Vec<String> = Vec::new();
                    if let Some(parts) = body["candidates"][0]["content"]["parts"].as_array() {
                        for p in parts {
                            if p.get("thought").and_then(|v| v.as_bool()).unwrap_or(false) {
                                continue;
                            }
                            if let Some(t) = p["text"].as_str() {
                                let trimmed = t.trim();
                                if !trimmed.is_empty() {
                                    text_parts.push(trimmed.to_string());
                                }
                            }
                        }
                    }
                    if !text_parts.is_empty() {
                        return Ok(text_parts.join("\n"));
                    }
                }
                Err(ureq::Error::Status(code, resp)) => {
                    let err_body = resp.into_string().unwrap_or_default();
                    last_err = format!("Gemini HTTP {code} ({model}): {err_body}");
                    if code == 429 {
                        // Cota do modelo excedida: coloca esse modelo em cooldown por 30s
                        // e desce imediatamente para o proximo modelo da lista!
                        mark_model_cooldown(model, Duration::from_secs(30));
                        break;
                    }
                    if code == 503 || code == 502 || code == 500 || code == 504 {
                        mark_model_cooldown(model, Duration::from_secs(45));
                        break;
                    }
                    if code == 404 {
                        mark_model_cooldown(model, Duration::from_secs(600));
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
                    mark_model_cooldown(model, Duration::from_secs(15));
                    break;
                }
            }
        }
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

#[tauri::command]
async fn ai_chat_english(
    messages: Vec<AiChatMessage>,
    formality: u8,
    api_key: Option<String>,
    app_context: Option<String>,
) -> Result<String, String> {
    if messages.is_empty() {
        return Ok(String::new());
    }

    let (key, models) = resolve_gemini_key_and_models(api_key)?;
    let _ = formality;
    let ctx_json = app_context.unwrap_or_else(|| "{}".to_string());

    tauri::async_runtime::spawn_blocking(move || {
        let system_prompt = format!(
            "You are the integrated AI Agent of TODOCompanion with full visibility and control over the entire application.\n\
             You can hold natural multi-turn conversations, ask clarifying questions, suggest improvements, analyze attached images/PDFs/audio/files, summarize tasks/cards across the entire app, AND propose actions to control the app (users, tasks, cards, checklists, tables, connections, canvas layout, clipboard copy, navigation, and settings).\n\
             Always reply in the same language the user writes in.\n\n\
             INTERACTIVE QUESTIONS & CLARIFICATION RULE:\n\
             - NEVER ask a plain-text 'Você tem certeza?' / 'Are you sure?' when the user's request is already clear (including destructive requests like deleting tasks/cards/users). Instead, go straight to [[APP_ACTIONS]] — the UI already shows an interactive confirmation card with 'Permitir e executar' and 'Recusar' buttons.\n\
             - Whenever you DO need to ask the user a question (ambiguous request, multiple matching tasks/cards/users, choosing between options like copy vs. move, selecting which tasks/cards to act on, choosing status/priority, or follow-up choices), you MUST include ONE interactive question block at the end of your reply using EXACTLY these tags and valid JSON (and omit [[APP_ACTIONS]] until the user answers):\n\
             [[APP_QUESTIONS]]\n\
             {{\"questions\":[{{\"id\":\"q1\",\"prompt\":\"Question text\",\"multiSelect\":false,\"allowCustom\":true,\"options\":[{{\"label\":\"Option A\",\"value\":\"Option A\",\"description\":\"Short detail\"}},{{\"label\":\"Option B\",\"value\":\"Option B\"}}]}}]}}\n\
             [[/APP_QUESTIONS]]\n\
             - Set \"multiSelect\":true whenever the user can pick more than one option (e.g., selecting multiple tasks or cards). Keep option labels short and clickable.\n\n\
             CRITICAL PERMISSION RULE:\n\
             Once the user's intent is clear and they want you to CREATE, EDIT, DELETE, DUPLICATE, MOVE, CONNECT, SHOW/OPEN, COPY, ORGANIZE, or CHANGE SETTINGS in the app, you MUST ask for permission by including ONE structured action block at the end of your reply using EXACTLY these tags and valid JSON:\n\
             [[APP_ACTIONS]]\n\
             {{\"summary\":\"Short description of what will be executed\",\"actions\":[...]}}\n\
             [[/APP_ACTIONS]]\n\
             Never pretend you already executed an action — always explain briefly what you are proposing and include the [[APP_ACTIONS]] block so the user can click 'Permitir'.\n\
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
             - {{\"type\":\"create_card\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"userName\":\"...\",\"body\":\"...\",\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2,\"parentCardId\":\"...|$LAST_CARD\",\"tableRows\":[[\"A\",\"B\"],[\"1\",\"2\"]]}}\n\
             - {{\"type\":\"update_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"body\":\"...\",\"appendBody\":\"...\",\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2}}\n\
             - {{\"type\":\"delete_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"duplicate_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"copy_card_to_task\",\"sourceCardId\":\"...\",\"sourceTaskId\":\"...\",\"sourceTaskTitle\":\"...\",\"targetTaskId\":\"...\",\"targetTaskTitle\":\"...\",\"targetUserName\":\"...\"}}\n\
             - {{\"type\":\"move_card_to_task\",\"sourceCardId\":\"...\",\"sourceTaskId\":\"...\",\"sourceTaskTitle\":\"...\",\"targetTaskId\":\"...\",\"targetTaskTitle\":\"...\",\"targetUserName\":\"...\"}}\n\
             - {{\"type\":\"focus_card\",\"cardId\":\"...|$LAST_CARD\",\"taskId\":\"...\",\"taskTitle\":\"...\"}}\n\
             - {{\"type\":\"connect_cards\",\"taskId\":\"...\",\"taskTitle\":\"...\",\"fromCardId\":\"...|$LAST_CARD\",\"toCardId\":\"...|$LAST_CARD\"}}\n\
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

        let contents: Vec<serde_json::Value> = messages
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
                            parts.push(serde_json::json!({
                                "inlineData": {
                                    "mimeType": clean_mime,
                                    "data": clean_b64
                                }
                            }));
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
            .collect();

        let payload = serde_json::json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": contents,
            "generationConfig": {
                "temperature": 0.4
            }
        });

        execute_gemini_fast_payload(&key, &models, payload, false)
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
    const AUDIO_CHANNELS: u32 = 1;
    const AUDIO_BITS_PER_SAMPLE: u32 = 16;
    const AUDIO_AVG_BYTES_PER_SEC: u32 = 8_000; // 64 kbps AAC mono (~0.48 MB/min)
    const HNS_PER_SEC: i64 = 10_000_000;
    // Buffer circular maximo de 1 segundo por canal (evita crescimento de RAM em gravacoes longas)
    const MAX_RING_SAMPLES: usize = AUDIO_SAMPLE_RATE as usize;

    fn pack_u32_pair(hi: u32, lo: u32) -> u64 {
        ((hi as u64) << 32) | (lo as u64)
    }

    fn push_resampled_48k(dest: &Arc<Mutex<VecDeque<f32>>>, mono_chunk: &[f32], in_rate: u32) {
        if mono_chunk.is_empty() || in_rate == 0 {
            return;
        }
        let Ok(mut buf) = dest.lock() else {
            return;
        };

        if in_rate == AUDIO_SAMPLE_RATE {
            for &s in mono_chunk {
                if buf.len() >= MAX_RING_SAMPLES {
                    buf.pop_front();
                }
                buf.push_back(s);
            }
            return;
        }

        let ratio = AUDIO_SAMPLE_RATE as f64 / in_rate as f64;
        let out_len = ((mono_chunk.len() as f64) * ratio).max(1.0).round() as usize;
        for i in 0..out_len {
            let src_pos = (i as f64) / ratio;
            let idx = src_pos.floor() as usize;
            let frac = (src_pos - (idx as f64)) as f32;
            let s0 = mono_chunk.get(idx).copied().unwrap_or(0.0);
            let s1 = mono_chunk.get(idx + 1).copied().unwrap_or(s0);
            if buf.len() >= MAX_RING_SAMPLES {
                buf.pop_front();
            }
            buf.push_back(s0 + (s1 - s0) * frac);
        }
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
                let mut scratch = Vec::<f32>::with_capacity(2048);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[f32], _| {
                            if channels == 0 {
                                return;
                            }
                            scratch.clear();
                            scratch.extend(
                                data.chunks(channels)
                                    .map(|f| f.iter().copied().sum::<f32>() / (f.len() as f32)),
                            );
                            push_resampled_48k(&dest, &scratch, in_rate);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::I16 => {
                let mut scratch = Vec::<f32>::with_capacity(2048);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[i16], _| {
                            if channels == 0 {
                                return;
                            }
                            scratch.clear();
                            scratch.extend(data.chunks(channels).map(|f| {
                                let sum: f32 = f.iter().map(|&s| (s as f32) / 32768.0).sum();
                                sum / (f.len() as f32)
                            }));
                            push_resampled_48k(&dest, &scratch, in_rate);
                        },
                        err_fn,
                        None,
                    )
                    .ok()
            }
            cpal::SampleFormat::U16 => {
                let mut scratch = Vec::<f32>::with_capacity(2048);
                device
                    .build_input_stream(
                        &stream_config,
                        move |data: &[u16], _| {
                            if channels == 0 {
                                return;
                            }
                            scratch.clear();
                            scratch.extend(data.chunks(channels).map(|f| {
                                let sum: f32 =
                                    f.iter().map(|&s| ((s as f32) - 32768.0) / 32768.0).sum();
                                sum / (f.len() as f32)
                            }));
                            push_resampled_48k(&dest, &scratch, in_rate);
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

        let mic_buf = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
        let sys_buf = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
        let host = cpal::default_host();

        let _mic_stream = host.default_input_device().and_then(|dev| {
            let cfg = dev.default_input_config().ok()?;
            let s = build_48k_stream(&dev, &cfg, Arc::clone(&mic_buf))?;
            s.play().ok()?;
            Some(s)
        });

        let _sys_stream = host.default_output_device().and_then(|dev| {
            let cfg = dev.default_output_config().ok()?;
            let s = build_48k_stream(&dev, &cfg, Arc::clone(&sys_buf))?;
            s.play().ok()?;
            Some(s)
        });

        let _ = ready_tx.send(Ok(()));

        let start_instant = Instant::now();
        let tick_interval = Duration::from_millis(50);
        let mut prev_wall_hns: i64 = 0;
        let mut media_cursor_hns: i64 = 0;
        let mut pcm_bytes = Vec::<u8>::with_capacity((AUDIO_SAMPLE_RATE as usize / 2) * 2);

        while running.load(Ordering::Relaxed) {
            let loop_tick = Instant::now();
            let now_wall_hns = (start_instant.elapsed().as_secs_f64() * (HNS_PER_SEC as f64)) as i64;
            let raw_delta_hns = (now_wall_hns - prev_wall_hns).max(HNS_PER_SEC / 40);
            prev_wall_hns = now_wall_hns;

            let step_hns_approx = raw_delta_hns.clamp(HNS_PER_SEC / 25, HNS_PER_SEC / 3);
            let step_samples = (((step_hns_approx as i128) * (AUDIO_SAMPLE_RATE as i128))
                / (HNS_PER_SEC as i128))
                .max(480) as usize;
            let exact_step_hns =
                ((step_samples as i64) * HNS_PER_SEC) / (AUDIO_SAMPLE_RATE as i64);

            pcm_bytes.clear();
            let mut mb_guard = mic_buf.lock().ok();
            let mut sb_guard = sys_buf.lock().ok();

            for _ in 0..step_samples {
                let m_raw = mb_guard.as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                let s_raw = sb_guard.as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                let m = (m_raw * 1.6).clamp(-1.0, 1.0);
                let s = s_raw.clamp(-1.0, 1.0);
                let mixed = if m.abs() > 0.001 && s.abs() > 0.001 {
                    (m + s) * 0.75
                } else {
                    m + s
                };
                let sample_i16 = (mixed.clamp(-1.0, 1.0) * 32767.0) as i16;
                pcm_bytes.extend_from_slice(&sample_i16.to_le_bytes());
            }

            drop(mb_guard);
            drop(sb_guard);

            let _ = write_mf_sample(
                &writer,
                audio_stream,
                &pcm_bytes,
                media_cursor_hns,
                exact_step_hns,
            );

            media_cursor_hns += exact_step_hns;

            let spent = loop_tick.elapsed();
            if spent < tick_interval {
                thread::sleep(tick_interval - spent);
            }
        }

        drop(_mic_stream);
        drop(_sys_stream);

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
        let mic_buf = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
        let sys_buf = Arc::new(Mutex::new(VecDeque::<f32>::with_capacity(MAX_RING_SAMPLES)));
        let host = cpal::default_host();

        let _mic_stream = host.default_input_device().and_then(|dev| {
            let cfg = dev.default_input_config().ok()?;
            let s = build_48k_stream(&dev, &cfg, Arc::clone(&mic_buf))?;
            s.play().ok()?;
            Some(s)
        });

        let _sys_stream = host.default_output_device().and_then(|dev| {
            let cfg = dev.default_output_config().ok()?;
            let s = build_48k_stream(&dev, &cfg, Arc::clone(&sys_buf))?;
            s.play().ok()?;
            Some(s)
        });

        // Sinaliza que a gravacao comecou com sucesso!
        let _ = ready_tx.send(Ok(()));

        let start_instant = Instant::now();
        let frame_interval = Duration::from_micros(1_000_000 / (VIDEO_FPS as u64));
        let frame_byte_len = (out_w * out_h * 4) as usize;

        // Linha do tempo unica e estritamente sincrona entre Audio e Video:
        // Garante que o muxer MP4 (FMPEG4Sink) descarregue os pacotes no disco a cada frame
        // sem acumular filas de interleaving na RAM durante gravacoes longas (1h+).
        let mut prev_wall_hns: i64 = 0;
        let mut media_cursor_hns: i64 = 0;
        let mut pcm_bytes = Vec::<u8>::with_capacity((AUDIO_SAMPLE_RATE as usize / 2) * 2);

        while running.load(Ordering::Relaxed) {
            let loop_tick = Instant::now();
            let now_wall_hns = (start_instant.elapsed().as_secs_f64() * (HNS_PER_SEC as f64)) as i64;
            let raw_delta_hns = (now_wall_hns - prev_wall_hns).max(HNS_PER_SEC / 60);
            prev_wall_hns = now_wall_hns;

            // Limita saltos individuais a no maximo 350ms caso a CPU tenha congelado momentaneamente,
            // evitando pacotes gigantes ou buracos que corrompem o Finalize() do MP4
            let step_hns_approx = raw_delta_hns.clamp(HNS_PER_SEC / 30, HNS_PER_SEC / 3);
            let step_samples = (((step_hns_approx as i128) * (AUDIO_SAMPLE_RATE as i128))
                / (HNS_PER_SEC as i128))
                .max(480) as usize;
            let exact_step_hns =
                ((step_samples as i64) * HNS_PER_SEC) / (AUDIO_SAMPLE_RATE as i64);

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
                media_cursor_hns,
                exact_step_hns,
            );

            // 2. Mixa o audio (Microfone + Audio do PC) no mesmo timestamp e duracao exata do frame de video
            if let Some(a_stream) = audio_stream {
                pcm_bytes.clear();
                let mut mb_guard = mic_buf.lock().ok();
                let mut sb_guard = sys_buf.lock().ok();

                for _ in 0..step_samples {
                    let m_raw = mb_guard.as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                    let s_raw = sb_guard.as_mut().and_then(|q| q.pop_front()).unwrap_or(0.0);
                    let m = (m_raw * 1.6).clamp(-1.0, 1.0);
                    let s = s_raw.clamp(-1.0, 1.0);
                    let mixed = if m.abs() > 0.001 && s.abs() > 0.001 {
                        (m + s) * 0.75
                    } else {
                        m + s
                    };
                    let sample_i16 = (mixed.clamp(-1.0, 1.0) * 32767.0) as i16;
                    pcm_bytes.extend_from_slice(&sample_i16.to_le_bytes());
                }

                drop(mb_guard);
                drop(sb_guard);

                let _ = write_mf_sample(
                    &writer,
                    a_stream,
                    &pcm_bytes,
                    media_cursor_hns,
                    exact_step_hns,
                );
            }

            media_cursor_hns += exact_step_hns;

            let spent = loop_tick.elapsed();
            if spent < frame_interval {
                thread::sleep(frame_interval - spent);
            }
        }

        // Para os streams de audio antes do Finalize para liberar a CPU imediatamente
        drop(_mic_stream);
        drop(_sys_stream);

        if let Err(e) = writer.Finalize() {
            eprintln!("[screen-rec] writer.Finalize warning/error: {e}");
        }

        SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        Ok(())
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

#[tauri::command]
async fn ai_audio_capture_flush_and_transcribe(
    state: State<'_, AiAudioCaptureState>,
    stop: bool,
    fallback_mime_type: Option<String>,
    fallback_audio_base64: Option<String>,
) -> Result<String, String> {
    let (mic_vec, sys_vec) = {
        let mut guard = state.0.lock().map_err(|_| "Audio capture lock poisoned".to_string())?;
        if stop {
            if let Some(mut active) = guard.take() {
                active.running.store(false, Ordering::Relaxed);
                if let Some(handle) = active.join_handle.take() {
                    let _ = handle.join();
                }
                let m = active.mic_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
                let s = active.sys_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
                (m, s)
            } else {
                (Vec::new(), Vec::new())
            }
        } else if let Some(active) = guard.as_ref() {
            let m = active.mic_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
            let s = active.sys_samples.lock().map(|mut v| std::mem::take(&mut *v)).unwrap_or_default();
            if let Ok(mut clock) = active.chunk_start.lock() {
                *clock = Instant::now();
            }
            (m, s)
        } else {
            (Vec::new(), Vec::new())
        }
    };

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
        let mut models: Vec<String> = Vec::new();
        if !env_model.trim().is_empty() {
            models.push(env_model.trim().to_string());
        }
        for &fallback in GEMINI_MODEL_CASCADE {
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
                match ureq::post(&url)
                    .set("Content-Type", "application/json")
                    .timeout(Duration::from_secs(120))
                    .send_json(payload.clone())
                {
                    Ok(resp) => {
                        let body: serde_json::Value = resp
                            .into_json()
                            .map_err(|e| format!("Resposta invalida do Gemini: {e}"))?;
                        let mut text_parts: Vec<String> = Vec::new();
                        if let Some(parts) = body["candidates"][0]["content"]["parts"].as_array() {
                            for p in parts {
                                if let Some(t) = p["text"].as_str() {
                                    let trimmed = t.trim();
                                    if !trimmed.is_empty() {
                                        text_parts.push(trimmed.to_string());
                                    }
                                }
                            }
                        }
                        return Ok(text_parts.join("\n"));
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
    let stored_name = unique_filename(&dir, &original_name);
    let dest = dir.join(&stored_name);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    
    // The relative path from the user's directory
    let relative_file = if let Some(sub) = dir.strip_prefix(app_root(&app)?.join(&user_id)).ok() {
        sub.join(&stored_name).to_string_lossy().replace("\\", "/")
    } else {
        stored_name.clone()
    };

    let size = fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(AttachmentInfo {
        file: relative_file,
        original_name,
        size,
    })
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
            transcribe_audio_gemini,
            ai_audio_capture_start,
            ai_audio_capture_flush_and_transcribe,
            ai_audio_capture_stop_and_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TODOCompanion");
}
