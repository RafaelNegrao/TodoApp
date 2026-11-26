export function parseLiveCoachAdvice(rawText) {
  const cleaned = String(rawText || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return null;

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    if (!parsed) return null;

    const skip = Boolean(parsed.skip);
    const userContext = String(parsed.userContext || "").trim();
    const heardSummary = String(parsed.heardSummary || "").trim();
    const tip = String(parsed.tip || "").trim();
    const translation = String(parsed.translation || "").trim();

    if (skip) {
      return userContext ? { skip: true, userContext, heardSummary: "", translation: "", suggestions: [], tip: "" } : null;
    }

    const suggestions = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
          .filter(s => s && String(s.en || "").trim())
          .slice(0, 3)
          .map(s => ({
            tone: String(s.tone || "Natural").trim(),
            en: String(s.en || "").trim(),
            pt: String(s.pt || "").trim()
          }))
      : [];

    if (!heardSummary && !translation && !suggestions.length && !tip) {
      return userContext ? { skip: true, userContext, heardSummary: "", translation: "", suggestions: [], tip: "" } : null;
    }

    return { skip: false, heardSummary, translation, userContext, suggestions, tip };
  } catch (_) {
    return null;
  }
}

export class LiveEnglishCoachController {
  constructor({ invoke, getApiKey, getOutputMode, onAdvice, onUsage, onStatusChange, onError, intervalMs = 2500 }) {
    this.invoke = invoke;
    this.getApiKey = getApiKey;
    this.getOutputMode = getOutputMode;
    this.onAdvice = onAdvice;
    this.onUsage = onUsage;
    this.onStatusChange = onStatusChange;
    this.onError = onError;
    this.intervalMs = intervalMs;

    this.active = false;
    this.inFlight = false;
    this.inFlightCount = 0;
    this.immediateInFlight = false;
    this.timerId = 0;
    this.recentSummaries = [];
  }

  _pushMemory(line) {
    if (!line) return;
    this.recentSummaries.push(line);
    if (this.recentSummaries.length > 8) {
      this.recentSummaries.shift();
    }
  }

  _buildRecentContext() {
    if (!this.recentSummaries.length) return "";
    return this.recentSummaries.slice(-8).join("\n");
  }

  async start() {
    if (this.active) return;
    if (!this.invoke) {
      this.onError?.("Live Coach requires the desktop app.");
      return;
    }
    this.active = true;
    this.recentSummaries = [];
    this.onStatusChange?.({ active: true, busy: false, label: "Listening to conversation..." });

    try {
      await this.invoke("ai_audio_capture_start");
    } catch (err) {
      this.active = false;
      this.onStatusChange?.({ active: false, busy: false, label: "" });
      this.onError?.(String(err?.message || err));
      return;
    }

    this.timerId = window.setInterval(() => {
      this.flushNow();
    }, this.intervalMs);
  }

  async flushNow({ immediate = false } = {}) {
    if (!this.active || !this.invoke) return;
    if ((!immediate && this.inFlightCount > 0) || (immediate && this.immediateInFlight)) return;
    this.inFlightCount += 1;
    this.inFlight = true;
    if (immediate) this.immediateInFlight = true;
    this.onStatusChange?.({ active: true, busy: true, label: "Analyzing speech..." });

    try {
      const raw = await this.invoke("ai_live_coach_flush_and_advise", {
        apiKey: this.getApiKey?.() || null,
        recentContext: this._buildRecentContext(),
        stop: false,
        immediate,
        outputMode: this.getOutputMode?.() || "reply"
      });

      if (!this.active) return;

      if (raw) {
        const usage = raw && typeof raw === "object" ? raw : null;
        const rawText = usage && typeof usage.text === "string" ? usage.text : raw;
        if (usage) {
          this.onUsage?.({
            promptTokens: Number(usage.prompt_tokens) || 0,
            completionTokens: Number(usage.completion_tokens) || 0,
            totalTokens: Number(usage.total_tokens) || 0
          });
        }
        const advice = parseLiveCoachAdvice(rawText);
        if (advice) {
          if (advice.heardSummary) {
            this._pushMemory(`Outra pessoa: ${advice.heardSummary}`);
          }
          if (advice.userContext) {
            this._pushMemory(`Usuário: ${advice.userContext}`);
          }
          if (!advice.skip) {
            this.onAdvice?.(advice);
          }
        }
      }
    } catch (err) {
      if (this.active) {
        this.onError?.(String(err?.message || err));
      }
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.inFlight = this.inFlightCount > 0;
      if (immediate) this.immediateInFlight = false;
      if (this.active && this.inFlightCount === 0) {
        this.onStatusChange?.({ active: true, busy: false, label: "Listening to conversation..." });
      }
    }
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = 0;
    }
    this.onStatusChange?.({ active: false, busy: false, label: "" });

    if (this.invoke) {
      try {
        await this.invoke("ai_live_coach_flush_and_advise", {
          apiKey: null,
          recentContext: null,
          stop: true,
          immediate: false,
          outputMode: this.getOutputMode?.() || "reply"
        });
      } catch (_) {
        // Ignore stop cleanup errors
      }
    }
  }

  async toggle() {
    if (this.active) {
      await this.stop();
    } else {
      await this.start();
    }
  }
}
