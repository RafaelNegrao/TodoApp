import { routeLinkPath } from "./linkRouting.js";

const STORAGE_KEY = "todocompanion.state.v4";
const LEGACY_STORAGE_KEYS = ["todocompanion.state.v3", "todocompanion.state.v2", "todocompanion.state.v1"];
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.8;
// Distancia (em pixels de tela) dentro da qual um card "gruda" no alinhamento
// de um card conectado, deixando a linha reta. Convertido para coords do canvas
// dividindo pelo zoom para o "puxao" parecer igual em qualquer nivel de zoom.
const ALIGN_SNAP_SCREEN_PX = 7;
// Folga (px no canvas) mantida entre as linhas e os cards ao contornar.
const LINK_MARGIN = 18;
const LINK_ARROW_END_GAP = 3;
const LINK_ARROW_LENGTH = 8;
const LINK_ARROW_HALF_WIDTH = 8;
const ACTION_LIST_ARROW_LENGTH = 5;
const ACTION_LIST_ARROW_HALF_WIDTH = 5;

const STATUS_ORDER = ["ongoing", "stopped", "complete"];
const STATUS_META = {
  ongoing: { label: "Ongoing" },
  stopped: { label: "Stopped" },
  complete: { label: "Complete" }
};
const PRIORITY_ORDER = ["low", "normal", "high", "urgent"];
const PRIORITY_META = {
  low: { label: "Low" },
  normal: { label: "Normal" },
  high: { label: "High" },
  urgent: { label: "Urgent" }
};
const CRITICALITY_META = [
  { label: "Low" },
  { label: "Medium" },
  { label: "High" }
];

const icons = {
  plus: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  list: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  link: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>`,
  trash: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  eye: `<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  chevronLeft: `<svg class="icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg class="icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>`,
  chevronDown: `<svg class="icon" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
  focus: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M12 8v8M8 12h8"/></svg>`,
  organize: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="5" rx="1.4"/><rect x="15" y="4" width="6" height="5" rx="1.4"/><rect x="9" y="15" width="6" height="5" rx="1.4"/><path d="M9 6.5h6M6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3"/></svg>`,
  edit: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>`,
  paperclip: `<svg class="icon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  file: `<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  image: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  externalLink: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`,
  info: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 18v-8"/><path d="M12 6h.01"/></svg>`,
  grip: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>`,
  sort: `<svg class="icon" viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h5"/></svg>`,
  record: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="12" cy="10.5" r="2.6" fill="currentColor" stroke="none"/></svg>`,
  folder: `<svg class="icon" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  user: `<svg class="icon" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  board: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
  formatBold: `<svg class="icon" viewBox="0 0 24 24"><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></svg>`,
  formatItalic: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 4h8M6 20h8M14.5 4 9.5 20"/></svg>`,
  formatUnderline: `<svg class="icon" viewBox="0 0 24 24"><path d="M6 4v6a6 6 0 0 0 12 0V4"/><path d="M4 20h16"/></svg>`,
  formatStrikethrough: `<svg class="icon" viewBox="0 0 24 24"><path d="M16 4c-1.1-.7-2.7-1-4-1-3.3 0-5.5 1.5-5.5 4 0 1.2.5 2.2 1.5 3"/><path d="M4 12h16"/><path d="M18 16c0 2.5-2.7 4.5-6 4.5-1.8 0-3.5-.5-5-1.5"/></svg>`,
  formatListBulleted: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  formatListNumbered: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 6h11M10 12h11M10 18h11"/><text x="3" y="7" font-size="6" fill="currentColor">1</text><text x="3" y="13" font-size="6" fill="currentColor">2</text><text x="3" y="19" font-size="6" fill="currentColor">3</text></svg>`,
  checkbox: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  formatClear: `<svg class="icon" viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m13.3 9 5.5 5.5"/></svg>`,
  menu: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>`
};

const maximizeAppButton = document.querySelector("#maximizeAppButton");
const minimizeAppButton = document.querySelector("#minimizeAppButton");
const openSearchButton = document.querySelector("#openSearchButton");
const usersRail = document.querySelector("#usersRail");
const usersRailList = document.querySelector("#usersRailList");
const usersRailToggle = document.querySelector("#usersRailToggle");
const nodesLayer = document.querySelector("#nodesLayer");
const linkLayer = document.querySelector("#linkLayer");
const boardSurface = document.querySelector("#boardSurface");
const boardEmpty = document.querySelector("#boardEmpty");
const boardEmptyIcon = document.querySelector("#boardEmptyIcon");
const boardEmptyTitle = document.querySelector("#boardEmptyTitle");
const boardEmptyHint = document.querySelector("#boardEmptyHint");
const boardShell = document.querySelector(".board-shell");
const canvasMetaOverlay = document.querySelector("#canvasMetaOverlay");
const overlayStartInput = document.querySelector("#overlayStartInput");
const overlayEndInput = document.querySelector("#overlayEndInput");
const overlayStatusInput = document.querySelector("#overlayStatusInput");
const overlayCriticalityControl = document.querySelector("#overlayCriticalityControl");
const overlayCriticalityInput = document.querySelector("#overlayCriticalityInput");
const centerCanvasButton = document.querySelector("#centerCanvasButton");
const organizeCanvasButton = document.querySelector("#organizeCanvasButton");
const recordButton = document.querySelector("#recordButton");
const recordingIndicator = document.querySelector("#recordingIndicator");
const canvasAttachButton = document.querySelector("#canvasAttachButton");
const canvasAttachInput = document.querySelector("#canvasAttachInput");
const canvasDropOverlay = document.querySelector("#canvasDropOverlay");
const attachmentsPopup = document.querySelector("#attachmentsPopup");
const attachmentsList = document.querySelector("#attachmentsList");
const attachmentsAdd = document.querySelector("#attachmentsAdd");
const attachmentsOpenFolder = document.querySelector("#attachmentsOpenFolder");
const attachmentReferencePopup = document.querySelector("#attachmentReferencePopup");
const attachmentReferenceList = document.querySelector("#attachmentReferenceList");
const addBoardButton = document.querySelector("#addBoardButton");
const userTaskList = document.querySelector("#userTaskList");
const tasksSidebar = document.querySelector("#tasksSidebar");
const tasksSidebarToggle = document.querySelector("#tasksSidebarToggle");
const tasksSortButton = document.querySelector("#tasksSortButton");
const tasksSortMenu = document.querySelector("#tasksSortMenu");
const tasksStatusFilter = document.querySelector("#tasksStatusFilter");
const addUserTaskButton = document.querySelector("#addUserTaskButton");
const searchModal = document.querySelector("#searchModal");
const searchCloseIcon = document.querySelector("#searchCloseIcon");
const searchInput = document.querySelector("#searchInput");
const searchResults = document.querySelector("#searchResults");
const clipboardAttachModal = document.querySelector("#clipboardAttachModal");
const clipboardAttachClose = document.querySelector("#clipboardAttachClose");
const clipboardAttachPreview = document.querySelector("#clipboardAttachPreview");
const clipboardAttachNameInput = document.querySelector("#clipboardAttachNameInput");
const clipboardAttachExtension = document.querySelector("#clipboardAttachExtension");
const clipboardAttachMeta = document.querySelector("#clipboardAttachMeta");
const clipboardAttachCancel = document.querySelector("#clipboardAttachCancel");
const clipboardAttachConfirm = document.querySelector("#clipboardAttachConfirm");
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
const inlineImageInput = document.querySelector("#inlineImageInput");
const updateImageInput = document.querySelector("#updateImageInput");
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
tasksSortButton.innerHTML = icons.sort;
recordButton.innerHTML = icons.record;
attachmentsOpenFolder.innerHTML = icons.folder;

let state = null;
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
let tabDragId = null;
let tabPointerDrag = null;
let lineageHoverTimer = null;
let lineageState = null;
const pendingCardPop = new Set();
// Altura real (renderizada) de cada card, medida em renderNodes. Cards de altura
// automatica (node.h === 0) variam conforme o conteudo; usar essa medida garante
// que linhas, snap e organize usem o centro real onde o port aparece.
const renderedHeights = new Map();
let dialogMode = "create-task";
let dialogUserId = null;
let dialogTaskId = null;
let newCardPosition = null;
let attachmentReferenceState = null;
let clipboardAttachmentState = null;
let pendingAttachmentReferenceTarget = null;

const TASKS_STATUS_FILTER_KEY = "todocompanion.settings.tasksStatusFilter";
let taskStatusFilter = localStorage.getItem(TASKS_STATUS_FILTER_KEY) || "ongoing";

const invoke =
  window.__TAURI__?.core?.invoke ||
  window.__TAURI__?.invoke ||
  null;

init().catch(error => console.error("Falha na inicializacao", error));
let inlineImageEditorTarget = null;
let inlineImageNodeTarget = null;
let nodeToUpdateImage = null;

async function init() {
  state = await initState();
  render();
  initUsersRail();
  initTasksSidebar();
  initTasksStatusFilter();
  setupFileDrop().catch(err => console.warn("Drag-and-drop indisponivel", err));

  maximizeAppButton?.addEventListener("click", toggleMaximizeWindow);
  minimizeAppButton?.addEventListener("click", minimizeWindow);
  openSearchButton?.addEventListener("click", openSearchModal);
  searchCloseIcon?.addEventListener("click", closeSearchModal);
  searchInput?.addEventListener("input", renderSearchResults);
  searchModal?.addEventListener("pointerdown", event => {
    if (event.target === searchModal) {
      closeSearchModal();
    }
  });
  clipboardAttachClose?.addEventListener("click", closeClipboardAttachModal);
  clipboardAttachCancel?.addEventListener("click", closeClipboardAttachModal);
  clipboardAttachConfirm?.addEventListener("click", confirmClipboardAttachment);
  clipboardAttachNameInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmClipboardAttachment();
    }
  });
  clipboardAttachModal?.addEventListener("pointerdown", event => {
    if (event.target === clipboardAttachModal) {
      closeClipboardAttachModal();
    }
  });
  centerCanvasButton.addEventListener("click", centerCanvasOnTasks);
  organizeCanvasButton.addEventListener("click", organizeCanvasCards);
  recordButton.addEventListener("click", toggleScreenRecording);
  document.querySelector("#recordingIndicatorStop")?.addEventListener("click", stopScreenRecording);
  canvasAttachButton.addEventListener("pointerdown", () => preserveAttachmentReferenceTarget());
  canvasAttachButton.addEventListener("click", handleAttachButtonClick);
  canvasAttachInput.addEventListener("change", handleAttachInputChange);
  attachmentsAdd.addEventListener("pointerdown", () => preserveAttachmentReferenceTarget());
  attachmentsAdd.addEventListener("click", () => canvasAttachInput.click());
  attachmentsOpenFolder.addEventListener("click", openAttachmentsFolder);
  attachmentReferencePopup?.addEventListener("pointerdown", event => event.preventDefault());
  addBoardButton.addEventListener("click", openUserCreatePopup);
  addUserTaskButton.addEventListener("click", () => openTaskDialog("create-task"));
  usersRailToggle.addEventListener("click", toggleUsersRail);
  tasksSidebarToggle.addEventListener("click", toggleTasksSidebar);
  tasksSortButton.addEventListener("click", toggleSortMenu);
  tasksSortMenu.addEventListener("click", event => {
    const option = event.target.closest("[data-sort]");
    if (!option) return;
    sortUserTasks(option.dataset.sort);
    closeSortMenu();
  });
  bindDateRangeInputs(overlayStartInput, overlayEndInput);
  bindDateRangeInputs(canvasStartInput, canvasEndInput);
  bindDateRangeInputs(document.querySelector("#tepStartInput"), document.querySelector("#tepEndInput"));
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
  document.querySelector("#taskEditPopup").addEventListener("submit", saveTaskEditPopup);
  document.querySelector("#tepCancelButton").addEventListener("click", closeTaskEditPopup);

  document.addEventListener("paste", handleClipboardPaste);
  boardShell.addEventListener("wheel", handleZoom, { passive: false });
  boardShell.addEventListener("pointerdown", handleBoardPointerDown);
  boardShell.addEventListener("contextmenu", handleBoardContextMenu);
  window.onerror = function(msg, url, line, col, error) {
    alert("ERRO: " + msg + "\nLinha: " + line + "\n" + (error ? error.stack : ""));
  };
  
  newCardForm.addEventListener("submit", saveNewCard);
  updateImageInput?.addEventListener("change", handleUpdateImage);
  inlineImageInput?.addEventListener("change", event => {
    const file = event.target.files[0];
    if (!file || !window.inlineImageEditorTarget || !window.inlineImageNodeTarget) return;

    const reader = new FileReader();
    reader.onload = e => {
      const dataUrl = e.target.result;
      window.inlineImageEditorTarget.focus();
      document.execCommand("insertImage", false, dataUrl);
      document.execCommand("insertHTML", false, "<br>&#8203;");
      setNodeContent(window.inlineImageNodeTarget, serializeEditableContent(window.inlineImageEditorTarget));
      saveState();
      
      window.inlineImageEditorTarget = null;
      window.inlineImageNodeTarget = null;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  });

  userCreateForm.addEventListener("submit", saveUserCreatePopup);
  userCreateCancelButton.addEventListener("click", closeUserCreatePopup);
  document.addEventListener("pointerdown", event => {
    if (!newCardForm.hidden && !newCardForm.contains(event.target)) closeNewCardModal();
    if (!userCreateForm.hidden && !userCreateForm.contains(event.target) && !addBoardButton.contains(event.target)) closeUserCreatePopup();
    const tep = document.querySelector("#taskEditPopup");
    if (!tep.hidden && !tep.contains(event.target) && !event.target.closest(".user-task-info")) closeTaskEditPopup();
    if (!attachmentsPopup.hidden && !attachmentsPopup.contains(event.target) && !canvasAttachButton.contains(event.target)) closeAttachmentsPopup();
    if (!attachmentReferencePopup.hidden && !attachmentReferencePopup.contains(event.target) && !attachmentReferenceState?.editor?.contains(event.target)) {
      closeAttachmentReferencePicker();
    }
    if (!tasksSortMenu.hidden && !tasksSortMenu.contains(event.target) && !tasksSortButton.contains(event.target)) {
      closeSortMenu();
    }
  }, true);
  window.addEventListener("resize", () => {
    applyViewport();
    renderLinks();
  });

  window.addEventListener("app:link-style-changed", () => {
    renderLinks();
  });

  window.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openSearchModal();
      return;
    }

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

    if (event.key === "Escape" && !searchModal.hidden) {
      closeSearchModal();
      return;
    }

    if (event.key === "Escape" && !clipboardAttachModal.hidden) {
      closeClipboardAttachModal();
      return;
    }

    if (event.key === "Escape" && !attachmentReferencePopup.hidden) {
      closeAttachmentReferencePicker();
      return;
    }

    if (event.key === "Escape" && !attachmentsPopup.hidden) {
      closeAttachmentsPopup();
      return;
    }

    if (event.key === "Escape" && !tasksSortMenu.hidden) {
      closeSortMenu();
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      const active = document.activeElement;
      const activeTag = active?.tagName;
      if (activeTag !== "INPUT" && activeTag !== "TEXTAREA" && !active?.isContentEditable) {
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

function minimizeWindow() {
  if (!invoke) return;
  invoke("minimize_window").catch(error => console.warn("Could not minimize window", error));
}

function toggleMaximizeWindow() {
  if (!invoke) return;
  invoke("toggle_maximize_window")
    .catch(error => console.warn("Could not toggle maximize", error))
    .finally(() => {
      requestAnimationFrame(() => {
        applyViewport();
        renderLinks();
      });
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
      createUser("Rafael", [createMainTask({ id: "task-rafael-tauri", title: "Build Tauri todo app", status: "ongoing", priority: "high" }, 0)]),
      createUser("Ana", [createMainTask({ id: "task-ana-flow", title: "Review card flow", status: "stopped", priority: "normal" }, 1)]),
      createUser("Kelvin", [createMainTask({ id: "task-kelvin-links", title: "Validate connections", status: "complete", priority: "normal" }, 2)]),
      createUser("UI", [createMainTask({ id: "task-ui-polish", title: "Polish sidebar panel", status: "ongoing", priority: "urgent" }, 3)])
    ]
  };
}

function createUser(name, tasks = []) {
  const id = makeId("user");
  return {
    id: name === "Rafael" ? "user-rafael" : id,
    name,
    activeTaskId: null,
    tasks
  };
}

function createMainTask(data = {}, index = 0) {
  const id = data.id || makeId("main-task");
  const firstId = `${id}-action-a`;
  const status = normalizeStatus(data.status);
  const dates = normalizeDateRange(data.startDate, data.endDate);

  return normalizeMainTask({
    id,
    title: data.title || "New main task",
    status,
    priority: normalizePriority(data.priority),
    criticality: normalizeCriticality(data.criticality),
    startDate: dates.startDate,
    endDate: dates.endDate,
    view: data.view || { zoom: 0.92, panX: 44 + index * 16, panY: 68 + index * 12 },
    nodes: data.nodes || [
      {
        id: firstId,
        title: data.title || "New main task",
        body: "",
        status,
        x: 120,
        y: 144,
        w: 288,
        h: 144
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

  const usedNumbers = new Set();
  let maxNumber = 0;
  value.users.forEach(user => {
    user.tasks.forEach(task => {
      if (task.number && !usedNumbers.has(task.number)) {
        usedNumbers.add(task.number);
        if (task.number > maxNumber) maxNumber = task.number;
      } else {
        task.number = null;
      }
    });
  });
  value.users.forEach(user => {
    user.tasks.forEach(task => {
      if (!task.number) {
        maxNumber++;
        task.number = maxNumber;
        usedNumbers.add(task.number);
      }
    });
  });

  if (value.activeUserId !== null && !value.users.some(user => user.id === value.activeUserId)) {
    value.activeUserId = value.users[0]?.id ?? null;
  }
  value.users.forEach(user => {
    if (user.activeTaskId !== null && !user.tasks.some(task => task.id === user.activeTaskId)) {
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
    activeTaskId: user.activeTaskId === null ? null : (user.activeTaskId || tasks[0]?.id),
    tasks
  };
}

function normalizeMainTask(task, index = 0) {
  const dates = normalizeDateRange(task.startDate, task.endDate);
  task.id = task.id || makeId("main-task");
  if (!task.number) {
    task.number = state ? getNextGlobalTaskNumber() : (index + 1);
  }
  task.title ||= task.name || `Main task ${index + 1}`;
  task.status = normalizeStatus(task.status);
  task.priority = normalizePriority(task.priority);
  task.criticality = normalizeCriticality(task.criticality);
  task.startDate = dates.startDate;
  task.endDate = dates.endDate;
  task.view ||= { zoom: 1, panX: 44, panY: 68 };
  task.view.zoom = clamp(Number(task.view.zoom) || 1, MIN_ZOOM, MAX_ZOOM);
  task.view.panX = Number(task.view.panX) || 0;
  task.view.panY = Number(task.view.panY) || 0;
  task.nodes = (task.nodes || []).map(node => normalizeNode(node)).filter(node => !isDefaultNextStep(node));
  syncFirstNodeTitleWithTask(task);
  task.links ||= [];
  task.links = task.links.filter(link =>
    task.nodes.some(node => node.id === link.from) &&
    task.nodes.some(node => node.id === link.to) &&
    !isRootNode(task, link.to)
  );
  task.links.forEach(link => {
    if (link.fromPort === "top" || link.fromPort === "bottom") link.fromPort = "out";
    if (link.toPort === "top" || link.toPort === "bottom") link.toPort = "in";
  });
  return task;
}

function isDefaultNextStep(node) {
  return node.title === "Proxima etapa" && node.body === "Criar subtasks e ligar dependencias.";
}

function getNextGlobalTaskNumber() {
  let max = 0;
  if (state && state.users) {
    state.users.forEach(user => {
      if (user.tasks) {
        user.tasks.forEach(task => {
          if (task.number > max) max = task.number;
        });
      }
    });
  }
  return max + 1;
}

function normalizeNode(node) {
  const body = node.body || "";
  const title = typeof node.title === "string" ? node.title : "";
  const GRID = 24;
  const rawX = Number(node.x) || 0;
  const rawY = Number(node.y) || 0;
  const rawW = Math.max(288, Number(node.w) || 288);
  const rawH = Number(node.h) || 0;

  const normalized = {
    id: node.id || makeId("action"),
    title: title === "Nova acao" && !String(body).trim() ? "" : title,
    body,
    status: normalizeStatus(node.status || (node.done ? "complete" : "ongoing")),
    x: Math.round(rawX / GRID) * GRID,
    y: Math.round(rawY / GRID) * GRID,
    w: Math.round(rawW / GRID) * GRID,
    h: rawH > 0 ? Math.round(rawH / GRID) * GRID : 0
  };
  if (node.createdAt) normalized.createdAt = node.createdAt;
  if (node.type) normalized.type = node.type;
  if (node.imageUrl !== undefined) normalized.imageUrl = node.imageUrl;
  if (node.criticality !== undefined) normalized.criticality = node.criticality;
  return normalized;
}

function syncFirstNodeTitleWithTask(task, previousTitle = "") {
  const firstNode = task.nodes?.[0];
  if (!firstNode) return;

  const currentTitle = String(firstNode.title || "").trim();
  const currentBody = String(firstNode.body || "").trim();
  const oldTaskTitle = String(previousTitle || "").trim();
  const taskTitle = String(task.title || "Nova main task").trim();
  const legacyFirstTitles = new Set(["Planejar", "Task inicial"]);
  const isLegacyTitleCard =
    legacyFirstTitles.has(currentTitle) ||
    (oldTaskTitle && currentTitle === oldTaskTitle) ||
    currentBody === taskTitle ||
    (oldTaskTitle && currentBody === oldTaskTitle);

  if (!isLegacyTitleCard) return;

  firstNode.title = taskTitle;
  if (currentBody === taskTitle || (oldTaskTitle && currentBody === oldTaskTitle)) {
    firstNode.body = "";
  }
}

function isRootNode(board, nodeId) {
  return Boolean(board?.nodes?.[0]?.id && board.nodes[0].id === nodeId);
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

function normalizeDate(value, offsetDays = 0) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return value;
  }

  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function normalizeDateRange(startValue, endValue) {
  const startDate = normalizeDate(startValue);
  let endDate = normalizeDate(endValue, 7);
  if (endDate < startDate) {
    endDate = startDate;
  }
  return { startDate, endDate };
}

function enforceDateRangeInputs(startInput, endInput) {
  if (!startInput || !endInput) {
    return normalizeDateRange();
  }

  const dates = normalizeDateRange(startInput.value, endInput.value);
  startInput.value = dates.startDate;
  endInput.min = dates.startDate;
  endInput.value = dates.endDate;
  return dates;
}

function bindDateRangeInputs(startInput, endInput) {
  if (!startInput || !endInput) {
    return;
  }

  const sync = () => enforceDateRangeInputs(startInput, endInput);
  startInput.addEventListener("change", sync);
  endInput.addEventListener("change", sync);
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
  if (state.activeUserId === null) {
    return null;
  }
  let user = state.users.find(item => item.id === state.activeUserId);
  if (!user) {
    user = state.users[0];
    state.activeUserId = user?.id ?? null;
  }
  return user || null;
}

function activeBoard() {
  const user = activeUser();
  if (!user || user.activeTaskId === null) {
    return null;
  }
  let task = user.tasks.find(item => item.id === user.activeTaskId);
  if (!task) {
    task = user.tasks[0];
    user.activeTaskId = task?.id ?? null;
  }
  return task || null;
}

function activeView() {
  return activeBoard()?.view || null;
}

function closeContextPopups() {
  if (attachmentsPopup && !attachmentsPopup.hidden) closeAttachmentsPopup();
  if (attachmentReferencePopup && !attachmentReferencePopup.hidden) closeAttachmentReferencePicker();
  if (clipboardAttachModal && !clipboardAttachModal.hidden) closeClipboardAttachModal();
}

function activateUser(userId) {
  if (!userId) {
    return;
  }

  const isDifferentUser = userId !== state.activeUserId;
  state.activeUserId = userId === state.activeUserId ? null : userId;
  if (isDifferentUser && state.activeUserId) {
    const user = state.users.find(item => item.id === state.activeUserId);
    if (user) {
      user.activeTaskId = null;
    }
  }
  clearSelection();
  saveState();
  closeContextPopups();
  render();
}

function activateTask(taskId) {
  const user = activeUser();
  if (!user || !taskId) {
    return;
  }

  user.activeTaskId = taskId === user.activeTaskId ? null : taskId;
  clearSelection();
  saveState();
  closeContextPopups();
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
  renderUsersRail();
  renderUserTasks();

  const board = activeBoard();
  renderBoardEmptyState(board);

  if (!board) {
    nodesLayer.innerHTML = "";
    linkLayer.innerHTML = "";
    renderedHeights.clear();
    return;
  }

  renderCanvasMetaOverlay();
  ensureCanvasPositions();
  applyViewport();
  renderNodes();
  renderLinks();
  updateAttachButtonState();
}

// Sem user (ou sem task) o canvas nao tem o que desenhar: some com a superficie
// e com os controles flutuantes e mostra um placeholder central explicando o
// que falta selecionar.
function renderBoardEmptyState(board) {
  const hasBoard = Boolean(board);
  const hasUser = Boolean(activeUser());

  boardEmpty.hidden = hasBoard;
  boardSurface.hidden = !hasBoard;
  canvasMetaOverlay.hidden = !hasBoard;
  centerCanvasButton.hidden = !hasBoard;
  organizeCanvasButton.hidden = !hasBoard;
  recordButton.hidden = !hasBoard;
  canvasAttachButton.hidden = !hasBoard;
  addUserTaskButton.disabled = !hasUser;

  if (hasBoard) {
    return;
  }

  boardEmptyIcon.innerHTML = hasUser ? icons.board : icons.user;
  boardEmptyTitle.textContent = hasUser ? "No task selected" : "No user selected";
  boardEmptyHint.textContent = hasUser
    ? "Select a task from the sidebar to open the canvas."
    : "Select a user from the left panel to view tasks.";
}

function renderCanvasMetaOverlay() {
  const user = activeUser();
  const task = activeBoard();
  if (!task || !user) return;

  const overlayUserNameEl = document.getElementById("overlayUserName");
  if (overlayUserNameEl) overlayUserNameEl.textContent = user.name || "User";

  const overlayUserAvatarEl = document.getElementById("overlayUserAvatar");
  if (overlayUserAvatarEl) overlayUserAvatarEl.textContent = initialsFor(user.name);

  const overlayIdEl = document.getElementById("overlayTaskId");
  if (overlayIdEl) overlayIdEl.textContent = `#${task.number || ""}`;

  const overlayTaskTitleEl = document.getElementById("overlayTaskTitle");
  if (overlayTaskTitleEl) {
    overlayTaskTitleEl.textContent = task.title || "";
    overlayTaskTitleEl.title = task.title || "";
  }

  const dates = normalizeDateRange(task.startDate, task.endDate);
  task.startDate = dates.startDate;
  task.endDate = dates.endDate;
  overlayStartInput.value = dates.startDate;
  overlayEndInput.min = dates.startDate;
  overlayEndInput.value = dates.endDate;
  overlayStatusInput.value = normalizeStatus(task.status);
  const criticality = normalizeCriticality(task.criticality);
  overlayCriticalityInput.value = String(criticality);
  overlayCriticalityControl.className = `overlay-criticality crit-${criticality}`;
  overlayCriticalityInput.title = `Criticality ${CRITICALITY_META[criticality].label}`;
}

