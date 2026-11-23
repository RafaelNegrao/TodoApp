// Agente de controle total do TODOCompanion para o AI Chat.
// Extrai propostas de acoes estruturadas da resposta da IA, gera descricoes
// legiveis para o cartao de permissao e executa as operacoes somente apos
// aprovacao explicita do usuario.

export const AI_ACTIONS_OPEN_TAG = "[[APP_ACTIONS]]";
export const AI_ACTIONS_CLOSE_TAG = "[[/APP_ACTIONS]]";
export const AI_QUESTIONS_OPEN_TAG = "[[APP_QUESTIONS]]";
export const AI_QUESTIONS_CLOSE_TAG = "[[/APP_QUESTIONS]]";

export function extractAiActionProposal(rawText) {
  const source = String(rawText || "");
  const startIdx = source.indexOf(AI_ACTIONS_OPEN_TAG);
  const endIdx = source.indexOf(AI_ACTIONS_CLOSE_TAG);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { cleanText: source.trim(), proposal: null };
  }

  const jsonStr = source.slice(startIdx + AI_ACTIONS_OPEN_TAG.length, endIdx).trim();
  const cleanText = `${source.slice(0, startIdx)}\n${source.slice(endIdx + AI_ACTIONS_CLOSE_TAG.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const actions = Array.isArray(parsed?.actions) ? parsed.actions.filter(a => a && typeof a.type === "string") : [];
    if (!actions.length) {
      return { cleanText, proposal: null };
    }
    return {
      cleanText,
      proposal: {
        summary: String(parsed.summary || "Executar ações no aplicativo"),
        actions,
        status: "pending" // "pending" | "approved" | "rejected"
      }
    };
  } catch (_) {
    return { cleanText: source.trim(), proposal: null };
  }
}

export function extractAiQuestions(rawText) {
  const source = String(rawText || "");
  const startIdx = source.indexOf(AI_QUESTIONS_OPEN_TAG);
  const endIdx = source.indexOf(AI_QUESTIONS_CLOSE_TAG);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { cleanText: source.trim(), questionSet: null };
  }

  const jsonStr = source.slice(startIdx + AI_QUESTIONS_OPEN_TAG.length, endIdx).trim();
  const cleanText = `${source.slice(0, startIdx)}\n${source.slice(endIdx + AI_QUESTIONS_CLOSE_TAG.length)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    const rawList = Array.isArray(parsed?.questions)
      ? parsed.questions
      : parsed?.prompt && Array.isArray(parsed?.options)
        ? [parsed]
        : [];

    const questions = rawList
      .map((q, idx) => {
        const prompt = String(q?.prompt || q?.question || "").trim();
        const options = Array.isArray(q?.options)
          ? q.options
              .map(opt => {
                if (typeof opt === "string") {
                  return { label: opt.trim(), value: opt.trim(), description: "" };
                }
                const label = String(opt?.label || opt?.value || "").trim();
                const value = String(opt?.value || opt?.label || "").trim();
                const description = String(opt?.description || "").trim();
                return label ? { label, value, description } : null;
              })
              .filter(Boolean)
          : [];
        if (!prompt || !options.length) return null;
        return {
          id: String(q?.id || `q${idx + 1}`),
          prompt,
          multiSelect: Boolean(q?.multiSelect),
          allowCustom: q?.allowCustom !== false,
          options
        };
      })
      .filter(Boolean);

    if (!questions.length) {
      return { cleanText, questionSet: null };
    }

    return {
      cleanText,
      questionSet: {
        status: "pending", // "pending" | "answered"
        answers: {},
        questions
      }
    };
  } catch (_) {
    return { cleanText: source.trim(), questionSet: null };
  }
}

export function formatQuestionAnswersMessage(questionSet, answersMap) {
  const questions = Array.isArray(questionSet?.questions) ? questionSet.questions : [];
  if (!questions.length) return "";

  const lines = [];
  questions.forEach((q, idx) => {
    const raw = answersMap?.[q.id];
    const values = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [String(raw)] : [];
    if (!values.length) return;
    const joined = values.join(", ");
    if (questions.length === 1) {
      lines.push(joined);
    } else {
      lines.push(`${idx + 1}. ${q.prompt} → ${joined}`);
    }
  });
  return lines.join("\n").trim();
}

