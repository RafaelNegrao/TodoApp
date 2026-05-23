const STORAGE_KEY = "todocompanion.state.v4";
const LEGACY_STORAGE_KEYS = ["todocompanion.state.v3", "todocompanion.state.v2", "todocompanion.state.v1"];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.8;

const STATUS_ORDER = ["ongoing", "stopped", "complete"];
const STATUS_META = {
  ongoing: { label: "Ongoing" },
  stopped: { label: "Stopped" },
  complete: { label: "Complete" }
};
const PRIORITY_ORDER = ["low", "normal", "high", "urgent"];
const PRIORITY_META = {
  low: { label: "Baixa" },
  normal: { label: "Normal" },
  high: { label: "Alta" },
  urgent: { label: "Urgente" }
};
const CRITICALITY_META = [
  { label: "Baixa" },
  { label: "Media" },
  { label: "Alta" }
];

const icons = {
  plus: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  link: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>`,
  trash: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  chevronLeft: `<svg class="icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg class="icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>`,
  focus: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M12 8v8M8 12h8"/></svg>`,
  organize: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="5" rx="1.4"/><rect x="15" y="4" width="6" height="5" rx="1.4"/><rect x="9" y="15" width="6" height="5" rx="1.4"/><path d="M9 6.5h6M6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3"/></svg>`,
  edit: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  paperclip: `<svg class="icon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  externalLink: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`
};

const appEl = document.querySelector("#app");
const edgeToggle = document.querySelector("#edgeToggle");
const tabsEl = document.querySelector("#tabs");
const nodesLayer = document.querySelector("#nodesLayer");
const linkLayer = document.querySelector("#linkLayer");
const boardSurface = document.querySelector("#boardSurface");
const boardShell = document.querySelector(".board-shell");
const canvasMetaOverlay = document.querySelector("#canvasMetaOverlay");
const overlayStartInput = document.querySelector("#overlayStartInput");
const overlayEndInput = document.querySelector("#overlayEndInput");
const overlayStatusInput = document.querySelector("#overlayStatusInput");
const overlayCriticalityControl = document.querySelector("#overlayCriticalityControl");
const overlayCriticalityInput = document.querySelector("#overlayCriticalityInput");
const actionListShell = document.querySelector("#actionListShell");
const actionListLinks = document.querySelector("#actionListLinks");
const actionList = document.querySelector("#actionList");
const viewSwitch = document.querySelector("#viewSwitch");
const centerCanvasButton = document.querySelector("#centerCanvasButton");
const organizeCanvasButton = document.querySelector("#organizeCanvasButton");
const canvasAttachButton = document.querySelector("#canvasAttachButton");
const canvasAttachInput = document.querySelector("#canvasAttachInput");
const canvasDropOverlay = document.querySelector("#canvasDropOverlay");
const attachmentsPopup = document.querySelector("#attachmentsPopup");
const attachmentsList = document.querySelector("#attachmentsList");
const attachmentsAdd = document.querySelector("#attachmentsAdd");
const addBoardButton = document.querySelector("#addBoardButton");
const userTaskDock = document.querySelector(".user-task-dock");
const userTaskList = document.querySelector("#userTaskList");
const dockScrollLeft = document.querySelector("#dockScrollLeft");
const dockScrollRight = document.querySelector("#dockScrollRight");
const addUserTaskButton = document.querySelector("#addUserTaskButton");
const canvasModal = document.querySelector("#canvasModal");
const canvasForm = document.querySelector("#canvasForm");
const canvasModalTitle = document.querySelector("#canvasModalTitle");
const canvasOwnerLabel = document.querySelector("#canvasOwnerLabel");
const canvasOwnerInput = document.querySelector("#canvasOwnerInput");
const canvasNameInput = document.querySelector("#canvasNameInput");
const canvasStartInput = document.querySelector("#canvasStartInput");
const canvasEndInput = document.querySelector("#canvasEndInput");
const canvasPriorityInput = document.querySelector("#canvasPriorityInput");
const canvasStatusInput = document.querySelector("#canvasStatusInput");
const canvasCancelButton = document.querySelector("#canvasCancelButton");
const canvasCancelIcon = document.querySelector("#canvasCancelIcon");
const newCardForm = document.querySelector("#newCardForm");
const newCardTitleInput = document.querySelector("#newCardTitleInput");
const newCardStatusInput = document.querySelector("#newCardStatusInput");
const newCardCancelButton = document.querySelector("#newCardCancelButton");
const userCreateForm = document.querySelector("#userCreateForm");
const userCreateNameInput = document.querySelector("#userCreateNameInput");
const userCreateCancelButton = document.querySelector("#userCreateCancelButton");
const confirmDeleteModal = document.querySelector("#confirmDeleteModal");
const confirmDeleteForm = document.querySelector("#confirmDeleteForm");
const confirmDeleteTitle = document.querySelector("#confirmDeleteTitle");
const confirmDeleteMessage = document.querySelector("#confirmDeleteMessage");
const confirmDeleteCode = document.querySelector("#confirmDeleteCode");
const confirmDeleteInput = document.querySelector("#confirmDeleteInput");
const confirmDeleteCancel = document.querySelector("#confirmDeleteCancel");
const confirmDeleteOk = document.querySelector("#confirmDeleteOk");

centerCanvasButton.innerHTML = icons.focus;
organizeCanvasButton.innerHTML = icons.organize;
canvasAttachButton.innerHTML = icons.paperclip;
dockScrollLeft.innerHTML = icons.chevronLeft;
dockScrollRight.innerHTML = icons.chevronRight;

let state = null;
let expanded = false;
let linkMode = false;
let pendingLink = null;
let selectedNodeId = null;
let selectedLinkId = null;
let dragState = null;
let resizeState = null;
let linkDragState = null;
let panState = null;
let dockDragId = null;
let dockPointerDrag = null;
let lineageHoverTimer = null;
let lineageState = null;
const pendingCardPop = new Set();
const pendingListPop = new Set();
let dialogMode = "create-task";
let dialogUserId = null;
let dialogTaskId = null;
let newCardPosition = null;

const invoke =
  window.__TAURI__?.core?.invoke ||
  window.__TAURI__?.invoke ||
  null;

init().catch(error => console.error("Falha na inicializacao", error));

async function init() {
  state = await initState();
  render();
  initializePanel();
  setupFileDrop().catch(err => console.warn("Drag-and-drop indisponivel", err));

  edgeToggle.addEventListener("click", togglePanel);
  window.addEventListener("app:collapse", () => {
    if (expanded) togglePanel();
  });
  centerCanvasButton.addEventListener("click", centerCanvasOnTasks);
  organizeCanvasButton.addEventListener("click", organizeCanvasCards);
  canvasAttachButton.addEventListener("click", handleAttachButtonClick);
  canvasAttachInput.addEventListener("change", handleAttachInputChange);
  attachmentsAdd.addEventListener("click", () => canvasAttachInput.click());
  addBoardButton.addEventListener("click", openUserCreatePopup);
  addUserTaskButton.addEventListener("click", () => openTaskDialog("create-task"));
  dockScrollLeft.addEventListener("click", () => scrollDockBy(-1));
  dockScrollRight.addEventListener("click", () => scrollDockBy(1));
  overlayStartInput.addEventListener("change", updateActiveTaskMetaFromOverlay);
  overlayEndInput.addEventListener("change", updateActiveTaskMetaFromOverlay);
  overlayStatusInput.addEventListener("change", updateActiveTaskMetaFromOverlay);
  overlayCriticalityInput.addEventListener("input", updateActiveTaskMetaFromOverlay);
  canvasForm.addEventListener("submit", saveTaskDialog);
  canvasCancelButton.addEventListener("click", closeTaskDialog);
  canvasCancelIcon.addEventListener("click", closeTaskDialog);
  canvasModal.addEventListener("pointerdown", event => {
    if (event.target === canvasModal) {
      closeTaskDialog();
    }
  });
  viewSwitch.addEventListener("click", event => {
    const button = event.target.closest("[data-view-mode]");
    if (!button) {
      return;
    }
    setViewMode(button.dataset.viewMode);
  });

  document.querySelector("#taskEditPopup").addEventListener("submit", saveTaskEditPopup);
  document.querySelector("#tepCancelButton").addEventListener("click", closeTaskEditPopup);

  boardShell.addEventListener("wheel", handleZoom, { passive: false });
  boardShell.addEventListener("pointerdown", handleBoardPointerDown);
  boardShell.addEventListener("contextmenu", handleBoardContextMenu);
  newCardForm.addEventListener("submit", saveNewCard);
  newCardCancelButton.addEventListener("click", closeNewCardModal);
  userCreateForm.addEventListener("submit", saveUserCreatePopup);
  userCreateCancelButton.addEventListener("click", closeUserCreatePopup);
  document.addEventListener("pointerdown", event => {
    if (!newCardForm.hidden && !newCardForm.contains(event.target)) closeNewCardModal();
    if (!userCreateForm.hidden && !userCreateForm.contains(event.target) && !addBoardButton.contains(event.target)) closeUserCreatePopup();
    const tep = document.querySelector("#taskEditPopup");
    if (!tep.hidden && !tep.contains(event.target) && !event.target.closest(".user-task-info")) closeTaskEditPopup();
    if (!attachmentsPopup.hidden && !attachmentsPopup.contains(event.target) && !canvasAttachButton.contains(event.target)) closeAttachmentsPopup();
  }, true);
  userTaskList.addEventListener("wheel", handleDockWheel, { passive: false });
  userTaskList.addEventListener("scroll", updateDockScrollControls, { passive: true });

  window.addEventListener("resize", () => {
    applyViewport();
    renderLinks();
    renderActionListLinks();
    updateDockScrollControls();
  });

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.querySelector("#taskEditPopup").hidden) {
      closeTaskEditPopup();
      return;
    }

    if (event.key === "Escape" && !newCardForm.hidden) {
      closeNewCardModal();
      return;
    }

    if (event.key === "Escape" && !userCreateForm.hidden) {
      closeUserCreatePopup();
      return;
    }

    if (event.key === "Escape" && !canvasModal.hidden) {
      closeTaskDialog();
      return;
    }

    if (event.key === "Escape" && !confirmDeleteModal.hidden) {
      closeConfirmDelete(false);
      return;
    }

    if (event.key === "Escape" && !attachmentsPopup.hidden) {
      closeAttachmentsPopup();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
        removeSelection();
      }
    }
  });

  scheduleUpdaterCheck();
  initSettingsModule();
}

function scheduleUpdaterCheck() {
  setTimeout(() => {
    import("./updater/index.js")
      .then(({ runUpdaterFlow }) => runUpdaterFlow())
      .catch(error => console.warn("[updater] failed to load", error));
  }, 600);
}

function initSettingsModule() {
  import("./settings/index.js")
    .then(({ initSettings }) => initSettings())
    .catch(error => console.warn("[settings] failed to load", error));
}

async function initializePanel() {
  if (!invoke) {
    return;
  }

  try {
    await invoke("initialize_panel");
  } catch (error) {
    console.warn("Could not initialize side panel", error);
  }
}

async function togglePanel() {
  expanded = !expanded;
  appEl.classList.toggle("expanded", expanded);
  appEl.classList.toggle("collapsed", !expanded);
  edgeToggle.setAttribute("aria-label", expanded ? "Recolher painel" : "Abrir painel");

  if (invoke) {
    try {
      await invoke("set_panel_expanded", { expanded });
    } catch (error) {
      console.warn("Could not resize side panel", error);
    }
  }

  requestAnimationFrame(() => {
    applyViewport();
    renderLinks();
  });
}