function updateActiveTaskMetaFromOverlay() {
  const task = activeBoard();
  const dates = enforceDateRangeInputs(overlayStartInput, overlayEndInput);
  task.startDate = dates.startDate;
  task.endDate = dates.endDate;
  task.status = normalizeStatus(overlayStatusInput.value);
  task.criticality = normalizeCriticality(overlayCriticalityInput.value);
  saveState();
  renderUserTasks();
  renderNodes();
  renderLinks();
  renderCanvasMetaOverlay();
}

// Iniciais do nome do user, usadas no avatar do rail lateral.
function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

function renderUsersRail() {
  const activeId = activeUser()?.id ?? null;
  usersRailList.innerHTML = "";

  state.users.forEach(item => {
    const taskCount = item.tasks?.length || 0;
    const tab = document.createElement("div");
    tab.className = `user-rail-item${item.id === activeId ? " active" : ""}${item.id === tabDragId ? " dragging" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(item.id === activeId));
    tab.tabIndex = 0;
    tab.title = item.name;
    tab.dataset.userId = item.id;

    const avatar = document.createElement("span");
    avatar.className = "user-rail-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initialsFor(item.name);

    const label = document.createElement("span");
    label.className = "user-rail-label";
    label.textContent = item.name;

    const count = document.createElement("span");
    count.className = "user-rail-count";
    count.title = `${taskCount} task(s)`;
    count.textContent = String(taskCount);

    const actions = document.createElement("div");
    actions.className = "user-rail-actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "user-rail-action";
    editBtn.setAttribute("aria-label", "Rename");
    editBtn.title = "Rename";
    editBtn.innerHTML = icons.edit;
    editBtn.addEventListener("click", event => {
      event.stopPropagation();
      startTabRename(tab, label, item);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "user-rail-action user-rail-action-danger";
    deleteBtn.setAttribute("aria-label", "Delete");
    deleteBtn.title = "Delete";
    deleteBtn.innerHTML = icons.trash;
    deleteBtn.addEventListener("click", async event => {
      event.stopPropagation();
      if (state.users.length <= 1) {
        return;
      }
      const ok = await openConfirmDelete({
        title: `Delete "${item.name}"`,
        message: "This action will remove the user and all their tasks. It cannot be undone."
      });
      if (ok) {
        removeUser(item.id);
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    tab.append(avatar, label, count, actions);

    tab.addEventListener("pointerdown", event => startTabDrag(event, item.id));
    tab.addEventListener("dblclick", event => {
      if (event.target.closest(".user-rail-action")) return;
      startTabRename(tab, label, item);
    });
    tab.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activateUser(item.id);
      }
    });

    usersRailList.appendChild(tab);
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

function startTabDrag(event, userId) {
  if (event.button !== 0 || event.target.closest("button, input")) {
    return;
  }

  const rect = event.currentTarget.getBoundingClientRect();
  event.preventDefault();
  tabPointerDrag = {
    userId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    sourceTab: event.currentTarget,
    ghost: null,
    didDrag: false
  };

  const move = moveEvent => {
    if (!tabPointerDrag || moveEvent.pointerId !== tabPointerDrag.pointerId) return;
    const distance = Math.hypot(moveEvent.clientX - tabPointerDrag.startX, moveEvent.clientY - tabPointerDrag.startY);
    if (!tabPointerDrag.didDrag && distance < 6) return;

    if (!tabPointerDrag.didDrag) {
      tabPointerDrag.didDrag = true;
      tabDragId = userId;
      createTabDragGhost(moveEvent);
      renderUsersRail();
    }

    positionTabDragGhost(moveEvent);
    const beforeId = getTabInsertionId(moveEvent.clientY);
    moveUserBefore(userId, beforeId);
  };

  const stop = upEvent => {
    if (!tabPointerDrag || upEvent.pointerId !== tabPointerDrag.pointerId) return;
    const didDrag = tabPointerDrag.didDrag;
    removeTabDragGhost();
    tabPointerDrag = null;
    tabDragId = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    if (didDrag) {
      renderUsersRail();
    } else {
      activateUser(userId);
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
}

function createTabDragGhost(event) {
  if (!tabPointerDrag?.sourceTab || tabPointerDrag.ghost) return;
  const ghost = tabPointerDrag.sourceTab.cloneNode(true);
  ghost.classList.add("user-rail-drag-ghost");
  ghost.classList.remove("dragging");
  ghost.style.width = `${tabPointerDrag.width}px`;
  ghost.style.height = `${tabPointerDrag.height}px`;
  document.body.appendChild(ghost);
  tabPointerDrag.ghost = ghost;
  positionTabDragGhost(event);
}

function positionTabDragGhost(event) {
  const ghost = tabPointerDrag?.ghost;
  if (!ghost) return;
  ghost.style.left = `${event.clientX - tabPointerDrag.offsetX}px`;
  ghost.style.top = `${event.clientY - tabPointerDrag.offsetY}px`;
}

function removeTabDragGhost() {
  tabPointerDrag?.ghost?.remove();
}

// O rail e vertical: a insercao e decidida pelo meio da altura de cada item.
function getTabInsertionId(clientY) {
  const tabs = [...usersRailList.querySelectorAll(".user-rail-item")]
    .filter(tab => tab.dataset.userId !== tabDragId);
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return tab.dataset.userId;
    }
  }
  return null;
}

function moveUserBefore(sourceId, beforeId) {
  if (!sourceId || sourceId === beforeId) return;
  const fromIndex = state.users.findIndex(u => u.id === sourceId);
  if (fromIndex < 0) return;
  const currentBeforeId = state.users[fromIndex + 1]?.id || null;
  if (currentBeforeId === beforeId) return;
  const [item] = state.users.splice(fromIndex, 1);
  const toIndex = beforeId ? state.users.findIndex(u => u.id === beforeId) : state.users.length;
  const insertionIndex = toIndex < 0 ? state.users.length : toIndex;
  state.users.splice(insertionIndex, 0, item);
  saveState();
  renderUsersRail();
}

let confirmDeleteResolve = null;
let confirmDeleteCodeStr = "";
let confirmDeleteRequireCode = true;
const confirmDeleteCaptchaRow = confirmDeleteInput.closest("label");

function generateCaptcha(len = 3) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function openConfirmDelete({ title, message, requireCode = true, confirmLabel = "Delete" }) {
  return new Promise(resolve => {
    confirmDeleteRequireCode = requireCode;
    confirmDeleteCodeStr = requireCode ? generateCaptcha(3) : "";
    confirmDeleteTitle.textContent = title;
    confirmDeleteMessage.textContent = message;
    confirmDeleteCode.textContent = confirmDeleteCodeStr;
    confirmDeleteInput.value = "";
    confirmDeleteOk.textContent = confirmLabel;
    confirmDeleteOk.disabled = requireCode;
    if (confirmDeleteCaptchaRow) confirmDeleteCaptchaRow.hidden = !requireCode;
    confirmDeleteModal.hidden = false;
    confirmDeleteResolve = resolve;
    requestAnimationFrame(() => (requireCode ? confirmDeleteInput : confirmDeleteOk).focus());
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
  if (!confirmDeleteRequireCode || confirmDeleteInput.value.trim().toUpperCase() === confirmDeleteCodeStr) {
    closeConfirmDelete(true);
  }
});
confirmDeleteCancel.addEventListener("click", () => closeConfirmDelete(false));
confirmDeleteModal.addEventListener("pointerdown", event => {
  if (event.target === confirmDeleteModal) closeConfirmDelete(false);
});

function startTabRename(tabEl, labelEl, userItem) {
  if (tabEl.querySelector(".user-rail-rename-input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "user-rail-rename-input";
  input.value = userItem.name;
  input.maxLength = 28;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Rename user");

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
    renderUsersRail();
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

function getNodeContent(node) {
  if (node.title && node.body) return node.title + "\n" + node.body;
  return node.title || node.body || "";
}

function setNodeContent(node, value) {
  const nl = value.indexOf("\n");
  node.title = nl === -1 ? value : value.slice(0, nl);
  node.body = nl === -1 ? "" : value.slice(nl + 1);
}

const FORMAT_COMMANDS = ["bold", "italic", "underline", "strikethrough", "insertUnorderedList", "insertOrderedList"];

function updateFormatButtonStates(card) {
  const bar = card.querySelector(".card-format-bar");
  if (!bar) return;
  bar.querySelectorAll(".card-format-btn[data-command]").forEach(btn => {
    const cmd = btn.dataset.command;
    if (FORMAT_COMMANDS.includes(cmd)) {
      btn.classList.toggle("active", document.queryCommandState(cmd));
    }
  });
}

function renderNodes() {
  const board = activeBoard();
  nodesLayer.innerHTML = "";
  if (!board) return;
  const lineageNodeIds = lineageState?.nodeIds || null;
  boardShell.classList.toggle("lineage-mode", Boolean(lineageState));

  board.nodes.forEach(node => {
    const status = normalizeStatus(node.status);
    const rootCard = isRootNode(board, node.id);
    const card = document.createElement("article");
    const justCreated = pendingCardPop.has(node.id);
    if (justCreated) {
      pendingCardPop.delete(node.id);
    }
    const hasFixedHeight = node.h > 0;
    card.className = [
      "task-card",
      `status-${status}`,
      status === "complete" ? "done" : "",
      node.id === selectedNodeId ? "selected" : "",
      lineageNodeIds ? (lineageNodeIds.has(node.id) ? "lineage-active-node" : "lineage-dim") : "",
      dragState?.nodeId === node.id ? "dragging" : "",
      justCreated ? "just-created" : "",
      hasFixedHeight ? "fixed-height" : "",
      rootCard ? "root-card" : "",
      node.type === "image" ? "image-card" : ""
    ].filter(Boolean).join(" ");
    card.dataset.id = node.id;
    card.dataset.status = status;
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${Math.max(288, node.w || 288)}px`;
    card.style.minHeight = hasFixedHeight ? `${node.h}px` : "80px";
    card.style.height = "auto";

    const createdAtHtml = (!rootCard && node.createdAt && node.type !== "image")
      ? `<div class="card-footer">
           <span class="card-created-at">${formatCreatedAt(node.createdAt)}</span>
           <div class="card-footer-crit crit-${node.criticality ?? 0}">
             <span class="crit-dot"></span>
             <span class="crit-dot"></span>
             <span class="crit-dot"></span>
           </div>
         </div>`
      : "";
    card.innerHTML = `
      ${rootCard ? "" : `<button class="port port-in${linkDragState?.nodeId === node.id && linkDragState?.port === "in" ? " pending" : ""}" data-port="in" type="button" aria-label="Input"></button>`}
      <button class="port port-out${pendingLink?.from === node.id || (linkDragState?.nodeId === node.id && linkDragState?.port === "out") ? " pending" : ""}" data-port="out" type="button" aria-label="Output"></button>
      ${rootCard ? "" : node.type === "image" ? `
        <div class="image-card-top">
          <button class="card-action" type="button" aria-label="Remove" title="Remove">${icons.close}</button>
        </div>
      ` : `
        <div class="card-top">
          <button class="card-check" type="button" aria-label="Complete" title="Complete">${status === "complete" ? icons.check : ""}</button>
          <div class="crit-wrap crit-${node.criticality ?? 0}">
            <div class="crit-track">
              <span class="crit-dot"></span>
              <span class="crit-dot"></span>
              <span class="crit-dot"></span>
            </div>
            <input class="crit-range" type="range" min="0" max="2" step="1" value="${node.criticality ?? 0}" title="Criticality" />
          </div>
          <button class="card-action" type="button" aria-label="Remove" title="Remove">${icons.close}</button>
        </div>
      `}
      <div class="card-body-wrap">
        ${rootCard
          ? `<div class="root-card-header">
               <strong class="root-card-title" contenteditable="true" spellcheck="false" role="textbox" aria-label="Board Title">${escapeHtml(board.title)}</strong>
               <button class="root-card-edit" type="button" aria-label="Edit" title="Edit">${icons.edit}</button>
             </div>`
          : node.type === "image"
            ? node.imageUrl
                ? `<div class="card-body image-card-body" role="img" aria-label="Attached image"><img src="${node.imageUrl}" alt="Card image" draggable="false" /></div>`
                : `<div class="card-body image-card-body empty-image-card" role="button" aria-label="Add image" title="Add image" onclick="document.getElementById('updateImageInput').click(); window.nodeToUpdateImage = '${node.id}';">${icons.image}</div>`
            : `<div class="card-body" contenteditable="true" role="textbox" aria-label="Card content">${renderBodyHtml(getNodeContent(node))}</div>`}
      </div>
      ${createdAtHtml}
      ${rootCard ? "" : node.type === "image" && node.imageUrl ? `
        <div class="image-card-bottom" contenteditable="false">
          <button class="image-card-btn" type="button" data-command="changeImage" title="Change Image">${icons.image}</button>
          <button class="image-card-btn" type="button" data-command="clearImage" title="Remove Image">${icons.close}</button>
        </div>
      ` : node.type === "image" ? "" : `
        <div class="card-format-bar" contenteditable="false">
          <button class="card-format-btn" type="button" data-command="bold" title="Bold (Ctrl+B)">${icons.formatBold}</button>
          <button class="card-format-btn" type="button" data-command="italic" title="Italic (Ctrl+I)">${icons.formatItalic}</button>
          <button class="card-format-btn" type="button" data-command="underline" title="Underline (Ctrl+U)">${icons.formatUnderline}</button>
          <button class="card-format-btn" type="button" data-command="strikethrough" title="Strikethrough">${icons.formatStrikethrough}</button>
          <div style="width: 1px; background: rgba(var(--hi-rgb),0.15); margin: 2px 2px;"></div>
          <button class="card-format-btn" type="button" data-command="insertUnorderedList" title="Bulleted List">${icons.formatListBulleted}</button>
          <button class="card-format-btn" type="button" data-command="insertOrderedList" title="Numbered List">${icons.formatListNumbered}</button>
          <button class="card-format-btn" type="button" data-command="insertCheckbox" title="Checkbox">${icons.checkbox}</button>
          <div style="width: 1px; background: rgba(var(--hi-rgb),0.15); margin: 2px 2px;"></div>
          <button class="card-format-btn" type="button" data-command="insertImageInline" title="Insert Image">${icons.image}</button>
          <button class="card-format-btn" type="button" data-command="removeFormat" title="Clear Formatting">${icons.formatClear}</button>
        </div>
      `}
      <button class="resize-handle" type="button" aria-label="Resize" title="Resize"></button>
    `;

    card.addEventListener("pointerdown", () => {
      clearLineagePreview(false);
      selectedNodeId = node.id;
      selectedLinkId = null;
      removeLineageClasses();
      renderLinks();
      refreshSelectionClasses();
    });

    card.addEventListener("change", event => {
      if (event.target.classList.contains("card-todo-checkbox")) {
        const editor = card.querySelector(".card-body");
        if (editor) {
          setNodeContent(node, serializeEditableContent(editor));
          saveState();
        }
      }
    });

    card.addEventListener("mouseenter", () => scheduleLineagePreview(node.id));
    card.addEventListener("mouseleave", () => clearLineagePreview());

    card.addEventListener("dblclick", event => {
      if (event.target.closest("input, textarea, button, .resize-handle, .port")) {
        return;
      }
      focusCardOnNode(node.id);
    });

    if (rootCard) {
      card.querySelector(".root-card-title")?.addEventListener("pointerdown", event => {
        if (event.target.closest("button") || event.target.closest("input")) {
          return;
        }
        startDrag(event, node.id);
      });
    }

    if (!rootCard) {
      const dragHandle = card.querySelector(".card-top") || card.querySelector(".image-card-body");
      if (dragHandle) {
        dragHandle.addEventListener("pointerdown", event => {
          if (event.target.closest("button") || event.target.closest("input")) {
            return;
          }
          startDrag(event, node.id);
        });
      }

      card.querySelector(".card-check")?.addEventListener("click", event => {
        event.stopPropagation();
        const currentStatus = node.status || "ongoing";
        const newStatus = currentStatus === "complete" ? "ongoing" : "complete";
        node.status = newStatus;
        saveState();
        
        card.classList.remove(`status-${currentStatus}`);
        card.classList.add(`status-${newStatus}`);
        event.currentTarget.innerHTML = newStatus === "complete" ? icons.check : "";
        
        renderUserTasks();
      });

      card.querySelector(".card-action")?.addEventListener("click", event => {
        event.stopPropagation();
        removeNode(node.id);
      });
    }

    const bodyEditor = card.querySelector(".card-body");

    if (bodyEditor) {
      bodyEditor.addEventListener("pointerdown", event => {
        if (event.target.closest(".card-todo-btn") || event.target.closest(".card-todo-wrap")) {
          event.stopPropagation();
        }
      });

      bodyEditor.addEventListener("click", event => {
        const todoWrap = event.target.closest(".card-todo-wrap");
        const todoBtn = event.target.closest(".card-todo-btn") || todoWrap?.querySelector(".card-todo-btn");
        if (todoBtn && todoWrap) {
          event.preventDefault();
          event.stopPropagation();
          const nowChecked = todoWrap.dataset.checked !== "true";
          todoWrap.dataset.checked = String(nowChecked);
          todoBtn.classList.toggle("checked", nowChecked);
          todoBtn.setAttribute("aria-checked", String(nowChecked));
          todoBtn.innerHTML = nowChecked ? icons.check : "";
          setNodeContent(node, serializeEditableContent(bodyEditor));
          saveState();
          return;
        }

        const removeBtn = event.target.closest(".card-attachment-remove");
        if (removeBtn) {
          event.preventDefault();
          event.stopPropagation();
          const chip = removeBtn.closest(".card-attachment-link");
          removeChipFromEditable(bodyEditor, chip);
          return;
        }

        const attachmentLink = event.target.closest(".card-attachment-link");
        if (attachmentLink) {
          event.preventDefault();
          event.stopPropagation();
          const att = findActiveAttachmentById(attachmentLink.dataset.attachmentId);
          if (att) {
            openAttachment(att);
          }
          return;
        }

        const link = event.target.closest(".card-body-link");
        if (link) {
          event.preventDefault();
          event.stopPropagation();
          openExternalUrl(toAbsoluteUrl(link.getAttribute("href")));
        }
      });

      bodyEditor.addEventListener("blur", () => {
        closeAttachmentReferencePicker(bodyEditor);
      });

      bodyEditor.addEventListener("keydown", event => {
        handleAttachmentReferenceKeydown(event);
        if (event.defaultPrevented) return;
        handleTodoKeydown(event, bodyEditor, node);
      });
      bodyEditor.addEventListener("input", () => {
        setNodeContent(node, serializeEditableContent(bodyEditor));
        saveState();
        syncAttachmentReferencePicker(bodyEditor);
        scheduleNodeHeightSync(node.id, card);
      });
    }

    card.querySelector(".crit-range")?.addEventListener("pointerdown", event => event.stopPropagation());
    card.querySelector(".crit-range")?.addEventListener("input", event => {
      const val = parseInt(event.target.value);
      node.criticality = val;
      event.target.closest(".crit-wrap").className = `crit-wrap crit-${val}`;
      saveState();
    });

    card.querySelector(".port-out").addEventListener("pointerdown", event => startLinkDrag(event, node.id, "out"));
    card.querySelector(".port-in")?.addEventListener("pointerdown", event => startLinkDrag(event, node.id, "in"));
    card.querySelector(".resize-handle")?.addEventListener("pointerdown", event => startResize(event, node.id));

    [".card-format-bar", ".image-card-bottom"].forEach(sel => {
      card.querySelector(sel)?.addEventListener("pointerdown", event => {
        event.stopPropagation();
      });
      card.querySelector(sel)?.addEventListener("click", event => {
        const btn = event.target.closest("[data-command]");
        if (!btn) return;
        event.preventDefault();
        event.stopPropagation();
        const command = btn.dataset.command;
        if (command === "changeImage") {
          document.getElementById('updateImageInput').click();
          window.nodeToUpdateImage = node.id;
          return;
        }
        if (command === "clearImage") {
          node.imageUrl = null;
          saveState();
          renderNodes();
          return;
        }
        const editor = card.querySelector(".card-body");
        if (editor) {
          if (command === "insertImageInline") {
            window.inlineImageEditorTarget = editor;
            window.inlineImageNodeTarget = node;
            document.getElementById('inlineImageInput').click();
            return;
          }
          if (command === "insertCheckbox") {
            editor.focus();
            const sel = window.getSelection();
            const html = `<span class="card-todo-wrap" contenteditable="false" data-checked="false"><button type="button" class="card-todo-btn" role="checkbox" aria-checked="false"></button></span> `;
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              const temp = document.createElement("div");
              temp.innerHTML = html;
              const frag = document.createDocumentFragment();
              let lastNode = null;
              while (temp.firstChild) {
                lastNode = temp.firstChild;
                frag.appendChild(lastNode);
              }
              range.insertNode(frag);
              if (lastNode) {
                range.setStartAfter(lastNode);
                range.setEndAfter(lastNode);
                sel.removeAllRanges();
                sel.addRange(range);
              }
            } else {
              document.execCommand("insertHTML", false, html);
            }
            setNodeContent(node, serializeEditableContent(editor));
            saveState();
            return;
          }
          editor.focus();
          document.execCommand(command, false, null);
          setNodeContent(node, serializeEditableContent(editor));
          saveState();
          updateFormatButtonStates(card);
        }
      });
    });

    const formatBar = card.querySelector(".card-format-bar");
    if (formatBar) {
      document.addEventListener("selectionchange", () => {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && card.contains(sel.anchorNode)) {
          updateFormatButtonStates(card);
        }
      });
    }

    if (rootCard) {
      const titleEl = card.querySelector(".root-card-title");
      if (titleEl) {
        titleEl.addEventListener("pointerdown", event => event.stopPropagation());
        
        const commitTitle = () => {
          const newTitle = titleEl.innerText.trim();
          if (newTitle && newTitle !== board.title) {
            board.title = newTitle;
            const t = activeUser().tasks.find(t => t.id === board.id);
            if (t) t.title = newTitle;
            saveState();
            render();
          } else {
            titleEl.innerText = board.title;
          }
        };
        
        titleEl.addEventListener("blur", commitTitle);
        titleEl.addEventListener("keydown", event => {
          if (event.key === "Enter") {
            event.preventDefault();
            titleEl.blur();
          }
        });
      }

      card.querySelector(".root-card-edit")?.addEventListener("pointerdown", event => event.stopPropagation());
      card.querySelector(".root-card-edit")?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openTaskDialog("edit-task", activeUser().id, board.id);
      });
    }

    nodesLayer.appendChild(card);
  });

  // Segunda passada: com todos os cards no DOM, ler offsetHeight de uma vez
  // (um unico reflow) para cachear a altura real de cada um.
  renderedHeights.clear();
  board.nodes.forEach(node => {
    const el = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    if (el) renderedHeights.set(node.id, el.offsetHeight);
  });
}

