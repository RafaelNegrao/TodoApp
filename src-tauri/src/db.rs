use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
pub struct ProjectMemoryRecord {
    pub id: String,
    pub scope_key: String,
    pub kind: String,
    pub content: String,
    pub source: String,
    pub updated_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AiActivityRecord {
    pub id: i64,
    pub created_at: i64,
    pub kind: String,
    pub model: String,
    pub status: String,
    pub summary: String,
    pub detail: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ChatSearchHit {
    pub session_id: String,
    pub session_title: String,
    pub role: String,
    pub snippet: String,
    pub updated_at: String,
}

pub fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;

         CREATE TABLE IF NOT EXISTS state (
             id INTEGER PRIMARY KEY CHECK (id = 1),
             json TEXT NOT NULL,
             updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
         );

         CREATE TABLE IF NOT EXISTS app_settings (
             key TEXT PRIMARY KEY,
             value TEXT NOT NULL,
             updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
         );

         CREATE TABLE IF NOT EXISTS chat_sessions (
             id TEXT PRIMARY KEY,
             title TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             json TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS project_memory (
             id TEXT PRIMARY KEY,
             scope_key TEXT NOT NULL,
             kind TEXT NOT NULL DEFAULT 'fact',
             content TEXT NOT NULL,
             source TEXT NOT NULL DEFAULT 'ai',
             updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
         );
         CREATE INDEX IF NOT EXISTS idx_project_memory_scope ON project_memory(scope_key);

         CREATE TABLE IF NOT EXISTS ai_activity_log (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
             kind TEXT NOT NULL,
             model TEXT NOT NULL DEFAULT '',
             status TEXT NOT NULL,
             summary TEXT NOT NULL,
             detail TEXT NOT NULL DEFAULT '',
             prompt_tokens INTEGER NOT NULL DEFAULT 0,
             completion_tokens INTEGER NOT NULL DEFAULT 0,
             total_tokens INTEGER NOT NULL DEFAULT 0
         );
         CREATE INDEX IF NOT EXISTS idx_ai_activity_created ON ai_activity_log(created_at DESC);

         CREATE TABLE IF NOT EXISTS search_documents (
             doc_id TEXT PRIMARY KEY,
             kind TEXT NOT NULL,
             user_id TEXT NOT NULL DEFAULT '',
             task_id TEXT NOT NULL DEFAULT '',
             node_id TEXT NOT NULL DEFAULT '',
             title TEXT NOT NULL,
             body TEXT NOT NULL,
             content_hash TEXT NOT NULL,
             updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
         );

         CREATE TABLE IF NOT EXISTS automations (
             id TEXT PRIMARY KEY,
             name TEXT NOT NULL,
             enabled INTEGER NOT NULL DEFAULT 1,
             trigger_type TEXT NOT NULL,
             condition_json TEXT NOT NULL DEFAULT '{}',
             action_json TEXT NOT NULL DEFAULT '[]',
             last_run_at INTEGER,
             created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
         );

         CREATE TABLE IF NOT EXISTS automation_runs (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             automation_id TEXT NOT NULL,
             ran_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
             status TEXT NOT NULL,
             message TEXT NOT NULL DEFAULT ''
         );",
    )
    .map_err(|e| format!("Falha ao executar migracoes SQLite: {e}"))?;
    Ok(())
}

pub fn get_all_settings(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for row in rows {
        let (k, v) = row.map_err(|e| e.to_string())?;
        map.insert(k, v);
    }
    Ok(map)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, strftime('%s', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_chat_sessions_json(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT json FROM chat_sessions ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for row in rows {
        list.push(row.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

pub fn save_chat_sessions_json(conn: &mut Connection, sessions_json: &str) -> Result<(), String> {
    let parsed: Vec<serde_json::Value> =
        serde_json::from_str(sessions_json).map_err(|e| format!("JSON invalido de sessoes: {e}"))?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM chat_sessions", [])
        .map_err(|e| e.to_string())?;

    for item in parsed {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if id.is_empty() {
            continue;
        }
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("New Chat");
        let updated_at = item
            .get("updatedAt")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let serialized = serde_json::to_string(&item).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO chat_sessions (id, title, updated_at, json) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, updated_at, serialized],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn search_past_chat_messages(
    conn: &Connection,
    query: &str,
    exclude_session_id: Option<&str>,
    limit: usize,
) -> Result<Vec<ChatSearchHit>, String> {
    let terms: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.chars().count() >= 3)
        .map(|w| w.to_string())
        .collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    let sessions = load_chat_sessions_json(conn)?;
    let mut scored: Vec<(usize, ChatSearchHit)> = Vec::new();

    for raw in sessions {
        let Ok(session) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let sid = session["id"].as_str().unwrap_or("").to_string();
        if exclude_session_id.is_some_and(|ex| ex == sid) {
            continue;
        }
        let title = session["title"].as_str().unwrap_or("Chat").to_string();
        let updated_at = session["updatedAt"].as_str().unwrap_or("").to_string();
        let Some(messages) = session["messages"].as_array() else {
            continue;
        };
        for msg in messages {
            let text = msg["text"].as_str().unwrap_or("").trim();
            if text.len() < 12 || text.starts_with("Error:") {
                continue;
            }
            let lower = text.to_lowercase();
            let hits = terms.iter().filter(|t| lower.contains(t.as_str())).count();
            if hits == 0 {
                continue;
            }
            let role = msg["role"].as_str().unwrap_or("user").to_string();
            let snippet: String = text.chars().take(260).collect();
            scored.push((
                hits,
                ChatSearchHit {
                    session_id: sid.clone(),
                    session_title: title.clone(),
                    role,
                    snippet,
                    updated_at: updated_at.clone(),
                },
            ));
        }
    }

    scored.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.updated_at.cmp(&a.1.updated_at)));
    Ok(scored
        .into_iter()
        .take(limit.clamp(1, 20))
        .map(|(_, hit)| hit)
        .collect())
}

pub fn list_project_memories(
    conn: &Connection,
    scope_key: Option<&str>,
) -> Result<Vec<ProjectMemoryRecord>, String> {
    let mut records = Vec::new();
    if let Some(scope) = scope_key.filter(|s| !s.trim().is_empty()) {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope_key, kind, content, source, updated_at
                 FROM project_memory
                 WHERE scope_key = ?1 OR scope_key = 'global'
                 ORDER BY updated_at DESC
                 LIMIT 40",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![scope], map_memory_row)
            .map_err(|e| e.to_string())?;
        for r in rows {
            records.push(r.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, scope_key, kind, content, source, updated_at
                 FROM project_memory
                 ORDER BY updated_at DESC
                 LIMIT 80",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], map_memory_row)
            .map_err(|e| e.to_string())?;
        for r in rows {
            records.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(records)
}

fn map_memory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProjectMemoryRecord> {
    Ok(ProjectMemoryRecord {
        id: row.get(0)?,
        scope_key: row.get(1)?,
        kind: row.get(2)?,
        content: row.get(3)?,
        source: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn upsert_project_memory(
    conn: &Connection,
    id: &str,
    scope_key: &str,
    kind: &str,
    content: &str,
    source: &str,
) -> Result<(), String> {
    let clean_content = content.trim();
    if clean_content.is_empty() {
        return Err("Conteudo de memoria vazio".to_string());
    }
    conn.execute(
        "INSERT INTO project_memory (id, scope_key, kind, content, source, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s', 'now'))
         ON CONFLICT(id) DO UPDATE SET
           scope_key = excluded.scope_key,
           kind = excluded.kind,
           content = excluded.content,
           source = excluded.source,
           updated_at = excluded.updated_at",
        params![id, scope_key, kind, clean_content, source],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_project_memory(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM project_memory WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn log_ai_activity(
    conn: &Connection,
    kind: &str,
    model: &str,
    status: &str,
    summary: &str,
    detail: &str,
    prompt_tokens: i64,
    completion_tokens: i64,
    total_tokens: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO ai_activity_log
         (kind, model, status, summary, detail, prompt_tokens, completion_tokens, total_tokens)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            kind,
            model,
            status,
            summary,
            detail,
            prompt_tokens,
            completion_tokens,
            total_tokens
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_ai_activity(conn: &Connection, limit: usize) -> Result<Vec<AiActivityRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, created_at, kind, model, status, summary, detail,
                    prompt_tokens, completion_tokens, total_tokens
             FROM ai_activity_log
             ORDER BY id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit.clamp(1, 200) as i64], |row| {
            Ok(AiActivityRecord {
                id: row.get(0)?,
                created_at: row.get(1)?,
                kind: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                summary: row.get(5)?,
                detail: row.get(6)?,
                prompt_tokens: row.get(7)?,
                completion_tokens: row.get(8)?,
                total_tokens: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut list = Vec::new();
    for r in rows {
        list.push(r.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_mem_db() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory sqlite");
        run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn test_settings_roundtrip() {
        let conn = setup_mem_db();
        set_setting(&conn, "theme", "light-claude").unwrap();
        set_setting(&conn, "theme", "claude-dark").unwrap();
        let all = get_all_settings(&conn).unwrap();
        assert_eq!(all.get("theme").map(String::as_str), Some("claude-dark"));
    }

    #[test]
    fn test_chat_sessions_and_past_search() {
        let mut conn = setup_mem_db();
        let payload = serde_json::json!([
            {
                "id": "chat-1",
                "title": "Arquitetura API",
                "updatedAt": "2026-11-26T10:00:00Z",
                "messages": [
                    { "role": "user", "text": "Definimos usar PostgreSQL com pool de conexoes" },
                    { "role": "model", "text": "Excelente escolha para consistencia transacional." }
                ]
            },
            {
                "id": "chat-2",
                "title": "Atual",
                "updatedAt": "2026-11-27T10:00:00Z",
                "messages": [
                    { "role": "user", "text": "Qual banco escolhemos?" }
                ]
            }
        ])
        .to_string();

        save_chat_sessions_json(&mut conn, &payload).unwrap();
        let loaded = load_chat_sessions_json(&conn).unwrap();
        assert_eq!(loaded.len(), 2);

        let hits = search_past_chat_messages(&conn, "banco PostgreSQL conexoes", Some("chat-2"), 5).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].session_id, "chat-1");
    }

    #[test]
    fn test_project_memory_crud() {
        let conn = setup_mem_db();
        upsert_project_memory(&conn, "mem-1", "task-42", "decision", "Prazo final 10/12", "user").unwrap();
        upsert_project_memory(&conn, "mem-2", "global", "preference", "Responder em portugues", "ai").unwrap();

        let scoped = list_project_memories(&conn, Some("task-42")).unwrap();
        assert_eq!(scoped.len(), 2);

        delete_project_memory(&conn, "mem-1").unwrap();
        let after = list_project_memories(&conn, Some("task-42")).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].id, "mem-2");
    }

    #[test]
    fn test_ai_activity_log() {
        let conn = setup_mem_db();
        log_ai_activity(
            &conn,
            "chat",
            "gemini-2.5-flash",
            "ok",
            "Respondeu pergunta",
            "",
            120,
            45,
            165,
        )
        .unwrap();
        let logs = list_ai_activity(&conn, 10).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].total_tokens, 165);
    }
}
