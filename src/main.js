import { routeLinkPath } from "./linkRouting.js";
import {
  GrokDodecahedronRenderer,
  ThinkingPhraseCycler,
  AI_CHAT_THINKING_PHRASES,
  AI_TRANSLATOR_THINKING_PHRASES,
  setAiIconMood,
  getSelectedAiIconStyle,
  getSelectedAiIconColor
} from "./grokDodecahedronLoader.js";
import { LiveEnglishCoachController } from "./liveCoach.js";
import {
  extractAiActionProposal,
  extractAiQuestions,
  formatQuestionAnswersMessage,
  isDestructiveAction,
  proposalRequiresPermission,
  describeAiAction,
  shouldAutoCaptureScreen,
  buildAppContextSnapshot,
  collectRelevantAppAttachments,
  executeAiActionPlan
} from "./aiAppAgent.js";
import {
  createDefaultTableData,
  createTodoTableData,
  decodeTableData,
  encodeTableData,
  serializeTableToken,
  addTableRow,
  removeTableRow,
  addTableCol,
  removeTableCol,
  parseTsvToTableData,
  applyTsvIntoTable,
  evaluateCellFormula,
  renderCardTableHtml,
  colIndexToLetter
} from "./cardTable.js";
import { PersistenceService } from "./intelligence/persistenceService.js";
import { WorkspaceContextService } from "./intelligence/contextService.js";
import { WorkspaceUndoStack, buildActionPreviewDiffs } from "./intelligence/actionPreviewUndo.js";
import {
  PromptModuleRegistry,
  ConversationContextManager,
  TokenBudgetManager,
  TokenMetricsMonitor
} from "./intelligence/tokenOptimizer.js";
import {
  TaskReminderService,
  AlarmSoundPlayer,
  normalizeReminder,
  formatLocalDateTimeInput,
  formatReminderSummary
} from "./intelligence/reminderService.js";

const persistenceService = new PersistenceService(
  typeof window !== "undefined" ? (window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || null) : null
);
const workspaceContextService = new WorkspaceContextService(persistenceService);
const promptModuleRegistry = new PromptModuleRegistry();
const conversationContextManager = new ConversationContextManager({ recentWindowSize: 6 });
const tokenBudgetManager = new TokenBudgetManager({ maxTotalInputTokens: 5500 });
const workspaceUndoStack = new WorkspaceUndoStack(15);
const alarmSoundPlayer = new AlarmSoundPlayer();

const STORAGE_KEY = "todocompanion.state.v4";
const LEGACY_STORAGE_KEYS = ["todocompanion.state.v3", "todocompanion.state.v2", "todocompanion.state.v1"];
const MIN_ZOOM = 0.15;
const MIN_CARD_WIDTH = 384;
const MIN_CARD_HEIGHT = 192;
const DEFAULT_CARD_HEIGHT = 240;
const MAX_ZOOM = 5.0;
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
const CARD_COLOR_PRESETS = [
  { id: "default", label: "Padrão", hex: "transparent" },
  { id: "blue", label: "Azul", hex: "#38bdf8" },
  { id: "emerald", label: "Verde", hex: "#34d399" },
  { id: "amber", label: "Amarelo", hex: "#fbbf24" },
  { id: "orange", label: "Laranja", hex: "#fb923c" },
  { id: "rose", label: "Vermelho", hex: "#fb7185" },
  { id: "violet", label: "Roxo", hex: "#a78bfa" },
  { id: "slate", label: "Cinza", hex: "#94a3b8" }
];

function normalizeCardColor(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const aliasMap = {
    default: "default",
    padrao: "default",
    nenhuma: "default",
    none: "default",
    limpar: "default",
    transparent: "default",
    blue: "blue",
    azul: "blue",
    emerald: "emerald",
    green: "emerald",
    verde: "emerald",
    amber: "amber",
    yellow: "amber",
    amarelo: "amber",
    orange: "orange",
    laranja: "orange",
    rose: "rose",
    red: "rose",
    vermelho: "rose",
    rosa: "rose",
    violet: "violet",
    purple: "violet",
    roxo: "violet",
    slate: "slate",
    gray: "slate",
    grey: "slate",
    cinza: "slate"
  };
  return aliasMap[key] || null;
}

let activeCardColorPopover = null;
function closeCardColorPopover() {
  if (activeCardColorPopover) {
    activeCardColorPopover.remove();
    activeCardColorPopover = null;
  }
}

function openCardColorPopover(anchorEl, node, cardEl) {
  closeCardColorPopover();
  const pop = document.createElement("div");
  pop.className = "card-color-popover";
  const currentColor = node.color || "default";

  CARD_COLOR_PRESETS.forEach(preset => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = `card-color-swatch${preset.id === "default" ? " is-default" : ""}${currentColor === preset.id ? " selected" : ""}`;
    sw.title = preset.label;
    sw.setAttribute("aria-label", preset.label);
    if (preset.id !== "default") {
      sw.style.background = preset.hex;
    }
    sw.addEventListener("pointerdown", ev => ev.stopPropagation());
    sw.addEventListener("click", ev => {
      ev.stopPropagation();
      if (preset.id === "default") {
        delete node.color;
        delete cardEl.dataset.cardColor;
      } else {
        node.color = preset.id;
        cardEl.dataset.cardColor = preset.id;
      }
      const dot = anchorEl.querySelector(".card-color-dot");
      if (dot) {
        dot.style.setProperty("--card-swatch", preset.hex);
      }
      saveState();
      closeCardColorPopover();
    });
    pop.appendChild(sw);
  });

  document.body.appendChild(pop);
  const rect = anchorEl.getBoundingClientRect();
  const popW = pop.offsetWidth || 210;
  const popH = pop.offsetHeight || 32;
  const left = Math.max(10, Math.min(window.innerWidth - popW - 10, rect.left + rect.width / 2 - popW / 2));
  const top = rect.top - popH - 8 > 10 ? rect.top - popH - 8 : rect.bottom + 8;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  activeCardColorPopover = pop;
}

document.addEventListener("pointerdown", ev => {
  if (
    activeCardColorPopover &&
    !activeCardColorPopover.contains(ev.target) &&
    !ev.target.closest?.(".card-color-btn")
  ) {
    closeCardColorPopover();
  }
});

const icons = {
  plus: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  minus: `<svg class="icon" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>`,
  fullscreen: `<svg class="icon" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>`,
  list: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
  link: `<svg class="icon" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"/><path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"/></svg>`,
  trash: `<svg class="icon icon-16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M5.75 1.75A1.25 1.25 0 0 1 7 .5h2a1.25 1.25 0 0 1 1.25 1.25V2.5h3a.75.75 0 0 1 0 1.5h-.6l-.72 9.12A1.75 1.75 0 0 1 10.18 14.75H5.82a1.75 1.75 0 0 1-1.75-1.63L3.35 4h-.6a.75.75 0 0 1 0-1.5h3v-.75Zm1.5.75h1.5V2h-1.5v.5Z"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  eye: `<svg class="icon" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>`,
  chevronLeft: `<svg class="icon" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>`,
  chevronRight: `<svg class="icon" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>`,
  chevronDown: `<svg class="icon" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>`,
  focus: `<svg class="icon" viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/><path d="M12 8v8M8 12h8"/></svg>`,
  organize: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="5" rx="1.4"/><rect x="15" y="4" width="6" height="5" rx="1.4"/><rect x="9" y="15" width="6" height="5" rx="1.4"/><path d="M9 6.5h6M6 9v3a3 3 0 0 0 3 3M18 9v3a3 3 0 0 1-3 3"/></svg>`,
  edit: `<svg class="icon icon-16" viewBox="0 0 16 16"><path d="M11.35 2.65a1.45 1.45 0 1 1 2.05 2.05L5.6 12.5 2.6 13.4l.9-3L11.35 2.65Z"/></svg>`,
  paperclip: `<svg class="icon" viewBox="0 0 24 24"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  file: `<svg class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`,
  image: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
  video: `<svg class="icon" viewBox="0 0 24 24"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3z"/></svg>`,
  audio: `<svg class="icon" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  externalLink: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>`,
  info: `<svg class="icon icon-16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm0 3a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8Zm-.8 3a.8.8 0 0 1 1.6 0v3.3a.8.8 0 0 1-1.6 0V7.5Z"/></svg>`,
  bell: `<svg class="icon icon-16" viewBox="0 0 16 16" fill="currentColor" stroke="none"><path d="M8 1.5a4.2 4.2 0 0 0-4.2 4.2c0 2.3-.85 3.4-1.52 4.02a.65.65 0 0 0 .44 1.13h10.56a.65.65 0 0 0 .44-1.13C13.05 9.1 12.2 8 12.2 5.7A4.2 4.2 0 0 0 8 1.5ZM6.25 12a1.85 1.85 0 0 0 3.5 0h-3.5Z"/></svg>`,
  grip: `<svg class="card-drag-icon" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>`,
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
  table: `<svg class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>`,
  formatClear: `<svg class="icon" viewBox="0 0 24 24"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m13.3 9 5.5 5.5"/></svg>`,
  micAi: `<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4M8 22h8"/></svg>`,
  aiSparkle: `<svg class="icon" viewBox="0 0 24 24"><path d="M11.5 2.5 13.9 9.6 21 12l-7.1 2.4-2.4 7.1-2.4-7.1L2 12l7.1-2.4 2.4-7.1Z"/><path d="M19.5 3v3M18 4.5h3"/></svg>`,
  chatTranscribe: `<svg class="icon" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M9 11.5v1"/><path d="M12 9.5v5"/><path d="M15 11.5v1"/></svg>`,
  moreHorizontal: `<svg class="icon" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/></svg>`,
  menu: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="sidebar-icon-pane" d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="transparent" stroke="none"/><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>`
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
const inlineVideoInput = document.querySelector("#inlineVideoInput");
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
  initCanvasMetaResponsive();
  initImageFullscreenModal();
  initAiTranslatorPanel();
  setupFileDrop().catch(err => console.warn("Drag-and-drop indisponivel", err));

  maximizeAppButton?.addEventListener("click", toggleMaximizeWindow);
  minimizeAppButton?.addEventListener("click", minimizeWindow);
  document.querySelector("#closeAppButton")?.addEventListener("click", () => {
    closeAllOpenModals();
    const iconColor = getSelectedAiIconColor?.() || null;
    const iconStyle = getSelectedAiIconStyle?.() || null;
    invoke?.("hide_window", { iconColor, iconStyle }).catch(err =>
      console.warn("Could not hide window", err)
    );
  });
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
  document.querySelector("#recordingIndicatorStop")?.addEventListener("click", () => {
    if (transcribeState) {
      stopAudioTranscription();
    } else {
      stopScreenRecording();
    }
  });
  document.getElementById("closeAttachmentsSidebarBtn")?.addEventListener("click", closeAttachmentsPopup);
  canvasAttachButton.addEventListener("pointerdown", () => preserveAttachmentReferenceTarget());
  canvasAttachButton.addEventListener("click", handleAttachButtonClick);
  canvasAttachInput.addEventListener("change", handleAttachInputChange);
  attachmentsAdd.addEventListener("pointerdown", () => preserveAttachmentReferenceTarget());
  attachmentsAdd.addEventListener("click", () => canvasAttachInput.click());
  attachmentsOpenFolder.addEventListener("click", openAttachmentsFolder);
  attachmentReferencePopup?.addEventListener("pointerdown", event => event.preventDefault());
  addBoardButton.addEventListener("click", openUserCreatePopup);
  addUserTaskButton.addEventListener("click", createInstantTaskAndFocusRoot);
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
  window.onerror = function (msg, url, line, col, error) {
    const text = String(msg || "");
    if (text.includes("ResizeObserver loop")) {
      return true;
    }
    console.error("[TODOCompanion] Runtime error:", msg, { url, line, col, error });
    return false;
  };

  newCardForm.addEventListener("submit", saveNewCard);
  document.getElementById("newTodoTableButton")?.addEventListener("click", saveNewTodoTableCard);
  document.getElementById("newTableCardButton")?.addEventListener("click", saveNewTableCard);
  document.getElementById("recordedVideoToastInsert")?.addEventListener("click", insertPendingRecordedVideoIntoCard);
  document.getElementById("recordedVideoToastClose")?.addEventListener("click", hideRecordedVideoToast);
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
      renderNodes();

      window.inlineImageEditorTarget = null;
      window.inlineImageNodeTarget = null;
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  });
  inlineVideoInput?.addEventListener("change", async event => {
    const file = event.target.files[0];
    const targetNode = window.inlineVideoNodeTarget;
    const targetCard = window.inlineVideoCardTarget;
    const targetKind = window.inlineMediaKindTarget || null;
    window.inlineVideoNodeTarget = null;
    window.inlineVideoCardTarget = null;
    window.inlineMediaKindTarget = null;
    event.target.value = "";
    if (!file || !targetNode) return;
    await attachMediaFileToCard(targetNode, targetCard, file, targetKind);
  });

  userCreateForm.addEventListener("submit", saveUserCreatePopup);
  userCreateCancelButton.addEventListener("click", closeUserCreatePopup);
  document.addEventListener("pointerdown", event => {
    if (!newCardForm.hidden && !newCardForm.contains(event.target)) closeNewCardModal();
    if (!userCreateForm.hidden && !userCreateForm.contains(event.target) && !addBoardButton.contains(event.target)) closeUserCreatePopup();
    const tep = document.querySelector("#taskEditPopup");
    if (!tep.hidden && !tep.contains(event.target) && !event.target.closest(".user-task-info")) closeTaskEditPopup();
    if (!event.target.closest(".attachments-row-menu") && !event.target.closest(".attachments-more-btn")) closeAllAttachmentRowMenus();
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
  window.addEventListener("focus", () => {
    syncActiveTaskAttachmentsWithDisk();
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

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
      event.preventDefault();
      window.toggleAiTranslatorPanel?.();
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

function triggerAutoUpdateCheck() {
  import("./updater/index.js")
    .then(({ runUpdaterFlow }) => runUpdaterFlow({ manual: false }))
    .catch(error => console.warn("[updater] failed to load", error));
}

function scheduleUpdaterCheck() {
  setTimeout(triggerAutoUpdateCheck, 600);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      triggerAutoUpdateCheck();
    }
  });
}

function initSettingsModule() {
  import("./settings/index.js")
    .then(({ initSettings }) => initSettings())
    .catch(error => console.warn("[settings] failed to load", error));
}

function closeAllOpenModals() {
  document.querySelectorAll(".modal-backdrop:not([hidden])").forEach(el => {
    el.hidden = true;
  });
  closeFloatingMediaAskBar?.();
}

function minimizeWindow() {
  if (!invoke) return;
  invoke("minimize_window").catch(error =>
    console.warn("Could not minimize window", error)
  );
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
        w: MIN_CARD_WIDTH,
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
    task.nodes.some(node => node.id === link.to)
  );
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
  const HEIGHT_GRID = GRID * 2;
  const isImage = node.type === "image";
  const minW = isImage ? 72 : MIN_CARD_WIDTH;
  const minH = isImage ? 48 : MIN_CARD_HEIGHT;
  const rawX = Number(node.x) || 0;
  const rawY = Number(node.y) || 0;
  const rawW = Math.max(minW, Number(node.w) || minW);
  const rawH = Number(node.h) || 0;

  const normalized = {
    id: node.id || makeId("action"),
    title: title === "Nova acao" && !String(body).trim() ? "" : title,
    body,
    status: normalizeStatus(node.status || (node.done ? "complete" : "ongoing")),
    x: Math.round(rawX / GRID) * GRID,
    y: Math.round(rawY / GRID) * GRID,
    w: Math.round(rawW / GRID) * GRID,
    h: rawH > 0 ? Math.max(minH, Math.round(rawH / HEIGHT_GRID) * HEIGHT_GRID) : 144
  };
  if (node.createdAt) normalized.createdAt = node.createdAt;
  if (node.type) normalized.type = node.type;
  if (node.imageUrl !== undefined) normalized.imageUrl = node.imageUrl;
  if (node.criticality !== undefined) normalized.criticality = node.criticality;
  if (node.color && node.color !== "default") normalized.color = String(node.color);
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
  workspaceContextService.markWorkspaceChanged();
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
    const isRecordingThisUser = Boolean(recordingState && recordingState.userId === item.id);
    const isTranscribingThisUser = Boolean(
      (transcribeState && transcribeState.userId === item.id) ||
      (cardAnalyzingState && cardAnalyzingState.userId === item.id)
    );
    const tab = document.createElement("div");
    tab.className = `user-rail-item${item.id === activeId ? " active" : ""}${item.id === tabDragId ? " dragging" : ""}${isRecordingThisUser ? " is-recording" : ""}${isTranscribingThisUser ? " is-transcribing" : ""}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(item.id === activeId));
    tab.tabIndex = 0;
    tab.title = isRecordingThisUser
      ? `${item.name} (Gravando)`
      : isTranscribingThisUser
        ? `${item.name} (${cardAnalyzingState?.userId === item.id ? "Analisando áudio com IA" : "Gravando áudio para análise"})`
        : item.name;
    tab.dataset.userId = item.id;

    const avatar = document.createElement("span");
    avatar.className = "user-rail-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initialsFor(item.name);

    const label = document.createElement("span");
    label.className = "user-rail-label";
    label.textContent = item.name;

    const recDot = isRecordingThisUser ? document.createElement("span") : null;
    if (recDot) {
      recDot.className = "user-transcribing-badge is-recording";
      recDot.innerHTML = `<canvas class="sidebar-ai-sphere" data-mood="listening" aria-hidden="true"></canvas>`;
      recDot.title = "Gravando agora";
      recDot.setAttribute("aria-label", "Gravando agora");
    }

    const transcribeBadge = isTranscribingThisUser ? document.createElement("span") : null;
    if (transcribeBadge) {
      const isAnalyzing = cardAnalyzingState?.userId === item.id;
      transcribeBadge.className = `user-transcribing-badge${isAnalyzing ? " is-analyzing" : ""}`;
      if (isAnalyzing) tab.classList.add("is-analyzing");
      transcribeBadge.innerHTML = `<canvas class="sidebar-ai-sphere" data-mood="${isAnalyzing ? "thinking" : "listening"}" aria-hidden="true"></canvas>`;
      transcribeBadge.title = isAnalyzing ? "Analisando e transcrevendo áudio..." : "Gravando áudio para transcrever...";
      transcribeBadge.setAttribute("aria-label", transcribeBadge.title);
    }

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
    if (recDot) {
      tab.append(avatar, label, recDot, count, actions);
    } else if (transcribeBadge) {
      tab.append(avatar, label, transcribeBadge, count, actions);
    } else {
      tab.append(avatar, label, count, actions);
    }

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
  syncSidebarAiSpheres();
}

let sidebarAiSphereRenderers = [];
function syncSidebarAiSpheres() {
  sidebarAiSphereRenderers.forEach(r => {
    try { r.stop(); } catch (_) { }
  });
  sidebarAiSphereRenderers = [];
  document.querySelectorAll(".sidebar-ai-sphere").forEach(canvas => {
    const isActiveItem = Boolean(canvas.closest(".active"));
    const isCollapsed = Boolean(canvas.closest(".collapsed"));
    const mood = canvas.dataset.mood || "thinking";
    const renderer = new GrokDodecahedronRenderer(canvas, {
      size: isCollapsed ? 22 : 18,
      speed: mood === "listening" ? 1 : 1.75,
      intensity: 1,
      mood,
      colorRgb: isActiveItem ? "255, 255, 255" : null
    });
    renderer.start();
    sidebarAiSphereRenderers.push(renderer);
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
    autoScrollUsersRail(moveEvent.clientY);
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

function autoScrollUsersRail(clientY) {
  const rect = usersRailList.getBoundingClientRect();
  const threshold = 36;

  if (clientY < rect.top + threshold) {
    usersRailList.scrollTop -= 16;
  } else if (clientY > rect.bottom - threshold) {
    usersRailList.scrollTop += 16;
  }
}

function captureUserRailRects() {
  const rects = new Map();
  usersRailList.querySelectorAll(".user-rail-item").forEach(tab => {
    const rect = tab.getBoundingClientRect();
    rects.set(tab.dataset.userId, { left: rect.left, top: rect.top });
  });
  return rects;
}

function animateUserRailReorder(previousRects) {
  requestAnimationFrame(() => {
    usersRailList.querySelectorAll(".user-rail-item").forEach(tab => {
      if (tab.dataset.userId === tabDragId) {
        return;
      }

      const previous = previousRects.get(tab.dataset.userId);
      if (!previous) {
        return;
      }

      const current = tab.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      if (!dx && !dy) {
        return;
      }

      tab.animate(
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

function moveUserBefore(sourceId, beforeId) {
  if (!sourceId || sourceId === beforeId) return;
  const fromIndex = state.users.findIndex(u => u.id === sourceId);
  if (fromIndex < 0) return;
  const currentBeforeId = state.users[fromIndex + 1]?.id || null;
  if (currentBeforeId === beforeId) return;

  const previousRects = captureUserRailRects();
  const [item] = state.users.splice(fromIndex, 1);
  const toIndex = beforeId ? state.users.findIndex(u => u.id === beforeId) : state.users.length;
  const insertionIndex = toIndex < 0 ? state.users.length : toIndex;
  state.users.splice(insertionIndex, 0, item);
  saveState();
  renderUsersRail();
  animateUserRailReorder(previousRects);
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

const tableRowPortOffsets = new Map();

function getTableNodeRowCount(node) {
  const cached = tableRowPortOffsets.get(node.id);
  if (cached && cached.length > 0) return cached.length;
  const content = getNodeContent(node) || "";
  const match = content.match(/\[\[table:([A-Za-z0-9_-]+)\]\]/);
  if (match) {
    const data = decodeTableData(match[1]);
    if (data?.rows?.length) return data.rows.length;
  }
  return 1;
}

function getTableRowPortOffsetY(node, rowIndex) {
  const offsets = tableRowPortOffsets.get(node.id);
  if (offsets && offsets.length > 0) {
    const safeIdx = Math.max(0, Math.min(offsets.length - 1, Number(rowIndex) || 0));
    return offsets[safeIdx];
  }
  const height = nodeHeight(node);
  const count = Math.max(1, getTableNodeRowCount(node));
  const safeIdx = Math.max(0, Math.min(count - 1, Number(rowIndex) || 0));
  const headerOffset = 48;
  const usable = Math.max(24, height - headerOffset);
  return headerOffset + ((safeIdx + 0.5) * usable) / count;
}

function syncTableCardRowPorts(card, node) {
  if (!card || !node || node.type !== "table") return;
  const board = activeBoard();
  const zoom = board?.view?.zoom || 1;
  const rows = Array.from(card.querySelectorAll(".card-excel-table tbody tr"));
  if (!rows.length) return;

  const cardRect = card.getBoundingClientRect();
  const exactHeight = Math.max(48, Math.round(card.offsetHeight || cardRect.height / zoom));
  node.h = exactHeight;
  renderedHeights.set(node.id, exactHeight);

  const offsets = rows.map(tr => {
    const trRect = tr.getBoundingClientRect();
    return (trRect.top - cardRect.top + trRect.height / 2) / zoom;
  });
  tableRowPortOffsets.set(node.id, offsets);

  card.querySelectorAll(".port.table-row-port").forEach(el => el.remove());

  offsets.forEach((centerY, rowIdx) => {
    ["in", "out"].forEach(port => {
      const btn = document.createElement("button");
      const isPending =
        linkDragState?.nodeId === node.id &&
        linkDragState?.port === port &&
        linkDragState?.row === rowIdx;
      btn.type = "button";
      btn.className = `port port-${port} table-row-port${isPending ? " pending" : ""}`;
      btn.dataset.port = port;
      btn.dataset.row = String(rowIdx);
      btn.style.top = `${Math.round(centerY * 10) / 10}px`;
      btn.setAttribute("aria-label", `${port === "in" ? "Entrada" : "Saída"} linha ${rowIdx + 1}`);
      btn.addEventListener("pointerdown", event => startLinkDrag(event, node.id, port, rowIdx));
      card.appendChild(btn);
    });
  });
}

function adjustLinksForTableRowMutation(nodeId, action, rowIndex) {
  const board = activeBoard();
  if (!board?.links?.length) return;
  if (action === "addRow") {
    board.links.forEach(link => {
      if (link.from === nodeId && link.fromRow != null && link.fromRow > rowIndex) {
        link.fromRow += 1;
      }
      if (link.to === nodeId && link.toRow != null && link.toRow > rowIndex) {
        link.toRow += 1;
      }
    });
  } else if (action === "delRow") {
    board.links = board.links.filter(link => {
      if (link.from === nodeId && link.fromRow === rowIndex) return false;
      if (link.to === nodeId && link.toRow === rowIndex) return false;
      return true;
    });
    board.links.forEach(link => {
      if (link.from === nodeId && link.fromRow != null && link.fromRow > rowIndex) {
        link.fromRow -= 1;
      }
      if (link.to === nodeId && link.toRow != null && link.toRow > rowIndex) {
        link.toRow -= 1;
      }
    });
  }
}

function capturePreservedCardVideos(currentBoardId) {
  const preserved = new Map();
  if (!currentBoardId || nodesLayer.dataset.boardId !== currentBoardId) {
    nodesLayer.querySelectorAll(".card-inline-video-wrap video, .card-inline-audio-wrap audio").forEach(mediaEl => {
      try { mediaEl.pause(); } catch (_) { }
    });
    return preserved;
  }

  nodesLayer.querySelectorAll(".task-card").forEach(cardEl => {
    const nodeId = cardEl.dataset.id;
    if (!nodeId) return;
    cardEl.querySelectorAll(".card-inline-video-wrap, .card-inline-audio-wrap").forEach((wrap, idx) => {
      const isAudio = wrap.classList.contains("card-inline-audio-wrap");
      const mediaEl = wrap.querySelector(isAudio ? "audio" : "video");
      const mediaRef = isAudio ? (wrap.dataset.audioSrc || "") : (wrap.dataset.videoSrc || "");
      if (!mediaEl || !mediaRef) return;
      const kind = isAudio ? "audio" : "video";
      const key = `${nodeId}::${kind}::${mediaRef}::${idx}`;
      preserved.set(key, {
        videoEl: mediaEl,
        wasPlaying: !mediaEl.paused && !mediaEl.ended,
        currentTime: mediaEl.currentTime
      });
    });
  });
  return preserved;
}

function restorePreservedCardVideos(card, nodeId, preservedVideos) {
  const toResume = [];
  card.querySelectorAll(".card-inline-video-wrap, .card-inline-audio-wrap").forEach((wrap, idx) => {
    const isAudio = wrap.classList.contains("card-inline-audio-wrap");
    const placeholder = wrap.querySelector(isAudio ? "audio" : "video");
    const mediaRef = isAudio ? (wrap.dataset.audioSrc || "") : (wrap.dataset.videoSrc || "");
    if (!placeholder || !mediaRef) return;

    const kind = isAudio ? "audio" : "video";
    const key = `${nodeId}::${kind}::${mediaRef}::${idx}`;
    const entry = preservedVideos.get(key);
    if (entry) {
      preservedVideos.delete(key);
      placeholder.replaceWith(entry.videoEl);
      if (entry.wasPlaying) {
        toResume.push(entry);
      }
    } else {
      placeholder.muted = false;
      placeholder.volume = 1.0;
    }
  });
  return toResume;
}

function renderNodes() {
  const board = activeBoard();
  const preservedVideos = capturePreservedCardVideos(board?.id || "");
  const videosToResume = [];
  nodesLayer.innerHTML = "";
  nodesLayer.dataset.boardId = board?.id || "";
  if (!board) return;

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
      dragState?.nodeId === node.id ? "dragging" : "",
      justCreated ? "just-created" : "",
      hasFixedHeight ? "fixed-height" : "",
      rootCard ? "root-card" : "",
      node.type === "image" ? "image-card" : "",
      node.type === "table" ? "table-card" : ""
    ].filter(Boolean).join(" ");
    card.dataset.id = node.id;
    card.dataset.status = status;
    const minW = node.type === "image" ? 72 : MIN_CARD_WIDTH;
    const minH = node.type === "image" ? 48 : rootCard ? 96 : MIN_CARD_HEIGHT;
    const GRID = 24;
    const HEIGHT_GRID = GRID * 2;
    node.x = Math.round((Number(node.x) || 0) / GRID) * GRID;
    node.y = Math.round((Number(node.y) || 0) / GRID) * GRID;
    node.w = Math.max(minW, Math.round((Number(node.w) || minW) / GRID) * GRID);
    node.h = Math.max(minH, Math.round((Number(node.h) || (rootCard ? 96 : DEFAULT_CARD_HEIGHT)) / HEIGHT_GRID) * HEIGHT_GRID);

    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.w}px`;
    if (node.type === "table") {
      card.style.minHeight = "";
      card.style.height = "auto";
      card.classList.remove("fixed-height");
    } else {
      card.style.minHeight = `${node.h}px`;
      card.style.height = `${node.h}px`;
      card.classList.add("fixed-height");
    }

    const isTableCard = node.type === "table";
    const cardMediaInfo = !rootCard && !isTableCard && node.type !== "image"
      ? extractCardMediaInfo(node)
      : null;
    const isMediaCard = Boolean(cardMediaInfo);
    if (isMediaCard) {
      card.classList.add("media-card", cardMediaInfo.kind === "audio" ? "audio-card" : "video-card");
    }
    if (node.color && node.color !== "default") {
      card.dataset.cardColor = node.color;
    }
    const swatchHex = CARD_COLOR_PRESETS.find(c => c.id === node.color)?.hex || "transparent";
    const colorPickerBtnHtml = `<span class="card-color-wrap"><button class="card-color-btn" type="button" aria-label="Cor do card" title="Mudar cor do card"><span class="card-color-dot" style="--card-swatch:${swatchHex}"></span></button></span>`;
    const createdAtHtml = (!rootCard && node.createdAt && node.type !== "image" && !isTableCard)
      ? `<span class="card-created-at">${formatCreatedAt(node.createdAt)}</span>`
      : "";
    card.innerHTML = `
      ${isTableCard ? "" : `<button class="port port-in${linkDragState?.nodeId === node.id && linkDragState?.port === "in" ? " pending" : ""}" data-port="in" type="button" aria-label="Left port"></button>`}
      ${isTableCard ? "" : `<button class="port port-out${pendingLink?.from === node.id || (linkDragState?.nodeId === node.id && linkDragState?.port === "out") ? " pending" : ""}" data-port="out" type="button" aria-label="Right port"></button>`}
      <button class="port port-top${linkDragState?.nodeId === node.id && linkDragState?.port === "top" ? " pending" : ""}" data-port="top" type="button" aria-label="Top port"></button>
      <button class="port port-bottom${linkDragState?.nodeId === node.id && linkDragState?.port === "bottom" ? " pending" : ""}" data-port="bottom" type="button" aria-label="Bottom port"></button>
      ${rootCard ? colorPickerBtnHtml : ""}
      <div class="card-bento-inner">
        ${rootCard ? "" : node.type === "image" ? `
          <div class="card-top image-card-top">
            <div class="card-drag-handle" title="Arrastar card" aria-label="Arrastar card">
              ${icons.grip}
            </div>
            <div class="image-card-top-actions">
              ${node.imageUrl ? `<button class="image-card-fullscreen-btn" type="button" aria-label="Tela cheia" title="Tela cheia">${icons.fullscreen}</button>` : ""}
              <button class="card-action" type="button" aria-label="Remove" title="Remove">${icons.close}</button>
            </div>
          </div>
        ` : isTableCard ? `
          <div class="card-top table-card-top">
            <div class="card-drag-handle" title="Arrastar tabela" aria-label="Arrastar tabela">
              ${icons.grip}
            </div>
            <button class="card-action" type="button" aria-label="Remove" title="Remove">${icons.close}</button>
          </div>
        ` : `
          <div class="card-top">
            <div class="card-top-left">
              <button class="card-check" type="button" aria-label="Complete" title="Complete">${icons.check}</button>
              ${createdAtHtml}
            </div>
            <div class="card-top-right">
              <div class="crit-wrap crit-${node.criticality ?? 0}" title="Criticality">
                <div class="crit-track">
                  <span class="crit-dot"></span>
                  <span class="crit-dot"></span>
                  <span class="crit-dot"></span>
                </div>
                <input class="crit-range" type="range" min="0" max="2" step="1" value="${node.criticality ?? 0}" title="Criticality" />
              </div>
              <button class="card-ai-btn card-transcribe-btn${transcribeState?.targetNodeId === node.id ? " recording" : ""}${cardAnalyzingState?.targetNodeId === node.id && !cardAnalyzingState?.mediaKey ? " analyzing" : ""}" type="button" aria-label="Gravar e analisar áudio com IA" title="${cardAnalyzingState?.targetNodeId === node.id ? "Parar análise da IA" : transcribeState?.targetNodeId === node.id ? "Finalizar gravação e analisar com IA" : "Gravar áudio (PC e microfone) para análise e transcrição com IA"}">
                <span class="card-transcribe-icon">${icons.micAi}</span>
                <span class="card-transcribe-live" aria-hidden="true">
                  <canvas class="card-recording-sphere" aria-hidden="true"></canvas>
                  <span class="card-audio-meter">
                    <span class="meter-bar b1"></span>
                    <span class="meter-bar b2"></span>
                    <span class="meter-bar b3"></span>
                  </span>
                  <span class="card-transcribe-stop">
                    <svg class="icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/></svg>
                  </span>
                  <span class="card-transcribe-tokens">${transcribeState?.targetNodeId === node.id ? formatEstimatedAudioTokens(Date.now() - transcribeState.startedAt) : ""}</span>
                </span>
                <span class="card-transcribe-analyzing" aria-hidden="true">
                  <canvas class="card-analyzing-sphere" aria-hidden="true"></canvas>
                  <span class="card-analyzing-stop">
                    <svg class="icon" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/></svg>
                  </span>
                  <span class="card-analyzing-text grok-shimmer-text">${AI_CARD_ANALYZING_PHRASES[0]}</span>
                </span>
              </button>
              <button class="card-action" type="button" aria-label="Remove" title="Remove">${icons.close}</button>
            </div>
          </div>
        `}
        <div class="card-body-wrap">
          ${rootCard
        ? `<div class="root-card-header">
                 ${recordingState && recordingState.taskId === board.id ? `<canvas class="sidebar-ai-sphere" data-mood="listening" aria-hidden="true"></canvas>` : ""}
                 <strong class="root-card-title" contenteditable="true" spellcheck="false" role="textbox" aria-label="Board Title">${escapeHtml(board.title)}</strong>
                 <button class="root-card-edit" type="button" aria-label="Edit" title="Edit">${icons.edit}</button>
               </div>`
        : node.type === "image"
          ? node.imageUrl
            ? `<div class="card-body image-card-body" role="img" aria-label="Attached image"><img src="${node.imageUrl}" alt="Card image" draggable="false" /></div>`
            : `<div class="card-body image-card-body empty-image-card" role="button" aria-label="Add image" title="Add image" onclick="document.getElementById('updateImageInput').click(); window.nodeToUpdateImage = '${node.id}';">${icons.image}</div>`
          : isTableCard
            ? `<div class="card-body table-card-body" contenteditable="false" aria-label="Table card">${renderBodyHtml(getNodeContent(node))}</div>`
            : `<div class="card-body" contenteditable="true" role="textbox" aria-label="Card content">${renderBodyHtml(getNodeContent(node))}</div>`}
        </div>
        ${rootCard || isTableCard ? "" : node.type === "image" && node.imageUrl ? `
          <div class="image-card-bottom" contenteditable="false">
            <button class="image-card-btn card-inline-media-ai" type="button" data-media-kind="image" data-media-src="${escapeAttr(node.imageUrl)}" title="Perguntar à IA sobre esta imagem"><canvas class="card-media-ai-sphere" aria-hidden="true"></canvas></button>
            <button class="image-card-btn" type="button" data-command="changeImage" title="Change Image">${icons.image}</button>
            <button class="image-card-btn" type="button" data-command="clearImage" title="Remove Image">${icons.close}</button>
          </div>
        ` : node.type === "image" ? "" : `
          <div class="card-format-bar" contenteditable="false">
            <button class="card-format-btn" type="button" data-command="bold" title="Bold (Ctrl+B)">${icons.formatBold}</button>
            <button class="card-format-btn" type="button" data-command="italic" title="Italic (Ctrl+I)">${icons.formatItalic}</button>
            <button class="card-format-btn" type="button" data-command="underline" title="Underline (Ctrl+U)">${icons.formatUnderline}</button>
            <button class="card-format-btn" type="button" data-command="strikethrough" title="Strikethrough">${icons.formatStrikethrough}</button>
            <div class="card-format-bar-sep"></div>
            <button class="card-format-btn" type="button" data-command="insertUnorderedList" title="Bulleted List">${icons.formatListBulleted}</button>
            <button class="card-format-btn" type="button" data-command="insertOrderedList" title="Numbered List">${icons.formatListNumbered}</button>
            <button class="card-format-btn" type="button" data-command="insertCheckbox" title="Checkbox">${icons.checkbox}</button>
            <button class="card-format-btn" type="button" data-command="insertTable" title="Insert Table (Excel)">${icons.table}</button>
            <div class="card-format-bar-sep"></div>
            <button class="card-format-btn" type="button" data-command="insertAttachmentInline" title="Anexar arquivo (imagem, vídeo, áudio, documento)">${icons.paperclip}</button>
            <button class="card-format-btn" type="button" data-command="removeFormat" title="Clear Formatting">${icons.formatClear}</button>
            <div class="card-format-bar-sep"></div>
            ${colorPickerBtnHtml}
          </div>
        `}
      </div>
      <button class="resize-handle" type="button" aria-label="Resize" title="Resize"></button>
    `;

    card.addEventListener("pointerdown", event => {
      if (event.target.closest(".card-action")) return;
      const bodyEl = event.target.closest(".card-body");
      if (bodyEl && event.offsetX >= bodyEl.clientWidth - 2) {
        event.stopPropagation();
        return;
      }
      if (selectedNodeId !== node.id || selectedLinkId !== null) {
        selectedNodeId = node.id;
        selectedLinkId = null;
        renderLinks();
        refreshSelectionClasses();
      }
    }, true);

    card.addEventListener("change", event => {
      if (event.target.classList.contains("card-todo-checkbox")) {
        const editor = card.querySelector(".card-body");
        if (editor) {
          setNodeContent(node, serializeEditableContent(editor));
          saveState();
        }
      }
    });

    card.addEventListener("dblclick", event => {
      if (event.target.closest("input, textarea, button, video, audio, .root-card-title, .card-inline-video-wrap, .card-inline-audio-wrap, .resize-handle, .port")) {
        return;
      }
      focusCardOnNode(node.id);
    });

    if (rootCard) {
      card.addEventListener("pointerdown", event => {
        if (event.target.closest("button, input, textarea, .root-card-title, .port, .resize-handle")) {
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

      card.querySelector(".card-drag-handle")?.addEventListener("pointerdown", event => {
        event.stopPropagation();
        startDrag(event, node.id);
      });

      card.querySelector(".card-ai-btn")?.addEventListener("pointerdown", event => {
        event.stopPropagation();
      });

      card.querySelector(".card-ai-btn")?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (cardAnalyzingState?.targetNodeId === node.id) {
          stopActiveCardMediaAsk(node.id);
          return;
        }
        handleTranscribeTriggerClick(event, node.id, event.currentTarget);
      });

      card.addEventListener("click", event => {
        const mediaAiBtn = event.target.closest(".card-inline-media-ai");
        if (!mediaAiBtn) return;
        event.preventDefault();
        event.stopPropagation();
        if (cardAnalyzingState?.targetNodeId === node.id) {
          stopActiveCardMediaAsk(node.id);
          return;
        }
        const kind = mediaAiBtn.dataset.mediaKind || "video";
        const ref = mediaAiBtn.dataset.mediaRef || "";
        const src = mediaAiBtn.dataset.mediaSrc || "";
        let mediaTarget = null;
        if (kind === "image" && src) {
          const localMatch = src.match(/^(?:https?:\/\/todomedia\.localhost|todomedia:\/\/localhost)\/([^/]+)\/(.+)$/i);
          if (localMatch) {
            mediaTarget = {
              kind: "image",
              imageDataUrl: null,
              userId: decodeURIComponent(localMatch[1]),
              file: decodeURIComponent(localMatch[2]),
              mediaKey: src
            };
          } else {
            mediaTarget = { kind: "image", imageDataUrl: src, userId: "", file: "", mediaKey: src };
          }
        } else if (ref) {
          const slash = ref.indexOf("/");
          if (slash > 0) {
            mediaTarget = { kind, userId: ref.slice(0, slash), file: ref.slice(slash + 1), mediaKey: ref };
          }
        }
        if (mediaTarget) {
          openFloatingMediaAskBar(mediaAiBtn, node, mediaTarget);
        }
      });

      const mediaAskForm = card.querySelector(".card-media-ask-bar");
      if (mediaAskForm && cardMediaInfo) {
        mediaAskForm.addEventListener("pointerdown", event => {
          event.stopPropagation();
        });
        const mediaAskInput = mediaAskForm.querySelector(".card-media-ask-input");
        const mediaAskSendBtn = mediaAskForm.querySelector(".card-media-ask-send");
        const mediaModeBtn = mediaAskForm.querySelector(".card-media-mode-btn");
        mediaModeBtn?.addEventListener("click", event => {
          event.preventDefault();
          event.stopPropagation();
          const nextAudioOnly = mediaModeBtn.dataset.audioOnly !== "true";
          mediaModeBtn.dataset.audioOnly = nextAudioOnly ? "true" : "false";
          mediaModeBtn.classList.toggle("is-audio-only", nextAudioOnly);
          mediaModeBtn.textContent = nextAudioOnly ? "Só áudio" : "Vídeo";
          mediaModeBtn.title = nextAudioOnly
            ? "Modo atual: Apenas áudio (~9x menos tokens · clique para incluir vídeo)"
            : "Modo atual: Vídeo + áudio (clique para analisar apenas o áudio e economizar ~9x tokens)";
          if (mediaAskInput) {
            mediaAskInput.placeholder = nextAudioOnly
              ? "Pergunte à IA sobre o áudio deste vídeo..."
              : "Pergunte à IA sobre este vídeo ou áudio...";
            mediaAskInput.focus();
          }
        });
        const syncMediaAskSendBtn = () => {
          if (!mediaAskSendBtn) return;
          const busyHere = cardAnalyzingState?.targetNodeId === node.id;
          mediaAskSendBtn.classList.toggle("is-stop", busyHere);
          mediaAskSendBtn.type = busyHere ? "button" : "submit";
          mediaAskSendBtn.title = busyHere ? "Parar requisição" : "Enviar pergunta (Enter)";
          mediaAskSendBtn.setAttribute("aria-label", busyHere ? "Parar requisição" : "Enviar pergunta");
          mediaAskSendBtn.innerHTML = busyHere
            ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg>`
            : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>`;
          mediaAskSendBtn.disabled = busyHere ? false : !String(mediaAskInput?.value || "").trim();
          if (mediaAskInput) {
            mediaAskInput.disabled = busyHere;
          }
        };
        mediaAskInput?.addEventListener("input", syncMediaAskSendBtn);
        mediaAskInput?.addEventListener("keydown", event => {
          event.stopPropagation();
          if (event.key === "Escape" && cardAnalyzingState?.targetNodeId !== node.id) {
            mediaAskForm.hidden = true;
          }
        });
        mediaAskSendBtn?.addEventListener("click", event => {
          if (cardAnalyzingState?.targetNodeId === node.id) {
            event.preventDefault();
            event.stopPropagation();
            stopActiveCardMediaAsk(node.id);
          }
        });
        mediaAskForm.addEventListener("submit", async event => {
          event.preventDefault();
          event.stopPropagation();
          const q = String(mediaAskInput?.value || "").trim();
          if (!q || cardAnalyzingState) return;
          mediaAskInput.value = "";
          const audioOnly = mediaModeBtn?.dataset.audioOnly === "true";
          await askAiAboutCardMedia(node, cardMediaInfo, q, { audioOnly });
        });
        syncMediaAskSendBtn();
      }

      card.querySelector(".card-check")?.addEventListener("click", event => {
        event.stopPropagation();
        const currentStatus = node.status || "ongoing";
        const newStatus = currentStatus === "complete" ? "ongoing" : "complete";
        node.status = newStatus;
        saveState();

        card.classList.remove(`status-${currentStatus}`, "done");
        card.classList.add(`status-${newStatus}`);
        if (newStatus === "complete") {
          card.classList.add("done");
          setAiIconMood("happy", { durationMs: 2800 });
        }
        card.dataset.status = newStatus;
        event.currentTarget.innerHTML = icons.check;

        renderLinks();
        renderUserTasks();
      });

      card.querySelector(".card-action")?.addEventListener("click", event => {
        event.stopPropagation();
        setAiIconMood("angry", { durationMs: 2200 });
        removeNode(node.id);
      });

      card.querySelector(".image-card-fullscreen-btn")?.addEventListener("click", event => {
        event.stopPropagation();
        if (node.imageUrl && window.openFullscreenImage) {
          window.openFullscreenImage(node.imageUrl);
        }
      });

      card.querySelector(".image-card-body img")?.addEventListener("dblclick", event => {
        event.stopPropagation();
        if (node.imageUrl && window.openFullscreenImage) {
          window.openFullscreenImage(node.imageUrl);
        }
      });

      card.querySelectorAll(".card-inline-img-wrap img").forEach(img => {
        img.addEventListener("dblclick", event => {
          event.stopPropagation();
          const src = img.getAttribute("src");
          if (src && window.openFullscreenImage) {
            window.openFullscreenImage(src);
          }
        });
      });
    }

    const bodyEditor = card.querySelector(".card-body");

    if (bodyEditor) {
      bodyEditor.addEventListener("pointerdown", event => {
        if (event.target.closest(".card-todo-btn, .card-todo-wrap, .card-inline-media-ai, .card-inline-img-del, .card-inline-video-wrap, .card-inline-video-del, .card-inline-audio-wrap, .card-inline-audio-del, .card-table-wrap")) {
          event.stopPropagation();
        }
      });

      bodyEditor.addEventListener("click", event => {
        const tableBtn = event.target.closest(".card-table-btn");
        if (tableBtn) {
          event.preventDefault();
          event.stopPropagation();
          handleCardTableAction(tableBtn, bodyEditor, node, card);
          return;
        }

        const tableCheckBtn = event.target.closest(".card-table-check-btn");
        if (tableCheckBtn) {
          event.preventDefault();
          event.stopPropagation();
          const cell = tableCheckBtn.closest(".card-excel-check-cell");
          const wrap = tableCheckBtn.closest(".card-table-wrap");
          const tr = tableCheckBtn.closest("tr");
          if (cell && wrap) {
            const nowChecked = cell.dataset.raw !== "[x]";
            cell.dataset.raw = nowChecked ? "[x]" : "[ ]";
            tableCheckBtn.classList.toggle("checked", nowChecked);
            tableCheckBtn.setAttribute("aria-checked", String(nowChecked));
            tableCheckBtn.innerHTML = nowChecked ? icons.check : "";
            tr?.classList.toggle("is-checked-row", nowChecked);
            wrap.dataset.tableEncoded = encodeTableData(readCardTableDataFromDom(wrap));
            setNodeContent(node, serializeEditableContent(bodyEditor));
            saveState();
          }
          return;
        }

        const imgDelBtn = event.target.closest(".card-inline-img-del");
        if (imgDelBtn) {
          event.preventDefault();
          event.stopPropagation();
          const imgWrap = imgDelBtn.closest(".card-inline-img-wrap");
          if (imgWrap) {
            imgWrap.remove();
            setNodeContent(node, serializeEditableContent(bodyEditor));
            saveState();
            renderLinks();
            setTimeout(() => scheduleNodeHeightSync(node.id, card), 50);
          }
          return;
        }

        const videoDelBtn = event.target.closest(".card-inline-video-del");
        if (videoDelBtn) {
          event.preventDefault();
          event.stopPropagation();
          const videoWrap = videoDelBtn.closest(".card-inline-video-wrap");
          if (videoWrap) {
            const vid = videoWrap.querySelector("video");
            if (vid) {
              vid.pause();
              vid.removeAttribute("src");
              vid.load();
            }
            videoWrap.remove();
            setNodeContent(node, serializeEditableContent(bodyEditor));
            saveState();
            renderLinks();
            setTimeout(() => scheduleNodeHeightSync(node.id, card), 50);
          }
          return;
        }

        const audioDelBtn = event.target.closest(".card-inline-audio-del");
        if (audioDelBtn) {
          event.preventDefault();
          event.stopPropagation();
          const audioWrap = audioDelBtn.closest(".card-inline-audio-wrap");
          if (audioWrap) {
            const aud = audioWrap.querySelector("audio");
            if (aud) {
              aud.pause();
              aud.removeAttribute("src");
              aud.load();
            }
            audioWrap.remove();
            setNodeContent(node, serializeEditableContent(bodyEditor));
            saveState();
            renderLinks();
            setTimeout(() => scheduleNodeHeightSync(node.id, card), 50);
          }
          return;
        }

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

      bodyEditor.addEventListener("focusin", event => {
        const cell = event.target.closest?.(".card-excel-cell");
        if (cell && !cell.classList.contains("card-excel-check-cell")) {
          const wrap = cell.closest(".card-table-wrap");
          if (wrap) {
            wrap.dataset.activeRow = cell.dataset.row || "0";
            wrap.dataset.activeCol = cell.dataset.col || "0";
          }
          const raw = cell.dataset.raw ?? "";
          if (raw.trim().startsWith("=")) {
            cell.textContent = raw;
          }
        }
      });

      bodyEditor.addEventListener("focusout", event => {
        const cell = event.target.closest?.(".card-excel-cell");
        if (cell && !cell.classList.contains("card-excel-check-cell")) {
          const wrap = cell.closest(".card-table-wrap");
          if (wrap) {
            cell.dataset.raw = cell.textContent ?? "";
            refreshCardTableDom(wrap);
            setNodeContent(node, serializeEditableContent(bodyEditor));
            saveState();
          }
        }
      });

      bodyEditor.addEventListener("paste", event => {
        const plain = event.clipboardData?.getData("text/plain") || "";
        if (!plain.includes("\t")) return;
        const cell = event.target.closest?.(".card-excel-cell");
        if (cell && !cell.classList.contains("card-excel-check-cell")) {
          const wrap = cell.closest(".card-table-wrap");
          if (wrap) {
            const r = parseInt(cell.dataset.row || "0", 10);
            const c = parseInt(cell.dataset.col || "0", 10);
            const currentData = readCardTableDataFromDom(wrap);
            const updated = applyTsvIntoTable(currentData, r, c, plain);
            if (updated) {
              event.preventDefault();
              event.stopPropagation();
              replaceCardTableDom(wrap, updated, r, c);
              setNodeContent(node, serializeEditableContent(bodyEditor));
              saveState();
              scheduleNodeHeightSync(node.id, card);
            }
          }
          return;
        }
        const parsedTable = parseTsvToTableData(plain);
        if (parsedTable) {
          event.preventDefault();
          event.stopPropagation();
          insertCardTableInEditor(bodyEditor, parsedTable, node, card);
        }
      });

      bodyEditor.addEventListener("keydown", event => {
        const cell = event.target.closest?.(".card-excel-cell");
        if (cell && !cell.classList.contains("card-excel-check-cell")) {
          handleCardTableCellKeydown(event, cell, bodyEditor, node, card);
          return;
        }
        handleAttachmentReferenceKeydown(event);
        if (event.defaultPrevented) return;
        handleTodoKeydown(event, bodyEditor, node);
      });
      bodyEditor.addEventListener("input", event => {
        const cell = event.target.closest?.(".card-excel-cell");
        if (cell && !cell.classList.contains("card-excel-check-cell")) {
          cell.dataset.raw = cell.textContent ?? "";
          const wrap = cell.closest(".card-table-wrap");
          if (wrap) {
            wrap.dataset.tableEncoded = encodeTableData(readCardTableDataFromDom(wrap));
          }
        }
        setNodeContent(node, serializeEditableContent(bodyEditor));
        saveState();
        if (!cell) {
          syncAttachmentReferencePicker(bodyEditor);
        }
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

    card.querySelector(".port-out")?.addEventListener("pointerdown", event => startLinkDrag(event, node.id, "out"));
    card.querySelector(".port-in")?.addEventListener("pointerdown", event => startLinkDrag(event, node.id, "in"));
    card.querySelector(".port-top")?.addEventListener("pointerdown", event => startLinkDrag(event, node.id, "top"));
    card.querySelector(".port-bottom")?.addEventListener("pointerdown", event => startLinkDrag(event, node.id, "bottom"));
    card.querySelector(".card-color-btn")?.addEventListener("pointerdown", event => event.stopPropagation());
    card.querySelector(".card-color-btn")?.addEventListener("click", event => {
      event.stopPropagation();
      openCardColorPopover(event.currentTarget, node, card);
    });
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
        if (command === "transcribeAudio") {
          handleTranscribeTriggerClick(event, node.id, btn);
          return;
        }
        const editor = card.querySelector(".card-body");
        if (editor) {
          if (command === "insertAttachmentInline") {
            pickAndInsertAttachmentIntoCard(node, editor, card);
            return;
          }
          if (command === "insertTable") {
            insertCardTableInEditor(editor, createDefaultTableData(3, 3), node, card);
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
        let initialTitle = board.title;
        titleEl.addEventListener("focus", () => {
          initialTitle = board.title;
        });
        titleEl.addEventListener("input", () => {
          const liveTitle = titleEl.innerText.replace(/\r?\n/g, " ").trim().slice(0, 56);
          if (!liveTitle) return;
          board.title = liveTitle;
          node.title = liveTitle;
          const t = activeUser()?.tasks.find(item => item.id === board.id);
          if (t) t.title = liveTitle;
          const sidebarTitle = document.querySelector(`.user-task-card[data-task-id="${board.id}"] .user-task-title`);
          if (sidebarTitle) sidebarTitle.textContent = liveTitle;
          saveState();
        });
        const commitTitle = () => {
          const newTitle = titleEl.innerText.replace(/\r?\n/g, " ").trim().slice(0, 56);
          if (newTitle) {
            board.title = newTitle;
            node.title = newTitle;
            const t = activeUser()?.tasks.find(item => item.id === board.id);
            if (t) t.title = newTitle;
            saveState();
            render();
          } else {
            board.title = initialTitle;
            node.title = initialTitle;
            titleEl.innerText = initialTitle;
            renderUserTasks();
          }
        };

        titleEl.addEventListener("blur", commitTitle);
        titleEl.addEventListener("keydown", event => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            titleEl.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            titleEl.innerText = initialTitle;
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

    const resumedForCard = restorePreservedCardVideos(card, node.id, preservedVideos);
    if (resumedForCard.length) {
      videosToResume.push(...resumedForCard);
    }

    nodesLayer.appendChild(card);
    if (node.type === "table") {
      syncTableCardRowPorts(card, node);
    }
  });

  // Retoma a reproducao dos videos preservados sem reiniciar nem perder o ponto atual
  videosToResume.forEach(({ videoEl, currentTime }) => {
    if (Number.isFinite(currentTime) && Math.abs(videoEl.currentTime - currentTime) > 0.25) {
      try { videoEl.currentTime = currentTime; } catch (_) { }
    }
    if (videoEl.paused) {
      videoEl.play().catch(() => { });
    }
  });

  // Pausa qualquer video que nao existe mais no board (ex: card removido)
  preservedVideos.forEach(({ videoEl }) => {
    try { videoEl.pause(); } catch (_) { }
  });

  syncCardRecordingIndicator(transcribeState?.targetNodeId || null);
  syncCardAnalyzingIndicator(cardAnalyzingState?.targetNodeId || null);
  syncCardMediaAiSpheres();

  // Segunda passada: com todos os cards no DOM, ler offsetHeight de uma vez
  // (um unico reflow) para cachear a altura real de cada um.
  renderedHeights.clear();
  board.nodes.forEach(node => {
    const el = nodesLayer.querySelector(`[data-id="${node.id}"]`);
    if (el) {
      if (node.type === "table") {
        const h = Math.max(48, Math.round(el.offsetHeight || node.h || 96));
        node.h = h;
        renderedHeights.set(node.id, h);
      } else {
        renderedHeights.set(node.id, node.h > 0 ? node.h : el.offsetHeight);
      }
    }
  });
}

// Altura usada para posicionar ports/linhas: altura fixa quando o card foi
// redimensionado, senao a altura real renderizada com snap para a grade, com fallback de 144.
function nodeHeight(node) {
  if (node.type === "table") {
    return renderedHeights.get(node.id) || node.h || 144;
  }
  const minH = node.type === "image" ? 48 : MIN_CARD_HEIGHT;
  if (node.h > 0) return Math.max(minH, Math.round(node.h / 48) * 48);
  const measured = renderedHeights.get(node.id);
  if (measured) {
    return Math.max(minH, Math.round(measured / 48) * 48);
  }
  return DEFAULT_CARD_HEIGHT;
}

// O card cresce/encolhe com o texto digitado. Sem re-medir, os ports (e as setas
// que apontam para eles) continuam na altura antiga ate o proximo render()
// completo. Coalescido por frame para nao forcar reflow a cada tecla.
let nodeHeightSyncFrame = null;
const pendingHeightSyncNodes = new Set();

function estimateActionCardSize(bodyText) {
  const GRID = 24;
  const HEIGHT_GRID = 48;
  const raw = String(bodyText || "");
  const plain = raw
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[table:[^\]]+\]\]/g, "")
    .replace(/!\[(?:image|video)\]\([^)]+\)/g, "")
    .replace(/@\[([^\]]+)\]\(attachment:[^)]+\)/g, "@$1");
  const lines = plain.split(/\r?\n/);
  const maxLineLen = lines.reduce((m, l) => Math.max(m, l.trim().length), 0);
  const totalChars = plain.trim().length;
  const hasVideo = /!\[video\]\([^)]+\)/.test(raw);
  const hasImage = /!\[image\]\([^)]+\)/.test(raw);
  const hasTable = /\[\[table:[^\]]+\]\]/.test(raw);

  let w = MIN_CARD_WIDTH;
  if (hasTable || totalChars > 260 || maxLineLen > 52) {
    w = 432;
  } else if (hasVideo || totalChars > 140 || maxLineLen > 36) {
    w = 360;
  } else if (totalChars > 60 || maxLineLen > 24) {
    w = 336;
  }

  const charsPerLine = Math.max(18, Math.floor((w - 36) / 7.6));
  let wrappedLines = 0;
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      wrappedLines += 0.6;
      return;
    }
    const effectiveCharsPerLine = idx === 0 ? Math.max(14, Math.floor(charsPerLine * 0.78)) : charsPerLine;
    wrappedLines += Math.max(1, Math.ceil(trimmed.length / effectiveCharsPerLine));
  });

  // 84px de chrome (top bar + format bar + paddings) + ~22px por linha
  let estH = 88 + Math.ceil(wrappedLines * 22);
  if (hasVideo) estH += 220;
  if (hasImage) estH += 140;
  if (hasTable) estH += 140;

  w = Math.max(MIN_CARD_WIDTH, Math.min(480, Math.ceil(w / GRID) * GRID));
  const h = Math.max(DEFAULT_CARD_HEIGHT, Math.min(576, Math.ceil(estH / HEIGHT_GRID) * HEIGHT_GRID));
  return { w, h };
}

function estimateTableCardDimensions(tableData) {
  const GRID = 24;
  const rows = Array.isArray(tableData?.rows) ? tableData.rows : [];
  const hasChecks = Boolean(tableData?.hasCheckboxes);
  const colCount = Math.max(1, rows.reduce((m, r) => Math.max(m, Array.isArray(r) ? r.length : 0), 0));

  let totalWidth = 24;
  for (let c = 0; c < colCount; c++) {
    if (hasChecks && c === 0) {
      totalWidth += 38;
      continue;
    }
    let maxChars = 0;
    for (const r of rows) {
      const cellStr = String(r?.[c] ?? "").trim();
      const visibleLen = cellStr.startsWith("=") ? Math.min(12, cellStr.length) : cellStr.length;
      if (visibleLen > maxChars) maxChars = visibleLen;
    }
    const colW = Math.max(110, Math.min(280, Math.round(maxChars * 8.4 + 28)));
    totalWidth += colW;
  }

  const w = Math.max(384, Math.min(864, Math.ceil(totalWidth / GRID) * GRID));
  const h = Math.max(144, 56 + rows.length * 34);
  return { w, h };
}

function scheduleNodeHeightSync(nodeId, card) {
  if (nodeId) pendingHeightSyncNodes.add(nodeId);
  if (nodeHeightSyncFrame) return;
  nodeHeightSyncFrame = requestAnimationFrame(() => {
    nodeHeightSyncFrame = null;
    const ids = [...pendingHeightSyncNodes];
    pendingHeightSyncNodes.clear();
    const board = activeBoard();
    if (!board) return;
    let changed = false;

    ids.forEach(id => {
      const cardEl = nodesLayer.querySelector(`.task-card[data-id="${id}"]`);
      const node = board.nodes.find(n => n.id === id);
      if (!cardEl || !cardEl.isConnected || !node) return;
      if (node.type === "table") {
        syncTableCardRowPorts(cardEl, node);
        changed = true;
        return;
      }
      const bodyEl = cardEl.querySelector(".card-body");
      if (bodyEl && bodyEl.scrollHeight > bodyEl.clientHeight + 2) {
        const extra = bodyEl.scrollHeight - bodyEl.clientHeight;
        const newHeight = Math.min(672, Math.ceil((nodeHeight(node) + extra + 6) / 48) * 48);
        if (newHeight > nodeHeight(node)) {
          node.h = newHeight;
          cardEl.style.height = `${newHeight}px`;
          cardEl.style.minHeight = `${newHeight}px`;
          renderedHeights.set(id, newHeight);
          changed = true;
        }
      }
    });

    if (changed) {
      renderLinks();
      saveState();
    }
  });
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
  const showArrows = isShowLinkArrows();

  board.links.forEach(link => {
    const from = nodesById.get(link.from);
    const to = nodesById.get(link.to);
    const fromPort = link.fromPort || "out";
    const toPort = link.toPort || "in";
    const start = getPortPoint(from, fromPort, link.fromRow ?? null, link.fromOffset ?? null);
    // O ponto de destino tem que ser sempre o centro real do port: e dele que sai
    // a ponta da seta. Qualquer "endireitamento" da linha aqui (ex.: forcar
    // end.y = start.y quando os ports estao quase alinhados) desloca a seta da
    // bolinha. O desnivel pequeno fica por conta do roteador, que resolve com um
    // degrau curto antes da entrada.
    const end = getPortPoint(to, toPort, link.toRow ?? null, link.toOffset ?? null);

    // Inclui tambem os proprios cards de origem e destino nos obstaculos para que a linha
    // nunca atravesse por baixo do proprio card (ex.: quando os cards estao empilhados verticalmente).
    const linkObstacles = obstacles;
    const arrowTip = insetLinkEndpoint(end, toPort, LINK_ARROW_END_GAP);
    const lineEnd = showArrows ? getArrowBasePoint(arrowTip, toPort, LINK_ARROW_LENGTH) : end;
    const linkStatus = normalizeStatus(to.status);
    const startStatus = normalizeStatus(from.status);
    const endStatus = normalizeStatus(to.status);
    const isConnectedToSelected =
      Boolean(selectedNodeId) && (link.from === selectedNodeId || link.to === selectedNodeId);
    const isFlowing = isConnectedToSelected || link.id === selectedLinkId;
    const pathData = createLinkPath(start, lineEnd, fromPort, toPort, linkObstacles);

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", [
      "link-group",
      `status-${linkStatus}`,
      link.id === selectedLinkId ? "selected" : "",
      isFlowing ? "flowing" : ""
    ].filter(Boolean).join(" "));

    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("class", "link-hit-area");
    hitPath.setAttribute("d", pathData);

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", [
      "link-path",
      `status-${linkStatus}`,
      link.id === selectedLinkId ? "selected" : "",
      isFlowing ? "flowing" : ""
    ].filter(Boolean).join(" "));
    path.setAttribute("d", pathData);

    const handleSelectLink = event => {
      event.stopPropagation();
      selectedLinkId = link.id;
      selectedNodeId = null;
      pendingLink = null;
      render();
    };

    const handleRemoveLink = event => {
      event.stopPropagation();
      event.preventDefault();
      const currentBoard = activeBoard();
      if (!currentBoard) return;
      currentBoard.links = currentBoard.links.filter(l => l.id !== link.id);
      if (selectedLinkId === link.id) selectedLinkId = null;
      saveState();
      render();
    };

    hitPath.addEventListener("click", handleSelectLink);
    hitPath.addEventListener("dblclick", handleRemoveLink);
    path.addEventListener("click", handleSelectLink);
    path.addEventListener("dblclick", handleRemoveLink);

    group.append(hitPath, path);
    if (showArrows) {
      const arrow = createSvgArrowHead(arrowTip, toPort, linkStatus);
      group.appendChild(arrow);
    }

    linkLayer.appendChild(group);

    const midPoint = getLinkMidpoint(path, start, lineEnd);
    const deleteBtn = createSvgLinkDeleteButton(midPoint, handleRemoveLink);
    group.appendChild(deleteBtn);
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
      const sourcePoint = getPortPoint(source, dragPort, linkDragState.row ?? null);
      const cursorPoint = { x: linkDragState.x, y: linkDragState.y };
      const fromPoint = sourcePoint;
      const toPoint = cursorPoint;
      const fromPort = dragPort;
      let toPort = linkDragState.snappedPort || "in";
      if (!linkDragState.snappedPort) {
        const dx = cursorPoint.x - sourcePoint.x;
        const dy = cursorPoint.y - sourcePoint.y;
        if (Math.abs(dy) > Math.abs(dx)) {
          toPort = dy >= 0 ? "top" : "bottom";
        } else {
          toPort = dx >= 0 ? "in" : "out";
        }
      }
      const previewStatus = normalizeStatus(source.status);
      const previewPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const previewArrowTip = toPoint;
      const previewLineEnd = showArrows
        ? getArrowBasePoint(previewArrowTip, toPort, LINK_ARROW_LENGTH)
        : previewArrowTip;
      previewPath.setAttribute("class", `link-path link-preview status-${previewStatus}`);
      const previewObstacles = obstacles.filter(o => o.id !== source.id && o.id !== linkDragState.snappedNodeId);
      previewPath.setAttribute("d", createLinkPath(fromPoint, previewLineEnd, fromPort, toPort, previewObstacles));
      if (showArrows) {
        const previewArrow = createSvgArrowHead(previewArrowTip, toPort, previewStatus);
        linkLayer.append(previewPath, previewArrow);
      } else {
        linkLayer.append(previewPath);
      }
    }
  }
}

function getSvgBounds(nodes, drag) {
  const xs = [];
  const ys = [];

  nodes.forEach(node => {
    xs.push(node.x, node.x + (node.w || MIN_CARD_WIDTH));
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

function getLinkMidpoint(pathEl, fallbackStart, fallbackEnd) {
  try {
    const totalLength = pathEl.getTotalLength();
    if (Number.isFinite(totalLength) && totalLength > 0) {
      const pt = pathEl.getPointAtLength(totalLength * 0.5);
      return { x: pt.x, y: pt.y };
    }
  } catch (_) { }
  return {
    x: (fallbackStart.x + fallbackEnd.x) * 0.5,
    y: (fallbackStart.y + fallbackEnd.y) * 0.5
  };
}

function createSvgLinkDeleteButton(point, onRemove) {
  const btn = document.createElementNS("http://www.w3.org/2000/svg", "g");
  btn.setAttribute("class", "link-delete-btn");
  btn.setAttribute("transform", `translate(${point.x}, ${point.y})`);

  const inner = document.createElementNS("http://www.w3.org/2000/svg", "g");
  inner.setAttribute("class", "link-delete-inner");

  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("class", "link-delete-bg");
  circle.setAttribute("cx", "0");
  circle.setAttribute("cy", "0");
  circle.setAttribute("r", "10");

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "path");
  icon.setAttribute("class", "link-delete-icon");
  icon.setAttribute("d", "M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5");

  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = "Remove connection";

  inner.append(circle, icon);
  btn.append(title, inner);

  btn.addEventListener("pointerdown", event => {
    event.stopPropagation();
    event.preventDefault();
  });
  btn.addEventListener("click", onRemove);

  return btn;
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

function getPortPoint(node, port, rowIndex = null, offset = null) {
  const GRID = 24;
  const width = Math.max(node.type === "image" ? 72 : MIN_CARD_WIDTH, node.w || MIN_CARD_WIDTH);
  const height = nodeHeight(node);
  const snappedX = Math.round(node.x / GRID) * GRID;
  const snappedY = Math.round(node.y / GRID) * GRID;
  const ratio = Number.isFinite(offset) ? clamp(offset, 0.08, 0.92) : 0.5;
  if (port === "top") return { x: Math.round(snappedX + width * ratio), y: snappedY };
  if (port === "bottom") return { x: Math.round(snappedX + width * ratio), y: snappedY + height };
  if (node.type === "table") {
    const resolvedRow = rowIndex != null ? rowIndex : 0;
    return {
      x: port === "out" ? snappedX + width : snappedX,
      y: Math.round(snappedY + getTableRowPortOffsetY(node, resolvedRow))
    };
  }
  const yCoord = Number.isFinite(offset)
    ? Math.round(snappedY + height * ratio)
    : Math.round((snappedY + height / 2) / GRID) * GRID;
  return {
    x: port === "out" ? snappedX + width : snappedX,
    y: yCoord
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

function isShowLinkArrows() {
  return localStorage.getItem("todocompanion.settings.linkArrows") !== "false";
}

// Retangulos dos cards inflados pela margem, usados pelo roteador para desviar.
function buildLinkObstacles(nodes) {
  const GRID = 24;
  return nodes.map(node => {
    const w = Math.max(node.type === "image" ? 72 : MIN_CARD_WIDTH, node.w || MIN_CARD_WIDTH);
    const h = nodeHeight(node);
    const x = Math.round(node.x / GRID) * GRID;
    const y = Math.round(node.y / GRID) * GRID;
    return {
      id: node.id,
      x1: Math.round(x - LINK_MARGIN),
      y1: Math.round(y - LINK_MARGIN),
      x2: Math.round(x + w + LINK_MARGIN),
      y2: Math.round(y + h + LINK_MARGIN)
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
    const isRecordingThisTask = Boolean(
      recordingState && recordingState.taskId === task.id && recordingState.userId === user.id
    );
    const isTranscribingThisTask = Boolean(
      (transcribeState && transcribeState.taskId === task.id && transcribeState.userId === user.id) ||
      (cardAnalyzingState && cardAnalyzingState.taskId === task.id && cardAnalyzingState.userId === user.id)
    );
    const isAnalyzingThisTask = Boolean(
      cardAnalyzingState && cardAnalyzingState.taskId === task.id && cardAnalyzingState.userId === user.id
    );
    const activeReminder = normalizeReminder(task.reminder);
    const hasActiveReminder = Boolean(activeReminder && activeReminder.enabled);
    const reminderTooltip = hasActiveReminder
      ? formatReminderSummary(activeReminder)
      : "Definir lembrete ou alarme";
    const card = document.createElement("article");
    card.className = `user-task-card status-${status} priority-${priority} crit-${criticality}${task.id === activeId ? " active" : ""}${task.id === dockDragId ? " dragging" : ""}${isRecordingThisTask ? " is-recording" : ""}${isTranscribingThisTask ? " is-transcribing" : ""}${isAnalyzingThisTask ? " is-analyzing" : ""}${hasActiveReminder ? " has-reminder" : ""}`;
    card.dataset.id = task.id;
    // Card enxuto: so o titulo. Numero, datas, criticidade e anexos continuam
    // acessiveis pelo popup de info (botao "i") e pelo overlay do canvas.
    card.title = isRecordingThisTask
      ? `${task.title} (Gravando)`
      : isTranscribingThisTask
        ? `${task.title} (${isAnalyzingThisTask ? "Analisando áudio com IA" : "Gravando áudio para análise"})`
        : hasActiveReminder
          ? `${task.title} · ${reminderTooltip}`
          : task.title;
    card.innerHTML = `
      ${isRecordingThisTask ? `<span class="task-transcribing-badge is-recording" title="Gravando agora" aria-label="Gravando agora"><canvas class="sidebar-ai-sphere" data-mood="listening" aria-hidden="true"></canvas></span>` : ""}
      ${!isRecordingThisTask && isTranscribingThisTask ? `<span class="task-transcribing-badge${isAnalyzingThisTask ? " is-analyzing" : ""}" title="${isAnalyzingThisTask ? "Analisando e transcrevendo áudio..." : "Gravando áudio para transcrever..."}" aria-label="Transcrevendo áudio"><canvas class="sidebar-ai-sphere" data-mood="${isAnalyzingThisTask ? "thinking" : "listening"}" aria-hidden="true"></canvas></span>` : ""}
      <span class="user-task-id">#${task.number || ""}</span>
      <span class="user-task-title">${escapeHtml(task.title)}</span>
      <div class="user-task-actions">
        <button class="user-task-reminder${hasActiveReminder ? " has-reminder" : ""}${hasActiveReminder && activeReminder.mode === "alarm" ? " is-alarm" : ""}" type="button" aria-label="${escapeHtml(reminderTooltip)}" title="${escapeHtml(reminderTooltip)}">${icons.bell}</button>
        <button class="user-task-info" type="button" aria-label="Information" title="Information">${icons.info}</button>
        <button class="user-task-remove" type="button" aria-label="Remove main task" title="Remove main task">${icons.trash}</button>
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

    card.querySelector(".user-task-reminder").addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      const sameOpen = !taskReminderPopover?.hidden &&
        reminderModalTarget.userId === user.id &&
        reminderModalTarget.taskId === task.id;
      if (sameOpen) {
        closeTaskReminderModal();
      } else {
        openTaskReminderModal(user.id, task.id, event.currentTarget);
      }
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
  syncSidebarAiSpheres();
}

const USERS_RAIL_KEY = "todocompanion.settings.usersRailCollapsed";
const TASKS_SIDEBAR_KEY = "todocompanion.settings.tasksSidebarCollapsed";
const TASKS_SIDEBAR_WIDTH_KEY = "todocompanion.settings.tasksSidebarWidth";
const TASKS_SIDEBAR_DEFAULT_WIDTH = 264;
const TASKS_SIDEBAR_MIN_WIDTH = 180;
const TASKS_SIDEBAR_MAX_WIDTH = 600;

let usersRailPinnedCollapsed = false;
let tasksSidebarPinnedCollapsed = false;

function syncPinnedCollapsedWorkspaceClasses() {
  const workspaceEl = usersRail?.closest(".workspace") || tasksSidebar?.closest(".workspace");
  if (!workspaceEl) return;
  workspaceEl.classList.toggle("users-pinned-collapsed", usersRailPinnedCollapsed);
  workspaceEl.classList.toggle("tasks-pinned-collapsed", tasksSidebarPinnedCollapsed);
  const leftOffset = usersRailPinnedCollapsed ? 46 : 210;
  tasksSidebar?.style.setProperty("--tasks-pinned-left", `${leftOffset}px`);
}

function bindSidebarHoverExpand({
  element,
  isPinnedCollapsed,
  applyCollapsed,
  shouldKeepOpen = () => false
}) {
  if (!element) return { suppressUntilLeave: () => { } };
  let openTimer = 0;
  let closeTimer = 0;
  let suppressed = false;

  const clearTimers = () => {
    if (openTimer) { clearTimeout(openTimer); openTimer = 0; }
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = 0; }
  };

  element.addEventListener("mouseenter", () => {
    clearTimers();
    if (!isPinnedCollapsed() || suppressed) return;
    openTimer = setTimeout(() => {
      openTimer = 0;
      if (!isPinnedCollapsed() || suppressed) return;
      element.classList.add("hover-expanded");
      applyCollapsed(false);
    }, 90);
  });

  element.addEventListener("mouseleave", () => {
    clearTimers();
    suppressed = false;
    if (!isPinnedCollapsed() || !element.classList.contains("hover-expanded")) return;
    closeTimer = setTimeout(() => {
      closeTimer = 0;
      if (!isPinnedCollapsed() || element.matches(":hover") || shouldKeepOpen()) return;
      element.classList.remove("hover-expanded");
      applyCollapsed(true);
    }, 180);
  });

  return {
    suppressUntilLeave: () => {
      clearTimers();
      suppressed = true;
      element.classList.remove("hover-expanded");
    }
  };
}

let usersRailHoverCtrl = null;
let tasksSidebarHoverCtrl = null;

function initUsersRail() {
  usersRailPinnedCollapsed = localStorage.getItem(USERS_RAIL_KEY) === "1";
  syncPinnedCollapsedWorkspaceClasses();
  applyUsersRailCollapsed(usersRailPinnedCollapsed);
  usersRailHoverCtrl = bindSidebarHoverExpand({
    element: usersRail,
    isPinnedCollapsed: () => usersRailPinnedCollapsed,
    applyCollapsed: applyUsersRailCollapsed,
    shouldKeepOpen: () => Boolean(usersRail.querySelector("input:focus"))
  });
}

function applyUsersRailCollapsed(collapsed) {
  usersRail.classList.toggle("collapsed", collapsed);
  usersRailToggle.innerHTML = icons.menu;
  usersRailToggle.title = collapsed ? "Expand panel" : "Collapse panel";
  usersRailToggle.setAttribute("aria-label", collapsed ? "Expand users panel" : "Collapse users panel");
}

function toggleUsersRail() {
  const wasHoverExpanded = usersRail.classList.contains("hover-expanded");
  const nextCollapsed = wasHoverExpanded ? false : !usersRailPinnedCollapsed;
  usersRailPinnedCollapsed = nextCollapsed;
  localStorage.setItem(USERS_RAIL_KEY, nextCollapsed ? "1" : "0");
  if (nextCollapsed) {
    usersRailHoverCtrl?.suppressUntilLeave();
  } else {
    usersRail.classList.remove("hover-expanded");
  }
  syncPinnedCollapsedWorkspaceClasses();
  applyUsersRailCollapsed(nextCollapsed);
  requestAnimationFrame(() => {
    applyViewport();
    renderLinks();
  });
}

function getStoredTasksSidebarWidth() {
  const stored = parseInt(localStorage.getItem(TASKS_SIDEBAR_WIDTH_KEY), 10);
  return Number.isFinite(stored) ? Math.min(Math.max(stored, TASKS_SIDEBAR_MIN_WIDTH), TASKS_SIDEBAR_MAX_WIDTH) : TASKS_SIDEBAR_DEFAULT_WIDTH;
}

function initTasksSidebar() {
  tasksSidebarPinnedCollapsed = localStorage.getItem(TASKS_SIDEBAR_KEY) === "1";
  syncPinnedCollapsedWorkspaceClasses();
  applyTasksSidebarCollapsed(tasksSidebarPinnedCollapsed);
  initTasksSidebarResizer();
  tasksSidebarHoverCtrl = bindSidebarHoverExpand({
    element: tasksSidebar,
    isPinnedCollapsed: () => tasksSidebarPinnedCollapsed,
    applyCollapsed: applyTasksSidebarCollapsed,
    shouldKeepOpen: () => {
      const editPopup = document.getElementById("taskEditPopup");
      const remPopup = document.getElementById("taskReminderPopover");
      const sortMenu = document.getElementById("tasksSortMenu");
      return Boolean(
        (editPopup && !editPopup.hidden) ||
        (remPopup && !remPopup.hidden) ||
        (sortMenu && !sortMenu.hidden)
      );
    }
  });
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
  const wasHoverExpanded = tasksSidebar.classList.contains("hover-expanded");
  const nextCollapsed = wasHoverExpanded ? false : !tasksSidebarPinnedCollapsed;
  tasksSidebarPinnedCollapsed = nextCollapsed;
  localStorage.setItem(TASKS_SIDEBAR_KEY, nextCollapsed ? "1" : "0");
  if (nextCollapsed) {
    tasksSidebarHoverCtrl?.suppressUntilLeave();
  } else {
    tasksSidebar.classList.remove("hover-expanded");
  }
  syncPinnedCollapsedWorkspaceClasses();
  applyTasksSidebarCollapsed(nextCollapsed);
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
  const dotRadius = clamp(1.1 * Math.sqrt(view.zoom), 0.85, 1.75);
  boardShell.style.setProperty("--grid-size", `${gridSize}px`);
  boardShell.style.setProperty("--grid-x", `${view.panX}px`);
  boardShell.style.setProperty("--grid-y", `${view.panY}px`);
  boardShell.style.setProperty("--dot-radius", `${dotRadius.toFixed(2)}px`);
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

    const HEIGHT_GRID = GRID * 2;
    const isImage = node.type === "image";
    const minW = isImage ? 72 : MIN_CARD_WIDTH;
    const minH = isImage ? 48 : MIN_CARD_HEIGHT;
    const snappedX = Math.round(node.x / GRID) * GRID;
    const snappedY = Math.round(node.y / GRID) * GRID;
    const snappedW = Math.max(minW, Math.round((node.w || minW) / GRID) * GRID);
    const snappedH = Math.max(minH, Math.round((node.h || 144) / HEIGHT_GRID) * HEIGHT_GRID);

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
  const w = node.w || MIN_CARD_WIDTH;
  const h = node.h || 144;
  const GAP = 48;
  return placed.some(other => {
    const otherW = other.w || MIN_CARD_WIDTH;
    const otherH = other.h || 144;
    return (
      node.x < other.x + otherW + GAP &&
      node.x + w + GAP > other.x &&
      node.y < other.y + otherH + GAP &&
      node.y + h + GAP > other.y
    );
  });
}

function getNextActionPosition(board, indexOverride = null) {
  const GRID = 24;
  const GAP = 48;
  const width = MIN_CARD_WIDTH;
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
  let targetX = Math.round((last.x + (last.w || width) + GAP) / GRID) * GRID;
  let targetY = Math.round(last.y / GRID) * GRID;

  while (nodeCollidesWithOthers(board, null, targetX, targetY, width, height, GAP)) {
    targetX += width + GAP;
  }

  return {
    x: targetX,
    y: targetY
  };
}

let activeViewportAnimRaf = 0;

function cancelViewportAnimation() {
  if (activeViewportAnimRaf) {
    cancelAnimationFrame(activeViewportAnimRaf);
    activeViewportAnimRaf = 0;
  }
}

function animateViewportTo({ zoom, panX, panY, durationMs = 460 }) {
  cancelViewportAnimation();
  const view = activeView();
  if (!view) return;
  const startZoom = view.zoom;
  const startPanX = view.panX;
  const startPanY = view.panY;
  const targetZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const startTime = performance.now();

  const step = now => {
    const rawT = Math.min(1, Math.max(0, (now - startTime) / durationMs));
    const eased = 1 - Math.pow(1 - rawT, 3);
    view.zoom = startZoom + (targetZoom - startZoom) * eased;
    view.panX = startPanX + (panX - startPanX) * eased;
    view.panY = startPanY + (panY - startPanY) * eased;
    applyViewport();
    renderLinks();
    if (rawT < 1) {
      activeViewportAnimRaf = requestAnimationFrame(step);
    } else {
      activeViewportAnimRaf = 0;
      saveState();
    }
  };

  activeViewportAnimRaf = requestAnimationFrame(step);
}

function focusNodesChainAnimated(nodeIds, { maxZoom = 1.08, padding = 96, durationMs = 480 } = {}) {
  const board = activeBoard();
  if (!board?.nodes?.length || !boardShell) return;
  const idSet = new Set(Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : []);
  const targets = idSet.size ? board.nodes.filter(n => idSet.has(n.id)) : [];
  if (!targets.length) return;

  const minX = Math.min(...targets.map(n => n.x));
  const minY = Math.min(...targets.map(n => n.y));
  const maxX = Math.max(...targets.map(n => n.x + (n.w || MIN_CARD_WIDTH)));
  const maxY = Math.max(...targets.map(n => n.y + (n.h || 144)));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const availW = Math.max(240, boardShell.clientWidth - padding * 2);
  const availH = Math.max(200, boardShell.clientHeight - padding * 2);
  const zoom = clamp(Math.min(availW / contentWidth, availH / contentHeight, maxZoom), MIN_ZOOM, MAX_ZOOM);
  const centerX = minX + contentWidth / 2;
  const centerY = minY + contentHeight / 2;
  const panX = boardShell.clientWidth / 2 - centerX * zoom;
  const panY = boardShell.clientHeight / 2 - centerY * zoom;

  animateViewportTo({ zoom, panX, panY, durationMs });
}

function focusNewlyAddedCard(nodeId) {
  if (!nodeId) return;
  requestAnimationFrame(() => {
    focusNodesChainAnimated([nodeId], { maxZoom: 1.15, padding: 96, durationMs: 260 });
  });
}

function triggerAiCardBirthHighlight(nodeId) {
  if (!nodeId || !nodesLayer) return;
  const el = nodesLayer.querySelector(`[data-id="${nodeId}"]`);
  if (!el) return;
  el.classList.remove("ai-birth-highlight");
  void el.offsetWidth;
  el.classList.add("ai-birth-highlight");
  window.setTimeout(() => {
    el.classList.remove("ai-birth-highlight");
  }, 1250);
}

function centerCanvasOnTasks() {
  const board = activeBoard();
  if (!board?.nodes.length) {
    const view = activeView();
    if (!view) return;
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
  const maxX = Math.max(...board.nodes.map(node => node.x + (node.w || MIN_CARD_WIDTH)));
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

  const cardWidth = node.w || MIN_CARD_WIDTH;
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
  if (!board?.nodes?.length) {
    return;
  }

  const GRID = 24;
  const GAP = 48; // Distância mínima de 2 quadrados de grade (48px) entre cards

  const nodesById = new Map(board.nodes.map(node => [node.id, node]));

  const getNodeWidth = node => {
    const minW = node.type === "image" ? 72 : MIN_CARD_WIDTH;
    return Math.max(minW, Math.round((Number(node.w) || minW) / GRID) * GRID);
  };

  const getNodeHeight = node => nodeHeight(node);

  // Filtra links válidos (ambos nós existentes e sem auto-loops)
  const validLinks = (board.links || []).filter(
    link => nodesById.has(link.from) && nodesById.has(link.to) && link.from !== link.to
  );

  const outgoing = new Map(board.nodes.map(n => [n.id, []]));
  const incoming = new Map(board.nodes.map(n => [n.id, []]));

  validLinks.forEach(link => {
    outgoing.get(link.from).push(link.to);
    incoming.get(link.to).push(link.from);
  });

  const canvasSort = (aId, bId) => {
    const a = nodesById.get(aId);
    const b = nodesById.get(bId);
    return ((a?.y ?? 0) - (b?.y ?? 0)) || ((a?.x ?? 0) - (b?.x ?? 0));
  };

  outgoing.forEach(list => list.sort(canvasSort));

  // 1. Identificar raízes e atribuir profundidade (camadas X)
  const depths = new Map();
  const rootIds = [];

  // Card principal sempre é a raiz primária
  if (board.nodes[0]) {
    rootIds.push(board.nodes[0].id);
  }

  board.nodes.forEach(node => {
    if (incoming.get(node.id).length === 0 && !rootIds.includes(node.id)) {
      rootIds.push(node.id);
    }
  });

  rootIds.forEach(id => depths.set(id, 0));

  let changed = true;
  let iterations = 0;
  const maxIterations = board.nodes.length;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    for (const link of validLinks) {
      const fromDepth = depths.get(link.from);
      if (fromDepth !== undefined) {
        const currentToDepth = depths.get(link.to) ?? 0;
        if (fromDepth + 1 > currentToDepth) {
          depths.set(link.to, fromDepth + 1);
          changed = true;
        }
      }
    }
  }

  board.nodes.forEach(node => {
    if (!depths.has(node.id)) {
      depths.set(node.id, 0);
    }
  });

  const maxDepth = Math.max(...depths.values(), 0);
  const columns = Array.from({ length: maxDepth + 1 }, () => []);

  board.nodes.forEach(node => {
    const d = depths.get(node.id) ?? 0;
    columns[d].push(node.id);
  });

  columns.forEach(col => col.sort(canvasSort));

  // 2. Calcular posições X de cada coluna com GAP exato de 48px
  const minX = Math.min(...board.nodes.map(n => Number.isFinite(n.x) ? n.x : 96));
  const minY = Math.min(...board.nodes.map(n => Number.isFinite(n.y) ? n.y : 96));
  const originX = Math.max(48, Number.isFinite(minX) ? Math.round(minX / GRID) * GRID : 96);
  const originY = Math.max(48, Number.isFinite(minY) ? Math.round(minY / GRID) * GRID : 96);

  const columnWidths = columns.map(col => {
    if (!col.length) return MIN_CARD_WIDTH;
    return Math.max(...col.map(id => getNodeWidth(nodesById.get(id))));
  });

  const columnXs = [];
  let curX = originX;
  for (let d = 0; d <= maxDepth; d++) {
    columnXs[d] = curX;
    curX += columnWidths[d] + GAP;
  }

  // 3. Posicionamento vertical (Y) hierárquico e alinhamento de centros
  const nodeY = new Map();

  const resolveColumn = col => {
    col.sort((a, b) => (nodeY.get(a) ?? 0) - (nodeY.get(b) ?? 0));
    for (let i = 1; i < col.length; i++) {
      const prevId = col[i - 1];
      const currId = col[i];
      const prevNode = nodesById.get(prevId);
      const prevBottom = (nodeY.get(prevId) ?? 0) + getNodeHeight(prevNode);
      const minAllowed = prevBottom + GAP;
      if ((nodeY.get(currId) ?? 0) < minAllowed) {
        nodeY.set(currId, minAllowed);
      }
    }
  };

  const visited = new Set();
  let currentTreeBaseY = originY;

  const layoutSubtree = (nodeId, startY) => {
    if (visited.has(nodeId)) {
      return (nodeY.get(nodeId) ?? startY) + getNodeHeight(nodesById.get(nodeId)) / 2;
    }
    visited.add(nodeId);

    const node = nodesById.get(nodeId);
    const height = getNodeHeight(node);
    const myChildren = outgoing.get(nodeId).filter(childId => depths.get(childId) > depths.get(nodeId));

    if (!myChildren.length) {
      nodeY.set(nodeId, startY);
      return startY + height / 2;
    }

    let childCursorY = startY;
    const childCenters = [];
    myChildren.forEach(childId => {
      const cCenter = layoutSubtree(childId, childCursorY);
      childCenters.push(cCenter);
      const childNode = nodesById.get(childId);
      const cBottom = (nodeY.get(childId) ?? childCursorY) + getNodeHeight(childNode);
      childCursorY = Math.max(childCursorY, cBottom + GAP);
    });

    const avgCenter = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    const desiredY = avgCenter - height / 2;
    const finalY = Math.max(startY, desiredY);
    nodeY.set(nodeId, finalY);
    return finalY + height / 2;
  };

  rootIds.forEach(rootId => {
    if (!visited.has(rootId)) {
      layoutSubtree(rootId, currentTreeBaseY);
      let maxBottomSoFar = currentTreeBaseY;
      visited.forEach(id => {
        const bottom = (nodeY.get(id) ?? 0) + getNodeHeight(nodesById.get(id));
        if (bottom > maxBottomSoFar) maxBottomSoFar = bottom;
      });
      currentTreeBaseY = maxBottomSoFar + GAP;
    }
  });

  board.nodes.forEach(node => {
    if (!visited.has(node.id)) {
      layoutSubtree(node.id, currentTreeBaseY);
      currentTreeBaseY += getNodeHeight(node) + GAP;
    }
  });

  // Relaxamento bidirecional: alinha pais com filhos e vice-versa
  for (let pass = 0; pass < 2; pass++) {
    for (let d = 1; d <= maxDepth; d++) {
      columns[d].forEach(nodeId => {
        const node = nodesById.get(nodeId);
        const myParents = incoming.get(nodeId).filter(pId => depths.get(pId) < d);
        if (myParents.length) {
          const parentCenters = myParents.map(pId => (nodeY.get(pId) ?? 0) + getNodeHeight(nodesById.get(pId)) / 2);
          const avgParentCenter = parentCenters.reduce((sum, c) => sum + c, 0) / parentCenters.length;
          nodeY.set(nodeId, avgParentCenter - getNodeHeight(node) / 2);
        }
      });
      resolveColumn(columns[d]);
    }

    for (let d = maxDepth - 1; d >= 0; d--) {
      columns[d].forEach(nodeId => {
        const node = nodesById.get(nodeId);
        const myChildren = outgoing.get(nodeId).filter(cId => depths.get(cId) > d);
        if (myChildren.length) {
          const childCenters = myChildren.map(cId => (nodeY.get(cId) ?? 0) + getNodeHeight(nodesById.get(cId)) / 2);
          const avgChildCenter = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
          nodeY.set(nodeId, avgChildCenter - getNodeHeight(node) / 2);
        }
      });
      resolveColumn(columns[d]);
    }
  }

  // 4. Normalização e snap preciso à grade de 24px
  const allY = Array.from(nodeY.values());
  const currentMinY = allY.length ? Math.min(...allY) : originY;
  const shiftY = originY - currentMinY;

  board.nodes.forEach(node => {
    const rawY = (nodeY.get(node.id) ?? originY) + shiftY;
    const d = depths.get(node.id) ?? 0;
    node.x = columnXs[d] ?? originX;
    node.y = Math.round(rawY / GRID) * GRID;
  });

  // Garante que após o snap nenhum card encoste no outro
  columns.forEach(col => {
    col.sort((aId, bId) => nodesById.get(aId).y - nodesById.get(bId).y);
    for (let i = 1; i < col.length; i++) {
      const prev = nodesById.get(col[i - 1]);
      const curr = nodesById.get(col[i]);
      const minAllowed = prev.y + getNodeHeight(prev) + GAP;
      if (curr.y < minAllowed) {
        curr.y = Math.ceil(minAllowed / GRID) * GRID;
      }
    }
  });

  saveState();
  renderNodes();
  renderLinks();
  centerCanvasOnTasks();
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
  const cardBody =
    event.target?.closest?.(".card-body") ||
    event.target?.closest?.(".card-body-wrap")?.querySelector?.(".card-body");
  if (cardBody && !event.ctrlKey && cardBody.scrollHeight > cardBody.clientHeight + 2) {
    return;
  }
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

  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    panX: view.panX,
    panY: view.panY,
    moved: false
  };

  boardShell.classList.add("panning");
  boardShell.setPointerCapture(event.pointerId);

  const move = moveEvent => {
    if (!panState || moveEvent.pointerId !== panState.pointerId) {
      return;
    }

    const dx = moveEvent.clientX - panState.startX;
    const dy = moveEvent.clientY - panState.startY;
    if (Math.hypot(dx, dy) >= 4) {
      panState.moved = true;
    }

    view.panX = panState.panX + dx;
    view.panY = panState.panY + dy;
    applyViewport();
  };

  const stop = upEvent => {
    if (!panState || upEvent.pointerId !== panState.pointerId) {
      return;
    }

    const didPan = panState.moved;
    panState = null;
    boardShell.classList.remove("panning");

    if (didPan) {
      saveState();
    } else {
      clearSelection();
      refreshSelectionClasses();
      renderLinks();
    }

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
    w: MIN_CARD_WIDTH,
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
  focusNewlyAddedCard(id);
}

function getReplyActionPosition(board, parentId) {
  const parent = board.nodes.find(node => node.id === parentId);
  if (!parent) {
    return getNextActionPosition(board);
  }

  const outgoingCount = board.links.filter(link => link.from === parentId && (link.fromPort || "out") === "out").length;
  const GRID = 24;
  const GAP = 96;
  const newH = DEFAULT_CARD_HEIGHT;
  const targetY = parent.y + outgoingCount * (newH + 24);
  return {
    x: Math.round((parent.x + (parent.w || MIN_CARD_WIDTH) + GAP) / GRID) * GRID,
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
  const popupH = 92;
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

function createCanvasCardAtPopup(body = "", width = MIN_CARD_WIDTH, height = DEFAULT_CARD_HEIGHT, extra = {}) {
  const board = activeBoard();
  if (!board) return null;
  const pos = newCardPosition ?? getViewportActionPosition();
  const id = makeId("action");
  const freePos = findFreeCardPosition(board, pos.x - width / 2, pos.y - height / 2, width, height, 48);
  board.nodes.push({
    id,
    title: "",
    body,
    status: "ongoing",
    createdAt: new Date().toISOString(),
    x: freePos.x,
    y: freePos.y,
    w: width,
    h: height,
    ...extra
  });
  pendingCardPop.add(id);
  selectedNodeId = id;
  selectedLinkId = null;
  closeNewCardModal();
  saveState();
  render();
  focusNewlyAddedCard(id);
  return id;
}

function saveNewCard(event) {
  event.preventDefault();
  createCanvasCardAtPopup("", MIN_CARD_WIDTH, DEFAULT_CARD_HEIGHT);
}

function createTableCard(tableData, initialFocusCol = 0) {
  const token = serializeTableToken(tableData);
  const { w, h } = estimateTableCardDimensions(tableData);
  const id = createCanvasCardAtPopup(token, w, h, { type: "table" });
  if (!id) return;
  requestAnimationFrame(() => {
    const cardEl = nodesLayer.querySelector(`[data-id="${id}"]`);
    const wrap = cardEl?.querySelector(".card-table-wrap");
    const board = activeBoard();
    const node = board?.nodes?.find(n => n.id === id);
    if (cardEl && node) {
      syncTableCardRowPorts(cardEl, node);
      scheduleNodeHeightSync(id, cardEl);
    }
    if (wrap) focusCardTableCell(wrap, 0, initialFocusCol);
  });
}

function saveNewTodoTableCard(event) {
  event.preventDefault();
  createTableCard(createTodoTableData(3, 3), 1);
}

function saveNewTableCard(event) {
  event.preventDefault();
  createTableCard(createDefaultTableData(3, 3), 0);
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
  node.h = Math.max(48, Math.round(h / (GRID * 2)) * (GRID * 2));
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
  const GAP = 48;
  const width = MIN_CARD_WIDTH;
  const height = 144;
  let x = Math.round((center.x - 144) / GRID) * GRID;
  let y = Math.round((center.y - 72) / GRID) * GRID;
  const board = activeBoard();
  if (board) {
    while (nodeCollidesWithOthers(board, null, x, y, width, height, GAP)) {
      y += height + GAP;
    }
  }
  return { x, y };
}

function createInstantTaskAndFocusRoot() {
  let user = activeUser();
  if (!user) {
    user = state.users[0] || null;
    if (!user) {
      openUserCreatePopup();
      return;
    }
    state.activeUserId = user.id;
  }

  const task = createMainTask(
    {
      title: "Nova task",
      status: "ongoing",
      priority: "normal"
    },
    user.tasks.length
  );
  user.tasks.push(task);
  user.activeTaskId = task.id;
  const rootId = task.nodes[0]?.id || null;
  if (rootId) {
    pendingCardPop.add(rootId);
  }
  selectedNodeId = rootId;
  selectedLinkId = null;
  saveState();
  render();

  if (rootId) {
    focusNewlyAddedCard(rootId);
    requestAnimationFrame(() => {
      const titleEl = nodesLayer.querySelector(`.task-card[data-id="${rootId}"] .root-card-title`);
      if (!titleEl) return;
      titleEl.focus();
      const range = document.createRange();
      range.selectNodeContents(titleEl);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
  }
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

function getClosestBorderPoint(node, cursorWorld) {
  const GRID = 24;
  const width = Math.max(node.type === "image" ? 72 : MIN_CARD_WIDTH, node.w || MIN_CARD_WIDTH);
  const height = nodeHeight(node);
  const x1 = Math.round(node.x / GRID) * GRID;
  const y1 = Math.round(node.y / GRID) * GRID;
  const x2 = x1 + width;
  const y2 = y1 + height;

  const clampedX = clamp(cursorWorld.x, x1 + width * 0.08, x2 - width * 0.08);
  const clampedY = clamp(cursorWorld.y, y1 + height * 0.08, y2 - height * 0.08);

  const candidates = [
    { port: "in", point: { x: x1, y: Math.round(clampedY) }, offset: (clampedY - y1) / height },
    { port: "out", point: { x: x2, y: Math.round(clampedY) }, offset: (clampedY - y1) / height },
    { port: "top", point: { x: Math.round(clampedX), y: y1 }, offset: (clampedX - x1) / width },
    { port: "bottom", point: { x: Math.round(clampedX), y: y2 }, offset: (clampedX - x1) / width }
  ];

  let best = candidates[0];
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.point.x - cursorWorld.x, c.point.y - cursorWorld.y);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { ...best, dist: bestDist, inside: cursorWorld.x >= x1 && cursorWorld.x <= x2 && cursorWorld.y >= y1 && cursorWorld.y <= y2 };
}

function findSnapTarget(drag, cursorWorld) {
  const board = activeBoard();
  const zoom = board.view?.zoom || 1;
  const portSnapRadius = 28 / zoom;
  const borderSnapRadius = 20 / zoom;
  const allPorts = ["in", "out", "top", "bottom"];

  let bestPort = null;
  let bestPortDist = portSnapRadius;

  for (const node of board.nodes) {
    if (node.id === drag.nodeId) continue;

    for (const port of allPorts) {
      if (node.type === "table" && (port === "in" || port === "out")) {
        const rowCount = getTableNodeRowCount(node);
        for (let r = 0; r < rowCount; r++) {
          const point = getPortPoint(node, port, r);
          const dist = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y);
          if (dist < bestPortDist) {
            bestPortDist = dist;
            bestPort = { nodeId: node.id, port, row: r, offset: null, point };
          }
        }
        continue;
      }

      const point = getPortPoint(node, port, null);
      const dist = Math.hypot(point.x - cursorWorld.x, point.y - cursorWorld.y);
      if (dist < bestPortDist) {
        bestPortDist = dist;
        bestPort = { nodeId: node.id, port, row: null, offset: null, point };
      }
    }
  }

  if (bestPort) return bestPort;

  // Permite conectar em qualquer ponto da borda de outro card (arrastando sobre a borda ou interior)
  let bestBorder = null;
  let bestBorderDist = borderSnapRadius;
  for (const node of board.nodes) {
    if (node.id === drag.nodeId || node.type === "table") continue;
    const hit = getClosestBorderPoint(node, cursorWorld);
    if (hit.inside || hit.dist < bestBorderDist) {
      bestBorderDist = hit.inside ? 0 : hit.dist;
      bestBorder = {
        nodeId: node.id,
        port: hit.port,
        row: null,
        offset: Number(hit.offset.toFixed(3)),
        point: hit.point
      };
      if (hit.inside) break;
    }
  }

  return bestBorder;
}

function startLinkDrag(event, nodeId, port, row = null) {
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
    row,
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
      linkDragState.snappedRow = snap.row ?? null;
      linkDragState.snappedOffset = snap.offset ?? null;
    } else {
      linkDragState.x = cursorWorld.x;
      linkDragState.y = cursorWorld.y;
      linkDragState.snappedNodeId = null;
      linkDragState.snappedPort = null;
      linkDragState.snappedRow = null;
      linkDragState.snappedOffset = null;
    }

    const hoverSelector = snap
      ? snap.row != null
        ? `.task-card[data-id="${snap.nodeId}"] .port-${snap.port}[data-row="${snap.row}"]`
        : `.task-card[data-id="${snap.nodeId}"] .port-${snap.port}`
      : null;
    const hoverPort = hoverSelector ? document.querySelector(hoverSelector) : null;

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
  let targetRow = null;
  let targetOffset = null;

  if (drag.snappedNodeId && drag.snappedPort) {
    targetNodeId = drag.snappedNodeId;
    targetPort = drag.snappedPort;
    targetRow = drag.snappedRow ?? null;
    targetOffset = drag.snappedOffset ?? null;
  } else {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const portEl = target?.closest(".port");
    const targetCard = portEl?.closest(".task-card") || target?.closest(".task-card");
    targetNodeId = targetCard?.dataset.id;
    targetPort = portEl?.dataset.port || null;
    targetRow = portEl?.dataset.row != null ? parseInt(portEl.dataset.row, 10) : null;
    if (targetNodeId && targetNodeId !== drag.nodeId && !targetPort) {
      const targetNode = activeBoard()?.nodes?.find(n => n.id === targetNodeId);
      if (targetNode) {
        const hit = getClosestBorderPoint(targetNode, screenToWorld(event.clientX, event.clientY));
        targetPort = hit.port;
        targetOffset = Number(hit.offset.toFixed(3));
      }
    }
  }

  let createdNodeId = null;

  if (targetNodeId && targetNodeId !== drag.nodeId && targetPort) {
    if (drag.port === "in" && targetPort === "out") {
      addLink(targetNodeId, drag.nodeId, targetPort, drag.port, targetRow, drag.row ?? null, targetOffset, null);
    } else {
      addLink(drag.nodeId, targetNodeId, drag.port, targetPort, drag.row ?? null, targetRow, null, targetOffset);
    }
    selectedNodeId = targetNodeId;
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
  const width = MIN_CARD_WIDTH;
  const height = 144;

  const position = useReplySpacing
    ? getConnectionClickPosition(board, drag, width, height)
    : null;
  const xOffset = drag.port === "in" ? -width : drag.port === "top" || drag.port === "bottom" ? -width / 2 : 0;
  const yOffset = drag.port === "top" ? -height : drag.port === "bottom" ? 0 : -height / 2;
  let posX = Math.round((position ? position.x : dropPoint.x + xOffset) / GRID) * GRID;
  let posY = Math.round((position ? position.y : dropPoint.y + yOffset) / GRID) * GRID;
  if (!position) {
    const GAP = 48;
    while (nodeCollidesWithOthers(board, null, posX, posY, width, height, GAP)) {
      posY += height + GAP;
    }
  }

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
    addLink(drag.nodeId, id, "top", "bottom", drag.row ?? null, null);
  } else if (drag.port === "bottom") {
    addLink(drag.nodeId, id, "bottom", "top", drag.row ?? null, null);
  } else if (drag.port === "in") {
    addLink(id, drag.nodeId, "out", "in", null, drag.row ?? null);
  } else {
    addLink(drag.nodeId, id, "out", "in", drag.row ?? null, null);
  }

  focusNewlyAddedCard(id);
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

function addLink(from, to, fromPort = "out", toPort = "in", fromRow = null, toRow = null, fromOffset = null, toOffset = null) {
  const board = activeBoard();
  if (!from || !to || from === to) {
    return false;
  }

  const sameRow = (a, b) => (a ?? null) === (b ?? null);
  const sameOffset = (a, b) => Math.abs((a ?? 0.5) - (b ?? 0.5)) < 0.04;
  if (
    board.links.some(
      link =>
        link.from === from &&
        link.to === to &&
        link.fromPort === fromPort &&
        link.toPort === toPort &&
        sameRow(link.fromRow, fromRow) &&
        sameRow(link.toRow, toRow) &&
        sameOffset(link.fromOffset, fromOffset) &&
        sameOffset(link.toOffset, toOffset)
    )
  ) {
    return false;
  }

  const entry = { id: makeId("link"), from, to, fromPort, toPort };
  if (fromRow != null) entry.fromRow = fromRow;
  if (toRow != null) entry.toRow = toRow;
  if (Number.isFinite(fromOffset) && Math.abs(fromOffset - 0.5) >= 0.03) entry.fromOffset = fromOffset;
  if (Number.isFinite(toOffset) && Math.abs(toOffset - 0.5) >= 0.03) entry.toOffset = toOffset;
  board.links.push(entry);
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

function nodeCollidesWithOthers(board, nodeId, x, y, w, h, gap = 48) {
  if (!board || !board.nodes) return false;
  return board.nodes.some(other => {
    if (other.id === nodeId) return false;
    const otherW = Math.max(other.type === "image" ? 72 : MIN_CARD_WIDTH, other.w || MIN_CARD_WIDTH);
    const otherH = nodeHeight(other);
    return (
      x < other.x + otherW + gap &&
      x + w + gap > other.x &&
      y < other.y + otherH + gap &&
      y + h + gap > other.y
    );
  });
}

function findAllowedDragPosition(board, nodeId, targetX, targetY, w, h, currentX, currentY, gap = 48) {
  if (!nodeCollidesWithOthers(board, nodeId, targetX, targetY, w, h, gap)) {
    return { x: targetX, y: targetY };
  }

  if (!nodeCollidesWithOthers(board, nodeId, targetX, currentY, w, h, gap)) {
    return { x: targetX, y: currentY };
  }

  if (!nodeCollidesWithOthers(board, nodeId, currentX, targetY, w, h, gap)) {
    return { x: currentX, y: targetY };
  }

  const GRID = 24;
  let bestX = currentX;
  let bestY = currentY;

  const stepX = Math.sign(targetX - currentX) * GRID;
  if (stepX !== 0) {
    let testX = currentX + stepX;
    while ((stepX > 0 ? testX <= targetX : testX >= targetX) && !nodeCollidesWithOthers(board, nodeId, testX, currentY, w, h, gap)) {
      bestX = testX;
      testX += stepX;
    }
  }

  const stepY = Math.sign(targetY - currentY) * GRID;
  if (stepY !== 0) {
    let testY = currentY + stepY;
    while ((stepY > 0 ? testY <= targetY : testY >= targetY) && !nodeCollidesWithOthers(board, nodeId, bestX, testY, w, h, gap)) {
      bestY = testY;
      testY += stepY;
    }
  }

  return { x: bestX, y: bestY };
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

  const GRID = 24;
  const HEIGHT_GRID = GRID * 2;
  const isImage = node.type === "image";
  const isTable = node.type === "table";
  const minW = isImage ? 72 : MIN_CARD_WIDTH;
  const minH = isImage ? 48 : MIN_CARD_HEIGHT;

  node.x = Math.round(node.x / GRID) * GRID;
  node.y = Math.round(node.y / GRID) * GRID;
  const initialW = Math.max(minW, Math.round((node.w || minW) / GRID) * GRID);
  const initialH = isTable
    ? Math.max(48, Math.round(card?.offsetHeight || node.h || 144))
    : Math.max(minH, Math.round((node.h || 144) / HEIGHT_GRID) * HEIGHT_GRID);
  node.w = initialW;
  node.h = initialH;

  resizeState = {
    nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    width: initialW,
    height: initialH
  };

  card?.classList.add("resizing", "selected");
  if (!isTable) card?.classList.add("fixed-height");
  if (card) {
    card.style.left = `${node.x}px`;
    card.style.top = `${node.y}px`;
    card.style.width = `${node.w}px`;
    if (!isTable) {
      card.style.minHeight = `${node.h}px`;
      card.style.height = `${node.h}px`;
    }
    renderedHeights.set(node.id, node.h);
  }

  const move = moveEvent => {
    if (!resizeState || moveEvent.pointerId !== resizeState.pointerId) {
      return;
    }

    const zoom = activeView().zoom;
    const dx = (moveEvent.clientX - resizeState.startX) / zoom;
    const dy = (moveEvent.clientY - resizeState.startY) / zoom;

    const candidateW = Math.max(minW, Math.round((resizeState.width + dx) / GRID) * GRID);
    if (isTable) {
      const currentH = Math.max(48, Math.round(card?.offsetHeight || node.h || 144));
      if (!nodeCollidesWithOthers(board, node.id, node.x, node.y, candidateW, currentH)) {
        node.w = candidateW;
      }
      if (card) {
        card.style.width = `${node.w}px`;
        syncTableCardRowPorts(card, node);
      }
      renderLinks();
      return;
    }

    const candidateH = Math.max(minH, Math.round((resizeState.height + dy) / HEIGHT_GRID) * HEIGHT_GRID);

    if (!nodeCollidesWithOthers(board, node.id, node.x, node.y, candidateW, candidateH)) {
      node.w = candidateW;
      node.h = candidateH;
    } else {
      if (!nodeCollidesWithOthers(board, node.id, node.x, node.y, candidateW, node.h)) {
        node.w = candidateW;
      }
      if (!nodeCollidesWithOthers(board, node.id, node.x, node.y, node.w, candidateH)) {
        node.h = candidateH;
      }
    }

    if (card) {
      card.style.width = `${node.w}px`;
      card.style.minHeight = `${node.h}px`;
      card.style.height = `${node.h}px`;
      card.classList.add("fixed-height");
      renderedHeights.set(node.id, node.h);
    }
    renderLinks();
  };

  const stop = upEvent => {
    if (!resizeState || upEvent.pointerId !== resizeState.pointerId) {
      return;
    }

    try {
      event.currentTarget.releasePointerCapture(upEvent.pointerId);
    } catch (_) { }

    resizeState = null;
    saveState();
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    renderNodes();
    renderLinks();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

// Aproxima o card arrastado do alinhamento de centro (horizontal e/ou vertical)
// com qualquer outro card do board, para que linhas e composicao fiquem alinhadas.
// O alinhamento usa o mesmo centro que getPortPoint, entao a linha SVG fica de fato
// horizontal/vertical quando ha conexao. Retorna a posicao (possivelmente ajustada)
// e as coords das guias visuais ativas.
function computeAlignmentSnap(board, node, zoom) {
  const threshold = ALIGN_SNAP_SCREEN_PX / Math.max(zoom, 0.0001);

  const halfW = (node.w || MIN_CARD_WIDTH) / 2;
  const halfH = nodeHeight(node) / 2;
  let x = node.x;
  let y = node.y;
  let guideX = null;
  let guideY = null;
  let bestDx = threshold;
  let bestDy = threshold;

  board.nodes.forEach(other => {
    if (other.id === node.id) return;
    const otherCenterX = other.x + (other.w || MIN_CARD_WIDTH) / 2;
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
  const isEditable = Boolean(event.target.closest("[contenteditable='true'], input, textarea"));
  if (!event.target.closest(".empty-image-card") && !isEditable) {
    event.preventDefault();
  }
  event.currentTarget.setPointerCapture(event.pointerId);
  selectedNodeId = nodeId;
  selectedLinkId = null;
  const GRID = 24;
  node.x = Math.round(node.x / GRID) * GRID;
  node.y = Math.round(node.y / GRID) * GRID;

  dragState = {
    nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    nodeX: node.x,
    nodeY: node.y,
    lastValidX: node.x,
    lastValidY: node.y
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
    const targetX = Math.round(snap.x / GRID) * GRID;
    const targetY = Math.round(snap.y / GRID) * GRID;

    const w = Math.max(node.type === "image" ? 72 : MIN_CARD_WIDTH, node.w || MIN_CARD_WIDTH);
    const h = nodeHeight(node);

    const allowed = findAllowedDragPosition(
      board,
      node.id,
      targetX,
      targetY,
      w,
      h,
      dragState.lastValidX,
      dragState.lastValidY
    );

    dragState.lastValidX = allowed.x;
    dragState.lastValidY = allowed.y;
    node.x = allowed.x;
    node.y = allowed.y;
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

    try {
      event.currentTarget.releasePointerCapture(upEvent.pointerId);
    } catch (_) { }

    const distance = Math.hypot(upEvent.clientX - dragState.startX, upEvent.clientY - dragState.startY);
    const didMove = distance >= 5;

    dragState = null;

    if (didMove) {
      saveState();
    } else {
      if (upEvent.target.closest(".empty-image-card")) {
        document.getElementById('updateImageInput').click();
        window.nodeToUpdateImage = nodeId;
      } else if (upEvent.target.closest(".root-card-title")) {
        const titleEl = upEvent.target.closest(".root-card-title");
        titleEl?.focus();
      }
    }

    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    renderNodes();
    renderLinks();
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
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

const VIDEO_FILE_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv", "avi"]);
const AUDIO_FILE_EXTENSIONS = new Set(["m4a", "mp3", "wav", "ogg", "aac", "flac", "opus", "wma"]);

function isVideoFileName(nameOrPath) {
  const ext = String(nameOrPath || "").split(".").pop()?.toLowerCase() || "";
  return VIDEO_FILE_EXTENSIONS.has(ext);
}

function isAudioFileName(nameOrPath) {
  const ext = String(nameOrPath || "").split(".").pop()?.toLowerCase() || "";
  return AUDIO_FILE_EXTENSIONS.has(ext);
}

function isAudioAttachment(att) {
  if (!att) return false;
  const mime = String(att.type || att.mime || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  if (mime.startsWith("video/")) return false;
  return isAudioFileName(att.name || att.file);
}

function isVideoAttachment(att) {
  if (!att) return false;
  const mime = String(att.type || att.mime || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  if (mime.startsWith("audio/")) return false;
  return isVideoFileName(att.name || att.file);
}

function buildLocalMediaUrl(mediaRef) {
  const raw = String(mediaRef || "").trim();
  if (!raw) return "";
  if (/^(https?:|blob:|data:|todomedia:)/i.test(raw)) {
    return raw;
  }
  const encodedPath = raw
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join("/");
  const isWindows = typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent || "");
  return isWindows
    ? `http://todomedia.localhost/${encodedPath}`
    : `todomedia://localhost/${encodedPath}`;
}

function insertMediaTokenIntoNode(node, mediaRef, kind = "video", cardEl = null) {
  if (!node || !mediaRef) return;
  const tokenKind = kind === "audio" ? "audio" : kind === "image" ? "image" : "video";
  const tokenRef = tokenKind === "image" ? buildLocalMediaUrl(mediaRef) : mediaRef;
  const currentContent = getNodeContent(node) || "";
  const separator = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
  setNodeContent(node, `${currentContent}${separator}![${tokenKind}](${tokenRef})\n`);
  if ((node.w || MIN_CARD_WIDTH) < 336) {
    node.w = 336;
  }
  const minMediaH = tokenKind === "audio" ? 144 : 240;
  if ((node.h || 144) < minMediaH) {
    node.h = minMediaH;
  }
  saveState();
  renderNodes();
  renderLinks();
  focusNewlyAddedCard(node.id);
  setTimeout(() => {
    const resolvedCard = cardEl?.isConnected
      ? cardEl
      : nodesLayer.querySelector(`.task-card[data-id="${node.id}"]`);
    if (resolvedCard) {
      scheduleNodeHeightSync(node.id, resolvedCard);
    }
  }, 120);
}

async function attachMediaFileToCard(node, cardEl, file, kindOverride = null) {
  if (!node || !file) return;
  const kind = kindOverride || (String(file.type || "").startsWith("audio/") || isAudioFileName(file.name) ? "audio" : "video");
  const defaultName = kind === "audio" ? "audio.m4a" : "video.mp4";
  const defaultMime = kind === "audio" ? "audio/mp4" : "video/mp4";
  const user = activeUser();
  const task = activeMainTask();
  if (invoke && user && task) {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      const subDir = `task${task.number}/anexos`;
      const info = await invoke("attachment_save_from_bytes", {
        userId: user.id,
        subDir,
        fileName: file.name || defaultName,
        bytes
      });
      pushAttachment(task, info, file.type || inferMimeFromFileName(file.name) || defaultMime);
      insertMediaTokenIntoNode(node, `${user.id}/${info.file}`, kind, cardEl);
      return;
    } catch (error) {
      console.warn("Falha ao salvar mídia no card", error);
    }
  }
  const objectUrl = URL.createObjectURL(file);
  insertMediaTokenIntoNode(node, objectUrl, kind, cardEl);
}

async function attachMediaPathToCard(node, cardEl, sourcePath, kindOverride = null) {
  if (!node || !sourcePath || !invoke) return;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;
  const kind = kindOverride || (isAudioFileName(sourcePath) ? "audio" : "video");
  const inferredMime = inferMimeFromFileName(sourcePath) || (kind === "audio" ? "audio/mp4" : "video/mp4");
  try {
    const subDir = `task${task.number}/anexos`;
    const info = await invoke("attachment_save_from_path", {
      userId: user.id,
      subDir,
      sourcePath
    });
    pushAttachment(task, info, inferredMime);
    insertMediaTokenIntoNode(node, `${user.id}/${info.file}`, kind, cardEl);
  } catch (error) {
    console.warn("Falha ao anexar mídia no card", error);
  }
}

async function pickAndInsertMediaIntoCard(node, cardEl, kind = "video") {
  if (!node) return;
  const mediaKind = kind === "audio" ? "audio" : "video";
  const user = activeUser();
  const task = activeMainTask();
  if (invoke && user && task) {
    try {
      const subDir = `task${task.number}/anexos`;
      const pickedPath = await invoke("attachment_pick_file", {
        userId: user.id,
        subDir,
        filterKind: mediaKind
      });
      if (pickedPath) {
        await attachMediaPathToCard(node, cardEl, pickedPath, mediaKind);
      }
      return;
    } catch (error) {
      console.warn("Falha ao abrir seletor nativo de mídia", error);
    }
  }
  window.inlineVideoNodeTarget = node;
  window.inlineVideoCardTarget = cardEl;
  window.inlineMediaKindTarget = mediaKind;
  const input = document.getElementById("inlineVideoInput");
  if (input) {
    input.accept = mediaKind === "audio" ? "audio/*" : "video/*";
    input.click();
  }
}

async function insertImagePathIntoCard(node, cardEl, pickedPath) {
  const bytes = await invoke("read_file_bytes", { path: pickedPath });
  if (!bytes || !bytes.length) return;
  const ext = pickedPath.split(".").pop()?.toLowerCase() || "png";
  let mimeType = "image/png";
  if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
  else if (ext === "gif") mimeType = "image/gif";
  else if (ext === "webp") mimeType = "image/webp";
  else if (ext === "svg") mimeType = "image/svg+xml";
  else if (ext === "bmp") mimeType = "image/bmp";

  let binary = "";
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK_SIZE));
  }
  const dataUrl = `data:${mimeType};base64,${window.btoa(binary)}`;
  const currentContent = getNodeContent(node) || "";
  const separator = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
  setNodeContent(node, `${currentContent}${separator}![image](${dataUrl})\n`);
  saveState();
  renderNodes();
  renderLinks();
  focusNewlyAddedCard(node.id);
  setTimeout(() => {
    const resolvedCard = cardEl?.isConnected
      ? cardEl
      : nodesLayer.querySelector(`.task-card[data-id="${node.id}"]`);
    if (resolvedCard) scheduleNodeHeightSync(node.id, resolvedCard);
  }, 60);
}

async function attachDocumentPathToCard(node, cardEl, sourcePath) {
  if (!node || !sourcePath || !invoke) return;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;
  try {
    const subDir = `task${task.number}/anexos`;
    const info = await invoke("attachment_save_from_path", {
      userId: user.id,
      subDir,
      sourcePath
    });
    const savedAtt = pushAttachment(
      task,
      info,
      inferMimeFromFileName(info.original_name) || "application/octet-stream"
    );
    if (!savedAtt) return;
    const safeLabel = String(savedAtt.name || "anexo")
      .replaceAll("]", ")")
      .replaceAll("\r", " ")
      .replaceAll("\n", " ")
      .trim() || "anexo";
    const currentContent = getNodeContent(node) || "";
    const separator = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
    setNodeContent(node, `${currentContent}${separator}@[${safeLabel}](attachment:${savedAtt.id})\n`);
    saveState();
    renderNodes();
    renderLinks();
    setTimeout(() => {
      const resolvedCard = cardEl?.isConnected
        ? cardEl
        : nodesLayer.querySelector(`.task-card[data-id="${node.id}"]`);
      if (resolvedCard) scheduleNodeHeightSync(node.id, resolvedCard);
    }, 60);
  } catch (error) {
    console.warn("Falha ao anexar documento no card", error);
  }
}

async function pickAndInsertAttachmentIntoCard(node, editor, cardEl) {
  if (!node) return;
  const user = activeUser();
  const task = activeMainTask();
  if (invoke && user && task) {
    try {
      const subDir = `task${task.number}/anexos`;
      const pickedPath = await invoke("attachment_pick_file", {
        userId: user.id,
        subDir,
        filterKind: "all"
      });
      if (!pickedPath) return;
      if (isVideoFileName(pickedPath)) {
        await attachMediaPathToCard(node, cardEl, pickedPath, "video");
      } else if (isAudioFileName(pickedPath)) {
        await attachMediaPathToCard(node, cardEl, pickedPath, "audio");
      } else if (/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(pickedPath)) {
        await insertImagePathIntoCard(node, cardEl, pickedPath);
      } else {
        await attachDocumentPathToCard(node, cardEl, pickedPath);
      }
      return;
    } catch (error) {
      console.warn("Falha ao abrir seletor nativo de anexos", error);
    }
  }
  window.inlineVideoNodeTarget = node;
  window.inlineVideoCardTarget = cardEl;
  window.inlineMediaKindTarget = null;
  const input = document.getElementById("inlineVideoInput");
  if (input) {
    input.accept = "*/*";
    input.click();
  }
}

async function pickAndInsertImageIntoCard(node, editor, cardEl) {
  if (!node || !editor) return;
  const user = activeUser();
  const task = activeMainTask();
  if (invoke && user && task) {
    try {
      const subDir = `task${task.number}/anexos`;
      const pickedPath = await invoke("attachment_pick_file", {
        userId: user.id,
        subDir,
        filterKind: "image"
      });
      if (!pickedPath) return;
      const bytes = await invoke("read_file_bytes", { path: pickedPath });
      if (!bytes || !bytes.length) return;
      const ext = pickedPath.split(".").pop()?.toLowerCase() || "png";
      let mimeType = "image/png";
      if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
      else if (ext === "gif") mimeType = "image/gif";
      else if (ext === "webp") mimeType = "image/webp";
      else if (ext === "svg") mimeType = "image/svg+xml";
      else if (ext === "bmp") mimeType = "image/bmp";

      let binary = "";
      const CHUNK_SIZE = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK_SIZE));
      }
      const dataUrl = `data:${mimeType};base64,${window.btoa(binary)}`;
      const currentContent = getNodeContent(node) || "";
      const separator = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
      setNodeContent(node, `${currentContent}${separator}![image](${dataUrl})\n`);
      saveState();
      renderNodes();
      renderLinks();
      setTimeout(() => {
        const resolvedCard = cardEl?.isConnected
          ? cardEl
          : nodesLayer.querySelector(`.task-card[data-id="${node.id}"]`);
        if (resolvedCard) scheduleNodeHeightSync(node.id, resolvedCard);
      }, 60);
      return;
    } catch (error) {
      console.warn("Falha ao abrir seletor nativo de imagem", error);
    }
  }
  window.inlineImageEditorTarget = editor;
  window.inlineImageNodeTarget = node;
  document.getElementById("inlineImageInput")?.click();
}

function embedMediaAttachmentIntoBoard(att) {
  const user = activeUser();
  const board = activeBoard();
  if (!user || !board || !att?.file) return;

  const isVideo = isVideoAttachment(att);
  const isAudio = isAudioAttachment(att);
  const isImage = isImageAttachment(att);
  const selected = selectedNodeId
    ? board.nodes.find(n => n.id === selectedNodeId && !n.isRoot && n.type !== "image")
    : null;

  if (!isVideo && !isAudio && !isImage) {
    const label = String(att.name || att.file || "document").replace(/[\]\r\n]+/g, " ").trim() || "document";
    const token = `@[${label}](attachment:${att.id})`;
    if (selected) {
      const currentContent = getNodeContent(selected) || "";
      const separator = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
      setNodeContent(selected, `${currentContent}${separator}${token}\n`);
      saveState();
      renderNodes();
      renderLinks();
      setTimeout(() => {
        const cardEl = nodesLayer.querySelector(`.task-card[data-id="${selected.id}"]`);
        if (cardEl) scheduleNodeHeightSync(selected.id, cardEl);
      }, 60);
      return;
    }
    const id = createCanvasCardAtPopup(`${token}\n`, 280, 120);
    if (id) {
      setTimeout(() => {
        const cardEl = nodesLayer.querySelector(`.task-card[data-id="${id}"]`);
        if (cardEl) scheduleNodeHeightSync(id, cardEl);
      }, 120);
    }
    return;
  }

  const mediaRef = `${user.id}/${att.file}`;
  const kind = isAudio ? "audio" : isImage ? "image" : "video";

  if (selected) {
    insertMediaTokenIntoNode(selected, mediaRef, kind);
    return;
  }

  const tokenRef = kind === "image" ? buildLocalMediaUrl(mediaRef) : mediaRef;
  const defaultHeight = kind === "audio" ? 144 : kind === "image" ? 260 : 288;
  const id = createCanvasCardAtPopup(`![${kind}](${tokenRef})\n`, 360, defaultHeight);
  if (id) {
    setTimeout(() => {
      const cardEl = nodesLayer.querySelector(`.task-card[data-id="${id}"]`);
      if (cardEl) scheduleNodeHeightSync(id, cardEl);
    }, 120);
  }
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"]+/g;
const BODY_TOKEN_PATTERN = /\[\[table:([A-Za-z0-9_-]+)\]\]|!\[image\]\(([^)]+)\)|@\[([^\]\r\n]+)\]\(attachment:([^)]+)\)|\[([ xX])\] |!\[video\]\(([^)]+)\)|!\[audio\]\(([^)]+)\)|(?:https?:\/\/|www\.)(?:(?!@\[)[^\s<>"])+/g;

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

function resolveMediaDisplayName(mediaRef, fallback = "Mídia") {
  const raw = String(mediaRef || "").trim();
  if (!raw) return fallback;
  const normalized = raw.replaceAll("\\", "/");
  const slashIdx = normalized.indexOf("/");
  const relFile = slashIdx > 0 ? normalized.slice(slashIdx + 1) : normalized;

  const task = activeMainTask();
  const matched = task?.attachments?.find(a => a?.file && a.file.replaceAll("\\", "/") === relFile);
  if (matched?.name) return matched.name;

  const user = activeUser();
  if (user?.tasks?.length) {
    for (const t of user.tasks) {
      const hit = t?.attachments?.find(a => a?.file && a.file.replaceAll("\\", "/") === relFile);
      if (hit?.name) return hit.name;
    }
  }

  const base = normalized.split("/").pop() || fallback;
  try {
    return decodeURIComponent(base);
  } catch (_) {
    return base;
  }
}

function renderBodyHtml(text) {
  const source = String(text || "");
  let html = "";
  let lastIndex = 0;

  for (const match of source.matchAll(BODY_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    html += preserveFormatTags(escapeHtmlPreservingFormats(source.slice(lastIndex, index)));

    if (match[1] !== undefined) {
      html += renderCardTableHtml(decodeTableData(match[1]));
    } else if (match[0].startsWith("![image](")) {
      html += `<span class="card-inline-img-wrap" contenteditable="false"><img src="${escapeAttr(match[2])}" alt="Card image" draggable="false" /><span class="card-inline-img-actions"><button type="button" class="card-inline-media-ai card-inline-img-ai" data-media-kind="image" data-media-src="${escapeAttr(match[2])}" title="Perguntar à IA sobre esta imagem" aria-label="Perguntar à IA sobre esta imagem"><canvas class="card-media-ai-sphere" aria-hidden="true"></canvas></button><button type="button" class="card-inline-img-del" title="Apagar imagem" aria-label="Apagar imagem">${icons.close}</button></span></span>`;
    } else if (match[4]) {
      html += renderAttachmentReferenceHtml(match[3], match[4], match[0]);
    } else if (match[5] !== undefined) {
      const isChecked = match[5].toLowerCase() === "x";
      html += `<span class="card-todo-wrap" contenteditable="false" data-checked="${isChecked}"><button type="button" class="card-todo-btn${isChecked ? " checked" : ""}" role="checkbox" aria-checked="${isChecked}">${isChecked ? icons.check : ""}</button></span> `;
    } else if (match[6] !== undefined) {
      const mediaRef = match[6];
      const videoUrl = buildLocalMediaUrl(mediaRef);
      const mediaName = resolveMediaDisplayName(mediaRef, "Vídeo");
      html += `<span class="card-inline-video-wrap" contenteditable="false" data-video-src="${escapeAttr(mediaRef)}"><span class="card-inline-media-header">${icons.video}<span class="card-inline-media-name" title="${escapeAttr(mediaName)}">${escapeHtml(mediaName)}</span><button type="button" class="card-inline-media-ai" data-media-kind="video" data-media-ref="${escapeAttr(mediaRef)}" title="Perguntar à IA sobre este vídeo" aria-label="Perguntar à IA sobre este vídeo"><canvas class="card-media-ai-sphere" aria-hidden="true"></canvas></button><button type="button" class="card-inline-video-del" title="Remover vídeo" aria-label="Remover vídeo">${icons.close}</button></span><video controls playsinline preload="metadata" src="${escapeAttr(videoUrl)}"></video></span>`;
    } else if (match[7] !== undefined) {
      const mediaRef = match[7];
      const audioUrl = buildLocalMediaUrl(mediaRef);
      const mediaName = resolveMediaDisplayName(mediaRef, "Áudio");
      html += `<span class="card-inline-audio-wrap" contenteditable="false" data-audio-src="${escapeAttr(mediaRef)}"><span class="card-inline-media-header">${icons.audio}<span class="card-inline-media-name" title="${escapeAttr(mediaName)}">${escapeHtml(mediaName)}</span><button type="button" class="card-inline-media-ai" data-media-kind="audio" data-media-ref="${escapeAttr(mediaRef)}" title="Perguntar à IA sobre este áudio" aria-label="Perguntar à IA sobre este áudio"><canvas class="card-media-ai-sphere" aria-hidden="true"></canvas></button><button type="button" class="card-inline-audio-del" title="Remover áudio" aria-label="Remover áudio">${icons.close}</button></span><audio controls preload="metadata" src="${escapeAttr(audioUrl)}"></audio></span>`;
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
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>")
    .replace(/&lt;(b|i|u|s|ul|ol|li)&gt;/gi, (_, tag) => `<${tag.toLowerCase()}>`)
    .replace(/&lt;\/(b|i|u|s|ul|ol|li)&gt;/gi, (_, tag) => `</${tag.toLowerCase()}>`);
}

function sanitizeAiCardBody(raw) {
  return String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n")
    .replace(/<(p|div|h[1-6]|span)(\s[^>]*)?>/gi, "")
    .replace(/<\/span>/gi, "")
    .replace(/<strong(\s[^>]*)?>/gi, "<b>")
    .replace(/<\/strong>/gi, "</b>")
    .replace(/<em(\s[^>]*)?>/gi, "<i>")
    .replace(/<\/em>/gi, "</i>")
    .replace(/<del(\s[^>]*)?>/gi, "<s>")
    .replace(/<\/del>/gi, "</s>")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeAiTableCell(raw) {
  return String(raw ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function shortCardLabel(text, fallback = "Card") {
  const firstLine = String(text || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[\[table:[^\]]+\]\]/g, "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(Boolean);
  if (!firstLine) return fallback;
  return firstLine.length > 42 ? `${firstLine.slice(0, 41)}…` : firstLine;
}

function buildCompactStepGroups(proposal) {
  const groups = [];
  proposal.actions.forEach((act, idx) => {
    const savedResult = Array.isArray(proposal.results) ? proposal.results[idx] : null;
    const state = savedResult
      ? (savedResult.ok ? "done" : "failed")
      : (proposal.stepStates?.[idx] || "pending");
    const text = savedResult?.message || describeAiAction(act);
    const destructive = isDestructiveAction(act);
    const prev = groups[groups.length - 1];
    if (
      proposal.status !== "running" &&
      prev &&
      prev.text === text &&
      prev.state === state &&
      prev.destructive === destructive
    ) {
      prev.count += 1;
      prev.indices.push(idx);
    } else {
      groups.push({
        act,
        state,
        text,
        destructive,
        count: 1,
        indices: [idx]
      });
    }
  });
  return groups;
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
      if (node.matches?.(".card-table-wrap")) {
        const data = readCardTableDataFromDom(node);
        if (result && !result.endsWith("\n")) result += "\n";
        result += `${serializeTableToken(data)}\n`;
      } else if (node.matches?.(".card-inline-img-wrap")) {
        const img = node.querySelector("img");
        if (img) result += `![image](${img.getAttribute("src")})`;
      } else if (node.matches?.(".card-inline-video-wrap")) {
        const videoRef = node.dataset.videoSrc || node.querySelector("video")?.getAttribute("src") || "";
        if (videoRef) result += `![video](${videoRef})`;
      } else if (node.matches?.(".card-inline-audio-wrap")) {
        const audioRef = node.dataset.audioSrc || node.querySelector("audio")?.getAttribute("src") || "";
        if (audioRef) result += `![audio](${audioRef})`;
      } else if (node.matches?.(".card-attachment-link")) {
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

function readCardTableDataFromDom(wrap) {
  if (!wrap) return createDefaultTableData(3, 3);
  const hasCheckboxes = wrap.dataset.hasCheckboxes === "true";
  const trEls = Array.from(wrap.querySelectorAll("tr"));
  if (!trEls.length) {
    return decodeTableData(wrap.dataset.tableEncoded || "");
  }
  const rows = trEls.map(tr =>
    Array.from(tr.querySelectorAll(".card-excel-cell")).map(cell => {
      if (cell.classList.contains("card-excel-check-cell")) {
        const btn = cell.querySelector(".card-table-check-btn");
        return btn?.classList.contains("checked") || cell.dataset.raw === "[x]" ? "[x]" : "[ ]";
      }
      return cell.dataset.raw !== undefined ? cell.dataset.raw : (cell.textContent ?? "");
    })
  );
  return hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
}

function refreshCardTableDom(wrap) {
  if (!wrap) return;
  const data = readCardTableDataFromDom(wrap);
  wrap.dataset.tableEncoded = encodeTableData(data);
  const activeEl = document.activeElement;
  wrap.querySelectorAll(".card-excel-cell").forEach(cell => {
    if (cell.classList.contains("card-excel-check-cell")) return;
    const r = parseInt(cell.dataset.row || "0", 10);
    const c = parseInt(cell.dataset.col || "0", 10);
    const raw = data.rows[r]?.[c] ?? "";
    const isFormula = String(raw).trim().startsWith("=");
    cell.dataset.raw = raw;
    cell.classList.toggle("is-formula", isFormula);
    const cellRef = `${colIndexToLetter(c)}${r + 1}`;
    cell.title = isFormula ? `${cellRef} (${raw})` : cellRef;
    if (cell !== activeEl) {
      cell.textContent = isFormula ? evaluateCellFormula(raw, data.rows, r, c) : raw;
    }
  });
}

function focusCardTableCell(wrap, rowIdx, colIdx) {
  if (!wrap) return;
  const target = wrap.querySelector(`.card-excel-cell[data-row="${rowIdx}"][data-col="${colIdx}"]`);
  if (!target) return;
  target.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function replaceCardTableDom(wrap, nextData, focusRow = null, focusCol = null) {
  if (!wrap) return null;
  const temp = document.createElement("div");
  temp.innerHTML = renderCardTableHtml(nextData);
  const nextWrap = temp.firstElementChild;
  if (!nextWrap) return null;
  wrap.replaceWith(nextWrap);
  if (focusRow !== null && focusCol !== null) {
    const safeR = clamp(focusRow, 0, nextData.rows.length - 1);
    const safeC = clamp(focusCol, 0, (nextData.rows[0]?.length || 1) - 1);
    nextWrap.dataset.activeRow = String(safeR);
    nextWrap.dataset.activeCol = String(safeC);
    requestAnimationFrame(() => focusCardTableCell(nextWrap, safeR, safeC));
  }
  return nextWrap;
}

function insertCardTableInEditor(editor, tableData, node, card) {
  if (!editor) return;
  editor.focus();
  const temp = document.createElement("div");
  temp.innerHTML = `${renderCardTableHtml(tableData)}<br>`;
  const insertedWrap = temp.querySelector(".card-table-wrap");
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const frag = document.createDocumentFragment();
    while (temp.firstChild) {
      frag.appendChild(temp.firstChild);
    }
    range.insertNode(frag);
  } else {
    while (temp.firstChild) {
      editor.appendChild(temp.firstChild);
    }
  }
  setNodeContent(node, serializeEditableContent(editor));
  saveState();
  scheduleNodeHeightSync(node.id, card);
  if (insertedWrap) {
    requestAnimationFrame(() => focusCardTableCell(insertedWrap, 0, 0));
  }
}

function handleCardTableAction(btn, editor, node, card) {
  const wrap = btn.closest(".card-table-wrap");
  if (!wrap) return;
  const action = btn.dataset.tableAction;
  if (action === "delTable") {
    wrap.remove();
    setNodeContent(node, serializeEditableContent(editor));
    saveState();
    scheduleNodeHeightSync(node.id, card);
    return;
  }
  const data = readCardTableDataFromDom(wrap);
  const minEditableCol = data.hasCheckboxes ? 1 : 0;
  const activeR = parseInt(wrap.dataset.activeRow ?? String(data.rows.length - 1), 10);
  const activeC = parseInt(wrap.dataset.activeCol ?? String((data.rows[0]?.length || 1) - 1), 10);
  let nextData = data;
  let nextFocusR = activeR;
  let nextFocusC = Math.max(minEditableCol, activeC);

  if (action === "addRow") {
    nextData = addTableRow(data, activeR);
    nextFocusR = activeR + 1;
    nextFocusC = minEditableCol;
  } else if (action === "delRow") {
    nextData = removeTableRow(data, activeR);
    nextFocusR = Math.max(0, activeR - 1);
  } else if (action === "addCol") {
    nextData = addTableCol(data, activeC);
    nextFocusC = Math.max(minEditableCol, activeC + 1);
  } else if (action === "delCol") {
    nextData = removeTableCol(data, activeC);
    nextFocusC = Math.max(minEditableCol, activeC - 1);
  }

  if (node.type === "table" && (action === "addRow" || action === "delRow")) {
    adjustLinksForTableRowMutation(node.id, action, activeR);
  }

  replaceCardTableDom(wrap, nextData, nextFocusR, nextFocusC);
  setNodeContent(node, serializeEditableContent(editor));
  saveState();
  if (node.type === "table") {
    syncTableCardRowPorts(card, node);
    renderLinks();
  }
  scheduleNodeHeightSync(node.id, card);
}

function handleCardTableCellKeydown(event, cell, editor, node, card) {
  const wrap = cell.closest(".card-table-wrap");
  if (!wrap) return;
  const r = parseInt(cell.dataset.row || "0", 10);
  const c = parseInt(cell.dataset.col || "0", 10);
  const data = readCardTableDataFromDom(wrap);
  const minCol = data.hasCheckboxes ? 1 : 0;
  const rowCount = data.rows.length;
  const colCount = data.rows[0]?.length || 1;

  if (event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    cell.dataset.raw = cell.textContent ?? "";
    if (event.shiftKey) {
      if (c > minCol) {
        focusCardTableCell(wrap, r, c - 1);
      } else if (r > 0) {
        focusCardTableCell(wrap, r - 1, colCount - 1);
      }
    } else if (c + 1 < colCount) {
      focusCardTableCell(wrap, r, c + 1);
    } else if (r + 1 < rowCount) {
      focusCardTableCell(wrap, r + 1, minCol);
    } else {
      const nextData = addTableRow(readCardTableDataFromDom(wrap), rowCount - 1);
      replaceCardTableDom(wrap, nextData, rowCount, minCol);
      setNodeContent(node, serializeEditableContent(editor));
      saveState();
      scheduleNodeHeightSync(node.id, card);
    }
    return;
  }

  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    cell.dataset.raw = cell.textContent ?? "";
    if (r + 1 < rowCount) {
      focusCardTableCell(wrap, r + 1, c);
    } else {
      const nextData = addTableRow(readCardTableDataFromDom(wrap), rowCount - 1);
      replaceCardTableDom(wrap, nextData, rowCount, c);
      setNodeContent(node, serializeEditableContent(editor));
      saveState();
      scheduleNodeHeightSync(node.id, card);
    }
    return;
  }

  if (event.key === "ArrowUp" && r > 0) {
    event.preventDefault();
    focusCardTableCell(wrap, r - 1, c);
  } else if (event.key === "ArrowDown" && r + 1 < rowCount) {
    event.preventDefault();
    focusCardTableCell(wrap, r + 1, c);
  }
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
  const year = String(date.getFullYear());
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
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

let aiChatBridge = null;

function getClipboardAttachmentFiles(clipboardData) {
  if (!clipboardData) return [];
  const items = Array.from(clipboardData.items || []);
  const fromItems = items
    .filter(item => item.kind === "file")
    .map(item => item.getAsFile())
    .filter(Boolean);
  if (fromItems.length > 0) {
    return fromItems;
  }
  return Array.from(clipboardData.files || []).filter(Boolean);
}

function handleClipboardPaste(event) {
  if (!event.clipboardData) {
    return;
  }

  if (aiChatBridge?.isTargetOrHover(event.target)) {
    const chatFiles = getClipboardAttachmentFiles(event.clipboardData);
    if (chatFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      aiChatBridge.addFiles(chatFiles);
    }
    return;
  }

  if (!clipboardAttachModal.hidden) {
    return;
  }

  const file = getClipboardAttachmentFile(event.clipboardData);
  if (!file || !activeMainTask()) {
    return;
  }

  const isImage = file.type?.startsWith("image/");
  if (isImage) {
    const targetCard = event.target?.closest?.(".task-card")
      || document.activeElement?.closest?.(".task-card")
      || document.querySelector(".task-card:hover")
      || (selectedNodeId ? document.querySelector(`.task-card[data-id="${selectedNodeId}"]`) : null);

    if (targetCard && !targetCard.classList.contains("root-card")) {
      const board = activeBoard();
      const node = board?.nodes?.find(n => n.id === targetCard.dataset.id);
      if (node) {
        event.preventDefault();
        attachImageToCard(node, targetCard, file);
        return;
      }
    }
  }

  event.preventDefault();
  preserveAttachmentReferenceTarget(event.target);
  openClipboardAttachModal(file);
}

function attachImageToCard(node, cardEl, file) {
  const reader = new FileReader();
  reader.onload = e => {
    const dataUrl = e.target.result;
    if (node.type === "image") {
      const img = new Image();
      img.onload = () => {
        applyImageNodeSize(node, img.width, img.height);
        node.imageUrl = dataUrl;
        saveState();
        renderNodes();
        renderLinks();
      };
      img.src = dataUrl;
    } else {
      const editor = cardEl.querySelector(".card-body");
      if (editor && (document.activeElement === editor || editor.contains(document.activeElement))) {
        editor.focus();
        document.execCommand("insertImage", false, dataUrl);
        document.execCommand("insertHTML", false, "<br>&#8203;");
        setNodeContent(node, serializeEditableContent(editor));
        saveState();
        renderNodes();
        renderLinks();
        setTimeout(() => {
          scheduleNodeHeightSync(node.id, cardEl);
        }, 50);
      } else {
        const currentContent = getNodeContent(node) || "";
        const separator = currentContent.endsWith("\n") || !currentContent ? "" : "\n";
        setNodeContent(node, currentContent + separator + `![image](${dataUrl})\n`);
        saveState();
        renderNodes();
        renderLinks();
      }
    }
  };
  reader.readAsDataURL(file);
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
  const existing = task.attachments.find(a => a.file === info.file);
  if (existing) {
    existing.name = info.original_name || existing.name;
    existing.size = info.size ?? existing.size;
    if (type && !existing.type) existing.type = type;
    saveState();
    renderUserTasks();
    updateAttachButtonState();
    if (!attachmentsPopup.hidden) {
      renderAttachmentsPopup();
    }
    return existing;
  }
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
const RECORDING_VIDEO_BPS = 800000;
const RECORDING_AUDIO_BPS = 128000;

let recordingState = null;
let isStartingRecording = false;
let recordingTimerInterval = null;
let recordModePopupInitialized = false;

function initRecordModePopup() {
  if (recordModePopupInitialized) return;
  recordModePopupInitialized = true;
  const popup = document.getElementById("recordModePopup");
  const targetBtn = document.getElementById("recordingIndicatorTarget");

  popup?.querySelectorAll("[data-record-mode]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const mode = btn.dataset.recordMode === "audio" ? "audio" : "all";
      closeRecordModePopup();
      await startScreenRecording(mode);
    });
  });

  document.addEventListener("pointerdown", event => {
    if (!popup || popup.hidden) return;
    if (popup.contains(event.target) || recordButton?.contains(event.target)) return;
    closeRecordModePopup();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && popup && !popup.hidden) {
      closeRecordModePopup();
    }
  });

  targetBtn?.addEventListener("click", () => {
    if (!recordingState) return;
    const u = state.users.find(item => item.id === recordingState.userId);
    const t = u?.tasks.find(item => item.id === recordingState.taskId);
    if (!u || !t) return;
    state.activeUserId = u.id;
    u.activeTaskId = t.id;
    saveState();
    render();
  });
}

function closeRecordModePopup() {
  const popup = document.getElementById("recordModePopup");
  if (popup) popup.hidden = true;
}

function toggleRecordModePopup() {
  initRecordModePopup();
  const popup = document.getElementById("recordModePopup");
  if (!popup) return false;
  const willOpen = popup.hidden;
  popup.hidden = !willOpen;
  return true;
}

async function toggleScreenRecording() {
  if (recordingState) {
    // Evita que um clique duplo acidental logo ao fechar o seletor de tela pare a gravacao imediatamente.
    if (Date.now() - recordingState.startedAt < 650) {
      return;
    }
    stopScreenRecording();
  } else if (!isStartingRecording) {
    if (!toggleRecordModePopup()) {
      await startScreenRecording("all");
    }
  }
}

async function startScreenRecording(mode = "all") {
  if (recordingState || isStartingRecording) return;

  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;

  const isAudioOnly = mode === "audio";
  isStartingRecording = true;
  try {
    const nativeFileName = buildRecordingFileName(
      isAudioOnly ? ".m4a" : ".mp4",
      isAudioOnly ? "Audio" : "Recording"
    );
    const subDir = `task${task.number}/anexos`;

    // 1. Gravacao nativa em 1 clique (Tela + Audio ou Apenas Audio via Media Foundation/WASAPI, zero popups)
    if (invoke) {
      try {
        const target = await invoke("native_screen_recording_start", {
          userId: user.id,
          subDir,
          fileName: nativeFileName,
          audioOnly: isAudioOnly
        });
        recordingState = {
          isNative: true,
          mode,
          targetFile: target?.file || "",
          userId: user.id,
          userName: user.name,
          taskId: task.id,
          taskTitle: task.title,
          startedAt: Date.now(),
          userStopped: false,
          finalized: false
        };
        updateRecordingUi(true);
        return;
      } catch (nativeErr) {
        console.warn("Gravacao nativa indisponivel, usando fallback do navegador", nativeErr);
      }
    }

    if (typeof MediaRecorder === "undefined" || !invoke) {
      console.warn("Gravacao nao suportada neste ambiente");
      return;
    }

    if (isAudioOnly) {
      let micStream;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
      } catch (error) {
        console.info("Gravacao de audio nao iniciada", error);
        return;
      }
      const sessionId = makeId("rec");
      const fileName = buildRecordingFileName(".webm", "Audio");
      let target = null;
      let useMemoryFallback = false;
      try {
        target = await invoke("recording_begin", { sessionId, userId: user.id, subDir, fileName });
      } catch (_) {
        useMemoryFallback = true;
      }
      const recState = {
        recorder: null,
        mode: "audio",
        displayStream: null,
        micStream,
        audioContext: null,
        audioTracks: micStream.getAudioTracks(),
        sessionId,
        fileName,
        subDir,
        targetFile: target?.file || "",
        userId: user.id,
        userName: user.name,
        taskId: task.id,
        taskTitle: task.title,
        startedAt: Date.now(),
        bytesWritten: 0,
        chunksProduced: 0,
        fallbackProfile: 0,
        useMemoryFallback,
        fallbackChunks: [],
        writeChain: Promise.resolve(),
        writeError: null,
        userStopped: false,
        finalized: false
      };
      const recorder = new MediaRecorder(micStream);
      recState.recorder = recorder;
      recorder.addEventListener("dataavailable", event => {
        if (event.data && event.data.size > 0) {
          recState.chunksProduced += 1;
          queueRecordingChunk(recState, event.data);
        }
      });
      recorder.addEventListener("stop", () => finalizeRecording(recState));
      recorder.start(RECORDING_TIMESLICE_MS);
      recordingState = recState;
      updateRecordingUi(true);
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      console.warn("Gravacao de tela nao suportada neste ambiente");
      return;
    }

    let displayStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "monitor",
          frameRate: { ideal: 15, max: 24 }
        },
        audio: true
      });
    } catch (error) {
      // Usuario cancelou a selecao ou negou a permissao.
      console.info("Gravacao nao iniciada", error);
      return;
    }

    const videoTracks = displayStream.getVideoTracks().filter(track => track.readyState === "live");
    if (!videoTracks.length) {
      stopAllTracks([displayStream]);
      return;
    }

    // Tenta tambem capturar o microfone para narrar; opcional.
    let micStream = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
    } catch (error) {
      console.info("Microfone indisponivel; gravando apenas o audio do sistema", error);
    }

    const mixed = await mixAudioStreams([displayStream, micStream]);

    // Abre o arquivo destino agora: a pasta fica presa na task escolhida
    // aqui, mesmo que o usuario troque de task durante a gravacao.
    const sessionId = makeId("rec");
    const fileName = buildRecordingFileName();
    let target = null;
    let useMemoryFallback = false;
    try {
      target = await invoke("recording_begin", {
        sessionId,
        userId: user.id,
        subDir,
        fileName
      });
    } catch (error) {
      console.warn("Falha ao abrir sessao em disco; usando buffer em memoria como fallback", error);
      useMemoryFallback = true;
    }

    const recState = {
      recorder: null,
      displayStream,
      micStream,
      audioContext: mixed.context,
      audioTracks: mixed.tracks,
      sessionId,
      fileName,
      subDir,
      targetFile: target?.file || "",
      userId: user.id,
      userName: user.name,
      taskId: task.id,
      taskTitle: task.title,
      mode: "all",
      startedAt: Date.now(),
      bytesWritten: 0,
      chunksProduced: 0,
      fallbackProfile: 0,
      useMemoryFallback,
      fallbackChunks: [],
      writeChain: Promise.resolve(),
      writeError: null,
      userStopped: false,
      finalized: false
    };

    if (!startRecorderForState(recState, 0)) {
      stopAllTracks([displayStream, micStream]);
      closeAudioContext(mixed.context);
      if (!useMemoryFallback) {
        invoke("recording_abort", { sessionId, discard: true }).catch(() => { });
      }
      return;
    }

    recordingState = recState;

    // Se o usuario parar o compartilhamento pela UI nativa do sistema.
    videoTracks.forEach(track => {
      track.addEventListener("ended", () => {
        if (recordingState === recState) {
          stopScreenRecording();
        }
      });
    });

    updateRecordingUi(true);
  } finally {
    isStartingRecording = false;
  }
}

function buildStreamAndRecorder(recState, profileIndex) {
  const videoTracks = recState.displayStream
    .getVideoTracks()
    .filter(track => track.readyState === "live");
  if (!videoTracks.length) return null;

  // Profile 0: video + audio (se houver) com codec VP8 estavel e bitrates controlados
  // Profile 1: video + audio (se houver) com opcoes nativas padrao do WebView2
  // Profile 2: somente video com opcoes nativas padrao (isola falhas de driver/encoder de audio corporativo)
  const includeAudio = profileIndex < 2;
  const liveAudioTracks = includeAudio
    ? (recState.audioTracks || []).filter(track => track.readyState === "live" && track.enabled)
    : [];

  const stream = new MediaStream([...videoTracks, ...liveAudioTracks]);
  const hasAudio = liveAudioTracks.length > 0;

  const candidates = [];
  if (profileIndex === 0) {
    const mimeType = pickRecorderMimeType(hasAudio);
    candidates.push({
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: RECORDING_VIDEO_BPS,
      ...(hasAudio ? { audioBitsPerSecond: RECORDING_AUDIO_BPS } : {})
    });
  }
  if (profileIndex <= 1) {
    const basicMime = pickRecorderMimeType(hasAudio);
    if (basicMime) {
      candidates.push({ mimeType: basicMime });
    }
  }
  candidates.push(undefined);

  for (const options of candidates) {
    try {
      const recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      return recorder;
    } catch (err) {
      console.warn("Tentativa de criacao do MediaRecorder falhou, tentando proximo perfil", options, err);
    }
  }
  return null;
}

function startRecorderForState(recState, startProfile = 0) {
  for (let profile = startProfile; profile <= 2; profile++) {
    const recorder = buildStreamAndRecorder(recState, profile);
    if (!recorder) continue;

    recState.fallbackProfile = profile;
    recState.recorder = recorder;

    recorder.addEventListener("dataavailable", event => {
      if (event.data && event.data.size > 0) {
        recState.chunksProduced += 1;
        queueRecordingChunk(recState, event.data);
      }
    });

    recorder.addEventListener("error", event => {
      console.warn(`Erro no MediaRecorder (perfil ${profile})`, event?.error || event);
      if (!recState.userStopped && recState.chunksProduced === 0 && profile < 2) {
        recState.recovering = true;
        if (startRecorderForState(recState, profile + 1)) {
          recState.recovering = false;
          return;
        }
        recState.recovering = false;
      }
    });

    recorder.addEventListener("stop", () => {
      if (recState.recovering) return;
      if (recState.recorder !== recorder) return;

      const hasLiveVideo = recState.displayStream
        .getVideoTracks()
        .some(track => track.readyState === "live");

      // Se o encoder parou sozinho logo no inicio sem produzir dados (comum em GPUs/drivers corporativos
      // quando um codec ou faixa de audio falha no primeiro frame), reabre automaticamente no proximo perfil.
      if (!recState.userStopped && recState.chunksProduced === 0 && hasLiveVideo && profile < 2) {
        console.warn(`MediaRecorder parou prematuramente no perfil ${profile}; alternando para perfil ${profile + 1}`);
        if (startRecorderForState(recState, profile + 1)) {
          return;
        }
      }

      finalizeRecording(recState);
    });

    try {
      recorder.start(RECORDING_TIMESLICE_MS);
      return true;
    } catch (err) {
      console.warn(`recorder.start falhou no perfil ${profile}`, err);
    }
  }
  return false;
}

function stopScreenRecording() {
  const recState = recordingState;
  if (!recState) return;
  recState.userStopped = true;
  // Zera ja para evitar reentrancia (clique + evento "ended" do track).
  recordingState = null;
  updateRecordingUi(false);

  if (recState.isNative) {
    finalizeNativeRecording(recState);
    return;
  }

  try {
    if (recState.recorder && recState.recorder.state !== "inactive") {
      recState.recorder.stop();
    } else {
      finalizeRecording(recState);
    }
  } catch (error) {
    console.warn("Falha ao parar o gravador", error);
    finalizeRecording(recState);
  }
}

let pendingRecordedVideoToast = null;
let recordedVideoToastTimer = null;

function showRecordedVideoToast(userId, taskId, attachment) {
  if (!attachment?.file) return;
  const toast = document.getElementById("recordedVideoToast");
  const textEl = document.getElementById("recordedVideoToastText");
  if (!toast) return;

  pendingRecordedVideoToast = { userId, taskId, attachment };
  if (textEl) {
    textEl.textContent = "Gravação salva";
  }
  toast.hidden = false;

  if (recordedVideoToastTimer) {
    clearTimeout(recordedVideoToastTimer);
  }
  recordedVideoToastTimer = setTimeout(() => {
    hideRecordedVideoToast();
  }, 12000);
}

function hideRecordedVideoToast() {
  const toast = document.getElementById("recordedVideoToast");
  if (toast) toast.hidden = true;
  pendingRecordedVideoToast = null;
  if (recordedVideoToastTimer) {
    clearTimeout(recordedVideoToastTimer);
    recordedVideoToastTimer = null;
  }
}

function insertPendingRecordedVideoIntoCard() {
  const pending = pendingRecordedVideoToast;
  hideRecordedVideoToast();
  if (!pending) return;

  const targetUser = state.users.find(u => u.id === pending.userId);
  const targetTask = targetUser?.tasks?.find(t => t.id === pending.taskId);
  if (!targetUser || !targetTask) return;

  if (state.activeUserId !== targetUser.id || targetUser.activeTaskId !== targetTask.id) {
    state.activeUserId = targetUser.id;
    targetUser.activeTaskId = targetTask.id;
    saveState();
    render();
  }
  embedMediaAttachmentIntoBoard(pending.attachment);
}

async function finalizeNativeRecording(recState) {
  if (recState.finalized) return;
  recState.finalized = true;
  showRecordingSavingState();

  let info = null;
  try {
    info = await invoke("native_screen_recording_stop");
  } catch (error) {
    console.warn("Falha ao finalizar gravacao nativa de tela", error);
  }

  hideRecordingIndicator();
  if (!info) return;

  const targetUser = state.users.find(u => u.id === recState.userId) || null;
  const targetTask = targetUser?.tasks.find(t => t.id === recState.taskId) || null;
  if (!targetUser || !targetTask) {
    console.warn(`Task original nao encontrada; a gravacao ficou salva em ${info.file}`);
    return;
  }

  const savedAttachment = pushAttachment(targetTask, info, recState.mode === "audio" ? "audio/mp4" : "video/mp4");
  if (savedAttachment) {
    showRecordedVideoToast(targetUser.id, targetTask.id, savedAttachment);
  }
}

// Cada pedaco vai para o disco assim que sai do gravador, na ordem.
function queueRecordingChunk(recState, blob) {
  if (recState.useMemoryFallback) {
    recState.fallbackChunks.push(blob);
    return;
  }
  recState.writeChain = recState.writeChain.then(async () => {
    if (recState.useMemoryFallback) {
      recState.fallbackChunks.push(blob);
      return;
    }
    try {
      const chunk = await blobToBase64(blob);
      if (!chunk) return;
      recState.bytesWritten = await invoke("recording_append", {
        sessionId: recState.sessionId,
        chunk
      });
    } catch (error) {
      console.warn("Falha ao gravar pedaco em streaming; mantendo chunks seguintes em memoria", error);
      recState.useMemoryFallback = true;
      recState.fallbackChunks.push(blob);
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
  if (recordingState === recState) {
    recordingState = null;
    updateRecordingUi(false);
  }
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
  if (!recState.useMemoryFallback) {
    try {
      info = await invoke("recording_finish", { sessionId: recState.sessionId });
    } catch (error) {
      console.warn("Falha ao fechar o arquivo da gravacao em streaming", error);
    }
  } else {
    invoke("recording_abort", { sessionId: recState.sessionId, discard: true }).catch(() => { });
  }

  if (!info && recState.fallbackChunks.length > 0) {
    try {
      const fullBlob = new Blob(recState.fallbackChunks, { type: "video/webm" });
      const buffer = await fullBlob.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));
      if (bytes.length > 0) {
        info = await invoke("attachment_save_from_bytes", {
          userId: recState.userId,
          subDir: recState.subDir,
          fileName: recState.fileName,
          bytes
        });
      }
    } catch (fallbackErr) {
      console.warn("Falha ao salvar gravacao via fallback em memoria", fallbackErr);
    }
  }

  hideRecordingIndicator();
  if (!info) return;

  const targetUser = state.users.find(u => u.id === recState.userId) || null;
  const targetTask = targetUser?.tasks.find(t => t.id === recState.taskId) || null;
  if (!targetUser || !targetTask) {
    // Nao anexa em outra task: o arquivo fica na pasta original.
    console.warn(`Task original nao encontrada; a gravacao ficou salva em ${info.file}`);
    return;
  }

  const savedAttachment = pushAttachment(targetTask, info, recState.mode === "audio" ? "audio/webm" : "video/webm");
  if (savedAttachment) {
    showRecordedVideoToast(targetUser.id, targetTask.id, savedAttachment);
  }
}

async function mixAudioStreams(streams) {
  const liveTrackGroups = streams
    .filter(Boolean)
    .map(stream => stream.getAudioTracks().filter(track => track.readyState === "live" && track.enabled))
    .filter(tracks => tracks.length > 0);

  if (liveTrackGroups.length === 0) return { tracks: [], context: null };
  if (liveTrackGroups.length === 1) return { tracks: liveTrackGroups[0], context: null };

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { tracks: liveTrackGroups[0], context: null };

  let context = null;
  try {
    context = new AudioCtx();
    if (context.state === "suspended") {
      await context.resume().catch(() => { });
    }
    const destination = context.createMediaStreamDestination();
    liveTrackGroups.forEach(tracks => {
      const source = context.createMediaStreamSource(new MediaStream(tracks));
      source.connect(destination);
    });
    const mixedTracks = destination.stream.getAudioTracks().filter(t => t.readyState === "live");
    if (mixedTracks.length > 0) {
      return { tracks: mixedTracks, context };
    }
  } catch (err) {
    console.warn("Falha ao mixar faixas de audio; usando faixa primaria", err);
    closeAudioContext(context);
  }
  return { tracks: liveTrackGroups[0], context: null };
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

function pickRecorderMimeType(hasAudio = true) {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = hasAudio
    ? [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm"
    ]
    : [
      "video/webm;codecs=vp8",
      "video/webm;codecs=vp9",
      "video/webm"
    ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function buildRecordingFileName(ext = ".webm", prefix = "Recording") {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${prefix}-${stamp}${ext}`;
}

function updateRecordingUi(active) {
  initRecordModePopup();
  if (recordButton) {
    recordButton.classList.toggle("recording", active);
    recordButton.title = active ? "Parar gravação" : "Gravar tela ou áudio";
    recordButton.setAttribute("aria-label", active ? "Parar gravação" : "Gravar tela ou áudio");
  }
  const targetBtn = document.getElementById("recordingIndicatorTarget");
  if (targetBtn) {
    if (active && recordingState) {
      const u = state.users.find(item => item.id === recordingState.userId);
      const t = u?.tasks.find(item => item.id === recordingState.taskId);
      const uName = u?.name || recordingState.userName || "";
      const tTitle = t?.title || recordingState.taskTitle || "";
      targetBtn.textContent = `${uName} › ${tTitle}`;
      targetBtn.hidden = false;
    } else {
      targetBtn.textContent = "";
      targetBtn.hidden = true;
    }
  }
  if (active) {
    startRecordingTimer();
  } else {
    stopRecordingTimer();
  }
  renderUsersRail();
  renderUserTasks();
  renderNodes();
  syncSidebarAiSpheres();
}

let recordingIndicatorAiLoader = null;

function syncRecordingIndicatorAiIcon(mood = "listening") {
  const canvas = document.getElementById("recordingIndicatorAiSphere");
  if (!canvas) return;
  if (!recordingIndicatorAiLoader) {
    recordingIndicatorAiLoader = new GrokDodecahedronRenderer(canvas, {
      size: 18,
      speed: mood === "thinking" ? 1.6 : 1,
      intensity: 1,
      mood
    });
  } else {
    recordingIndicatorAiLoader.setState({ speed: mood === "thinking" ? 1.6 : 1 });
    recordingIndicatorAiLoader.setMood(mood);
  }
  recordingIndicatorAiLoader.start();
}

function stopRecordingIndicatorAiIcon() {
  if (recordingIndicatorAiLoader) {
    recordingIndicatorAiLoader.stop();
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
  syncRecordingIndicatorAiIcon("listening");
  const tick = () => {
    if (!recordingState) return;
    const elapsed = Math.max(0, Math.floor((Date.now() - recordingState.startedAt) / 1000));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    const label = recordingState.mode === "audio" ? "Áudio" : "Tela + Áudio";
    setRecordingIndicatorText(`${label} ${mm}:${ss}`);
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
  syncRecordingIndicatorAiIcon("thinking");
  const stopBtn = document.getElementById("recordingIndicatorStop");
  if (stopBtn) stopBtn.hidden = true;
  setRecordingIndicatorText("Saving recording...");
}

function hideRecordingIndicator() {
  stopRecordingTimer();
  stopRecordingIndicatorAiIcon();
  if (!recordingIndicator) return;
  recordingIndicator.classList.remove("saving");
  const stopBtn = document.getElementById("recordingIndicatorStop");
  if (stopBtn) stopBtn.hidden = false;
  recordingIndicator.hidden = true;
}

// ------------------------------------------------------------------
// Transcricao continua em 1 clique no card via Google Gemini AI.
// Clicou no icone de IA do card -> comeca imediatamente a ouvir e transcrever
// no proprio card em tempo real (a cada intervalo + ao clicar novamente para parar).
// ------------------------------------------------------------------
const GEMINI_API_KEY_STORAGE = "todocompanion.settings.geminiApiKey";
const DEFAULT_ENV_GEMINI_KEY = "";
const DEFAULT_ENV_GEMINI_MODEL = "gemini-2.5-flash-lite";
const LIVE_TRANSCRIBE_INTERVAL_MS = 3800;

let transcribeState = null;
let cardAnalyzingState = null;
let isStartingTranscription = false;

function extractCardMediaInfo(node) {
  const content = String(getNodeContent(node) || "");
  const match = content.match(/!\[(video|audio)\]\(([^)\n]+)\)/);
  if (!match) return null;
  const kind = match[1];
  const mediaRef = match[2].trim();
  const slashIdx = mediaRef.indexOf("/");
  if (slashIdx <= 0) return null;
  return {
    kind,
    mediaRef,
    userId: mediaRef.slice(0, slashIdx),
    file: mediaRef.slice(slashIdx + 1)
  };
}

let cardMediaAskSeq = 0;
let activeFloatingMediaAskBar = null;

function closeFloatingMediaAskBar() {
  if (activeFloatingMediaAskBar) {
    activeFloatingMediaAskBar.remove();
    activeFloatingMediaAskBar = null;
  }
}

document.addEventListener("pointerdown", ev => {
  if (
    activeFloatingMediaAskBar &&
    !activeFloatingMediaAskBar.contains(ev.target) &&
    !ev.target.closest?.(".card-inline-media-ai")
  ) {
    closeFloatingMediaAskBar();
  }
});

document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && activeFloatingMediaAskBar) {
    closeFloatingMediaAskBar();
  }
});

function openFloatingMediaAskBar(anchorBtn, node, mediaInfo) {
  const prevAnchor = activeFloatingMediaAskBar?._anchorBtn || null;
  closeFloatingMediaAskBar();
  if (prevAnchor === anchorBtn) return;

  const isVideo = mediaInfo.kind === "video";
  const placeholder = "Chat com IA";

  const form = document.createElement("form");
  form.className = "card-media-ask-bar floating-media-ask-bar";
  form._anchorBtn = anchorBtn;
  form.innerHTML = `
    ${isVideo ? `<button class="card-media-mode-btn" type="button" data-audio-only="false" title="Modo atual: Vídeo + áudio (clique para analisar apenas o áudio e economizar ~9x tokens)">Vídeo</button>` : ""}
    <textarea class="card-media-ask-input" rows="1" placeholder="${escapeAttr(placeholder)}" autocomplete="off"></textarea>
    <button class="card-media-ask-send" type="submit" title="Enviar pergunta (Enter · Shift+Enter nova linha)" aria-label="Enviar pergunta" disabled>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
    </button>
  `;

  document.body.appendChild(form);
  activeFloatingMediaAskBar = form;

  const rect = anchorBtn.getBoundingClientRect();
  const barWidth = Math.min(340, window.innerWidth - 24);
  form.style.width = `${barWidth}px`;
  const left = Math.max(12, Math.min(rect.right - barWidth, window.innerWidth - barWidth - 12));
  const positionBar = () => {
    const barHeight = form.offsetHeight || 44;
    const top = rect.bottom + 8 + barHeight > window.innerHeight
      ? Math.max(12, rect.top - barHeight - 8)
      : rect.bottom + 8;
    form.style.left = `${Math.round(left)}px`;
    form.style.top = `${Math.round(top)}px`;
  };
  positionBar();

  const inputEl = form.querySelector(".card-media-ask-input");
  const sendBtn = form.querySelector(".card-media-ask-send");
  const modeBtn = form.querySelector(".card-media-mode-btn");

  const autoResizeInput = () => {
    if (!inputEl) return;
    inputEl.style.height = "auto";
    const nextH = Math.min(120, Math.max(28, inputEl.scrollHeight));
    inputEl.style.height = `${nextH}px`;
    inputEl.style.overflowY = inputEl.scrollHeight > 120 ? "auto" : "hidden";
    positionBar();
  };

  modeBtn?.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const nextAudioOnly = modeBtn.dataset.audioOnly !== "true";
    modeBtn.dataset.audioOnly = nextAudioOnly ? "true" : "false";
    modeBtn.classList.toggle("is-audio-only", nextAudioOnly);
    modeBtn.textContent = nextAudioOnly ? "Só áudio" : "Vídeo";
    modeBtn.title = nextAudioOnly
      ? "Modo atual: Apenas áudio (~9x menos tokens · clique para incluir vídeo)"
      : "Modo atual: Vídeo + áudio (clique para analisar apenas o áudio e economizar ~9x tokens)";
    inputEl?.focus();
  });

  inputEl?.addEventListener("input", () => {
    if (sendBtn) sendBtn.disabled = !String(inputEl.value || "").trim();
    autoResizeInput();
  });

  inputEl?.addEventListener("keydown", ev => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      if (String(inputEl.value || "").trim()) {
        form.requestSubmit();
      }
    }
  });

  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    ev.stopPropagation();
    const q = String(inputEl?.value || "").trim();
    if (!q || cardAnalyzingState) return;
    const audioOnly = modeBtn?.dataset.audioOnly === "true";
    closeFloatingMediaAskBar();
    await askAiAboutCardMedia(node, mediaInfo, q, { audioOnly });
  });

  inputEl?.focus();
}

function syncCardMediaAskBarUi() {
  closeFloatingMediaAskBar();
}

function stopActiveCardMediaAsk(nodeId) {
  if (!cardAnalyzingState || cardAnalyzingState.targetNodeId !== nodeId) return;
  cardMediaAskSeq += 1;
  cardAnalyzingState = null;
  syncCardMediaAiSpheres();
  syncCardMediaAskBarUi(nodeId, false);
  renderUsersRail();
  renderUserTasks();
}

async function askAiAboutCardMedia(node, mediaInfo, question, { audioOnly = false } = {}) {
  if (!invoke || !node || !mediaInfo || !question) return;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;

  const requestId = ++cardMediaAskSeq;
  const mediaKey =
    mediaInfo.mediaKey ||
    (mediaInfo.kind === "image"
      ? mediaInfo.imageDataUrl || ""
      : `${mediaInfo.userId || ""}/${mediaInfo.file || ""}`);
  cardAnalyzingState = {
    userId: user.id,
    taskId: task.id,
    targetNodeId: node.id,
    mediaKey,
    requestId
  };
  syncCardMediaAiSpheres();
  syncCardMediaAskBarUi(node.id, true);
  renderUsersRail();
  renderUserTasks();

  try {
    const cardContext = String(getNodeContent(node) || "")
      .replace(/!\[(video|audio|image)\]\([^)\n]+\)/g, "")
      .replace(/<[^>]+>/g, " ")
      .trim();
    const res = await invoke("ask_ai_about_media", {
      userId: mediaInfo.userId || "",
      file: mediaInfo.file || "",
      question,
      mediaKind: mediaInfo.kind || null,
      cardContext: cardContext || null,
      apiKey: getGeminiApiKey() || null,
      audioOnly: Boolean(audioOnly),
      imageDataUrl: mediaInfo.imageDataUrl || null
    });
    if (requestId !== cardMediaAskSeq) return;
    const answerText = String(res?.text || "").trim();
    const usedTokens = Number(res?.total_tokens) || 0;
    if (answerText) {
      const formatted = `<b>Pergunta:</b> ${escapeHtml(question)}\n${answerText}`;
      insertTranscriptionIntoBoard(
        { userId: user.id, taskId: task.id, targetNodeId: node.id },
        formatted,
        usedTokens
      );
    }
  } catch (err) {
    if (requestId !== cardMediaAskSeq) return;
    console.warn("Falha ao perguntar à IA sobre o vídeo/áudio:", err);
    insertTranscriptionIntoBoard(
      { userId: user.id, taskId: task.id, targetNodeId: node.id },
      `<b>Erro IA:</b> ${escapeHtml(String(err?.message || err))}`,
      0
    );
  } finally {
    if (requestId === cardMediaAskSeq) {
      if (cardAnalyzingState?.targetNodeId === node.id) {
        cardAnalyzingState = null;
      }
      syncCardMediaAiSpheres();
      syncCardMediaAskBarUi(node.id, false);
      renderUsersRail();
      renderUserTasks();
    }
  }
}

function formatEstimatedAudioTokens(ms) {
  const secs = Math.max(1, Math.floor((Number(ms) || 0) / 1000));
  const est = secs * 32 + 220;
  return est >= 1000 ? `~${(est / 1000).toFixed(1)}k tok` : `~${est} tok`;
}

function getGeminiApiKey() {
  return (localStorage.getItem(GEMINI_API_KEY_STORAGE) || "").trim() || DEFAULT_ENV_GEMINI_KEY;
}

function handleTranscribeTriggerClick(event, targetNodeId = null) {
  event?.stopPropagation();
  if (!targetNodeId) return;

  if (cardAnalyzingState?.targetNodeId === targetNodeId) {
    return;
  }

  if (transcribeState) {
    if (Date.now() - transcribeState.startedAt < 400) return;
    const wasSameCard = transcribeState.targetNodeId === targetNodeId;
    stopAudioTranscription();
    if (!wasSameCard && !cardAnalyzingState) {
      startAudioTranscription(targetNodeId);
    }
    return;
  }

  if (recordingState || isStartingRecording || isStartingTranscription || cardAnalyzingState) {
    return;
  }

  startAudioTranscription(targetNodeId);
}

function pickAudioRecorderMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function createSegmentRecorder(stream, mimeType, onBlobReady) {
  if (!stream) return null;
  let rec = null;
  try {
    rec = mimeType
      ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: RECORDING_AUDIO_BPS })
      : new MediaRecorder(stream);
  } catch (_) {
    try {
      rec = new MediaRecorder(stream);
    } catch (err) {
      return null;
    }
  }
  const segChunks = [];
  rec.addEventListener("dataavailable", e => {
    if (e.data && e.data.size > 0) segChunks.push(e.data);
  });
  rec.addEventListener("stop", () => {
    if (segChunks.length > 0) {
      const cleanMime = String(rec.mimeType || mimeType || "audio/webm").split(";")[0].trim() || "audio/webm";
      const blob = new Blob(segChunks, { type: cleanMime });
      onBlobReady(blob, cleanMime);
    } else {
      onBlobReady(null, "audio/webm");
    }
  });
  try {
    rec.start();
    return rec;
  } catch (_) {
    return null;
  }
}

async function startAudioTranscription(targetNodeId) {
  if (!targetNodeId || transcribeState || recordingState || isStartingTranscription) return;

  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;

  isStartingTranscription = true;
  let nativeCaptureStarted = false;
  let micStream = null;

  try {
    // 1. Captura nativa em Rust (WASAPI Loopback do PC/Videos + Microfone simultaneos sem popup)
    if (invoke) {
      try {
        await invoke("ai_audio_capture_start");
        nativeCaptureStarted = true;
      } catch (err) {
        console.warn("Captura nativa WASAPI indisponivel; usando WebView2", err);
      }
    }

    // 2. Fallback WebView2 caso o binario Rust ainda nao tenha sido reiniciado
    if (!nativeCaptureStarted) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
      } catch (err) {
        console.info("Microfone WebView2 indisponivel", err);
      }
    }

    const liveAudioTracks = micStream
      ? micStream.getAudioTracks().filter(t => t.readyState === "live" && t.enabled)
      : [];

    if (!nativeCaptureStarted && !liveAudioTracks.length) {
      stopAllTracks([micStream]);
      return;
    }

    const audioStream = liveAudioTracks.length ? new MediaStream(liveAudioTracks) : null;
    const mimeType = pickAudioRecorderMimeType();

    const tState = {
      nativeCaptureStarted,
      audioStream,
      micStream,
      mimeType,
      activeRecorder: null,
      recordedBlobPromise: null,
      intervalId: null,
      meterIntervalId: null,
      userId: user.id,
      taskId: task.id,
      taskTitle: task.title || "Gravação de Áudio",
      targetNodeId,
      startedAt: Date.now(),
      totalTokens: 0,
      stopped: false
    };

    if (!nativeCaptureStarted && audioStream) {
      tState.recordedBlobPromise = new Promise(resolve => {
        tState.activeRecorder = createSegmentRecorder(audioStream, mimeType, (blob, cleanMime) => {
          resolve({ blob, cleanMime });
        });
      });
    }

    tState.intervalId = window.setInterval(() => {
      if (transcribeState !== tState || tState.stopped) return;
      updateTranscribeUi(true, tState.targetNodeId, false, tState.startedAt);
    }, 500);

    if (nativeCaptureStarted && invoke) {
      tState.meterIntervalId = window.setInterval(async () => {
        if (transcribeState !== tState || tState.stopped) return;
        try {
          const level = Number(await invoke("ai_audio_capture_level")) || 0;
          updateCardAudioMeterLevel(tState.targetNodeId, level);
        } catch (_) { }
      }, 85);
    }

    transcribeState = tState;
    updateTranscribeUi(true, targetNodeId, false, tState.startedAt);
    renderUsersRail();
    renderUserTasks();
  } finally {
    isStartingTranscription = false;
  }
}

function flushLiveAudioSegment(tState, isFinalStop = false) {
  if (tState.nativeCaptureStarted) {
    queueSegmentTranscription(tState, isFinalStop, null, "audio/wav");
    return;
  }

  const prevRecorder = tState.activeRecorder;
  if (!isFinalStop && tState.audioStream) {
    tState.activeRecorder = createSegmentRecorder(tState.audioStream, tState.mimeType, (blob, cleanMime) => {
      queueSegmentTranscription(tState, false, blob, cleanMime);
    });
  } else {
    tState.activeRecorder = null;
  }

  if (prevRecorder && prevRecorder.state !== "inactive") {
    try {
      prevRecorder.stop();
    } catch (_) { }
  }
}

function queueSegmentTranscription(tState, isFinalStop, jsBlob = null, cleanMime = "audio/webm") {
  tState.flushChain = tState.flushChain.then(async () => {
    try {
      let base64Audio = "";
      if (jsBlob && jsBlob.size >= 512) {
        base64Audio = await blobToBase64(jsBlob);
      }

      let transcript = "";
      let chunkTokens = 0;
      if (tState.nativeCaptureStarted && invoke) {
        const res = await invoke("ai_audio_capture_flush_and_transcribe", {
          stop: isFinalStop,
          fallbackMimeType: cleanMime,
          fallbackAudioBase64: base64Audio || null
        });
        if (res && typeof res === "object") {
          transcript = String(res.text || "");
          chunkTokens = Number(res.total_tokens) || 0;
        } else {
          transcript = String(res || "");
        }
      } else if (base64Audio) {
        transcript = await requestGeminiTranscription(getGeminiApiKey(), cleanMime, base64Audio);
      }

      if (chunkTokens > 0) {
        tState.totalTokens = (tState.totalTokens || 0) + chunkTokens;
        if (transcribeState === tState) {
          updateTranscribeUi(true, tState.targetNodeId, tState.totalTokens);
        }
      }

      const cleaned = String(transcript || "").trim();
      if (cleaned) {
        insertTranscriptionIntoBoard(tState, cleaned);
      }
    } catch (err) {
      console.warn("Falha ao transcrever trecho de audio", err);
    }
  });
}

async function stopAudioTranscription() {
  const tState = transcribeState;
  if (!tState || tState.stopped) return;
  tState.stopped = true;
  transcribeState = null;

  if (tState.intervalId) {
    window.clearInterval(tState.intervalId);
    tState.intervalId = null;
  }
  if (tState.meterIntervalId) {
    window.clearInterval(tState.meterIntervalId);
    tState.meterIntervalId = null;
  }

  updateCardAudioMeterLevel(tState.targetNodeId, 0);
  cardAnalyzingState = {
    userId: tState.userId,
    taskId: tState.taskId,
    targetNodeId: tState.targetNodeId
  };
  updateTranscribeUi(false, tState.targetNodeId, true);
  renderUsersRail();
  renderUserTasks();

  try {
    let fallbackMime = "audio/webm";
    let fallbackBase64 = null;

    if (!tState.nativeCaptureStarted && tState.activeRecorder) {
      if (tState.activeRecorder.state !== "inactive") {
        try {
          tState.activeRecorder.stop();
        } catch (_) { }
      }
      const recorded = tState.recordedBlobPromise ? await tState.recordedBlobPromise : null;
      if (recorded?.blob && recorded.blob.size >= 512) {
        fallbackMime = recorded.cleanMime || "audio/webm";
        fallbackBase64 = await blobToBase64(recorded.blob);
      }
    }

    let analysisText = "";
    let usedTokens = 0;
    if (invoke) {
      const res = await invoke("ai_audio_capture_stop_and_analyze", {
        apiKey: getGeminiApiKey() || null,
        title: tState.taskTitle || "Gravação de Áudio",
        fallbackMimeType: fallbackMime,
        fallbackAudioBase64: fallbackBase64
      });
      if (res && typeof res === "object") {
        analysisText = String(res.text || "");
        usedTokens = Number(res.total_tokens) || 0;
      } else {
        analysisText = String(res || "");
      }
    } else if (fallbackBase64) {
      analysisText = await requestGeminiTranscription(getGeminiApiKey(), fallbackMime, fallbackBase64);
    }

    const cleaned = String(analysisText || "").trim();
    if (cleaned) {
      insertTranscriptionIntoBoard(tState, cleaned, usedTokens);
    }
  } catch (err) {
    console.warn("Falha ao analisar e transcrever áudio do card", err);
  } finally {
    stopAllTracks([tState.micStream]);
    if (cardAnalyzingState?.targetNodeId === tState.targetNodeId) {
      cardAnalyzingState = null;
    }
    updateTranscribeUi(false, tState.targetNodeId, false);
    renderUsersRail();
    renderUserTasks();
  }
}

async function requestGeminiTranscription(apiKey, mimeType, audioBase64) {
  if (invoke) {
    try {
      const text = await invoke("transcribe_audio_gemini", {
        apiKey: apiKey || null,
        mimeType,
        audioBase64
      });
      if (typeof text === "string") {
        return text;
      }
    } catch (rustErr) {
      console.warn("Fallback para fetch no browser apos erro no backend Rust", rustErr);
    }
  }

  const prompt =
    "Transcreva fielmente todo o áudio a seguir no idioma original falado.\n" +
    "Regras obrigatórias:\n" +
    "1. Diferencie quem está falando (diarização de locutores). Sempre que houver mais de uma pessoa falando (por exemplo, diálogo entre pessoas, reunião ou vídeo com diferentes vozes), identifique cada fala em uma nova linha colocando o identificador do locutor no início, como 'Locutor 1:', 'Locutor 2:' (ou o nome real da pessoa se for mencionado no áudio).\n" +
    "2. Se houver apenas uma única pessoa falando durante todo o áudio, transcreva o texto diretamente com pontuação adequada e parágrafos claros.\n" +
    "3. Retorne APENAS a transcrição pronta, sem introduções, sem títulos e sem comentários extras. Se não houver fala audível, retorne apenas uma string vazia.";

  const models = [DEFAULT_ENV_GEMINI_MODEL, "gemini-2.5-flash-lite", "gemini-flash-latest"];
  const keyToUse = apiKey || DEFAULT_ENV_GEMINI_KEY;
  let lastError = new Error("Could not reach Gemini API");

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(keyToUse)}`;
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: audioBase64
                  }
                }
              ]
            }
          ],
          generationConfig: { temperature: 0.1 }
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        lastError = new Error(`Gemini HTTP ${resp.status}: ${errText}`);
        if (resp.status === 401 || resp.status === 403) {
          throw lastError;
        }
        continue;
      }

      const data = await resp.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      return parts
        .map(p => (typeof p.text === "string" ? p.text.trim() : ""))
        .filter(Boolean)
        .join("\n");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError;
}

function insertTranscriptionIntoBoard(tState, transcriptText, usedTokens = 0) {
  const targetUser = state.users.find(u => u.id === tState.userId) || activeUser();
  const targetBoard = targetUser?.tasks.find(t => t.id === tState.taskId) || activeBoard();
  if (!targetBoard) return;

  const node = tState.targetNodeId
    ? targetBoard.nodes.find(n => n.id === tState.targetNodeId)
    : null;
  if (!node) return;

  const cardEl = nodesLayer.querySelector(`[data-id="${node.id}"]`);
  const editor = cardEl?.querySelector(".card-body");
  if (editor && document.activeElement === editor) {
    setNodeContent(node, serializeEditableContent(editor));
  }

  const existing = String(getNodeContent(node) || "").trim();
  const tokCount = Number(usedTokens) || 0;
  const tokLabel = tokCount > 0
    ? `\n<i>· ${tokCount >= 1000 ? `${(tokCount / 1000).toFixed(1)}k` : tokCount} tok</i>`
    : "";
  const entryText = `${transcriptText}${tokLabel}`;
  const combined = existing ? `${existing}\n${entryText}` : entryText;
  setNodeContent(node, combined);
  if (usedTokens > 0) {
    node.aiTranscribeTokens = (Number(node.aiTranscribeTokens) || 0) + usedTokens;
  }

  saveState();
  if (editor) {
    editor.innerHTML = renderBodyHtml(getNodeContent(node));
    scheduleNodeHeightSync(node.id, cardEl);
    if (usedTokens > 0) {
      renderNodes();
      renderLinks();
    }
  } else {
    renderNodes();
    renderLinks();
  }
}

function updateCardAudioMeterLevel(targetNodeId, level) {
  if (!targetNodeId) return;
  const card = nodesLayer?.querySelector(`[data-id="${targetNodeId}"]`);
  const meter = card?.querySelector(".card-transcribe-btn .card-audio-meter");
  if (!meter) return;
  const raw = Math.max(0, Math.min(1, Number(level) || 0));
  const boosted = Math.pow(raw, 0.72);
  const t = performance.now() * 0.009;
  const wave1 = 0.5 + 0.5 * Math.sin(t);
  const wave2 = 0.5 + 0.5 * Math.sin(t * 1.25 + 1.3);
  const wave3 = 0.5 + 0.5 * Math.sin(t * 0.95 + 2.6);

  const b1 = Math.round(3 + boosted * (4.5 + wave1 * 2.5) + (1 - boosted) * wave1 * 1.2);
  const b2 = Math.round(4 + boosted * (5.5 + wave2 * 2.5) + (1 - boosted) * wave2 * 1.6);
  const b3 = Math.round(3 + boosted * (4.5 + wave3 * 2.5) + (1 - boosted) * wave3 * 1.2);

  const bars = meter.querySelectorAll(".meter-bar");
  if (bars[0]) bars[0].style.height = `${Math.min(10, b1)}px`;
  if (bars[1]) bars[1].style.height = `${Math.min(12, b2)}px`;
  if (bars[2]) bars[2].style.height = `${Math.min(10, b3)}px`;
}

const AI_CARD_ANALYZING_PHRASES = [
  "Analyzing media...",
  "Listening carefully...",
  "Extracting key details...",
  "Structuring response...",
  "Finalizing answer..."
];

let cardAnalyzingSphereLoader = null;
let cardAnalyzingCanvasRef = null;
const cardAnalyzingPhraseCycler = new ThinkingPhraseCycler(AI_CARD_ANALYZING_PHRASES, {
  intervalMs: 3600,
  startRandom: false,
  loop: false
});

function syncCardAnalyzingIndicator(targetNodeId = null) {
  const activeId = targetNodeId || cardAnalyzingState?.targetNodeId || null;
  if (!activeId) {
    if (cardAnalyzingSphereLoader) {
      cardAnalyzingSphereLoader.stop();
      cardAnalyzingSphereLoader = null;
      cardAnalyzingCanvasRef = null;
    }
    cardAnalyzingPhraseCycler.stop();
    return;
  }

  const cardEl = nodesLayer.querySelector(`.task-card[data-id="${activeId}"]`);
  const btn = cardEl?.querySelector(".card-transcribe-btn.analyzing") || null;
  const canvas = btn?.querySelector(".card-analyzing-sphere") || null;
  const textEl = btn?.querySelector(".card-analyzing-text") || null;

  if (!canvas || !btn) {
    if (cardAnalyzingSphereLoader) {
      cardAnalyzingSphereLoader.stop();
      cardAnalyzingSphereLoader = null;
      cardAnalyzingCanvasRef = null;
    }
    cardAnalyzingPhraseCycler.stop();
    return;
  }

  const useEyes = getSelectedAiIconStyle() === "flat-eyes";
  btn.classList.toggle("has-ai-eyes", useEyes);

  if (cardAnalyzingCanvasRef !== canvas) {
    cardAnalyzingSphereLoader?.stop();
    cardAnalyzingCanvasRef = canvas;
    cardAnalyzingSphereLoader = new GrokDodecahedronRenderer(canvas, {
      size: 15,
      speed: 1.65,
      intensity: 1,
      mood: "thinking"
    });
    cardAnalyzingSphereLoader.start();
    if (textEl) {
      cardAnalyzingPhraseCycler.start(textEl, AI_CARD_ANALYZING_PHRASES);
    }
    if (!btn.dataset.analyzingStopHoverBound) {
      btn.dataset.analyzingStopHoverBound = "1";
      btn.addEventListener("mouseenter", () => {
        if (cardAnalyzingCanvasRef === canvas) {
          cardAnalyzingSphereLoader?.setStopMorph(true);
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (cardAnalyzingCanvasRef === canvas) {
          cardAnalyzingSphereLoader?.setStopMorph(false);
        }
      });
    }
  }
  cardAnalyzingSphereLoader?.setStopMorph(btn.matches(":hover"));
}

let cardMediaAiSphereRenderers = [];

function syncCardMediaAiSpheres() {
  cardMediaAiSphereRenderers.forEach(r => r.stop());
  cardMediaAiSphereRenderers = [];
  if (!nodesLayer) return;
  nodesLayer.querySelectorAll(".card-media-ai-sphere").forEach(canvas => {
    const btn = canvas.closest(".card-inline-media-ai");
    const cardEl = canvas.closest(".task-card");
    const cardId = cardEl?.dataset?.id || "";
    const btnKey = btn?.dataset?.mediaRef || btn?.dataset?.mediaSrc || "";
    const isThisAnalyzing = Boolean(
      cardAnalyzingState &&
      cardAnalyzingState.targetNodeId === cardId &&
      cardAnalyzingState.mediaKey &&
      cardAnalyzingState.mediaKey === btnKey
    );

    if (btn) {
      btn.classList.toggle("is-analyzing", isThisAnalyzing);
      if (isThisAnalyzing) {
        if (!btn.dataset.idleTitle) btn.dataset.idleTitle = btn.title || "";
        btn.title = "Analisando... (clique para parar)";
      } else if (btn.dataset.idleTitle) {
        btn.title = btn.dataset.idleTitle;
      }
    }

    const renderer = isThisAnalyzing
      ? new GrokDodecahedronRenderer(canvas, {
        size: 16,
        speed: 1.75,
        intensity: 1,
        mood: "thinking",
        monochrome: false,
        subtle: false
      })
      : new GrokDodecahedronRenderer(canvas, {
        size: 16,
        speed: 0.45,
        intensity: 0.78,
        monochrome: true,
        subtle: true
      });

    if (isThisAnalyzing && btn) {
      if (btn._analyzingEnter) btn.removeEventListener("pointerenter", btn._analyzingEnter);
      if (btn._analyzingLeave) btn.removeEventListener("pointerleave", btn._analyzingLeave);
      btn._analyzingEnter = () => renderer.setStopMorph(true);
      btn._analyzingLeave = () => renderer.setStopMorph(false);
      btn.addEventListener("pointerenter", btn._analyzingEnter);
      btn.addEventListener("pointerleave", btn._analyzingLeave);
      renderer.setStopMorph(btn.matches(":hover"));
    }

    renderer.start();
    cardMediaAiSphereRenderers.push(renderer);
  });
}

let cardRecordingSphereLoader = null;
let cardRecordingCanvasRef = null;
let cardRecordingBtnRef = null;

function syncCardRecordingIndicator(targetNodeId = null) {
  const activeId = targetNodeId || transcribeState?.targetNodeId || null;
  const useEyes = getSelectedAiIconStyle() === "flat-eyes";
  if (!activeId || !nodesLayer || !useEyes) {
    if (cardRecordingSphereLoader) {
      cardRecordingSphereLoader.stop();
      cardRecordingSphereLoader = null;
      cardRecordingCanvasRef = null;
      cardRecordingBtnRef = null;
    }
    return;
  }

  const cardEl = nodesLayer.querySelector(`.task-card[data-id="${activeId}"]`);
  const btn = cardEl?.querySelector(".card-transcribe-btn.recording") || null;
  const canvas = btn?.querySelector(".card-recording-sphere") || null;

  if (!canvas || !btn) {
    if (cardRecordingSphereLoader) {
      cardRecordingSphereLoader.stop();
      cardRecordingSphereLoader = null;
      cardRecordingCanvasRef = null;
      cardRecordingBtnRef = null;
    }
    return;
  }

  btn.classList.add("has-ai-eyes");

  if (cardRecordingCanvasRef !== canvas) {
    cardRecordingSphereLoader?.stop();
    cardRecordingCanvasRef = canvas;
    cardRecordingBtnRef = btn;
    cardRecordingSphereLoader = new GrokDodecahedronRenderer(canvas, {
      size: 15,
      speed: 1,
      intensity: 1,
      mood: "listening"
    });
    cardRecordingSphereLoader.start();
    if (!btn.dataset.eyesStopHoverBound) {
      btn.dataset.eyesStopHoverBound = "1";
      btn.addEventListener("mouseenter", () => {
        if (cardRecordingBtnRef === btn) {
          cardRecordingSphereLoader?.setStopMorph(true);
        }
      });
      btn.addEventListener("mouseleave", () => {
        if (cardRecordingBtnRef === btn) {
          cardRecordingSphereLoader?.setStopMorph(false);
        }
      });
    }
  }
  cardRecordingSphereLoader?.setStopMorph(btn.matches(":hover"));
}

function updateTranscribeUi(active, targetNodeId = null, analyzing = false, startedAt = 0) {
  const useEyes = getSelectedAiIconStyle() === "flat-eyes";
  document.querySelectorAll(".card-transcribe-btn").forEach(btn => {
    const card = btn.closest(".task-card");
    const isTarget = Boolean(card && card.dataset.id === targetNodeId);
    const isRec = Boolean(active && isTarget);
    const isAna = Boolean(analyzing && isTarget);
    btn.classList.toggle("recording", isRec);
    btn.classList.toggle("analyzing", isAna);
    btn.classList.toggle("has-ai-eyes", isRec && useEyes);
    const tokEl = btn.querySelector(".card-transcribe-tokens");
    if (tokEl) {
      tokEl.textContent = isRec && startedAt ? formatEstimatedAudioTokens(Date.now() - startedAt) : "";
    }
    btn.title = isAna
      ? "Parar análise da IA"
      : isRec
        ? "Finalizar gravação e enviar para análise da IA"
        : "Gravar áudio (PC e microfone) para análise e transcrição com IA";
  });
  syncCardRecordingIndicator(active ? targetNodeId : null);
  syncCardAnalyzingIndicator(analyzing ? targetNodeId : null);
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

  const onEnter = event => {
    if (aiChatBridge?.isPointInside(event?.payload?.position)) {
      setDropOverlay(false);
      aiChatBridge.setDropOverlay(true);
      return;
    }
    setDropOverlay(Boolean(activeBoard()));
  };
  const onOver = event => {
    const pos = event.payload?.position;
    if (aiChatBridge?.isPointInside(pos)) {
      setDropOverlay(false);
      aiChatBridge.setDropOverlay(true);
      return;
    }
    aiChatBridge?.setDropOverlay(false);

    if (!activeBoard()) {
      setDropOverlay(false);
      return;
    }
    const scale = window.devicePixelRatio || 1;
    const px = Number(pos?.x || 0) / scale;
    const py = Number(pos?.y || 0) / scale;
    const inside = isPointInsideBoardShell(pos);

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
  const onLeave = () => {
    setDropOverlay(false);
    aiChatBridge?.setDropOverlay(false);
  };
  const onDrop = async event => {
    const targetCardId = dropOverCardId;
    const pos = event.payload?.position;
    setDropOverlay(false);
    aiChatBridge?.setDropOverlay(false);
    const paths = event.payload?.paths || [];
    if (!paths.length) return;

    if (aiChatBridge?.isPointInside(pos)) {
      await aiChatBridge.addPaths(paths);
      return;
    }

    if (!activeBoard()) return;
    if (!isPointInsideBoardShell(pos)) return;

    if (targetCardId) {
      const board = activeBoard();
      const node = board.nodes.find(n => n.id === targetCardId);
      if (node) {
        const cardEl = nodesLayer.querySelector(`.task-card[data-id="${targetCardId}"]`);
        for (const path of paths) {
          try {
            if ((isVideoFileName(path) || isAudioFileName(path)) && node.type !== "image") {
              await attachMediaPathToCard(node, cardEl, path);
              continue;
            }
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
          } catch (e) {
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

function inferMimeFromFileName(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  const map = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    ogv: "video/ogg",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    aac: "audio/aac",
    flac: "audio/flac",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf"
  };
  return map[ext] || "";
}

function updateCardReferencesForRenamedAttachment(task, userId, oldFile, newFile, attId, newName) {
  if (!task?.nodes?.length) return false;
  const oldMediaRef = `${userId}/${oldFile}`;
  const newMediaRef = `${userId}/${newFile}`;
  const safeLabel = String(newName || "anexo")
    .replaceAll("]", ")")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim() || "anexo";
  const escapedId = String(attId || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const chipPattern = escapedId
    ? new RegExp(`@\\[[^\\]\\r\\n]+\\]\\(attachment:${escapedId}\\)`, "g")
    : null;

  let nodesChanged = false;
  task.nodes.forEach(node => {
    const content = getNodeContent(node);
    if (!content) return;
    let updated = content;
    if (oldFile && newFile && oldFile !== newFile) {
      updated = updated
        .replaceAll(`![video](${oldMediaRef})`, `![video](${newMediaRef})`)
        .replaceAll(`![audio](${oldMediaRef})`, `![audio](${newMediaRef})`);
    }
    if (chipPattern) {
      updated = updated.replace(chipPattern, `@[${safeLabel}](attachment:${attId})`);
    }
    if (updated !== content) {
      setNodeContent(node, updated);
      nodesChanged = true;
    }
  });
  return nodesChanged;
}

let isSyncingAttachments = false;

async function syncActiveTaskAttachmentsWithDisk() {
  if (!invoke || isSyncingAttachments) return false;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return false;

  isSyncingAttachments = true;
  try {
    const subDir = `task${task.number}/anexos`;
    const diskEntries = await invoke("attachment_list_dir", {
      userId: user.id,
      subDir
    });
    if (!Array.isArray(diskEntries)) return false;

    task.attachments = task.attachments || [];
    const diskByFile = new Map(diskEntries.map(item => [item.file, item]));
    const matchedDiskFiles = new Set();
    const missingAttachments = [];
    let stateChanged = false;
    let nodesChanged = false;

    for (const att of task.attachments) {
      const diskItem = diskByFile.get(att.file);
      if (diskItem) {
        matchedDiskFiles.add(diskItem.file);
        if (att.name !== diskItem.original_name) {
          att.name = diskItem.original_name;
          if (updateCardReferencesForRenamedAttachment(task, user.id, att.file, att.file, att.id, att.name)) {
            nodesChanged = true;
          }
          stateChanged = true;
        }
        if (att.size !== diskItem.size) {
          att.size = diskItem.size;
          stateChanged = true;
        }
        if (!att.type) {
          const inferred = inferMimeFromFileName(diskItem.original_name);
          if (inferred) {
            att.type = inferred;
            stateChanged = true;
          }
        }
      } else {
        missingAttachments.push(att);
      }
    }

    const unmatchedDisk = diskEntries.filter(item => !matchedDiskFiles.has(item.file));

    // Se um arquivo foi renomeado manualmente na pasta (mesmo tamanho, correspondencia 1-para-1), preserva o anexo e atualiza referencias nos cards
    const adoptedDiskFiles = new Set();
    const removedAttachmentIds = new Set();
    for (const missing of missingAttachments) {
      const sameSizeCandidates = unmatchedDisk.filter(
        d => !adoptedDiskFiles.has(d.file) && d.size === missing.size
      );
      if (sameSizeCandidates.length === 1) {
        const renamedDisk = sameSizeCandidates[0];
        const oldFile = missing.file;
        missing.file = renamedDisk.file;
        missing.name = renamedDisk.original_name;
        missing.size = renamedDisk.size;
        missing.type = inferMimeFromFileName(renamedDisk.original_name) || missing.type;
        adoptedDiskFiles.add(renamedDisk.file);
        if (updateCardReferencesForRenamedAttachment(task, user.id, oldFile, missing.file, missing.id, missing.name)) {
          nodesChanged = true;
        }
        stateChanged = true;
      } else {
        removedAttachmentIds.add(missing.id);
        stateChanged = true;
      }
    }

    if (removedAttachmentIds.size > 0) {
      task.attachments = task.attachments.filter(a => !removedAttachmentIds.has(a.id));
    }

    for (const added of unmatchedDisk) {
      if (adoptedDiskFiles.has(added.file)) continue;
      task.attachments.push({
        id: makeId("att"),
        file: added.file,
        name: added.original_name,
        size: added.size,
        type: inferMimeFromFileName(added.original_name),
        addedAt: Date.now()
      });
      stateChanged = true;
    }

    if (stateChanged) {
      saveState();
      renderUserTasks();
      updateAttachButtonState();
      if (!attachmentsPopup.hidden) {
        renderAttachmentsPopup();
      }
      if (nodesChanged) {
        renderNodes();
        renderLinks();
      }
    }
    return stateChanged;
  } catch (error) {
    console.warn("Falha ao sincronizar anexos com a pasta", error);
    return false;
  } finally {
    isSyncingAttachments = false;
  }
}

async function renameAttachment(att, rawNewName) {
  if (!invoke || !att) return false;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return false;
  const trimmed = String(rawNewName || "").trim();
  if (!trimmed || trimmed === att.name) return false;

  try {
    const oldFile = att.file;
    const info = await invoke("attachment_rename", {
      userId: user.id,
      file: oldFile,
      newName: trimmed
    });
    att.file = info.file;
    att.name = info.original_name;
    att.size = info.size;
    att.type = inferMimeFromFileName(info.original_name) || att.type;

    const nodesChanged = updateCardReferencesForRenamedAttachment(
      task,
      user.id,
      oldFile,
      att.file,
      att.id,
      att.name
    );
    saveState();
    renderUserTasks();
    renderAttachmentsPopup();
    if (nodesChanged) {
      renderNodes();
      renderLinks();
    }
    return true;
  } catch (error) {
    console.warn("Falha ao renomear anexo", error);
    alert(String(error || "Não foi possível renomear o arquivo."));
    return false;
  }
}

let activeAttachmentRowMenu = null;
let activeAttachmentMenuAnchor = null;

function closeAllAttachmentRowMenus() {
  if (activeAttachmentRowMenu?.isConnected) {
    activeAttachmentRowMenu.remove();
  }
  activeAttachmentRowMenu = null;
  activeAttachmentMenuAnchor = null;
}

function openAttachmentRowMenu(anchorBtn, row, nameEl, att) {
  if (activeAttachmentMenuAnchor === anchorBtn && activeAttachmentRowMenu?.isConnected) {
    closeAllAttachmentRowMenus();
    return;
  }
  closeAllAttachmentRowMenus();

  const menu = document.createElement("div");
  menu.className = "attachments-row-menu";
  menu.setAttribute("role", "menu");

  {
    const embedItem = document.createElement("button");
    embedItem.type = "button";
    embedItem.className = "attachments-row-menu-item";
    const mediaIcon = isAudioAttachment(att)
      ? icons.audio
      : isImageAttachment(att)
        ? icons.image
        : isVideoAttachment(att)
          ? icons.video
          : icons.file;
    embedItem.innerHTML = `${mediaIcon}<span>Colocar no card</span>`;
    embedItem.addEventListener("click", event => {
      event.stopPropagation();
      closeAllAttachmentRowMenus();
      embedMediaAttachmentIntoBoard(att);
    });
    menu.appendChild(embedItem);
  }

  if (isAudioOrVideoAttachment(att)) {
    const key = att.id || att.file;
    const busy = transcribingAttachments.has(key);
    const transcribeItem = document.createElement("button");
    transcribeItem.type = "button";
    transcribeItem.className = "attachments-row-menu-item";
    transcribeItem.disabled = busy;
    transcribeItem.innerHTML = `${icons.micAi}<span>${busy ? "Transcrevendo..." : "Transcrever com IA"}</span>`;
    transcribeItem.addEventListener("click", event => {
      event.stopPropagation();
      closeAllAttachmentRowMenus();
      transcribeAttachmentToCard(att);
    });
    menu.appendChild(transcribeItem);
  }

  const renameItem = document.createElement("button");
  renameItem.type = "button";
  renameItem.className = "attachments-row-menu-item";
  renameItem.innerHTML = `${icons.edit}<span>Renomear</span>`;
  renameItem.addEventListener("click", event => {
    event.stopPropagation();
    closeAllAttachmentRowMenus();
    startInlineAttachmentRename(row, nameEl, att);
  });
  menu.appendChild(renameItem);

  menu.style.visibility = "hidden";
  document.body.appendChild(menu);

  const btnRect = anchorBtn.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const margin = 8;

  let left = btnRect.right - menuRect.width;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuRect.width - margin));

  const spaceBelow = window.innerHeight - btnRect.bottom - margin;
  let top = spaceBelow >= menuRect.height + 4
    ? btnRect.bottom + 4
    : Math.max(margin, btnRect.top - menuRect.height - 4);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = "visible";

  activeAttachmentRowMenu = menu;
  activeAttachmentMenuAnchor = anchorBtn;
}

function startInlineAttachmentRename(row, nameEl, att) {
  if (!row || !nameEl || !att) return;
  closeAllAttachmentRowMenus();
  const existingInput = row.querySelector(".attachments-rename-input");
  if (existingInput) {
    existingInput.focus();
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "attachments-rename-input";
  input.value = att.name;
  input.setAttribute("aria-label", "Renomear anexo");

  nameEl.hidden = true;
  nameEl.parentElement.insertBefore(input, nameEl);
  input.focus();

  const dotIdx = att.name.lastIndexOf(".");
  if (dotIdx > 0) {
    input.setSelectionRange(0, dotIdx);
  } else {
    input.select();
  }

  let finished = false;
  const cleanup = () => {
    if (input.isConnected) input.remove();
    nameEl.hidden = false;
  };
  const commit = async () => {
    if (finished) return;
    finished = true;
    const nextName = input.value.trim();
    cleanup();
    if (nextName && nextName !== att.name) {
      await renameAttachment(att, nextName);
    }
  };
  const cancel = () => {
    if (finished) return;
    finished = true;
    cleanup();
  };

  input.addEventListener("pointerdown", e => e.stopPropagation());
  input.addEventListener("click", e => e.stopPropagation());
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", () => {
    commit();
  });
}

async function handleAttachButtonClick() {
  if (!attachmentsPopup.hidden) {
    closeAttachmentsPopup();
    return;
  }
  await syncActiveTaskAttachmentsWithDisk();
  if (activeTaskHasAttachments()) {
    openAttachmentsPopup();
  } else {
    canvasAttachInput.click();
  }
}

function openAttachmentsPopup() {
  if (!document.body.classList.contains("translator-floating-mode")) {
    window.toggleAiTranslatorPanel?.(false);
  }
  renderAttachmentsPopup();
  canvasAttachButton?.classList.add("active");
  attachmentsPopup.hidden = false;
  requestAnimationFrame(() => {
    attachmentsPopup.classList.add("visible");
    applyViewport();
    renderLinks();
  });
  syncActiveTaskAttachmentsWithDisk();
}

function closeAttachmentsPopup() {
  if (attachmentsPopup.hidden) return;
  closeAllAttachmentRowMenus();
  canvasAttachButton?.classList.remove("active");
  attachmentsPopup.classList.remove("visible");
  attachmentsPopup.hidden = true;
  requestAnimationFrame(() => {
    applyViewport();
    renderLinks();
  });
}

const transcribingAttachments = new Map();
const cancelledTranscribeRuns = new Set();
let transcribeRunSeq = 0;

let transcribeIndicatorBound = false;

function stopAllActiveTranscriptions() {
  transcribingAttachments.forEach(entry => {
    cancelledTranscribeRuns.add(entry.runId);
  });
  transcribingAttachments.clear();
  updateTranscribeIndicatorUi();
  renderAttachmentsPopup();
}

function updateTranscribeIndicatorUi() {
  const indicator = document.getElementById("transcribeIndicator");
  const textEl = document.getElementById("transcribeIndicatorText");
  const targetBtn = document.getElementById("transcribeIndicatorTarget");
  const stopBtn = document.getElementById("transcribeIndicatorStop");
  const activeCount = transcribingAttachments.size;
  if (!indicator) return;

  if (!transcribeIndicatorBound) {
    transcribeIndicatorBound = true;
    targetBtn?.addEventListener("click", () => {
      const first = transcribingAttachments.values().next().value;
      if (!first) return;
      const u = state.users.find(item => item.id === first.userId);
      const t = u?.tasks.find(item => item.id === first.taskId);
      if (!u || !t) return;
      state.activeUserId = u.id;
      u.activeTaskId = t.id;
      saveState();
      render();
    });
    stopBtn?.addEventListener("click", () => {
      stopAllActiveTranscriptions();
    });
  }

  if (activeCount === 0) {
    indicator.hidden = true;
    return;
  }

  const first = transcribingAttachments.values().next().value;
  if (textEl) {
    textEl.textContent =
      activeCount > 1
        ? `Transcrevendo (${activeCount})...`
        : "Transcrevendo...";
  }
  if (targetBtn && first) {
    targetBtn.textContent = `${first.userName} › ${first.taskTitle}`;
    targetBtn.hidden = false;
  }
  indicator.classList.toggle("below-recording", Boolean(recordingState));
  indicator.hidden = false;
}

function isAudioOrVideoAttachment(att) {
  if (!att) return false;
  const mime = String(att.mime || att.type || "").toLowerCase();
  if (mime.startsWith("audio/") || mime.startsWith("video/")) return true;
  const name = String(att.name || att.file || "").toLowerCase();
  return /\.(mp4|m4a|mp3|wav|webm|ogg|mov|mkv|aac|flac)$/i.test(name);
}

async function transcribeAttachmentToCard(att) {
  if (!invoke || !att) return;
  const user = activeUser();
  const task = activeMainTask();
  if (!user || !task) return;

  const key = att.id || att.file;
  if (transcribingAttachments.has(key)) return;
  const runId = ++transcribeRunSeq;
  transcribingAttachments.set(key, {
    runId,
    userId: user.id,
    userName: user.name,
    taskId: task.id,
    taskTitle: task.title,
    fileName: att.name
  });
  updateTranscribeIndicatorUi();
  renderAttachmentsPopup();

  try {
    const summaryText = await invoke("transcribe_attachment_zoom_summary", {
      userId: user.id,
      file: att.file,
      displayName: att.name || null,
      apiKey: localStorage.getItem(GEMINI_API_KEY_STORAGE) || null
    });

    if (cancelledTranscribeRuns.has(runId)) return;

    const targetUser = state.users.find(u => u.id === user.id) || user;
    const targetTask = targetUser?.tasks?.find(t => t.id === task.id) || task;
    if (!targetTask || !summaryText) return;

    const parentId = targetTask.nodes[0]?.id || null;
    const id = makeId("action");
    const w = 456;
    const h = 336;
    const rawPos = parentId ? getReplyActionPosition(targetTask, parentId) : { x: 96, y: 120 };
    const freePos = findFreeCardPosition(targetTask, rawPos.x, rawPos.y, w, h, 48);

    const newNode = {
      id,
      title: "",
      body: String(summaryText).trim(),
      status: "ongoing",
      createdAt: new Date().toISOString(),
      x: freePos.x,
      y: freePos.y,
      w,
      h
    };

    if (parentId) {
      targetTask.nodes.splice(getReplyInsertionIndex(targetTask, parentId), 0, newNode);
      targetTask.links.push({ id: makeId("link"), from: parentId, to: id, fromPort: "out", toPort: "in" });
    } else {
      targetTask.nodes.push(newNode);
    }

    if (targetTask === activeBoard()) {
      pendingCardPop.add(id);
      selectedNodeId = id;
    }

    saveState();
    render();

    if (targetTask === activeBoard()) {
      const cardEl = nodesLayer.querySelector(`[data-id="${id}"]`);
      if (cardEl) scheduleNodeHeightSync(id, cardEl);
      focusCardOnNode(id);
    }
  } catch (err) {
    if (cancelledTranscribeRuns.has(runId)) return;
    console.warn("Falha ao transcrever anexo com IA:", err);
    window.alert(`Não foi possível transcrever "${att.name}": ${String(err?.message || err)}`);
  } finally {
    cancelledTranscribeRuns.delete(runId);
    if (transcribingAttachments.get(key)?.runId === runId) {
      transcribingAttachments.delete(key);
    }
    updateTranscribeIndicatorUi();
    renderAttachmentsPopup();
  }
}

function renderAttachmentsPopup() {
  closeAllAttachmentRowMenus();
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

    row.appendChild(info);

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

    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "attachments-action attachments-more-btn";
    moreBtn.title = "Mais opções";
    moreBtn.setAttribute("aria-label", "Mais opções");
    moreBtn.innerHTML = icons.moreHorizontal;
    moreBtn.addEventListener("click", event => {
      event.stopPropagation();
      openAttachmentRowMenu(moreBtn, row, name, att);
    });

    row.appendChild(openBtn);
    row.appendChild(moreBtn);
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
  closeAllAttachmentRowMenus();
  const ok = await openConfirmDelete({
    title: `Apagar "${att.name}"`,
    message: "O arquivo será removido permanentemente da pasta de anexos. Esta ação não pode ser desfeita.",
    requireCode: false,
    confirmLabel: "Apagar"
  });
  if (!ok) return;
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

// -------------------------------------------------------------
// VISUALIZADOR DE IMAGEM EM TELA CHEIA (ZOOM & PAN INTERATIVO)
// -------------------------------------------------------------

function initImageFullscreenModal() {
  const modal = document.getElementById("imageFullscreenModal");
  const img = document.getElementById("imageFullscreenImg");
  const canvas = document.getElementById("imageFullscreenCanvas");
  const closeBtn = document.getElementById("imageFullscreenClose");
  const zoomInBtn = document.getElementById("imageFullscreenZoomIn");
  const zoomOutBtn = document.getElementById("imageFullscreenZoomOut");
  const zoomResetBtn = document.getElementById("imageFullscreenZoomReset");
  const zoomBadge = document.getElementById("imageFullscreenZoomBadge");

  if (!modal || !img || !canvas) return;

  const state = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0
  };

  function applyTransform() {
    img.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    if (zoomBadge) {
      zoomBadge.textContent = `${Math.round(state.zoom * 100)}%`;
    }
  }

  function resetZoom() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    applyTransform();
  }

  function changeZoom(factor, clientX = null, clientY = null) {
    const prevZoom = state.zoom;
    const nextZoom = clamp(prevZoom * factor, 0.4, 8.0);
    if (clientX !== null && clientY !== null) {
      const rect = canvas.getBoundingClientRect();
      const ox = clientX - rect.left - rect.width / 2;
      const oy = clientY - rect.top - rect.height / 2;
      state.panX -= (ox - state.panX) * (nextZoom / prevZoom - 1);
      state.panY -= (oy - state.panY) * (nextZoom / prevZoom - 1);
    }
    state.zoom = nextZoom;
    applyTransform();
  }

  window.openFullscreenImage = function (src) {
    if (!src) return;
    img.src = src;
    resetZoom();
    modal.hidden = false;
    document.addEventListener("keydown", onKeyDown);
  };

  function closeModal() {
    modal.hidden = true;
    img.src = "";
    document.removeEventListener("keydown", onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      closeModal();
    } else if (e.key === "+" || e.key === "=") {
      changeZoom(1.25);
    } else if (e.key === "-") {
      changeZoom(0.8);
    } else if (e.key === "0") {
      resetZoom();
    }
  }

  closeBtn?.addEventListener("click", closeModal);
  zoomInBtn?.addEventListener("click", () => changeZoom(1.25));
  zoomOutBtn?.addEventListener("click", () => changeZoom(0.8));
  zoomResetBtn?.addEventListener("click", resetZoom);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    changeZoom(factor, e.clientX, e.clientY);
  }, { passive: false });

  img.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (state.zoom > 1.05) {
      resetZoom();
    } else {
      changeZoom(2.5, e.clientX, e.clientY);
    }
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button") || e.target.closest(".image-fullscreen-bar")) return;
    if (e.target === canvas) {
      closeModal();
      return;
    }
    state.isDragging = true;
    state.dragStartX = e.clientX - state.panX;
    state.dragStartY = e.clientY - state.panY;
    canvas.classList.add("dragging");
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!state.isDragging) return;
    state.panX = e.clientX - state.dragStartX;
    state.panY = e.clientY - state.dragStartY;
    applyTransform();
  });

  const stopDrag = (e) => {
    if (state.isDragging) {
      state.isDragging = false;
      canvas.classList.remove("dragging");
      try { canvas.releasePointerCapture(e.pointerId); } catch { }
    }
  };

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);
}

function initCanvasMetaResponsive() {
  const overlay = document.getElementById("canvasMetaOverlay");
  const overflowBtn = document.getElementById("canvasMetaOverflowBtn");
  if (!overlay || !overflowBtn) return;

  function closeOverflow() {
    overlay.classList.remove("overflow-open");
    overflowBtn.setAttribute("aria-expanded", "false");
  }

  function updateLayout() {
    const width = overlay.clientWidth || 0;
    if (width <= 0) return;
    const isCompactFields = width < 760;
    const isCompactActions = width < 430;
    overlay.classList.toggle("compact-fields", isCompactFields);
    overlay.classList.toggle("compact-actions", isCompactActions);
    overflowBtn.hidden = !isCompactFields;
    if (!isCompactFields) {
      closeOverflow();
    }
  }

  overflowBtn.addEventListener("click", event => {
    event.stopPropagation();
    const nextOpen = !overlay.classList.contains("overflow-open");
    overlay.classList.toggle("overflow-open", nextOpen);
    overflowBtn.setAttribute("aria-expanded", String(nextOpen));
  });

  document.addEventListener("pointerdown", event => {
    if (overlay.classList.contains("overflow-open") && !overlay.contains(event.target)) {
      closeOverflow();
    }
  });

  if (typeof ResizeObserver !== "undefined") {
    let layoutRafId = 0;
    const scheduleLayoutUpdate = () => {
      if (layoutRafId) return;
      layoutRafId = requestAnimationFrame(() => {
        layoutRafId = 0;
        updateLayout();
      });
    };
    const ro = new ResizeObserver(scheduleLayoutUpdate);
    ro.observe(overlay);
  }
  window.addEventListener("resize", updateLayout);
  requestAnimationFrame(updateLayout);
}

// -------------------------------------------------------------
// AI TRANSLATOR & GENERAL AI CHAT (WITH ATTACHMENTS & SESSIONS)
// -------------------------------------------------------------
const AI_TONE_STORAGE_KEY = "todocompanion.ai.formality";
const AI_TRANSLATOR_MODE_STORAGE_KEY = "todocompanion.settings.translatorMode";
const AI_PANEL_WIDTH_STORAGE_KEY = "todocompanion.ai.panelWidth";
const AI_CHAT_LEGACY_STORAGE_KEY = "todocompanion.ai.chatHistory.v1";
const AI_CHAT_SESSIONS_KEY = "todocompanion.ai.chatSessions.v2";
const AI_CHAT_ACTIVE_SESSION_KEY = "todocompanion.ai.activeChatId.v2";
const AI_PANEL_DEFAULT_WIDTH = 360;
const AI_PANEL_MIN_WIDTH = 280;
const AI_PANEL_MAX_WIDTH = 780;

function describeFormalityLabel(val) {
  const num = Number(val) || 0;
  if (num <= 20) return "Very Natural";
  if (num <= 40) return "Natural";
  if (num <= 60) return "Balanced";
  if (num <= 80) return "Formal";
  return "Very Formal";
}

function isTextualAttachment(mimeType, fileName) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (
    mime.startsWith("text/") ||
    mime.includes("json") ||
    mime.includes("xml") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("yaml") ||
    mime.includes("csv") ||
    mime.includes("sql")
  ) {
    return true;
  }
  return /\.(txt|md|json|csv|tsv|log|js|ts|jsx|tsx|py|rs|cs|java|c|cpp|h|html|css|scss|sql|xml|yml|yaml|toml|ini|env|sh|bat|ps1)$/i.test(
    name
  );
}

function compressImageDataUrl(dataUrl, mimeType, maxDimension = 1440) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) {
          resolve(null);
          return;
        }
        const scale = Math.min(1, maxDimension / Math.max(w, h));
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement("canvas");
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const outMime = "image/jpeg";
        const compressedUrl = canvas.toDataURL(outMime, 0.82);
        const commaIdx = compressedUrl.indexOf(",");
        resolve({
          mime_type: outMime,
          data_base64: commaIdx >= 0 ? compressedUrl.slice(commaIdx + 1) : compressedUrl
        });
      } catch (_) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function readFileAsAttachment(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Empty file"));
      return;
    }
    const name = file.name || `attachment-${Date.now()}`;
    const mimeType = file.type || (isTextualAttachment("", name) ? "text/plain" : "application/octet-stream");

    if (isTextualAttachment(mimeType, name)) {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name,
          mime_type: mimeType,
          data_base64: "",
          text_content: String(reader.result || "").slice(0, 45000)
        });
      };
      reader.onerror = () => reject(reader.error || new Error("Failed to read text file"));
      reader.readAsText(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      const commaIdx = dataUrl.indexOf(",");
      let finalMime = mimeType;
      let base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
      if (mimeType.startsWith("image/") && mimeType !== "image/gif" && base64.length > 350000) {
        const compressed = await compressImageDataUrl(dataUrl, mimeType);
        if (compressed && compressed.data_base64.length < base64.length) {
          finalMime = compressed.mime_type;
          base64 = compressed.data_base64;
        }
      }
      resolve({
        name,
        mime_type: finalMime,
        data_base64: base64,
        text_content: ""
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read binary file"));
    reader.readAsDataURL(file);
  });
}

function inferMimeTypeFromFileName(fileName) {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  const mimeMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    pdf: "application/pdf",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    json: "application/json",
    xml: "application/xml",
    csv: "text/csv",
    md: "text/markdown",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    ts: "text/typescript"
  };
  if (mimeMap[ext]) return mimeMap[ext];
  return isTextualAttachment("", fileName) ? "text/plain" : "application/octet-stream";
}

function bytesToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = "";
  const CHUNK_SIZE = 0x8000;
  for (let i = 0; i < arr.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + CHUNK_SIZE));
  }
  return window.btoa(binary);
}

function buildAttachmentFromPathBytes(filePath, bytes) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const name = normalized.split("/").pop() || `attachment-${Date.now()}`;
  const mimeType = inferMimeTypeFromFileName(name);
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);

  if (isTextualAttachment(mimeType, name)) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return {
      name,
      mime_type: mimeType,
      data_base64: "",
      text_content: decoder.decode(arr).slice(0, 45000)
    };
  }

  return {
    name,
    mime_type: mimeType,
    data_base64: bytesToBase64(arr),
    text_content: ""
  };
}

function formatSessionTimestamp(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) {
    return "";
  }
}

function buildAutoSessionTitle(firstText, attachments = []) {
  const cleaned = String(firstText || "").replace(/\s+/g, " ").trim();
  if (cleaned) {
    return cleaned.length > 36 ? `${cleaned.slice(0, 36)}…` : cleaned;
  }
  if (attachments.length > 0) {
    return `📎 ${attachments[0].name}`;
  }
  return "New chat";
}

function renderAiMarkdownHtml(rawText) {
  const safe = escapeHtml(String(rawText || ""));
  const codeBlocks = [];
  const withCodePlaceholders = safe.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="ai-code-block"><code>${code.trim()}</code></pre>`);
    return `@@AICODEBLOCK_${idx}@@`;
  });

  const blocks = withCodePlaceholders.split(/\n{2,}/);
  const htmlBlocks = blocks.map(block => {
    const trimmed = block.trim();
    if (!trimmed) return "";
    if (/^@@AICODEBLOCK_\d+@@$/.test(trimmed)) {
      return trimmed;
    }
    const lines = trimmed.split("\n");
    const isBulletList = lines.length > 0 && lines.every(l => /^\s*[-*•]\s+/.test(l));
    if (isBulletList) {
      const items = lines
        .map(l => formatInlineMarkdown(l.replace(/^\s*[-*•]\s+/, "")))
        .map(li => `<li>${li}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${formatInlineMarkdown(trimmed)}</p>`;
  });

  let finalHtml = htmlBlocks.filter(Boolean).join("");
  codeBlocks.forEach((cb, idx) => {
    finalHtml = finalHtml.replace(`@@AICODEBLOCK_${idx}@@`, cb);
  });
  return `<div class="ai-markdown-body">${finalHtml}</div>`;
}

function formatInlineMarkdown(str) {
  return str
    .replace(/`([^`\n]+)`/g, '<code class="ai-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
}

function initAiTranslatorPanel() {
  const openTranslateBtn = document.getElementById("openAiTranslatorButton");
  const openChatBtn = document.getElementById("openAiChatButton");
  const closeBtn = document.getElementById("closeAiTranslatorButton");
  const detachTranslatorBtn = document.getElementById("aiDetachTranslatorBtn");
  const minimizeFloatingBtn = document.getElementById("aiMinimizeFloatingBtn");
  const panelHead = document.getElementById("aiPanelHead");
  const panel = document.getElementById("aiTranslatorPanel");
  const panelResizer = document.getElementById("aiPanelResizer");
  const panelTitleEl = document.getElementById("aiPanelTitle");
  const translateView = document.getElementById("aiTranslateView");
  const chatView = document.getElementById("aiChatView");
  const toneSlider = document.getElementById("aiToneSlider");
  const toneBadge = document.getElementById("aiToneBadge");

  const trInput = document.getElementById("aiTranslateInput");
  const trClearBtn = document.getElementById("aiTranslateClearBtn");
  const trRunBtn = document.getElementById("aiTranslateRunBtn");
  const trFlipDirBtn = document.getElementById("aiFlipDirBtn");
  const trInputWatermark = document.getElementById("aiInputLangWatermark");
  const trOutputWatermark = document.getElementById("aiOutputLangWatermark");
  const trOutput = document.getElementById("aiTranslateOutput");
  const trStatusDot = document.getElementById("aiTranslateStatusDot");
  const trStatusText = document.getElementById("aiTranslateStatusText");
  const trCopyBtn = document.getElementById("aiTranslateCopyBtn");

  const chatHistoryToggle = document.getElementById("aiChatHistoryToggle");
  const historyModalCloseBtn = document.getElementById("aiHistoryModalCloseBtn");
  const historySearchInput = document.getElementById("aiHistorySearchInput");
  const newChatBtn = document.getElementById("aiNewChatBtn");
  const sessionsDrawer = document.getElementById("aiChatSessionsDrawer");
  const sessionsCountEl = document.getElementById("aiChatSessionsCount");
  const sessionsListEl = document.getElementById("aiChatSessionsList");

  const chatMessagesEl = document.getElementById("aiChatMessages");
  const regularChatViewEl = document.getElementById("aiRegularChatView");
  const liveCoachViewEl = document.getElementById("aiLiveCoachView");
  const liveCoachMessagesEl = document.getElementById("aiLiveCoachMessages");
  const liveCoachThinkingCanvas = document.getElementById("aiLiveCoachThinkingCanvas");
  const chatDropOverlay = document.getElementById("aiChatDropOverlay");
  const chatForm = document.getElementById("aiChatForm");
  const chatPendingListEl = document.getElementById("aiChatPendingList");
  const chatInput = document.getElementById("aiChatInput");
  const chatFileInput = document.getElementById("aiChatFileInput");
  const chatAttachBtn = document.getElementById("aiChatAttachBtn");
  const chatSendBtn = document.getElementById("aiChatSendBtn");
  const liveCoachBtn = document.getElementById("aiLiveCoachBtn");
  const liveCoachStatusEl = document.getElementById("aiLiveCoachStatus");
  const liveCoachNowBtn = document.getElementById("aiLiveCoachNowBtn");
  const liveCoachStopBtn = document.getElementById("aiLiveCoachStopBtn");
  const liveCoachMenuTrigger = document.getElementById("aiLiveCoachMenuTrigger");
  const liveCoachMenu = document.getElementById("aiLiveCoachMenu");
  const liveCoachToneSection = document.getElementById("aiLiveCoachToneSection");
  const liveCoachModeEl = document.getElementById("aiLiveCoachMode");
  const liveCoachOutputModeEl = document.getElementById("aiLiveCoachOutputMode");
  const liveCoachTokenCountEl = document.getElementById("aiLiveCoachTokenCount");
  let liveCoachTokenTotal = 0;
  let liveCoachAdviceHistory = [];
  let liveCoachOutputMode = localStorage.getItem("todocompanion.settings.liveCoachOutputMode") === "reply"
    ? "reply"
    : "translation";
  let liveCoachMode = localStorage.getItem("todocompanion.settings.liveCoachMode") === "formal"
    ? "formal"
    : "natural";
  const chatNewPillBtn = document.getElementById("aiChatNewPill");
  let unreadBelowCount = 0;

  function updateNewPillVisibility() {
    if (!chatNewPillBtn) return;
    if (unreadBelowCount <= 0) {
      chatNewPillBtn.hidden = true;
      return;
    }
    chatNewPillBtn.textContent =
      unreadBelowCount === 1 ? "New tip ↓" : `${unreadBelowCount} new tips ↓`;
    chatNewPillBtn.hidden = false;
  }

  chatMessagesEl?.addEventListener("scroll", () => {
    if (!chatMessagesEl) return;
    const dist = chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight;
    if (dist < 40) {
      unreadBelowCount = 0;
      updateNewPillVisibility();
    }
  });
  chatNewPillBtn?.addEventListener("click", () => {
    unreadBelowCount = 0;
    updateNewPillVisibility();
    chatMessagesEl?.scrollTo({ top: chatMessagesEl.scrollHeight, behavior: "smooth" });
  });

  if (!panel) return;

  let currentMode = "translate";
  let currentDirection = "pt-en";
  let isTranslatorFloating = false;
  let formality = clamp(Number(localStorage.getItem(AI_TONE_STORAGE_KEY) ?? 40), 0, 100);
  let translateTimer = null;
  let translateSeq = 0;
  let translateInFlight = false;
  let queuedTranslation = null;
  let lastTranslatedKey = "";
  const translationCache = new Map();

  let chatSessions = [];
  let activeSessionId = "";
  let pendingAttachments = [];
  let chatBusy = false;
  let activeChatRequestId = 0;
  let chatHasUnread = false;

  const CHAT_SEND_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>`;
  const CHAT_STOP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none" /></svg>`;
  let chatSendAiLoader = null;
  let chatSendAiCanvas = null;

  function syncChatSendButtonState() {
    if (!chatSendBtn) return;
    chatSendBtn.disabled = false;
    const useEyesSend = getSelectedAiIconStyle() === "flat-eyes";
    chatSendBtn.classList.toggle("is-stop", chatBusy && !useEyesSend);
    chatSendBtn.classList.toggle("has-ai-eyes", useEyesSend);
    chatSendBtn.type = chatBusy ? "button" : "submit";
    chatSendBtn.title = chatBusy ? "Parar requisição" : "Send message (Enter)";
    chatSendBtn.setAttribute("aria-label", chatBusy ? "Parar requisição" : "Send message");

    if (useEyesSend) {
      if (!chatSendAiCanvas || !chatSendBtn.contains(chatSendAiCanvas)) {
        chatSendAiLoader?.stop();
        chatSendBtn.innerHTML = `<canvas class="ai-send-eyes-canvas" aria-hidden="true"></canvas>`;
        chatSendAiCanvas = chatSendBtn.querySelector(".ai-send-eyes-canvas");
        chatSendAiLoader = new GrokDodecahedronRenderer(chatSendAiCanvas, { size: 30, speed: 1, intensity: 1 });
        chatSendAiLoader.start();
      }
      chatSendAiLoader?.setState({ speed: chatBusy ? 1.65 : 1 });
      const isHovered = chatSendBtn.matches(":hover");
      chatSendAiLoader?.setArrowMorph(isHovered && !chatBusy);
      chatSendAiLoader?.setStopMorph(isHovered && chatBusy);
    } else {
      chatSendAiLoader?.stop();
      chatSendAiLoader = null;
      chatSendAiCanvas = null;
      chatSendBtn.innerHTML = chatBusy ? CHAT_STOP_ICON_SVG : CHAT_SEND_ICON_SVG;
    }
  }

  chatSendBtn?.addEventListener("mouseenter", () => {
    chatSendAiLoader?.setArrowMorph(!chatBusy);
    chatSendAiLoader?.setStopMorph(chatBusy);
  });
  chatSendBtn?.addEventListener("mouseleave", () => {
    chatSendAiLoader?.setArrowMorph(false);
    chatSendAiLoader?.setStopMorph(false);
  });
  chatInput?.addEventListener("input", () => {
    chatSendAiLoader?.triggerTypingPulse();
  });
  window.addEventListener("app:ai-icon-style-changed", () => {
    syncChatSendButtonState();
  });
  syncChatSendButtonState();

  function stopActiveChatRequest() {
    if (!chatBusy) return;
    activeChatRequestId += 1;
    if (activeTypingRaf) {
      cancelAnimationFrame(activeTypingRaf);
      activeTypingRaf = 0;
    }
    animatingMessageRef = null;
    chatBusy = false;
    syncChatSendButtonState();
    updateChatTopbarIndicator();
    renderChatMessages();
    if (!panel.hidden && currentMode === "chat") {
      chatInput?.focus();
    }
  }
  let animatingMessageRef = null;
  let activeTypingRaf = 0;
  let chatDropOverlayActive = false;
  let chatHtmlDragDepth = 0;

  const savedWidth = Number(localStorage.getItem(AI_PANEL_WIDTH_STORAGE_KEY));
  if (Number.isFinite(savedWidth) && savedWidth >= AI_PANEL_MIN_WIDTH && savedWidth <= AI_PANEL_MAX_WIDTH) {
    panel.style.width = `${Math.round(savedWidth)}px`;
  } else {
    panel.style.width = `${AI_PANEL_DEFAULT_WIDTH}px`;
  }

  function evaluateCanvasCompanionMood() {
    const user = activeUser();
    const tasks = user?.tasks || [];
    if (!tasks.length) return "normal";
    const todayIso = new Date().toISOString().slice(0, 10);
    const hasOverdue = tasks.some(
      t => (t.status || "ongoing") !== "complete" && t.endDate && String(t.endDate) < todayIso
    );
    if (hasOverdue) return "worried";
    const allComplete = tasks.every(t => (t.status || "ongoing") === "complete");
    if (allComplete) return "happy";
    return "normal";
  }

  const topbarGrokCanvas = document.getElementById("topbarGrokDodecahedron");
  const topbarGrokLoader = topbarGrokCanvas
    ? new GrokDodecahedronRenderer(topbarGrokCanvas, {
      size: 30,
      speed: 1,
      intensity: 0.85,
      autonomousMoods: true,
      getAmbientMood: evaluateCanvasCompanionMood
    })
    : null;
  topbarGrokLoader?.start();
  let chatGrokLoader = null;
  let liveCoachGrokLoader = null;
  let liveCoachAudioLevelTimer = 0;
  let liveCoachIsBusy = false;
  const chatThinkingCycler = new ThinkingPhraseCycler(AI_CHAT_THINKING_PHRASES, {
    intervalMs: 3800,
    startRandom: false,
    loop: false
  });
  const translateThinkingCycler = new ThinkingPhraseCycler(AI_TRANSLATOR_THINKING_PHRASES, {
    intervalMs: 3000,
    startRandom: false,
    loop: false
  });
  let activeChatThinkingSteps = AI_CHAT_THINKING_PHRASES;

  function buildChatThinkingSteps({ text = "", attachments = [], appAttachments = [], willCaptureScreen = false } = {}) {
    const steps = [];
    const hasAudioOrVideo = attachments.some(a => /^(audio|video)\//i.test(String(a?.mime_type || "")));
    const hasImage = attachments.some(a => /^image\//i.test(String(a?.mime_type || "")));
    const hasFile = attachments.length > 0;
    const hasAppFiles = appAttachments.length > 0;
    const wantsWebSearch = /https?:\/\/|\b(pesquis|busc|google|internet|notícia|noticia|hoje|atual|cotação|cotacao|preço|preco|tempo|clima|latest|search|web|online|news|price)\b/i.test(text);
    const isBoardAction = /\b(cria|crie|adicion|organiz|tabela|card|mover|mova|edit|atualiz|apag|delet|remov|conclu|link|conect|create|add|edit|move|table|organize|delete|update)\b/i.test(text);

    if (willCaptureScreen) {
      steps.push("Capturing screen...");
      steps.push("Analyzing screen & context...");
    } else if (wantsWebSearch) {
      steps.push("Searching the web...");
      steps.push("Analyzing sources...");
    } else if (hasAppFiles) {
      steps.push("Reading app attachments...");
      steps.push("Analyzing file contents...");
    } else if (hasAudioOrVideo) {
      steps.push("Processing media attachment...");
      steps.push("Extracting key details...");
    } else if (hasImage) {
      steps.push("Inspecting image...");
      steps.push("Analyzing visual details...");
    } else if (hasFile) {
      steps.push("Reading attached files...");
      steps.push("Reviewing context...");
    } else {
      steps.push("Reading board context...");
    }

    if (isBoardAction) {
      steps.push("Planning canvas actions...");
      steps.push("Preparing updates...");
    } else {
      steps.push("Reasoning through details...");
      steps.push("Structuring response...");
    }
    steps.push("Finalizing answer...");
    return steps;
  }

  function updateChatTopbarIndicator() {
    if (!openChatBtn) return;
    const isChatVisible = !panel.hidden && currentMode === "chat";
    if (isChatVisible) {
      chatHasUnread = false;
    }
    openChatBtn.classList.toggle("thinking", chatBusy);
    openChatBtn.classList.toggle("has-unread", !chatBusy && chatHasUnread && !isChatVisible);
    if (isChatVisible) {
      topbarGrokLoader?.stop();
    } else if (chatBusy) {
      topbarGrokLoader?.setState({ speed: 1.8, intensity: 1 });
      topbarGrokLoader?.start();
      openChatBtn.title = "AI Chat (Thinking...)";
    } else {
      topbarGrokLoader?.setState({ speed: 1, intensity: 0.85 });
      topbarGrokLoader?.start();
      if (chatHasUnread && !isChatVisible) {
        openChatBtn.title = "AI Chat (New reply ready)";
      } else {
        openChatBtn.title = "AI Chat";
      }
    }
  }

  function createEmptySession() {
    const now = new Date().toISOString();
    return {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function loadChatSessions() {
    try {
      const raw = localStorage.getItem(AI_CHAT_SESSIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          chatSessions = parsed;
        }
      }
      if (!chatSessions.length) {
        const legacyRaw = localStorage.getItem(AI_CHAT_LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          const legacyMsgs = JSON.parse(legacyRaw);
          if (Array.isArray(legacyMsgs) && legacyMsgs.length > 0) {
            const migrated = createEmptySession();
            migrated.messages = legacyMsgs.map(m => ({
              role: m.role === "model" ? "model" : "user",
              text: String(m.text || ""),
              attachments: Array.isArray(m.attachments) ? m.attachments : []
            }));
            const firstUser = migrated.messages.find(m => m.role === "user");
            migrated.title = buildAutoSessionTitle(firstUser?.text || "Previous chat");
            chatSessions = [migrated];
          }
        }
      }
    } catch (_) { }

    if (!chatSessions.length) {
      chatSessions = [createEmptySession()];
    }

    const savedActiveId = localStorage.getItem(AI_CHAT_ACTIVE_SESSION_KEY);
    if (savedActiveId && chatSessions.some(s => s.id === savedActiveId)) {
      activeSessionId = savedActiveId;
    } else {
      activeSessionId = chatSessions[0].id;
    }
  }

  function saveChatSessions() {
    const trimmed = chatSessions.slice(0, 60);
    persistenceService.saveChatSessions(trimmed, AI_CHAT_SESSIONS_KEY);
    persistenceService.saveSetting(AI_CHAT_ACTIVE_SESSION_KEY, activeSessionId);
  }

  function hydrateChatSessionsFromDb() {
    persistenceService.loadChatSessions(AI_CHAT_SESSIONS_KEY).then(dbSessions => {
      if (Array.isArray(dbSessions) && dbSessions.length > 0) {
        chatSessions = dbSessions;
        const savedActiveId = localStorage.getItem(AI_CHAT_ACTIVE_SESSION_KEY);
        if (savedActiveId && chatSessions.some(s => s.id === savedActiveId)) {
          activeSessionId = savedActiveId;
        } else {
          activeSessionId = chatSessions[0].id;
        }
        renderSessionsList();
        renderChatMessages();
      }
    }).catch(() => { });
  }

  function getActiveSession() {
    let session = chatSessions.find(s => s.id === activeSessionId);
    if (!session) {
      session = chatSessions[0] || createEmptySession();
      if (!chatSessions.includes(session)) {
        chatSessions.unshift(session);
      }
      activeSessionId = session.id;
    }
    return session;
  }

  loadChatSessions();
  hydrateChatSessionsFromDb();

  const AI_CHAT_ALWAYS_SEE_SCREEN_KEY = "todocompanion.settings.aiChatAlwaysSeeScreen";
  const chatScreenVisionBtn = document.getElementById("aiChatScreenVisionBtn");
  let alwaysSeeScreen = localStorage.getItem(AI_CHAT_ALWAYS_SEE_SCREEN_KEY) === "true";

  function syncScreenVisionBtn() {
    if (!chatScreenVisionBtn) return;
    chatScreenVisionBtn.classList.toggle("is-active", alwaysSeeScreen);
    chatScreenVisionBtn.setAttribute("aria-pressed", String(alwaysSeeScreen));
    chatScreenVisionBtn.title = alwaysSeeScreen
      ? "Sempre ver a tela: ATIVO (envia captura da tela em toda mensagem · clique para desativar)"
      : "Sempre ver a tela: DESATIVADO (só captura a tela quando você pedir na mensagem · clique para ativar)";
  }

  if (chatScreenVisionBtn) {
    syncScreenVisionBtn();
    chatScreenVisionBtn.addEventListener("click", () => {
      alwaysSeeScreen = !alwaysSeeScreen;
      persistenceService.saveSetting(AI_CHAT_ALWAYS_SEE_SCREEN_KEY, alwaysSeeScreen ? "true" : "false");
      syncScreenVisionBtn();
    });
    persistenceService.hydrateSettingsFromDb([AI_CHAT_ALWAYS_SEE_SCREEN_KEY]).then(dbMap => {
      if (dbMap?.[AI_CHAT_ALWAYS_SEE_SCREEN_KEY] !== undefined) {
        alwaysSeeScreen = dbMap[AI_CHAT_ALWAYS_SEE_SCREEN_KEY] === "true";
        syncScreenVisionBtn();
      }
    }).catch(() => { });
  }

  const AI_CHAT_MODEL_KEY = "todocompanion.settings.aiChatModel";
  const AI_CHAT_MODEL_OPTIONS = [
    { value: "auto", label: "Auto", desc: "Cascata automática com fallback" },
    { value: "gemini-flash-latest", label: "Gemini Flash", desc: "Mais recente e equilibrado" },
    { value: "gemini-3.8-flash", label: "Gemini 3.8 Flash", desc: "Alta velocidade e raciocínio" },
    { value: "gemini-4-hydrogen", label: "Gemini 4 Hydrogen", desc: "Próxima geração" },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", desc: "Rápido para tarefas gerais" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash", desc: "Raciocínio avançado e rápido" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Estável e versátil" },
    { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Lite", desc: "Leve e econômico" },
    { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Lite", desc: "Respostas ultrarrápidas" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Lite", desc: "Baixo custo de tokens" },
    { value: "gemma-4-31b-it", label: "Gemma 4 31B", desc: "Modelo aberto 31B" }
  ];
  const chatModelBtn = document.getElementById("aiChatModelBtn");
  const chatModelLabel = document.getElementById("aiChatModelLabel");
  const chatModelQuotaDot = document.getElementById("aiChatModelQuotaDot");
  const chatModelPopover = document.getElementById("aiChatModelPopover");
  let selectedChatModel = localStorage.getItem(AI_CHAT_MODEL_KEY) || "auto";
  if (!AI_CHAT_MODEL_OPTIONS.some(opt => opt.value === selectedChatModel)) {
    selectedChatModel = "auto";
  }
  let modelQuotaMap = new Map();
  let quotaChecking = false;

  function getModelQuotaEntry(modelId) {
    if (!modelId || modelId === "auto") {
      const all = [...modelQuotaMap.values()];
      if (!all.length) {
        return {
          status: quotaChecking ? "checking" : "available",
          remaining_seconds: 0,
          quota_label: quotaChecking ? "Verificando..." : "Auto"
        };
      }
      const availCount = all.filter(x => x.status === "available").length;
      if (availCount > 0) {
        return { status: "available", remaining_seconds: 0, quota_label: `${availCount} com cota` };
      }
      const hasCool = all.some(x => x.status === "cooldown");
      return { status: hasCool ? "cooldown" : "exhausted", remaining_seconds: 0, quota_label: "Sem cota" };
    }
    return modelQuotaMap.get(modelId) || {
      status: quotaChecking ? "checking" : "available",
      remaining_seconds: 0,
      quota_label: quotaChecking ? "Verificando..." : ""
    };
  }

  async function refreshModelsQuotaStatus(forceProbe = false) {
    if (typeof invoke !== "function" || quotaChecking) return;
    quotaChecking = true;
    if (chatModelPopover && !chatModelPopover.hidden && modelQuotaMap.size === 0) {
      renderChatModelPopover();
    }
    try {
      const list = await invoke("get_ai_models_quota_status", {
        apiKey: localStorage.getItem(GEMINI_API_KEY_STORAGE) || null,
        forceProbe: Boolean(forceProbe)
      });
      if (Array.isArray(list)) {
        modelQuotaMap = new Map(list.map(item => [item.model, item]));
      }
    } catch (_) {
    } finally {
      quotaChecking = false;
      syncChatModelLabel();
      if (chatModelPopover && !chatModelPopover.hidden) {
        renderChatModelPopover();
      }
    }
  }

  function closeModelPopover() {
    if (!chatModelPopover || !chatModelBtn) return;
    chatModelPopover.hidden = true;
    chatModelBtn.classList.remove("is-open");
    chatModelBtn.setAttribute("aria-expanded", "false");
  }

  function syncChatModelLabel() {
    const current = AI_CHAT_MODEL_OPTIONS.find(opt => opt.value === selectedChatModel) || AI_CHAT_MODEL_OPTIONS[0];
    if (chatModelLabel) chatModelLabel.textContent = current.label;
    const q = getModelQuotaEntry(selectedChatModel);
    if (chatModelQuotaDot) {
      chatModelQuotaDot.className = `ai-model-quota-dot quota-${q.status || "available"}`;
    }
    if (chatModelBtn) {
      const statusText = q.status === "exhausted"
        ? "Sem cota disponível (usará fallback automático)"
        : q.status === "unavailable"
          ? "Indisponível na API (usará fallback automático)"
          : q.status === "cooldown"
            ? `Aguardando limite por minuto (${q.remaining_seconds}s)`
            : q.status === "checking"
              ? "Verificando cota em tempo real..."
              : "Cota disponível";
      chatModelBtn.title = `${current.label} · ${statusText}`;
    }
  }

  function renderChatModelPopover() {
    if (!chatModelPopover) return;
    chatModelPopover.innerHTML = "";
    AI_CHAT_MODEL_OPTIONS.forEach(opt => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.role = "option";
      const isSelected = opt.value === selectedChatModel;
      const q = getModelQuotaEntry(opt.value);
      const qStatus = q.status || "available";
      const badgeLabel = q.quota_label || (
        opt.value === "auto"
          ? "Ativo"
          : qStatus === "exhausted"
            ? "Sem cota"
            : qStatus === "unavailable"
              ? "Indisponível"
              : qStatus === "checking"
                ? "Verificando..."
                : "Com cota"
      );
      btn.className = `ai-model-option${isSelected ? " selected" : ""}`;
      btn.setAttribute("aria-selected", String(isSelected));
      btn.innerHTML = `
        <span class="ai-model-option-main">
          <span class="ai-model-option-title-row">
            <span class="ai-model-quota-dot quota-${escapeHtml(qStatus)}" aria-hidden="true"></span>
            <span class="ai-model-option-name">${escapeHtml(opt.label)}</span>
            <span class="ai-model-quota-badge quota-${escapeHtml(qStatus)}">${escapeHtml(badgeLabel)}</span>
          </span>
          <span class="ai-model-option-desc">${escapeHtml(opt.desc)}</span>
        </span>
        <svg class="ai-model-option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5"/>
        </svg>
      `;
      btn.addEventListener("click", () => {
        selectedChatModel = opt.value;
        persistenceService.saveSetting(AI_CHAT_MODEL_KEY, selectedChatModel);
        syncChatModelLabel();
        closeModelPopover();
      });
      chatModelPopover.appendChild(btn);
    });
  }

  if (chatModelBtn && chatModelPopover) {
    syncChatModelLabel();
    refreshModelsQuotaStatus();
    chatModelBtn.addEventListener("click", ev => {
      ev.stopPropagation();
      const willOpen = chatModelPopover.hidden;
      if (willOpen) {
        renderChatModelPopover();
        refreshModelsQuotaStatus();
      }
      chatModelPopover.hidden = !willOpen;
      chatModelBtn.classList.toggle("is-open", willOpen);
      chatModelBtn.setAttribute("aria-expanded", String(willOpen));
    });
    document.addEventListener("click", ev => {
      if (!chatModelPopover.hidden && !chatModelPopover.contains(ev.target) && !chatModelBtn.contains(ev.target)) {
        closeModelPopover();
      }
    });
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && !chatModelPopover.hidden) {
        closeModelPopover();
      }
    });
    persistenceService.hydrateSettingsFromDb([AI_CHAT_MODEL_KEY]).then(dbMap => {
      const saved = dbMap?.[AI_CHAT_MODEL_KEY];
      if (saved && AI_CHAT_MODEL_OPTIONS.some(opt => opt.value === saved)) {
        selectedChatModel = saved;
        syncChatModelLabel();
      }
    }).catch(() => { });
  }

  if (toneSlider) {
    toneSlider.value = String(formality);
  }
  if (toneBadge) {
    toneBadge.textContent = describeFormalityLabel(formality);
  }

  function syncTopbarActiveButtons() {
    const isOpen = !panel.hidden;
    const isChat = currentMode === "chat";
    openTranslateBtn?.classList.toggle("active", isOpen && !isChat);
    openChatBtn?.classList.toggle("active", isOpen && isChat);
    if (chatHistoryToggle) chatHistoryToggle.hidden = !isChat;
    if (newChatBtn) newChatBtn.hidden = !isChat;
    if (minimizeFloatingBtn) minimizeFloatingBtn.hidden = !isTranslatorFloating;
    if (detachTranslatorBtn) {
      detachTranslatorBtn.hidden = false;
      detachTranslatorBtn.classList.toggle("floating-active", isTranslatorFloating);
      const label = isChat ? "chat da IA" : "tradutor";
      detachTranslatorBtn.title = isTranslatorFloating
        ? `Acoplar ${label} de volta na janela do TODO`
        : `Soltar ${label} em janela flutuante sobre todos os apps (ou arraste o topo)`;
      detachTranslatorBtn.setAttribute("aria-label", detachTranslatorBtn.title);
      detachTranslatorBtn.innerHTML = isTranslatorFloating
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`
        : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H3v-6"/><path d="M14 10 3 21"/><path d="M6 11V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-6"/></svg>`;
    }
    if (panelTitleEl) {
      if (isChat) {
        const active = getActiveSession();
        panelTitleEl.textContent = active.title || "New chat";
        panelTitleEl.hidden = false;
      } else {
        panelTitleEl.textContent = "";
        panelTitleEl.hidden = true;
      }
    }
    updateChatTopbarIndicator();
  }

  async function setTranslatorFloating(nextFloating) {
    const target = Boolean(nextFloating);
    if (isTranslatorFloating === target) return;
    isTranslatorFloating = target;
    const isChat = currentMode === "chat";
    document.body.classList.toggle("translator-floating-mode", isTranslatorFloating);
    document.body.classList.toggle("chat-floating-mode", isTranslatorFloating && isChat);

    if (isTranslatorFloating) {
      panel.hidden = false;
      if (translateView) translateView.hidden = isChat;
      if (chatView) chatView.hidden = !isChat;
    }

    syncTopbarActiveButtons();

    try {
      if (invoke) {
        await invoke("set_translator_floating_mode", {
          floating: isTranslatorFloating,
          mode: currentMode
        });
      }
    } catch (err) {
      console.warn("Falha ao alternar modo flutuante:", err);
    }

    requestAnimationFrame(() => {
      applyViewport();
      renderLinks();
      if (isChat) {
        renderChatMessages();
        chatInput?.focus();
      } else {
        trInput?.focus();
      }
    });
  }

  function setMode(mode) {
    currentMode = mode === "chat" ? "chat" : "translate";
    const isChat = currentMode === "chat";
    if (translateView) translateView.hidden = isChat;
    if (chatView) chatView.hidden = !isChat;
    syncTopbarActiveButtons();

    requestAnimationFrame(() => {
      if (isChat) {
        renderSessionsList();
        renderChatMessages();
        chatInput?.focus();
      } else {
        trInput?.focus();
      }
    });
  }

  function togglePanel(forceOpen = null, targetMode = null) {
    if (targetMode && (targetMode === "translate" || targetMode === "chat")) {
      if (!panel.hidden && currentMode === targetMode && forceOpen === null) {
        panel.hidden = true;
      } else {
        currentMode = targetMode;
        panel.hidden = forceOpen !== null ? !forceOpen : false;
      }
    } else {
      const shouldOpen = forceOpen !== null ? forceOpen : panel.hidden;
      panel.hidden = !shouldOpen;
    }

    const isChat = currentMode === "chat";
    if (translateView) translateView.hidden = isChat;
    if (chatView) chatView.hidden = !isChat;
    syncTopbarActiveButtons();

    if (!panel.hidden) {
      closeAttachmentsPopup();
      requestAnimationFrame(() => {
        if (currentMode === "chat") {
          renderSessionsList();
          renderChatMessages();
          chatInput?.focus();
        } else {
          trInput?.focus();
        }
      });
    }
    requestAnimationFrame(() => {
      applyViewport();
      renderLinks();
    });
  }

  window.toggleAiTranslatorPanel = togglePanel;
  window.openFloatingAiChatOnly = () => {
    closeAllOpenModals();
    currentMode = "chat";
    panel.hidden = false;
    if (translateView) translateView.hidden = true;
    if (chatView) chatView.hidden = false;
    isTranslatorFloating = true;
    document.body.classList.add("translator-floating-mode", "chat-floating-mode");
    syncTopbarActiveButtons();
    requestAnimationFrame(() => {
      renderSessionsList();
      renderChatMessages();
      chatInput?.focus();
    });
  };

  openTranslateBtn?.addEventListener("click", () => togglePanel(null, "translate"));
  openChatBtn?.addEventListener("click", () => togglePanel(null, "chat"));
  closeBtn?.addEventListener("click", () => {
    if (isTranslatorFloating) {
      setTranslatorFloating(false);
    } else {
      togglePanel(false);
    }
  });

  detachTranslatorBtn?.addEventListener("click", () => {
    setTranslatorFloating(!isTranslatorFloating);
  });

  minimizeFloatingBtn?.addEventListener("click", () => {
    if (!invoke) return;
    if (isTranslatorFloating) {
      const iconColor = getSelectedAiIconColor?.() || null;
      const iconStyle = getSelectedAiIconStyle?.() || null;
      invoke("hide_window", { iconColor, iconStyle }).catch(err =>
        console.warn("Could not hide floating chat to tray", err)
      );
      return;
    }
    minimizeWindow();
  });

  // Permite "soltar" o tradutor ou chat da IA puxando/arrastando o cabecalho para fora
  if (panelHead) {
    let headDragStart = null;
    panelHead.addEventListener("pointerdown", event => {
      if (isTranslatorFloating) return;
      if (event.button !== 0 || event.target.closest("button")) return;
      headDragStart = { x: event.clientX, y: event.clientY };
    });
    window.addEventListener("pointermove", event => {
      if (!headDragStart || isTranslatorFloating) return;
      const dist = Math.hypot(event.clientX - headDragStart.x, event.clientY - headDragStart.y);
      if (dist > 36) {
        headDragStart = null;
        setTranslatorFloating(true);
      }
    });
    window.addEventListener("pointerup", () => {
      headDragStart = null;
    });
  }

  if (panelResizer) {
    let isResizing = false;
    let startX = 0;
    let startWidth = AI_PANEL_DEFAULT_WIDTH;

    panelResizer.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      isResizing = true;
      startX = event.clientX;
      startWidth = panel.getBoundingClientRect().width || AI_PANEL_DEFAULT_WIDTH;
      panel.classList.add("resizing");
      document.body.style.cursor = "col-resize";
      try {
        panelResizer.setPointerCapture(event.pointerId);
      } catch (_) { }
    });

    panelResizer.addEventListener("pointermove", event => {
      if (!isResizing) return;
      const deltaX = startX - event.clientX;
      const maxAllowed = Math.min(AI_PANEL_MAX_WIDTH, Math.max(AI_PANEL_MIN_WIDTH, window.innerWidth - 260));
      const nextWidth = clamp(Math.round(startWidth + deltaX), AI_PANEL_MIN_WIDTH, maxAllowed);
      panel.style.width = `${nextWidth}px`;
      applyViewport();
      renderLinks();
    });

    const stopResize = event => {
      if (!isResizing) return;
      isResizing = false;
      panel.classList.remove("resizing");
      document.body.style.cursor = "";
      try {
        panelResizer.releasePointerCapture(event.pointerId);
      } catch (_) { }
      const finalWidth = Math.round(panel.getBoundingClientRect().width || AI_PANEL_DEFAULT_WIDTH);
      localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(finalWidth));
      applyViewport();
      renderLinks();
    };

    panelResizer.addEventListener("pointerup", stopResize);
    panelResizer.addEventListener("pointercancel", stopResize);

    panelResizer.addEventListener("dblclick", () => {
      panel.style.width = `${AI_PANEL_DEFAULT_WIDTH}px`;
      localStorage.setItem(AI_PANEL_WIDTH_STORAGE_KEY, String(AI_PANEL_DEFAULT_WIDTH));
      applyViewport();
      renderLinks();
    });
  }

  function syncTranslateButtonState() {
    if (!trRunBtn) return;
    const text = (trInput?.value || "").trim();
    const hasOutput = Boolean((trOutput?.textContent || "").trim());
    const currentKey = text ? `${currentDirection}|${formality}|${text}` : "";

    trRunBtn.classList.remove("needs-translate", "stale", "synced");

    if (!text) {
      trRunBtn.disabled = true;
      trRunBtn.title = "Digite algo para traduzir";
      return;
    }

    trRunBtn.disabled = translateInFlight;
    if (lastTranslatedKey && currentKey === lastTranslatedKey) {
      trRunBtn.classList.add("synced");
      trRunBtn.title = "Tradução atualizada";
    } else if (hasOutput) {
      trRunBtn.classList.add("stale");
      trRunBtn.title = "Texto, tom ou idioma alterado — clique ou pressione Enter para atualizar a tradução";
    } else {
      trRunBtn.classList.add("needs-translate");
      trRunBtn.title = "Traduzir (Enter)";
    }
  }

  function isTranslatorAutoMode() {
    return localStorage.getItem(AI_TRANSLATOR_MODE_STORAGE_KEY) === "auto";
  }

  function applyTranslatorModeUi() {
    const isAuto = isTranslatorAutoMode();
    translateView?.classList.toggle("auto-translate-mode", isAuto);
    syncTranslateButtonState();
  }

  window.addEventListener("app:translator-mode-changed", () => {
    applyTranslatorModeUi();
    if (isTranslatorAutoMode() && trInput?.value.trim()) {
      scheduleRealtimeTranslation(100);
    }
  });

  toneSlider?.addEventListener("input", () => {
    formality = clamp(Number(toneSlider.value) || 0, 0, 100);
    if (toneBadge) {
      toneBadge.textContent = describeFormalityLabel(formality);
    }
    localStorage.setItem(AI_TONE_STORAGE_KEY, String(formality));
    syncTranslateButtonState();
    if (isTranslatorAutoMode() && trInput?.value.trim()) {
      scheduleRealtimeTranslation(100);
    }
  });

  panel.querySelectorAll("[data-tone-jump]").forEach(lbl => {
    lbl.addEventListener("click", () => {
      const targetVal = clamp(Number(lbl.dataset.toneJump) || 0, 0, 100);
      formality = targetVal;
      if (toneSlider) toneSlider.value = String(targetVal);
      if (toneBadge) toneBadge.textContent = describeFormalityLabel(targetVal);
      localStorage.setItem(AI_TONE_STORAGE_KEY, String(targetVal));
      syncTranslateButtonState();
      if (isTranslatorAutoMode() && trInput?.value.trim()) {
        scheduleRealtimeTranslation(20);
      }
    });
  });

  const dirDropdown = document.getElementById("aiDirDropdown");
  const dirTrigger = document.getElementById("aiDirDropdownTrigger");
  const dirLabel = document.getElementById("aiDirDropdownLabel");
  const dirMenu = document.getElementById("aiDirDropdownMenu");

  function closeDirDropdown() {
    if (!dirMenu || !dirDropdown) return;
    dirMenu.hidden = true;
    dirDropdown.classList.remove("open");
    dirTrigger?.setAttribute("aria-expanded", "false");
  }

  dirTrigger?.addEventListener("click", event => {
    event.stopPropagation();
    if (!dirMenu || !dirDropdown) return;
    const willOpen = dirMenu.hidden;
    dirMenu.hidden = !willOpen;
    dirDropdown.classList.toggle("open", willOpen);
    dirTrigger.setAttribute("aria-expanded", String(willOpen));
  });

  document.addEventListener("pointerdown", event => {
    if (dirDropdown && !dirDropdown.contains(event.target)) {
      closeDirDropdown();
    }
  });

  function syncDirectionUi() {
    panel.querySelectorAll("[data-ai-dir]").forEach(b => {
      const isSelected = b.dataset.aiDir === currentDirection;
      b.classList.toggle("active", isSelected);
      b.setAttribute("aria-selected", String(isSelected));
      if (isSelected && dirLabel) {
        dirLabel.textContent = b.dataset.aiDirLabel || b.textContent.trim();
      }
    });
    if (trInputWatermark && trOutputWatermark) {
      if (currentDirection === "en-pt") {
        trInputWatermark.textContent = "ENGLISH";
        trOutputWatermark.textContent = "PORTUGUÊS";
      } else if (currentDirection === "auto") {
        trInputWatermark.textContent = "AUTO";
        trOutputWatermark.textContent = "PT ↔ EN";
      } else {
        trInputWatermark.textContent = "PORTUGUÊS";
        trOutputWatermark.textContent = "ENGLISH";
      }
    }
    syncTranslateButtonState();
  }

  panel.querySelectorAll("[data-ai-dir]").forEach(btn => {
    btn.addEventListener("click", () => {
      currentDirection = btn.dataset.aiDir || "pt-en";
      closeDirDropdown();
      syncDirectionUi();
      if (isTranslatorAutoMode() && trInput?.value.trim()) {
        scheduleRealtimeTranslation(20);
      }
    });
  });

  trFlipDirBtn?.addEventListener("click", () => {
    currentDirection = currentDirection === "en-pt" ? "pt-en" : "en-pt";
    trFlipDirBtn.classList.toggle("flipped");
    syncDirectionUi();
    if (isTranslatorAutoMode() && trInput?.value.trim()) {
      scheduleRealtimeTranslation(20);
    }
  });

  syncDirectionUi();
  applyTranslatorModeUi();

  const translateGrokLoaders = translateView
    ? Array.from(translateView.querySelectorAll(".grok-canvas-translate")).map(canvas => {
      const loader = new GrokDodecahedronRenderer(canvas, { size: 22, speed: 0.35, intensity: 0.52 });
      loader.start();
      return loader;
    })
    : [];

  function setTranslateStatus(stateName, label) {
    const isBusy = stateName === "busy";
    if (trStatusDot) {
      trStatusDot.className = `ai-status-dot ${stateName}`;
    }
    if (trStatusText) {
      trStatusText.classList.toggle("grok-shimmer-text", isBusy);
      if (isBusy) {
        translateThinkingCycler.start(trStatusText);
      } else {
        translateThinkingCycler.stop();
        trStatusText.textContent = label;
      }
    }
    translateView?.classList.toggle("is-thinking", isBusy);
    translateGrokLoaders.forEach(loader => {
      loader.setState(isBusy ? { speed: 1.5, intensity: 1 } : { speed: 0.35, intensity: 0.52 });
      loader.start();
    });
  }

  function scheduleRealtimeTranslation(delayMs = 320) {
    if (translateTimer) {
      clearTimeout(translateTimer);
      translateTimer = null;
    }
    const raw = trInput?.value || "";
    const text = raw.trim();
    if (trClearBtn) {
      trClearBtn.hidden = !raw.length;
    }
    if (!text) {
      translateSeq += 1;
      queuedTranslation = null;
      lastTranslatedKey = "";
      if (trOutput) trOutput.textContent = "";
      setTranslateStatus("idle", "Instant AI Translation");
      syncTranslateButtonState();
      return;
    }

    const cacheKey = `${currentDirection}|${formality}|${text}`;
    if (translationCache.has(cacheKey)) {
      queuedTranslation = null;
      lastTranslatedKey = cacheKey;
      if (trOutput) trOutput.textContent = translationCache.get(cacheKey);
      setTranslateStatus("ready", `Instant · ${describeFormalityLabel(formality)}`);
      syncTranslateButtonState();
      return;
    }

    setTranslateStatus("busy", "Translating...");
    translateTimer = setTimeout(() => {
      const req = { text, toneVal: formality, dir: currentDirection, cacheKey };
      if (translateInFlight) {
        // Single-flight gate: nunca empilha multiplas chamadas simultaneas no Gemini.
        // Guarda apenas o estado mais recente para disparar assim que a chamada atual voltar.
        queuedTranslation = req;
        return;
      }
      runRealtimeTranslation(req.text, req.toneVal, req.dir, req.cacheKey);
    }, delayMs);
  }

  async function runRealtimeTranslation(text, toneVal, dir, cacheKey) {
    const seq = ++translateSeq;
    translateInFlight = true;
    if (trRunBtn) trRunBtn.disabled = true;
    const t0 = performance.now();
    try {
      let result = "";
      if (invoke) {
        result = await invoke("ai_translate_fast", {
          text,
          formality: toneVal,
          direction: dir,
          apiKey: localStorage.getItem(GEMINI_API_KEY_STORAGE) || null
        });
      } else {
        result = await fallbackBrowserTranslate(text, toneVal, dir);
      }

      const cleaned = String(result || "").trim();
      translationCache.set(cacheKey, cleaned);
      if (translationCache.size > 80) {
        const firstKey = translationCache.keys().next().value;
        translationCache.delete(firstKey);
      }

      if (seq === translateSeq && !queuedTranslation) {
        lastTranslatedKey = cacheKey;
        if (trOutput) {
          trOutput.textContent = cleaned;
        }
        const ms = Math.round(performance.now() - t0);
        setTranslateStatus("ready", `${ms}ms · ${describeFormalityLabel(toneVal)}`);
      }
    } catch (err) {
      if (seq === translateSeq && !queuedTranslation) {
        console.warn("Erro na traducao", err);
        setTranslateStatus("error", "Translation error");
        if (trOutput) {
          trOutput.textContent = String(err?.message || err);
        }
      }
    } finally {
      translateInFlight = false;
      syncTranslateButtonState();
      if (queuedTranslation) {
        const nextReq = queuedTranslation;
        queuedTranslation = null;
        if (translationCache.has(nextReq.cacheKey)) {
          lastTranslatedKey = nextReq.cacheKey;
          if (trOutput) trOutput.textContent = translationCache.get(nextReq.cacheKey);
          setTranslateStatus("ready", `Instant · ${describeFormalityLabel(nextReq.toneVal)}`);
          syncTranslateButtonState();
        } else {
          runRealtimeTranslation(nextReq.text, nextReq.toneVal, nextReq.dir, nextReq.cacheKey);
        }
      }
    }
  }

  trInput?.addEventListener("input", () => {
    const raw = trInput.value || "";
    if (trClearBtn) {
      trClearBtn.hidden = !raw.length;
    }
    syncTranslateButtonState();
    if (isTranslatorAutoMode()) {
      scheduleRealtimeTranslation(100);
    }
  });

  trInput?.addEventListener("paste", () => {
    if (isTranslatorAutoMode()) {
      setTimeout(() => scheduleRealtimeTranslation(15), 0);
    }
  });

  syncTranslateButtonState();

  trInput?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      scheduleRealtimeTranslation(0);
    }
  });

  trRunBtn?.addEventListener("click", () => {
    scheduleRealtimeTranslation(0);
  });

  trClearBtn?.addEventListener("click", () => {
    if (!trInput) return;
    trInput.value = "";
    scheduleRealtimeTranslation(0);
    trInput.focus();
  });

  trCopyBtn?.addEventListener("click", async () => {
    const outText = String(trOutput?.textContent || "").trim();
    if (!outText) return;
    try {
      await navigator.clipboard.writeText(outText);
      const prevHtml = trCopyBtn.innerHTML;
      trCopyBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
      setTimeout(() => {
        trCopyBtn.innerHTML = prevHtml;
      }, 1200);
    } catch (_) { }
  });

  // --- MODO 2: CHAT DE IA MODERNO COM ANEXOS E MODAL DE HISTORICO ---
  function closeHistoryModal() {
    if (sessionsDrawer) sessionsDrawer.hidden = true;
    chatHistoryToggle?.classList.remove("open");
  }

  function openHistoryModal() {
    if (!sessionsDrawer) return;
    sessionsDrawer.hidden = false;
    chatHistoryToggle?.classList.add("open");
    if (historySearchInput) {
      historySearchInput.value = "";
    }
    renderSessionsList("");
    requestAnimationFrame(() => historySearchInput?.focus());
  }

  function renderSessionsList(filterQuery = "") {
    const active = getActiveSession();
    if (currentMode === "chat" && panelTitleEl) {
      panelTitleEl.textContent = active.title || "New chat";
    }
    const q = String(filterQuery || historySearchInput?.value || "").trim().toLowerCase();
    const allSaved = chatSessions.filter(s => s.messages.length > 0 || s.id === active.id);
    if (sessionsCountEl) {
      sessionsCountEl.textContent = String(allSaved.length);
    }
    if (!sessionsListEl) return;
    sessionsListEl.innerHTML = "";

    const filtered = q
      ? allSaved.filter(s =>
        String(s.title || "").toLowerCase().includes(q) ||
        (s.messages || []).some(m => String(m.text || "").toLowerCase().includes(q))
      )
      : allSaved;

    filtered.forEach(session => {
      const item = document.createElement("div");
      item.className = `ai-chat-session-item ${session.id === active.id ? "active" : ""}`;

      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "ai-chat-session-select";

      const titleSpan = document.createElement("span");
      titleSpan.className = "ai-chat-session-title";
      titleSpan.textContent = session.title || "New chat";

      const metaSpan = document.createElement("span");
      metaSpan.className = "ai-chat-session-meta";
      const count = session.messages?.length || 0;
      const dateStr = formatSessionTimestamp(session.updatedAt || session.createdAt);
      metaSpan.textContent = `${count} msg${count === 1 ? "" : "s"}${dateStr ? ` · ${dateStr}` : ""}`;

      infoBtn.append(titleSpan, metaSpan);
      infoBtn.addEventListener("click", () => {
        activeSessionId = session.id;
        saveChatSessions();
        closeHistoryModal();
        renderSessionsList();
        renderChatMessages();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ai-chat-session-del";
      delBtn.title = "Delete conversation";
      delBtn.textContent = "×";
      delBtn.addEventListener("click", event => {
        event.stopPropagation();
        chatSessions = chatSessions.filter(s => s.id !== session.id);
        if (!chatSessions.length) {
          chatSessions = [createEmptySession()];
        }
        if (activeSessionId === session.id) {
          activeSessionId = chatSessions[0].id;
        }
        saveChatSessions();
        renderSessionsList();
        renderChatMessages();
      });

      item.append(infoBtn, delBtn);
      sessionsListEl.appendChild(item);
    });
  }

  chatHistoryToggle?.addEventListener("click", () => {
    if (!sessionsDrawer) return;
    if (sessionsDrawer.hidden) {
      openHistoryModal();
    } else {
      closeHistoryModal();
    }
  });

  historyModalCloseBtn?.addEventListener("click", closeHistoryModal);

  sessionsDrawer?.addEventListener("pointerdown", event => {
    if (event.target === sessionsDrawer) {
      closeHistoryModal();
    }
  });

  historySearchInput?.addEventListener("input", () => {
    renderSessionsList(historySearchInput.value);
  });

  newChatBtn?.addEventListener("click", () => {
    const current = getActiveSession();
    if (current.messages.length === 0) {
      closeHistoryModal();
      chatInput?.focus();
      return;
    }
    const fresh = createEmptySession();
    chatSessions.unshift(fresh);
    activeSessionId = fresh.id;
    pendingAttachments = [];
    renderPendingAttachments();
    saveChatSessions();
    closeHistoryModal();
    renderSessionsList();
    renderChatMessages();
    chatInput?.focus();
  });

  function renderPendingAttachments() {
    if (!chatPendingListEl) return;
    chatPendingListEl.innerHTML = "";
    if (!pendingAttachments.length) {
      chatPendingListEl.hidden = true;
      updateChatTokenCounter();
      return;
    }
    chatPendingListEl.hidden = false;
    updateChatTokenCounter();

    pendingAttachments.forEach((att, idx) => {
      const tile = document.createElement("div");
      tile.className = "ai-pending-tile";
      tile.title = att.name;

      if (att.mime_type?.startsWith("image/") && att.data_base64) {
        const thumb = document.createElement("img");
        thumb.className = "ai-pending-thumb";
        thumb.src = `data:${att.mime_type};base64,${att.data_base64}`;
        thumb.alt = att.name;
        tile.appendChild(thumb);
      } else {
        const extSpan = document.createElement("span");
        extSpan.className = "ai-pending-file-ext";
        const ext = (att.name || "").split(".").pop() || "FILE";
        extSpan.textContent = ext.slice(0, 5);
        tile.appendChild(extSpan);
      }

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "ai-pending-remove";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove attachment";
      removeBtn.addEventListener("click", () => {
        pendingAttachments.splice(idx, 1);
        renderPendingAttachments();
      });
      tile.appendChild(removeBtn);

      chatPendingListEl.appendChild(tile);
    });
  }

  function setChatDropOverlay(visible) {
    const show = Boolean(visible && !panel.hidden && currentMode === "chat");
    if (!chatDropOverlay) return;
    if (show && !chatDropOverlayActive) {
      chatDropOverlay.hidden = false;
      requestAnimationFrame(() => chatDropOverlay.classList.add("visible"));
      chatDropOverlayActive = true;
    } else if (!show && chatDropOverlayActive) {
      chatDropOverlay.classList.remove("visible");
      chatDropOverlay.hidden = true;
      chatDropOverlayActive = false;
    }
  }

  async function addFilesToPending(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    for (const file of files) {
      try {
        const att = await readFileAsAttachment(file);
        pendingAttachments.push(att);
      } catch (err) {
        console.warn("Falha ao ler anexo:", err);
      }
    }
    renderPendingAttachments();
    chatInput?.focus();
  }

  async function addPathsToPending(paths) {
    const list = Array.from(paths || []).filter(Boolean);
    if (!list.length || !invoke) return;
    for (const filePath of list) {
      try {
        const bytes = await invoke("read_file_bytes", { path: filePath });
        if (bytes && bytes.length) {
          pendingAttachments.push(buildAttachmentFromPathBytes(filePath, bytes));
        }
      } catch (err) {
        console.warn("Falha ao ler arquivo arrastado para o chat:", err);
      }
    }
    renderPendingAttachments();
    chatInput?.focus();
  }

  aiChatBridge = {
    isActive: () => !panel.hidden && currentMode === "chat",
    isTargetOrHover: target => {
      if (panel.hidden || currentMode !== "chat") return false;
      if (target instanceof Node && panel.contains(target)) return true;
      if (document.activeElement instanceof Node && panel.contains(document.activeElement)) return true;
      return panel.matches(":hover");
    },
    isPointInside: point => {
      if (panel.hidden || currentMode !== "chat" || !point) return false;
      const rect = panel.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      const px = Number(point.x) / scale;
      const py = Number(point.y) / scale;
      if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
      return px >= rect.left && px <= rect.right && py >= rect.top && py <= rect.bottom;
    },
    setDropOverlay: setChatDropOverlay,
    addFiles: addFilesToPending,
    addPaths: addPathsToPending
  };

  chatAttachBtn?.addEventListener("click", () => {
    chatFileInput?.click();
  });

  chatFileInput?.addEventListener("change", async () => {
    if (chatFileInput.files?.length) {
      await addFilesToPending(chatFileInput.files);
      chatFileInput.value = "";
    }
  });

  chatInput?.addEventListener("paste", async event => {
    const files = getClipboardAttachmentFiles(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    event.stopPropagation();
    await addFilesToPending(files);
  });

  const hasDraggedFiles = dataTransfer => {
    if (!dataTransfer) return false;
    if (dataTransfer.files?.length) return true;
    return Array.from(dataTransfer.types || []).includes("Files");
  };

  panel.addEventListener("dragenter", event => {
    if (currentMode !== "chat" || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    chatHtmlDragDepth += 1;
    setChatDropOverlay(true);
  });

  panel.addEventListener("dragover", event => {
    if (currentMode !== "chat" || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    setChatDropOverlay(true);
  });

  panel.addEventListener("dragleave", event => {
    if (currentMode !== "chat") return;
    chatHtmlDragDepth = Math.max(0, chatHtmlDragDepth - 1);
    if (chatHtmlDragDepth === 0) {
      setChatDropOverlay(false);
    }
  });

  panel.addEventListener("drop", async event => {
    if (currentMode !== "chat") return;
    chatHtmlDragDepth = 0;
    setChatDropOverlay(false);
    if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      event.stopPropagation();
      await addFilesToPending(event.dataTransfer.files);
    }
  });

  function cancelActiveTypingAnimation() {
    if (activeTypingRaf) {
      cancelAnimationFrame(activeTypingRaf);
      activeTypingRaf = 0;
    }
  }

  function appendTypingCursorToBubble(bubbleEl) {
    const cursor = document.createElement("span");
    cursor.className = "ai-typing-cursor";
    cursor.setAttribute("aria-hidden", "true");
    const body = bubbleEl.querySelector(".ai-markdown-body") || bubbleEl;
    const lastBlock = body.lastElementChild;
    if (lastBlock && lastBlock.tagName === "UL" && lastBlock.lastElementChild) {
      lastBlock.lastElementChild.appendChild(cursor);
    } else if (lastBlock && lastBlock.tagName === "PRE") {
      const codeEl = lastBlock.querySelector("code") || lastBlock;
      codeEl.appendChild(cursor);
    } else if (lastBlock) {
      lastBlock.appendChild(cursor);
    } else {
      body.appendChild(cursor);
    }
  }

  function startAiTypingAnimation({ msg, bubbleEl, rowEl, revealTargets }) {
    cancelActiveTypingAnimation();
    const fullText = String(msg.text || "");
    if (!fullText) {
      animatingMessageRef = null;
      return;
    }

    rowEl.classList.add("is-typing", "just-arrived");
    revealTargets.forEach(el => el?.classList.add("ai-reveal-pending"));

    const totalLen = fullText.length;
    const targetDurationMs = clamp(Math.round(totalLen * 11), 360, 2600);
    let startTime = 0;
    let lastRenderedLen = 0;
    let finished = false;

    const complete = () => {
      if (finished) return;
      finished = true;
      cancelActiveTypingAnimation();
      if (animatingMessageRef === msg) {
        animatingMessageRef = null;
      }
      bubbleEl.innerHTML = renderAiMarkdownHtml(fullText);
      rowEl.classList.remove("is-typing");
      revealTargets.forEach(el => {
        if (!el) return;
        el.classList.remove("ai-reveal-pending");
        el.classList.add("ai-reveal-shown");
      });
      if (chatMessagesEl) {
        const distFromBottom = chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight;
        if (distFromBottom < 90) {
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
      }
    };

    bubbleEl.title = "Clique para exibir resposta completa";
    bubbleEl.addEventListener("click", complete, { once: true });

    const step = timestamp => {
      if (finished || !bubbleEl.isConnected) {
        cancelActiveTypingAnimation();
        return;
      }
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(1, elapsed / targetDurationMs);
      const eased = 1 - Math.pow(1 - progress, 1.45);
      let nextLen = Math.max(1, Math.round(totalLen * eased));

      // Alinha suavemente ao fim de palavra quando faltam poucos caracteres
      if (nextLen < totalLen && nextLen > lastRenderedLen) {
        const nextSpace = fullText.indexOf(" ", nextLen);
        if (nextSpace > nextLen && nextSpace - nextLen <= 5) {
          nextLen = nextSpace;
        }
      }

      if (nextLen >= totalLen) {
        complete();
        return;
      }

      if (nextLen !== lastRenderedLen) {
        lastRenderedLen = nextLen;
        const distFromBottom = chatMessagesEl
          ? chatMessagesEl.scrollHeight - chatMessagesEl.scrollTop - chatMessagesEl.clientHeight
          : 0;
        bubbleEl.innerHTML = renderAiMarkdownHtml(fullText.slice(0, nextLen));
        appendTypingCursorToBubble(bubbleEl);
        if (chatMessagesEl && distFromBottom < 90) {
          chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
      }

      activeTypingRaf = requestAnimationFrame(step);
    };

    activeTypingRaf = requestAnimationFrame(step);
  }

  function buildCoachAdviceCard(advice, { animate = false, timestamp = null } = {}) {
    const coachCard = document.createElement("div");
    coachCard.className = "ai-coach-card";
    if (liveCoachOutputMode === "translation") {
      coachCard.classList.add("ai-coach-translation-card");
      if (!animate) coachCard.style.animation = "none";
      const label = document.createElement("span");
      label.className = "ai-coach-translation-label";
      label.textContent = "Translation";
      const translation = document.createElement("div");
      translation.className = "ai-coach-translation";
      translation.textContent = advice.translation || "No translation was detected.";
      coachCard.append(label, translation);
      if (timestamp) {
        const timeDate = new Date(timestamp);
        if (!Number.isNaN(timeDate.getTime())) {
          const timeEl = document.createElement("span");
          timeEl.className = "ai-coach-time";
          timeEl.textContent = timeDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          coachCard.appendChild(timeEl);
        }
      }
      return coachCard;
    }
    if (!animate) {
      coachCard.style.animation = "none";
    }

    if (advice.heardSummary || timestamp) {
      const headEl = document.createElement("div");
      headEl.className = "ai-coach-head";

      const summaryEl = document.createElement("div");
      summaryEl.className = "ai-coach-summary";
      summaryEl.innerHTML = `<span class="ai-coach-summary-dot" aria-hidden="true"></span><span>${escapeHtml(advice.heardSummary || "Live Coach")}</span>`;
      headEl.appendChild(summaryEl);

      const timeDate = timestamp ? new Date(timestamp) : new Date();
      if (!Number.isNaN(timeDate.getTime())) {
        const timeEl = document.createElement("span");
        timeEl.className = "ai-coach-time";
        const hh = String(timeDate.getHours()).padStart(2, "0");
        const mm = String(timeDate.getMinutes()).padStart(2, "0");
        timeEl.textContent = `${hh}:${mm}`;
        headEl.appendChild(timeEl);
      }

      coachCard.appendChild(headEl);
    }

    if (Array.isArray(advice.suggestions) && advice.suggestions.length > 0) {
      const sugWrap = document.createElement("div");
      sugWrap.className = "ai-coach-suggestions";
      const visibleSuggestions = advice.suggestions.filter(sug => {
        const tone = String(sug.tone || "").trim().toLowerCase();
        if (liveCoachMode === "formal") {
          return tone.includes("formal") || tone.includes("detailed") || tone.includes("professional");
        }
        return !tone.includes("formal") && !tone.includes("detailed") && !tone.includes("professional");
      });
      (visibleSuggestions.length ? visibleSuggestions : advice.suggestions).forEach(sug => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-coach-suggestion-btn";
        btn.title = "Click to copy English reply";
        btn.innerHTML = `
          <span class="ai-coach-en-row">
            <span class="ai-coach-en">${escapeHtml(sug.en)}</span>
            <span class="ai-coach-tone-badge">${escapeHtml(sug.tone || "Natural")}</span>
          </span>
          ${sug.pt ? `<span class="ai-coach-pt">${escapeHtml(sug.pt)}</span>` : ""}
        `;
        btn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(sug.en);
            const badge = btn.querySelector(".ai-coach-tone-badge");
            if (badge) {
              const prev = badge.textContent;
              badge.textContent = "Copied ✓";
              window.setTimeout(() => {
                badge.textContent = prev;
              }, 1200);
            }
          } catch (_) { }
        });
        sugWrap.appendChild(btn);
      });
      coachCard.appendChild(sugWrap);
    }

    if (advice.tip) {
      const tipEl = document.createElement("div");
      tipEl.className = "ai-coach-tip";
      tipEl.textContent = advice.tip;
      coachCard.appendChild(tipEl);
    }

    return coachCard;
  }

  function appendCoachAdviceWithoutFlicker(advice, timestamp) {
    if (!liveCoachMessagesEl) return;
    liveCoachAdviceHistory.push({ advice, timestamp });
    if (liveCoachAdviceHistory.length > 60) {
      liveCoachAdviceHistory = liveCoachAdviceHistory.slice(-60);
      const firstRow = liveCoachMessagesEl.querySelector(".ai-chat-msg");
      if (firstRow) firstRow.remove();
    }
    const row = document.createElement("div");
    row.className = "ai-chat-msg ai";
    row.appendChild(buildCoachAdviceCard(advice, { animate: true, timestamp }));
    liveCoachMessagesEl.appendChild(row);
    liveCoachMessagesEl.scrollTop = liveCoachMessagesEl.scrollHeight;
  }

  function renderLiveCoachAdviceHistory() {
    if (!liveCoachMessagesEl) return;
    liveCoachMessagesEl.querySelectorAll(".ai-chat-msg").forEach(row => row.remove());
    liveCoachAdviceHistory.forEach(({ advice, timestamp }) => {
      const row = document.createElement("div");
      row.className = "ai-chat-msg ai";
      row.appendChild(buildCoachAdviceCard(advice, { animate: false, timestamp }));
      liveCoachMessagesEl.appendChild(row);
    });
  }

  function renderChatMessages() {
    if (!chatMessagesEl) return;
    unreadBelowCount = 0;
    updateNewPillVisibility();
    cancelActiveTypingAnimation();
    chatThinkingCycler.stop();
    if (chatGrokLoader) {
      chatGrokLoader.stop();
      chatGrokLoader = null;
    }
    chatMessagesEl.innerHTML = "";
    const session = getActiveSession();
    const messages = (session.messages || []).filter(message => !message.coachAdvice);

    if (!messages.length) {
      if (chatModelBtn && selectedChatModel === "auto") {
        chatModelBtn.title = "Auto (seleção automática na cascata)";
      }
      const empty = document.createElement("div");
      empty.className = "ai-chat-empty";
      empty.innerHTML = `
        <div class="ai-chat-empty-icon">
          <canvas class="grok-canvas-empty" aria-hidden="true"></canvas>
        </div>
        <strong>How can I help you today?</strong>
        <span>Ask anything, paste screenshots (Ctrl+V), or attach files for instant analysis.</span>
      `;
      chatMessagesEl.appendChild(empty);
      const emptyCanvas = empty.querySelector(".grok-canvas-empty");
      if (emptyCanvas) {
        chatGrokLoader = new GrokDodecahedronRenderer(emptyCanvas, { size: 76, speed: 1, intensity: 0.92 });
        chatGrokLoader.start();
      }
      return;
    }

    const copySvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    const cardSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>`;
    const checkSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

    messages.forEach(msg => {
      const isModel = msg.role === "model";
      const row = document.createElement("div");
      row.className = `ai-chat-msg ${isModel ? "ai" : "user"}`;

      if (Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        const attWrap = document.createElement("div");
        attWrap.className = "ai-msg-attachments";

        msg.attachments.forEach(att => {
          if (att.mime_type?.startsWith("image/") && att.data_base64) {
            const img = document.createElement("img");
            img.className = "ai-msg-img-thumb";
            const srcUrl = `data:${att.mime_type};base64,${att.data_base64}`;
            img.src = srcUrl;
            img.alt = att.name || "Attached image";
            img.title = "Click to zoom";
            img.addEventListener("click", () => {
              if (typeof window.openFullscreenImage === "function") {
                window.openFullscreenImage(srcUrl);
              }
            });
            attWrap.appendChild(img);
          } else {
            const badge = document.createElement("div");
            badge.className = "ai-msg-file-chip";
            badge.textContent = `📎 ${att.name || "Attachment"}`;
            attWrap.appendChild(badge);
          }
        });

        row.appendChild(attWrap);
      }

      const shouldAnimateTyping = isModel && msg === animatingMessageRef && Boolean(msg.text);
      let bubbleEl = null;
      const revealTargets = [];

      if (msg.text) {
        const bubble = document.createElement("div");
        bubble.className = "ai-chat-bubble";
        if (isModel) {
          if (!shouldAnimateTyping) {
            bubble.innerHTML = renderAiMarkdownHtml(msg.text);
          }
        } else {
          bubble.textContent = msg.text;
        }
        bubbleEl = bubble;
        row.appendChild(bubble);
      }

      const actions = document.createElement("div");
      actions.className = "ai-chat-msg-actions";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "ai-msg-icon-btn";
      copyBtn.title = "Copy message";
      copyBtn.innerHTML = copySvg;
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(msg.text || "");
          copyBtn.innerHTML = checkSvg;
          setTimeout(() => {
            copyBtn.innerHTML = copySvg;
          }, 1100);
        } catch (_) { }
      });

      if (isModel) {
        const cardBtn = document.createElement("button");
        cardBtn.type = "button";
        cardBtn.className = "ai-msg-icon-btn";
        cardBtn.title = "Insert into active card";
        cardBtn.innerHTML = cardSvg;
        cardBtn.addEventListener("click", () => insertAiTextIntoActiveCanvas(msg.text || ""));

        const timeSpan = document.createElement("span");
        timeSpan.className = "ai-msg-time";
        if (msg.model) {
          const usedName = formatAiModelName(msg.model);
          timeSpan.textContent = msg.requestedModel
            ? `${usedName} (${formatAiModelName(msg.requestedModel)} sem cota)`
            : usedName;
          timeSpan.title = msg.requestedModel
            ? `Respondido via fallback por ${msg.model} porque ${msg.requestedModel} estava sem cota`
            : msg.model;
        } else {
          timeSpan.textContent = "just now";
        }

        actions.append(copyBtn, cardBtn, timeSpan);
        const totalTok = Number(msg.totalTokens) || 0;
        if (totalTok > 0) {
          const tokSpan = document.createElement("span");
          tokSpan.className = "ai-msg-tokens";
          const pTok = Number(msg.promptTokens) || 0;
          const cTok = Number(msg.completionTokens) || 0;
          const sessionStats = TokenMetricsMonitor.computeSessionMetrics(session?.messages || []);
          const metrics = msg.tokenMetrics || TokenMetricsMonitor.reconcileWithActualUsage(null, pTok, cTok, msg.model);
          const comp = metrics.components || {};
          const costStr = metrics.estimatedCostUsd > 0
            ? `$${metrics.estimatedCostUsd.toFixed(5)}`
            : "<$0.00001";
          tokSpan.textContent = `· ${formatTokenCountCompact(totalTok)} tok`;
          const modsLabel = Array.isArray(msg.activeModules) && msg.activeModules.length
            ? msg.activeModules.join(", ")
            : "core";
          tokSpan.title = [
            `Entrada: ${pTok} tok · Saída: ${cTok} tok · Total: ${totalTok} tok`,
            `Custo estimado: ${costStr} · Média da conversa: ${sessionStats.averageTokensPerRequest} tok/msg`,
            `--- Consumo por Componente ---`,
            `• System Prompt (Core): ${comp.systemPromptTokens ?? 0} tok`,
            `• Instruções Dinâmicas (${modsLabel}): ${comp.dynamicInstructionTokens ?? 0} tok`,
            `• LIVE APP STATE: ${comp.liveAppStateTokens ?? 0} tok`,
            `• Histórico Recente: ${comp.conversationHistoryTokens ?? 0} tok`,
            `• Resumo de Histórico Antigo: ${comp.summaryTokens ?? 0} tok`,
            `• Input do Usuário / Anexos: ${comp.userInputTokens ?? 0} tok`,
            `• Output Gerado: ${comp.outputTokens ?? cTok} tok`
          ].join("\n");
          actions.appendChild(tokSpan);
        }
      } else {
        const timeSpan = document.createElement("span");
        timeSpan.className = "ai-msg-time";
        timeSpan.textContent = "just now";
        actions.append(timeSpan, copyBtn);
      }

      if (isModel && msg.proposal && Array.isArray(msg.proposal.actions) && msg.proposal.actions.length > 0) {
        const proposal = msg.proposal;
        const cardEl = document.createElement("div");
        cardEl.className = `ai-action-card status-${proposal.status || "pending"}`;

        const renderStepIconSvg = status => {
          if (status === "done") {
            return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.35" opacity="0.85"/><path class="ai-step-check-stroke" d="M6.8 10.2 9.1 12.5 13.4 7.8" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
          }
          if (status === "in_progress") {
            return `<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="ai-step-dot d1" cx="7.2" cy="7.2" r="1.85"/><circle class="ai-step-dot d2" cx="12.8" cy="7.2" r="1.85"/><circle class="ai-step-dot d3" cx="12.8" cy="12.8" r="1.85"/><circle class="ai-step-dot d4" cx="7.2" cy="12.8" r="1.85"/></svg>`;
          }
          if (status === "failed") {
            return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.35" opacity="0.85"/><path class="ai-step-check-stroke" d="M7.4 7.4 12.6 12.6M12.6 7.4 7.4 12.6" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"/></svg>`;
          }
          return `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.35"/></svg>`;
        };

        const head = document.createElement("div");
        head.className = "ai-action-card-head";
        const totalSteps = proposal.actions.length;
        const doneStepsInitial = Array.isArray(proposal.results)
          ? proposal.results.filter(r => r?.ok).length
          : 0;
        const badgeText =
          proposal.status === "approved"
            ? `${doneStepsInitial}/${totalSteps} ✓`
            : proposal.status === "running"
              ? `0/${totalSteps}`
              : proposal.status === "rejected"
                ? "Recusado"
                : `${totalSteps} ${totalSteps === 1 ? "ação" : "ações"}`;
        head.innerHTML = `<span class="ai-action-card-title">${escapeHtml(proposal.summary || "Ações no app")}</span><span class="ai-action-status-pill">${badgeText}</span>`;
        cardEl.appendChild(head);

        const progressWrap = document.createElement("div");
        progressWrap.className = "ai-action-progress-bar";
        const progressFill = document.createElement("div");
        progressFill.className = "ai-action-progress-fill";
        progressFill.style.width =
          proposal.status === "approved"
            ? "100%"
            : proposal.status === "running"
              ? "8%"
              : "0%";
        progressWrap.appendChild(progressFill);
        cardEl.appendChild(progressWrap);

        const list = document.createElement("ul");
        list.className = "ai-action-list";
        const displayGroups = buildCompactStepGroups(proposal);
        const COLLAPSE_LIMIT = 4;
        const canCollapse = proposal.status !== "running" && displayGroups.length > COLLAPSE_LIMIT + 1;
        let isExpanded = Boolean(proposal._expanded);

        const stepRows = new Array(proposal.actions.length);
        const rowElements = displayGroups.map((grp, gIdx) => {
          const li = document.createElement("li");
          li.className = `ai-step-row state-${grp.state}${grp.destructive ? " destructive" : ""}`;
          li.style.setProperty("--step-idx", String(gIdx));
          if (canCollapse && !isExpanded && gIdx >= COLLAPSE_LIMIT) {
            li.hidden = true;
          }

          const iconEl = document.createElement("span");
          iconEl.className = "ai-step-icon";
          iconEl.innerHTML = renderStepIconSvg(grp.state);

          const textEl = document.createElement("span");
          textEl.className = "ai-step-text";
          textEl.textContent = grp.text;

          li.append(iconEl, textEl);
          if (grp.count > 1) {
            const countBadge = document.createElement("span");
            countBadge.className = "ai-step-count-badge";
            countBadge.textContent = `×${grp.count}`;
            li.appendChild(countBadge);
          }

          list.appendChild(li);
          grp.indices.forEach(origIdx => {
            stepRows[origIdx] = { li, iconEl, textEl, act: grp.act };
          });
          return li;
        });
        cardEl.appendChild(list);

        if (canCollapse) {
          const toggleMoreBtn = document.createElement("button");
          toggleMoreBtn.type = "button";
          toggleMoreBtn.className = "ai-action-expand-btn";
          const hiddenCount = displayGroups.length - COLLAPSE_LIMIT;
          const syncExpandLabel = () => {
            toggleMoreBtn.textContent = isExpanded
              ? "Mostrar menos ▴"
              : `Ver mais ${hiddenCount} ${hiddenCount === 1 ? "etapa" : "etapas"} ▾`;
          };
          syncExpandLabel();
          toggleMoreBtn.addEventListener("click", () => {
            isExpanded = !isExpanded;
            proposal._expanded = isExpanded;
            rowElements.forEach((el, idx) => {
              if (idx >= COLLAPSE_LIMIT) el.hidden = !isExpanded;
            });
            syncExpandLabel();
          });
          cardEl.appendChild(toggleMoreBtn);
        }

        const runProposalExecution = async footEl => {
          const undoBatchId = `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          workspaceUndoStack.capture(undoBatchId, state);
          proposal.undoBatchId = undoBatchId;
          proposal.undone = false;

          proposal.status = "running";
          proposal.stepStates = proposal.actions.map(() => "pending");
          cardEl.className = "ai-action-card status-running";
          const pill = head.querySelector(".ai-action-status-pill");
          if (pill) pill.textContent = `0/${totalSteps}`;
          progressFill.style.width = "10%";
          footEl?.remove();

          let completedCount = 0;
          const createdChainIds = new Set();
          const results = await executeAiActionPlan(proposal.actions, {
            onStepUpdate: ({ index, status, message }) => {
              proposal.stepStates[index] = status;
              const target = stepRows[index];
              if (!target) return;
              target.li.className = `ai-step-row state-${status}${isDestructiveAction(target.act) ? " destructive" : ""}`;
              target.iconEl.innerHTML = renderStepIconSvg(status);
              if (message) {
                target.textEl.textContent = message;
              }
              if (status === "done" || status === "failed") {
                completedCount += 1;
                const pct = Math.round((completedCount / totalSteps) * 100);
                progressFill.style.width = `${pct}%`;
                if (pill) pill.textContent = `${completedCount}/${totalSteps}`;
              }
            },
            runAction: async (action, ctx) => {
              await new Promise(resolve => setTimeout(resolve, 180));
              const out = await runSingleAiAppAction(action, ctx);
              if (out?.createdCardId) {
                if (out.parentCardId) createdChainIds.add(out.parentCardId);
                createdChainIds.add(out.createdCardId);
                triggerAiCardBirthHighlight(out.createdCardId);
                focusNodesChainAnimated([...createdChainIds], { maxZoom: 1.06, padding: 88, durationMs: 440 });
              }
              await new Promise(resolve => setTimeout(resolve, 160));
              return out;
            }
          });

          if (createdChainIds.size > 0) {
            focusNodesChainAnimated([...createdChainIds], { maxZoom: 1.04, padding: 96, durationMs: 560 });
          }

          proposal.status = "approved";
          proposal.results = results;
          delete proposal.stepStates;
          const okCount = results.filter(r => r?.ok).length;
          persistenceService.logAiActivity({
            kind: "workspace_action",
            status: okCount === results.length ? "ok" : "partial",
            summary: proposal.summary || "Ações no workspace",
            detail: `${okCount}/${results.length} ações executadas`
          });
          saveChatSessions();
          await new Promise(resolve => setTimeout(resolve, 220));
          renderChatMessages();
        };

        if (proposal.status === "pending") {
          const needsPermission = proposalRequiresPermission(proposal);
          if (!needsPermission) {
            if (!proposal._autoStarted) {
              proposal._autoStarted = true;
              queueMicrotask(() => {
                runProposalExecution(null);
              });
            }
          } else {
            const previewDiffs = buildActionPreviewDiffs(proposal.actions, state);
            if (previewDiffs.length > 0) {
              const previewBox = document.createElement("div");
              previewBox.className = "ai-action-preview-list";
              previewBox.innerHTML = `<div class="ai-action-preview-title">Prévia das alterações</div>`;
              previewDiffs.forEach(d => {
                const item = document.createElement("div");
                item.className = "ai-action-preview-item";
                item.innerHTML = `<span class="ai-action-preview-before">${escapeHtml(d.before)}</span> → <span class="ai-action-preview-after">${escapeHtml(d.after)}</span>`;
                previewBox.appendChild(item);
              });
              cardEl.appendChild(previewBox);
            }

            const foot = document.createElement("div");
            foot.className = "ai-action-card-foot";

            const approveBtn = document.createElement("button");
            approveBtn.type = "button";
            approveBtn.className = "ai-action-approve-btn";
            approveBtn.textContent = "Permitir e executar";
            approveBtn.addEventListener("click", () => runProposalExecution(foot));

            const rejectBtn = document.createElement("button");
            rejectBtn.type = "button";
            rejectBtn.className = "ai-action-reject-btn";
            rejectBtn.textContent = "Recusar";
            rejectBtn.addEventListener("click", () => {
              proposal.status = "rejected";
              saveChatSessions();
              renderChatMessages();
            });

            foot.append(approveBtn, rejectBtn);
            cardEl.appendChild(foot);
          }
        } else if (proposal.status === "approved") {
          if (proposal.undone) {
            const tag = document.createElement("span");
            tag.className = "ai-action-undone-tag";
            tag.textContent = "Desfeito";
            head.appendChild(tag);
          } else if (proposal.undoBatchId && workspaceUndoStack.has(proposal.undoBatchId)) {
            const undoBtn = document.createElement("button");
            undoBtn.type = "button";
            undoBtn.className = "ai-action-undo-btn";
            undoBtn.textContent = "Desfazer";
            undoBtn.title = "Reverter todas as alterações deste bloco";
            undoBtn.addEventListener("click", () => {
              const restored = workspaceUndoStack.restore(proposal.undoBatchId);
              if (!restored) return;
              state = restored;
              proposal.undone = true;
              saveState();
              render();
              saveChatSessions();
              renderChatMessages();
            });
            head.appendChild(undoBtn);
          }
        }

        row.appendChild(cardEl);
        revealTargets.push(cardEl);
      }

      if (isModel && msg.questionSet && Array.isArray(msg.questionSet.questions) && msg.questionSet.questions.length > 0) {
        const qSet = msg.questionSet;
        const isAnswered = qSet.status === "answered";
        const draftSelections = {};
        qSet.questions.forEach(q => {
          const prev = qSet.answers?.[q.id];
          if (Array.isArray(prev) && prev.length) {
            draftSelections[q.id] = [...prev];
          } else if (prev !== undefined && prev !== null && prev !== "") {
            draftSelections[q.id] = [String(prev)];
          } else if (q.type === "toggle") {
            const on = Boolean(q.defaultValue);
            draftSelections[q.id] = [on ? (q.onLabel || "Sim") : (q.offLabel || "Não")];
          } else if (q.type === "slider") {
            const initial = q.defaultValue !== null && q.defaultValue !== undefined
              ? Number(q.defaultValue)
              : Math.round(((q.min ?? 0) + (q.max ?? 10)) / 2);
            draftSelections[q.id] = [String(initial)];
          } else if ((q.type === "text" || q.type === "date") && q.defaultValue) {
            draftSelections[q.id] = [String(q.defaultValue)];
          } else {
            draftSelections[q.id] = [];
          }
        });

        const qCard = document.createElement("div");
        qCard.className = `ai-question-card status-${qSet.status || "pending"}`;

        const qHead = document.createElement("div");
        qHead.className = "ai-question-head";
        qHead.innerHTML = `<span class="ai-question-head-title">${qSet.questions.length > 1 ? "Configure suas escolhas" : "Sua escolha"}</span><span class="ai-question-pill">${isAnswered ? "Enviado ✓" : "Interativo"}</span>`;
        qCard.appendChild(qHead);

        let submitBtn = null;
        let submitHint = null;
        const updateSubmitState = () => {
          if (!submitBtn) return;
          const answeredCount = qSet.questions.filter(q => (draftSelections[q.id] || []).length > 0).length;
          submitBtn.disabled = isAnswered || answeredCount === 0;
          if (submitHint) {
            submitHint.textContent = answeredCount > 0
              ? `${answeredCount} de ${qSet.questions.length} ${qSet.questions.length === 1 ? "selecionada" : "respondidas"}`
              : "Selecione e clique em enviar";
          }
        };

        const finalizeQuestionSet = () => {
          const formatted = formatQuestionAnswersMessage(qSet, draftSelections);
          if (!formatted) return;
          qSet.answers = {};
          qSet.questions.forEach(q => {
            qSet.answers[q.id] = [...(draftSelections[q.id] || [])];
          });
          qSet.status = "answered";
          saveChatSessions();
          renderChatMessages();
          sendChatMessage(formatted);
        };

        qSet.questions.forEach((q, qIdx) => {
          const group = document.createElement("div");
          group.className = `ai-question-group type-${q.type || "choice"}`;
          group.style.setProperty("--q-idx", String(qIdx));

          const promptEl = document.createElement("div");
          promptEl.className = "ai-question-prompt";
          promptEl.textContent = qSet.questions.length > 1 ? `${qIdx + 1}. ${q.prompt}` : q.prompt;
          group.appendChild(promptEl);

          const qType = q.type || (q.multiSelect ? "checkbox" : "choice");

          if (qType === "toggle") {
            const onLabel = q.onLabel || "Sim";
            const offLabel = q.offLabel || "Não";
            const isOn = () => (draftSelections[q.id]?.[0] || offLabel) === onLabel;

            const toggleBtn = document.createElement("button");
            toggleBtn.type = "button";
            toggleBtn.className = `ai-q-toggle${isOn() ? " is-on" : ""}`;
            toggleBtn.disabled = isAnswered;
            toggleBtn.setAttribute("role", "switch");
            toggleBtn.setAttribute("aria-checked", String(isOn()));
            toggleBtn.innerHTML = `<span class="ai-q-toggle-track"><span class="ai-q-toggle-thumb"></span></span><span class="ai-q-toggle-label">${escapeHtml(isOn() ? onLabel : offLabel)}</span>`;
            toggleBtn.addEventListener("click", () => {
              if (isAnswered || chatBusy) return;
              const nextOn = !isOn();
              draftSelections[q.id] = [nextOn ? onLabel : offLabel];
              toggleBtn.classList.toggle("is-on", nextOn);
              toggleBtn.setAttribute("aria-checked", String(nextOn));
              const lbl = toggleBtn.querySelector(".ai-q-toggle-label");
              if (lbl) lbl.textContent = nextOn ? onLabel : offLabel;
              updateSubmitState();
            });
            group.appendChild(toggleBtn);
          } else if (qType === "slider") {
            const min = q.min ?? 0;
            const max = q.max ?? 10;
            const step = q.step ?? 1;
            const currentVal = Number(draftSelections[q.id]?.[0] ?? min);

            const sliderWrap = document.createElement("div");
            sliderWrap.className = "ai-q-slider-wrap";

            const sliderHead = document.createElement("div");
            sliderHead.className = "ai-q-slider-meta";
            const minLbl = document.createElement("span");
            minLbl.textContent = `${min}${q.unit || ""}`;
            const valPill = document.createElement("span");
            valPill.className = "ai-q-slider-value";
            valPill.textContent = `${currentVal}${q.unit || ""}`;
            const maxLbl = document.createElement("span");
            maxLbl.textContent = `${max}${q.unit || ""}`;
            sliderHead.append(minLbl, valPill, maxLbl);

            const rangeInput = document.createElement("input");
            rangeInput.type = "range";
            rangeInput.className = "ai-q-slider-input";
            rangeInput.min = String(min);
            rangeInput.max = String(max);
            rangeInput.step = String(step);
            rangeInput.value = String(currentVal);
            rangeInput.disabled = isAnswered;
            rangeInput.addEventListener("input", () => {
              const v = rangeInput.value;
              draftSelections[q.id] = [v];
              valPill.textContent = `${v}${q.unit || ""}`;
              updateSubmitState();
            });

            sliderWrap.append(sliderHead, rangeInput);
            group.appendChild(sliderWrap);
          } else if (qType === "rating") {
            const maxStars = Math.max(3, Math.min(10, q.max || 5));
            const starsWrap = document.createElement("div");
            starsWrap.className = "ai-q-rating";

            const syncStars = (hoverVal = 0) => {
              const picked = Number(draftSelections[q.id]?.[0] || 0);
              const activeVal = hoverVal || picked;
              starsWrap.querySelectorAll(".ai-q-star").forEach(btn => {
                const n = Number(btn.dataset.star);
                btn.classList.toggle("active", n <= activeVal);
                btn.classList.toggle("selected", n <= picked);
              });
            };

            for (let s = 1; s <= maxStars; s++) {
              const starBtn = document.createElement("button");
              starBtn.type = "button";
              starBtn.className = "ai-q-star";
              starBtn.dataset.star = String(s);
              starBtn.disabled = isAnswered;
              starBtn.title = `${s} de ${maxStars}`;
              starBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6 6.2 20.7l1.1-6.5-4.7-4.6 6.5-.9L12 2.8z"/></svg>`;
              starBtn.addEventListener("mouseenter", () => !isAnswered && syncStars(s));
              starBtn.addEventListener("mouseleave", () => !isAnswered && syncStars(0));
              starBtn.addEventListener("click", () => {
                if (isAnswered || chatBusy) return;
                draftSelections[q.id] = [String(s)];
                syncStars(0);
                updateSubmitState();
              });
              starsWrap.appendChild(starBtn);
            }
            syncStars(0);
            group.appendChild(starsWrap);
          } else if (qType === "text" || qType === "date") {
            const field = document.createElement("input");
            field.type = qType === "date" ? "date" : "text";
            field.className = "ai-question-custom-input ai-q-field";
            field.value = draftSelections[q.id]?.[0] || "";
            field.placeholder = q.placeholder || (qType === "date" ? "YYYY-MM-DD" : "Digite sua resposta...");
            field.disabled = isAnswered;
            field.addEventListener("input", () => {
              const val = field.value.trim();
              draftSelections[q.id] = val ? [val] : [];
              updateSubmitState();
            });
            group.appendChild(field);
          } else {
            const isChips = qType === "chips";
            const isMulti = qType === "checkbox" || Boolean(q.multiSelect);
            const optsWrap = document.createElement("div");
            optsWrap.className = isChips ? "ai-question-chips" : "ai-question-options";

            const syncOptionClasses = () => {
              const picked = draftSelections[q.id] || [];
              optsWrap.querySelectorAll(".ai-question-opt, .ai-question-chip").forEach(btn => {
                const active = picked.includes(btn.dataset.value);
                btn.classList.toggle("selected", active);
                btn.setAttribute("aria-pressed", String(active));
              });
            };

            q.options.forEach((opt, optIdx) => {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = isChips
                ? `ai-question-chip${isMulti ? " multi" : ""}`
                : `ai-question-opt${isMulti ? " multi" : ""}`;
              btn.dataset.value = opt.value;
              btn.disabled = isAnswered;
              btn.style.setProperty("--opt-idx", String(optIdx));

              if (isChips) {
                btn.innerHTML = `<span class="ai-chip-dot"></span><span>${escapeHtml(opt.label)}</span>`;
              } else {
                const indicator = document.createElement("span");
                indicator.className = `ai-question-indicator${isMulti ? " multi" : ""}`;
                indicator.innerHTML = isMulti
                  ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`
                  : `<span class="ai-radio-dot"></span>`;

                const textWrap = document.createElement("span");
                textWrap.className = "ai-question-opt-text";
                const labelRow = document.createElement("span");
                labelRow.className = "ai-question-opt-label-row";
                const labelEl = document.createElement("span");
                labelEl.className = "ai-question-opt-label";
                labelEl.textContent = opt.label;
                labelRow.appendChild(labelEl);
                if (opt.badge) {
                  const badgeEl = document.createElement("span");
                  badgeEl.className = "ai-question-opt-badge";
                  badgeEl.textContent = opt.badge;
                  labelRow.appendChild(badgeEl);
                }
                textWrap.appendChild(labelRow);
                if (opt.description) {
                  const descEl = document.createElement("span");
                  descEl.className = "ai-question-opt-desc";
                  descEl.textContent = opt.description;
                  textWrap.appendChild(descEl);
                }
                btn.append(indicator, textWrap);
              }

              btn.addEventListener("click", () => {
                if (isAnswered || chatBusy) return;
                if (isMulti) {
                  const cur = draftSelections[q.id] || [];
                  draftSelections[q.id] = cur.includes(opt.value)
                    ? cur.filter(v => v !== opt.value)
                    : [...cur, opt.value];
                } else {
                  draftSelections[q.id] = [opt.value];
                }
                syncOptionClasses();
                updateSubmitState();
              });

              optsWrap.appendChild(btn);
            });

            syncOptionClasses();
            group.appendChild(optsWrap);

            if (q.allowCustom && !isAnswered) {
              const customRow = document.createElement("div");
              customRow.className = "ai-question-custom-row";

              const customInput = document.createElement("input");
              customInput.type = "text";
              customInput.className = "ai-question-custom-input";
              customInput.placeholder = "Outro (digite sua resposta)...";

              customInput.addEventListener("input", () => {
                const val = customInput.value.trim();
                const presetVals = new Set(q.options.map(o => o.value));
                const keptPresets = (draftSelections[q.id] || []).filter(v => presetVals.has(v));
                if (isMulti) {
                  draftSelections[q.id] = val ? [...keptPresets, val] : keptPresets;
                } else if (val) {
                  draftSelections[q.id] = [val];
                  syncOptionClasses();
                } else {
                  draftSelections[q.id] = keptPresets;
                }
                updateSubmitState();
              });

              customRow.appendChild(customInput);
              group.appendChild(customRow);
            }
          }

          qCard.appendChild(group);
        });

        if (!isAnswered) {
          const foot = document.createElement("div");
          foot.className = "ai-question-foot";
          submitHint = document.createElement("span");
          submitHint.className = "ai-question-foot-hint";
          submitBtn = document.createElement("button");
          submitBtn.type = "button";
          submitBtn.className = "ai-action-approve-btn";
          submitBtn.textContent = qSet.questions.length > 1 ? "Enviar respostas" : "Enviar resposta";
          submitBtn.addEventListener("click", finalizeQuestionSet);
          foot.append(submitHint, submitBtn);
          qCard.appendChild(foot);
          updateSubmitState();
        }

        row.appendChild(qCard);
        revealTargets.push(qCard);
      }

      if (isModel && msg.coachAdvice) {
        const coachCard = buildCoachAdviceCard(msg.coachAdvice, {
          animate: false,
          timestamp: msg.createdAt || null
        });
        row.appendChild(coachCard);
        revealTargets.push(coachCard);
      }

      if (!msg.coachAdvice) {
        row.appendChild(actions);
        revealTargets.push(actions);
      }
      chatMessagesEl.appendChild(row);

      if (shouldAnimateTyping && bubbleEl) {
        startAiTypingAnimation({ msg, bubbleEl, rowEl: row, revealTargets });
      }
    });

    syncChatModelLabel();
    updateChatTokenCounter();

    if (chatBusy) {
      const working = document.createElement("div");
      working.className = "ai-chat-working grok-thinking-badge";
      const canvas = document.createElement("canvas");
      canvas.className = "grok-canvas-20";
      canvas.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "grok-shimmer-text";
      label.textContent = activeChatThinkingSteps[0] || AI_CHAT_THINKING_PHRASES[0];
      working.appendChild(canvas);
      working.appendChild(label);
      chatMessagesEl.appendChild(working);
      chatGrokLoader = new GrokDodecahedronRenderer(canvas, { size: 24, speed: 1.65, intensity: 1 });
      chatGrokLoader.start();
      chatThinkingCycler.start(label, activeChatThinkingSteps);
    }

    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function formatTokenCountCompact(count) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function updateChatTokenCounter() { }

  async function sendChatMessage(rawText) {
    const text = String(rawText || "").trim();
    if ((!text && !pendingAttachments.length) || chatBusy) return;

    const session = getActiveSession();
    const currentAttachments = pendingAttachments.map(att => ({
      name: att.name,
      mime_type: att.mime_type,
      data_base64: att.data_base64 || "",
      text_content: att.text_content || ""
    }));
    pendingAttachments = [];
    renderPendingAttachments();

    if (session.messages.length === 0) {
      session.title = buildAutoSessionTitle(text, currentAttachments);
    }

    session.messages.push({
      role: "user",
      text,
      attachments: currentAttachments
    });
    session.updatedAt = new Date().toISOString();

    chatSessions = [session, ...chatSessions.filter(s => s.id !== session.id)];
    saveChatSessions();
    renderSessionsList();

    if (chatInput) chatInput.value = "";
    const willCaptureScreen = Boolean(
      currentMode === "chat" &&
      (alwaysSeeScreen || shouldAutoCaptureScreen(text))
    );
    const relevantAppAttachments = collectRelevantAppAttachments(state, text, selectedNodeId, 4);
    activeChatThinkingSteps = buildChatThinkingSteps({
      text,
      attachments: currentAttachments,
      appAttachments: relevantAppAttachments,
      willCaptureScreen
    });
    const reqId = ++activeChatRequestId;
    chatBusy = true;
    chatSendAiLoader?.setMood("thinking");
    chatHasUnread = false;
    syncChatSendButtonState();
    updateChatTopbarIndicator();
    renderChatMessages();

    try {
      let reply = "";
      let usedModel = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let totalTokens = 0;
      let estimatedBreakdown = null;
      let loadedModules = ["core"];
      if (invoke) {
        const convOpt = conversationContextManager.buildOptimizedConversationPayload(
          session.messages,
          text
        );
        let payloadMessages = convOpt.payloadMessages;
        if (
          willCaptureScreen &&
          payloadMessages.length > 0
        ) {
          try {
            const screenBase64 = await invoke("capture_current_monitor_png");
            if (screenBase64) {
              let screenMime = "image/png";
              let finalScreenB64 = screenBase64;
              const compressed = await compressImageDataUrl(
                `data:image/png;base64,${screenBase64}`,
                "image/png",
                1280
              );
              if (compressed && compressed.data_base64) {
                screenMime = compressed.mime_type;
                finalScreenB64 = compressed.data_base64;
              }
              const lastMsg = payloadMessages[payloadMessages.length - 1];
              if (lastMsg && lastMsg.role === "user") {
                lastMsg.attachments = [
                  ...(lastMsg.attachments || []),
                  {
                    name: "current_screen.jpg",
                    mime_type: screenMime,
                    data_base64: finalScreenB64,
                    text_content: ""
                  }
                ];
              }
            }
          } catch (screenErr) {
            console.warn("Falha ao capturar tela atual para o mini chat:", screenErr);
          }
        }
        const rawAppContext = await workspaceContextService.buildEnrichedContextJson(state, {
          selectedNodeId,
          activeSessionId: session.id,
          userPrompt: text,
          hasAttachments: currentAttachments.length > 0,
          hasAppAttachments: relevantAppAttachments.length > 0,
          willCaptureScreen,
          operatorProfile: localStorage.getItem("todocompanion.settings.aiOperatorProfile") || "",
          settings: {
            theme: localStorage.getItem("todocompanion.settings.theme") || "claude-dark",
            cardFontSize: Number(localStorage.getItem("todocompanion.settings.cardFontSize") || 14),
            linkStyle: localStorage.getItem("todocompanion.settings.linkStyle") || "orthogonal",
            linkArrows: localStorage.getItem("todocompanion.settings.linkArrows") !== "false",
            translatorMode: localStorage.getItem("todocompanion.settings.translatorMode") || "manual"
          }
        });
        const parsedContextObj = JSON.parse(rawAppContext || "{}");
        loadedModules = Array.isArray(parsedContextObj.activeModules) && parsedContextObj.activeModules.length
          ? parsedContextObj.activeModules
          : ["core"];
        const composedPrompt = promptModuleRegistry.composeSystemPrompt({
          modules: loadedModules,
          appContextJson: rawAppContext
        });
        const budgeted = tokenBudgetManager.enforceBudget({
          systemCoreTokens: composedPrompt.coreTokensEstimate,
          dynamicInstructionTokens: composedPrompt.dynamicTokensEstimate,
          appContextObj: parsedContextObj,
          payloadMessages,
          summaryText: convOpt.summaryText
        });
        const appContext = budgeted.appContextJson;
        payloadMessages = budgeted.payloadMessages;
        estimatedBreakdown = budgeted.breakdown;
        const res = await invoke("ai_chat_english", {
          messages: payloadMessages,
          formality,
          apiKey: localStorage.getItem(GEMINI_API_KEY_STORAGE) || null,
          appContext,
          appAttachments: relevantAppAttachments,
          preferredModel: selectedChatModel === "auto" ? null : selectedChatModel
        });
        if (res && typeof res === "object") {
          reply = String(res.text || "");
          usedModel = String(res.model || "");
          promptTokens = Number(res.prompt_tokens) || 0;
          completionTokens = Number(res.completion_tokens) || 0;
          totalTokens = Number(res.total_tokens) || promptTokens + completionTokens;
        } else {
          reply = String(res || "");
        }
      } else {
        reply = await fallbackBrowserTranslate(text || "Analyze attached file", formality, "auto");
        usedModel = DEFAULT_ENV_GEMINI_MODEL;
      }

      if (reqId !== activeChatRequestId) return;

      const { cleanText: afterActionsText, proposal } = extractAiActionProposal(String(reply || ""));
      const { cleanText, questionSet } = extractAiQuestions(afterActionsText);
      const cleaned =
        cleanText ||
        (proposal ? proposal.summary : questionSet ? "" : "(No response)");
      const previousSelectedModel = selectedChatModel;
      const didFallbackFromSelected =
        previousSelectedModel !== "auto" &&
        Boolean(usedModel) &&
        usedModel !== previousSelectedModel;

      if (didFallbackFromSelected) {
        modelQuotaMap.set(previousSelectedModel, {
          model: previousSelectedModel,
          status: "exhausted",
          remaining_seconds: 1800,
          quota_label: "Sem cota"
        });
        if (AI_CHAT_MODEL_OPTIONS.some(opt => opt.value === usedModel)) {
          selectedChatModel = usedModel;
          persistenceService.saveSetting(AI_CHAT_MODEL_KEY, selectedChatModel);
          syncChatModelLabel();
        }
      }

      const tokenMetrics = TokenMetricsMonitor.reconcileWithActualUsage(
        estimatedBreakdown,
        promptTokens,
        completionTokens,
        usedModel
      );

      const newAiMsg = {
        role: "model",
        text: cleaned,
        model: usedModel,
        requestedModel: didFallbackFromSelected ? previousSelectedModel : "",
        promptTokens,
        completionTokens,
        totalTokens,
        activeModules: loadedModules,
        tokenMetrics,
        attachments: [],
        proposal: proposal || null,
        questionSet: questionSet || null
      };
      session.messages.push(newAiMsg);
      if (!panel.hidden && currentMode === "chat") {
        animatingMessageRef = newAiMsg;
      }
      session.updatedAt = new Date().toISOString();
      if (panel.hidden || currentMode !== "chat") {
        chatHasUnread = true;
      }
      saveChatSessions();
      renderSessionsList();
      persistenceService.logAiActivity({
        kind: "chat",
        model: usedModel,
        status: "ok",
        summary: String(text || "(anexo)").slice(0, 120),
        detail: cleaned.slice(0, 200),
        promptTokens,
        completionTokens,
        totalTokens
      });
      if (proposal && proposalRequiresPermission(proposal)) {
        chatSendAiLoader?.setMood("alert", { durationMs: 5000 });
      } else {
        chatSendAiLoader?.setMood("happy", { durationMs: 3800 });
      }
    } catch (err) {
      if (reqId !== activeChatRequestId) return;
      const errMsg = String(err?.message || err);
      chatSendAiLoader?.setMood("angry", { durationMs: 5000 });
      persistenceService.logAiActivity({
        kind: "chat",
        model: "",
        status: "error",
        summary: String(text || "(anexo)").slice(0, 120),
        detail: errMsg.slice(0, 300)
      });
      session.messages.push({
        role: "model",
        text: `Error: ${errMsg}`,
        attachments: []
      });
      if (panel.hidden || currentMode !== "chat") {
        chatHasUnread = true;
      }
      saveChatSessions();
    } finally {
      if (reqId === activeChatRequestId) {
        chatBusy = false;
        syncChatSendButtonState();
        updateChatTopbarIndicator();
        refreshModelsQuotaStatus();
        renderChatMessages();
        if (!panel.hidden && currentMode === "chat") {
          chatInput?.focus();
        }
      }
    }
  }

  function setLiveCoachIcon(active) {
    if (!liveCoachBtn) return;
    liveCoachBtn.innerHTML = active
      ? `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 3C11 7.97 15.03 12 20 12C15.03 12 11 16.03 11 21C11 16.03 6.97 12 2 12C6.97 12 11 7.97 11 3Z"/>
          <path d="M19 2C19 4.21 20.79 6 23 6C20.79 6 19 7.79 19 10C19 7.79 17.21 6 15 6C17.21 6 19 4.21 19 2Z"/>
        </svg><span>Live Coach</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <path d="M12 19v3"/>
        </svg><span>Live Coach</span>`;
  }

  const liveCoach = new LiveEnglishCoachController({
    invoke,
    getApiKey: () => localStorage.getItem(GEMINI_API_KEY_STORAGE) || null,
    getOutputMode: () => liveCoachOutputMode,
    onUsage: usage => {
      liveCoachTokenTotal += Number(usage?.totalTokens) || 0;
      if (liveCoachTokenCountEl) {
        liveCoachTokenCountEl.textContent = `${liveCoachTokenTotal.toLocaleString()} tokens`;
      }
    },
    onStatusChange: ({ active, busy, label }) => {
      if (liveCoachBtn) {
        liveCoachBtn.classList.toggle("is-live", active);
        liveCoachBtn.setAttribute("aria-pressed", String(active));
        setLiveCoachIcon(active);
      }
      if (liveCoachViewEl && regularChatViewEl) {
        const entering = active && liveCoachViewEl.hidden;
        liveCoachViewEl.hidden = !active;
        regularChatViewEl.hidden = active;
        if (entering) {
          liveCoachAdviceHistory = [];
          renderLiveCoachAdviceHistory();
          liveCoachMessagesEl.scrollTop = 0;
          if (liveCoachThinkingCanvas) {
            liveCoachGrokLoader?.stop();
            liveCoachGrokLoader = new GrokDodecahedronRenderer(liveCoachThinkingCanvas, {
              size: 72,
              speed: 1,
              intensity: 0.85,
              colorRgb: null
            });
            liveCoachGrokLoader.start();
          }
          if (!liveCoachAudioLevelTimer && invoke) {
            let liveCoachHearingUntil = 0;
            liveCoachAudioLevelTimer = window.setInterval(async () => {
              if (!liveCoachGrokLoader || liveCoachIsBusy) return;
              try {
                const level = Number(await invoke("ai_audio_capture_level")) || 0;
                const now = Date.now();
                if (level >= 0.025) {
                  liveCoachHearingUntil = now + 500;
                }
                const isHearing = now < liveCoachHearingUntil;
                const hearingRgb =
                  document.documentElement?.dataset?.theme === "light-claude"
                    ? "22, 163, 74"
                    : "74, 222, 128";
                if (isHearing) {
                  liveCoachGrokLoader.setState({
                    speed: 1.55 + Math.min(1, level) * 1.1,
                    intensity: 1,
                    colorRgb: hearingRgb
                  });
                } else {
                  liveCoachGrokLoader.setState({
                    speed: 1,
                    intensity: 0.85,
                    colorRgb: null
                  });
                }
              } catch (_) { }
            }, 100);
          }
        } else if (!active) {
          if (liveCoachAudioLevelTimer) {
            window.clearInterval(liveCoachAudioLevelTimer);
            liveCoachAudioLevelTimer = 0;
          }
          if (liveCoachGrokLoader) {
            liveCoachGrokLoader.stop();
            liveCoachGrokLoader = null;
          }
        }
      }
      liveCoachIsBusy = Boolean(active && busy);
      if (liveCoachStatusEl && label) {
        liveCoachStatusEl.textContent = label;
      }
      if (!active) {
        setLiveCoachMenuOpen(false);
      }
      if (active && liveCoachGrokLoader) {
        if (busy) {
          liveCoachGrokLoader.setState({
            speed: 1.9,
            intensity: 1,
            colorRgb: null
          });
        } else {
          liveCoachGrokLoader.setState({
            speed: 1,
            intensity: 0.85,
            colorRgb: null
          });
        }
        if (liveCoachThinkingCanvas) {
          liveCoachThinkingCanvas.title = label || (busy ? "Analyzing..." : "Listening...");
        }
      }
    },
    onAdvice: advice => {
      const nowIso = new Date().toISOString();
      appendCoachAdviceWithoutFlicker(advice, nowIso);
    },
    onError: errMsg => {
      if (liveCoachStatusEl) {
        liveCoachStatusEl.textContent = `Error: ${errMsg.slice(0, 80)}`;
      }
    }
  });

  liveCoachBtn?.addEventListener("click", () => {
    if (!liveCoach.active) {
      liveCoachTokenTotal = 0;
      if (liveCoachTokenCountEl) liveCoachTokenCountEl.textContent = "0 tokens";
    }
    liveCoach.toggle();
  });

  liveCoachNowBtn?.addEventListener("click", () => {
    liveCoach.flushNow({ immediate: true });
  });

  liveCoachStopBtn?.addEventListener("click", () => {
    setLiveCoachMenuOpen(false);
    liveCoach.stop();
  });

  function syncLiveCoachModeUi() {
    liveCoachModeEl?.querySelectorAll("[data-coach-mode]").forEach(btn => {
      const active = btn.dataset.coachMode === liveCoachMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function syncLiveCoachOutputModeUi() {
    liveCoachOutputModeEl?.querySelectorAll("[data-output-mode]").forEach(btn => {
      const active = btn.dataset.outputMode === liveCoachOutputMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    if (liveCoachToneSection) {
      liveCoachToneSection.hidden = liveCoachOutputMode !== "reply";
    }
  }

  function setLiveCoachMenuOpen(open) {
    if (!liveCoachMenu || !liveCoachMenuTrigger) return;
    liveCoachMenu.hidden = !open;
    liveCoachMenuTrigger.setAttribute("aria-expanded", String(open));
  }

  liveCoachMenuTrigger?.addEventListener("click", () => {
    setLiveCoachMenuOpen(Boolean(liveCoachMenu?.hidden));
  });
  document.addEventListener("pointerdown", event => {
    if (
      liveCoachMenu &&
      !liveCoachMenu.hidden &&
      !liveCoachMenu.contains(event.target) &&
      !liveCoachMenuTrigger?.contains(event.target)
    ) {
      setLiveCoachMenuOpen(false);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && liveCoachMenu && !liveCoachMenu.hidden) {
      setLiveCoachMenuOpen(false);
      liveCoachMenuTrigger?.focus();
    }
  });

  syncLiveCoachModeUi();
  syncLiveCoachOutputModeUi();
  liveCoachModeEl?.querySelectorAll("[data-coach-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.coachMode === "formal" ? "formal" : "natural";
      if (mode === liveCoachMode) return;
      liveCoachMode = mode;
      localStorage.setItem("todocompanion.settings.liveCoachMode", mode);
      syncLiveCoachModeUi();
      renderLiveCoachAdviceHistory();
      setLiveCoachMenuOpen(false);
    });
  });
  liveCoachOutputModeEl?.querySelectorAll("[data-output-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.outputMode === "reply" ? "reply" : "translation";
      if (mode === liveCoachOutputMode) return;
      liveCoachOutputMode = mode;
      localStorage.setItem("todocompanion.settings.liveCoachOutputMode", mode);
      syncLiveCoachOutputModeUi();
      liveCoachAdviceHistory = [];
      liveCoachMessagesEl?.querySelectorAll(".ai-chat-msg").forEach(row => row.remove());
      setLiveCoachMenuOpen(false);
      liveCoach.flushNow({ immediate: true });
    });
  });

  chatSendBtn?.addEventListener("click", event => {
    if (chatBusy) {
      event.preventDefault();
      event.stopPropagation();
      stopActiveChatRequest();
    }
  });

  chatForm?.addEventListener("submit", event => {
    event.preventDefault();
    if (chatBusy) {
      stopActiveChatRequest();
      return;
    }
    sendChatMessage(chatInput?.value);
  });

  chatInput?.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = `${Math.min(130, chatInput.scrollHeight)}px`;
  });

  chatInput?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatMessage(chatInput.value);
      chatInput.style.height = "auto";
    }
  });
}

function formatAiModelName(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return "Auto";
  return id
    .replace(/-preview$/i, "")
    .replace(/-a4b-it$/i, "")
    .replace(/-it$/i, "")
    .split("-")
    .map(part => {
      if (/^\d+(\.\d+)?[a-z]?$/i.test(part)) return part.toUpperCase();
      if (part.toLowerCase() === "er") return "ER";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function findUserByAction(action) {
  if (!state?.users?.length) return null;
  if (action.userId) {
    const byId = state.users.find(u => u.id === action.userId);
    if (byId) return byId;
  }
  if (action.userName) {
    const needle = String(action.userName).trim().toLowerCase();
    const byName = state.users.find(u => String(u.name || "").trim().toLowerCase() === needle)
      || state.users.find(u => String(u.name || "").trim().toLowerCase().includes(needle));
    if (byName) return byName;
  }
  return activeUser();
}

function findTaskByAction(action, ctx) {
  const user = findUserByAction(action);
  const searchUsers = user ? [user, ...state.users.filter(u => u.id !== user.id)] : state.users;
  const targetId = action.taskId === "$LAST_TASK" ? ctx?.lastCreatedTaskId : action.taskId;

  if (targetId) {
    for (const u of searchUsers) {
      const t = (u.tasks || []).find(task => task.id === targetId);
      if (t) return { user: u, task: t };
    }
  }
  if (action.taskTitle) {
    const needle = String(action.taskTitle).trim().toLowerCase();
    for (const u of searchUsers) {
      const t = (u.tasks || []).find(task => String(task.title || "").trim().toLowerCase() === needle)
        || (u.tasks || []).find(task => String(task.title || "").trim().toLowerCase().includes(needle));
      if (t) return { user: u, task: t };
    }
  }
  const curUser = activeUser();
  const curBoard = activeBoard();
  return curUser && curBoard ? { user: curUser, task: curBoard } : null;
}

let lastAiTouchedCardId = null;

function resolveCardIdRef(rawId, ctx) {
  const board = activeBoard();
  const fallbackBoardCardId = () => {
    if (lastAiTouchedCardId && board?.nodes?.some(n => n.id === lastAiTouchedCardId)) {
      return lastAiTouchedCardId;
    }
    if (selectedNodeId && board?.nodes?.some(n => n.id === selectedNodeId)) {
      return selectedNodeId;
    }
    if (board?.nodes?.length > 1) {
      return board.nodes[board.nodes.length - 1].id;
    }
    return board?.nodes?.[0]?.id || selectedNodeId || lastAiTouchedCardId;
  };
  if (!rawId || rawId === "$LAST_CARD") {
    return ctx?.lastCreatedCardId || fallbackBoardCardId();
  }
  if (typeof rawId === "string" && ctx?.cardRefs?.has(rawId)) {
    return ctx.cardRefs.get(rawId);
  }
  return rawId;
}

function chooseSmartPorts(fromNode, toNode) {
  if (!fromNode || !toNode) return ["out", "in"];
  const fw = fromNode.w || MIN_CARD_WIDTH;
  const fh = nodeHeight(fromNode);
  const tw = toNode.w || MIN_CARD_WIDTH;
  const th = nodeHeight(toNode);
  const dx = (toNode.x + tw / 2) - (fromNode.x + fw / 2);
  const dy = (toNode.y + th / 2) - (fromNode.y + fh / 2);
  if (Math.abs(dy) > Math.abs(dx) * 0.85) {
    return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  }
  return dx >= 0 ? ["out", "in"] : ["in", "out"];
}

function findNodeLocationAcrossApp(cardId, hintAction = null, ctx = null) {
  if (!state?.users?.length) return null;
  const effectiveId = cardId || resolveCardIdRef(null, ctx);
  if (!effectiveId) return null;
  if (hintAction && (hintAction.taskId || hintAction.taskTitle || hintAction.sourceTaskId || hintAction.sourceTaskTitle)) {
    const hinted = findTaskByAction(
      {
        userId: hintAction.userId || hintAction.sourceUserId,
        userName: hintAction.userName || hintAction.sourceUserName,
        taskId: hintAction.sourceTaskId || hintAction.taskId,
        taskTitle: hintAction.sourceTaskTitle || hintAction.taskTitle
      },
      ctx
    );
    if (hinted) {
      const node = (hinted.task.nodes || []).find(n => n.id === effectiveId)
        || (hinted.task.nodes || []).slice(1).reverse().find(n => String(n.body || "").toLowerCase().includes(String(effectiveId).toLowerCase()))
        || (effectiveId === "$LAST_CARD" ? hinted.task.nodes[hinted.task.nodes.length - 1] : null);
      if (node) return { user: hinted.user, task: hinted.task, node };
    }
  }
  for (const u of state.users) {
    for (const t of u.tasks || []) {
      const node = (t.nodes || []).find(n => n.id === effectiveId);
      if (node) return { user: u, task: t, node };
    }
  }
  // Fallback por texto ou ultimo card da task ativa
  const curUser = activeUser();
  const curBoard = activeBoard();
  if (curUser && curBoard && curBoard.nodes?.length) {
    const byText = curBoard.nodes.slice(1).reverse().find(n => String(n.body || "").toLowerCase().includes(String(effectiveId).toLowerCase()));
    if (byText) return { user: curUser, task: curBoard, node: byText };
    const lastNode = curBoard.nodes[curBoard.nodes.length - 1];
    if (lastNode) return { user: curUser, task: curBoard, node: lastNode };
  }
  return null;
}

function findFreeCardPosition(board, startX, startY, w = MIN_CARD_WIDTH, h = 144, gap = 48) {
  const GRID = 24;
  let x = Math.round((Number(startX) || 96) / GRID) * GRID;
  let y = Math.round((Number(startY) || 96) / GRID) * GRID;
  if (!board || !Array.isArray(board.nodes) || !board.nodes.length) {
    return { x, y };
  }
  if (!nodeCollidesWithOthers(board, "__new__", x, y, w, h, gap)) {
    return { x, y };
  }
  // Tenta descer na mesma coluna primeiro (mantendo alinhamento visual)
  for (let step = 1; step <= 40; step++) {
    const candY = y + step * (h + gap);
    if (!nodeCollidesWithOthers(board, "__new__", x, candY, w, h, gap)) {
      return { x, y: candY };
    }
  }
  // Fallback em espiral/grade para a direita
  for (let col = 1; col <= 15; col++) {
    const candX = x + col * (w + gap);
    for (let row = 0; row <= 20; row++) {
      const candY = y + row * (h + gap);
      if (!nodeCollidesWithOthers(board, "__new__", candX, candY, w, h, gap)) {
        return { x: candX, y: candY };
      }
    }
  }
  return { x, y };
}

const BOARD_DEPENDENT_AI_ACTIONS = new Set([
  "create_card",
  "create_table_card",
  "update_card",
  "delete_card",
  "duplicate_card",
  "focus_card",
  "connect_cards",
  "disconnect_cards",
  "organize_canvas",
  "center_canvas"
]);

function ensureActiveBoardForAiAction() {
  if (activeBoard()) return true;
  const user = activeUser() || state.users.find(u => (u.tasks || []).length) || null;
  const task = user?.tasks?.[0] || null;
  if (!user || !task) return false;
  state.activeUserId = user.id;
  user.activeTaskId = task.id;
  saveState();
  render();
  return true;
}

async function runSingleAiAppAction(action, ctx) {
  const GRID = 24;
  if (BOARD_DEPENDENT_AI_ACTIONS.has(action.type) && !ensureActiveBoardForAiAction()) {
    throw new Error("Nenhuma task disponível. Crie uma task primeiro.");
  }
  switch (action.type) {
    case "create_user": {
      const name = String(action.name || "").trim() || "Novo usuário";
      const user = { id: makeId("user"), name, activeTaskId: null, tasks: [] };
      state.users.push(user);
      state.activeUserId = user.id;
      saveState();
      render();
      return { message: `Usuário "${name}" criado` };
    }

    case "rename_user": {
      const user = findUserByAction(action);
      if (!user) throw new Error("Usuário não encontrado");
      const newName = String(action.newName || "").trim();
      if (!newName) throw new Error("Novo nome vazio");
      user.name = newName;
      saveState();
      render();
      return { message: `Usuário renomeado para "${newName}"` };
    }

    case "delete_user": {
      const user = findUserByAction(action);
      if (!user) throw new Error("Usuário não encontrado");
      const name = user.name;
      state.users = state.users.filter(u => u.id !== user.id);
      if (state.activeUserId === user.id) {
        state.activeUserId = state.users[0]?.id || null;
      }
      selectedNodeId = null;
      selectedLinkId = null;
      saveState();
      render();
      return { message: `Usuário "${name}" excluído` };
    }

    case "select_user": {
      const user = findUserByAction(action);
      if (!user) throw new Error("Usuário não encontrado");
      state.activeUserId = user.id;
      selectedNodeId = null;
      selectedLinkId = null;
      saveState();
      render();
      return { message: `Usuário "${user.name}" selecionado` };
    }

    case "create_task": {
      let user = findUserByAction(action);
      if (!user) {
        user = { id: makeId("user"), name: action.userName || "Default", activeTaskId: null, tasks: [] };
        state.users.push(user);
      }
      const title = String(action.title || "").trim() || "Nova task";
      const nextNum = Math.max(0, ...user.tasks.map(t => Number(t.number) || 0)) + 1;
      const rootId = makeId("root");
      const task = {
        id: makeId("board"),
        number: nextNum,
        title,
        status: normalizeStatus(action.status || "ongoing"),
        priority: normalizePriority(action.priority || "normal"),
        criticality: clamp(Number(action.criticality ?? 0), 0, 2),
        startDate: action.startDate || "",
        endDate: action.endDate || "",
        attachments: [],
        view: { panX: 80, panY: 80, zoom: 1 },
        nodes: [{ id: rootId, title, body: "", status: "ongoing", x: 96, y: 120, w: MIN_CARD_WIDTH, h: 96 }],
        links: []
      };
      user.tasks.push(task);
      state.activeUserId = user.id;
      user.activeTaskId = task.id;
      selectedNodeId = null;
      selectedLinkId = null;
      saveState();
      render();
      return { createdTaskId: task.id, message: `Task "${title}" criada em ${user.name}` };
    }

    case "update_task": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada");
      const { task } = found;
      if (action.title) {
        task.title = String(action.title).trim();
        if (task.nodes[0]) task.nodes[0].title = task.title;
      }
      if (action.status) task.status = normalizeStatus(action.status);
      if (action.priority) task.priority = normalizePriority(action.priority);
      if (action.criticality !== undefined) task.criticality = clamp(Number(action.criticality), 0, 2);
      if (action.startDate !== undefined) task.startDate = String(action.startDate || "");
      if (action.endDate !== undefined) task.endDate = String(action.endDate || "");
      saveState();
      render();
      return { message: `Task "${task.title}" atualizada` };
    }

    case "delete_task": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada");
      const { user, task } = found;
      user.tasks = user.tasks.filter(t => t.id !== task.id);
      if (user.activeTaskId === task.id) {
        user.activeTaskId = user.tasks[0]?.id || null;
      }
      selectedNodeId = null;
      selectedLinkId = null;
      saveState();
      render();
      return { message: `Task "${task.title}" excluída` };
    }

    case "duplicate_task": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada");
      const { user, task } = found;
      const clone = JSON.parse(JSON.stringify(task));
      const nextNum = Math.max(0, ...user.tasks.map(t => Number(t.number) || 0)) + 1;
      clone.id = makeId("board");
      clone.number = nextNum;
      clone.title = `${task.title} (cópia)`;
      const idMap = new Map();
      clone.nodes = (clone.nodes || []).map((n, idx) => {
        const nextId = makeId(idx === 0 ? "root" : "action");
        idMap.set(n.id, nextId);
        return { ...n, id: nextId, title: idx === 0 ? clone.title : n.title };
      });
      clone.links = (clone.links || []).map(l => ({
        ...l,
        id: makeId("link"),
        from: idMap.get(l.from) || l.from,
        to: idMap.get(l.to) || l.to
      }));
      user.tasks.push(clone);
      state.activeUserId = user.id;
      user.activeTaskId = clone.id;
      saveState();
      render();
      return { createdTaskId: clone.id, message: `Task duplicada como "${clone.title}"` };
    }

    case "select_task": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada");
      state.activeUserId = found.user.id;
      found.user.activeTaskId = found.task.id;
      selectedNodeId = null;
      selectedLinkId = null;
      saveState();
      render();
      centerCanvasOnTasks();
      return { message: `Task "${found.task.title}" aberta` };
    }

    case "create_table_card": {
      const target = (action.taskId || action.taskTitle || action.userName || action.userId)
        ? findTaskByAction(action, ctx)
        : (activeUser() && activeBoard() ? { user: activeUser(), task: activeBoard() } : null);
      const board = target?.task;
      if (!board) throw new Error("Nenhuma task encontrada para criar a tabela");

      const hasCheckboxes = Boolean(action.hasCheckboxes);
      let tableData;
      if (Array.isArray(action.rows) && action.rows.length > 0) {
        const preparedRows = action.rows.map(row => {
          const cells = Array.isArray(row)
            ? row.map(c => sanitizeAiTableCell(c))
            : [sanitizeAiTableCell(row)];
          if (hasCheckboxes) {
            const first = String(cells[0] || "").trim().toLowerCase();
            if (first !== "[ ]" && first !== "[x]" && first !== "true" && first !== "false") {
              cells.unshift("[ ]");
            }
          }
          return cells;
        });
        tableData = hasCheckboxes ? { rows: preparedRows, hasCheckboxes: true } : { rows: preparedRows };
      } else {
        tableData = hasCheckboxes ? createTodoTableData(3, 3) : createDefaultTableData(3, 3);
      }

      const token = serializeTableToken(tableData);
      const parentRef = action.parentCardId === "$LAST_CARD" ? ctx?.lastCreatedCardId : action.parentCardId;
      const parentId =
        parentRef && board.nodes.some(n => n.id === parentRef)
          ? parentRef
          : board.nodes[0]?.id || null;
      const id = makeId("action");
      const { w: cardW, h: cardH } = estimateTableCardDimensions(tableData);
      const rawPos = parentId ? getReplyActionPosition(board, parentId) : getViewportActionPosition();
      const freePos = findFreeCardPosition(board, rawPos.x, rawPos.y, cardW, cardH, 48);
      const newNode = {
        id,
        type: "table",
        title: "",
        body: token,
        status: normalizeStatus(action.status || "ongoing"),
        criticality: clamp(Number(action.criticality ?? 0), 0, 2),
        createdAt: new Date().toISOString(),
        x: freePos.x,
        y: freePos.y,
        w: cardW,
        h: cardH
      };
      const tableColor = normalizeCardColor(action.color);
      if (tableColor && tableColor !== "default") newNode.color = tableColor;
      if (parentId) {
        board.nodes.splice(getReplyInsertionIndex(board, parentId), 0, newNode);
        const link = { id: makeId("link"), from: parentId, to: id, fromPort: "out", toPort: "in" };
        if (action.parentRow != null) link.fromRow = Number(action.parentRow);
        if (action.targetRow != null) link.toRow = Number(action.targetRow);
        board.links.push(link);
      } else {
        board.nodes.push(newNode);
      }
      if (board === activeBoard()) {
        pendingCardPop.add(id);
        selectedNodeId = id;
      }
      lastAiTouchedCardId = id;
      saveState();
      render();
      const cardEl = nodesLayer.querySelector(`[data-id="${id}"]`);
      if (cardEl) {
        syncTableCardRowPorts(cardEl, newNode);
        renderLinks();
      }
      return {
        createdCardId: id,
        parentCardId: parentId || null,
        message: `${hasCheckboxes ? "Tabela Todo List" : "Tabela"} criada em "${board.title}"`
      };
    }

    case "create_card": {
      if (action.cardType === "table" || action.cardType === "todo_table") {
        return executeAiAppAction(
          {
            ...action,
            type: "create_table_card",
            hasCheckboxes: action.cardType === "todo_table" || Boolean(action.hasCheckboxes),
            rows: action.rows || action.tableRows
          },
          ctx
        );
      }
      const target = (action.taskId || action.taskTitle || action.userName || action.userId)
        ? findTaskByAction(action, ctx)
        : (activeUser() && activeBoard() ? { user: activeUser(), task: activeBoard() } : null);
      const board = target?.task;
      if (!board) throw new Error("Nenhuma task encontrada para criar o card");
      let bodyText = sanitizeAiCardBody(action.body || "");
      if (Array.isArray(action.tableRows) && action.tableRows.length > 0) {
        const cleanedRows = action.tableRows.map(row =>
          Array.isArray(row) ? row.map(c => sanitizeAiTableCell(c)) : [sanitizeAiTableCell(row)]
        );
        const token = serializeTableToken(
          action.hasCheckboxes
            ? { rows: cleanedRows, hasCheckboxes: true }
            : { rows: cleanedRows }
        );
        bodyText = bodyText ? `${bodyText}\n${token}` : token;
      }
      const explicitParent = action.parentCardId !== undefined && action.parentCardId !== null && action.parentCardId !== "";
      const hasGridCoords = action.gridCol != null || action.gridRow != null;
      const shouldConnectParent = action.connectParent !== false && (explicitParent || !hasGridCoords);
      const rawParentRef = explicitParent ? resolveCardIdRef(action.parentCardId, ctx) : null;
      const parentId = shouldConnectParent
        ? (rawParentRef && board.nodes.some(n => n.id === rawParentRef)
          ? rawParentRef
          : board.nodes[0]?.id || null)
        : null;
      const id = makeId("action");
      const { w: cardW, h: cardH } = estimateActionCardSize(bodyText);
      let freePos;
      if (hasGridCoords) {
        const GRID = 24;
        const rootNode = board.nodes[0] || { x: 120, y: 120, w: MIN_CARD_WIDTH, h: 144 };
        const col = Math.max(0, Number(action.gridCol) || 0);
        const row = Math.max(0, Number(action.gridRow) || 0);
        const colStep = MIN_CARD_WIDTH + 96;
        const rowStep = Math.max(DEFAULT_CARD_HEIGHT, cardH) + 72;
        const baseX = rootNode.x + (rootNode.w || MIN_CARD_WIDTH) + 96;
        const baseY = rootNode.y;
        const gx = Math.round((baseX + col * colStep) / GRID) * GRID;
        const gy = Math.round((baseY + row * rowStep) / GRID) * GRID;
        freePos = findFreeCardPosition(board, gx, gy, cardW, cardH, 36);
      } else {
        const rawPos = parentId ? getReplyActionPosition(board, parentId) : getViewportActionPosition();
        freePos = findFreeCardPosition(board, rawPos.x, rawPos.y, cardW, cardH, 48);
      }
      const newNode = {
        id,
        title: "",
        body: bodyText,
        status: normalizeStatus(action.status || "ongoing"),
        criticality: clamp(Number(action.criticality ?? 0), 0, 2),
        createdAt: new Date().toISOString(),
        x: freePos.x,
        y: freePos.y,
        w: cardW,
        h: cardH
      };
      const cardColor = normalizeCardColor(action.color);
      if (cardColor && cardColor !== "default") newNode.color = cardColor;
      if (parentId) {
        board.nodes.splice(getReplyInsertionIndex(board, parentId), 0, newNode);
        const parentNode = board.nodes.find(n => n.id === parentId);
        const [autoFrom, autoTo] = chooseSmartPorts(parentNode, newNode);
        const validPorts = new Set(["in", "out", "top", "bottom"]);
        const fPort = validPorts.has(action.fromPort) ? action.fromPort : autoFrom;
        const tPort = validPorts.has(action.toPort) ? action.toPort : autoTo;
        board.links.push({ id: makeId("link"), from: parentId, to: id, fromPort: fPort, toPort: tPort });
      } else {
        board.nodes.push(newNode);
      }
      if (typeof action.refId === "string" && action.refId.trim()) {
        ctx?.cardRefs?.set(action.refId.trim(), id);
      }
      if (board === activeBoard()) {
        pendingCardPop.add(id);
        selectedNodeId = id;
      }
      lastAiTouchedCardId = id;
      saveState();
      render();
      const cardEl = nodesLayer.querySelector(`[data-id="${id}"]`);
      if (cardEl) scheduleNodeHeightSync(id, cardEl);
      const label = shortCardLabel(bodyText, "Card");
      return { createdCardId: id, parentCardId: parentId || null, message: `Card "${label}" criado` };
    }

    case "update_card": {
      const targetId = resolveCardIdRef(action.cardId, ctx);
      const loc = findNodeLocationAcrossApp(targetId, action, ctx);
      if (!loc) throw new Error("Card não encontrado");
      const { node, task } = loc;
      lastAiTouchedCardId = node.id;
      if (action.body !== undefined) {
        setNodeContent(node, sanitizeAiCardBody(action.body));
      } else if (action.appendBody) {
        const cur = String(getNodeContent(node) || "").trim();
        const extra = sanitizeAiCardBody(action.appendBody);
        setNodeContent(node, cur ? `${cur}\n${extra}` : extra);
      }
      if (action.status) node.status = normalizeStatus(action.status);
      if (action.criticality !== undefined) node.criticality = clamp(Number(action.criticality), 0, 2);
      if (action.color !== undefined) {
        const nextColor = normalizeCardColor(action.color);
        if (nextColor === "default") delete node.color;
        else if (nextColor) node.color = nextColor;
      }
      if (node.type !== "table" && (action.body !== undefined || action.appendBody)) {
        const est = estimateActionCardSize(getNodeContent(node));
        node.w = Math.max(node.w || MIN_CARD_WIDTH, est.w);
        node.h = Math.max(node.h || 144, est.h);
      }
      saveState();
      render();
      const updatedEl = nodesLayer.querySelector(`[data-id="${node.id}"]`);
      if (updatedEl) scheduleNodeHeightSync(node.id, updatedEl);
      const label = shortCardLabel(getNodeContent(node), "Card");
      return { message: `Card "${label}" atualizado` };
    }

    case "delete_card": {
      const targetId = resolveCardIdRef(action.cardId, ctx);
      const loc = findNodeLocationAcrossApp(targetId, action, ctx);
      if (!loc || isRootNode(loc.task, loc.node.id)) {
        throw new Error("Card não encontrado ou é o card principal");
      }
      const { task } = loc;
      task.nodes = task.nodes.filter(n => n.id !== targetId);
      task.links = task.links.filter(l => l.from !== targetId && l.to !== targetId);
      if (selectedNodeId === targetId) selectedNodeId = null;
      saveState();
      render();
      return { message: `Card excluído de "${task.title}"` };
    }

    case "duplicate_card": {
      const targetId = resolveCardIdRef(action.cardId, ctx);
      const loc = findNodeLocationAcrossApp(targetId, action, ctx);
      if (!loc || isRootNode(loc.task, loc.node.id)) throw new Error("Card não encontrado");
      const { task: board, node: orig } = loc;
      const id = makeId("action");
      const cloneW = orig.w || MIN_CARD_WIDTH;
      const cloneH = nodeHeight(orig);
      const freePos = findFreeCardPosition(board, orig.x, orig.y + cloneH + 48, cloneW, cloneH, 48);
      const clone = {
        ...JSON.parse(JSON.stringify(orig)),
        id,
        createdAt: new Date().toISOString(),
        x: freePos.x,
        y: freePos.y
      };
      board.nodes.push(clone);
      if (board === activeBoard()) selectedNodeId = id;
      saveState();
      render();
      return { createdCardId: id, message: `Card duplicado em "${board.title}"` };
    }

    case "copy_card_to_task":
    case "move_card_to_task": {
      const srcId = resolveCardIdRef(action.sourceCardId || action.cardId, ctx);
      const srcLoc = findNodeLocationAcrossApp(srcId, action, ctx);
      if (!srcLoc || isRootNode(srcLoc.task, srcLoc.node.id)) {
        throw new Error("Card de origem não encontrado");
      }
      const targetFound = findTaskByAction(
        {
          userId: action.targetUserId,
          userName: action.targetUserName,
          taskId: action.targetTaskId,
          taskTitle: action.targetTaskTitle
        },
        ctx
      );
      if (!targetFound) throw new Error("Task de destino não encontrada");
      const destBoard = targetFound.task;
      const parentId = destBoard.nodes[0]?.id || null;
      const newId = makeId("action");
      const w = srcLoc.node.w || MIN_CARD_WIDTH;
      const h = srcLoc.node.h || 144;
      const rawPos = parentId ? getReplyActionPosition(destBoard, parentId) : { x: 96, y: 120 };
      const freePos = findFreeCardPosition(destBoard, rawPos.x, rawPos.y, w, h, 48);
      const copied = {
        ...JSON.parse(JSON.stringify(srcLoc.node)),
        id: newId,
        createdAt: new Date().toISOString(),
        x: freePos.x,
        y: freePos.y
      };
      if (parentId) {
        destBoard.nodes.splice(getReplyInsertionIndex(destBoard, parentId), 0, copied);
        destBoard.links.push({ id: makeId("link"), from: parentId, to: newId, fromPort: "out", toPort: "in" });
      } else {
        destBoard.nodes.push(copied);
      }
      if (action.type === "move_card_to_task") {
        srcLoc.task.nodes = srcLoc.task.nodes.filter(n => n.id !== srcLoc.node.id);
        srcLoc.task.links = srcLoc.task.links.filter(l => l.from !== srcLoc.node.id && l.to !== srcLoc.node.id);
        if (selectedNodeId === srcLoc.node.id) selectedNodeId = null;
      }
      saveState();
      render();
      return {
        createdCardId: newId,
        message: `${action.type === "move_card_to_task" ? "Card movido" : "Card copiado"} de "${srcLoc.task.title}" para "${destBoard.title}"`
      };
    }

    case "focus_card": {
      const targetId = resolveCardIdRef(action.cardId, ctx);
      const loc = findNodeLocationAcrossApp(targetId, action, ctx);
      if (!loc) throw new Error("Card não encontrado");
      state.activeUserId = loc.user.id;
      loc.user.activeTaskId = loc.task.id;
      selectedNodeId = loc.node.id;
      lastAiTouchedCardId = loc.node.id;
      saveState();
      render();
      focusNodesChainAnimated([loc.node.id], { maxZoom: 1.18, padding: 96, durationMs: 420 });
      triggerAiCardBirthHighlight(loc.node.id);
      return { message: `Card exibido em "${loc.task.title}"` };
    }

    case "connect_cards": {
      const fromId = resolveCardIdRef(action.fromCardId, ctx);
      const toId = resolveCardIdRef(action.toCardId, ctx);
      const fromRow = action.fromRow != null ? Number(action.fromRow) : null;
      const toRow = action.toRow != null ? Number(action.toRow) : null;
      const board = activeBoard();
      const fromNode = board?.nodes?.find(n => n.id === fromId);
      const toNode = board?.nodes?.find(n => n.id === toId);
      const validPorts = new Set(["in", "out", "top", "bottom"]);
      const [autoFrom, autoTo] = chooseSmartPorts(fromNode, toNode);
      const fPort = validPorts.has(action.fromPort) ? action.fromPort : autoFrom;
      const tPort = validPorts.has(action.toPort) ? action.toPort : autoTo;
      if (!addLink(fromId, toId, fPort, tPort, fromRow, toRow)) {
        throw new Error("Não foi possível conectar os cards");
      }
      saveState();
      renderLinks();
      return { message: "Cards conectados" };
    }

    case "disconnect_cards": {
      const board = activeBoard();
      if (!board) throw new Error("Nenhuma task ativa");
      board.links = board.links.filter(l => !(l.from === action.fromCardId && l.to === action.toCardId));
      saveState();
      renderLinks();
      return { message: "Conexão removida" };
    }

    case "organize_canvas": {
      organizeCanvasCards();
      return { message: "Canvas organizado" };
    }

    case "center_canvas": {
      centerCanvasOnTasks();
      return { message: "Canvas centralizado" };
    }

    case "copy_text": {
      const text = String(action.text || "");
      await navigator.clipboard.writeText(text);
      return { message: "Texto copiado para a área de transferência" };
    }

    case "set_status_filter": {
      const f = ["all", "ongoing", "stopped", "complete"].includes(action.filter) ? action.filter : "all";
      taskStatusFilter = f;
      localStorage.setItem(TASKS_STATUS_FILTER_KEY, f);
      tasksStatusFilter?.querySelectorAll("[data-filter]").forEach(btn => {
        const active = btn.dataset.filter === f;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", String(active));
      });
      renderUserTasks();
      return { message: `Filtro alterado para "${f}"` };
    }

    case "open_translator": {
      if (typeof window.toggleAiTranslatorPanel === "function") {
        window.toggleAiTranslatorPanel(true, "translate");
      }
      if (action.floating) {
        document.getElementById("aiDetachTranslatorBtn")?.click();
      }
      return { message: "Tradutor aberto" };
    }

    case "open_attachments": {
      if (action.open === false) {
        closeAttachmentsPopup();
        return { message: "Barra lateral de anexos fechada" };
      }
      openAttachmentsPopup();
      return { message: "Barra lateral de anexos aberta" };
    }

    case "set_task_reminder": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada para definir alarme/lembrete");
      const { task } = found;
      let dt = String(action.dateTime || "").trim();
      if (!dt && action.inMinutes !== undefined) {
        const mins = Math.max(1, Number(action.inMinutes) || 15);
        dt = formatLocalDateTimeInput(new Date(Date.now() + mins * 60 * 1000));
      }
      if (!dt) {
        dt = formatLocalDateTimeInput(new Date(Date.now() + 15 * 60 * 1000));
      }
      const mode = action.mode === "notification" || action.mode === "reminder" ? "reminder" : "alarm";
      const nextReminder = normalizeReminder({
        enabled: true,
        mode,
        dateTime: dt,
        repeat: action.repeat || "none",
        intervalMinutes: Number(action.intervalMinutes || 30),
        note: String(action.note || "").trim(),
        lastTriggeredFor: null
      });
      if (!nextReminder) throw new Error("Data/hora inválida para o alarme/lembrete");
      task.reminder = nextReminder;
      saveState();
      renderUserTasks();
      return { message: `${mode === "alarm" ? "Alarme" : "Lembrete"} definido em "${task.title}" (${dt})` };
    }

    case "remove_task_reminder": {
      const found = findTaskByAction(action, ctx);
      if (!found) throw new Error("Task não encontrada");
      const { task } = found;
      delete task.reminder;
      saveState();
      renderUserTasks();
      return { message: `Alarme/lembrete removido de "${task.title}"` };
    }

    case "open_settings": {
      document.getElementById("openSettingsButton")?.click();
      return { message: "Configurações abertas" };
    }

    case "update_settings": {
      if (action.theme && ["claude-dark", "light-claude", "dracula"].includes(action.theme)) {
        localStorage.setItem("todocompanion.settings.theme", action.theme);
        if (action.theme === "claude-dark") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = action.theme;
      }
      if (action.cardFontSize) {
        const sz = clamp(Number(action.cardFontSize), 10, 36);
        localStorage.setItem("todocompanion.settings.cardFontSize", String(sz));
        document.documentElement.style.setProperty("--card-font-size", `${sz}px`);
        window.dispatchEvent(new CustomEvent("app:card-font-size-changed", { detail: { fontSize: sz } }));
      }
      if (action.linkStyle === "orthogonal" || action.linkStyle === "bezier") {
        localStorage.setItem("todocompanion.settings.linkStyle", action.linkStyle);
        window.dispatchEvent(new CustomEvent("app:link-style-changed"));
      }
      if (typeof action.linkArrows === "boolean") {
        localStorage.setItem("todocompanion.settings.linkArrows", String(action.linkArrows));
        window.dispatchEvent(new CustomEvent("app:link-style-changed"));
      }
      if (action.translatorMode === "auto" || action.translatorMode === "manual") {
        localStorage.setItem("todocompanion.settings.translatorMode", action.translatorMode);
        window.dispatchEvent(new CustomEvent("app:translator-mode-changed"));
      }
      if (action.aiIconStyle === "dodecahedron" || action.aiIconStyle === "flat-eyes") {
        localStorage.setItem("todocompanion.settings.aiIconStyle", action.aiIconStyle);
        window.dispatchEvent(new CustomEvent("app:ai-icon-style-changed", { detail: { style: action.aiIconStyle } }));
      }
      if (action.aiIconColor && /^#[0-9a-f]{6}$/i.test(String(action.aiIconColor))) {
        localStorage.setItem("todocompanion.settings.aiIconColor", String(action.aiIconColor));
        window.dispatchEvent(new CustomEvent("app:ai-icon-style-changed", { detail: { color: String(action.aiIconColor) } }));
      }
      if (action.alarmSound) {
        localStorage.setItem("todocompanion.settings.alarmSound", String(action.alarmSound));
      }
      if (typeof action.screenShareProtection === "boolean") {
        localStorage.setItem("todocompanion.settings.hideFromScreenShare", String(action.screenShareProtection));
        if (typeof invoke === "function") {
          invoke("set_screen_share_protection", { enabled: action.screenShareProtection }).catch(() => {});
        }
      }
      return { message: "Configurações atualizadas" };
    }

    case "save_memory": {
      const content = String(action.content || "").trim();
      if (!content) throw new Error("Conteúdo da memória vazio.");
      const user = activeUser();
      const scopeKey = action.scope === "global" ? "global" : (user?.activeTaskId || "global");
      await persistenceService.upsertProjectMemory({
        scopeKey,
        kind: String(action.kind || "fact"),
        content,
        source: "ai"
      });
      return { message: `Memória salva (${scopeKey === "global" ? "global" : "projeto atual"})` };
    }

    default:
      throw new Error(`Ação não suportada: ${action.type}`);
  }
}

function insertAiTextIntoActiveCanvas(text) {
  const board = activeBoard();
  if (!board || !text) return;

  const targetNode =
    selectedNodeId
      ? board.nodes.find(n => n.id === selectedNodeId && n.type !== "image" && !isRootNode(board, n.id))
      : null;

  if (targetNode) {
    const existing = String(getNodeContent(targetNode) || "").trim();
    setNodeContent(targetNode, existing ? `${existing}\n${text}` : text);
    saveState();
    renderNodes();
    renderLinks();
    const cardEl = nodesLayer.querySelector(`[data-id="${targetNode.id}"]`);
    if (cardEl) scheduleNodeHeightSync(targetNode.id, cardEl);
    return;
  }

  const parentId = board.nodes[0]?.id || null;
  const id = makeId("action");
  const rawPos = parentId ? getReplyActionPosition(board, parentId) : getViewportActionPosition();
  const freePos = findFreeCardPosition(board, rawPos.x, rawPos.y, MIN_CARD_WIDTH, 144, 48);
  const newNode = {
    id,
    title: "",
    body: text,
    status: "ongoing",
    createdAt: new Date().toISOString(),
    x: freePos.x,
    y: freePos.y,
    w: MIN_CARD_WIDTH,
    h: 144
  };
  if (parentId) {
    board.nodes.splice(getReplyInsertionIndex(board, parentId), 0, newNode);
    addLink(parentId, id, "out", "in");
  } else {
    board.nodes.push(newNode);
  }
  pendingCardPop.add(id);
  selectedNodeId = id;
  saveState();
  render();
  const cardEl = nodesLayer.querySelector(`[data-id="${id}"]`);
  if (cardEl) scheduleNodeHeightSync(id, cardEl);
}

async function fallbackBrowserTranslate(text, formality, direction) {
  const key = localStorage.getItem(GEMINI_API_KEY_STORAGE) || DEFAULT_ENV_GEMINI_KEY;
  if (!key) throw new Error("Configure GEMINI_API_KEY in .env or Settings");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_ENV_GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Translate between Portuguese and English (${direction}, formality ${formality}/100). Output ONLY the translation:\n${text}`
            }
          ]
        }
      ],
      generationConfig: { temperature: 0.2 }
    })
  });
  const data = await resp.json();
  return (data?.candidates?.[0]?.content?.parts?.map(p => (p.thought ? "" : p.text || "")).join("") || "").trim();
}

// =========================================================================
// Task Reminders & Alarms (Popover + In-App + Windows Toast)
// =========================================================================
let reminderModalTarget = { userId: null, taskId: null };
let reminderModalMode = "reminder";
let reminderModalRepeat = "none";

const taskReminderPopover = document.getElementById("taskReminderPopover");
const taskReminderForm = document.getElementById("taskReminderForm");
const taskReminderTaskName = document.getElementById("taskReminderTaskName");
const taskReminderModeHint = document.getElementById("taskReminderModeHint");
const taskReminderDateTimeInput = document.getElementById("taskReminderDateTimeInput");
const taskReminderIntervalWrap = document.getElementById("taskReminderIntervalWrap");
const taskReminderIntervalInput = document.getElementById("taskReminderIntervalInput");
const taskReminderNoteInput = document.getElementById("taskReminderNoteInput");

function syncReminderRepeatPills() {
  taskReminderPopover?.querySelectorAll("[data-repeat]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.repeat === reminderModalRepeat);
  });
  if (taskReminderIntervalWrap) {
    taskReminderIntervalWrap.hidden = reminderModalRepeat !== "interval";
  }
}

function syncIntervalPresetChips() {
  const cur = String(taskReminderIntervalInput?.value || "");
  taskReminderPopover?.querySelectorAll("[data-interval-preset]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.intervalPreset === cur);
  });
}
const taskReminderDeleteButton = document.getElementById("taskReminderDeleteButton");
const taskReminderCancelButton = document.getElementById("taskReminderCancelButton");
const taskReminderCancelIcon = document.getElementById("taskReminderCancelIcon");
const reminderAlertStack = document.getElementById("reminderAlertStack");

function syncReminderModeButtons() {
  taskReminderPopover?.querySelectorAll("[data-reminder-mode]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.reminderMode === reminderModalMode);
  });
  if (taskReminderModeHint) {
    taskReminderModeHint.textContent = reminderModalMode === "alarm"
      ? "Toca um alerta sonoro contínuo no app e no Windows até você dispensar ou adiar."
      : "Envia uma notificação discreta no app e no Windows com um toque suave.";
  }
}

function closeTaskReminderModal() {
  if (!taskReminderPopover) return;
  taskReminderPopover.hidden = true;
  reminderModalTarget = { userId: null, taskId: null };
}

function positionReminderPopover(anchorEl) {
  if (!taskReminderPopover) return;
  const popWidth = 318;
  const popHeight = 330;
  const rect = anchorEl?.getBoundingClientRect?.();
  let left = rect ? rect.right + 10 : Math.round((window.innerWidth - popWidth) / 2);
  let top = rect ? rect.top - 12 : Math.round((window.innerHeight - popHeight) / 2);
  if (left + popWidth > window.innerWidth - 12) {
    left = Math.max(12, (rect ? rect.left - popWidth - 10 : window.innerWidth - popWidth - 12));
  }
  if (top + popHeight > window.innerHeight - 12) {
    top = Math.max(12, window.innerHeight - popHeight - 12);
  }
  taskReminderPopover.style.left = `${Math.max(12, Math.round(left))}px`;
  taskReminderPopover.style.top = `${Math.max(12, Math.round(top))}px`;
}

function openTaskReminderModal(userId, taskId, anchorEl = null) {
  if (!taskReminderPopover) return;
  const user = state.users.find(u => u.id === userId);
  const task = user?.tasks?.find(t => t.id === taskId);
  if (!user || !task) return;

  reminderModalTarget = { userId, taskId };
  const existing = normalizeReminder(task.reminder);
  reminderModalMode = existing?.mode || "reminder";
  syncReminderModeButtons();

  if (taskReminderTaskName) {
    taskReminderTaskName.textContent = `${user.name} · ${task.title || "Sem título"}`;
  }
  if (taskReminderDateTimeInput) {
    const defaultDt = existing?.dateTime || formatLocalDateTimeInput(new Date(Date.now() + 15 * 60 * 1000));
    taskReminderDateTimeInput.value = defaultDt;
  }
  reminderModalRepeat = existing?.repeat || "none";
  if (taskReminderIntervalInput) {
    taskReminderIntervalInput.value = String(existing?.intervalMinutes || 30);
  }
  syncReminderRepeatPills();
  syncIntervalPresetChips();
  if (taskReminderNoteInput) {
    taskReminderNoteInput.value = existing?.note || "";
  }
  if (taskReminderDeleteButton) {
    taskReminderDeleteButton.hidden = !existing;
  }

  positionReminderPopover(anchorEl);
  taskReminderPopover.hidden = false;
}

async function showInAppReminderAlert({ user, task, reminder }) {
  setAiIconMood("alert", { durationMs: 6000 });
  if (!reminderAlertStack) return;
  const isAlarm = reminder.mode === "alarm";
  const alertId = `alert-${task.id}-${Date.now()}`;

  if (isAlarm) {
    alarmSoundPlayer.startAlarm(alertId);
  } else {
    alarmSoundPlayer.playChime(false);
  }

  const timeStr = new Date(reminder.dateTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const subtitle = reminder.note
    ? `${timeStr} · ${reminder.note}`
    : `${isAlarm ? "Alarme" : "Lembrete"} · ${timeStr}${user?.name ? ` · ${user.name}` : ""}`;

  if (typeof invoke === "function") {
    try {
      const overlayOpened = await invoke("show_reminder_overlay", {
        title: task.title || "Task",
        subtitle,
        isAlarm,
        userId: user?.id || null,
        taskId: task?.id || null
      });
      if (overlayOpened) {
        reminderAlertStack.innerHTML = "";
        return;
      }
    } catch (_) { }
  }

  reminderAlertStack.innerHTML = "";
  const card = document.createElement("div");
  card.className = `reminder-alert-card${isAlarm ? " is-alarm" : ""}`;

  card.innerHTML = `
    <span class="reminder-alert-icon" aria-hidden="true">${icons.bell}</span>
    <div class="reminder-alert-copy">
      <span class="reminder-alert-title">${escapeHtml(task.title || "Task")}</span>
      <span class="reminder-alert-body">${escapeHtml(subtitle)}</span>
    </div>
    <div class="reminder-alert-actions">
      <button class="reminder-alert-btn primary" type="button" data-action="open">Abrir</button>
      <button class="reminder-alert-btn" type="button" data-action="snooze" title="Adiar 10 minutos">+10m</button>
      <button class="reminder-alert-btn dismiss" type="button" data-action="dismiss" aria-label="Dispensar" title="Dispensar">×</button>
    </div>
  `;

  const dismiss = () => {
    alarmSoundPlayer.stopAlarm(alertId);
    card.classList.add("is-closing");
    setTimeout(() => card.remove(), 180);
    if (typeof invoke === "function") {
      invoke("close_reminder_overlay").catch(() => { });
    }
  };

  card.addEventListener("pointerdown", ev => ev.stopPropagation());

  card.querySelector('[data-action="open"]').addEventListener("click", ev => {
    ev.stopPropagation();
    if (user?.id) state.activeUserId = user.id;
    const u = state.users.find(x => x.id === user?.id);
    if (u && task?.id) u.activeTaskId = task.id;
    saveState();
    render();
    dismiss();
  });

  card.querySelector('[data-action="snooze"]').addEventListener("click", ev => {
    ev.stopPropagation();
    const u = state.users.find(x => x.id === user?.id);
    const t = u?.tasks?.find(x => x.id === task?.id);
    if (t) {
      const snoozedDt = formatLocalDateTimeInput(new Date(Date.now() + 10 * 60 * 1000));
      t.reminder = normalizeReminder({
        ...reminder,
        enabled: true,
        dateTime: snoozedDt,
        lastTriggeredFor: null
      });
      saveState();
      renderUserTasks();
    }
    dismiss();
  });

  card.querySelector('[data-action="dismiss"]').addEventListener("click", ev => {
    ev.stopPropagation();
    dismiss();
  });

  reminderAlertStack.appendChild(card);
}

if (taskReminderPopover && taskReminderForm) {
  taskReminderPopover.querySelectorAll("[data-reminder-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      reminderModalMode = btn.dataset.reminderMode === "alarm" ? "alarm" : "reminder";
      syncReminderModeButtons();
    });
  });

  const flashReminderDateInput = () => {
    if (!taskReminderDateTimeInput) return;
    taskReminderDateTimeInput.classList.remove("is-updated");
    void taskReminderDateTimeInput.offsetWidth;
    taskReminderDateTimeInput.classList.add("is-updated");
    setTimeout(() => taskReminderDateTimeInput?.classList.remove("is-updated"), 450);
  };

  taskReminderPopover.querySelectorAll("[data-quick-minutes]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mins = Number(btn.dataset.quickMinutes) || 15;
      if (taskReminderDateTimeInput) {
        const currentParsed = taskReminderDateTimeInput.value ? new Date(taskReminderDateTimeInput.value).getTime() : NaN;
        const baseMs = Number.isFinite(currentParsed) && currentParsed > Date.now() ? currentParsed : Date.now();
        taskReminderDateTimeInput.value = formatLocalDateTimeInput(new Date(baseMs + mins * 60 * 1000));
        flashReminderDateInput();
      }
    });
  });

  taskReminderPopover.querySelectorAll("[data-quick-tomorrow]").forEach(btn => {
    btn.addEventListener("click", () => {
      const hr = Number(btn.dataset.quickTomorrow) || 9;
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(hr, 0, 0, 0);
      if (taskReminderDateTimeInput) {
        taskReminderDateTimeInput.value = formatLocalDateTimeInput(d);
        flashReminderDateInput();
      }
    });
  });

  taskReminderPopover.querySelectorAll("[data-repeat]").forEach(btn => {
    btn.addEventListener("click", () => {
      reminderModalRepeat = btn.dataset.repeat || "none";
      syncReminderRepeatPills();
    });
  });

  taskReminderPopover.querySelectorAll("[data-interval-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (taskReminderIntervalInput) {
        taskReminderIntervalInput.value = btn.dataset.intervalPreset || "30";
        syncIntervalPresetChips();
      }
    });
  });

  taskReminderIntervalInput?.addEventListener("input", syncIntervalPresetChips);

  taskReminderCancelButton?.addEventListener("click", closeTaskReminderModal);
  taskReminderCancelIcon?.addEventListener("click", closeTaskReminderModal);
  document.addEventListener("pointerdown", ev => {
    if (
      !taskReminderPopover.hidden &&
      !taskReminderPopover.contains(ev.target) &&
      !ev.target.closest?.(".user-task-reminder")
    ) {
      closeTaskReminderModal();
    }
  });

  taskReminderDeleteButton?.addEventListener("click", () => {
    const user = state.users.find(u => u.id === reminderModalTarget.userId);
    const task = user?.tasks?.find(t => t.id === reminderModalTarget.taskId);
    if (task) {
      delete task.reminder;
      saveState();
      renderUserTasks();
    }
    closeTaskReminderModal();
  });

  taskReminderForm.addEventListener("submit", ev => {
    ev.preventDefault();
    const user = state.users.find(u => u.id === reminderModalTarget.userId);
    const task = user?.tasks?.find(t => t.id === reminderModalTarget.taskId);
    if (!task) {
      closeTaskReminderModal();
      return;
    }
    const nextReminder = normalizeReminder({
      enabled: true,
      mode: reminderModalMode,
      dateTime: taskReminderDateTimeInput?.value || "",
      repeat: reminderModalRepeat,
      intervalMinutes: Number(taskReminderIntervalInput?.value || 30),
      note: taskReminderNoteInput?.value || "",
      lastTriggeredFor: null
    });
    if (!nextReminder) return;
    task.reminder = nextReminder;
    saveState();
    renderUserTasks();
    closeTaskReminderModal();
  });

  window.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !taskReminderPopover.hidden) {
      closeTaskReminderModal();
    }
  });
}

const taskReminderService = new TaskReminderService({
  getState: () => state,
  onStateMutated: () => {
    saveState();
    renderUserTasks();
  },
  onTrigger: item => showInAppReminderAlert(item),
  invokeFn: typeof invoke === "function" ? invoke : null,
  pollIntervalMs: 5000
});
taskReminderService.start();

if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("reminder-heartbeat", () => {
    taskReminderService.checkDueReminders();
  });
  window.__TAURI__.event.listen("open-floating-ai-chat", () => {
    window.openFloatingAiChatOnly?.();
  });
  window.__TAURI__.event.listen("reminder-overlay-action", ev => {
    const payload = ev?.payload || {};
    const action = payload.action;
    const userId = payload.userId;
    const taskId = payload.taskId;

    alarmSoundPlayer.stopAll();
    if (reminderAlertStack) {
      reminderAlertStack.innerHTML = "";
    }

    if (action === "open" && userId && taskId) {
      state.activeUserId = userId;
      const u = state.users.find(x => x.id === userId);
      if (u) u.activeTaskId = taskId;
      saveState();
      render();
    } else if (action === "snooze" && userId && taskId) {
      const u = state.users.find(x => x.id === userId);
      const t = u?.tasks?.find(x => x.id === taskId);
      if (t) {
        const snoozedDt = formatLocalDateTimeInput(new Date(Date.now() + 10 * 60 * 1000));
        t.reminder = normalizeReminder({
          ...(t.reminder || {}),
          enabled: true,
          dateTime: snoozedDt,
          lastTriggeredFor: null
        });
        saveState();
        renderUserTasks();
      }
    }
  }).catch(() => { });
}