// Altura usada para posicionar ports/linhas: altura fixa quando o card foi
// redimensionado, senao a altura real renderizada, com fallback de 144.
function nodeHeight(node) {
  return renderedHeights.get(node.id) || node.h || 144;
}

// O card cresce/encolhe com o texto digitado. Sem re-medir, os ports (e as setas
// que apontam para eles) continuam na altura antiga ate o proximo render()
// completo. Coalescido por frame para nao forcar reflow a cada tecla.
let nodeHeightSyncFrame = null;
function scheduleNodeHeightSync(nodeId, card) {
  if (nodeHeightSyncFrame) return;
  nodeHeightSyncFrame = requestAnimationFrame(() => {
    nodeHeightSyncFrame = null;
    if (!card.isConnected) return;
    const measured = card.offsetHeight;
    if (renderedHeights.get(nodeId) === measured) return;
    renderedHeights.set(nodeId, measured);
    renderLinks();
  });
}

function scheduleLineagePreview(nodeId) {
  if (localStorage.getItem("todocompanion.settings.lineageHover") === "false") {
    return;
  }

  window.clearTimeout(lineageHoverTimer);
  lineageHoverTimer = window.setTimeout(() => {
    showLineagePreview(nodeId);
  }, 600);
}

function showLineagePreview(nodeId) {
  if (localStorage.getItem("todocompanion.settings.lineageHover") === "false") {
    return;
  }
  
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

function renderLinks() {
  const board = activeBoard();
  linkLayer.innerHTML = "";
  if (!board) return;

  const nodesById = new Map(board.nodes.map(node => [node.id, node]));
  board.links = board.links.filter(link => nodesById.has(link.from) && nodesById.has(link.to));
  const bounds = getSvgBounds(board.nodes, linkDragState);
  linkLayer.style.left = `${bounds.x}px`;
  linkLayer.style.top = `${bounds.y}px`;
  linkLayer.style.width = `${bounds.width}px`;
  linkLayer.style.height = `${bounds.height}px`;
  linkLayer.setAttribute("viewBox", `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);

  const obstacles = buildLinkObstacles(board.nodes);

  board.links.forEach(link => {
    const from = nodesById.get(link.from);
    const to = nodesById.get(link.to);
    const fromPort = link.fromPort === "top" || link.fromPort === "bottom" ? "out" : (link.fromPort || "out");
    const toPort = link.toPort === "top" || link.toPort === "bottom" ? "in" : (link.toPort || "in");
    const start = getPortPoint(from, fromPort);
    // O ponto de destino tem que ser sempre o centro real do port: e dele que sai
    // a ponta da seta. Qualquer "endireitamento" da linha aqui (ex.: forcar
    // end.y = start.y quando os ports estao quase alinhados) desloca a seta da
    // bolinha. O desnivel pequeno fica por conta do roteador, que resolve com um
    // degrau curto antes da entrada.
    const end = getPortPoint(to, toPort);

    const linkObstacles = obstacles.filter(o => o.id !== link.from && o.id !== link.to);
    const arrowTip = insetLinkEndpoint(end, toPort, LINK_ARROW_END_GAP);
    const lineEnd = getArrowBasePoint(arrowTip, toPort, LINK_ARROW_LENGTH);
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
    path.setAttribute("d", createLinkPath(start, lineEnd, fromPort, toPort, linkObstacles));
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
    const arrow = createSvgArrowHead(arrowTip, toPort, linkStatus, lineageDotClass);
    linkLayer.append(path, arrow);
  });

  if (dragState?.snap) {
    const { guideX, guideY } = dragState.snap;
    if (guideY != null) {
      linkLayer.appendChild(createSnapGuide("h", guideY, bounds));
    }
    if (guideX != null) {
      linkLayer.appendChild(createSnapGuide("v", guideX, bounds));
    }
  }

  if (linkDragState) {
    const source = nodesById.get(linkDragState.nodeId);
    if (source) {
      const dragPort = linkDragState.port;
      const sourcePoint = getPortPoint(source, dragPort);
      const cursorPoint = { x: linkDragState.x, y: linkDragState.y };
      const isOut = isOutputPort(dragPort);
      const fromPoint = isOut ? sourcePoint : cursorPoint;
      const toPoint = isOut ? cursorPoint : sourcePoint;

      let previewToPort = "in";
      let previewFromPort = "out";

      if (isOut) {
        if (linkDragState.snap) {
          previewToPort = linkDragState.snap.port;
        } else {
          previewToPort = cursorPoint.x >= sourcePoint.x ? "in" : "out";
        }
      } else {
        if (linkDragState.snap) {
          previewFromPort = linkDragState.snap.port;
        } else {
          previewFromPort = cursorPoint.x <= sourcePoint.x ? "out" : "in";
        }
      }

      const fromPort = isOut ? dragPort : previewFromPort;
      const toPort = isOut ? previewToPort : dragPort;
      const previewStatus = normalizeStatus(source.status);
      const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const previewArrowTip = toPoint;
      const previewLineEnd = getArrowBasePoint(previewArrowTip, toPort, LINK_ARROW_LENGTH);
      previewPath.setAttribute("class", `link-path link-preview status-${previewStatus}`);
      const previewObstacles = obstacles.filter(o => o.id !== source.id && o.id !== linkDragState.snappedNodeId);
      previewPath.setAttribute("d", createLinkPath(fromPoint, previewLineEnd, fromPort, toPort, previewObstacles));
      const previewArrow = createSvgArrowHead(previewArrowTip, toPort, previewStatus);
      linkLayer.append(previewPath, previewArrow);
    }
  }
}

function getSvgBounds(nodes, drag) {
  const xs = [];
  const ys = [];

  nodes.forEach(node => {
    xs.push(node.x, node.x + (node.w || 288));
    ys.push(node.y, node.y + (node.h || 144));
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

function createSvgArrowHead(point, port, status = "ongoing", extraClass = "", length = LINK_ARROW_LENGTH, halfWidth = LINK_ARROW_HALF_WIDTH, baseClass = "link-arrow") {
  const { dx, dy } = arrowDirectionForPort(port);
  const base = getArrowBasePoint(point, port, length);
  const px = -dy;
  const py = dx;
  const points = [
    `${base.x + px * halfWidth},${base.y + py * halfWidth}`,
    `${point.x},${point.y}`,
    `${base.x - px * halfWidth},${base.y - py * halfWidth}`
  ].join(" ");
  const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  arrow.setAttribute("class", [baseClass, `status-${normalizeStatus(status)}`, extraClass].filter(Boolean).join(" "));
  arrow.setAttribute("points", points);
  return arrow;
}

function getArrowBasePoint(point, port, length) {
  const { dx, dy } = arrowDirectionForPort(port);
  return {
    x: point.x - dx * length,
    y: point.y - dy * length
  };
}

function arrowDirectionForPort(port) {
  switch (port) {
    case "out":
      return { dx: -1, dy: 0 };
    case "top":
      return { dx: 0, dy: 1 };
    case "bottom":
      return { dx: 0, dy: -1 };
    case "in":
    default:
      return { dx: 1, dy: 0 };
  }
}

function createSnapGuide(orientation, coord, bounds) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "snap-guide");
  if (orientation === "h") {
    line.setAttribute("x1", bounds.x);
    line.setAttribute("x2", bounds.x + bounds.width);
    line.setAttribute("y1", coord);
    line.setAttribute("y2", coord);
  } else {
    line.setAttribute("x1", coord);
    line.setAttribute("x2", coord);
    line.setAttribute("y1", bounds.y);
    line.setAttribute("y2", bounds.y + bounds.height);
  }
  return line;
}

function getPortPoint(node, port) {
  const width = node.w || 288;
  const height = nodeHeight(node);
  if (port === "top") return { x: node.x + width / 2, y: node.y };
  if (port === "bottom") return { x: node.x + width / 2, y: node.y + height };
  return {
    x: port === "out" ? node.x + width : node.x,
    y: node.y + height / 2
  };
}

function insetLinkEndpoint(point, port, gap = LINK_ARROW_END_GAP) {
  switch (port) {
    case "in":
      return { x: point.x - gap, y: point.y };
    case "out":
      return { x: point.x + gap, y: point.y };
    case "top":
      return { x: point.x, y: point.y - gap };
    case "bottom":
      return { x: point.x, y: point.y + gap };
    default:
      return { x: point.x, y: point.y };
  }
}

function isOutputPort(port) { return port === "out" || port === "bottom" || port === "top"; }
function isInputPort(port) { return port === "in" || port === "top" || port === "bottom"; }

function isOrthogonalLinks() {
  return localStorage.getItem("todocompanion.settings.linkStyle") !== "bezier";
}

// Retangulos dos cards inflados pela margem, usados pelo roteador para desviar.
function buildLinkObstacles(nodes) {
  return nodes.map(node => {
    const w = node.w || 288;
    const h = nodeHeight(node);
    return {
      id: node.id,
      x1: Math.round(node.x - LINK_MARGIN),
      y1: Math.round(node.y - LINK_MARGIN),
      x2: Math.round(node.x + w + LINK_MARGIN),
      y2: Math.round(node.y + h + LINK_MARGIN)
    };
  });
}

function createLinkPath(start, end, startPort = "out", endPort = "in", obstacles = []) {
  return routeLinkPath({
    start,
    end,
    startPort,
    endPort,
    obstacles,
    margin: LINK_MARGIN,
    curved: !isOrthogonalLinks()
  });
}

function renderUserTasks() {
  const user = activeUser();
  const activeId = activeBoard()?.id ?? null;
  tasksSidebar.hidden = !user;
  userTaskList.innerHTML = "";

  if (!user) {
    return;
  }

  user.tasks.forEach(task => {
    const status = normalizeStatus(task.status);
    if (taskStatusFilter !== "all" && status !== taskStatusFilter) {
      return;
    }
    const priority = normalizePriority(task.priority);
    const criticality = normalizeCriticality(task.criticality);
    const card = document.createElement("article");
    card.className = `user-task-card status-${status} priority-${priority} crit-${criticality}${task.id === activeId ? " active" : ""}${task.id === dockDragId ? " dragging" : ""}`;
    card.dataset.id = task.id;
    // Card enxuto: so o titulo. Numero, datas, criticidade e anexos continuam
    // acessiveis pelo popup de info (botao "i") e pelo overlay do canvas.
    card.title = task.title;
    card.innerHTML = `
      <span class="user-task-id">#${task.number || ""}</span>
      <span class="user-task-title">${escapeHtml(task.title)}</span>
      <div class="user-task-actions">
        <button class="user-task-info" type="button" aria-label="Information" title="Information">${icons.info}</button>
        <button class="user-task-remove" type="button" aria-label="Remove main task" title="Remove main task">${icons.close}</button>
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
    card.querySelector(".user-task-remove").addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      await removeMainTask(task.id, user.id);
    });

    userTaskList.appendChild(card);
  });
}