async function initState() {
  if (invoke) {
    try {
      const json = await invoke("state_load");
      if (json) {
        return normalizeState(migrateState(JSON.parse(json)));
      }
    } catch (error) {
      console.warn("DB load failed, tentando localStorage", error);
    }
  }

  try {
    const stored = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]
      .map(key => localStorage.getItem(key))
      .find(Boolean);
    if (stored) {
      const migrated = normalizeState(migrateState(JSON.parse(stored)));
      if (invoke) {
        try {
          await invoke("state_save", { json: JSON.stringify(migrated) });
        } catch (e) {
          console.warn("Migracao para SQLite falhou", e);
        }
      }
      return migrated;
    }
  } catch (error) {
    console.warn("Could not load state", error);
  }

  const fallback = normalizeState(defaultState());
  if (invoke) {
    try {
      await invoke("state_save", { json: JSON.stringify(fallback) });
    } catch (e) {
      console.warn("Salvar estado inicial falhou", e);
    }
  }
  return fallback;
}

function defaultState() {
  return {
    activeUserId: "user-rafael",
    users: [
      createUser("Rafael", [createMainTask({ id: "task-rafael-tauri", title: "Criar app Tauri todo", status: "ongoing", priority: "high" }, 0)]),
      createUser("Ana", [createMainTask({ id: "task-ana-flow", title: "Revisar fluxo dos cards", status: "stopped", priority: "normal" }, 1)]),
      createUser("Kelvin", [createMainTask({ id: "task-kelvin-links", title: "Validar ligacoes", status: "complete", priority: "normal" }, 2)]),
      createUser("UI", [createMainTask({ id: "task-ui-polish", title: "Polir painel lateral", status: "ongoing", priority: "urgent" }, 3)])
    ]
  };
}

function createUser(name, tasks = []) {
  const id = makeId("user");
  return {
    id: name === "Rafael" ? "user-rafael" : id,
    name,
    activeTaskId: tasks[0]?.id,
    tasks
  };
}

function createMainTask(data = {}, index = 0) {
  const id = data.id || makeId("main-task");
  const firstId = `${id}-action-a`;
  const status = normalizeStatus(data.status);

  return normalizeMainTask({
    id,
    title: data.title || "Nova main task",
    status,
    priority: normalizePriority(data.priority),
    criticality: normalizeCriticality(data.criticality),
    startDate: normalizeDate(data.startDate),
    endDate: normalizeDate(data.endDate, 7),
    viewMode: data.viewMode || "canvas",
    view: data.view || { zoom: 0.92, panX: 44 + index * 16, panY: 68 + index * 12 },
    nodes: data.nodes || [
      {
        id: firstId,
        title: index === 0 ? "Planejar" : "Task inicial",
        body: data.title || "Definir proximos passos.",
        status,
        x: 130,
        y: 150,
        w: 232,
        h: 154
      }
    ],
    links: data.links || []
  });
}

function migrateState(value) {
  if (value.users?.length) {
    return value;
  }

  if (value.boards?.length) {
    const usersByName = new Map();
    value.boards.forEach((board, index) => {
      const userName = board.owner || board.user || "User";
      if (!usersByName.has(userName)) {
        usersByName.set(userName, createUser(userName, []));
      }

      usersByName.get(userName).tasks.push(createMainTask({
        id: board.id || makeId("main-task"),
        title: board.name || board.title || "Main task",
        status: board.status,
        priority: board.priority,
        criticality: board.criticality,
        startDate: board.startDate,
        endDate: board.endDate,
        view: board.view,
        nodes: board.nodes,
        links: board.links
      }, index));
    });

    const users = [...usersByName.values()].map(user => ({
      ...user,
      activeTaskId: user.tasks[0]?.id
    }));
    const activeBoard = value.boards.find(board => board.id === value.activeBoardId);
    const activeUser = users.find(user => user.name === (activeBoard?.owner || activeBoard?.user));

    return {
      activeUserId: activeUser?.id || users[0]?.id,
      users
    };
  }

  return defaultState();
}

function normalizeState(value) {
  value.users = (value.users?.length ? value.users : defaultState().users).map(normalizeUser);
  if (!value.users.some(user => user.id === value.activeUserId)) {
    value.activeUserId = value.users[0].id;
  }
  value.users.forEach(user => {
    if (!user.tasks.some(task => task.id === user.activeTaskId)) {
      user.activeTaskId = user.tasks[0]?.id;
    }
  });
  return value;
}

function normalizeUser(user, index = 0) {
  const tasks = (user.tasks?.length ? user.tasks : [createMainTask({ title: "Nova main task" }, index)]).map((task, taskIndex) => normalizeMainTask(task, taskIndex));
  return {
    id: user.id || makeId("user"),
    name: user.name || user.owner || `User ${index + 1}`,
    activeTaskId: user.activeTaskId || tasks[0]?.id,
    tasks
  };
}

function normalizeMainTask(task, index = 0) {
  task.id ||= makeId("main-task");
  task.title ||= task.name || `Main task ${index + 1}`;
  task.status = normalizeStatus(task.status);
  task.priority = normalizePriority(task.priority);
  task.criticality = normalizeCriticality(task.criticality);
  task.startDate = normalizeDate(task.startDate);
  task.endDate = normalizeDate(task.endDate, 7);
  task.viewMode = normalizeViewMode(task.viewMode);
  task.view ||= { zoom: 1, panX: 44, panY: 68 };
  task.view.zoom = clamp(Number(task.view.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
  task.view.panX = Number(task.view.panX) || 0;
  task.view.panY = Number(task.view.panY) || 0;
  task.nodes = (task.nodes || []).map(node => normalizeNode(node)).filter(node => !isDefaultNextStep(node));
  task.links ||= [];
  task.links = task.links.filter(link => task.nodes.some(node => node.id === link.from) && task.nodes.some(node => node.id === link.to));
  return task;
}

function isDefaultNextStep(node) {
  return node.title === "Proxima etapa" && node.body === "Criar subtasks e ligar dependencias.";
}

function normalizeNode(node) {
  return {
    id: node.id || makeId("action"),
    title: node.title || "Nova acao",
    body: node.body || "",
    status: normalizeStatus(node.status || (node.done ? "complete" : "ongoing")),
    x: Number(node.x) || 0,
    y: Number(node.y) || 0,
    w: Number(node.w) || 232,
    h: Number(node.h) || 154
  };
}

function normalizeStatus(status) {
  return STATUS_ORDER.includes(status) ? status : "ongoing";
}

function normalizePriority(priority) {
  return PRIORITY_ORDER.includes(priority) ? priority : "normal";
}

function normalizeCriticality(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return clamp(Math.round(number), 0, 2);
}

function normalizeViewMode(mode) {
  return mode === "list" ? "list" : "canvas";
}

function formatShortDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "";
  const [y, m, d] = value.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

function normalizeDate(value, offsetDays = 0) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return value;
  }

  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

let saveDebounceTimer = null;
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("localStorage write falhou", e);
  }
  if (!invoke) return;
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    invoke("state_save", { json: JSON.stringify(state) }).catch(err => {
      console.warn("DB save falhou", err);
    });
  }, 180);
}

function activeUser() {
  let user = state.users.find(item => item.id === state.activeUserId);
  if (!user) {
    user = state.users[0];
    state.activeUserId = user.id;
  }
  return user;
}

function activeBoard() {
  const user = activeUser();
  let task = user.tasks.find(item => item.id === user.activeTaskId);
  if (!task) {
    task = user.tasks[0];
    user.activeTaskId = task.id;
  }
  return task;
}

function activeView() {
  return activeBoard().view;
}

function activateUser(userId) {
  if (!userId || userId === state.activeUserId) {
    return;
  }

  state.activeUserId = userId;
  clearSelection();
  saveState();
  if (attachmentsPopup && !attachmentsPopup.hidden) closeAttachmentsPopup();
  render();
}

function activateTask(taskId) {
  const user = activeUser();
  if (!taskId || taskId === user.activeTaskId) {
    return;
  }

  user.activeTaskId = taskId;
  clearSelection();
  saveState();
  if (attachmentsPopup && !attachmentsPopup.hidden) closeAttachmentsPopup();
  render();
}

function clearSelection() {
  selectedNodeId = null;
  selectedLinkId = null;
  pendingLink = null;
  linkDragState = null;
  clearLineagePreview(false);
}

function render() {
  renderToolbar();
  renderTabs();
  renderViewMode();
  renderCanvasMetaOverlay();
  ensureCanvasPositions();
  applyViewport();
  renderNodes();
  renderLinks();
  renderActionList();
  renderUserTasks();
  updateAttachButtonState();
}

function renderToolbar() {
  const isListMode = activeBoard().viewMode === "list";
  centerCanvasButton.disabled = isListMode;
  organizeCanvasButton.disabled = isListMode;
}

