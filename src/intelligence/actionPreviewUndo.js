export class WorkspaceUndoStack {
  constructor(maxEntries = 15) {
    this.maxEntries = maxEntries;
    this.snapshots = new Map();
    this.order = [];
  }

  capture(batchId, stateObj) {
    if (!batchId || !stateObj) return null;
    const serialized = JSON.stringify(stateObj);
    this.snapshots.set(batchId, serialized);
    this.order = this.order.filter(id => id !== batchId);
    this.order.push(batchId);
    while (this.order.length > this.maxEntries) {
      const oldest = this.order.shift();
      this.snapshots.delete(oldest);
    }
    return batchId;
  }

  has(batchId) {
    return this.snapshots.has(batchId);
  }

  restore(batchId) {
    const raw = this.snapshots.get(batchId);
    if (!raw) return null;
    this.snapshots.delete(batchId);
    this.order = this.order.filter(id => id !== batchId);
    return JSON.parse(raw);
  }
}

export function buildActionPreviewDiffs(actions, state) {
  const diffs = [];
  if (!Array.isArray(actions) || !state?.users) return diffs;

  const findNodeById = cardId => {
    if (!cardId) return null;
    for (const u of state.users) {
      for (const t of u.tasks || []) {
        const n = (t.nodes || []).find(item => item.id === cardId);
        if (n) return { user: u, task: t, node: n };
      }
    }
    return null;
  };

  for (const act of actions) {
    if (!act || typeof act.type !== "string") continue;
    if (act.type === "update_card") {
      const loc = findNodeById(act.cardId);
      const before = String(loc?.node?.body ?? loc?.node?.title ?? "").trim().slice(0, 70);
      const after = String(act.body ?? act.appendBody ?? "").trim().slice(0, 70);
      diffs.push({
        type: act.type,
        before: before || "(vazio)",
        after: act.appendBody ? `+ ${after}` : (after || "(sem alteração de texto)")
      });
    } else if (act.type === "delete_card") {
      const loc = findNodeById(act.cardId);
      const before = String(loc?.node?.body ?? loc?.node?.title ?? act.cardId ?? "Card").trim().slice(0, 70);
      diffs.push({
        type: act.type,
        before,
        after: "(será excluído)"
      });
    } else if (act.type === "move_card_to_task") {
      const loc = findNodeById(act.sourceCardId || act.cardId);
      diffs.push({
        type: act.type,
        before: `Origem: ${loc?.task?.title || "task atual"}`,
        after: `Destino: ${act.targetTaskTitle || act.targetTaskId || "outra task"}`
      });
    }
  }
  return diffs.slice(0, 6);
}