export function isDestructiveAction(action) {
  const t = String(action?.type || "");
  return t === "delete_user" || t === "delete_task" || t === "delete_card" || t === "disconnect_cards";
}

export function describeAiAction(action) {
  if (!action || !action.type) return "Ação desconhecida";
  switch (action.type) {
    case "create_user":
      return `Criar usuário "${action.name || "Novo usuário"}"`;
    case "rename_user":
      return `Renomear usuário "${action.userName || action.userId || "atual"}" para "${action.newName || ""}"`;
    case "delete_user":
      return `Excluir usuário "${action.userName || action.userId || "atual"}" e todas as suas tasks`;
    case "select_user":
      return `Abrir usuário "${action.userName || action.userId || ""}"`;
    case "create_task":
      return `Criar task "${action.title || "Nova task"}"${action.userName ? ` em ${action.userName}` : ""}`;
    case "update_task":
      return `Atualizar task "${action.taskTitle || action.taskId || "atual"}"`;
    case "delete_task":
      return `Excluir task "${action.taskTitle || action.taskId || "atual"}"`;
    case "duplicate_task":
      return `Duplicar task "${action.taskTitle || action.taskId || "atual"}"`;
    case "select_task":
      return `Mostrar/abrir task "${action.taskTitle || action.taskId || ""}"`;
    case "create_card":
      return `Criar card: "${String(action.body || "").replace(/\s+/g, " ").slice(0, 48)}"`;
    case "update_card":
      return `Atualizar card ${action.cardId ? `(${action.cardId})` : "selecionado"}`;
    case "delete_card":
      return `Excluir card ${action.cardId ? `(${action.cardId})` : "selecionado"}`;
    case "duplicate_card":
      return `Duplicar card ${action.cardId ? `(${action.cardId})` : "selecionado"}`;
    case "copy_card_to_task":
      return `Copiar card ${action.sourceCardId || ""} para a task "${action.targetTaskTitle || action.targetTaskId || ""}"`;
    case "move_card_to_task":
      return `Mover card ${action.sourceCardId || ""} para a task "${action.targetTaskTitle || action.targetTaskId || ""}"`;
    case "focus_card":
      return `Focar/mostrar card ${action.cardId || ""}`;
    case "connect_cards":
      return `Conectar card ${action.fromCardId || ""} → ${action.toCardId || ""}`;
    case "disconnect_cards":
      return `Desconectar cards ${action.fromCardId || ""} × ${action.toCardId || ""}`;
    case "organize_canvas":
      return "Organizar automaticamente os cards no canvas";
    case "center_canvas":
      return "Centralizar visualização do canvas";
    case "copy_text":
      return `Copiar texto para a área de transferência`;
    case "set_status_filter":
      return `Filtrar tasks por status: "${action.filter || "all"}"`;
    case "open_translator":
      return action.floating ? "Abrir tradutor em janela flutuante" : "Abrir painel do tradutor";
    case "open_settings":
      return "Abrir configurações (Settings)";
    case "update_settings":
      return "Alterar configurações do aplicativo";
    default:
      return `Executar ${action.type}`;
  }
}

export function buildAppContextSnapshot(state, extras = {}) {
  if (!state || !Array.isArray(state.users)) {
    return JSON.stringify({ users: [] });
  }

  const users = state.users.map(u => ({
    id: u.id,
    name: u.name,
    isActive: u.id === state.activeUserId,
    tasks: (u.tasks || []).map(t => ({
      id: t.id,
      number: t.number || null,
      title: t.title,
      status: t.status || "ongoing",
      priority: t.priority || "normal",
      criticality: t.criticality ?? 0,
      startDate: t.startDate || "",
      endDate: t.endDate || "",
      isActive: u.id === state.activeUserId && t.id === u.activeTaskId,
      nodes: (t.nodes || []).map((n, idx) => ({
        id: n.id,
        isRoot: idx === 0,
        status: n.status || "ongoing",
        criticality: n.criticality ?? 0,
        body: String(n.body ?? n.title ?? "").slice(0, 600)
      })),
      links: (t.links || []).map(l => ({ from: l.from, to: l.to }))
    }))
  }));

  return JSON.stringify({
    activeUserId: state.activeUserId || null,
    selectedNodeId: extras.selectedNodeId || null,
    settings: extras.settings || {},
    users
  });
}

