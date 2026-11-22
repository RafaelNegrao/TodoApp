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
        for fallback in [
            "gemini-3.5-flash-lite",
            "gemini-3.8-flash",
            "gemini-3.1-flash-lite-preview",
        ] {
            if !models.iter().any(|m| m == fallback) {
                models.push(fallback.to_string());
            }
        }

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
            check_for_update,
            download_and_apply_update,
            get_app_version,
            quit_app,
            get_autostart_enabled,
            set_autostart_enabled,
            open_url,
            hide_window,
            read_file_bytes,
            transcribe_audio_gemini,
            ai_audio_capture_start,
            ai_audio_capture_flush_and_transcribe,
            ai_audio_capture_stop_and_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TODOCompanion");
}
