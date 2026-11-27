import test from "node:test";
import assert from "node:assert/strict";

import { extractAiActionProposal } from "../src/aiAppAgent.js";
import { auditWorkspaceConsistency, WorkspaceContextService } from "../src/intelligence/contextService.js";
import { WorkspaceUndoStack, buildActionPreviewDiffs } from "../src/intelligence/actionPreviewUndo.js";
import { PersistenceService } from "../src/intelligence/persistenceService.js";
import {
  normalizeReminder,
  isReminderDue,
  advanceReminderOccurrence,
  TaskReminderService
} from "../src/intelligence/reminderService.js";

function makeSampleState() {
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
            title: "Migração SQLite",
            status: "ongoing",
            priority: "high",
            startDate: "2026-01-10",
            endDate: "2026-01-20",
            nodes: [
              { id: "root-1", title: "Migração SQLite", body: "" },
              {
                id: "card-1",
                title: "",
                body: "Configurar banco de dados sqlite com modo WAL e migrações automáticas",
                status: "ongoing"
              },
              {
                id: "card-2",
                title: "",
                body: "Configurar banco de dados sqlite com modo WAL e migrações automáticas",
                status: "ongoing"
              }
            ],
            links: [{ from: "root-1", to: "card-1" }]
          },
          {
            id: "t2",
            title: "Release Mobile",
            status: "complete",
            priority: "normal",
            startDate: "2026-02-20",
            endDate: "2026-02-10",
            nodes: [
              { id: "root-2", title: "Release Mobile", body: "" },
              { id: "card-3", title: "", body: "Publicar build na loja de aplicativos", status: "ongoing" }
            ],
            links: []
          }
        ]
      }
    ]
  };
}

test("extractAiActionProposal handles standard tags, single-bracket close, fences and truncated JSON", () => {
  const std = `Pronto!\n[[APP_ACTIONS]]\n{"summary":"Criar card","actions":[{"type":"create_card","body":"Oi"}]}\n[[/APP_ACTIONS]]`;
  const r1 = extractAiActionProposal(std);
  assert.equal(r1.cleanText, "Pronto!");
  assert.equal(r1.proposal?.actions.length, 1);

  const singleBracket = `Feito.\n[[APP_ACTIONS]]\n\`\`\`json\n{"summary":"Focar","actions":[{"type":"focus_card","cardId":"c1"}]}\n\`\`\`\n[/APP_ACTIONS]`;
  const r2 = extractAiActionProposal(singleBracket);
  assert.equal(r2.cleanText, "Feito.");
  assert.equal(r2.proposal?.actions[0].cardId, "c1");

  const truncated = `Criando...\n[[APP_ACTIONS]]\n{"summary":"Truncado","actions":[{"type":"create_card","body":"abc"`;
  const r3 = extractAiActionProposal(truncated);
  assert.equal(r3.proposal?.actions.length, 1);
  assert.equal(r3.proposal?.actions[0].body, "abc");
});

test("auditWorkspaceConsistency detects duplicates, overdue tasks, invalid date ranges and open cards on completed tasks", () => {
  const state = makeSampleState();
  const audit = auditWorkspaceConsistency(state, { todayIso: "2026-03-01" });

  assert.equal(audit.duplicates.length, 1);
  assert.equal(audit.duplicates[0].first.cardId, "card-1");
  assert.equal(audit.duplicates[0].second.cardId, "card-2");

  const types = new Set(audit.inconsistencies.map(i => i.type));
  assert.ok(types.has("overdue_task"));
  assert.ok(types.has("invalid_date_range"));
  assert.ok(types.has("completed_task_with_open_cards"));
});

test("WorkspaceContextService injects memories, past chats, audit and respects custom scope", async () => {
  const state = makeSampleState();
  const fakePersistence = {
    async listProjectMemories() {
      return [{ id: "m1", scope_key: "t1", kind: "decision", content: "Usar rusqlite bundled" }];
    },
    async searchPastChats() {
      return [{ session_id: "s0", session_title: "Arquitetura", role: "user", snippet: "falamos de sqlite" }];
    }
  };
  const ctxSvc = new WorkspaceContextService(fakePersistence);
  const autoJson = await ctxSvc.buildEnrichedContextJson(state, {
    userPrompt: "como está o release mobile?",
    activeSessionId: "s1"
  });
  const autoParsed = JSON.parse(autoJson);
  assert.equal(autoParsed.contextScope.mode, "auto");
  assert.ok(autoParsed.contextScope.selectedTaskIds.includes("t2"));

  ctxSvc.toggleTaskInScope("t2");
  assert.equal(ctxSvc.scope.mode, "custom");

  const json = await ctxSvc.buildEnrichedContextJson(state, {
    userPrompt: "como ficou o sqlite?",
    activeSessionId: "s1"
  });
  const parsed = JSON.parse(json);

  assert.equal(parsed.contextScope.mode, "custom");
  assert.deepEqual(parsed.contextScope.selectedTaskIds, ["t2"]);
  assert.equal(parsed.projectMemories.length, 1);
  assert.equal(parsed.relevantPastConversations.length, 1);
  assert.ok(parsed.workspaceAudit.inconsistencies.length >= 2);
});