function actionReferencesPlaceholder(action, token) {
  if (!action || typeof action !== "object") return false;
  return Object.values(action).some(val => val === token);
}

export function buildActionDependencyMap(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const deps = list.map(() => []);
  let lastTaskCreatorIdx = -1;
  let lastCardCreatorIdx = -1;
  const createdTaskOrCardIndices = [];

  list.forEach((action, idx) => {
    if (!action || typeof action.type !== "string") return;
    const needed = new Set();

    if (actionReferencesPlaceholder(action, "$LAST_TASK") && lastTaskCreatorIdx >= 0) {
      needed.add(lastTaskCreatorIdx);
    }
    if (actionReferencesPlaceholder(action, "$LAST_CARD") && lastCardCreatorIdx >= 0) {
      needed.add(lastCardCreatorIdx);
    }

    // Acoes sem taskId/taskTitle explicito apos um create_task aguardam a task ser criada
    if (
      lastTaskCreatorIdx >= 0 &&
      !action.taskId &&
      !action.taskTitle &&
      (action.type === "create_card" ||
        action.type === "update_task" ||
        action.type === "focus_task" ||
        action.type === "organize_canvas" ||
        action.type === "center_canvas")
    ) {
      needed.add(lastTaskCreatorIdx);
    }

    // Organizar/centralizar canvas aguarda criacoes de cards anteriores
    if (action.type === "organize_canvas" || action.type === "center_canvas") {
      createdTaskOrCardIndices.forEach(depIdx => needed.add(depIdx));
    }

    deps[idx] = [...needed];

    if (action.type === "create_task") {
      lastTaskCreatorIdx = idx;
      createdTaskOrCardIndices.push(idx);
    } else if (action.type === "create_card") {
      lastCardCreatorIdx = idx;
      createdTaskOrCardIndices.push(idx);
    }
  });

  return deps;
}

export async function executeAiActionPlan(actions, api) {
  const validEntries = [];
  (actions || []).forEach((action, idx) => {
    if (action && typeof action.type === "string") {
      validEntries.push({ action, index: idx });
    }
  });

  if (!validEntries.length) return [];

  const deps = buildActionDependencyMap(validEntries.map(e => e.action));
  const results = new Array(validEntries.length);
  const outcomes = new Array(validEntries.length);
  const stepPromises = new Array(validEntries.length);

  validEntries.forEach(({ action }, idx) => {
    api.onStepUpdate?.({
      index: idx,
      status: "pending",
      message: describeAiAction(action),
      action
    });
  });

  const runEntry = idx => {
    if (stepPromises[idx]) return stepPromises[idx];
    const { action } = validEntries[idx];

    stepPromises[idx] = (async () => {
      const depIndices = deps[idx] || [];
      if (depIndices.length > 0) {
        await Promise.all(depIndices.map(depIdx => runEntry(depIdx)));
      }

      let lastCreatedCardId = null;
      let lastCreatedTaskId = null;
      for (let j = idx - 1; j >= 0; j -= 1) {
        if (!lastCreatedCardId && outcomes[j]?.createdCardId) {
          lastCreatedCardId = outcomes[j].createdCardId;
        }
        if (!lastCreatedTaskId && outcomes[j]?.createdTaskId) {
          lastCreatedTaskId = outcomes[j].createdTaskId;
        }
      }

      api.onStepUpdate?.({
        index: idx,
        status: "in_progress",
        message: describeAiAction(action),
        action
      });

      try {
        const ctx = { lastCreatedCardId, lastCreatedTaskId };
        const outcome = await api.runAction(action, ctx);
        outcomes[idx] = outcome || {};
        const message = outcome?.message || describeAiAction(action);
        results[idx] = { ok: true, message };
        api.onStepUpdate?.({ index: idx, status: "done", message, action });
      } catch (err) {
        const message = `${describeAiAction(action)}: ${String(err?.message || err)}`;
        results[idx] = { ok: false, message };
        api.onStepUpdate?.({ index: idx, status: "failed", message, action });
      }
    })();

    return stepPromises[idx];
  };

  await Promise.all(validEntries.map((_, idx) => runEntry(idx)));
  return results;
}
