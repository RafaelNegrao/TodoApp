import test from "node:test";
import assert from "node:assert/strict";

import {
  MODULE_IDS,
  estimateTextTokens,
  PromptModuleRegistry,
  ConversationContextManager,
  TokenBudgetManager,
  TokenMetricsMonitor
} from "../src/intelligence/tokenOptimizer.js";
import { WorkspaceContextService } from "../src/intelligence/contextService.js";
import {
  buildAppContextSnapshot,
  collectRelevantAppAttachments,
  executeAiActionPlan
} from "../src/aiAppAgent.js";

const LEGACY_MONOLITHIC_PROMPT_CHARS = 6750; // Prompt monolitico anterior (~1776 tokens)

function buildRichWorkspaceState() {
  const makeNodes = (prefix, count) => {
    const list = [{ id: `${prefix}-root`, title: `Projeto ${prefix}`, body: "" }];
    for (let i = 1; i <= count; i += 1) {
      list.push({
        id: `${prefix}-card-${i}`,
        title: "",
        status: i % 3 === 0 ? "complete" : "ongoing",
        body: `Card ${i} da task ${prefix}: implementar endpoint REST, validar payload JSON, configurar cache local e revisar logs de auditoria detalhados.`
      });
    }
    return list;
  };

  const makeLinks = (prefix, count) => {
    const links = [];
    for (let i = 1; i < count; i += 1) {
      links.push({ from: `${prefix}-card-${i}`, to: `${prefix}-card-${i + 1}` });
    }
    return links;
  };

  return {
    activeUserId: "u1",
    users: [
      {
        id: "u1",
        name: "Cliente Alpha",
        activeTaskId: "t1",
        tasks: [
          {
            id: "t1",
            number: 1,
            title: "Arquitetura Backend",
            status: "ongoing",
            priority: "high",
            startDate: "2026-11-01",
            endDate: "2026-12-15",
            attachments: [
              { id: "att-t1", name: "especificacao-api.pdf", file: "u1/spec.pdf", type: "application/pdf" }
            ],
            nodes: makeNodes("t1", 22),
            links: makeLinks("t1", 22)
          },
          {
            id: "t2",
            number: 2,
            title: "Campanha Marketing Secreta",
            status: "ongoing",
            priority: "urgent",
            attachments: [
              { id: "att-t2", name: "orcamento-confidencial.pdf", file: "u1/secret.pdf", type: "application/pdf" }
            ],
            nodes: makeNodes("t2", 18),
            links: makeLinks("t2", 18)
          }
        ]
      },
      {
        id: "u2",
        name: "Cliente Beta",
        activeTaskId: "t3",
        tasks: [
          {
            id: "t3",
            number: 1,
            title: "Portal Financeiro",
            status: "ongoing",
            nodes: makeNodes("t3", 15),
            links: makeLinks("t3", 15)
          }
        ]
      }
    ]
  };
}

function estimateLegacyInputTokens(state, messages) {
  const legacyPromptTokens = Math.ceil(LEGACY_MONOLITHIC_PROMPT_CHARS / 3.8);
  const legacyFullState = buildAppContextSnapshot(state, {
    forceFullContext: true,
    compactOnlyActive: false,
    settings: { theme: "claude-dark", cardFontSize: 14, linkStyle: "orthogonal", linkArrows: true, translatorMode: "manual" }
  });
  const legacyStateTokens = estimateTextTokens(legacyFullState);
  const legacyHistoryTokens = messages.reduce((sum, m) => sum + estimateTextTokens(m.text), 0);
  return legacyPromptTokens + legacyStateTokens + legacyHistoryTokens;
}

