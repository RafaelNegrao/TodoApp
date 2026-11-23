import test from "node:test";
import assert from "node:assert/strict";
import {
  extractAiActionProposal,
  extractAiQuestions,
  formatQuestionAnswersMessage,
  isDestructiveAction,
  describeAiAction,
  buildAppContextSnapshot,
  executeAiActionPlan
} from "../src/aiAppAgent.js";

test("extractAiActionProposal separa texto da resposta e JSON de acoes", () => {
  const reply = `Posso criar a task e o card para você.\n\n[[APP_ACTIONS]]\n{\n  "summary": "Criar task e card",\n  "actions": [\n    { "type": "create_task", "title": "Deploy v2", "userName": "Rafael" },\n    { "type": "create_card", "body": "Rodar testes" }\n  ]\n}\n[[/APP_ACTIONS]]`;
  const { cleanText, proposal } = extractAiActionProposal(reply);
  assert.equal(cleanText, "Posso criar a task e o card para você.");
  assert.ok(proposal);
  assert.equal(proposal.summary, "Criar task e card");
  assert.equal(proposal.actions.length, 2);
  assert.equal(proposal.status, "pending");
});

test("extractAiActionProposal retorna proposal null quando nao ha bloco de acoes", () => {
  const { cleanText, proposal } = extractAiActionProposal("Apenas uma resposta normal.");
  assert.equal(cleanText, "Apenas uma resposta normal.");
  assert.equal(proposal, null);
});

test("isDestructiveAction e describeAiAction identificam corretamente operacoes", () => {
  assert.equal(isDestructiveAction({ type: "delete_task" }), true);
  assert.equal(isDestructiveAction({ type: "delete_card" }), true);
  assert.equal(isDestructiveAction({ type: "create_card" }), false);
  assert.match(describeAiAction({ type: "create_task", title: "Sprint", userName: "Ana" }), /Sprint.*Ana/);
  assert.match(describeAiAction({ type: "copy_card_to_task", sourceCardId: "c1", targetTaskTitle: "Task Z" }), /Task Z/);
  assert.match(describeAiAction({ type: "move_card_to_task", sourceCardId: "c1", targetTaskTitle: "Task Z" }), /Task Z/);
});

test("buildAppContextSnapshot serializa usuarios, tasks e cards ativos", () => {
  const state = {
    activeUserId: "u1",
    users: [
      {
        id: "u1",
        name: "Rafael",
        activeTaskId: "t1",
        tasks: [
          {
            id: "t1",
            number: 1,
            title: "Minha Task",
            status: "ongoing",
            nodes: [
              { id: "n0", body: "Raiz", status: "ongoing" },
              { id: "n1", body: "Acao 1", status: "complete" }
            ],
            links: [{ from: "n0", to: "n1" }]
          }
        ]
      }
    ]
  };
  const snap = JSON.parse(buildAppContextSnapshot(state, { selectedNodeId: "n1" }));
  assert.equal(snap.activeUserId, "u1");
  assert.equal(snap.selectedNodeId, "n1");
  assert.equal(snap.users[0].tasks[0].nodes.length, 2);
  assert.equal(snap.users[0].tasks[0].nodes[1].body, "Acao 1");
});

test("executeAiActionPlan executa acoes em sequencia propagando IDs criados", async () => {
  const log = [];
  const results = await executeAiActionPlan(
    [
      { type: "create_task", title: "Nova" },
      { type: "create_card", body: "Item 1" },
      { type: "focus_card", cardId: "$LAST_CARD" }
    ],
    {
      async runAction(action, ctx) {
        log.push({ type: action.type, lastCard: ctx.lastCreatedCardId, lastTask: ctx.lastCreatedTaskId });
        if (action.type === "create_task") return { createdTaskId: "task-99", message: "Task criada" };
        if (action.type === "create_card") return { createdCardId: "card-42", message: "Card criado" };
        return { message: `Focado ${ctx.lastCreatedCardId}` };
      }
    }
  );
  assert.equal(results.length, 3);
  assert.ok(results.every(r => r.ok));
  assert.equal(log[1].lastTask, "task-99");
  assert.equal(log[2].lastCard, "card-42");
});

test("extractAiQuestions extrai bloco interativo e normaliza opcoes", () => {
  const reply = `Encontrei mais de uma task parecida.\n\n[[APP_QUESTIONS]]\n{\n  "questions": [\n    {\n      "id": "q1",\n      "prompt": "Para qual task copiar o card?",\n      "multiSelect": false,\n      "options": [\n        { "label": "Main task 3", "value": "Main task 3", "description": "Em andamento" },\n        "Criar app Tauri todo"\n      ]\n    }\n  ]\n}\n[[/APP_QUESTIONS]]`;
  const { cleanText, questionSet } = extractAiQuestions(reply);
  assert.equal(cleanText, "Encontrei mais de uma task parecida.");
  assert.ok(questionSet);
  assert.equal(questionSet.status, "pending");
  assert.equal(questionSet.questions.length, 1);
  assert.equal(questionSet.questions[0].options.length, 2);
  assert.equal(questionSet.questions[0].options[1].label, "Criar app Tauri todo");
});

test("formatQuestionAnswersMessage formata selecao unica e multiplas perguntas", () => {
  const singleSet = {
    questions: [{ id: "q1", prompt: "Qual task?", multiSelect: false, options: [] }]
  };
  assert.equal(formatQuestionAnswersMessage(singleSet, { q1: ["Main task 3"] }), "Main task 3");

  const multiSet = {
    questions: [
      { id: "q1", prompt: "Quais tasks apagar?", multiSelect: true, options: [] },
      { id: "q2", prompt: "Manter backup?", multiSelect: false, options: [] }
    ]
  };
  assert.equal(
    formatQuestionAnswersMessage(multiSet, { q1: ["Task A", "Task B"], q2: ["Sim"] }),
    "1. Quais tasks apagar? → Task A, Task B\n2. Manter backup? → Sim"
  );
});

test("executeAiActionPlan executa acoes independentes de forma assincrona e emite onStepUpdate", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const events = [];

  const results = await executeAiActionPlan(
    [
      { type: "copy_text", text: "A" },
      { type: "set_status_filter", filter: "ongoing" },
      { type: "open_settings" }
    ],
    {
      onStepUpdate: ev => events.push(`${ev.index}:${ev.status}`),
      runAction: async action => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(resolve => setTimeout(resolve, 18));
        concurrent -= 1;
        return { message: `OK ${action.type}` };
      }
    }
  );

  assert.equal(results.length, 3);
  assert.ok(results.every(r => r.ok));
  assert.ok(maxConcurrent >= 2, `Esperava execucao concorrente, maxConcurrent=${maxConcurrent}`);
  assert.ok(events.includes("0:in_progress"));
  assert.ok(events.includes("1:in_progress"));
  assert.ok(events.includes("2:done"));
});