function renderViewMode() {
  const mode = normalizeViewMode(activeBoard().viewMode);
  boardSurface.hidden = mode !== "canvas";
  canvasMetaOverlay.hidden = false;
  actionListShell.hidden = mode !== "list";
  centerCanvasButton.hidden = mode !== "canvas";
  organizeCanvasButton.hidden = mode !== "canvas";
  canvasAttachButton.hidden = mode !== "canvas";
  boardShell.classList.toggle("list-mode", mode === "list");

  viewSwitch.querySelectorAll("[data-view-mode]").forEach(button => {
    const active = button.dataset.viewMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setViewMode(mode) {
  const board = activeBoard();
  board.viewMode = normalizeViewMode(mode);
  clearSelection();
  if (board.viewMode === "list") {
    linkMode = false;
  }
  saveState();
  render();
}

function renderCanvasMetaOverlay() {
  const task = activeBoard();
  overlayStartInput.value = task.startDate || normalizeDate();
  overlayEndInput.value = task.endDate || normalizeDate(null, 7);
  overlayStatusInput.value = normalizeStatus(task.status);
  const criticality = normalizeCriticality(task.criticality);
  overlayCriticalityInput.value = String(criticality);
  overlayCriticalityControl.className = `overlay-criticality crit-${criticality}`;
  overlayCriticalityInput.title = `Criticidade ${CRITICALITY_META[criticality].label}`;
}

function updateActiveTaskMetaFromOverlay() {
  const task = activeBoard();
  task.startDate = overlayStartInput.value || normalizeDate();
  task.endDate = overlayEndInput.value || normalizeDate(null, 7);
  task.status = normalizeStatus(overlayStatusInput.value);
  task.criticality = normalizeCriticality(overlayCriticalityInput.value);
  saveState();
  renderUserTasks();
  renderCanvasMetaOverlay();
}

function renderTabs() {
  const user = activeUser();
  tabsEl.innerHTML = "";

  state.users.forEach(item => {
    const tab = document.createElement("div");
    tab.className = `tab${item.id === user.id ? " active" : ""}`;
    tab.setAttribute("role", "tab");
    tab.tabIndex = 0;
    tab.title = item.name;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = item.name;

    const actions = document.createElement("div");
    actions.className = "tab-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "tab-action";
    editBtn.setAttribute("aria-label", "Renomear");
    editBtn.title = "Renomear";
    editBtn.innerHTML = icons.edit;
    editBtn.addEventListener("click", event => {
      event.stopPropagation();
      startTabRename(tab, label, item);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tab-action tab-action-danger";
    deleteBtn.setAttribute("aria-label", "Excluir");
    deleteBtn.title = "Excluir";
    deleteBtn.innerHTML = icons.trash;
    deleteBtn.addEventListener("click", async event => {
      event.stopPropagation();
      if (state.users.length <= 1) {
        return;
      }
      const ok = await openConfirmDelete({
        title: `Excluir "${item.name}"`,
        message: "Esta acao removera a aba e todas as suas tasks. Nao pode ser desfeita."
      });
      if (ok) {
        removeUser(item.id);
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    tab.appendChild(label);
    tab.appendChild(actions);

    tab.addEventListener("click", event => {
      if (event.target.closest(".tab-action")) return;
      activateUser(item.id);
    });
    tab.addEventListener("dblclick", event => {
      if (event.target.closest(".tab-action")) return;
      startTabRename(tab, label, item);
    });
    tab.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateUser(item.id);
      }
    });

    tabsEl.appendChild(tab);
  });
}

function removeUser(id) {
  const idx = state.users.findIndex(u => u.id === id);
  if (idx === -1 || state.users.length <= 1) {
    return;
  }
  state.users.splice(idx, 1);
  if (state.activeUserId === id) {
    state.activeUserId = state.users[0]?.id ?? null;
  }
  saveState();
  render();
}

let confirmDeleteResolve = null;
let confirmDeleteCodeStr = "";

function generateCaptcha(len = 3) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function openConfirmDelete({ title, message }) {
  return new Promise(resolve => {
    confirmDeleteCodeStr = generateCaptcha(3);
    confirmDeleteTitle.textContent = title;
    confirmDeleteMessage.textContent = message;
    confirmDeleteCode.textContent = confirmDeleteCodeStr;
    confirmDeleteInput.value = "";
    confirmDeleteOk.disabled = true;
    confirmDeleteModal.hidden = false;
    confirmDeleteResolve = resolve;
    requestAnimationFrame(() => confirmDeleteInput.focus());
  });
}

function closeConfirmDelete(result) {
  confirmDeleteModal.hidden = true;
  if (confirmDeleteResolve) {
    confirmDeleteResolve(result);
    confirmDeleteResolve = null;
  }
}

confirmDeleteInput.addEventListener("input", () => {
  confirmDeleteOk.disabled = confirmDeleteInput.value.trim().toUpperCase() !== confirmDeleteCodeStr;
});
confirmDeleteForm.addEventListener("submit", event => {
  event.preventDefault();
  if (confirmDeleteInput.value.trim().toUpperCase() === confirmDeleteCodeStr) {
    closeConfirmDelete(true);
  }
});
confirmDeleteCancel.addEventListener("click", () => closeConfirmDelete(false));
confirmDeleteModal.addEventListener("pointerdown", event => {
  if (event.target === confirmDeleteModal) closeConfirmDelete(false);
});

function startTabRename(tabEl, labelEl, userItem) {
  if (tabEl.querySelector(".tab-rename-input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "tab-rename-input";
  input.value = userItem.name;
  input.maxLength = 28;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Renomear aba");

  labelEl.replaceWith(input);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const next = input.value.trim().slice(0, 28);
    if (save && next && next !== userItem.name) {
      userItem.name = next;
      saveState();
    }
    renderTabs();
  };

  input.addEventListener("pointerdown", e => e.stopPropagation());
  input.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      input.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
}

function renderNodes() {
  const board = activeBoard();
  nodesLayer.innerHTML = "";
  const lineageNodeIds = lineageState?.nodeIds || null;
  boardShell.classList.toggle("lineage-mode", Boolean(lineageState));

  board.nodes.forEach(node => {
    const status = normalizeStatus(node.status);
    const card = document.createElement("article");
    const justCreated = pendingCardPop.has(node.id);
    if (justCreated) {
      pendingCardPop.delete(node.id);
    }
    card.className = [
      "task-card",
      `status-${status}`,
      status === "complete" ? "done" : "",
      node.id === selectedNodeId ? "selected" : "",
      lineageNodeIds ? (lineageNodeIds.has(node.id) ? "lineage-active-node" : "lineage-dim") : "",
      dragState?.nodeId === node.id ? "dragging" : "",
      justCreated ? "just-created" : ""
    ].filter(Boolean).join(" ");
    card.dataset.id = node.id;
    card.dataset.status = status;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.w || 232}px`;
    card.style.height = `${node.h || 154}px`;

    card.innerHTML = `
      <button class="port port-in${linkDragState?.nodeId === node.id && linkDragState?.port === "in" ? " pending" : ""}" data-port="in" type="button" aria-label="Entrada"></button>
      <button class="port port-out${pendingLink?.from === node.id || (linkDragState?.nodeId === node.id && linkDragState?.port === "out") ? " pending" : ""}" data-port="out" type="button" aria-label="Saida"></button>
      <div class="card-top">
        <button class="card-check" type="button" aria-label="Concluir" title="Concluir">${status === "complete" ? icons.check : ""}</button>
        <input class="card-title" value="${escapeAttr(node.title)}" />
        <div class="crit-wrap crit-${node.criticality ?? 0}">
          <div class="crit-track">
            <span class="crit-dot"></span>
            <span class="crit-dot"></span>
            <span class="crit-dot"></span>
          </div>
          <input class="crit-range" type="range" min="0" max="2" step="1" value="${node.criticality ?? 0}" title="Criticidade" />
        </div>
        <button class="card-action" type="button" aria-label="Remover" title="Remover">${icons.close}</button>
      </div>
      <div class="card-status-row">
        <button class="status-chip status-${status}" type="button" aria-label="Status" title="Status">${STATUS_META[status].label}</button>
      </div>
      <textarea class="card-body">${escapeHtml(node.body)}</textarea>
      <button class="resize-handle" type="button" aria-label="Redimensionar" title="Redimensionar"></button>
    `;

    card.addEventListener("pointerdown", () => {
      clearLineagePreview(false);
      selectedNodeId = node.id;
      selectedLinkId = null;
      removeLineageClasses();
      renderLinks();
      refreshSelectionClasses();
    });

    card.addEventListener("mouseenter", () => scheduleLineagePreview(node.id));
    card.addEventListener("mouseleave", () => clearLineagePreview());

    card.querySelector(".card-top").addEventListener("pointerdown", event => {
      if (event.target.closest("button") || event.target.closest("input")) {
        return;
      }
      startDrag(event, node.id);
    });

    card.querySelector(".card-check").addEventListener("click", event => {
      event.stopPropagation();
      node.status = status === "complete" ? "ongoing" : "complete";
      saveState();
      renderNodes();
      renderLinks();
    });

    card.querySelector(".status-chip").addEventListener("click", event => {
      event.stopPropagation();
      node.status = nextStatus(node.status);
      saveState();
      renderNodes();
      renderLinks();
    });

    card.querySelector(".card-action").addEventListener("click", event => {
      event.stopPropagation();
      removeNode(node.id);
    });

    card.querySelector(".card-title").addEventListener("input", event => {
      node.title = event.target.value;
      saveState();
    });

    card.querySelector(".card-body").addEventListener("input", event => {
      node.body = event.target.value;
      saveState();
    });

    card.querySelector(".crit-range").addEventListener("pointerdown", event => event.stopPropagation());
    card.querySelector(".crit-range").addEventListener("input", event => {
      const val = parseInt(event.target.value);
      node.criticality = val;
      event.target.closest(".crit-wrap").className = `crit-wrap crit-${val}`;
      saveState();
    });

    card.querySelector(".port-out").addEventListener("pointerdown", event => startLinkDrag(event, node.id, "out"));
    card.querySelector(".port-in").addEventListener("pointerdown", event => startLinkDrag(event, node.id, "in"));
    card.querySelector(".resize-handle").addEventListener("pointerdown", event => startResize(event, node.id));

    nodesLayer.appendChild(card);
  });
}

function scheduleLineagePreview(nodeId) {
  if (activeBoard().viewMode !== "canvas") {
    return;
  }

  window.clearTimeout(lineageHoverTimer);
  lineageHoverTimer = window.setTimeout(() => {
    showLineagePreview(nodeId);
  }, 4000);
}

function showLineagePreview(nodeId) {
  const board = activeBoard();
  const lineage = getNodeLineage(board, nodeId);
  if (!lineage.nodeIds.size) {
    return;
  }

  lineageState = lineage;
  applyLineageClasses();
  renderLinks();
}

function clearLineagePreview(renderNow = true) {
  window.clearTimeout(lineageHoverTimer);
  lineageHoverTimer = null;

  if (!lineageState) {
    return;
  }

  lineageState = null;
  if (renderNow) {
    removeLineageClasses();
    renderLinks();
  } else {
    removeLineageClasses();
  }
}

function applyLineageClasses() {
  boardShell.classList.add("lineage-mode");
  document.querySelectorAll(".task-card").forEach(card => {
    const active = lineageState?.nodeIds.has(card.dataset.id);
    card.classList.toggle("lineage-active-node", Boolean(active));
    card.classList.toggle("lineage-dim", Boolean(lineageState && !active));
  });
}

function removeLineageClasses() {
  boardShell.classList.remove("lineage-mode");
  document.querySelectorAll(".task-card").forEach(card => {
    card.classList.remove("lineage-active-node", "lineage-dim");
  });
  document.querySelectorAll(".link-path, .link-dot").forEach(item => {
    item.classList.remove("lineage-link", "lineage-dim");
  });
}

function getNodeLineage(board, nodeId) {
  const nodeIds = new Set([nodeId]);
  const linkIds = new Set();

  const visitParents = current => {
    board.links.forEach(link => {
      if (link.to !== current || linkIds.has(link.id)) {
        return;
      }

      linkIds.add(link.id);
      nodeIds.add(link.from);
      visitParents(link.from);
    });
  };

  const visitChildren = current => {
    board.links.forEach(link => {
      if (link.from !== current || linkIds.has(link.id)) {
        return;
      }

      linkIds.add(link.id);
      nodeIds.add(link.to);
      visitChildren(link.to);
    });
  };

  visitParents(nodeId);
  visitChildren(nodeId);

  return { nodeIds, linkIds };
}

function renderActionList() {
  const board = activeBoard();
  const entries = getActionListEntries(board);
  const incomingIds = new Set(board.links.map(link => link.to));
  actionList.innerHTML = "";
  actionListLinks.innerHTML = "";

  if (!board.nodes.length) {
    const empty = document.createElement("div");
    empty.className = "action-list-empty";
    empty.textContent = "Nenhuma acao";
    actionList.appendChild(empty);
  }

  entries.forEach(({ node, depth }) => {
    const status = normalizeStatus(node.status);
    const justCreated = pendingListPop.has(node.id);
    if (justCreated) {
      pendingListPop.delete(node.id);
    }
    const item = document.createElement("article");
    item.className = `action-list-item status-${status}${incomingIds.has(node.id) ? " has-incoming" : ""}${node.id === selectedNodeId ? " selected" : ""}${justCreated ? " list-created" : ""}`;
    item.dataset.id = node.id;
    item.dataset.depth = String(depth);
    item.style.setProperty("--list-depth", depth);
    item.style.setProperty("--list-indent", `${depth * 34}px`);
    item.innerHTML = `
      <span class="action-list-anchor" aria-hidden="true"></span>
      <button class="action-list-check" type="button" aria-label="Concluir" title="Concluir">${status === "complete" ? icons.check : ""}</button>
      <div class="action-list-main">
        <input class="action-list-title" value="${escapeAttr(node.title)}" aria-label="Titulo da acao" />
        <textarea class="action-list-body" rows="1" aria-label="Descricao da acao">${escapeHtml(node.body)}</textarea>
      </div>
      <span class="action-list-status" aria-label="Status">${STATUS_META[status].label}</span>
      <button class="action-list-reply" type="button" aria-label="Responder acao" title="Responder acao">+</button>
      <button class="action-list-remove" type="button" aria-label="Remover acao" title="Remover acao">${icons.close}</button>
    `;

    item.addEventListener("pointerdown", event => {
      if (event.target.closest("input, textarea, button")) {
        return;
      }
      selectedNodeId = node.id;
      selectedLinkId = null;
      renderActionList();
    });

    item.querySelector(".action-list-check").addEventListener("click", event => {
      event.stopPropagation();
      node.status = status === "complete" ? "ongoing" : "complete";
      saveState();
      renderNodes();
      renderLinks();
      renderActionList();
    });

    item.querySelector(".action-list-title").addEventListener("input", event => {
      node.title = event.target.value;
      saveState();
      renderNodes();
    });

    item.querySelector(".action-list-body").addEventListener("input", event => {
      node.body = event.target.value;
      saveState();
      renderNodes();
      scheduleActionListLinks();
    });

    item.querySelector(".action-list-reply").addEventListener("click", event => {
      event.stopPropagation();
      addAction(node.id);
    });

    item.querySelector(".action-list-remove").addEventListener("click", () => removeNode(node.id));

    actionList.appendChild(item);
  });

  const addButton = document.createElement("button");
  addButton.className = "action-list-add";
  addButton.type = "button";
  addButton.textContent = "+";
  addButton.setAttribute("aria-label", "Nova acao");
  addButton.setAttribute("title", "Nova acao");
  addButton.addEventListener("click", () => addAction());
  actionList.appendChild(addButton);
  scheduleActionListLinks();
}

function getActionListEntries(board) {
  const nodesById = new Map(board.nodes.map(node => [node.id, node]));
  const originalOrder = new Map(board.nodes.map((node, index) => [node.id, index]));
  const children = new Map(board.nodes.map(node => [node.id, []]));
  const parentById = new Map();

  board.links.forEach(link => {
    if (!nodesById.has(link.from) || !nodesById.has(link.to) || link.from === link.to || parentById.has(link.to)) {
      return;
    }

    parentById.set(link.to, link.from);
    children.get(link.from)?.push(link.to);
  });

  const byCanvasPosition = (firstId, secondId) => {
    const first = nodesById.get(firstId);
    const second = nodesById.get(secondId);
    return ((first?.y ?? 0) - (second?.y ?? 0)) ||
      ((first?.x ?? 0) - (second?.x ?? 0)) ||
      ((originalOrder.get(firstId) ?? 0) - (originalOrder.get(secondId) ?? 0));
  };

  children.forEach(items => items.sort(byCanvasPosition));

  const roots = board.nodes
    .map(node => node.id)
    .filter(id => !parentById.has(id))
    .sort(byCanvasPosition);
  const entries = [];
  const visited = new Set();

  const visit = (nodeId, depth) => {
    const node = nodesById.get(nodeId);
    if (!node || visited.has(nodeId)) {
      return;
    }

    visited.add(nodeId);
    entries.push({ node, depth: Math.min(depth, 4) });
    (children.get(nodeId) || []).forEach(childId => visit(childId, depth + 1));
  };

  roots.forEach(rootId => visit(rootId, 0));
  board.nodes.forEach(node => visit(node.id, 0));

  return entries;
}

function scheduleActionListLinks() {
  requestAnimationFrame(renderActionListLinks);
}

function renderActionListLinks() {
  const board = activeBoard();
  if (normalizeViewMode(board.viewMode) !== "list" || actionListShell.hidden) {
    actionListLinks.innerHTML = "";
    return;
  }

  const nodesById = new Map(board.nodes.map(node => [node.id, node]));
  const elementsById = new Map([...actionList.querySelectorAll(".action-list-item")].map(item => [item.dataset.id, item]));
  const shellRect = actionListShell.getBoundingClientRect();
  const width = actionListShell.clientWidth;
  const height = Math.max(actionListShell.scrollHeight, actionListShell.clientHeight);

  actionListLinks.innerHTML = "";
  actionListLinks.style.width = `${width}px`;
  actionListLinks.style.height = `${height}px`;
  actionListLinks.setAttribute("viewBox", `0 0 ${width} ${height}`);

  board.links.forEach(link => {
    const fromNode = nodesById.get(link.from);
    const toNode = nodesById.get(link.to);
    const fromEl = elementsById.get(link.from);
    const toEl = elementsById.get(link.to);
    if (!fromNode || !toNode || !fromEl || !toEl) {
      return;
    }

    const start = getActionListAnchorPoint(fromEl, shellRect);
    const end = getActionListAnchorPoint(toEl, shellRect);
    const ANCHOR_GAP = 6;
    const direction = end.y >= start.y ? 1 : -1;
    const startY = start.y + ANCHOR_GAP * direction;
    const endY = end.y;
    const startX = Math.max(16, Math.min(start.x, end.x - 34));
    const endX = end.x;
    const radius = 14;
    const curveY = endY - radius * direction;
    const turnX = Math.min(startX + radius, endX - 8);
    const status = normalizeStatus(toNode.status);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", `action-list-connector status-${status}`);
    path.setAttribute("d", `M ${startX} ${startY} V ${curveY} Q ${startX} ${endY} ${turnX} ${endY} H ${endX}`);

    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("class", `action-list-connector-dot status-${status}`);
    dot.setAttribute("cx", endX);
    dot.setAttribute("cy", endY);
    dot.setAttribute("r", "3.5");

    actionListLinks.append(path, dot);
  });
}

function getActionListAnchorPoint(itemEl, shellRect) {
  const anchor = itemEl.querySelector(".action-list-anchor");
  const rect = (anchor || itemEl).getBoundingClientRect();
  const fallbackRect = itemEl.getBoundingClientRect();
  return {
    x: rect.left - shellRect.left + actionListShell.scrollLeft + rect.width / 2,
    y: rect.top - shellRect.top + actionListShell.scrollTop + (anchor ? rect.height / 2 : fallbackRect.height / 2)
  };
}

function renderLinks() {
  const board = activeBoard();
  linkLayer.innerHTML = "";

  const nodesById = new Map(board.nodes.map(node => [node.id, node]));
  board.links = board.links.filter(link => nodesById.has(link.from) && nodesById.has(link.to));
  const bounds = getSvgBounds(board.nodes, linkDragState);
  linkLayer.style.left = `${bounds.x}px`;
  linkLayer.style.top = `${bounds.y}px`;
  linkLayer.style.width = `${bounds.width}px`;
  linkLayer.style.height = `${bounds.height}px`;
  linkLayer.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);

  board.links.forEach(link => {
    const from = nodesById.get(link.from);
    const to = nodesById.get(link.to);
    const fromPort = link.fromPort || "out";
    const toPort = link.toPort || "in";
    const start = getPortPoint(from, fromPort);
    const end = getPortPoint(to, toPort);
    const linkStatus = normalizeStatus(to.status);
    const startStatus = normalizeStatus(from.status);
    const endStatus = normalizeStatus(to.status);
    const lineageActive = lineageState?.linkIds.has(link.id);
    const lineageDim = lineageState && !lineageActive;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", [
      "link-path",
      `status-${linkStatus}`,
      link.id === selectedLinkId ? "selected" : "",
      lineageActive ? "lineage-link" : "",
      lineageDim ? "lineage-dim" : ""
    ].filter(Boolean).join(" "));
    path.setAttribute("d", createLinkPath(start, end, fromPort, toPort));
    path.addEventListener("click", event => {
      event.stopPropagation();
      selectedLinkId = link.id;
      selectedNodeId = null;
      pendingLink = null;
      render();
    });
    path.addEventListener("dblclick", event => {
      event.stopPropagation();
      const board = activeBoard();
      board.links = board.links.filter(l => l.id !== link.id);
      if (selectedLinkId === link.id) selectedLinkId = null;
      saveState();
      render();
    });

    const lineageDotClass = lineageActive ? "lineage-link" : lineageDim ? "lineage-dim" : "";
    const startDot = createSvgDot(start, startStatus, lineageDotClass);
    const endDot = createSvgDot(end, endStatus, lineageDotClass);
    linkLayer.append(path, startDot, endDot);
  });

  if (linkDragState) {
    const source = nodesById.get(linkDragState.nodeId);
    if (source) {
      const dragPort = linkDragState.port;
      const sourcePoint = getPortPoint(source, dragPort);
      const cursorPoint = { x: linkDragState.x, y: linkDragState.y };
      const isOut = isOutputPort(dragPort);
      const fromPoint = isOut ? sourcePoint : cursorPoint;
      const toPoint = isOut ? cursorPoint : sourcePoint;
      const fromPort = isOut ? dragPort : "in";
      const toPort = isOut ? "in" : dragPort;
      const previewStatus = normalizeStatus(source.status);
      const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      previewPath.setAttribute("class", `link-path link-preview status-${previewStatus}`);
      previewPath.setAttribute("d", createLinkPath(fromPoint, toPoint, fromPort, toPort));
      linkLayer.append(previewPath);
    }
  }
}

function getSvgBounds(nodes, drag) {
  const xs = [];
  const ys = [];

  nodes.forEach(node => {
    xs.push(node.x, node.x + (node.w || 232));
    ys.push(node.y, node.y + (node.h || 154));
  });

  if (drag) {
    xs.push(drag.x);
    ys.push(drag.y);
  }

  if (!xs.length) {
    xs.push(-1000, 1000);
    ys.push(-1000, 1000);
  }

  const margin = 1200;
  const minX = Math.min(...xs) - margin;
  const minY = Math.min(...ys) - margin;
  const maxX = Math.max(...xs) + margin;
  const maxY = Math.max(...ys) + margin;

  return {
    x: minX,
    y: minY,
    width: Math.max(2400, maxX - minX),
    height: Math.max(2400, maxY - minY)
  };
}

function createSvgDot(point, status = "ongoing", extraClass = "") {
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("class", ["link-dot", `status-${normalizeStatus(status)}`, extraClass].filter(Boolean).join(" "));
  dot.setAttribute("cx", point.x);
  dot.setAttribute("cy", point.y);
  dot.setAttribute("r", "5");
  return dot;
}

function getPortPoint(node, port) {
  const width = node.w || 232;
  const height = node.h || 154;
  if (port === "top") return { x: node.x + width / 2, y: node.y };
  if (port === "bottom") return { x: node.x + width / 2, y: node.y + height };
  return {
    x: port === "out" ? node.x + width : node.x,
    y: node.y + height / 2
  };
}

function isOutputPort(port) { return port === "out" || port === "bottom"; }
function isInputPort(port) { return port === "in" || port === "top"; }

function createLinkPath(start, end, startPort = "out", endPort = "in") {
  const startVertical = startPort === "top" || startPort === "bottom";
  const endVertical = endPort === "top" || endPort === "bottom";
  if (startVertical || endVertical) {
    const dist = Math.max(80, Math.abs(end.y - start.y) * 0.45);
    const sy = startPort === "top" ? -dist : dist;
    const ey = endPort === "top" ? -dist : dist;
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + sy}, ${end.x} ${end.y + ey}, ${end.x} ${end.y}`;
  }
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
}

function renderUserTasks() {
  const user = activeUser();
  const activeId = activeBoard().id;
  userTaskList.innerHTML = "";

  user.tasks.forEach(task => {
    const status = normalizeStatus(task.status);
    const priority = normalizePriority(task.priority);
    const criticality = normalizeCriticality(task.criticality);
    const card = document.createElement("article");
    card.className = `user-task-card status-${status} priority-${priority} crit-${criticality}${task.id === activeId ? " active" : ""}${task.id === dockDragId ? " dragging" : ""}`;
    card.dataset.id = task.id;
    const hasAttachment = task.attachments?.length > 0;
    card.innerHTML = `
      <div class="user-task-head">
        ${renderCriticalityBadge(criticality)}
        <strong class="user-task-title">${escapeHtml(task.title)}</strong>
        <button class="user-task-info" type="button" aria-label="Informacoes" title="Informacoes">i</button>
        <button class="user-task-remove" type="button" aria-label="Remover main task" title="Remover main task">${icons.close}</button>
      </div>
      <div class="user-task-meta">
        ${task.startDate ? `<span>${formatShortDate(task.startDate)}</span>` : ""}
        ${task.startDate && task.endDate ? `<span class="user-task-meta-sep">→</span>` : ""}
        ${task.endDate ? `<span>${formatShortDate(task.endDate)}</span>` : ""}
        ${hasAttachment ? `<span class="user-task-meta-attach" title="${task.attachments.length} anexo(s)"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>${task.attachments.length}</span>` : ""}
      </div>
    `;

    card.addEventListener("pointerdown", event => startDockTaskDrag(event, task.id));

    card.addEventListener("dblclick", event => {
      if (event.target.closest("button")) {
        return;
      }
      openTaskDialog("edit-task", user.id, task.id);
    });

    card.querySelectorAll("button").forEach(control => {
      control.addEventListener("pointerdown", event => event.stopPropagation());
    });

    card.querySelector(".user-task-info").addEventListener("click", event => {
      const popup = document.querySelector("#taskEditPopup");
      const sameTaskOpen = !popup.hidden && taskEditPopupUserId === user.id && taskEditPopupTaskId === task.id;
      if (sameTaskOpen) {
        closeTaskEditPopup();
      } else {
        openTaskEditPopup(event.currentTarget, user.id, task.id);
      }
    });
    card.querySelector(".user-task-remove").addEventListener("click", () => removeMainTask(task.id));

    userTaskList.appendChild(card);
  });

  requestAnimationFrame(updateDockScrollControls);
}

function renderCriticalityBadge(criticality) {
  const value = normalizeCriticality(criticality);
  return `
    <span class="task-criticality crit-${value}" title="Criticidade ${CRITICALITY_META[value].label}" aria-label="Criticidade ${CRITICALITY_META[value].label}">
      <span></span>
      <span></span>
      <span></span>
    </span>
  `;
}

function startDockTaskDrag(event, taskId) {
  if (event.button !== 0 || event.target.closest("button")) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  event.preventDefault();
  closeTaskEditPopup();
  dockPointerDrag = {
    taskId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    sourceCard: event.currentTarget,
    ghost: null,
    didDrag: false
  };

  const move = moveEvent => {
    if (!dockPointerDrag || moveEvent.pointerId !== dockPointerDrag.pointerId) {
      return;
    }

    const distance = Math.hypot(moveEvent.clientX - dockPointerDrag.startX, moveEvent.clientY - dockPointerDrag.startY);
    if (!dockPointerDrag.didDrag && distance < 6) {
      return;
    }

    if (!dockPointerDrag.didDrag) {
      dockPointerDrag.didDrag = true;
      dockDragId = taskId;
      createDockDragGhost(moveEvent);
      renderUserTasks();
    }

    positionDockDragGhost(moveEvent);
    autoScrollDock(moveEvent.clientX);
    const beforeId = getDockInsertionId(moveEvent.clientX);
    moveMainTaskBefore(taskId, beforeId);
  };

  const stop = upEvent => {
    if (!dockPointerDrag || upEvent.pointerId !== dockPointerDrag.pointerId) {
      return;
    }

    const shouldActivate = !dockPointerDrag.didDrag;
    removeDockDragGhost();
    dockPointerDrag = null;
    dockDragId = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);

    if (shouldActivate) {
      activateTask(taskId);
    } else {
      renderUserTasks();
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function createDockDragGhost(event) {
  if (!dockPointerDrag?.sourceCard || dockPointerDrag.ghost) {
    return;
  }

  const ghost = dockPointerDrag.sourceCard.cloneNode(true);
  ghost.classList.add("dock-drag-ghost");
  ghost.style.width = `${dockPointerDrag.width}px`;
  ghost.style.height = `${dockPointerDrag.height}px`;
  document.body.appendChild(ghost);
  dockPointerDrag.ghost = ghost;
  positionDockDragGhost(event);
}

function positionDockDragGhost(event) {
  const ghost = dockPointerDrag?.ghost;
  if (!ghost) {
    return;
  }

  ghost.style.left = `${event.clientX - dockPointerDrag.offsetX}px`;
  ghost.style.top = `${event.clientY - dockPointerDrag.offsetY}px`;
}

function removeDockDragGhost() {
  dockPointerDrag?.ghost?.remove();
}

function getDockInsertionId(clientX) {
  const cards = [...userTaskList.querySelectorAll(".user-task-card")]
    .filter(card => card.dataset.id !== dockDragId);

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return card.dataset.id;
    }
  }

  return null;
}

function autoScrollDock(clientX) {
  const rect = userTaskList.getBoundingClientRect();
  const threshold = 52;

  if (clientX < rect.left + threshold) {
    userTaskList.scrollLeft -= 18;
  } else if (clientX > rect.right - threshold) {
    userTaskList.scrollLeft += 18;
  }
}

function handleDockWheel(event) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
    return;
  }
  event.preventDefault();
  userTaskList.scrollLeft += event.deltaY;
  updateDockScrollControls();
}

function scrollDockBy(direction) {
  const amount = Math.max(220, userTaskList.clientWidth * 0.72);
  userTaskList.scrollBy({
    left: amount * direction,
    behavior: "smooth"
  });
}

function updateDockScrollControls() {
  const style = getComputedStyle(userTaskList);
  const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const overflow = userTaskList.scrollWidth - horizontalPadding > userTaskList.clientWidth + 2;
  const canScrollLeft = overflow && userTaskList.scrollLeft > 2;
  const canScrollRight = overflow && userTaskList.scrollLeft < userTaskList.scrollWidth - userTaskList.clientWidth - 2;

  userTaskDock.classList.toggle("has-dock-scroll", overflow);
  dockScrollLeft.hidden = !canScrollLeft;
  dockScrollRight.hidden = !canScrollRight;
}

function moveMainTaskBefore(sourceId, beforeId) {
  const user = activeUser();
  if (!sourceId || sourceId === beforeId) {
    return;
  }

  const fromIndex = user.tasks.findIndex(task => task.id === sourceId);
  if (fromIndex < 0) {
    return;
  }

  const currentBeforeId = user.tasks[fromIndex + 1]?.id || null;
  if (currentBeforeId === beforeId) {
    return;
  }

  const previousRects = captureDockCardRects();
  const [item] = user.tasks.splice(fromIndex, 1);
  const toIndex = beforeId ? user.tasks.findIndex(task => task.id === beforeId) : user.tasks.length;
  const insertionIndex = toIndex < 0 ? user.tasks.length : toIndex;
  user.tasks.splice(insertionIndex, 0, item);
  saveState();
  renderUserTasks();
  animateDockReorder(previousRects);
}

function captureDockCardRects() {
  const rects = new Map();
  userTaskList.querySelectorAll(".user-task-card").forEach(card => {
    const rect = card.getBoundingClientRect();
    rects.set(card.dataset.id, { left: rect.left, top: rect.top });
  });
  return rects;
}

function animateDockReorder(previousRects) {
  requestAnimationFrame(() => {
    userTaskList.querySelectorAll(".user-task-card").forEach(card => {
      if (card.dataset.id === dockDragId) {
        return;
      }

      const previous = previousRects.get(card.dataset.id);
      if (!previous) {
        return;
      }

      const current = card.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return;
      }

      card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" }
        ],
        {
          duration: 230,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)"
        }
      );
    });
  });
}