test("Scenario 1: Simple interaction ('Oi') loads only Core module and minimal LIVE APP STATE", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();
  const convMgr = new ConversationContextManager();
  const budgetMgr = new TokenBudgetManager();

  const messages = [{ role: "user", text: "Oi" }];
  const conv = convMgr.buildOptimizedConversationPayload(messages, "Oi");
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: "Oi" });
  const parsedCtx = JSON.parse(ctxJson);

  assert.equal(parsedCtx.mode, "minimal");
  assert.deepEqual(parsedCtx.activeModules, [MODULE_IDS.CORE]);

  const composed = registry.composeSystemPrompt({
    modules: parsedCtx.activeModules,
    appContextJson: ctxJson
  });
  const budgeted = budgetMgr.enforceBudget({
    systemCoreTokens: composed.coreTokensEstimate,
    dynamicInstructionTokens: composed.dynamicTokensEstimate,
    appContextObj: parsedCtx,
    payloadMessages: conv.payloadMessages,
    summaryText: conv.summaryText
  });

  assert.equal(budgeted.breakdown.dynamicInstructionTokens, 0);
  assert.ok(budgeted.breakdown.estimatedInputTokens < 160, `Expected < 160 tokens, got ${budgeted.breakdown.estimatedInputTokens}`);
});

test("Scenario 2: Normal conversation (10 messages) preserves recent window and summarizes older turns", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();
  const convMgr = new ConversationContextManager({ recentWindowSize: 6 });
  const budgetMgr = new TokenBudgetManager();

  const messages = [];
  for (let i = 1; i <= 5; i += 1) {
    messages.push({ role: "user", text: `Mensagem do usuário número ${i}: precisamos definir o padrão de autenticação JWT e a porta 8080.` });
    messages.push({
      role: "model",
      text: `Confirmado no turno ${i}: padrão JWT configurado na porta 8080 com refresh token.`,
      proposal: i === 2 ? { summary: "Criar card de configuração JWT" } : null
    });
  }

  const prompt = "Qual próximo passo da autenticação?";
  const conv = convMgr.buildOptimizedConversationPayload(messages, prompt);
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: prompt });
  const parsedCtx = JSON.parse(ctxJson);
  const composed = registry.composeSystemPrompt({ modules: parsedCtx.activeModules, appContextJson: ctxJson });
  const budgeted = budgetMgr.enforceBudget({
    systemCoreTokens: composed.coreTokensEstimate,
    dynamicInstructionTokens: composed.dynamicTokensEstimate,
    appContextObj: parsedCtx,
    payloadMessages: conv.payloadMessages,
    summaryText: conv.summaryText
  });

  // Original messages untouched
  assert.equal(messages.length, 10);
  // Summary generated for the 4 older messages
  assert.ok(conv.summaryText.includes("Resumo de 4 mensagens anteriores"));
  assert.ok(conv.summaryText.includes("Criar card de configuração JWT"));

  const legacyTokens = estimateLegacyInputTokens(state, messages);
  const optimizedTokens = budgeted.breakdown.estimatedInputTokens;
  assert.ok(optimizedTokens < legacyTokens * 0.35, `Expected >65% savings: legacy=${legacyTokens}, opt=${optimizedTokens}`);
});