const USERS_RAIL_KEY = "todocompanion.settings.usersRailCollapsed";

function initUsersRail() {
  applyUsersRailCollapsed(localStorage.getItem(USERS_RAIL_KEY) === "1");
}

function applyUsersRailCollapsed(collapsed) {
  usersRail.classList.toggle("collapsed", collapsed);
  usersRailToggle.innerHTML = icons.menu;
  usersRailToggle.title = collapsed ? "Expand panel" : "Collapse panel";
  usersRailToggle.setAttribute("aria-label", collapsed ? "Expand users panel" : "Collapse users panel");
}

function toggleUsersRail() {
  const collapsed = !usersRail.classList.contains("collapsed");
  localStorage.setItem(USERS_RAIL_KEY, collapsed ? "1" : "0");
  applyUsersRailCollapsed(collapsed);
  requestAnimationFrame(() => {
    applyViewport();
    renderLinks();
  });
}

const TASKS_SIDEBAR_KEY = "todocompanion.settings.tasksSidebarCollapsed";
const TASKS_SIDEBAR_WIDTH_KEY = "todocompanion.settings.tasksSidebarWidth";
const TASKS_SIDEBAR_DEFAULT_WIDTH = 264;
const TASKS_SIDEBAR_MIN_WIDTH = 180;
const TASKS_SIDEBAR_MAX_WIDTH = 600;

function getStoredTasksSidebarWidth() {
  const stored = parseInt(localStorage.getItem(TASKS_SIDEBAR_WIDTH_KEY), 10);
  return Number.isFinite(stored) ? Math.min(Math.max(stored, TASKS_SIDEBAR_MIN_WIDTH), TASKS_SIDEBAR_MAX_WIDTH) : TASKS_SIDEBAR_DEFAULT_WIDTH;
}

function initTasksSidebar() {
  const collapsed = localStorage.getItem(TASKS_SIDEBAR_KEY) === "1";
  applyTasksSidebarCollapsed(collapsed);
  initTasksSidebarResizer();
}

function applyTasksSidebarCollapsed(collapsed) {
  tasksSidebar.classList.toggle("collapsed", collapsed);
  tasksSidebarToggle.innerHTML = icons.menu;
  tasksSidebarToggle.title = collapsed ? "Expand panel" : "Collapse panel";
  tasksSidebarToggle.setAttribute("aria-label", collapsed ? "Expand tasks panel" : "Collapse tasks panel");

  if (collapsed) {
    tasksSidebar.style.width = "";
  } else {
    tasksSidebar.style.width = `${getStoredTasksSidebarWidth()}px`;
  }
}

function toggleTasksSidebar() {
  const collapsed = !tasksSidebar.classList.contains("collapsed");
  localStorage.setItem(TASKS_SIDEBAR_KEY, collapsed ? "1" : "0");
  applyTasksSidebarCollapsed(collapsed);
  requestAnimationFrame(() => {
    applyViewport();
    renderLinks();
  });
}

function initTasksSidebarResizer() {
  const resizer = document.getElementById("tasksSidebarResizer");
  if (!resizer) return;

  resizer.addEventListener("pointerdown", event => {
    if (event.button !== 0 || tasksSidebar.classList.contains("collapsed")) return;
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = tasksSidebar.getBoundingClientRect().width;
    let currentWidth = startWidth;

    tasksSidebar.classList.add("resizing");
    tasksSidebar.style.transition = "none";
    resizer.setPointerCapture(event.pointerId);

    const onPointerMove = moveEvent => {
      const deltaX = moveEvent.clientX - startX;
      currentWidth = Math.min(Math.max(startWidth + deltaX, TASKS_SIDEBAR_MIN_WIDTH), TASKS_SIDEBAR_MAX_WIDTH);
      tasksSidebar.style.width = `${currentWidth}px`;
      applyViewport();
      renderLinks();
    };

    const onPointerUp = upEvent => {
      resizer.releasePointerCapture(upEvent.pointerId);
      resizer.removeEventListener("pointermove", onPointerMove);
      resizer.removeEventListener("pointerup", onPointerUp);
      resizer.removeEventListener("pointercancel", onPointerUp);

      tasksSidebar.classList.remove("resizing");
      tasksSidebar.style.transition = "";
      localStorage.setItem(TASKS_SIDEBAR_WIDTH_KEY, String(Math.round(currentWidth)));
      applyViewport();
      renderLinks();
    };

    resizer.addEventListener("pointermove", onPointerMove);
    resizer.addEventListener("pointerup", onPointerUp);
    resizer.addEventListener("pointercancel", onPointerUp);
  });

  resizer.addEventListener("dblclick", () => {
    if (tasksSidebar.classList.contains("collapsed")) return;
    localStorage.setItem(TASKS_SIDEBAR_WIDTH_KEY, String(TASKS_SIDEBAR_DEFAULT_WIDTH));
    tasksSidebar.style.width = `${TASKS_SIDEBAR_DEFAULT_WIDTH}px`;
    applyViewport();
    renderLinks();
  });
}

function initTasksStatusFilter() {
  applyTasksStatusFilter(taskStatusFilter);
  tasksStatusFilter.addEventListener("click", event => {
    const pill = event.target.closest("[data-filter]");
    if (!pill) return;
    setTasksStatusFilter(pill.dataset.filter);
  });
}