function applyViewport() {
  const view = activeView();
  const gridSize = Math.max(14, 24 * view.zoom);
  boardShell.style.setProperty("--grid-size", `${gridSize}px`);
  boardShell.style.setProperty("--grid-x", `${view.panX}px`);
  boardShell.style.setProperty("--grid-y", `${view.panY}px`);
  boardSurface.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
}

function ensureCanvasPositions() {
  const board = activeBoard();
  let changed = false;
  const placed = [];

  board.nodes.forEach((node, index) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || (isDefaultNewAction(node) && overlapsPlacedNodes(node, placed))) {
      const position = getNextActionPosition(board, index);
      node.x = position.x;
      node.y = position.y;
      changed = true;
    }
    placed.push(node);
  });

  if (changed) {
    saveState();
  }
}

function isDefaultNewAction(node) {
  return node.title === "Nova acao" && !String(node.body || "").trim();
}

function overlapsPlacedNodes(node, placed) {
  return placed.some(other => {
    const overlapX = Math.max(0, Math.min(node.x + (node.w || 232), other.x + (other.w || 232)) - Math.max(node.x, other.x));
    const overlapY = Math.max(0, Math.min(node.y + (node.h || 154), other.y + (other.h || 154)) - Math.max(node.y, other.y));
    const overlapArea = overlapX * overlapY;
    const nodeArea = (node.w || 232) * (node.h || 154);
    return overlapArea / nodeArea > 0.65;
  });
}

