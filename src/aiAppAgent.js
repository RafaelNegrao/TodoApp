// Agente de controle total do TODOCompanion para o AI Chat.
// Extrai propostas de acoes estruturadas da resposta da IA, gera descricoes
// legiveis para o cartao de permissao e executa as operacoes somente apos
// aprovacao explicita do usuario.

import { decodeTableData } from "./cardTable.js";

export const AI_ACTIONS_OPEN_TAG = "[[APP_ACTIONS]]";
export const AI_ACTIONS_CLOSE_TAG = "[[/APP_ACTIONS]]";
export const AI_QUESTIONS_OPEN_TAG = "[[APP_QUESTIONS]]";
export const AI_QUESTIONS_CLOSE_TAG = "[[/APP_QUESTIONS]]";

function tryParseBalancedJson(rawJson) {
  const cleaned = String(rawJson || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned);
  } catch (_) {
    // Caso o modelo tenha truncado os colchetes/chaves finais do JSON, tenta balancear
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace === -1) return null;
    let candidate = cleaned.slice(firstBrace).replace(/,\s*$/, "");
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let i = 0; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") stack.push("}");
      else if (ch === "[") stack.push("]");
      else if ((ch === "}" || ch === "]") && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
    if (inString) candidate += '"';
    candidate = candidate.replace(/,\s*$/, "");
    while (stack.length > 0) {
      candidate += stack.pop();
    }
    try {
      return JSON.parse(candidate);
    } catch (__) {
      return null;
    }
  }
}