test("Scenario 3 & 6: Long conversation (50 messages) + Context retrieval from early conversation without mutating history", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();
  const convMgr = new ConversationContextManager({ recentWindowSize: 6 });
  const budgetMgr = new TokenBudgetManager();

  const messages = [];
  for (let i = 1; i <= 24; i += 1) {
    if (i === 2) {
      messages.push({
        role: "user",
        text: "Decidimos que o banco oficial de telemetria será ClickHouse rodando no cluster alpha-9942 com retenção de 90 dias."
      });
      messages.push({
        role: "model",
        text: "Registrado: ClickHouse no cluster alpha-9942 com retenção de 90 dias.",
        proposal: { summary: "Definir ClickHouse alpha-9942 como banco de telemetria" }
      });
    } else {
      messages.push({
        role: "user",
        text: `Discussão da etapa ${i}: revisando layout dos componentes visuais e responsividade das colunas.`
      });
      messages.push({
        role: "model",
        text: `Etapa ${i} concluída com ajustes aplicados no layout.`
      });
    }
  }
  const userQuery = "Qual era mesmo o nome do cluster ClickHouse e o prazo de retenção que decidimos lá no começo?";
  messages.push({ role: "user", text: userQuery });
  messages.push({ role: "model", text: "Verificando..." });

  assert.equal(messages.length, 50);

  const conv = convMgr.buildOptimizedConversationPayload(messages, userQuery);
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: userQuery });
  const parsedCtx = JSON.parse(ctxJson);
  const composed = registry.composeSystemPrompt({ modules: parsedCtx.activeModules, appContextJson: ctxJson });
  const budgeted = budgetMgr.enforceBudget({
    systemCoreTokens: composed.coreTokensEstimate,
    dynamicInstructionTokens: composed.dynamicTokensEstimate,
    appContextObj: parsedCtx,
    payloadMessages: conv.payloadMessages,
    summaryText: conv.summaryText
  });

  // 1. Original 50 messages remain 100% intact
  assert.equal(messages.length, 50);
  // 2. Older message #3 about ClickHouse alpha-9942 was retrieved on-demand!
  assert.ok(conv.summaryText.includes("alpha-9942"), "Expected retrieved snippet to contain cluster alpha-9942");
  assert.ok(conv.summaryText.includes("90 dias"), "Expected retrieved snippet to contain 90 dias");

  const legacyTokens = estimateLegacyInputTokens(state, messages);
  const optimizedTokens = budgeted.breakdown.estimatedInputTokens;
  assert.ok(optimizedTokens < legacyTokens * 0.30, `Expected >70% savings on 50-msg chat: legacy=${legacyTokens}, opt=${optimizedTokens}`);
});

test("Scenario 4: Complex operation (create a task with multiple cards) loads Core + Tasks + Canvas modules and executes cleanly", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();

  const prompt = "Crie uma nova task chamada 'Sprint de Segurança' com prioridade alta e adicione 3 cards com checklist de auditoria.";
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: prompt });
  const parsedCtx = JSON.parse(ctxJson);

  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.CORE));
  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.TASKS));
  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.CANVAS));
  // Does NOT load unrelated modules like Settings or Tables
  assert.equal(parsedCtx.activeModules.includes(MODULE_IDS.SETTINGS), false);
  assert.equal(parsedCtx.activeModules.includes(MODULE_IDS.TABLES), false);

  const composed = registry.composeSystemPrompt({
    modules: parsedCtx.activeModules,
    appContextJson: ctxJson
  });
  assert.ok(composed.systemPrompt.includes("\"type\":\"create_task\""));
  assert.ok(composed.systemPrompt.includes("\"type\":\"create_card\""));
  assert.ok(composed.systemPrompt.includes("[[APP_ACTIONS]]"));

  // Verify execution plan still chains create_task -> multiple create_card actions accurately
  const executed = [];
  const planResult = await executeAiActionPlan(
    [
      { type: "create_task", title: "Sprint de Segurança", priority: "high" },
      { type: "create_card", body: "[ ] Revisar tokens" },
      { type: "create_card", body: "[ ] Auditar permissões" },
      { type: "create_card", body: "[ ] Testar rate limit" }
    ],
    {
      async runAction(action, ctx) {
        executed.push({ type: action.type, taskId: ctx.lastCreatedTaskId });
        if (action.type === "create_task") return { createdTaskId: "task-sec-1" };
        return { createdCardId: `card-${executed.length}` };
      }
    }
  );
  assert.equal(planResult.length, 4);
  assert.ok(planResult.every(r => r.ok));
  assert.equal(executed[1].taskId, "task-sec-1");
  assert.equal(executed[3].taskId, "task-sec-1");
});