function getNextActionPosition(board, indexOverride = null) {
  const width = 232;
  const height = 154;
  const nodes = indexOverride == null ? board.nodes : board.nodes.slice(0, indexOverride);

  if (!nodes.length) {
    const rect = boardShell.getBoundingClientRect();
    const center = screenToWorld(rect.left + boardShell.clientWidth / 2, rect.top + boardShell.clientHeight / 2);
    return { x: center.x - width / 2, y: center.y - height / 2 };
  }

  const last = nodes[nodes.length - 1];
  return {
    x: last.x + (last.w || width) + 120,
    y: last.y
  };
}

function centerCanvasOnTasks() {
  const board = activeBoard();
  if (!board.nodes.length) {
    const view = activeView();
    view.zoom = 1;
    view.panX = boardShell.clientWidth / 2;
    view.panY = boardShell.clientHeight / 2;
    saveState();
    applyViewport();
    renderLinks();
    return;
  }

  const minX = Math.min(...board.nodes.map(node => node.x));
  const minY = Math.min(...board.nodes.map(node => node.y));
  const maxX = Math.max(...board.nodes.map(node => node.x + (node.w || 232)));
  const maxY = Math.max(...board.nodes.map(node => node.y + (node.h || 154)));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = 96;
  const zoom = clamp(
    Math.min(
      (boardShell.clientWidth - padding * 2) / contentWidth,
      (boardShell.clientHeight - padding * 2) / contentHeight,
      1.15
    ),
    MIN_ZOOM,
    MAX_ZOOM
  );
  const centerX = minX + contentWidth / 2;
  const centerY = minY + contentHeight / 2;
  const view = activeView();

  view.zoom = zoom;
  view.panX = boardShell.clientWidth / 2 - centerX * zoom;
  view.panY = boardShell.clientHeight / 2 - centerY * zoom;

  saveState();
  applyViewport();
  renderLinks();
}