export function extractAiActionProposal(rawText) {
  const source = String(rawText || "");
  const openMatch = source.match(/\[\[?\s*APP_ACTIONS\s*\]\]?/i);
  if (!openMatch || openMatch.index === undefined) {
    return { cleanText: source.trim(), proposal: null };
  }

  const startIdx = openMatch.index;
  const contentStart = startIdx + openMatch[0].length;
  const afterOpen = source.slice(contentStart);
  const closeMatch = afterOpen.match(/\[\[?\s*\/\s*APP_ACTIONS\s*\]\]?/i);

  const jsonStr = closeMatch && closeMatch.index !== undefined
    ? afterOpen.slice(0, closeMatch.index)
    : afterOpen;
  const afterClose = closeMatch && closeMatch.index !== undefined
    ? afterOpen.slice(closeMatch.index + closeMatch[0].length)
    : "";

  const cleanText = `${source.slice(0, startIdx)}\n${afterClose}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const parsed = tryParseBalancedJson(jsonStr);
  const actions = Array.isArray(parsed?.actions)
    ? parsed.actions.filter(a => a && typeof a.type === "string")
    : [];
  if (!actions.length) {
    return { cleanText: cleanText || source.trim(), proposal: null };
  }
  return {
    cleanText,
    proposal: {
      summary: String(parsed.summary || "Executar ações no aplicativo"),
      actions,
      status: "pending"
    }
  };
}

export function extractAiQuestions(rawText) {
  const source = String(rawText || "");
  const openMatch = source.match(/\[\[?\s*APP_QUESTIONS\s*\]\]?/i);
  if (!openMatch || openMatch.index === undefined) {
    return { cleanText: source.trim(), questionSet: null };
  }

  const startIdx = openMatch.index;
  const contentStart = startIdx + openMatch[0].length;
  const afterOpen = source.slice(contentStart);
  const closeMatch = afterOpen.match(/\[\[?\s*\/\s*APP_QUESTIONS\s*\]\]?/i);

  const jsonStr = closeMatch && closeMatch.index !== undefined
    ? afterOpen.slice(0, closeMatch.index)
    : afterOpen;
  const afterClose = closeMatch && closeMatch.index !== undefined
    ? afterOpen.slice(closeMatch.index + closeMatch[0].length)
    : "";

  const cleanText = `${source.slice(0, startIdx)}\n${afterClose}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  try {
    const parsed = tryParseBalancedJson(jsonStr);
    if (!parsed) return { cleanText: cleanText || source.trim(), questionSet: null };
    const rawList = Array.isArray(parsed?.questions)
      ? parsed.questions
      : parsed?.prompt && Array.isArray(parsed?.options)
        ? [parsed]
        : [];

    const VALID_QUESTION_TYPES = new Set([
      "choice",
      "checkbox",
      "chips",
      "toggle",
      "slider",
      "rating",
      "text",
      "date"
    ]);

    const questions = rawList
      .map((q, idx) => {
        const prompt = String(q?.prompt || q?.question || "").trim();
        if (!prompt) return null;

        const rawType = String(q?.type || "").trim().toLowerCase();
        const inferredType = VALID_QUESTION_TYPES.has(rawType)
          ? rawType
          : q?.multiSelect
            ? "checkbox"
            : "choice";

        const options = Array.isArray(q?.options)
          ? q.options
              .map(opt => {
                if (typeof opt === "string") {
                  return { label: opt.trim(), value: opt.trim(), description: "", badge: "" };
                }
                const label = String(opt?.label || opt?.value || "").trim();
                const value = String(opt?.value || opt?.label || "").trim();
                const description = String(opt?.description || "").trim();
                const badge = String(opt?.badge || "").trim();
                return label ? { label, value, description, badge } : null;
              })
              .filter(Boolean)
          : [];

        const needsOptions = inferredType === "choice" || inferredType === "checkbox" || inferredType === "chips";
        if (needsOptions && !options.length) return null;

        const multiSelect = inferredType === "checkbox" || Boolean(q?.multiSelect);
        return {
          id: String(q?.id || `q${idx + 1}`),
          type: inferredType,
          prompt,
          multiSelect,
          allowCustom: needsOptions && q?.allowCustom !== false,
          options,
          min: Number.isFinite(Number(q?.min)) ? Number(q.min) : 0,
          max: Number.isFinite(Number(q?.max)) ? Number(q.max) : inferredType === "rating" ? 5 : 10,
          step: Number.isFinite(Number(q?.step)) && Number(q.step) > 0 ? Number(q.step) : 1,
          defaultValue: q?.defaultValue !== undefined ? q.defaultValue : null,
          unit: String(q?.unit || "").trim(),
          placeholder: String(q?.placeholder || "").trim(),
          onLabel: String(q?.onLabel || "Sim").trim(),
          offLabel: String(q?.offLabel || "Não").trim()
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
    const values = Array.isArray(raw) ? raw.filter(v => v !== "" && v !== null && v !== undefined) : raw !== undefined && raw !== null && raw !== "" ? [String(raw)] : [];
    if (!values.length) return;

    let display = values.join(", ");
    if (q.type === "slider" && q.unit) {
      display = `${values[0]}${q.unit}`;
    } else if (q.type === "rating") {
      display = `${values[0]}/${q.max || 5} ★`;
    }

    if (questions.length === 1) {
      lines.push(display);
    } else {
      lines.push(`${idx + 1}. ${q.prompt} → ${display}`);
    }
  });
  return lines.join("\n").trim();
}

export function isDestructiveAction(action) {
  const t = String(action?.type || "");
  return t === "delete_user" || t === "delete_task" || t === "delete_card" || t === "disconnect_cards";
}

export function proposalRequiresPermission(proposal) {
  if (!proposal || !Array.isArray(proposal.actions)) return false;
  return proposal.actions.some(action => isDestructiveAction(action));
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
    case "create_table_card": {
      const kind = action.hasCheckboxes ? "tabela Todo List" : "tabela";
      const rowCount = Array.isArray(action.rows) ? action.rows.length : 3;
      return `Criar card de ${kind} (${rowCount} linhas)`;
    }
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
    case "save_memory":
      return `Salvar memória do projeto: "${String(action.content || "").slice(0, 48)}"`;
    default:
      return `Executar ${action.type}`;
  }
}

export function shouldAutoCaptureScreen(promptText) {
  const text = String(promptText || "").trim();
  if (!text) return false;
  return /\b(tela|screen|print|screenshot|monitor|janela|window|aparecendo|mostrando|olh[ea]|vej[aa]|ver a tela|vendo|aqui na tela|na minha tela|on my screen|what is this|o que [eé] isso|este erro|esse erro|this error|este campo|esse campo|este bot[aã]o|esse bot[aã]o)\b/i.test(
    text
  );
}

export function promptReferencesCrossTask(userPrompt = "") {
  const text = String(userPrompt || "").trim();
  if (!text) return false;
  return /\b(outra task|outras tasks|todas as tasks|todos os projetos|todas as tarefas|outro usu[aá]rio|outros usu[aá]rios|outro user|outros users|todos os usu[aá]rios|para o user|para o usu[aá]rio|para a task|da task|na task|entre tasks|copi[ae] a task|mov[ae].*task|dupliqu[ae].*task|exclu[ia].*task|delet[ae].*task|abr[ae].*task|selecion[ae].*task|cri[ae].*nova task|cri[ae].*task|cri[ae].*usu[aá]rio|renome[ia].*usu[aá]rio|resumo geral|workspace inteiro)\b/i.test(
    text
  );
}

export function collectRelevantAppAttachments(state, userPrompt = "", selectedNodeId = null, maxItems = 4) {
  if (!state || !Array.isArray(state.users)) return [];
  const promptLower = String(userPrompt || "").trim().toLowerCase();
  const result = [];
  const seen = new Set();

  const pushRef = (userId, att) => {
    if (!userId || !att?.file || result.length >= maxItems) return;
    const key = `${userId}/${att.file}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      user_id: userId,
      file: att.file,
      name: att.name || att.file.split("/").pop() || "anexo",
      mime_type: att.type || att.mime || ""
    });
  };

  const mentionsAttachmentsOrCard = /\b(anexo|anexos|arquivo|arquivos|pdf|audio|áudio|video|vídeo|gravação|gravacao|gravações|gravacoes|reunião|reuniao|imagem|imagens|foto|fotos|planilha|documento|documentos|relatório|relatorio|csv|txt|attachment|attachments|file|files|recording|meeting|transcrev|analis[ae]|resum[ao]|esse card|este card|card selecionado)\b/i.test(promptLower);
  const allowCrossTask = promptReferencesCrossTask(promptLower);

  const activeUser = state.users.find(u => u.id === state.activeUserId);
  const activeTask = activeUser?.tasks?.find(t => t.id === activeUser.activeTaskId);

  // 1. Por padrao, busca anexos SOMENTE na task ativa (isolamento de contexto).
  // So busca em outras tasks/usuarios quando o usuario pedir explicitamente operacao cross-task.
  if (promptLower.length >= 4) {
    const searchUsers = allowCrossTask ? state.users : (activeUser ? [activeUser] : []);
    for (const u of searchUsers) {
      const searchTasks = allowCrossTask ? (u.tasks || []) : (activeTask ? [activeTask] : []);
      for (const t of searchTasks) {
        for (const a of t.attachments || []) {
          const nameLower = String(a?.name || "").toLowerCase().trim();
          const stemLower = nameLower.replace(/\.[^.]+$/, "");
          if (
            (nameLower.length >= 5 && promptLower.includes(nameLower)) ||
            (mentionsAttachmentsOrCard && stemLower.length >= 4 && promptLower.includes(stemLower))
          ) {
            pushRef(u.id, a);
          }
        }
      }
    }
  }

  // 2. Anexos referenciados no card selecionado atualmente (SOMENTE se o usuário pediu para analisar/ler o card ou mídia)
  if (activeUser && activeTask && selectedNodeId && mentionsAttachmentsOrCard) {
    const node = (activeTask.nodes || []).find(n => n.id === selectedNodeId);
    const body = String(node?.body ?? node?.title ?? "");
    for (const m of body.matchAll(/!\[(video|audio)\]\(([^)\n]+)\)/g)) {
      const ref = m[2].trim();
      const slash = ref.indexOf("/");
      if (slash > 0) {
        const refUser = ref.slice(0, slash);
        const refFile = ref.slice(slash + 1);
        const matched = (activeTask.attachments || []).find(a => a.file === refFile);
        pushRef(refUser, matched || { file: refFile, name: refFile.split("/").pop(), type: m[1] === "audio" ? "audio/mp4" : "video/mp4" });
      }
    }
    for (const m of body.matchAll(/@\[[^\]\r\n]+\]\(attachment:([^)]+)\)/g)) {
      const attId = m[1].trim();
      const matched = (activeTask.attachments || []).find(a => a.id === attId);
      if (matched) pushRef(activeUser.id, matched);
    }
  }

  // 3. Se o usuario perguntar de forma geral sobre anexos/arquivos/midia, inclui o mais recente da task ativa
  if (activeUser && activeTask && mentionsAttachmentsOrCard && result.length === 0) {
    const sorted = [...(activeTask.attachments || [])].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (sorted[0]) {
      pushRef(activeUser.id, sorted[0]);
    }
  }

  return result;
}

export function promptNeedsWorkspaceContext(userPrompt = "") {
  const text = String(userPrompt || "").trim();
  if (!text) return false;
  return /\b(card|cards|bloco|blocos|task|tasks|tarefa|tarefas|projeto|projetos|user|users|usu[aá]rio|usu[aá]rios|cliente|clientes|canva|canvas|quadro|mapa|fluxo|fluxograma|diagrama|flowchart|repliqu[ea]|replicar|mont[ea]|desenh[ea]|tabela|tabelas|checklist|todo|cri[ea]|adicion[ea]|insir[ao]|coloc[ao]|edit[ea]|atualiz[ea]|alter[ea]|mud[ea]|exclu[ia]|delet[ea]|remov[ea]|apag[ue]|conect[ea]|ligu[ea]|desconect[ea]|organiz[ea]|centraliz[ea]|foqu[ea]|mostr[ea]|indiqu[ea]|navegu[ea]|duplic|inconsist|atrasad|prazo|status|prioridade|criticidade|anexo|anexos|arquivo|arquivos|mem[oó]ria|lembr[ea]|configura|settings|tema|fonte|filtro|tradutor|resum[ao] d[oa]|o que tem|quais s[aã]o)\b/i.test(
    text
  );
}

export function buildAppContextSnapshot(state, extras = {}) {
  const operatorProfile = String(extras.operatorProfile || "").trim().slice(0, 100);
  if (!state || !Array.isArray(state.users)) {
    return JSON.stringify({
      operatorProfile: operatorProfile || undefined,
      users: []
    });
  }

  const promptLower = String(extras.userPrompt || "").trim().toLowerCase();
  const needsWorkspace = extras.forceFullContext || promptNeedsWorkspaceContext(promptLower);

  // Modo ultra-enxuto (~60 tokens) para mensagens simples/conversacionais ou consultas externas (ex: "teste", "oi", "valor do dólar")
  if (!needsWorkspace && extras.compactOnlyActive) {
    const activeUser = state.users.find(u => u.id === state.activeUserId);
    const activeTask = activeUser?.tasks?.find(t => t.id === activeUser?.activeTaskId);
    const selectedNode = activeTask && extras.selectedNodeId
      ? (activeTask.nodes || []).find(n => n.id === extras.selectedNodeId)
      : null;
    const minimal = {
      mode: "minimal",
      activeUser: activeUser ? { id: activeUser.id, name: activeUser.name } : null,
      activeTask: activeTask
        ? { id: activeTask.id, title: activeTask.title, status: activeTask.status || "ongoing", cardsCount: (activeTask.nodes || []).length }
        : null
    };
    if (selectedNode) {
      minimal.selectedCard = {
        id: selectedNode.id,
        body: String(selectedNode.body ?? selectedNode.title ?? "").slice(0, 140)
      };
    }
    if (operatorProfile) {
      minimal.operatorProfile = operatorProfile;
    }
    return JSON.stringify(minimal);
  }

  const wantsCrossTask =
    !extras.compactOnlyActive ||
    promptReferencesCrossTask(promptLower);

  const wantsAllTasksDetails =
    !extras.compactOnlyActive ||
    /\b(todas as tasks|todos os cards|all tasks|all cards|resumo geral|todas as tarefas)\b/i.test(promptLower);

  const visibleUsers = wantsCrossTask
    ? state.users
    : state.users.filter(u => u.id === state.activeUserId);

  const users = visibleUsers.map(u => {
    const isUserActive = u.id === state.activeUserId;
    const visibleTasks = wantsCrossTask
      ? (u.tasks || [])
      : (u.tasks || []).filter(t => isUserActive && t.id === u.activeTaskId);
    return {
      id: u.id,
      name: u.name,
      isActive: isUserActive,
      tasks: visibleTasks.map(t => {
        const isTaskActive = isUserActive && t.id === u.activeTaskId;
        const titleLower = String(t.title || "").toLowerCase();
        const isTaskMentioned =
          wantsCrossTask && promptLower.length >= 3 && titleLower.length >= 3 && promptLower.includes(titleLower);
        const includeFullNodes = isTaskActive || isTaskMentioned || wantsAllTasksDetails;

        if (!includeFullNodes) {
          return {
            id: t.id,
            title: t.title,
            status: t.status || "ongoing",
            cardsCount: (t.nodes || []).length
          };
        }

        const bodyLimit = extras.compactOnlyActive ? 160 : 360;
        const allNodes = t.nodes || [];
        const slicedNodes = allNodes.length > 30
          ? [allNodes[0], ...allNodes.slice(-29)]
          : allNodes;
        return {
          id: t.id,
          number: t.number || null,
          title: t.title,
          status: t.status || "ongoing",
          priority: t.priority || "normal",
          criticality: t.criticality ?? 0,
          startDate: t.startDate || undefined,
          endDate: t.endDate || undefined,
          isActive: isTaskActive,
          nodes: slicedNodes.map((n, idx) => {
            const rawBody = String(n.body ?? n.title ?? "");
            const tableMatch = rawBody.match(/\[\[table:([A-Za-z0-9_-]+)\]\]/);
            const isSelected = extras.selectedNodeId && n.id === extras.selectedNodeId;
            const maxChars = isSelected ? 480 : bodyLimit;
            const nodeSnap = {
              id: n.id,
              isRoot: idx === 0 || undefined,
              type: n.type && n.type !== "action" ? n.type : undefined,
              status: n.status && n.status !== "ongoing" ? n.status : undefined,
              body: rawBody.replace(/\[\[table:[A-Za-z0-9_-]+\]\]/g, "[tabela]").slice(0, maxChars)
            };
            if (tableMatch) {
              const decoded = decodeTableData(tableMatch[1]);
              nodeSnap.table = {
                hasCheckboxes: Boolean(decoded.hasCheckboxes),
                rows: Array.isArray(decoded.rows) ? decoded.rows.slice(0, 15) : []
              };
            }
            return nodeSnap;
          }),
          links: (t.links || []).slice(0, 40).map(l => {
            const linkSnap = { from: l.from, to: l.to };
            if (l.fromRow != null) linkSnap.fromRow = l.fromRow;
            if (l.toRow != null) linkSnap.toRow = l.toRow;
            return linkSnap;
          })
        };
      })
    };
  });

  const payload = {
    activeUserId: state.activeUserId || null,
    selectedNodeId: extras.selectedNodeId || null,
    settings: extras.settings || {},
    users
  };
  if (operatorProfile) {
    payload.operatorProfile = operatorProfile;
  }
  return JSON.stringify(payload);
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
  const refIdToCreatorIdx = new Map();

  list.forEach((action, idx) => {
    if (!action || typeof action.type !== "string") return;
    const needed = new Set();

    if (actionReferencesPlaceholder(action, "$LAST_TASK") && lastTaskCreatorIdx >= 0) {
      needed.add(lastTaskCreatorIdx);
    }
    if (actionReferencesPlaceholder(action, "$LAST_CARD") && lastCardCreatorIdx >= 0) {
      needed.add(lastCardCreatorIdx);
    }
    ["parentCardId", "fromCardId", "toCardId", "cardId"].forEach(field => {
      const val = action[field];
      if (typeof val === "string" && refIdToCreatorIdx.has(val)) {
        needed.add(refIdToCreatorIdx.get(val));
      }
    });

    // Acoes sem taskId/taskTitle explicito apos um create_task aguardam a task ser criada
    if (
      lastTaskCreatorIdx >= 0 &&
      !action.taskId &&
      !action.taskTitle &&
      (action.type === "create_card" ||
        action.type === "create_table_card" ||
        action.type === "connect_cards" ||
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
    } else if (action.type === "create_card" || action.type === "create_table_card") {
      lastCardCreatorIdx = idx;
      createdTaskOrCardIndices.push(idx);
      if (typeof action.refId === "string" && action.refId.trim()) {
        refIdToCreatorIdx.set(action.refId.trim(), idx);
      }
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
  const cardRefs = new Map();

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
        const ctx = { lastCreatedCardId, lastCreatedTaskId, cardRefs };
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
