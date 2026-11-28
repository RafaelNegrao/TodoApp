// Arquitetura modular de otimizacao de System Prompt, Contexto de Conversa,
// Orçamento de Tokens (Token Budget) e Telemetria de Consumo (SOLID / OOP).

export const MODULE_IDS = Object.freeze({
  CORE: "core",
  APP_GUIDE: "app_guide",
  TASKS: "tasks",
  CANVAS: "canvas",
  FLOWCHARTS: "flowcharts",
  TABLES: "tables",
  MEMORY: "memory",
  ATTACHMENTS: "attachments",
  INTERNET: "internet",
  SETTINGS: "settings",
  QUESTIONS: "questions"
});

const MODEL_PRICING_PER_1M_USD = Object.freeze({
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-3-flash-preview": { input: 0.15, output: 0.60 },
  "gemini-flash-latest": { input: 0.15, output: 0.60 },
  "gemini-3.6-flash": { input: 0.15, output: 0.60 },
  "gemini-3.8-flash": { input: 0.15, output: 0.60 },
  "gemini-4-hydrogen": { input: 0.20, output: 0.80 },
  "gemini-3.5-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-3.1-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-2.5-pro": { input: 1.25, output: 5.00 },
  "gemini-3.1-pro-preview": { input: 1.25, output: 5.00 },
  "gemma-4-31b-it": { input: 0.05, output: 0.15 }
});

export function estimateTextTokens(text) {
  const str = String(text || "");
  if (!str) return 0;
  return Math.max(1, Math.ceil(str.length / 3.8));
}