test("Scenario 5: Complex flowchart (multiple branches and 2D connections) loads Core + Canvas + Flowcharts and resolves 2D refIds", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();

  const prompt = "Monte um fluxograma 2D com ramificações de aprovação (Pass/Fail) e conecte os cards nas portas top, bottom, in e out.";
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: prompt });
  const parsedCtx = JSON.parse(ctxJson);

  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.CORE));
  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.CANVAS));
  assert.ok(parsedCtx.activeModules.includes(MODULE_IDS.FLOWCHARTS));

  const composed = registry.composeSystemPrompt({
    modules: parsedCtx.activeModules,
    appContextJson: ctxJson
  });
  assert.ok(composed.systemPrompt.includes("gridCol"));
  assert.ok(composed.systemPrompt.includes("connect_cards"));

  const createdLinks = [];
  const planResult = await executeAiActionPlan(
    [
      { type: "create_card", refId: "start", body: "Início", gridCol: 0, gridRow: 1, connectParent: false },
      { type: "create_card", refId: "pass", body: "Aprovado", gridCol: 1, gridRow: 0, connectParent: false },
      { type: "create_card", refId: "fail", body: "Reprovado", gridCol: 1, gridRow: 2, connectParent: false },
      { type: "connect_cards", fromCardId: "start", toCardId: "pass", fromPort: "top", toPort: "in" },
      { type: "connect_cards", fromCardId: "start", toCardId: "fail", fromPort: "bottom", toPort: "in" }
    ],
    {
      async runAction(action, ctx) {
        if (action.type === "create_card") {
          const realId = `real-${action.refId}`;
          ctx.cardRefs.set(action.refId, realId);
          return { createdCardId: realId };
        }
        if (action.type === "connect_cards") {
          createdLinks.push({
            from: ctx.cardRefs.get(action.fromCardId),
            to: ctx.cardRefs.get(action.toCardId),
            fromPort: action.fromPort,
            toPort: action.toPort
          });
          return { message: "Conectado" };
        }
        return {};
      }
    }
  );

  assert.equal(planResult.length, 5);
  assert.equal(createdLinks.length, 2);
  assert.deepEqual(createdLinks[0], { from: "real-start", to: "real-pass", fromPort: "top", toPort: "in" });
  assert.deepEqual(createdLinks[1], { from: "real-start", to: "real-fail", fromPort: "bottom", toPort: "in" });
});

test("Scenario 7: Cross-task isolation strictly prevents leaking cards or attachments from unrelated tasks", async () => {
  const state = buildRichWorkspaceState();
  const ctxSvc = new WorkspaceContextService();

  const prompt = "Resuma os cards e anexos desta minha task atual e crie um card de conclusão.";
  const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: prompt });
  const parsed = JSON.parse(ctxJson);

  // Only active user u1 and active task t1 are present
  assert.equal(parsed.users.length, 1);
  assert.equal(parsed.users[0].id, "u1");
  assert.equal(parsed.users[0].tasks.length, 1);
  assert.equal(parsed.users[0].tasks[0].id, "t1");
  assert.equal(ctxJson.includes("Campanha Marketing Secreta"), false);
  assert.equal(ctxJson.includes("orcamento-confidencial.pdf"), false);
  assert.equal(ctxJson.includes("Portal Financeiro"), false);

  const atts = collectRelevantAppAttachments(state, "analise o anexo pdf", null, 4);
  assert.equal(atts.length, 1);
  assert.equal(atts[0].name, "especificacao-api.pdf");
});