function setTasksStatusFilter(filter) {
  taskStatusFilter = filter;
  localStorage.setItem(TASKS_STATUS_FILTER_KEY, filter);
  applyTasksStatusFilter(filter);
  renderUserTasks();
}

function applyTasksStatusFilter(filter) {
  tasksStatusFilter.querySelectorAll(".tasks-status-pill").forEach(pill => {
    const isActive = pill.dataset.filter === filter;
    pill.classList.toggle("active", isActive);
    pill.setAttribute("aria-selected", String(isActive));
  });
}

function toggleSortMenu() {
  if (tasksSortMenu.hidden) {
    openSortMenu();
  } else {
    closeSortMenu();
  }
}

function openSortMenu() {
  tasksSortMenu.hidden = false;
  tasksSortButton.classList.add("active");
}

function closeSortMenu() {
  tasksSortMenu.hidden = true;
  tasksSortButton.classList.remove("active");
}

function sortUserTasks(criterion) {
  const user = activeUser();
  if (!user) return;
  const comparator = taskSortComparator(criterion);
  if (!comparator) return;
  // Ordenação estável com índice de desempate para manter a ordem atual em empates.
  user.tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => comparator(a.task, b.task) || a.index - b.index)
    .forEach((entry, position) => {
      user.tasks[position] = entry.task;
    });
  saveState();
  renderUserTasks();
}

function taskSortComparator(criterion) {
  switch (criterion) {
    case "criticality":
      // Mais crítica primeiro.
      return (a, b) => normalizeCriticality(b.criticality) - normalizeCriticality(a.criticality);
    case "priority":
      // Urgente primeiro.
      return (a, b) =>
        PRIORITY_ORDER.indexOf(normalizePriority(b.priority)) - PRIORITY_ORDER.indexOf(normalizePriority(a.priority));
    case "status":
      // Ongoing, stopped, complete.
      return (a, b) =>
        STATUS_ORDER.indexOf(normalizeStatus(a.status)) - STATUS_ORDER.indexOf(normalizeStatus(b.status));
    case "start":
      return (a, b) => String(a.startDate || "").localeCompare(String(b.startDate || ""));
    case "end":
      return (a, b) => String(a.endDate || "").localeCompare(String(b.endDate || ""));
    case "title":
      return (a, b) => String(a.title || "").localeCompare(String(b.title || ""), "pt", { sensitivity: "base" });
    default:
      return null;
  }
}

function openSearchModal() {
  renderSearchResults();
  searchModal.hidden = false;
  requestAnimationFrame(() => {
    searchInput.focus();
    searchInput.select();
  });
}

function closeSearchModal() {
  searchModal.hidden = true;
}

function renderSearchResults() {
  if (!searchResults) return;

  const query = searchInput.value.trim();
  const results = getSearchResults(query);
  searchResults.innerHTML = "";

  if (!query) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "Type to search across all users.";
    searchResults.appendChild(empty);
    return;
  }

  if (!results.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No results found.";
    searchResults.appendChild(empty);
    return;
  }

  results.forEach(result => {
    const row = document.createElement("article");
    row.className = `search-result status-${result.status}`;
    row.innerHTML = `
      <div class="search-result-main">
        <div class="search-result-badges">
          <span class="search-result-kind">${result.kindLabel}</span>
          ${result.userName ? `<span class="search-result-user">${icons.user} <span>${escapeHtml(result.userName)}</span></span>` : ""}
        </div>
        <strong class="search-result-title">${escapeHtml(result.title)}</strong>
        <span class="search-result-context">${escapeHtml(result.context)}</span>
      </div>
      <span class="search-result-status">${STATUS_META[result.status].label}</span>
      <button class="search-result-view" type="button" aria-label="Visualizar" title="Visualizar">${icons.eye}</button>
    `;

    row.querySelector(".search-result-view").addEventListener("click", () => openSearchResult(result));
    row.addEventListener("dblclick", () => openSearchResult(result));
    searchResults.appendChild(row);
  });
}

function getSearchResults(query) {
  const needle = normalizeSearchText(query);
  if (!needle) return [];

  const results = [];
  state.users.forEach(user => {
    user.tasks.forEach(task => {
      const taskHaystack = normalizeSearchText([
        user.name,
        task.title,
        STATUS_META[normalizeStatus(task.status)].label,
        PRIORITY_META[normalizePriority(task.priority)].label
      ].join(" "));

      if (taskHaystack.includes(needle)) {
        results.push({
          type: "task",
          kindLabel: "Task",
          userId: user.id,
          userName: user.name,
          taskId: task.id,
          title: task.title,
          status: normalizeStatus(task.status),
          context: user.name
        });
      }

      (task.nodes || []).forEach(node => {
        const nodeHaystack = normalizeSearchText([
          user.name,
          task.title,
          node.title,
          node.body,
          STATUS_META[normalizeStatus(node.status)].label
        ].join(" "));

        if (nodeHaystack.includes(needle)) {
          results.push({
            type: "action",
            kindLabel: "Acao",
            userId: user.id,
            userName: user.name,
            taskId: task.id,
            nodeId: node.id,
            title: node.title || node.body || "Acao sem titulo",
            status: normalizeStatus(node.status),
            context: `${user.name} / ${task.title}`
          });
        }
      });
    });
  });

  return results.slice(0, 80);
}

function openSearchResult(result) {
  const user = state.users.find(item => item.id === result.userId);
  const task = user?.tasks.find(item => item.id === result.taskId);
  if (!user || !task) return;

  state.activeUserId = user.id;
  user.activeTaskId = task.id;
  clearSelection();

  if (result.type === "action") {
    state.viewMode = "canvas";
    selectedNodeId = result.nodeId;
  }

  closeSearchModal();
  saveState();
  render();

  if (result.type === "action") {
    requestAnimationFrame(() => focusCardOnNode(result.nodeId));
  }
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
    autoScrollDock(moveEvent.clientY);
    const beforeId = getDockInsertionId(moveEvent.clientY);
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

function getDockInsertionId(clientY) {
  const cards = [...userTaskList.querySelectorAll(".user-task-card")]
    .filter(card => card.dataset.id !== dockDragId);

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      return card.dataset.id;
    }
  }

  return null;
}

function autoScrollDock(clientY) {
  const rect = userTaskList.getBoundingClientRect();
  const threshold = 44;

  if (clientY < rect.top + threshold) {
    userTaskList.scrollTop -= 16;
  } else if (clientY > rect.bottom - threshold) {
    userTaskList.scrollTop += 16;
  }
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
  if (!view) return;
  // Mantem o quadrado visivel sempre como um multiplo exato de 24 unidades de mundo
  // (o mesmo grid usado para posicionar/redimensionar cards e rotear links), so
  // dobrando o passo quando ficaria pequeno demais para nao desalinhar a grade.
  let gridUnit = 24;
  while (gridUnit * view.zoom < 14) gridUnit *= 2;
  const gridSize = gridUnit * view.zoom;
  boardShell.style.setProperty("--grid-size", `${gridSize}px`);
  boardShell.style.setProperty("--grid-x", `${view.panX}px`);
  boardShell.style.setProperty("--grid-y", `${view.panY}px`);
  boardSurface.style.transform = `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`;
}

function ensureCanvasPositions() {
  const board = activeBoard();
  if (!board) return;
  let changed = false;
  const placed = [];
  const GRID = 24;

  board.nodes.forEach((node, index) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || (isDefaultNewAction(node) && overlapsPlacedNodes(node, placed))) {
      const position = getNextActionPosition(board, index);
      node.x = position.x;
      node.y = position.y;
      changed = true;
    }

    const snappedX = Math.round(node.x / GRID) * GRID;
    const snappedY = Math.round(node.y / GRID) * GRID;
    const snappedW = Math.max(288, Math.round((node.w || 288) / GRID) * GRID);
    const snappedH = node.h > 0 ? Math.round(node.h / GRID) * GRID : 0;

    if (node.x !== snappedX || node.y !== snappedY || node.w !== snappedW || node.h !== snappedH) {
      node.x = snappedX;
      node.y = snappedY;
      node.w = snappedW;
      node.h = snappedH;
      changed = true;
    }

    placed.push(node);
  });

  if (changed) {
    saveState();
  }
}

function isDefaultNewAction(node) {
  return !String(node.title || "").trim() && !String(node.body || "").trim();
}

function overlapsPlacedNodes(node, placed) {
  return placed.some(other => {
    const overlapX = Math.max(0, Math.min(node.x + (node.w || 288), other.x + (other.w || 288)) - Math.max(node.x, other.x));
    const overlapY = Math.max(0, Math.min(node.y + (node.h || 144), other.y + (other.h || 144)) - Math.max(node.y, other.y));
    const overlapArea = overlapX * overlapY;
    const nodeArea = (node.w || 288) * (node.h || 144);
    return overlapArea / nodeArea > 0.65;
  });
}

function getNextActionPosition(board, indexOverride = null) {
  const GRID = 24;
  const GAP = -24;
  const width = 288;
  const height = 144;
  const nodes = indexOverride == null ? board.nodes : board.nodes.slice(0, indexOverride);

  if (!nodes.length) {
    const rect = boardShell.getBoundingClientRect();
    const center = screenToWorld(rect.left + boardShell.clientWidth / 2, rect.top + boardShell.clientHeight / 2);
    return {
      x: Math.round((center.x - width / 2) / GRID) * GRID,
      y: Math.round((center.y - height / 2) / GRID) * GRID
    };
  }

  const last = nodes[nodes.length - 1];
  return {
    x: Math.round((last.x + (last.w || width) + GAP) / GRID) * GRID,
    y: Math.round(last.y / GRID) * GRID
  };
}