function tokenizeNormalized(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

export class PromptModuleRegistry {
  constructor() {
    this.modules = {
      [MODULE_IDS.CORE]: [
        "You are TODOCompanion's AI Agent. Reply in the user's language.",
        "RULES:",
        "- Single-turn: deliver the complete final answer now (never say 'Vou pesquisar/verificar').",
        "- `operatorProfile` is the user chatting; `users[]` are task clients/contexts. Work strictly within the active task unless cross-task action is requested."
      ].join("\n"),

      [MODULE_IDS.APP_GUIDE]: [
        "TODOCOMPANION FULL APP KNOWLEDGE (100%):",
        "- Hierarchy: Users/Projects (left rail) -> Tasks (tasks sidebar: status, priority, criticality, start/end dates, Alarms & Reminders with custom sounds + Windows topmost overlay) -> Infinite 2D Canvas.",
        "- Canvas Cards: rich text, checklists ('[ ]'/'[x]'), 8 card colors (default/blue/emerald/amber/orange/rose/violet/slate), 2D flowcharts with ports & arrows, Excel-formula tables, inline video/audio/image/document attachments with per-attachment AI Q&A (Video or Audio-Only extraction).",
        "- Right Sidebars: AI Chat, Instant Translator (both detachable into floating always-on-top mini-windows), and Attachments sidebar ('Colocar no card' for any file/video/audio/image + Screen+Audio or Audio-Only recording).",
        "- System & Settings: themes (claude-dark/light-claude/dracula), card font size, link styles/arrows, AI icon style (dodecahedron/flat-eyes + ring color, moods, 256 thinking eye animations), alarm sound, Windows autostart, screen-share protection (WDA_EXCLUDEFROMCAPTURE), and animated AI icon in Windows system tray when closed (×)."
      ].join("\n"),

      [MODULE_IDS.TASKS]: [
        "TASKS, USERS & ALARMS/REMINDERS:",
        "- Hierarchy: Users -> Tasks (status: ongoing|stopped|complete, priority: low|normal|high|urgent, criticality: 0|1|2, startDate, endDate, reminder).",
        "- Schemas:",
        "  * {\"type\":\"create_task\",\"title\":\"...\",\"priority\":\"low|normal|high|urgent\",\"startDate\":\"YYYY-MM-DD\",\"endDate\":\"YYYY-MM-DD\"}",
        "  * {\"type\":\"update_task\",\"taskId\":\"...\",\"title\":\"...\",\"status\":\"ongoing|stopped|complete\",\"priority\":\"low|normal|high|urgent\",\"criticality\":0|1|2}",
        "  * {\"type\":\"set_task_reminder\",\"taskId\":\"opt\",\"mode\":\"alarm|notification\",\"dateTime\":\"YYYY-MM-DDTHH:MM\",\"inMinutes\":15,\"repeat\":\"none|daily|weekdays|weekly|interval\",\"intervalMinutes\":30,\"note\":\"...\"}",
        "  * {\"type\":\"remove_task_reminder\",\"taskId\":\"opt\"}",
        "  * {\"type\":\"select_task\",\"taskId\":\"...\",\"taskTitle\":\"...\"} | {\"type\":\"delete_task\",\"taskId\":\"...\"} | {\"type\":\"duplicate_task\",\"taskId\":\"...\"}",
        "  * {\"type\":\"create_user\",\"name\":\"...\"} | {\"type\":\"rename_user\",\"userId\":\"...\",\"newName\":\"...\"} | {\"type\":\"select_user\",\"userName\":\"...\"} | {\"type\":\"delete_user\",\"userId\":\"...\"}"
      ].join("\n"),

      [MODULE_IDS.CANVAS]: [
        "CANVAS CARDS:",
        "- Never use HTML tags (<br>, <p>, <div>); use '\\n' and '[ ]'/'[x]' for checklists. Omitting `taskId` targets the active task.",
        "- Card colors (`color`): `default|blue|emerald|amber|orange|rose|violet|slate` (Padrão, Azul, Verde, Amarelo, Laranja, Vermelho, Roxo, Cinza).",
        "- If asked to put previous chat info in a card, pass the full text in `create_card.body`. For 'indique/mostre/foque no canva', use `focus_card` with real `nodes[].id` (`\"$LAST_CARD\"` only after `create_card` in same batch).",
        "- Schemas:",
        "  * {\"type\":\"create_card\",\"refId\":\"opt\",\"body\":\"...\",\"color\":\"default|blue|emerald|amber|orange|rose|violet|slate\",\"gridCol\":0,\"gridRow\":0,\"connectParent\":false,\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2,\"parentCardId\":\"id|refId|$LAST_CARD\",\"fromPort\":\"out|in|top|bottom\",\"toPort\":\"in|out|top|bottom\"}",
        "  * {\"type\":\"update_card\",\"cardId\":\"id\",\"body\":\"...\",\"appendBody\":\"...\",\"color\":\"default|blue|emerald|amber|orange|rose|violet|slate\",\"status\":\"ongoing|stopped|complete\",\"criticality\":0|1|2}",
        "  * {\"type\":\"focus_card\",\"cardId\":\"id\"} | {\"type\":\"delete_card\",\"cardId\":\"id\"} | {\"type\":\"duplicate_card\",\"cardId\":\"id\"}",
        "  * {\"type\":\"copy_card_to_task\",\"sourceCardId\":\"id\",\"targetTaskTitle\":\"...\"} | {\"type\":\"move_card_to_task\",\"sourceCardId\":\"id\",\"targetTaskTitle\":\"...\"}",
        "  * {\"type\":\"organize_canvas\"} | {\"type\":\"center_canvas\"} | {\"type\":\"copy_text\",\"text\":\"...\"}"
      ].join("\n"),

      [MODULE_IDS.FLOWCHARTS]: [
        "2D FLOWCHARTS & CONNECTIONS:",
        "- Never flatten 2D flowcharts into 1D. Assign each `create_card` a short `refId`, 2D coordinates `gridCol` (0,1,2...) and `gridRow` (0,1,2...), and `connectParent:false`.",
        "- Link branches/loops with `connect_cards` using `fromPort`/`toPort` (`top|bottom|in|out`):",
        "  * {\"type\":\"connect_cards\",\"fromCardId\":\"id|refId\",\"toCardId\":\"id|refId\",\"fromPort\":\"out|in|top|bottom\",\"toPort\":\"in|out|top|bottom\",\"fromRow\":0,\"toRow\":0} | {\"type\":\"disconnect_cards\",\"fromCardId\":\"id1\",\"toCardId\":\"id2\"}"
      ].join("\n"),

      [MODULE_IDS.TABLES]: [
        "TABLES:",
        "- Use `create_table_card` (`hasCheckboxes:true` puts '[ ]'/'[x]' in col 0). Supports Excel formulas (SUM/SOMA, AVERAGE/MEDIA, IF/SE, SUMIF/SOMASE, VLOOKUP/PROCV). Per-row links use 0-indexed `fromRow`/`toRow` in `connect_cards`.",
        "  * {\"type\":\"create_table_card\",\"hasCheckboxes\":false|true,\"rows\":[[\"Col1\",\"Col2\"],[\"V1\",\"=SOMA(B2:B2)\"]],\"parentCardId\":\"opt_id\"}"
      ].join("\n"),

      [MODULE_IDS.MEMORY]: [
        "MEMORY & AUDIT:",
        "- Use `projectMemories`, `relevantPastConversations`, and `workspaceAudit` from LIVE APP STATE when relevant.",
        "  * {\"type\":\"save_memory\",\"scope\":\"task|global\",\"kind\":\"decision|fact|preference\",\"content\":\"...\"}"
      ].join("\n"),

      [MODULE_IDS.ATTACHMENTS]: [
        "ATTACHMENTS & SCREENSHOT:",
        "- Attached files (PDF, image, audio, video, CSV/text) are injected in the user message. Card media syntax: '![video](userId/file)', '![audio](userId/file)', '@[name](attachment:id)'.",
        "- If `current_screen.jpg` is attached, analyze the screenshot directly without emitting [[APP_ACTIONS]] unless requested."
      ].join("\n"),

      [MODULE_IDS.INTERNET]: [
        "INTERNET & LIVE DATA:",
        "- Live web search results, currency rates, and extracted URL texts are injected directly into the user message — use those facts/numbers immediately."
      ].join("\n"),

      [MODULE_IDS.SETTINGS]: [
        "SETTINGS & TOOLS:",
        "  * {\"type\":\"set_status_filter\",\"filter\":\"all|ongoing|stopped|complete\"} | {\"type\":\"open_translator\",\"floating\":true|false} | {\"type\":\"open_attachments\",\"open\":true|false} | {\"type\":\"open_settings\"}",
        "  * {\"type\":\"update_settings\",\"theme\":\"claude-dark|light-claude|dracula\",\"cardFontSize\":14,\"linkStyle\":\"orthogonal|bezier\",\"linkArrows\":true|false,\"translatorMode\":\"auto|manual\",\"aiIconStyle\":\"dodecahedron|flat-eyes\",\"aiIconColor\":\"#6366f1\",\"alarmSound\":\"crystal|chime|pulse|bell\",\"screenShareProtection\":true|false}"
      ].join("\n"),

      [MODULE_IDS.QUESTIONS]: [
        "QUESTIONS (when clarification is needed, omit [[APP_ACTIONS]] and append):",
        "[[APP_QUESTIONS]]",
        "{\"questions\":[{\"id\":\"q1\",\"type\":\"choice|checkbox|chips|toggle|slider|rating|text|date\",\"prompt\":\"...\",\"multiSelect\":false,\"allowCustom\":true,\"options\":[{\"label\":\"...\",\"value\":\"...\",\"description\":\"...\",\"badge\":\"Recomendado\"}]}]}",
        "[[/APP_QUESTIONS]]"
      ].join("\n")
    };

    this.actionsEnvelopeRule = [
      "ACTIONS PROTOCOL (when executing any app action above, write a short confirmation first, then append ONE block with exact double-bracket tags):",
      "[[APP_ACTIONS]]",
      "{\"summary\":\"...\",\"actions\":[...]}",
      "[[/APP_ACTIONS]]"
    ].join("\n");
  }

  detectModules({
    userPrompt = "",
    hasAttachments = false,
    hasAppAttachments = false,
    willCaptureScreen = false,
    hasProjectMemories = false,
    hasPastConversations = false
  } = {}) {
    const text = String(userPrompt || "").trim();
    const lower = text.toLowerCase();
    const active = new Set([MODULE_IDS.CORE]);

    if (
      /\b(app|aplicativo|todocompanion|recurso|recursos|funcionalidade|funcionalidades|consegue fazer|pode fazer|sabe fazer|como funciona|como usar|ajuda|help|o que voc[eê] faz|bandeja|tray|gravar|grava[cç][aã]o|flutuante|compartilha|streaming)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.APP_GUIDE);
    }

    if (
      hasAttachments ||
      hasAppAttachments ||
      willCaptureScreen ||
      /\b(anexo|anexos|arquivo|arquivos|pdf|audio|áudio|video|vídeo|imagem|foto|print|screenshot|tela|screen|grava[cç][aã]o|csv|txt)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.ATTACHMENTS);
    }

    if (
      /https?:\/\//i.test(lower) ||
      /\b(pesquis[ea]|busqu[ea]|google|internet|not[ií]cia|cotac[aã]o|d[oó]lar|euro|bitcoin|btc|clima|tempo hoje|pre[cç]o|atual|hoje|202[5-9])\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.INTERNET);
    }

    if (
      /\b(task|tasks|tarefa|tarefas|projeto|projetos|user|users|usu[aá]rio|usu[aá]rios|cliente|clientes|prioridade|prazo|start\s*date|end\s*date|data final|data inicial|alarme|alarmes|lembrete|lembretes|despertador|notifica[cç][aã]o|hor[aá]rio|me avis[ae]|avis[ae]r?)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.TASKS);
    }

    if (
      /\b(card|cards|bloco|blocos|nota|checklist|todo|canva|canvas|quadro|foqu[ea]|indiqu[ea]|mostr[ea]|navegu[ea]|organiz[ea]|centraliz[ea]|copi[ae]|mov[ae]|dupliqu[ae]|exclu[ia]|delet[ea]|apag[ue]|adicion[ea]|cri[ea]|insir[ao]|coloc[ao]|edit[ea]|atualiz[ea]|pint[ae]|cor|cores|colori\w*|azul|verde|amarelo|laranja|vermelho|roxo|cinza)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.CANVAS);
    }

    if (
      /\b(fluxo|fluxograma|flowchart|diagrama|ramifica|branch|loop|conect[ea]|ligu[ea]|desconect[ea]|seta|setas|camada|colunas? e linhas?|grid|2d|repliqu[ea])\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.CANVAS);
      active.add(MODULE_IDS.FLOWCHARTS);
    }

    if (
      /\b(tabela|tabelas|table|planilha|excel|f[oó]rmula|soma|sum|m[eé]dia|average|procv|vlookup|coluna|linha|c[eé]lula)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.CANVAS);
      active.add(MODULE_IDS.TABLES);
    }

    if (
      hasProjectMemories ||
      hasPastConversations ||
      /\b(mem[oó]ria|lembr[ea]|decis[aã]o|hist[oó]rico|conversa anterior|conversas anteriores|duplicad|inconsist|auditoria|atrasad)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.MEMORY);
    }

    if (
      /\b(configura[cç][aã]o|configura[cç][oõ]es|settings|tema|dark|light|dracula|fonte|font\s*size|tradutor|translator|filtro|bezier|orthogonal|[ií]cone|dodecaedro|olhos|som do alarme|compartilha|streaming|bandeja|tray|anexos)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.SETTINGS);
    }

    if (
      /\b(pergunt[ea]|op[cç][oõ]es|escolh[ea]|qual deles|d[uú]vida|enquete|question[aá]rio)\b/i.test(lower)
    ) {
      active.add(MODULE_IDS.QUESTIONS);
    }

    return [...active];
  }

  composeSystemPrompt({ modules = [MODULE_IDS.CORE], appContextJson = "{}" } = {}) {
    const activeSet = new Set(modules);
    activeSet.add(MODULE_IDS.CORE);

    const coreText = this.modules[MODULE_IDS.CORE];
    const dynamicBlocks = [];
    const actionCapableModules = [
      MODULE_IDS.TASKS,
      MODULE_IDS.CANVAS,
      MODULE_IDS.FLOWCHARTS,
      MODULE_IDS.TABLES,
      MODULE_IDS.MEMORY,
      MODULE_IDS.SETTINGS
    ];

    let needsActionsEnvelope = false;
    for (const modId of [
      MODULE_IDS.APP_GUIDE,
      MODULE_IDS.ATTACHMENTS,
      MODULE_IDS.INTERNET,
      MODULE_IDS.TASKS,
      MODULE_IDS.CANVAS,
      MODULE_IDS.FLOWCHARTS,
      MODULE_IDS.TABLES,
      MODULE_IDS.MEMORY,
      MODULE_IDS.SETTINGS,
      MODULE_IDS.QUESTIONS
    ]) {
      if (activeSet.has(modId) && this.modules[modId]) {
        dynamicBlocks.push(this.modules[modId]);
        if (actionCapableModules.includes(modId)) {
          needsActionsEnvelope = true;
        }
      }
    }

    if (needsActionsEnvelope) {
      dynamicBlocks.push(this.actionsEnvelopeRule);
    }

    const dynamicText = dynamicBlocks.join("\n\n");
    const stateBlock = `LIVE APP STATE (JSON):\n${appContextJson}`;
    const fullPrompt = dynamicText
      ? `${coreText}\n\n${dynamicText}\n\n${stateBlock}`
      : `${coreText}\n\n${stateBlock}`;

    return {
      systemPrompt: fullPrompt,
      activeModules: [...activeSet],
      coreTokensEstimate: estimateTextTokens(coreText),
      dynamicTokensEstimate: estimateTextTokens(dynamicText),
      stateTokensEstimate: estimateTextTokens(stateBlock)
    };
  }
}