function organizeCanvasCards() {
  const board = activeBoard();
  if (board.viewMode !== "canvas" || !board.nodes.length) {
    return;
  }

  clearLineagePreview(false);

  const nodesById = new Map(board.nodes.map(node => [node.id, node]));
  const canvasOrder = (a, b) => {
    const first = nodesById.get(a);
    const second = nodesById.get(b);
    return ((first?.y ?? 0) - (second?.y ?? 0)) || ((first?.x ?? 0) - (second?.x ?? 0));
  };
  const children = new Map(board.nodes.map(node => [node.id, []]));
  const parentById = new Map();

  board.links.forEach(link => {
    if (!nodesById.has(link.from) || !nodesById.has(link.to) || link.from === link.to) {
      return;
    }

    if (!parentById.has(link.to)) {
      parentById.set(link.to, link.from);
      children.get(link.from)?.push(link.to);
    }
  });

  children.forEach(items => items.sort(canvasOrder));

  const roots = board.nodes
    .map(node => node.id)
    .filter(id => !parentById.has(id))
    .sort(canvasOrder);
  const orderedRoots = roots.length ? roots : [board.nodes[0].id];
  const maxWidth = Math.max(...board.nodes.map(node => node.w || 232));
  const minX = Math.min(...board.nodes.map(node => Number.isFinite(node.x) ? node.x : 0));
  const minY = Math.min(...board.nodes.map(node => Number.isFinite(node.y) ? node.y : 0));
  const originX = Number.isFinite(minX) ? minX : 80;
  const originY = Number.isFinite(minY) ? minY : 80;
  const columnGap = maxWidth + 120;
  const rowGap = 56;
  const columnBottom = [];
  const visited = new Set();
  const positions = new Map();
  let nextY = originY;

  const layout = (nodeId, depth) => {
    const node = nodesById.get(nodeId);
    if (!node || visited.has(nodeId)) {
      return null;
    }

    visited.add(nodeId);
    const childCenters = (children.get(nodeId) || [])
      .map(childId => layout(childId, depth + 1))
      .filter(value => Number.isFinite(value));
    const height = node.h || 154;
    let centerY;

    if (childCenters.length) {
      centerY = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
    } else {
      centerY = nextY + height / 2;
      nextY += height + rowGap;
    }

    const desiredY = centerY - height / 2;
    const y = Math.max(desiredY, columnBottom[depth] ?? originY);
    centerY = y + height / 2;
    columnBottom[depth] = y + height + rowGap;
    nextY = Math.max(nextY, y + height + rowGap);

    positions.set(nodeId, {
      x: originX + depth * columnGap,
      y
    });

    return centerY;
  };

  orderedRoots.forEach(rootId => {
    layout(rootId, 0);
  });

  board.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      layout(node.id, 0);
    }
  });

  board.nodes.forEach(node => {
    const position = positions.get(node.id);
    if (!position) {
      return;
    }

    node.x = position.x;
    node.y = position.y;
  });

  saveState();
  renderNodes();
  renderLinks();
}

let zoomAnimHandle = null;
let zoomTarget = null;

function finalizeZoomAnim() {
  if (zoomAnimHandle !== null) {
    cancelAnimationFrame(zoomAnimHandle);
    zoomAnimHandle = null;
  }
  if (zoomTarget) {
    const { view, zoom, panX, panY } = zoomTarget;
    view.zoom = zoom;
    view.panX = panX;
    view.panY = panY;
    zoomTarget = null;
    applyViewport();
    saveState();
  }
}

function stepZoomAnim() {
  zoomAnimHandle = null;
  if (!zoomTarget) {
    return;
  }
  const { view, zoom, panX, panY } = zoomTarget;
  const lerp = 0.22;
  view.zoom += (zoom - view.zoom) * lerp;
  view.panX += (panX - view.panX) * lerp;
  view.panY += (panY - view.panY) * lerp;
  applyViewport();

  if (Math.abs(view.zoom - zoom) < 0.0008 && Math.abs(view.panX - panX) < 0.4 && Math.abs(view.panY - panY) < 0.4) {
    view.zoom = zoom;
    view.panX = panX;
    view.panY = panY;
    applyViewport();
    zoomTarget = null;
    saveState();
  } else {
    zoomAnimHandle = requestAnimationFrame(stepZoomAnim);
  }
}

function handleZoom(event) {
  if (activeBoard().viewMode === "list") {
    return;
  }

  event.preventDefault();
  const view = activeView();
  const before = screenToWorld(event.clientX, event.clientY);
  const delta = Math.max(-120, Math.min(120, event.deltaY));
  const baseZoom = zoomTarget && zoomTarget.view === view ? zoomTarget.zoom : view.zoom;
  const nextZoom = clamp(baseZoom * Math.exp(-delta * 0.0015), MIN_ZOOM, MAX_ZOOM);
  const rect = boardShell.getBoundingClientRect();

  zoomTarget = {
    view,
    zoom: nextZoom,
    panX: event.clientX - rect.left - before.x * nextZoom,
    panY: event.clientY - rect.top - before.y * nextZoom
  };

  if (zoomAnimHandle === null) {
    zoomAnimHandle = requestAnimationFrame(stepZoomAnim);
  }
}

function handleBoardPointerDown(event) {
  if (!isBoardBackground(event.target) || event.button !== 0) {
    return;
  }

  finalizeZoomAnim();
  clearSelection();
  refreshSelectionClasses();

  const view = activeView();
  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: view.panX,
    panY: view.panY
  };

  boardShell.classList.add("panning");
  boardShell.setPointerCapture(event.pointerId);

  const move = moveEvent => {
    if (!panState || moveEvent.pointerId !== panState.pointerId) {
      return;
    }

    view.panX = panState.panX + moveEvent.clientX - panState.startX;
    view.panY = panState.panY + moveEvent.clientY - panState.startY;
    applyViewport();
  };

  const stop = upEvent => {
    if (!panState || upEvent.pointerId !== panState.pointerId) {
      return;
    }

    panState = null;
    boardShell.classList.remove("panning");
    saveState();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function isBoardBackground(target) {
  return target === boardShell || target === boardSurface || target === nodesLayer || target === linkLayer;
}

function screenToWorld(clientX, clientY) {
  const view = activeView();
  const rect = boardShell.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.panX) / view.zoom,
    y: (clientY - rect.top - view.panY) / view.zoom
  };
}

function refreshSelectionClasses() {
  document.querySelectorAll(".task-card").forEach(card => {
    card.classList.toggle("selected", card.dataset.id === selectedNodeId);
  });
}

function addAction(parentId = null) {
  const board = activeBoard();
  const id = makeId("action");
  const listMode = board.viewMode === "list";
  const replyParentId = listMode && board.nodes.some(node => node.id === parentId) ? parentId : null;
  const position = replyParentId
    ? getReplyActionPosition(board, replyParentId)
    : listMode
      ? getNextActionPosition(board)
      : getViewportActionPosition();
  const node = {
    id,
    title: "Nova acao",
    body: "",
    status: "ongoing",
    x: position.x,
    y: position.y,
    w: 232,
    h: 154
  };

  if (replyParentId) {
    board.nodes.splice(getReplyInsertionIndex(board, replyParentId), 0, node);
    addLink(replyParentId, id, "out", "in");
  } else {
    board.nodes.push(node);
  }

  if (listMode) {
    pendingListPop.add(id);
  }
  pendingCardPop.add(id);
  selectedNodeId = id;
  selectedLinkId = null;
  saveState();
  render();
}

function getReplyActionPosition(board, parentId) {
  const parent = board.nodes.find(node => node.id === parentId);
  if (!parent) {
    return getNextActionPosition(board);
  }

  const childCount = board.links.filter(link => link.from === parentId).length;
  return {
    x: parent.x + (parent.w || 232) + 120,
    y: parent.y + childCount * 190
  };
}

function getReplyInsertionIndex(board, parentId) {
  const parentIndex = board.nodes.findIndex(node => node.id === parentId);
  if (parentIndex < 0) {
    return board.nodes.length;
  }

  const descendants = getDescendantActionIds(board, parentId);
  let lastIndex = parentIndex;
  board.nodes.forEach((node, index) => {
    if (descendants.has(node.id)) {
      lastIndex = Math.max(lastIndex, index);
    }
  });

  return lastIndex + 1;
}

function getDescendantActionIds(board, parentId) {
  const outgoing = new Map(board.nodes.map(node => [node.id, []]));
  board.links.forEach(link => {
    if (outgoing.has(link.from) && outgoing.has(link.to)) {
      outgoing.get(link.from).push(link.to);
    }
  });

  const descendants = new Set();
  const visit = nodeId => {
    (outgoing.get(nodeId) || []).forEach(childId => {
      if (descendants.has(childId)) {
        return;
      }
      descendants.add(childId);
      visit(childId);
    });
  };

  visit(parentId);
  return descendants;
}

function handleBoardContextMenu(event) {
  if (!isBoardBackground(event.target)) return;
  event.preventDefault();
  const board = activeBoard();
  if (!board || board.viewMode !== "canvas") return;
  newCardPosition = screenToWorld(event.clientX, event.clientY);
  newCardTitleInput.value = "";
  newCardStatusInput.value = "ongoing";

  const margin = 8;
  const popupW = 210;
  const popupH = 120;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(event.clientX + margin, vw - popupW - margin);
  const top = Math.min(event.clientY + margin, vh - popupH - margin);
  newCardForm.style.left = left + "px";
  newCardForm.style.top = top + "px";
  newCardForm.hidden = false;
  requestAnimationFrame(() => newCardTitleInput.focus());
}

function closeNewCardModal() {
  newCardForm.hidden = true;
  newCardPosition = null;
}

function saveNewCard(event) {
  event.preventDefault();
  const board = activeBoard();
  if (!board) return;
  const pos = newCardPosition ?? getViewportActionPosition();
  const id = makeId("action");
  board.nodes.push({
    id,
    title: (newCardTitleInput.value.trim() || "Nova acao").slice(0, 80),
    body: "",
    status: normalizeStatus(newCardStatusInput.value),
    x: pos.x - 116,
    y: pos.y - 77,
    w: 232,
    h: 154
  });
  pendingCardPop.add(id);
  selectedNodeId = id;
  selectedLinkId = null;
  closeNewCardModal();
  saveState();
  render();
}

function openUserCreatePopup(event) {
  event.preventDefault();
  closeNewCardModal();
  closeTaskEditPopup();
  closeAttachmentsPopup();

  userCreateNameInput.value = "";
  const rect = addBoardButton.getBoundingClientRect();
  const margin = 8;
  const popupW = 220;
  const left = Math.min(Math.max(margin, rect.right - popupW), window.innerWidth - popupW - margin);
  const top = Math.min(rect.bottom + margin, window.innerHeight - 120);

  userCreateForm.style.left = `${left}px`;
  userCreateForm.style.top = `${top}px`;
  userCreateForm.hidden = false;
  requestAnimationFrame(() => userCreateNameInput.focus());
}

function closeUserCreatePopup() {
  userCreateForm.hidden = true;
}

function saveUserCreatePopup(event) {
  event.preventDefault();
  const name = (userCreateNameInput.value.trim() || `User ${state.users.length + 1}`).slice(0, 28);
  const user = createUser(name, [createMainTask({ title: "Main task 1" }, 0)]);
  state.users.push(user);
  state.activeUserId = user.id;
  clearSelection();
  closeUserCreatePopup();
  saveState();
  render();
}

function getViewportActionPosition() {
  const rect = boardShell.getBoundingClientRect();
  const center = screenToWorld(rect.left + boardShell.clientWidth / 2, rect.top + boardShell.clientHeight / 2);
  return {
    x: center.x - 116,
    y: center.y - 77
  };
}

