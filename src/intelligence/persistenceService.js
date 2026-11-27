export class PersistenceService {
  constructor(invokeFn = null) {
    this.invoke = invokeFn;
    this.saveSessionsTimer = 0;
  }

  hasBackend() {
    return typeof this.invoke === "function";
  }

  async hydrateSettingsFromDb(settingKeys = []) {
    if (!this.hasBackend() || !Array.isArray(settingKeys) || !settingKeys.length) {
      return {};
    }
    try {
      const dbMap = (await this.invoke("db_settings_get_all")) || {};
      const result = { ...dbMap };
      for (const key of settingKeys) {
        if (dbMap[key] !== undefined) {
          try {
            localStorage.setItem(key, String(dbMap[key]));
          } catch (_) {}
        } else {
          const legacy = localStorage.getItem(key);
          if (legacy !== null) {
            result[key] = legacy;
            this.invoke("db_setting_set", { key, value: String(legacy) }).catch(() => {});
          }
        }
      }
      return result;
    } catch (err) {
      console.warn("[persistence] hydrateSettingsFromDb failed", err);
      return {};
    }
  }

  saveSetting(key, value) {
    const strVal = String(value ?? "");
    try {
      localStorage.setItem(key, strVal);
    } catch (_) {}
    if (this.hasBackend()) {
      this.invoke("db_setting_set", { key, value: strVal }).catch(err => {
        console.warn(`[persistence] db_setting_set(${key}) failed`, err);
      });
    }
  }

  async loadChatSessions(legacyStorageKey = "") {
    if (this.hasBackend()) {
      try {
        const rows = await this.invoke("db_chat_sessions_load");
        if (Array.isArray(rows) && rows.length > 0) {
          const parsed = rows
            .map(raw => {
              try {
                return JSON.parse(raw);
              } catch (_) {
                return null;
              }
            })
            .filter(s => s && typeof s.id === "string" && Array.isArray(s.messages));
          if (parsed.length > 0) {
            return parsed;
          }
        }
      } catch (err) {
        console.warn("[persistence] db_chat_sessions_load failed", err);
      }
    }

    // Migracao unica a partir do localStorage legado
    if (legacyStorageKey) {
      try {
        const raw = localStorage.getItem(legacyStorageKey);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(s => s && typeof s.id === "string" && Array.isArray(s.messages));
          if (valid.length > 0 && this.hasBackend()) {
            this.saveChatSessionsNow(valid, legacyStorageKey).catch(() => {});
          }
          return valid;
        }
      } catch (_) {}
    }
    return [];
  }

  saveChatSessions(sessions, legacyStorageKey = "") {
    const safeList = Array.isArray(sessions) ? sessions.slice(0, 60) : [];
    const serialized = JSON.stringify(safeList);
    if (!this.hasBackend()) {
      if (legacyStorageKey) {
        try {
          localStorage.setItem(legacyStorageKey, serialized);
        } catch (_) {}
      }
      return;
    }

    if (this.saveSessionsTimer) {
      clearTimeout(this.saveSessionsTimer);
    }
    this.saveSessionsTimer = setTimeout(() => {
      this.saveSessionsTimer = 0;
      this.invoke("db_chat_sessions_save", { sessionsJson: serialized }).catch(err => {
        console.warn("[persistence] db_chat_sessions_save failed", err);
      });
    }, 150);
  }

  async saveChatSessionsNow(sessions, legacyStorageKey = "") {
    const safeList = Array.isArray(sessions) ? sessions.slice(0, 60) : [];
    const serialized = JSON.stringify(safeList);
    if (this.hasBackend()) {
      await this.invoke("db_chat_sessions_save", { sessionsJson: serialized });
    } else if (legacyStorageKey) {
      localStorage.setItem(legacyStorageKey, serialized);
    }
  }

  async searchPastChats(query, excludeSessionId = null, limit = 4) {
    if (!this.hasBackend() || !String(query || "").trim()) return [];
    try {
      const hits = await this.invoke("db_chat_search_past", {
        query: String(query).trim(),
        excludeSessionId: excludeSessionId || null,
        limit
      });
      return Array.isArray(hits) ? hits : [];
    } catch (err) {
      console.warn("[persistence] db_chat_search_past failed", err);
      return [];
    }
  }

  async listProjectMemories(scopeKey = null) {
    if (!this.hasBackend()) return [];
    try {
      const list = await this.invoke("db_memory_list", { scopeKey: scopeKey || null });
      return Array.isArray(list) ? list : [];
    } catch (err) {
      console.warn("[persistence] db_memory_list failed", err);
      return [];
    }
  }

  async upsertProjectMemory({ id, scopeKey, kind = "fact", content, source = "ai" }) {
    if (!this.hasBackend() || !content?.trim()) return false;
    const memId = id || `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    await this.invoke("db_memory_upsert", {
      id: memId,
      scopeKey: scopeKey || "global",
      kind,
      content: content.trim(),
      source
    });
    return true;
  }

  async deleteProjectMemory(id) {
    if (!this.hasBackend() || !id) return false;
    await this.invoke("db_memory_delete", { id });
    return true;
  }

  logAiActivity({ kind, model = "", status = "ok", summary = "", detail = "", promptTokens = 0, completionTokens = 0, totalTokens = 0 }) {
    if (!this.hasBackend()) return;
    this.invoke("db_ai_activity_log", {
      kind,
      model,
      status,
      summary,
      detail,
      promptTokens,
      completionTokens,
      totalTokens
    }).catch(() => {});
  }
}