export class ConversationContextManager {
  constructor({ recentWindowSize = 6, maxSummaryChars = 950, maxRetrievedOlderMessages = 2 } = {}) {
    this.recentWindowSize = recentWindowSize;
    this.maxSummaryChars = maxSummaryChars;
    this.maxRetrievedOlderMessages = maxRetrievedOlderMessages;
  }

  setRecentWindowSize(size) {
    const parsed = Number(size);
    if (Number.isFinite(parsed) && parsed >= 2 && parsed <= 20) {
      this.recentWindowSize = Math.round(parsed);
    }
  }

  cleanHistory(messages = []) {
    return (Array.isArray(messages) ? messages : []).filter(
      m =>
        m &&
        !m.coachAdvice &&
        !(m.role === "model" && typeof m.text === "string" && m.text.trimStart().startsWith("Error:"))
    );
  }

  buildOlderConversationSummary(olderMessages = []) {
    if (!Array.isArray(olderMessages) || olderMessages.length === 0) {
      return "";
    }

    const decisions = [];
    const pendingItems = [];
    const preferencesAndFacts = [];

    for (const msg of olderMessages) {
      const text = String(msg?.text || "").replace(/\s+/g, " ").trim();
      if (msg?.proposal?.summary) {
        decisions.push(String(msg.proposal.summary).trim());
      }
      if (!text) continue;

      if (msg.role === "user") {
        if (/\b(prefir[oa]|sempre|nunca|meu nome|minha Stack|uso|padr[aã]o|lembr[ea]|decidimos|arquitetura|porta|banco|meta|or[cç]amento)\b/i.test(text)) {
          preferencesAndFacts.push(text.slice(0, 140));
        } else if (/\b(pendente|falta|depois|amanh[aã]|pr[oó]ximo passo|preciso|todo|tarefa)\b/i.test(text)) {
          pendingItems.push(text.slice(0, 120));
        } else if (preferencesAndFacts.length < 3) {
          preferencesAndFacts.push(text.slice(0, 110));
        }
      } else if (msg.role === "model" && !msg?.proposal && decisions.length < 4) {
        const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
        if (firstSentence.length >= 12) {
          decisions.push(firstSentence.slice(0, 120));
        }
      }
    }

    const lines = [`[Resumo de ${olderMessages.length} mensagens anteriores da conversa]`];
    if (preferencesAndFacts.length > 0) {
      lines.push(`- Contexto/Preferências: ${[...new Set(preferencesAndFacts)].slice(-4).join(" | ")}`);
    }
    if (decisions.length > 0) {
      lines.push(`- Decisões/Ações: ${[...new Set(decisions)].slice(-5).join(" | ")}`);
    }
    if (pendingItems.length > 0) {
      lines.push(`- Pendências: ${[...new Set(pendingItems)].slice(-3).join(" | ")}`);
    }

    return lines.join("\n").slice(0, this.maxSummaryChars);
  }