function openTaskDialog(mode = "create-task", userId = null, taskId = null) {
  dialogMode = mode;
  dialogUserId = userId;
  dialogTaskId = taskId;
  const userOnlyMode = mode === "create-user" || mode === "edit-user";

  const user = userId ? state.users.find(item => item.id === userId) : activeUser();
  const task = taskId ? user?.tasks.find(item => item.id === taskId) : activeBoard();

  canvasModalTitle.textContent = mode === "create-user"
    ? "Novo usuario"
    : mode === "edit-user"
      ? "Editar usuario"
      : mode === "edit-task"
        ? "Editar main task"
        : "Nova main task";
  canvasForm.classList.toggle("user-only", userOnlyMode);
  canvasOwnerLabel.textContent = userOnlyMode ? "Nome" : "Usuario";
  canvasOwnerInput.disabled = mode === "create-task" || mode === "edit-task";
  canvasNameInput.required = !userOnlyMode;
  canvasOwnerInput.value = mode === "create-user" ? "" : user?.name || "";
  canvasNameInput.value = mode === "create-task" ? `Main task ${((user?.tasks.length || 0) + 1)}` : mode === "create-user" ? "" : task?.title || "";
  canvasStartInput.value = task?.startDate || normalizeDate();
  canvasEndInput.value = task?.endDate || normalizeDate(null, 7);
  canvasPriorityInput.value = normalizePriority(task?.priority);
  canvasStatusInput.value = normalizeStatus(task?.status);
  canvasModal.hidden = false;
  requestAnimationFrame(() => (mode.includes("user") ? canvasOwnerInput : canvasNameInput).focus());
}

function closeTaskDialog() {
  canvasModal.hidden = true;
  canvasForm.classList.remove("user-only");
  canvasOwnerInput.disabled = false;
  canvasNameInput.required = true;
  dialogUserId = null;
  dialogTaskId = null;
}

function saveTaskDialog(event) {
  event.preventDefault();
  if (dialogMode === "create-user") {
    const userName = (canvasOwnerInput.value.trim() || `User ${state.users.length + 1}`).slice(0, 28);
    const user = createUser(userName, [createMainTask({ title: "Main task 1" }, 0)]);
    state.users.push(user);
    state.activeUserId = user.id;
    clearSelection();
    closeTaskDialog();
    saveState();
    render();
    return;
  }

  const data = {
    title: (canvasNameInput.value.trim() || "Nova main task").slice(0, 56),
    status: normalizeStatus(canvasStatusInput.value),
    priority: normalizePriority(canvasPriorityInput.value),
    startDate: canvasStartInput.value || normalizeDate(),
    endDate: canvasEndInput.value || normalizeDate(null, 7)
  };

  if (dialogMode === "edit-user") {
    const user = state.users.find(item => item.id === dialogUserId);
    if (user) {
      user.name = (canvasOwnerInput.value.trim() || user.name).slice(0, 28);
    }
  } else if (dialogMode === "edit-task") {
    const user = state.users.find(item => item.id === dialogUserId);
    const task = user?.tasks.find(item => item.id === dialogTaskId);
    if (task) {
      Object.assign(task, data);
      user.activeTaskId = task.id;
    }
  } else {
    const user = activeUser();
    const task = createMainTask(data, user.tasks.length);
    user.tasks.push(task);
    user.activeTaskId = task.id;
  }

  clearSelection();
  closeTaskDialog();
  saveState();
  render();
}

let taskEditPopupUserId = null;
let taskEditPopupTaskId = null;

function openTaskEditPopup(anchorEl, userId, taskId) {
  const user = state.users.find(u => u.id === userId);
  const task = user?.tasks.find(t => t.id === taskId);
  if (!task) return;

  taskEditPopupUserId = userId;
  taskEditPopupTaskId = taskId;

  const popup = document.querySelector("#taskEditPopup");
  popup.querySelector("#tepNameInput").value = task.title || "";
  popup.querySelector("#tepStartInput").value = task.startDate || "";
  popup.querySelector("#tepEndInput").value = task.endDate || "";
  popup.querySelector("#tepPriorityInput").value = normalizePriority(task.priority);
  popup.querySelector("#tepStatusInput").value = normalizeStatus(task.status);

  popup.hidden = false;

  const anchorRect = anchorEl.closest(".user-task-card").getBoundingClientRect();
  const popupW = 240;
  const popupH = popup.offsetHeight || 220;
  const margin = 8;
  const top = anchorRect.top - popupH - margin;
  const left = Math.min(anchorRect.left, window.innerWidth - popupW - margin);
  popup.style.left = Math.max(margin, left) + "px";
  popup.style.top = Math.max(margin, top) + "px";

  requestAnimationFrame(() => popup.querySelector("#tepNameInput").focus());
}

function closeTaskEditPopup() {
  document.querySelector("#taskEditPopup").hidden = true;
  taskEditPopupUserId = null;
  taskEditPopupTaskId = null;
}

function saveTaskEditPopup(event) {
  event.preventDefault();
  const user = state.users.find(u => u.id === taskEditPopupUserId);
  const task = user?.tasks.find(t => t.id === taskEditPopupTaskId);
  if (!task) return;

  const popup = document.querySelector("#taskEditPopup");
  task.title = (popup.querySelector("#tepNameInput").value.trim() || task.title).slice(0, 56);
  task.startDate = popup.querySelector("#tepStartInput").value || normalizeDate();
  task.endDate = popup.querySelector("#tepEndInput").value || normalizeDate(null, 7);
  task.priority = normalizePriority(popup.querySelector("#tepPriorityInput").value);
  task.status = normalizeStatus(popup.querySelector("#tepStatusInput").value);

  closeTaskEditPopup();
  saveState();
  render();
}

function removeMainTask(taskId) {
  const user = activeUser();
  if (user.tasks.length <= 1) {
    return;
  }

  const index = user.tasks.findIndex(task => task.id === taskId);
  if (index < 0) {
    return;
  }

  user.tasks.splice(index, 1);
  if (user.activeTaskId === taskId) {
    user.activeTaskId = user.tasks[Math.max(0, index - 1)]?.id || user.tasks[0].id;
    clearSelection();
  }

  saveState();
  render();
}

function findSnapTarget(drag, cursorWorld) {
  const board = activeBoard();
  const zoom = board.view?.zoom || 1;
  const snapRadiusWorld = 32 / zoom;

  const candidatePort = isOutputPort(drag.port) ? "in" : "out";

  let best = null;
  let bestDist = snapRadiusWorld;

  for (const node of board.nodes) {
    if (node.id === drag.nodeId) continue;
    const point = getPortPoint(node, candidatePort);
    const dist = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { nodeId: node.id, port: candidatePort, point };
    }
  }

  return best;
}