test("WorkspaceUndoStack captures, restores and evicts oldest snapshots", () => {
  const stack = new WorkspaceUndoStack(2);
  stack.capture("b1", { v: 1 });
  stack.capture("b2", { v: 2 });
  stack.capture("b3", { v: 3 });

  assert.equal(stack.has("b1"), false);
  assert.equal(stack.has("b2"), true);
  assert.deepEqual(stack.restore("b2"), { v: 2 });
  assert.equal(stack.has("b2"), false);
});

test("buildActionPreviewDiffs builds readable before/after previews for update, delete and move", () => {
  const state = makeSampleState();
  const diffs = buildActionPreviewDiffs(
    [
      { type: "update_card", cardId: "card-1", body: "Novo texto do card" },
      { type: "delete_card", cardId: "card-2" },
      { type: "move_card_to_task", sourceCardId: "card-3", targetTaskTitle: "Migração SQLite" }
    ],
    state
  );

  assert.equal(diffs.length, 3);
  assert.equal(diffs[0].after, "Novo texto do card");
  assert.equal(diffs[1].after, "(será excluído)");
  assert.ok(diffs[2].after.includes("Migração SQLite"));
});

test("PersistenceService loads chat sessions from SQLite backend when available", async () => {
  const calls = [];
  const mockInvoke = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "db_chat_sessions_load") {
      return [JSON.stringify({ id: "s1", title: "Teste", messages: [{ role: "user", text: "oi" }] })];
    }
    return null;
  };
  const svc = new PersistenceService(mockInvoke);
  const sessions = await svc.loadChatSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, "s1");
  assert.equal(calls[0].cmd, "db_chat_sessions_load");
});

test("TaskReminderService triggers due reminders/alarms, advances repeat schedule and calls Windows notification", () => {
  const past = "2026-01-10T09:00";
  const future = "2099-01-10T09:00";
  assert.equal(isReminderDue({ enabled: true, mode: "alarm", dateTime: past }, new Date("2026-01-10T09:01").getTime()), true);
  assert.equal(isReminderDue({ enabled: true, mode: "reminder", dateTime: future }, new Date("2026-01-10T09:01").getTime()), false);

  const nextDaily = advanceReminderOccurrence({ enabled: true, mode: "reminder", dateTime: past, repeat: "daily" }, new Date("2026-01-10T09:01").getTime());
  assert.equal(nextDaily.enabled, true);
  assert.equal(nextDaily.dateTime, "2026-01-11T09:00");

  const nextInterval = advanceReminderOccurrence({ enabled: true, mode: "reminder", dateTime: past, repeat: "interval", intervalMinutes: 15 }, new Date("2026-01-10T09:01").getTime());
  assert.equal(nextInterval.enabled, true);
  assert.equal(nextInterval.dateTime, "2026-01-10T09:15");

  const nextOnce = advanceReminderOccurrence({ enabled: true, mode: "alarm", dateTime: past, repeat: "none" }, new Date("2026-01-10T09:01").getTime());
  assert.equal(nextOnce.enabled, false);

  const state = makeSampleState();
  state.users[0].tasks[0].reminder = normalizeReminder({
    enabled: true,
    mode: "alarm",
    dateTime: past,
    repeat: "none",
    note: "Revisar migração"
  });

  const triggered = [];
  const winCalls = [];
  const svc = new TaskReminderService({
    getState: () => state,
    onStateMutated: () => {},
    onTrigger: item => triggered.push(item),
    invokeFn: async (cmd, args) => {
      winCalls.push({ cmd, args });
    }
  });

  svc.checkDueReminders(new Date("2026-01-10T09:05").getTime());
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].reminder.mode, "alarm");
  assert.equal(state.users[0].tasks[0].reminder.enabled, false);
  assert.equal(winCalls.length, 1);
  assert.equal(winCalls[0].cmd, "send_windows_notification");
  assert.equal(winCalls[0].args.isAlarm, true);
});