  retrieveRelevantOlderMessages(olderMessages = [], currentPrompt = "") {
    if (!Array.isArray(olderMessages) || olderMessages.length === 0) return [];
    const queryTokens = new Set(tokenizeNormalized(currentPrompt));
    if (queryTokens.size === 0) return [];

    const scored = [];
    olderMessages.forEach((msg, idx) => {
      const raw = String(msg?.text || "").trim();
      if (!raw) return;
      const msgTokens = tokenizeNormalized(raw);
      if (!msgTokens.length) return;
      let hits = 0;
      for (const tok of msgTokens) {
        if (queryTokens.has(tok)) hits += 1;
      }
      if (hits > 0) {
        const score = hits / Math.sqrt(msgTokens.length + 2);
        scored.push({ idx, msg, score, hits });
      }
    });

    scored.sort((a, b) => b.score - a.score || b.idx - a.idx);
    return scored.slice(0, this.maxRetrievedOlderMessages).map(item => ({
      role: item.msg.role,
      text: String(item.msg.text || "").replace(/\s+/g, " ").trim().slice(0, 260)
    }));
  }

  buildOptimizedConversationPayload(allMessages = [], currentPrompt = "") {
    const cleaned = this.cleanHistory(allMessages);
    if (cleaned.length === 0) {
      return {
        payloadMessages: [],
        summaryText: "",
        retrievedSnippets: [],
        historyTokensEstimate: 0,
        summaryTokensEstimate: 0,
        userInputTokensEstimate: 0
      };
    }

    const windowSize = Math.max(2, this.recentWindowSize);
    const hasOlder = cleaned.length > windowSize;
    const olderMessages = hasOlder ? cleaned.slice(0, cleaned.length - windowSize) : [];
    const recentMessages = hasOlder ? cleaned.slice(-windowSize) : cleaned;

    const summaryText = hasOlder ? this.buildOlderConversationSummary(olderMessages) : "";
    const retrievedSnippets = hasOlder
      ? this.retrieveRelevantOlderMessages(olderMessages, currentPrompt)
      : [];

    let fullSummaryBlock = summaryText;
    if (retrievedSnippets.length > 0) {
      const retrievedLines = retrievedSnippets.map(
        s => `  * [${s.role === "model" ? "IA" : "Usuário"}]: ${s.text}`
      );
      fullSummaryBlock = `${summaryText}\n- Trechos antigos relevantes recuperados:\n${retrievedLines.join("\n")}`.trim();
    }

    const lastIdx = recentMessages.length - 1;
    const payloadMessages = recentMessages.map((m, idx) => {
      const isCurrentTurn = idx === lastIdx;
      const isImmediatePrev = idx >= lastIdx - 2;
      const rawText = String(m.text || "");
      const maxChars = isCurrentTurn ? rawText.length : (isImmediatePrev ? 1100 : 550);
      return {
        role: m.role,
        text: isCurrentTurn ? rawText : rawText.slice(0, maxChars),
        attachments: (m.attachments || []).map(a => {
          if (isCurrentTurn) {
            return {
              name: a.name || "",
              mime_type: a.mime_type || "",
              data_base64: a.data_base64 || "",
              text_content: String(a.text_content || "").slice(0, 18000)
            };
          }
          return {
            name: a.name || "",
            mime_type: a.mime_type || "",
            data_base64: "",
            text_content: a.text_content
              ? String(a.text_content).slice(0, 800)
              : `[Anexo anterior: ${a.name || "arquivo"}]`
          };
        })
      };
    });

    if (fullSummaryBlock && payloadMessages.length > 0) {
      payloadMessages.unshift({
        role: "user",
        text: fullSummaryBlock,
        attachments: [],
        isSummary: true
      });
    }

    const currentMsg = payloadMessages[payloadMessages.length - 1];
    const userInputTokensEstimate =
      estimateTextTokens(currentMsg?.text || "") +
      (currentMsg?.attachments || []).reduce(
        (acc, a) => acc + estimateTextTokens(a.text_content || "") + (a.data_base64 ? 258 : 0),
        0
      );

    const historyTokensEstimate = payloadMessages
      .slice(fullSummaryBlock ? 1 : 0, -1)
      .reduce((acc, m) => acc + estimateTextTokens(m.text), 0);

    const summaryTokensEstimate = estimateTextTokens(fullSummaryBlock);

    return {
      payloadMessages: payloadMessages.map(({ isSummary, ...rest }) => rest),
      summaryText: fullSummaryBlock,
      retrievedSnippets,
      historyTokensEstimate,
      summaryTokensEstimate,
      userInputTokensEstimate
    };
  }
}