test("TokenMetricsMonitor reconciles actual Gemini API usageMetadata and calculates session averages and costs", () => {
  const reconciled = TokenMetricsMonitor.reconcileWithActualUsage(
    {
      systemPromptTokens: 110,
      dynamicInstructionTokens: 90,
      liveAppStateTokens: 300,
      conversationHistoryTokens: 120,
      summaryTokens: 60,
      userInputTokens: 20,
      estimatedInputTokens: 700
    },
    770,
    140,
    "gemini-2.5-flash"
  );

  assert.equal(reconciled.inputTokens, 770);
  assert.equal(reconciled.outputTokens, 140);
  assert.equal(reconciled.totalTokens, 910);
  const sumInputComponents =
    reconciled.components.systemPromptTokens +
    reconciled.components.dynamicInstructionTokens +
    reconciled.components.liveAppStateTokens +
    reconciled.components.conversationHistoryTokens +
    reconciled.components.summaryTokens +
    reconciled.components.userInputTokens;
  assert.equal(sumInputComponents, 770);
  assert.ok(reconciled.estimatedCostUsd > 0);

  const sessionStats = TokenMetricsMonitor.computeSessionMetrics([
    { role: "user", text: "Oi" },
    { role: "model", text: "Olá!", model: "gemini-2.5-flash", promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    { role: "user", text: "Crie um card" },
    { role: "model", text: "Criado!", model: "gemini-2.5-flash", promptTokens: 500, completionTokens: 80, totalTokens: 580 }
  ]);
  assert.equal(sessionStats.requestCount, 2);
  assert.equal(sessionStats.totalTokens, 700);
  assert.equal(sessionStats.averageTokensPerRequest, 350);
});

test("Benchmark Report: Before vs. After Token Consumption across all 7 mandatory scenarios", async () => {
  const state = buildRichWorkspaceState();
  const registry = new PromptModuleRegistry();
  const ctxSvc = new WorkspaceContextService();
  const convMgr = new ConversationContextManager({ recentWindowSize: 6 });
  const budgetMgr = new TokenBudgetManager();

  const runScenario = async (name, messages, prompt) => {
    const legacy = estimateLegacyInputTokens(state, messages);
    const conv = convMgr.buildOptimizedConversationPayload(messages, prompt);
    const ctxJson = await ctxSvc.buildEnrichedContextJson(state, { userPrompt: prompt });
    const parsedCtx = JSON.parse(ctxJson);
    const composed = registry.composeSystemPrompt({ modules: parsedCtx.activeModules, appContextJson: ctxJson });
    const budgeted = budgetMgr.enforceBudget({
      systemCoreTokens: composed.coreTokensEstimate,
      dynamicInstructionTokens: composed.dynamicTokensEstimate,
      appContextObj: parsedCtx,
      payloadMessages: conv.payloadMessages,
      summaryText: conv.summaryText
    });
    const opt = budgeted.breakdown.estimatedInputTokens;
    const savedPct = (((legacy - opt) / legacy) * 100).toFixed(1);
    return { name, legacy, opt, savedPct, modules: parsedCtx.activeModules.join("+"), breakdown: budgeted.breakdown };
  };

  const msgs10 = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "model",
    text: `Turno ${i + 1}: discutindo requisitos de autenticação JWT e cache Redis para a API.`
  }));
  const msgs50 = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "model",
    text: i === 2
      ? "Decidimos usar ClickHouse no cluster alpha-9942 com retenção de 90 dias."
      : `Turno ${i + 1}: ajustando detalhes de interface, cards do fluxo e testes automatizados.`
  }));

  const rows = [
    await runScenario("1. Simple ('Oi')", [{ role: "user", text: "Oi" }], "Oi"),
    await runScenario("2. Normal (10 msgs)", msgs10, "Qual próximo passo da autenticação?"),
    await runScenario("3. Long (50 msgs)", msgs50, "Como estão os ajustes de interface?"),
    await runScenario("4. Complex task+cards", [{ role: "user", text: "Crie uma nova task 'Sprint 9' com 3 cards de checklist" }], "Crie uma nova task 'Sprint 9' com 3 cards de checklist"),
    await runScenario("5. Complex 2D flowchart", [{ role: "user", text: "Monte um fluxograma 2D com ramificações e conecte os cards" }], "Monte um fluxograma 2D com ramificações e conecte os cards"),
    await runScenario("6. Context retrieval (50 msgs)", msgs50, "Qual era o cluster ClickHouse e prazo de retenção que decidimos?"),
    await runScenario("7. Cross-task isolation", [{ role: "user", text: "Resuma os cards da minha task atual" }], "Resuma os cards da minha task atual")
  ];

  for (const r of rows) {
    console.log(`[BENCHMARK] ${r.name.padEnd(30)} | Legacy: ${String(r.legacy).padStart(5)} tok | Optimized: ${String(r.opt).padStart(4)} tok | Saved: ${r.savedPct}% | Modules: ${r.modules}`);
    assert.ok(r.opt < r.legacy);
  }
});