function centerCanvasOnTasks() {
  const board = activeBoard();
  if (!board?.nodes.length) {
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
  const maxX = Math.max(...board.nodes.map(node => node.x + (node.w || 288)));
  const maxY = Math.max(...board.nodes.map(node => node.y + (node.h || 144)));
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

function focusCardOnNode(nodeId) {
  const board = activeBoard();
  const node = board?.nodes.find(n => n.id === nodeId);
  if (!node) return;

  const cardWidth = node.w || 288;
  const cardHeight = node.h || 144;
  const padding = 96;
  const zoom = clamp(
    Math.min(
      (boardShell.clientWidth - padding * 2) / cardWidth,
      (boardShell.clientHeight - padding * 2) / cardHeight,
      1.3
    ),
    MIN_ZOOM,
    MAX_ZOOM
  );
  const centerX = node.x + cardWidth / 2;
  const centerY = node.y + cardHeight / 2;
  const view = activeView();

  view.zoom = zoom;
  view.panX = boardShell.clientWidth / 2 - centerX * zoom;
  view.panY = boardShell.clientHeight / 2 - centerY * zoom;

  selectedNodeId = node.id;
  selectedLinkId = null;

  saveState();
  applyViewport();
  renderLinks();
  refreshSelectionClasses();
}

function organizeCanvasCards() {
  const board = activeBoard();
  if (!board.nodes.length) {
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
  const maxWidth = Math.max(...board.nodes.map(node => node.w || 288));
  const minX = Math.min(...board.nodes.map(node => Number.isFinite(node.x) ? node.x : 0));
  const minY = Math.min(...board.nodes.map(node => Number.isFinite(node.y) ? node.y : 0));
  const originX = Number.isFinite(minX) ? minX : 80;
  const originY = Number.isFinite(minY) ? minY : 80;
  const columnGap = maxWidth + 60;
  const rowGap = 24;
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
    const height = nodeHeight(node);
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
    if (!position || isRootNode(board, node.id)) {
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
  const view = activeView();
  if (!view) return;
  event.preventDefault();
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

  const view = activeView();
  if (!view) return;

  finalizeZoomAnim();
  clearSelection();
  refreshSelectionClasses();

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
  if (!view) return { x: 0, y: 0 };
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
  if (!board) return;
  const id = makeId("action");
  const replyParentId = board.nodes.some(node => node.id === parentId) ? parentId : null;
  const position = replyParentId
    ? getReplyActionPosition(board, replyParentId)
    : getViewportActionPosition();
  const GRID = 24;
  const node = {
    id,
    title: "",
    body: "",
    status: "ongoing",
    createdAt: new Date().toISOString(),
    x: Math.round(position.x / GRID) * GRID,
    y: Math.round(position.y / GRID) * GRID,
    w: 288,
    h: 144
  };

  if (replyParentId) {
    board.nodes.splice(getReplyInsertionIndex(board, replyParentId), 0, node);
    addLink(replyParentId, id, "out", "in");
  } else {
    board.nodes.push(node);
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

  const outgoingCount = board.links.filter(link => link.from === parentId && (link.fromPort || "out") === "out").length;
  const GRID = 24;
  const GAP = 96;
  const newH = 144;
  const targetY = parent.y + outgoingCount * (newH + 24);
  return {
    x: Math.round((parent.x + (parent.w || 288) + GAP) / GRID) * GRID,
    y: Math.round(targetY / GRID) * GRID
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
  if (!board) return;
  newCardPosition = screenToWorld(event.clientX, event.clientY);

  const margin = 8;
  const popupW = 150;
  const popupH = 52;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(event.clientX + margin, vw - popupW - margin);
  const top = Math.min(event.clientY + margin, vh - popupH - margin);
  newCardForm.style.left = left + "px";
  newCardForm.style.top = top + "px";
  newCardForm.hidden = false;
  requestAnimationFrame(() => newCardForm.querySelector("button")?.focus());
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
  const GRID = 24;
  board.nodes.push({
    id,
    title: "",
    body: "",
    status: "ongoing",
    x: Math.round((pos.x - 144) / GRID) * GRID,
    y: Math.round((pos.y - 72) / GRID) * GRID,
    w: 288,
    h: 144
  });
  pendingCardPop.add(id);
  selectedNodeId = id;
  selectedLinkId = null;
  closeNewCardModal();
  saveState();
  render();
}

// Dimensiona um card de imagem a partir do tamanho natural do arquivo, limitando
// a largura e arredondando para a grade — assim o card ja nasce alinhado, como
// qualquer outro, em vez de comecar num tamanho quebrado.
function applyImageNodeSize(node, imgWidth, imgHeight) {
  const GRID = 24;
  let w = imgWidth;
  let h = imgHeight;
  const maxWidth = Math.max(node.w || 320, 200);
  if (w > maxWidth) {
    h = Math.round((maxWidth / w) * h);
    w = maxWidth;
  }
  node.w = Math.max(72, Math.round(w / GRID) * GRID);
  node.h = Math.max(72, Math.round(h / GRID) * GRID);
}

function handleUpdateImage(event) {
  const file = event.target.files[0];
  if (!file || !window.nodeToUpdateImage) return;

  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    const img = new Image();
    img.onload = () => {
      const board = activeBoard();
      if (!board) return;
      const node = board.nodes.find(n => n.id === window.nodeToUpdateImage);
      if (node && node.type === "image") {
        applyImageNodeSize(node, img.width, img.height);
        node.imageUrl = dataUrl;
        saveState();
        render();
      }
      window.nodeToUpdateImage = null;
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
  event.target.value = ""; // Reset input
}



function openUserCreatePopup(event) {
  event.preventDefault();
  closeNewCardModal();
  closeTaskEditPopup();
  closeAttachmentsPopup();

  userCreateNameInput.value = "";
  // O botao vive no rodape do rail lateral, entao o popup abre para cima e a
  // direita dele; se nao couber acima, cai para baixo.
  const rect = addBoardButton.getBoundingClientRect();
  const margin = 8;
  const popupW = 220;
  const popupH = 150;
  const left = Math.min(rect.left, window.innerWidth - popupW - margin);
  const top = rect.top - margin - popupH >= margin
    ? rect.top - margin - popupH
    : Math.min(rect.bottom + margin, window.innerHeight - popupH - margin);

  userCreateForm.style.left = `${Math.max(margin, left)}px`;
  userCreateForm.style.top = `${Math.max(margin, top)}px`;
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
  user.activeTaskId = null;
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
  const GRID = 24;
  return {
    x: Math.round((center.x - 144) / GRID) * GRID,
    y: Math.round((center.y - 72) / GRID) * GRID
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
    ? "New user"
    : mode === "edit-user"
      ? "Edit user"
      : mode === "edit-task"
        ? "Edit main task"
        : "New main task";
  canvasForm.classList.toggle("user-only", userOnlyMode);
  canvasOwnerLabel.textContent = userOnlyMode ? "Name" : "User";
  canvasOwnerInput.disabled = mode === "create-task" || mode === "edit-task";
  canvasNameInput.required = !userOnlyMode;
  canvasOwnerInput.value = mode === "create-user" ? "" : user?.name || "";
  canvasNameInput.value = mode === "create-task" ? `Main task ${((user?.tasks.length || 0) + 1)}` : mode === "create-user" ? "" : task?.title || "";
  const dates = normalizeDateRange(mode === "create-task" ? null : task?.startDate, mode === "create-task" ? null : task?.endDate);
  canvasStartInput.value = dates.startDate;
  canvasEndInput.min = dates.startDate;
  canvasEndInput.value = dates.endDate;
  canvasPriorityInput.value = mode === "create-task" ? "normal" : normalizePriority(task?.priority);
  canvasStatusInput.value = mode === "create-task" ? "ongoing" : normalizeStatus(task?.status);
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
    user.activeTaskId = null;
    state.users.push(user);
    state.activeUserId = user.id;
    clearSelection();
    closeTaskDialog();
    saveState();
    render();
    return;
  }

  const dates = enforceDateRangeInputs(canvasStartInput, canvasEndInput);
  const data = {
    title: (canvasNameInput.value.trim() || "New main task").slice(0, 56),
    status: normalizeStatus(canvasStatusInput.value),
    priority: normalizePriority(canvasPriorityInput.value),
    startDate: dates.startDate,
    endDate: dates.endDate
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
      const previousTitle = task.title;
      Object.assign(task, data);
      syncFirstNodeTitleWithTask(task, previousTitle);
      user.activeTaskId = task.id;
    }
  } else {
    const user = activeUser();
    if (!user) return;
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
  const dates = normalizeDateRange(task.startDate, task.endDate);
  popup.querySelector("#tepNameInput").value = task.title || "";
  popup.querySelector("#tepStartInput").value = dates.startDate;
  popup.querySelector("#tepEndInput").min = dates.startDate;
  popup.querySelector("#tepEndInput").value = dates.endDate;
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
  const previousTitle = task.title;
  const dates = enforceDateRangeInputs(popup.querySelector("#tepStartInput"), popup.querySelector("#tepEndInput"));
  task.title = (popup.querySelector("#tepNameInput").value.trim() || task.title).slice(0, 56);
  task.startDate = dates.startDate;
  task.endDate = dates.endDate;
  task.priority = normalizePriority(popup.querySelector("#tepPriorityInput").value);
  task.status = normalizeStatus(popup.querySelector("#tepStatusInput").value);
  syncFirstNodeTitleWithTask(task, previousTitle);

  closeTaskEditPopup();
  saveState();
  render();
}

async function removeMainTask(taskId, userId = state.activeUserId) {
  const user = state.users.find(item => item.id === userId) || activeUser();
  if (!user) {
    return;
  }

  const index = user.tasks.findIndex(task => task.id === taskId);
  if (index < 0) {
    return;
  }

  const task = user.tasks[index];
  const ok = await openConfirmDelete({
    title: `Delete "${task.title || "main task"}"`,
    message: "This action will remove this main task. It cannot be undone.",
    requireCode: true
  });
  if (!ok) {
    return;
  }

  const wasActiveTask = user.activeTaskId === taskId;
  user.tasks.splice(index, 1);
  closeTaskEditPopup();

  if (!user.tasks.length) {
    const fallbackTask = createMainTask({ title: "New main task" }, 0);
    user.tasks.push(fallbackTask);
    user.activeTaskId = fallbackTask.id;
    clearSelection();
  } else if (wasActiveTask) {
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

  const candidatePorts = isOutputPort(drag.port)
    ? ["in"]
    : ["out"];

  let best = null;
  let bestDist = snapRadiusWorld;

  for (const node of board.nodes) {
    if (node.id === drag.nodeId) continue;
    
    for (const port of candidatePorts) {
      if (isRootNode(board, node.id) && isInputPort(port)) continue;
      
      const point = getPortPoint(node, port);
      const dist = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { nodeId: node.id, port, point };
      }
    }
  }

  return best;
}

function startLinkDrag(event, nodeId, port) {
  event.preventDefault();
  event.stopPropagation();

  clearLineagePreview(false);

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
  boardShell.classList.add("linking");
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
  boardShell.classList.remove("linking");

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
    createdNodeId = createCardFromConnection(drag, screenToWorld(event.clientX, event.clientY), clickLike, "action");
  }

  if (createdNodeId) {
    selectedNodeId = createdNodeId;
  }

  saveState();
  render();
}

function createCardFromConnection(drag, dropPoint, useReplySpacing = false, type = "action") {
  const board = activeBoard();
  const id = makeId("action");
  const GRID = 24;
  const width = 288;
  const height = 144;

  const position = useReplySpacing
    ? getConnectionClickPosition(board, drag, width, height)
    : null;
  const xOffset = drag.port === "in" ? -width : drag.port === "top" || drag.port === "bottom" ? -width / 2 : 0;
  const yOffset = drag.port === "top" ? -height : drag.port === "bottom" ? 0 : -height / 2;
  const posX = Math.round((position ? position.x : dropPoint.x + xOffset) / GRID) * GRID;
  const posY = Math.round((position ? position.y : dropPoint.y + yOffset) / GRID) * GRID;

  board.nodes.push({
    id,
    title: "",
    body: "",
    status: "ongoing",
    createdAt: new Date().toISOString(),
    x: posX,
    y: posY,
    w: width,
    h: height,
    type: type === "image" ? "image" : undefined,
    imageUrl: type === "image" ? "" : undefined
  });
  pendingCardPop.add(id);

  if (drag.port === "top") {
    addLink(drag.nodeId, id, "top", "bottom");
  } else if (drag.port === "bottom") {
    addLink(drag.nodeId, id, "bottom", "top");
  } else if (drag.port === "in") {
    addLink(drag.nodeId, id, "in", "out");
  } else {
    addLink(drag.nodeId, id, "out", "in");
  }

  return id;
}

function getConnectionClickPosition(board, drag, width, height) {
  const GRID = 24;
  const GAP = 96;
  const source = board.nodes.find(node => node.id === drag.nodeId);
  if (!source) {
    return getNextActionPosition(board);
  }

  if (drag.port === "out") {
    return getReplyActionPosition(board, drag.nodeId);
  }

  if (drag.port === "in") {
    const incomingCount = board.links.filter(link => link.to === drag.nodeId && (link.toPort || "in") === "in").length;
    return {
      x: Math.round((source.x - width - GAP) / GRID) * GRID,
      y: Math.round((source.y + incomingCount * (height + 24)) / GRID) * GRID
    };
  }

  if (drag.port === "bottom") {
    const bottomChildCount = board.links.filter(link => link.from === drag.nodeId && link.fromPort === "bottom").length;
    return {
      x: Math.round(source.x / GRID) * GRID,
      y: Math.round((source.y + (source.h || height) + GAP + bottomChildCount * (height + 24)) / GRID) * GRID
    };
  }

  const topIncomingCount = board.links.filter(link => link.to === drag.nodeId && link.toPort === "top").length;
  return {
    x: Math.round(source.x / GRID) * GRID,
    y: Math.round((source.y - height - GAP - topIncomingCount * (height + 24)) / GRID) * GRID
  };
}

function addLink(from, to, fromPort = "out", toPort = "in") {
  const board = activeBoard();
  if (!from || !to || from === to) {
    return false;
  }

  if (isRootNode(board, to) || (isRootNode(board, from) && fromPort !== "out")) {
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
    if (!board) return;
    board.links = board.links.filter(link => link.id !== selectedLinkId);
    selectedLinkId = null;
    saveState();
    render();
  }
}

async function removeNode(nodeId) {
  const board = activeBoard();
  if (!board || isRootNode(board, nodeId)) {
    return;
  }

  const ok = await openConfirmDelete({
    title: "Delete card",
    message: "This card will be removed from the canvas. It cannot be undone.",
    requireCode: false
  });
  if (!ok) {
    return;
  }

  removeNodesImmediately(new Set([nodeId]));
}

function removeNodesImmediately(nodeIds) {
  const board = activeBoard();
  const ids = nodeIds instanceof Set ? nodeIds : new Set([nodeIds]);
  if (board.nodes[0]?.id) {
    ids.delete(board.nodes[0].id);
  }
  if (!ids.size) {
    return;
  }
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
  const card = nodesLayer.querySelector(`[data-id="${nodeId}"]`);
  resizeState = {
    nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: node.w || 288,
    height: node.h || (card ? card.offsetHeight : 144)
  };

  card?.classList.add("resizing", "selected", "fixed-height");

  const move = moveEvent => {
    if (!resizeState || moveEvent.pointerId !== resizeState.pointerId) {
      return;
    }

    const zoom = activeView().zoom;
    const dx = (moveEvent.clientX - resizeState.startX) / zoom;
    const dy = (moveEvent.clientY - resizeState.startY) / zoom;
    
    const GRID = 24;
    // Os dois eixos sao arredondados para a grade de forma independente, igual ao
    // card de texto. A trava de proporcao antiga derivava um dos lados do outro
    // (h = w / aspect) sem arredondar, e por isso o card de imagem parava em
    // tamanhos fora da grade. Imagens aceitam largura menor que o card de texto,
    // que so tem minimo de 288px por causa da barra de formatacao.
    const minW = node.type === "image" ? 72 : 288;
    node.w = Math.max(minW, Math.round((resizeState.width + dx) / GRID) * GRID);
    node.h = Math.max(72, Math.round((resizeState.height + dy) / GRID) * GRID);

    if (card) {
      card.style.width = `${node.w}px`;
      card.style.minHeight = `${node.h}px`;
      card.style.height = "auto";
      card.classList.add("fixed-height");
      // Sem isso nodeHeight() continua usando a altura em cache de antes do
      // resize (renderedHeights tem prioridade sobre node.h), e os ports/arrows
      // ficam parados enquanto o card e arrastado.
      renderedHeights.set(node.id, card.offsetHeight);
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

// Aproxima o card arrastado do alinhamento de centro (horizontal e/ou vertical)
// com qualquer outro card do board, para que linhas e composicao fiquem alinhadas.
// O alinhamento usa o mesmo centro que getPortPoint, entao a linha SVG fica de fato
// horizontal/vertical quando ha conexao. Retorna a posicao (possivelmente ajustada)
// e as coords das guias visuais ativas.
function computeAlignmentSnap(board, node, zoom) {
  const threshold = ALIGN_SNAP_SCREEN_PX / Math.max(zoom, 0.0001);

  const halfW = (node.w || 288) / 2;
  const halfH = nodeHeight(node) / 2;
  let x = node.x;
  let y = node.y;
  let guideX = null;
  let guideY = null;
  let bestDx = threshold;
  let bestDy = threshold;

  board.nodes.forEach(other => {
    if (other.id === node.id) return;
    const otherCenterX = other.x + (other.w || 288) / 2;
    const otherCenterY = other.y + nodeHeight(other) / 2;

    const dy = Math.abs(node.y + halfH - otherCenterY);
    if (dy < bestDy) {
      bestDy = dy;
      y = otherCenterY - halfH;
      guideY = otherCenterY;
    }

    const dx = Math.abs(node.x + halfW - otherCenterX);
    if (dx < bestDx) {
      bestDx = dx;
      x = otherCenterX - halfW;
      guideX = otherCenterX;
    }
  });

  return { x, y, guideX, guideY };
}

function startDrag(event, nodeId) {
  const board = activeBoard();
  const node = board.nodes.find(item => item.id === nodeId);
  if (!node) {
    return;
  }

  finalizeZoomAnim();
  if (!event.target.closest(".empty-image-card")) {
    event.preventDefault();
  }
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

    const snap = computeAlignmentSnap(board, node, zoom);
    const GRID = 24;
    if (snap.guideX === null) snap.x = Math.round(snap.x / GRID) * GRID;
    if (snap.guideY === null) snap.y = Math.round(snap.y / GRID) * GRID;

    node.x = snap.x;
    node.y = snap.y;
    dragState.snap = snap;

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

    const distance = Math.hypot(upEvent.clientX - dragState.startX, upEvent.clientY - dragState.startY);
    const didMove = distance >= 5;

    dragState = null;
    
    if (didMove) {
      saveState();
    } else {
      // Handle clicks on empty image card manually since renderNodes destroys the DOM
      if (upEvent.target.closest(".empty-image-card")) {
        document.getElementById('updateImageInput').click();
        window.nodeToUpdateImage = nodeId;
      }
    }

    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    renderNodes();
    renderLinks();
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

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"]+/g;
const BODY_TOKEN_PATTERN = /!\[image\]\(([^)]+)\)|@\[([^\]\r\n]+)\]\(attachment:([^)]+)\)|\[([ xX])\] |(?:https?:\/\/|www\.)(?:(?!@\[)[^\s<>"])+/g;

function extractUrl(text) {
  const match = String(text || "").match(URL_PATTERN);
  return match ? match[0] : null;
}

function toAbsoluteUrl(url) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function openExternalUrl(url) {
  if (invoke) {
    invoke("open_url", { url }).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function renderBodyHtml(text) {
  const source = String(text || "");
  let html = "";
  let lastIndex = 0;

  for (const match of source.matchAll(BODY_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    html += preserveFormatTags(escapeHtmlPreservingFormats(source.slice(lastIndex, index)));

    if (match[0].startsWith("![image](")) {
      html += `<img src="${escapeAttr(match[1])}" style="max-width: 100%; border-radius: 4px; margin: 4px 0;" />`;
    } else if (match[3]) {
      html += renderAttachmentReferenceHtml(match[2], match[3], match[0]);
    } else if (match[4] !== undefined) {
      const isChecked = match[4].toLowerCase() === "x";
      html += `<span class="card-todo-wrap" contenteditable="false" data-checked="${isChecked}"><button type="button" class="card-todo-btn${isChecked ? " checked" : ""}" role="checkbox" aria-checked="${isChecked}">${isChecked ? icons.check : ""}</button></span> `;
    } else {
      const url = match[0];
      html += `<a class="card-body-link" href="${escapeAttr(toAbsoluteUrl(url))}">${escapeHtml(url)}</a>`;
    }

    lastIndex = index + match[0].length;
  }

  return html + preserveFormatTags(escapeHtmlPreservingFormats(source.slice(lastIndex)));
}

function escapeHtmlPreservingFormats(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function preserveFormatTags(escaped) {
  return escaped
    .replace(/&lt;(b|i|u|s|ul|ol|li)&gt;/gi, (_, tag) => `<${tag.toLowerCase()}>`)
    .replace(/&lt;\/(b|i|u|s|ul|ol|li)&gt;/gi, (_, tag) => `</${tag.toLowerCase()}>`);
}

function renderAttachmentReferenceHtml(label, attachmentId, rawToken = "") {
  const att = findActiveAttachmentById(attachmentId);
  const displayName = att?.name || label || "attachment";
  const image = isImageAttachment(att || { name: displayName });
  const kindLabel = image ? "@image" : "@document";
  const kindClass = image ? " image" : " document";
  const icon = image ? icons.image : icons.file;
  const missingClass = att ? "" : " missing";
  const token = rawToken || `@[${label}](attachment:${attachmentId})`;
  return `<span class="card-attachment-link${kindClass}${missingClass}" contenteditable="false" data-attachment-id="${escapeAttr(attachmentId)}" data-attachment-token="${escapeAttr(token)}" title="${escapeAttr(displayName)}" role="link" tabindex="-1">${icon}<strong>${kindLabel}</strong><button type="button" class="card-attachment-remove" aria-label="Remove attachment" tabindex="-1" contenteditable="false">×</button></span>`;
}

function serializeEditableContent(el) {
  if (!el) return "";
  let result = "";
  el.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches?.(".card-attachment-link")) {
        result += node.dataset.attachmentToken || "";
      } else if (node.matches?.(".card-todo-wrap") || node.matches?.(".card-todo-btn")) {
        const wrap = node.matches?.(".card-todo-wrap") ? node : node.closest(".card-todo-wrap");
        const isChecked = wrap?.dataset?.checked === "true" || wrap?.querySelector(".card-todo-btn.checked") !== null || node.classList?.contains("checked");
        result += isChecked ? "[x] " : "[ ] ";
      } else if (node.tagName === "BR") {
        result += "\n";
      } else if (node.tagName === "IMG") {
        result += `![image](${node.getAttribute("src")})`;
      } else {
        const tag = node.tagName;
        const formatTag = getFormatTag(tag);
        if (formatTag) {
          result += `<${formatTag}>${serializeEditableContent(node)}</${formatTag}>`;
        } else if (tag === "DIV" || tag === "P") {
          if (result && !result.endsWith("\n")) result += "\n";
          result += serializeEditableContent(node);
        } else {
          result += serializeEditableContent(node);
        }
      }
    }
  });
  return result;
}

function getFormatTag(tagName) {
  switch (tagName) {
    case "B": case "STRONG": return "b";
    case "I": case "EM": return "i";
    case "U": return "u";
    case "S": case "STRIKE": case "DEL": return "s";
    case "UL": return "ul";
    case "OL": return "ol";
    case "LI": return "li";
    default: return null;
  }
}

function getEditableTrigger(editable) {
  if (!editable) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;
  if (!editable.contains(range.startContainer)) return null;

  const container = range.startContainer;
  if (container.nodeType !== Node.TEXT_NODE) return null;

  const offset = range.startOffset;
  const beforeCaret = container.textContent.slice(0, offset);
  const match = beforeCaret.match(/(^|[\s([{])@([^\s@\[\]()]{0,80})$/);
  if (!match) return null;

  return {
    editor: editable,
    container,
    triggerStart: offset - match[2].length - 1,
    triggerEnd: offset,
    query: match[2]
  };
}

function placeCaretAfter(node) {
  if (!node) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function insertChipAtTrigger(trigger, att) {
  const { editor, container, triggerStart, triggerEnd } = trigger;
  if (!editor || !container?.isConnected || !att) return false;

  const range = document.createRange();
  range.setStart(container, triggerStart);
  range.setEnd(container, triggerEnd);
  range.deleteContents();

  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderAttachmentReferenceHtml(att.name, att.id, formatAttachmentReferenceToken(att));
  const chip = wrapper.firstElementChild;
  if (!chip) return false;

  range.insertNode(chip);

  const space = document.createTextNode(" ");
  if (chip.nextSibling) {
    chip.parentNode.insertBefore(space, chip.nextSibling);
  } else {
    chip.parentNode.appendChild(space);
  }

  const sel = window.getSelection();
  const newRange = document.createRange();
  newRange.setStart(space, 1);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);

  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function removeChipFromEditable(editable, chipElement) {
  if (!editable || !chipElement || !editable.contains(chipElement)) return false;
  const next = chipElement.nextSibling;
  chipElement.remove();
  if (next && next.nodeType === Node.TEXT_NODE && next.textContent.startsWith(" ")) {
    next.textContent = next.textContent.slice(1);
  }
  editable.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatCreatedAt(isoString) {
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

// Mesma regra de activeBoard: com activeTaskId em null nao ha task alvo, senao os
// anexos passariam a mirar a primeira task mesmo com nada selecionado.
function activeMainTask() {
  const user = activeUser();
  if (!user || user.activeTaskId === null) return null;
  return user.tasks.find(t => t.id === user.activeTaskId) || user.tasks[0] || null;
}

function findActiveAttachmentById(attachmentId) {
  const task = activeMainTask();
  return (task?.attachments || []).find(att => att.id === attachmentId) || null;
}

function isImageAttachment(att) {
  const type = String(att?.type || att?.mimeType || "").toLowerCase();
  if (type.startsWith("image/")) {
    return true;
  }

  const name = String(att?.name || att?.file || "").toLowerCase();
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|tiff?)$/.test(name);
}

function preserveAttachmentReferenceTarget(target = null) {
  let candidate = null;
  const fromTarget = target?.closest?.("[contenteditable]");
  if (fromTarget) {
    candidate = fromTarget;
  } else if (attachmentReferenceState?.editor?.isConnected) {
    candidate = attachmentReferenceState.editor;
  } else if (document.activeElement?.closest?.("[contenteditable]")) {
    candidate = document.activeElement.closest("[contenteditable]");
  }

  if (!candidate) {
    return false;
  }

  let trigger;
  if (attachmentReferenceState?.editor === candidate && attachmentReferenceState.container?.isConnected) {
    trigger = {
      editor: candidate,
      container: attachmentReferenceState.container,
      triggerStart: attachmentReferenceState.triggerStart,
      triggerEnd: attachmentReferenceState.triggerEnd
    };
  } else {
    trigger = getEditableTrigger(candidate);
  }

  if (!trigger?.container) {
    return false;
  }

  pendingAttachmentReferenceTarget = {
    editor: candidate,
    container: trigger.container,
    triggerStart: trigger.triggerStart,
    triggerEnd: trigger.triggerEnd,
    triggerText: trigger.container.textContent.slice(trigger.triggerStart, trigger.triggerEnd)
  };
  return true;
}

function insertAttachmentReferenceFromPending(att) {
  const target = pendingAttachmentReferenceTarget;
  pendingAttachmentReferenceTarget = null;
  if (!target?.editor?.isConnected || !target.container?.isConnected) {
    return false;
  }
  const currentText = target.container.textContent.slice(target.triggerStart, target.triggerEnd);
  if (currentText !== target.triggerText) {
    return false;
  }

  return insertChipAtTrigger({
    editor: target.editor,
    container: target.container,
    triggerStart: target.triggerStart,
    triggerEnd: target.triggerEnd
  }, att);
}

function handleClipboardPaste(event) {
  if (!event.clipboardData || !clipboardAttachModal.hidden) {
    return;
  }

  const file = getClipboardAttachmentFile(event.clipboardData);
  if (!file || !activeMainTask()) {
    return;
  }

  event.preventDefault();
  preserveAttachmentReferenceTarget(event.target);
  openClipboardAttachModal(file);
}

function getClipboardAttachmentFile(data) {
  const files = [];

  Array.from(data.files || []).forEach(file => {
    if (isClipboardFile(file)) files.push(file);
  });

  Array.from(data.items || []).forEach(item => {
    if (item.kind !== "file") return;
    const file = item.getAsFile();
    if (isClipboardFile(file)) files.push(file);
  });

  const seen = new Set();
  const uniqueFiles = files.filter(file => {
    const key = `${file.name}|${file.size}|${file.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueFiles[0] ? normalizeClipboardFile(uniqueFiles[0]) : null;
}

function isClipboardFile(file) {
  return !!(file && (file.size > 0 || file.name || file.type));
}

function normalizeClipboardFile(file) {
  if (file.name && file.name.trim()) {
    return file;
  }

  const type = file.type || "application/octet-stream";
  const extension = extensionFromMimeType(type);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const baseName = type.startsWith("image/") ? "imagem-colada" : "arquivo-colado";
  return new File([file], `${baseName}-${stamp}.${extension}`, {
    type,
    lastModified: Date.now()
  });
}

function extensionFromMimeType(type = "") {
  const normalized = type.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/png") return "png";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/bmp") return "bmp";
  if (normalized === "application/pdf") return "pdf";
  if (normalized === "text/plain") return "txt";
  return "bin";
}

function openClipboardAttachModal(file) {
  closeAttachmentReferencePicker();
  if (!attachmentsPopup.hidden) {
    closeAttachmentsPopup();
  }

  clearClipboardAttachmentState();
  const isImage = file.type?.startsWith("image/");
  const objectUrl = isImage ? URL.createObjectURL(file) : null;
  const nameParts = splitFileName(file.name);
  clipboardAttachmentState = { file, objectUrl, extension: nameParts.extension };

  clipboardAttachPreview.innerHTML = "";
  if (objectUrl) {
    const image = document.createElement("img");
    image.src = objectUrl;
    image.alt = file.name;
    clipboardAttachPreview.appendChild(image);
  } else {
    const preview = document.createElement("div");
    preview.className = "clipboard-file-preview";
    preview.innerHTML = `${icons.file}<span>File</span>`;
    clipboardAttachPreview.appendChild(preview);
  }

  clipboardAttachNameInput.value = nameParts.stem;
  clipboardAttachExtension.textContent = nameParts.extension;
  clipboardAttachExtension.hidden = !nameParts.extension;
  clipboardAttachMeta.textContent = [file.type || "File", formatFileSize(file.size)].filter(Boolean).join(" - ");
  clipboardAttachConfirm.disabled = false;
  clipboardAttachModal.hidden = false;
  requestAnimationFrame(() => {
    clipboardAttachNameInput.focus();
    clipboardAttachNameInput.select();
  });
}

function closeClipboardAttachModal() {
  clipboardAttachModal.hidden = true;
  clipboardAttachPreview.innerHTML = "";
  clipboardAttachNameInput.value = "";
  clipboardAttachExtension.textContent = "";
  clipboardAttachExtension.hidden = true;
  clipboardAttachMeta.textContent = "";
  clipboardAttachConfirm.disabled = false;
  pendingAttachmentReferenceTarget = null;
  clearClipboardAttachmentState();
}

function clearClipboardAttachmentState() {
  if (clipboardAttachmentState?.objectUrl) {
    URL.revokeObjectURL(clipboardAttachmentState.objectUrl);
  }
  clipboardAttachmentState = null;
}

async function confirmClipboardAttachment() {
  const file = clipboardAttachmentState?.file;
  if (!file) {
    closeClipboardAttachModal();
    return;
  }

  clipboardAttachConfirm.disabled = true;
  await attachFromBytes(renameClipboardFile(file, clipboardAttachNameInput.value, clipboardAttachmentState.extension));
  closeClipboardAttachModal();
}

function renameClipboardFile(file, requestedStem, extension = "") {
  const fallback = splitFileName(file.name);
  const stem = sanitizeFileName(requestedStem) || fallback.stem || "arquivo-colado";
  const name = `${stem}${extension || fallback.extension}`;
  if (name === file.name) {
    return file;
  }

  return new File([file], name, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified || Date.now()
  });
}

function splitFileName(fileName = "") {
  const cleanName = sanitizeFileName(fileName) || "arquivo-colado.bin";
  const dotIndex = cleanName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < cleanName.length - 1) {
    return {
      stem: cleanName.slice(0, dotIndex),
      extension: cleanName.slice(dotIndex)
    };
  }

  return { stem: cleanName, extension: "" };
}

function sanitizeFileName(value = "") {
  const cleaned = String(value)
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .slice(0, 160);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "";
}

function syncAttachmentReferencePicker(editable) {
  const trigger = getEditableTrigger(editable);
  if (!trigger) {
    closeAttachmentReferencePicker(editable);
    return;
  }

  openAttachmentReferencePicker(editable, trigger);
}

function openAttachmentReferencePicker(editable, trigger) {
  const items = getAttachmentReferenceItems(trigger.query);
  const previousIndex = attachmentReferenceState?.editor === editable ? attachmentReferenceState.selectedIndex : 0;
  const selectedIndex = items.length ? clamp(previousIndex, 0, items.length - 1) : -1;
  attachmentReferenceState = {
    editor: editable,
    container: trigger.container,
    triggerStart: trigger.triggerStart,
    triggerEnd: trigger.triggerEnd,
    query: trigger.query,
    selectedIndex,
    items
  };

  renderAttachmentReferencePicker();
  attachmentReferencePopup.hidden = false;
  requestAnimationFrame(() => {
    attachmentReferencePopup.classList.add("visible");
    positionAttachmentReferencePicker();
  });
}

function closeAttachmentReferencePicker(editable = null) {
  if (!attachmentReferencePopup || attachmentReferencePopup.hidden) {
    attachmentReferenceState = null;
    return;
  }
  if (editable && attachmentReferenceState?.editor !== editable) {
    return;
  }

  attachmentReferencePopup.classList.remove("visible");
  attachmentReferencePopup.hidden = true;
  attachmentReferenceState = null;
}

function getAttachmentReferenceItems(query = "") {
  const items = activeMainTask()?.attachments || [];
  const normalizedQuery = normalizeAttachmentReferenceText(query);
  if (!normalizedQuery) {
    return items;
  }

  return items.filter(att => normalizeAttachmentReferenceText(att.name).includes(normalizedQuery));
}

function normalizeAttachmentReferenceText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function renderAttachmentReferencePicker() {
  const items = attachmentReferenceState?.items || [];
  attachmentReferenceList.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "attachment-reference-empty";
    empty.textContent = "No attachments";
    attachmentReferenceList.appendChild(empty);
    return;
  }

  items.forEach((att, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `attachment-reference-option${index === attachmentReferenceState.selectedIndex ? " active" : ""}`;
    option.dataset.index = String(index);

    const name = document.createElement("span");
    name.className = "attachment-reference-name";
    name.textContent = att.name;
    name.title = att.name;

    const size = document.createElement("span");
    size.className = "attachment-reference-size";
    size.textContent = formatFileSize(att.size);

    option.appendChild(name);
    option.appendChild(size);
    option.addEventListener("mouseenter", () => {
      if (!attachmentReferenceState) return;
      attachmentReferenceState.selectedIndex = index;
      attachmentReferenceList.querySelectorAll(".attachment-reference-option").forEach((el, i) => {
        el.classList.toggle("active", i === index);
      });
    });
    option.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      selectAttachmentReference(att);
    });
    attachmentReferenceList.appendChild(option);
  });
}

function positionAttachmentReferencePicker() {
  const editor = attachmentReferenceState?.editor;
  if (!editor || attachmentReferencePopup.hidden) {
    return;
  }

  const sel = window.getSelection();
  let rect;
  if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).startContainer)) {
    const caretRect = sel.getRangeAt(0).getBoundingClientRect();
    rect = caretRect.width === 0 && caretRect.height === 0 ? editor.getBoundingClientRect() : caretRect;
  } else {
    rect = editor.getBoundingClientRect();
  }

  const width = attachmentReferencePopup.offsetWidth || 310;
  const height = attachmentReferencePopup.offsetHeight || 220;
  const left = clamp(rect.left, 12, Math.max(12, window.innerWidth - width - 12));
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 12) {
    top = rect.top - height - 6;
  }
  top = clamp(top, 12, Math.max(12, window.innerHeight - height - 12));

  attachmentReferencePopup.style.left = `${left}px`;
  attachmentReferencePopup.style.top = `${top}px`;
}

function handleAttachmentReferenceKeydown(event) {
  if (attachmentReferencePopup.hidden || attachmentReferenceState?.editor !== event.currentTarget) {
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveAttachmentReferenceSelection(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    moveAttachmentReferenceSelection(-1);
  } else if (event.key === "Enter" || event.key === "Tab") {
    const selected = attachmentReferenceState.items[attachmentReferenceState.selectedIndex];
    if (selected) {
      event.preventDefault();
      selectAttachmentReference(selected);
    }
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeAttachmentReferencePicker(event.currentTarget);
  }
}

function findCurrentLineTodoWrap(bodyEditor, range) {
  let cur = range.startContainer;
  while (cur && cur !== bodyEditor) {
    if (cur.nodeType === Node.ELEMENT_NODE && cur.classList.contains("card-todo-wrap")) {
      return cur;
    }
    let prev = cur.previousSibling;
    while (prev) {
      if (prev.nodeType === Node.ELEMENT_NODE) {
        if (prev.classList.contains("card-todo-wrap")) {
          return prev;
        }
        if (prev.tagName === "BR" || prev.tagName === "DIV" || prev.tagName === "P" || prev.tagName === "LI") {
          return null;
        }
        const inside = prev.querySelector?.(".card-todo-wrap");
        if (inside) return inside;
      }
      prev = prev.previousSibling;
    }
    if (cur.tagName === "DIV" || cur.tagName === "P" || cur.tagName === "LI") {
      const firstTodo = cur.querySelector(".card-todo-wrap");
      if (firstTodo) return firstTodo;
      break;
    }
    cur = cur.parentNode;
  }
  return null;
}

function handleTodoKeydown(event, bodyEditor, node) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) {
    return false;
  }

  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!bodyEditor.contains(range.startContainer)) return false;

  const todoWrap = findCurrentLineTodoWrap(bodyEditor, range);
  if (!todoWrap || !bodyEditor.contains(todoWrap)) return false;

  event.preventDefault();

  let next = todoWrap.nextSibling;
  let textAfter = "";
  while (next) {
    if (next.nodeType === Node.TEXT_NODE) {
      textAfter += next.textContent;
    } else if (next.nodeType === Node.ELEMENT_NODE) {
      if (next.tagName === "BR" || next.tagName === "DIV" || next.tagName === "P") {
        break;
      }
      textAfter += next.textContent;
    }
    next = next.nextSibling;
  }

  if (textAfter.replace(/[\s\u00A0]+/g, "") === "") {
    todoWrap.remove();
    setNodeContent(node, serializeEditableContent(bodyEditor));
    saveState();
    return true;
  }

  range.deleteContents();
  const br = document.createElement("br");
  const todoSpan = document.createElement("span");
  todoSpan.className = "card-todo-wrap";
  todoSpan.contentEditable = "false";
  todoSpan.dataset.checked = "false";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "card-todo-btn";
  btn.setAttribute("role", "checkbox");
  btn.setAttribute("aria-checked", "false");
  todoSpan.appendChild(btn);

  const space = document.createTextNode("\u00A0");
  const frag = document.createDocumentFragment();
  frag.appendChild(br);
  frag.appendChild(todoSpan);
  frag.appendChild(space);

  range.insertNode(frag);

  const newRange = document.createRange();
  newRange.setStartAfter(space);
  newRange.setEndAfter(space);
  sel.removeAllRanges();
  sel.addRange(newRange);

  setNodeContent(node, serializeEditableContent(bodyEditor));
  saveState();
  return true;
}

function moveAttachmentReferenceSelection(delta) {
  const items = attachmentReferenceState?.items || [];
  if (!items.length) {
    return;
  }

  attachmentReferenceState.selectedIndex = (attachmentReferenceState.selectedIndex + delta + items.length) % items.length;
  renderAttachmentReferencePicker();
}

function selectAttachmentReference(att) {
  const picker = attachmentReferenceState;
  if (!att || !picker?.editor || !picker.container?.isConnected) {
    closeAttachmentReferencePicker();
    return;
  }

  const editor = picker.editor;
  insertChipAtTrigger({
    editor,
    container: picker.container,
    triggerStart: picker.triggerStart,
    triggerEnd: picker.triggerEnd
  }, att);
  closeAttachmentReferencePicker();
  editor.focus();
}

function formatAttachmentReferenceToken(att) {
  const label = String(att.name || "anexo")
    .replaceAll("]", ")")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim() || "anexo";
  return `@[${label}](attachment:${att.id})`;
}

async function attachFromBytes(file) {
  if (!invoke) return null;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return null;
  try {
    const buffer = await file.arrayBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const subDir = `task${task.number}/anexos`;
    const info = await invoke("attachment_save_from_bytes", {
      userId: user.id,
      subDir,
      fileName: file.name,
      bytes
    });
    const attachment = pushAttachment(task, info, file.type);
    insertAttachmentReferenceFromPending(attachment);
    return attachment;
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
    const subDir = `task${task.number}/anexos`;
    const info = await invoke("attachment_save_from_path", {
      userId: user.id,
      subDir,
      sourcePath
    });
    const attachment = pushAttachment(task, info);
    insertAttachmentReferenceFromPending(attachment);
    return attachment;
  } catch (error) {
    console.warn("Falha ao anexar arquivo (path)", error);
    return null;
  }
}

function pushAttachment(task, info, type = "") {
  task.attachments = task.attachments || [];
  const attachment = {
    id: makeId("att"),
    file: info.file,
    name: info.original_name,
    size: info.size,
    type,
    addedAt: Date.now()
  };
  task.attachments.push(attachment);
  saveState();
  renderUserTasks();
  updateAttachButtonState();
  if (!attachmentsPopup.hidden) {
    renderAttachmentsPopup();
  }
  return attachment;
}

async function handleAttachInputChange(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    pendingAttachmentReferenceTarget = null;
  }
  for (const file of files) {
    await attachFromBytes(file);
  }
  event.target.value = "";
}

// ------------------------------------------------------------------
// Gravacao de tela + audio.
//
// O arquivo destino e aberto na pasta da task ANTES de a gravacao
// comecar e cada pedaco produzido pelo MediaRecorder e escrito em disco
// na hora. Isso trava a pasta de destino na task correta e evita montar
// o video inteiro na memoria no final (o que travava a interface e
// perdia gravacoes longas em maquinas mais fracas).
// ------------------------------------------------------------------
const RECORDING_TIMESLICE_MS = 2000;
const RECORDING_VIDEO_BPS = 2500000;
const RECORDING_AUDIO_BPS = 128000;

let recordingState = null;
let recordingTimerInterval = null;

async function toggleScreenRecording() {
  if (recordingState) {
    stopScreenRecording();
  } else {
    await startScreenRecording();
  }
}

async function startScreenRecording() {
  if (recordingState) return;

  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === "undefined") {
    console.warn("Gravacao de tela nao suportada neste ambiente");
    return;
  }
  if (!invoke) {
    console.warn("Backend indisponivel; gravacao nao foi iniciada");
    return;
  }

  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;

  let displayStream;
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: "monitor",
        frameRate: { ideal: 10, max: 15 }
      },
      audio: true
    });
  } catch (error) {
    // Usuario cancelou a selecao ou negou a permissao.
    console.info("Gravacao nao iniciada", error);
    return;
  }

  // Tenta tambem capturar o microfone para narrar; opcional.
  let micStream = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    console.info("Microfone indisponivel; gravando apenas o audio do sistema", error);
  }

  const mixed = mixAudioStreams([displayStream, micStream]);
  const recordStream = new MediaStream([
    ...displayStream.getVideoTracks(),
    ...mixed.tracks
  ]);

  const mimeType = pickRecorderMimeType();
  let recorder;
  try {
    recorder = new MediaRecorder(recordStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: RECORDING_VIDEO_BPS,
      audioBitsPerSecond: RECORDING_AUDIO_BPS
    });
  } catch (error) {
    console.warn("Falha ao criar o gravador", error);
    stopAllTracks([displayStream, micStream]);
    closeAudioContext(mixed.context);
    return;
  }

  // Abre o arquivo destino agora: a pasta fica presa na task escolhida
  // aqui, mesmo que o usuario troque de task durante a gravacao.
  const sessionId = makeId("rec");
  const fileName = buildRecordingFileName();
  const subDir = `task${task.number}/anexos`;
  let target;
  try {
    target = await invoke("recording_begin", {
      sessionId,
      userId: user.id,
      subDir,
      fileName
    });
  } catch (error) {
    console.warn("Falha ao preparar o arquivo da gravacao", error);
    stopAllTracks([displayStream, micStream]);
    closeAudioContext(mixed.context);
    return;
  }

  const recState = {
    recorder,
    displayStream,
    micStream,
    audioContext: mixed.context,
    sessionId,
    targetFile: target?.file || "",
    userId: user.id,
    taskId: task.id,
    startedAt: Date.now(),
    bytesWritten: 0,
    writeChain: Promise.resolve(),
    writeError: null,
    finalized: false
  };
  recordingState = recState;

  recorder.addEventListener("dataavailable", event => {
    if (event.data && event.data.size > 0) queueRecordingChunk(recState, event.data);
  });
  recorder.addEventListener("stop", () => {
    finalizeRecording(recState);
  });

  // Se o usuario parar o compartilhamento pela UI nativa do sistema.
  displayStream.getVideoTracks().forEach(track => {
    track.addEventListener("ended", () => stopScreenRecording());
  });

  try {
    recorder.start(RECORDING_TIMESLICE_MS);
  } catch (error) {
    console.warn("Falha ao iniciar o gravador", error);
    recordingState = null;
    stopAllTracks([displayStream, micStream]);
    closeAudioContext(mixed.context);
    invoke("recording_abort", { sessionId, discard: true }).catch(() => {});
    return;
  }

  updateRecordingUi(true);
}

function stopScreenRecording() {
  const recState = recordingState;
  if (!recState) return;
  // Zera ja para evitar reentrancia (clique + evento "ended" do track).
  recordingState = null;
  updateRecordingUi(false);
  try {
    if (recState.recorder.state !== "inactive") {
      recState.recorder.stop();
    } else {
      finalizeRecording(recState);
    }
  } catch (error) {
    console.warn("Falha ao parar o gravador", error);
    finalizeRecording(recState);
  }
}

// Cada pedaco vai para o disco assim que sai do gravador, na ordem.
function queueRecordingChunk(recState, blob) {
  recState.writeChain = recState.writeChain.then(async () => {
    if (recState.writeError) return;
    try {
      const chunk = await blobToBase64(blob);
      if (!chunk) return;
      recState.bytesWritten = await invoke("recording_append", {
        sessionId: recState.sessionId,
        chunk
      });
    } catch (error) {
      recState.writeError = error;
      console.warn("Falha ao gravar pedaco do video", error);
      // Encerra a captura: o que ja foi escrito continua salvo.
      if (recordingState === recState) stopScreenRecording();
    }
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler o pedaco da gravacao"));
    reader.readAsDataURL(blob);
  });
}

async function finalizeRecording(recState) {
  if (recState.finalized) return;
  recState.finalized = true;
  showRecordingSavingState();

  stopAllTracks([recState.displayStream, recState.micStream]);
  await closeAudioContext(recState.audioContext);

  // Espera a fila de escrita esvaziar antes de fechar o arquivo. Um
  // pedaco pode entrar na fila enquanto esperamos, por isso o laco.
  let drained = null;
  while (drained !== recState.writeChain) {
    drained = recState.writeChain;
    try {
      await drained;
    } catch (error) {
      console.warn("Falha na fila de escrita da gravacao", error);
    }
  }

  let info = null;
  try {
    info = await invoke("recording_finish", { sessionId: recState.sessionId });
  } catch (error) {
    console.warn("Falha ao fechar o arquivo da gravacao", error);
    hideRecordingIndicator();
    return;
  }
  hideRecordingIndicator();

  const targetUser = state.users.find(u => u.id === recState.userId) || null;
  const targetTask = targetUser?.tasks.find(t => t.id === recState.taskId) || null;
  if (!targetUser || !targetTask) {
    // Nao anexa em outra task: o arquivo fica na pasta original.
    console.warn(`Task original nao encontrada; a gravacao ficou salva em ${info.file}`);
    return;
  }

  pushAttachment(targetTask, info, "video/webm");
}

function mixAudioStreams(streams) {
  const withAudio = streams.filter(stream => stream && stream.getAudioTracks().length > 0);
  if (withAudio.length === 0) return { tracks: [], context: null };
  if (withAudio.length === 1) return { tracks: withAudio[0].getAudioTracks(), context: null };

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { tracks: withAudio[0].getAudioTracks(), context: null };

  const context = new AudioCtx();
  const destination = context.createMediaStreamDestination();
  withAudio.forEach(stream => {
    const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    source.connect(destination);
  });
  return { tracks: destination.stream.getAudioTracks(), context };
}

function stopAllTracks(streams) {
  streams.forEach(stream => {
    stream?.getTracks().forEach(track => track.stop());
  });
}

async function closeAudioContext(context) {
  if (!context) return;
  try {
    await context.close();
  } catch (error) {
    console.warn("Falha ao fechar AudioContext", error);
  }
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm"
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function buildRecordingFileName() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `Recording-${stamp}.webm`;
}

function updateRecordingUi(active) {
  if (recordButton) {
    recordButton.classList.toggle("recording", active);
    recordButton.title = active ? "Stop recording" : "Record screen";
    recordButton.setAttribute("aria-label", active ? "Stop recording" : "Record screen");
  }
  if (active) {
    startRecordingTimer();
  } else {
    stopRecordingTimer();
  }
}

function setRecordingIndicatorText(text) {
  if (!recordingIndicator) return;
  const textSpan = document.getElementById("recordingIndicatorText");
  if (textSpan) {
    textSpan.textContent = text;
  } else {
    recordingIndicator.textContent = text;
  }
}

function startRecordingTimer() {
  if (!recordingIndicator) return;
  recordingIndicator.hidden = false;
  const tick = () => {
    if (!recordingState) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - recordingState.startedAt) / 1000));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    setRecordingIndicatorText(`Recording ${mm}:${ss}`);
  };
  tick();
  recordingTimerInterval = window.setInterval(tick, 1000);
}

function stopRecordingTimer() {
  if (recordingTimerInterval) {
    window.clearInterval(recordingTimerInterval);
    recordingTimerInterval = null;
  }
}

// Enquanto o resto da fila e escrito o indicador vira "Saving...",
// para nao parecer que a interface travou.
function showRecordingSavingState() {
  stopRecordingTimer();
  if (!recordingIndicator) return;
  recordingIndicator.hidden = false;
  recordingIndicator.classList.add("saving");
  const stopBtn = document.getElementById("recordingIndicatorStop");
  if (stopBtn) stopBtn.hidden = true;
  setRecordingIndicatorText("Saving recording...");
}

function hideRecordingIndicator() {
  stopRecordingTimer();
  if (!recordingIndicator) return;
  recordingIndicator.classList.remove("saving");
  const stopBtn = document.getElementById("recordingIndicatorStop");
  if (stopBtn) stopBtn.hidden = false;
  recordingIndicator.hidden = true;
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

let dropOverCardId = null;

function setDropOverlay(inside, cardId = null) {
  if (dropOverCardId && dropOverCardId !== cardId) {
    const oldCard = document.querySelector(`.task-card[data-id="${dropOverCardId}"]`);
    if (oldCard) {
      oldCard.classList.remove("card-drag-target");
      const overlay = oldCard.querySelector('.card-drop-overlay');
      if (overlay) overlay.remove();
    }
  }
  
  if (cardId) {
    if (dropOverActive && canvasDropOverlay) {
      canvasDropOverlay.classList.remove("visible");
      canvasDropOverlay.hidden = true;
      dropOverActive = false;
    }
    const newCard = document.querySelector(`.task-card[data-id="${cardId}"]`);
    if (newCard) {
      newCard.classList.add("card-drag-target");
      if (!newCard.querySelector('.card-drop-overlay') && canvasDropOverlay) {
        const inner = document.createElement('div');
        inner.className = 'card-drop-overlay';
        inner.innerHTML = canvasDropOverlay.innerHTML;
        newCard.appendChild(inner);
      }
    }
    dropOverCardId = cardId;
  } else {
    dropOverCardId = null;
    if (canvasDropOverlay) {
      if (inside && !dropOverActive) {
        canvasDropOverlay.hidden = false;
        requestAnimationFrame(() => canvasDropOverlay.classList.add("visible"));
        dropOverActive = true;
      } else if (!inside && dropOverActive) {
        canvasDropOverlay.classList.remove("visible");
        canvasDropOverlay.hidden = true;
        dropOverActive = false;
      }
    }
  }
}

async function setupFileDrop() {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) return;

  // Sem task aberta nao ha onde anexar: o drop e ignorado por completo.
  const onEnter = () => setDropOverlay(Boolean(activeBoard()));
  const onOver = event => {
    if (!activeBoard()) {
      setDropOverlay(false);
      return;
    }
    const scale = window.devicePixelRatio || 1;
    const px = Number(event.payload?.position?.x || 0) / scale;
    const py = Number(event.payload?.position?.y || 0) / scale;
    const inside = isPointInsideBoardShell(event.payload?.position);
    
    let cardId = null;
    if (inside) {
      const el = document.elementFromPoint(px, py);
      const card = el?.closest(".task-card");
      if (card) {
        cardId = card.dataset.id;
      }
    }
    setDropOverlay(inside, cardId);
  };
  const onLeave = () => setDropOverlay(false);
  const onDrop = async event => {
    const targetCardId = dropOverCardId;
    setDropOverlay(false);
    const paths = event.payload?.paths || [];
    if (!paths.length) return;
    if (!activeBoard()) return;
    if (!isPointInsideBoardShell(event.payload?.position)) return;

    if (targetCardId) {
      const board = activeBoard();
      const node = board.nodes.find(n => n.id === targetCardId);
      if (node) {
        for (const path of paths) {
          try {
            const bytes = await invoke("read_file_bytes", { path });
            if (bytes && bytes.length) {
              const ext = path.split('.').pop().toLowerCase();
              let mimeType = "image/png";
              if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
              else if (ext === "gif") mimeType = "image/gif";
              else if (ext === "webp") mimeType = "image/webp";
              else if (ext === "svg") mimeType = "image/svg+xml";

              let binary = '';
              const len = bytes.length;
              const CHUNK_SIZE = 0x8000; // 32768
              for (let i = 0; i < len; i += CHUNK_SIZE) {
                binary += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK_SIZE));
              }
              const dataUrl = `data:${mimeType};base64,${window.btoa(binary)}`;

              if (node.type === "image") {
                node.imageUrl = dataUrl;
                const img = new Image();
                img.onload = () => {
                  applyImageNodeSize(node, img.width, img.height);
                  saveState();
                  renderNodes();
                };
                img.src = dataUrl;
              } else {
                setNodeContent(node, (getNodeContent(node) || "") + `\n![image](${dataUrl})\n`);
                saveState();
                renderNodes();
              }
            }
          } catch(e) {
            console.warn("Falha ao salvar anexo no card", e);
          }
        }
      }
    } else {
      for (const path of paths) {
        await attachFromPath(path);
      }
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
    empty.textContent = "No attachments";
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
    openBtn.title = "Open";
    openBtn.setAttribute("aria-label", "Open");
    openBtn.innerHTML = icons.externalLink;
    openBtn.addEventListener("click", event => {
      event.stopPropagation();
      openAttachment(att);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "attachments-action attachments-action-danger";
    delBtn.title = "Delete";
    delBtn.setAttribute("aria-label", "Delete");
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

async function openAttachmentsFolder() {
  const user = activeUser();
  const task = activeMainTask();
  if (!user) return;
  try {
    const subDir = task ? `task${task.number}/anexos` : null;
    await invoke("attachment_open_folder", { userId: user.id, subDir });
  } catch (e) {
    console.warn("Falha ao abrir pasta de anexos", e);
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