export class TokenBudgetManager {
  constructor({
    maxTotalInputTokens = 5500,
    maxStateTokens = 1600,
    maxHistoryTokens = 1200,
    maxSummaryTokens = 320
  } = {}) {
    this.maxTotalInputTokens = maxTotalInputTokens;
    this.maxStateTokens = maxStateTokens;
    this.maxHistoryTokens = maxHistoryTokens;
    this.maxSummaryTokens = maxSummaryTokens;
  }

  enforceBudget({
    systemCoreTokens = 0,
    dynamicInstructionTokens = 0,
    appContextObj = null,
    payloadMessages = [],
    summaryText = ""
  } = {}) {
    let contextObj = appContextObj ? JSON.parse(JSON.stringify(appContextObj)) : {};
    let stateJson = JSON.stringify(contextObj);
    let stateTokens = estimateTextTokens(stateJson);

    // 1. Poda progressiva do LIVE APP STATE se exceder maxStateTokens, preservando todos os IDs!
    if (stateTokens > this.maxStateTokens && Array.isArray(contextObj.users)) {
      for (const u of contextObj.users) {
        for (const t of u.tasks || []) {
          if (Array.isArray(t.nodes)) {
            t.nodes = t.nodes.map(n => ({
              id: n.id,
              isRoot: n.isRoot,
              type: n.type,
              status: n.status,
              body: String(n.body || "").slice(0, n.id === contextObj.selectedNodeId ? 320 : 85),
              table: n.table
                ? {
                  hasCheckboxes: n.table.hasCheckboxes,
                  rows: (n.table.rows || []).slice(0, 5)
                }
                : undefined
            }));
          }
        }
      }
      stateJson = JSON.stringify(contextObj);
      stateTokens = estimateTextTokens(stateJson);
    }

    // 2. Poda de mensagens intermediarias do historico se o total ainda exceder maxTotalInputTokens
    const msgs = payloadMessages.map(m => ({ ...m, attachments: [...(m.attachments || [])] }));
    const calcHistoryTokens = () =>
      msgs.slice(0, -1).reduce((sum, m) => sum + estimateTextTokens(m.text), 0);

    let historyTokens = calcHistoryTokens();
    const lastMsg = msgs[msgs.length - 1];
    let userInputTokens =
      estimateTextTokens(lastMsg?.text || "") +
      (lastMsg?.attachments || []).reduce(
        (acc, a) => acc + estimateTextTokens(a.text_content || "") + (a.data_base64 ? 258 : 0),
        0
      );

    let totalEstimated =
      systemCoreTokens + dynamicInstructionTokens + stateTokens + historyTokens + userInputTokens;

    if (totalEstimated > this.maxTotalInputTokens && msgs.length > 2) {
      for (let i = 0; i < msgs.length - 1 && totalEstimated > this.maxTotalInputTokens; i += 1) {
        const currentLen = String(msgs[i].text || "").length;
        if (currentLen > 240) {
          msgs[i].text = `${String(msgs[i].text).slice(0, 220)}...`;
          historyTokens = calcHistoryTokens();
          totalEstimated =
            systemCoreTokens + dynamicInstructionTokens + stateTokens + historyTokens + userInputTokens;
        }
      }
    }

    const summaryTokens = estimateTextTokens(summaryText);
    const pureHistoryTokens = Math.max(0, historyTokens - summaryTokens);

    return {
      appContextJson: stateJson,
      payloadMessages: msgs,
      breakdown: {
        systemPromptTokens: systemCoreTokens,
        dynamicInstructionTokens,
        liveAppStateTokens: stateTokens,
        conversationHistoryTokens: pureHistoryTokens,
        summaryTokens,
        userInputTokens,
        estimatedInputTokens:
          systemCoreTokens +
          dynamicInstructionTokens +
          stateTokens +
          pureHistoryTokens +
          summaryTokens +
          userInputTokens
      }
    };
  }
}