function startLinkDrag(event, nodeId, port) {
  event.preventDefault();
  event.stopPropagation();

  const point = screenToWorld(event.clientX, event.clientY);
  linkMode = true;
  pendingLink = null;
  selectedNodeId = nodeId;
  selectedLinkId = null;
  linkDragState = {
    nodeId,
    port,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    x: point.x,
    y: point.y,
    portEl: event.currentTarget,
    hoverPortEl: null
  };

  event.currentTarget.classList.add("pending");
  event.currentTarget.setPointerCapture(event.pointerId);
  renderToolbar();
  refreshSelectionClasses();
  renderLinks();

  const move = moveEvent => {
    if (!linkDragState || moveEvent.pointerId !== linkDragState.pointerId) {
      return;
    }

    const cursorWorld = screenToWorld(moveEvent.clientX, moveEvent.clientY);
    const snap = findSnapTarget(linkDragState, cursorWorld);

    if (snap) {
      linkDragState.x = snap.point.x;
      linkDragState.y = snap.point.y;
      linkDragState.snappedNodeId = snap.nodeId;
      linkDragState.snappedPort = snap.port;
    } else {
      linkDragState.x = cursorWorld.x;
      linkDragState.y = cursorWorld.y;
      linkDragState.snappedNodeId = null;
      linkDragState.snappedPort = null;
    }

    const hoverPort = snap
      ? document.querySelector(`.task-card[data-id="${snap.nodeId}"] .port-${snap.port}`)
      : null;

    if (linkDragState.hoverPortEl && linkDragState.hoverPortEl !== hoverPort) {
      linkDragState.hoverPortEl.classList.remove("target");
      linkDragState.hoverPortEl = null;
    }

    if (hoverPort) {
      linkDragState.portEl.classList.add("will-connect");
      if (hoverPort !== linkDragState.hoverPortEl) {
        hoverPort.classList.add("target");
        linkDragState.hoverPortEl = hoverPort;
      }
    } else {
      linkDragState.portEl.classList.remove("will-connect");
    }

    renderLinks();
  };

  const stop = upEvent => {
    if (!linkDragState || upEvent.pointerId !== linkDragState.pointerId) {
      return;
    }

    finishLinkDrag(upEvent);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function finishLinkDrag(event) {
  const drag = linkDragState;
  linkDragState = null;

  let targetNodeId = null;
  let targetPort = null;

  if (drag.snappedNodeId && drag.snappedPort) {
    targetNodeId = drag.snappedNodeId;
    targetPort = drag.snappedPort;
  } else {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const portEl = target?.closest(".port");
    const targetCard = portEl?.closest(".task-card");
    targetNodeId = targetCard?.dataset.id;
    targetPort = portEl?.dataset.port;
  }

  let createdNodeId = null;

  if (targetNodeId && targetNodeId !== drag.nodeId && targetPort) {
    const isForward = isOutputPort(drag.port) && isInputPort(targetPort);
    const isBackward = isInputPort(drag.port) && isOutputPort(targetPort);
    if (isForward) {
      addLink(drag.nodeId, targetNodeId, drag.port, targetPort);
      selectedNodeId = targetNodeId;
    } else if (isBackward) {
      addLink(targetNodeId, drag.nodeId, targetPort, drag.port);
      selectedNodeId = targetNodeId;
    }
  } else if (isPointInsideBoard(event.clientX, event.clientY)) {
    const clickLike = Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < 6;
    createdNodeId = createCardFromConnection(drag, screenToWorld(event.clientX, event.clientY), clickLike);
  }

  if (createdNodeId) {
    selectedNodeId = createdNodeId;
  }

  saveState();
  render();
}

function createCardFromConnection(drag, dropPoint, useReplySpacing = false) {
  const board = activeBoard();
  const id = makeId("action");
  const width = 232;
  const height = 154;

  const position = useReplySpacing
    ? getConnectionClickPosition(board, drag, width, height)
    : null;
  const xOffset = drag.port === "in" ? -width : drag.port === "top" || drag.port === "bottom" ? -width / 2 : 0;
  const yOffset = drag.port === "top" ? -height : drag.port === "bottom" ? 0 : -height / 2;
  board.nodes.push({
    id,
    title: "Nova acao",
    body: "",
    status: "ongoing",
    x: position ? position.x : dropPoint.x + xOffset,
    y: position ? position.y : dropPoint.y + yOffset,
    w: width,
    h: height
  });
  pendingCardPop.add(id);

  if (isOutputPort(drag.port)) {
    addLink(drag.nodeId, id, drag.port, drag.port === "bottom" ? "top" : "in");
  } else {
    addLink(id, drag.nodeId, drag.port === "top" ? "bottom" : "out", drag.port);
  }

  return id;
}

function getConnectionClickPosition(board, drag, width, height) {
  const source = board.nodes.find(node => node.id === drag.nodeId);
  if (!source) {
    return getNextActionPosition(board);
  }

  if (drag.port === "out") {
    return getReplyActionPosition(board, drag.nodeId);
  }

  if (drag.port === "in") {
    const incomingCount = board.links.filter(link => link.to === drag.nodeId).length;
    return {
      x: source.x - width - 120,
      y: source.y + incomingCount * 190
    };
  }

  if (drag.port === "bottom") {
    const childCount = board.links.filter(link => link.from === drag.nodeId).length;
    return {
      x: source.x,
      y: source.y + (source.h || height) + 120 + childCount * 190
    };
  }

  const incomingCount = board.links.filter(link => link.to === drag.nodeId).length;
  return {
    x: source.x,
    y: source.y - height - 120 - incomingCount * 190
  };
}

function addLink(from, to, fromPort = "out", toPort = "in") {
  const board = activeBoard();
  if (!from || !to || from === to) {
    return false;
  }

  if (board.links.some(link => link.from === from && link.to === to && link.fromPort === fromPort && link.toPort === toPort)) {
    return false;
  }

  board.links.push({ id: makeId("link"), from, to, fromPort, toPort });
  return true;
}

function isPointInsideBoard(clientX, clientY) {
  const rect = boardShell.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function removeSelection() {
  if (selectedNodeId) {
    removeNode(selectedNodeId);
    return;
  }

  if (selectedLinkId) {
    const board = activeBoard();
    board.links = board.links.filter(link => link.id !== selectedLinkId);
    selectedLinkId = null;
    saveState();
    render();
  }
}

function removeNode(nodeId) {
  const board = activeBoard();
  const removingIds = board.viewMode === "list"
    ? getActionThreadIds(board, nodeId)
    : new Set([nodeId]);

  if (board.viewMode === "list") {
    const items = [...actionList.querySelectorAll(".action-list-item")]
      .filter(element => removingIds.has(element.dataset.id));

    if (items.length && items.every(item => !item.classList.contains("list-removing"))) {
      let remaining = items.length;
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        actionListLinks.style.opacity = "";
        removeNodesImmediately(removingIds);
      };

      actionListLinks.style.opacity = "0";
      items.forEach(item => {
      item.style.setProperty("--remove-height", `${item.offsetHeight}px`);
      item.classList.add("list-removing");
      item.addEventListener("animationend", () => {
        remaining -= 1;
        if (remaining <= 0) {
          finish();
        }
      }, { once: true });
      });
      window.setTimeout(finish, 360);
      return;
    }
  }

  removeNodesImmediately(removingIds);
}

function getActionThreadIds(board, nodeId) {
  const ids = getDescendantActionIds(board, nodeId);
  ids.add(nodeId);
  return ids;
}

function removeNodesImmediately(nodeIds) {
  const board = activeBoard();
  const ids = nodeIds instanceof Set ? nodeIds : new Set([nodeIds]);
  const removedSelectedLink = board.links.some(link => link.id === selectedLinkId && (ids.has(link.from) || ids.has(link.to)));

  board.nodes = board.nodes.filter(node => !ids.has(node.id));
  board.links = board.links.filter(link => !ids.has(link.from) && !ids.has(link.to));
  if (selectedNodeId && ids.has(selectedNodeId)) {
    selectedNodeId = null;
  }
  if (selectedLinkId && removedSelectedLink) {
    selectedLinkId = null;
  }
  if (pendingLink && ids.has(pendingLink.from)) {
    pendingLink = null;
  }
  saveState();
  render();
}

function startResize(event, nodeId) {
  const board = activeBoard();
  const node = board.nodes.find(item => item.id === nodeId);
  if (!node) {
    return;
  }

  finalizeZoomAnim();
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.setPointerCapture(event.pointerId);
  selectedNodeId = nodeId;
  selectedLinkId = null;
  resizeState = {
    nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: node.w || 232,
    height: node.h || 154
  };

  const card = nodesLayer.querySelector(`[data-id="${nodeId}"]`);
  card?.classList.add("resizing", "selected");

  const move = moveEvent => {
    if (!resizeState || moveEvent.pointerId !== resizeState.pointerId) {
      return;
    }

    const zoom = activeView().zoom;
    const dx = (moveEvent.clientX - resizeState.startX) / zoom;
    const dy = (moveEvent.clientY - resizeState.startY) / zoom;
    node.w = clamp(resizeState.width + dx, 190, 420);
    node.h = clamp(resizeState.height + dy, 132, 600);

    if (card) {
      card.style.width = `${node.w}px`;
      card.style.height = `${node.h}px`;
    }
    renderLinks();
  };

  const stop = upEvent => {
    if (!resizeState || upEvent.pointerId !== resizeState.pointerId) {
      return;
    }

    resizeState = null;
    saveState();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    renderNodes();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function startDrag(event, nodeId) {
  const board = activeBoard();
  const node = board.nodes.find(item => item.id === nodeId);
  if (!node) {
    return;
  }

  finalizeZoomAnim();
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  selectedNodeId = nodeId;
  selectedLinkId = null;
  dragState = {
    nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    nodeX: node.x,
    nodeY: node.y
  };

  const card = nodesLayer.querySelector(`[data-id="${nodeId}"]`);
  card?.classList.add("dragging", "selected");

  const move = moveEvent => {
    if (!dragState || moveEvent.pointerId !== dragState.pointerId) {
      return;
    }

    const zoom = activeView().zoom;
    node.x = dragState.nodeX + (moveEvent.clientX - dragState.startX) / zoom;
    node.y = dragState.nodeY + (moveEvent.clientY - dragState.startY) / zoom;

    if (card) {
      card.style.left = `${node.x}px`;
      card.style.top = `${node.y}px`;
    }
    renderLinks();
  };

  const stop = upEvent => {
    if (!dragState || upEvent.pointerId !== dragState.pointerId) {
      return;
    }

    dragState = null;
    saveState();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    renderNodes();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function nextStatus(status) {
  const current = STATUS_ORDER.indexOf(normalizeStatus(status));
  return STATUS_ORDER[(current + 1) % STATUS_ORDER.length];
}

function initials(value = "") {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return "U";
  }
  return words.slice(0, 2).map(word => word[0]).join("").toUpperCase();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function activeMainTask() {
  const user = activeUser();
  if (!user) return null;
  return user.tasks.find(t => t.id === user.activeTaskId) || user.tasks[0] || null;
}

async function attachFromBytes(file) {
  if (!invoke) return null;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return null;
  try {
    const buffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const info = await invoke("attachment_save_from_bytes", {
      userId: user.id,
      fileName: file.name,
      bytes
    });
    pushAttachment(task, info);
    return info;
  } catch (error) {
    console.warn("Falha ao anexar arquivo", error);
    return null;
  }
}

async function attachFromPath(sourcePath) {
  if (!invoke) return null;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return null;
  try {
    const info = await invoke("attachment_save_from_path", {
      userId: user.id,
      sourcePath
    });
    pushAttachment(task, info);
    return info;
  } catch (error) {
    console.warn("Falha ao anexar arquivo (path)", error);
    return null;
  }
}

function pushAttachment(task, info) {
  task.attachments = task.attachments || [];
  task.attachments.push({
    id: makeId("att"),
    file: info.file,
    name: info.original_name,
    size: info.size,
    addedAt: Date.now()
  });
  saveState();
  renderUserTasks();
  updateAttachButtonState();
  if (!attachmentsPopup.hidden) {
    renderAttachmentsPopup();
  }
}

async function handleAttachInputChange(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    await attachFromBytes(file);
  }
  event.target.value = "";
}

let dropOverActive = false;
function isPointInsideBoardShell(point) {
  if (!point) return false;
  const rect = boardShell.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const px = Number(point.x) / scale;
  const py = Number(point.y) / scale;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
  return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
}

function setDropOverlay(visible) {
  if (!canvasDropOverlay) return;
  if (visible && !dropOverActive) {
    canvasDropOverlay.hidden = false;
    requestAnimationFrame(() => canvasDropOverlay.classList.add("visible"));
    dropOverActive = true;
  } else if (!visible && dropOverActive) {
    canvasDropOverlay.classList.remove("visible");
    canvasDropOverlay.hidden = true;
    dropOverActive = false;
  }
}

async function setupFileDrop() {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return;

  const onEnter = () => {
    if (activeBoard()?.viewMode === "canvas") setDropOverlay(true);
  };
  const onOver = event => {
    if (activeBoard()?.viewMode !== "canvas") {
      setDropOverlay(false);
      return;
    }
    const inside = isPointInsideBoardShell(event.payload?.position);
    setDropOverlay(inside);
  };
  const onLeave = () => setDropOverlay(false);
  const onDrop = async event => {
    setDropOverlay(false);
    const paths = event.payload?.paths || [];
    if (!paths.length) return;
    if (activeBoard()?.viewMode !== "canvas") return;
    if (!isPointInsideBoardShell(event.payload?.position)) return;
    for (const path of paths) {
      await attachFromPath(path);
    }
  };

  await listen("tauri://drag-enter", onEnter);
  await listen("tauri://drag-over", onOver);
  await listen("tauri://drag-leave", onLeave);
  await listen("tauri://drag-drop", onDrop);
}

function activeTaskHasAttachments() {
  const task = activeMainTask();
  return !!(task?.attachments?.length);
}

function updateAttachButtonState() {
  if (!canvasAttachButton) return;
  canvasAttachButton.classList.toggle("has-attachments", activeTaskHasAttachments());
}

function handleAttachButtonClick() {
  if (activeTaskHasAttachments()) {
    if (attachmentsPopup.hidden) {
      openAttachmentsPopup();
    } else {
      closeAttachmentsPopup();
    }
  } else {
    canvasAttachInput.click();
  }
}

function openAttachmentsPopup() {
  renderAttachmentsPopup();
  attachmentsPopup.hidden = false;
  requestAnimationFrame(() => attachmentsPopup.classList.add("visible"));
}

function closeAttachmentsPopup() {
  attachmentsPopup.classList.remove("visible");
  attachmentsPopup.hidden = true;
}

function renderAttachmentsPopup() {
  const task = activeMainTask();
  const items = task?.attachments || [];
  attachmentsList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "attachments-empty";
    empty.textContent = "Nenhum anexo";
    attachmentsList.appendChild(empty);
    return;
  }

  items.forEach(att => {
    const row = document.createElement("div");
    row.className = "attachments-row";

    const info = document.createElement("div");
    info.className = "attachments-info";
    const name = document.createElement("span");
    name.className = "attachments-name";
    name.textContent = att.name;
    name.title = att.name;
    const meta = document.createElement("span");
    meta.className = "attachments-size";
    meta.textContent = formatFileSize(att.size);
    info.appendChild(name);
    info.appendChild(meta);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "attachments-action";
    openBtn.title = "Abrir";
    openBtn.setAttribute("aria-label", "Abrir");
    openBtn.innerHTML = icons.externalLink;
    openBtn.addEventListener("click", event => {
      event.stopPropagation();
      openAttachment(att);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "attachments-action attachments-action-danger";
    delBtn.title = "Excluir";
    delBtn.setAttribute("aria-label", "Excluir");
    delBtn.innerHTML = icons.trash;
    delBtn.addEventListener("click", event => {
      event.stopPropagation();
      deleteAttachment(att);
    });

    row.appendChild(info);
    row.appendChild(openBtn);
    row.appendChild(delBtn);
    attachmentsList.appendChild(row);
  });
}

async function openAttachment(att) {
  if (!invoke) return;
  const user = activeUser();
  if (!user) return;
  try {
    await invoke("attachment_open", { userId: user.id, file: att.file });
  } catch (e) {
    console.warn("Falha ao abrir anexo", e);
  }
}

async function deleteAttachment(att) {
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;
  if (invoke) {
    try {
      await invoke("attachment_delete", { userId: user.id, file: att.file });
    } catch (e) {
      console.warn("Falha ao excluir arquivo do disco", e);
    }
  }
  task.attachments = (task.attachments || []).filter(a => a.id !== att.id);
  saveState();
  renderUserTasks();
  updateAttachButtonState();
  if (task.attachments.length === 0) {
    closeAttachmentsPopup();
  } else {
    renderAttachmentsPopup();
  }
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
