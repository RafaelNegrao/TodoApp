import { buildAppContextSnapshot, promptNeedsWorkspaceContext } from "../aiAppAgent.js";

function normalizeTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\[\[table:[^\]]+\]\]|!\[(video|audio|image)\]\([^)]+\)|@\[[^\]]+\]\(attachment:[^)]+\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);
}

function jaccardSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

export function auditWorkspaceConsistency(state, { scopeTaskIds = null, todayIso = null } = {}) {
  const duplicates = [];
  const inconsistencies = [];
  if (!state || !Array.isArray(state.users)) {
    return { duplicates, inconsistencies };
  }

  const today = todayIso || new Date().toISOString().slice(0, 10);
  const allowedTasks = scopeTaskIds && scopeTaskIds.size > 0 ? scopeTaskIds : null;
  const cardIndex = [];

  for (const user of state.users) {
    for (const task of user.tasks || []) {
      if (allowedTasks && !allowedTasks.has(task.id)) continue;

      if (task.startDate && task.endDate && task.endDate < task.startDate) {
        inconsistencies.push({
          type: "invalid_date_range",
          taskId: task.id,
          taskTitle: task.title,
          message: `Task "${task.title}" tem data final (${task.endDate}) anterior à inicial (${task.startDate}).`
        });
      }

      if (task.status === "ongoing" && task.endDate && task.endDate < today) {
        inconsistencies.push({
          type: "overdue_task",
          taskId: task.id,
          taskTitle: task.title,
          message: `Task "${task.title}" está em andamento com prazo vencido (${task.endDate}).`
        });
      }

      const nonRootNodes = (task.nodes || []).slice(1);
      if (task.status === "complete") {
        const openCards = nonRootNodes.filter(n => (n.status || "ongoing") !== "complete");
        if (openCards.length > 0) {
          inconsistencies.push({
            type: "completed_task_with_open_cards",
            taskId: task.id,
            taskTitle: task.title,
            message: `Task "${task.title}" está marcada como concluída, mas ainda possui ${openCards.length} card(s) em aberto.`
          });
        }
      }

      for (const node of nonRootNodes) {
        const raw = String(node.body ?? node.title ?? "").trim();
        const tokens = normalizeTokens(raw);
        if (tokens.length >= 4) {
          cardIndex.push({
            userId: user.id,
            userName: user.name,
            taskId: task.id,
            taskTitle: task.title,
            cardId: node.id,
            preview: raw.slice(0, 90),
            tokens
          });
        }
      }
    }
  }

  for (let i = 0; i < cardIndex.length; i += 1) {
    for (let j = i + 1; j < cardIndex.length; j += 1) {
      const sim = jaccardSimilarity(cardIndex[i].tokens, cardIndex[j].tokens);
      if (sim >= 0.72) {
        duplicates.push({
          similarity: Number(sim.toFixed(2)),
          first: {
            taskId: cardIndex[i].taskId,
            taskTitle: cardIndex[i].taskTitle,
            cardId: cardIndex[i].cardId,
            preview: cardIndex[i].preview
          },
          second: {
            taskId: cardIndex[j].taskId,
            taskTitle: cardIndex[j].taskTitle,
            cardId: cardIndex[j].cardId,
            preview: cardIndex[j].preview
          }
        });
        if (duplicates.length >= 12) break;
      }
    }
    if (duplicates.length >= 12) break;
  }

  return { duplicates, inconsistencies };
}

export class WorkspaceContextService {
  constructor(persistenceService = null) {
    this.persistence = persistenceService;
    this.scope = {
      mode: "auto", // "auto" | "active" | "all" | "custom"
      taskIds: new Set(),
      nodeIds: new Set()
    };
    this.workspaceVersion = 0;
  }

  markWorkspaceChanged() {
    this.workspaceVersion += 1;
  }

  setScopeMode(mode) {
    if (mode === "auto" || mode === "active" || mode === "all" || mode === "custom") {
      this.scope.mode = mode;
    }
  }

  toggleTaskInScope(taskId) {
    if (!taskId) return;
    if (this.scope.taskIds.has(taskId)) {
      this.scope.taskIds.delete(taskId);
    } else {
      this.scope.taskIds.add(taskId);
    }
    this.scope.mode = this.scope.taskIds.size > 0 || this.scope.nodeIds.size > 0 ? "custom" : "auto";
  }

  toggleNodeInScope(nodeId) {
    if (!nodeId) return;
    if (this.scope.nodeIds.has(nodeId)) {
      this.scope.nodeIds.delete(nodeId);
    } else {
      this.scope.nodeIds.add(nodeId);
    }
    this.scope.mode = this.scope.taskIds.size > 0 || this.scope.nodeIds.size > 0 ? "custom" : "auto";
  }

  clearCustomScope() {
    this.scope.taskIds.clear();
    this.scope.nodeIds.clear();
    this.scope.mode = "auto";
  }