export class TokenMetricsMonitor {
  static estimateCostUsd(modelId, promptTokens, completionTokens) {
    const cleanModel = String(modelId || "").trim().toLowerCase();
    const pricing =
      MODEL_PRICING_PER_1M_USD[cleanModel] ||
      MODEL_PRICING_PER_1M_USD["gemini-2.5-flash"];
    const inCost = (Math.max(0, Number(promptTokens) || 0) / 1_000_000) * pricing.input;
    const outCost = (Math.max(0, Number(completionTokens) || 0) / 1_000_000) * pricing.output;
    return Number((inCost + outCost).toFixed(6));
  }

  static reconcileWithActualUsage(estimatedBreakdown, actualPromptTokens, actualCompletionTokens, modelId = "") {
    const base = estimatedBreakdown || {
      systemPromptTokens: 0,
      dynamicInstructionTokens: 0,
      liveAppStateTokens: 0,
      conversationHistoryTokens: 0,
      summaryTokens: 0,
      userInputTokens: 0,
      estimatedInputTokens: 0
    };

    const estTotal = Math.max(1, Number(base.estimatedInputTokens) || 1);
    const realInput = Number(actualPromptTokens) > 0 ? Number(actualPromptTokens) : estTotal;
    const realOutput = Math.max(0, Number(actualCompletionTokens) || 0);
    const scale = realInput / estTotal;

    const systemPromptTokens = Math.max(1, Math.round(base.systemPromptTokens * scale));
    const dynamicInstructionTokens = Math.round(base.dynamicInstructionTokens * scale);
    const liveAppStateTokens = Math.round(base.liveAppStateTokens * scale);
    const conversationHistoryTokens = Math.round(base.conversationHistoryTokens * scale);
    const summaryTokens = Math.round(base.summaryTokens * scale);
    const allocated =
      systemPromptTokens +
      dynamicInstructionTokens +
      liveAppStateTokens +
      conversationHistoryTokens +
      summaryTokens;
    const userInputTokens = Math.max(1, realInput - allocated);

    const totalTokens = realInput + realOutput;
    const estimatedCostUsd = TokenMetricsMonitor.estimateCostUsd(modelId, realInput, realOutput);

    return {
      inputTokens: realInput,
      outputTokens: realOutput,
      totalTokens,
      estimatedCostUsd,
      components: {
        systemPromptTokens,
        dynamicInstructionTokens,
        liveAppStateTokens,
        conversationHistoryTokens,
        summaryTokens,
        userInputTokens,
        outputTokens: realOutput
      }
    };
  }

  static computeSessionMetrics(messages = []) {
    const modelMsgs = (Array.isArray(messages) ? messages : []).filter(
      m => m && m.role === "model" && (Number(m.totalTokens) > 0 || Number(m.promptTokens) > 0)
    );
    if (modelMsgs.length === 0) {
      return {
        requestCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        averageTokensPerRequest: 0,
        totalEstimatedCostUsd: 0
      };
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;
    let totalEstimatedCostUsd = 0;

    for (const m of modelMsgs) {
      const pTok = Number(m.promptTokens) || 0;
      const cTok = Number(m.completionTokens) || 0;
      const tTok = Number(m.totalTokens) || pTok + cTok;
      totalInputTokens += pTok;
      totalOutputTokens += cTok;
      totalTokens += tTok;
      totalEstimatedCostUsd +=
        Number(m.tokenMetrics?.estimatedCostUsd) ||
        TokenMetricsMonitor.estimateCostUsd(m.model, pTok, cTok);
    }

    return {
      requestCount: modelMsgs.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      averageTokensPerRequest: Math.round(totalTokens / modelMsgs.length),
      totalEstimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(6))
    };
  }
}