  detectRelevantTaskIds(state, userPrompt) {
    const matched = new Set();
    const promptTokens = normalizeTokens(userPrompt);
    if (promptTokens.length < 2 || !Array.isArray(state?.users)) return matched;
    const globalQuery = /\b(todos os projetos|todas as tasks|outras tasks|workspace|duplicad|inconsist|atrasad|resumo geral)\b/i.test(String(userPrompt || ""));
    for (const u of state.users) {
      for (const t of u.tasks || []) {
        if (globalQuery) {
          matched.add(t.id);
          continue;
        }
        const titleTokens = normalizeTokens(t.title);
        if (titleTokens.length > 0 && titleTokens.every(tok => promptTokens.includes(tok))) {
          matched.add(t.id);
        }
      }
    }
    return matched;
  }

  async buildEnrichedContextJson(state, extras = {}) {
    const autoRelevantIds = this.scope.mode === "auto"
      ? this.detectRelevantTaskIds(state, extras.userPrompt)
      : new Set();
    const expandAll = this.scope.mode === "all" || this.scope.mode === "custom" || autoRelevantIds.size > 0;
    const baseJson = buildAppContextSnapshot(state, {
      ...extras,
      compactOnlyActive: !expandAll
    });
    const payload = JSON.parse(baseJson);

    const allowedTaskIds = this.scope.mode === "custom"
      ? this.scope.taskIds
      : (this.scope.mode === "auto" && autoRelevantIds.size > 0 ? autoRelevantIds : null);

    if (allowedTaskIds && allowedTaskIds.size > 0) {
      payload.contextScope = {
        mode: this.scope.mode,
        selectedTaskIds: [...allowedTaskIds],
        selectedNodeIds: [...this.scope.nodeIds],
        workspaceVersion: this.workspaceVersion
      };
      if (Array.isArray(payload.users)) {
        payload.users.forEach(u => {
          u.tasks = (u.tasks || []).map(t => {
            const taskSelected = allowedTaskIds.has(t.id);
            const hasSelectedNode = Array.isArray(t.nodes) && t.nodes.some(n => this.scope.nodeIds.has(n.id));
            if (taskSelected || hasSelectedNode || t.isActive) {
              if (this.scope.nodeIds.size > 0 && !taskSelected && Array.isArray(t.nodes)) {
                return {
                  ...t,
                  nodes: t.nodes.filter((n, idx) => idx === 0 || this.scope.nodeIds.has(n.id))
                };
              }
              return t;
            }
            return {
              id: t.id,
              title: t.title,
              status: t.status,
              isActive: false,
              cardsCount: Array.isArray(t.nodes) ? t.nodes.length : (t.cardsCount || 0)
            };
          });
        });
      }
    } else {
      payload.contextScope = { mode: this.scope.mode, workspaceVersion: this.workspaceVersion };
    }

    const activeUser = state?.users?.find(u => u.id === state.activeUserId);
    const activeTaskId = activeUser?.activeTaskId || null;
    if (payload.mode === "minimal" && this.scope.mode === "auto") {
      return JSON.stringify(payload);
    }

    const asksAuditOrHistory =
      this.scope.mode === "custom" ||
      this.scope.mode === "all" ||
      /\b(duplicad|inconsist|atrasad|prazo|auditoria|lembr[ea]|mem[oó]ria|conversas? anterior|hist[oó]rico)\b/i.test(
        String(extras.userPrompt || "")
      );

    // 1. Memoria persistente do projeto (SQLite)
    if (this.persistence) {
      const memories = await this.persistence.listProjectMemories(activeTaskId);
      if (memories.length > 0) {
        payload.projectMemories = memories.slice(0, 10).map(m => ({
          id: m.id,
          scope: m.scope_key,
          kind: m.kind,
          content: m.content
        }));
      }

      // 2. Recuperacao de conversas anteriores relevantes (SQLite)
      if (asksAuditOrHistory && extras.userPrompt && String(extras.userPrompt).trim().length >= 4) {
        const pastHits = await this.persistence.searchPastChats(
          extras.userPrompt,
          extras.activeSessionId || null,
          3
        );
        if (pastHits.length > 0) {
          payload.relevantPastConversations = pastHits;
        }
      }
    }

    // 3. Auditoria de duplicatas e inconsistencias (quando solicitada ou em escopo customizado)
    if (asksAuditOrHistory) {
      const scopeTaskIds = this.scope.mode === "custom" && this.scope.taskIds.size > 0
        ? this.scope.taskIds
        : this.scope.mode === "active" && activeTaskId
          ? new Set([activeTaskId])
          : null;
      const audit = auditWorkspaceConsistency(state, { scopeTaskIds });
      if (audit.duplicates.length > 0 || audit.inconsistencies.length > 0) {
        payload.workspaceAudit = audit;
      }
    }

    return JSON.stringify(payload);
  }
}
