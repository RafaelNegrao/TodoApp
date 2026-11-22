// Motor de tabelas estilo Excel para cards do TODOCompanion.
// Funcoes puras (sem dependencia de DOM) para serializacao, formulas (=SUM, =AVG,
// =MIN, =MAX, =COUNT, aritmetica de celulas), colagem TSV do Excel e manipulacao
// de linhas/colunas.

export const CARD_TABLE_TOKEN_PREFIX = "[[table:";
export const CARD_TABLE_TOKEN_SUFFIX = "]]";

function toBase64Url(str) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(str, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded) {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (encoded.length % 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function normalizeTableData(data) {
  const rawRows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rawRows.length) {
    return createDefaultTableData(3, 3);
  }
  const maxCols = Math.max(1, ...rawRows.map(r => (Array.isArray(r) ? r.length : 0)));
  const rows = rawRows.map(r => {
    const arr = Array.isArray(r) ? r.map(c => String(c ?? "")) : [];
    while (arr.length < maxCols) arr.push("");
    return arr;
  });
  return { rows };
}

export function createDefaultTableData(rowCount = 3, colCount = 3) {
  const safeRows = Math.max(1, Math.min(50, Math.floor(rowCount)));
  const safeCols = Math.max(1, Math.min(26, Math.floor(colCount)));
  const rows = [];
  for (let r = 0; r < safeRows; r++) {
    rows.push(new Array(safeCols).fill(""));
  }
  return { rows };
}

export function encodeTableData(data) {
  const normalized = normalizeTableData(data);
  return toBase64Url(JSON.stringify(normalized));
}

export function decodeTableData(encoded) {
  if (!encoded || typeof encoded !== "string") {
    return createDefaultTableData(3, 3);
  }
  try {
    const json = fromBase64Url(encoded.trim());
    const parsed = JSON.parse(json);
    return normalizeTableData(parsed);
  } catch (_) {
    return createDefaultTableData(3, 3);
  }
}

export function serializeTableToken(data) {
  return `${CARD_TABLE_TOKEN_PREFIX}${encodeTableData(data)}${CARD_TABLE_TOKEN_SUFFIX}`;
}

export function addTableRow(data, afterIndex = null) {
  const norm = normalizeTableData(data);
  const cols = norm.rows[0].length;
  const newRow = new Array(cols).fill("");
  const insertAt =
    afterIndex === null || afterIndex === undefined
      ? norm.rows.length
      : Math.max(0, Math.min(norm.rows.length, afterIndex + 1));
  const rows = norm.rows.map(r => [...r]);
  rows.splice(insertAt, 0, newRow);
  return { rows };
}

export function removeTableRow(data, rowIndex) {
  const norm = normalizeTableData(data);
  if (norm.rows.length <= 1) return norm;
  const idx = Math.max(0, Math.min(norm.rows.length - 1, rowIndex));
  const rows = norm.rows.map(r => [...r]);
  rows.splice(idx, 1);
  return { rows };
}

export function addTableCol(data, afterIndex = null) {
  const norm = normalizeTableData(data);
  const cols = norm.rows[0].length;
  const insertAt =
    afterIndex === null || afterIndex === undefined
      ? cols
      : Math.max(0, Math.min(cols, afterIndex + 1));
  const rows = norm.rows.map(r => {
    const next = [...r];
    next.splice(insertAt, 0, "");
    return next;
  });
  return { rows };
}

export function removeTableCol(data, colIndex) {
  const norm = normalizeTableData(data);
  const cols = norm.rows[0].length;
  if (cols <= 1) return norm;
  const idx = Math.max(0, Math.min(cols - 1, colIndex));
  const rows = norm.rows.map(r => {
    const next = [...r];
    next.splice(idx, 1);
    return next;
  });
  return { rows };
}

export function parseTsvToTableData(rawText) {
  const text = String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!text.includes("\t")) return null;
  const lines = text.split("\n");
  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop();
  }
  if (!lines.length) return null;
  const rows = lines.map(line => line.split("\t").map(cell => cell.trim()));
  const maxCols = Math.max(...rows.map(r => r.length));
  if (maxCols < 2 && rows.length < 2) return null;
  return normalizeTableData({ rows });
}

export function applyTsvIntoTable(data, startRow, startCol, rawText) {
  const parsed = parseTsvToTableData(rawText);
  if (!parsed) return null;
  const norm = normalizeTableData(data);
  const targetRows = Math.max(norm.rows.length, startRow + parsed.rows.length);
  const targetCols = Math.max(norm.rows[0].length, startCol + parsed.rows[0].length);
  const rows = [];
  for (let r = 0; r < targetRows; r++) {
    const row = [];
    for (let c = 0; c < targetCols; c++) {
      row.push(norm.rows[r]?.[c] ?? "");
    }
    rows.push(row);
  }
  for (let r = 0; r < parsed.rows.length; r++) {
    for (let c = 0; c < parsed.rows[r].length; c++) {
      rows[startRow + r][startCol + c] = parsed.rows[r][c];
    }
  }
  return { rows };
}

export function colIndexToLetter(index) {
  let n = index;
  let result = "";
  do {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

export function cellRefToCoords(ref) {
  const match = String(ref || "").trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const letters = match[1];
  const rowNum = parseInt(match[2], 10);
  if (rowNum < 1) return null;
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return { row: rowNum - 1, col: col - 1 };
}

function parseNumericValue(val) {
  const str = String(val ?? "").trim();
  if (!str) return null;
  // Suporta formato brasileiro (1.234,56) e padrao (1234.56)
  const cleaned = str.replace(/R\$\s?/i, "").replace(/\s/g, "");
  let normalized = cleaned;
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(",", ".");
  }
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function resolveCellNumeric(rows, r, c, visited) {
  const key = `${r}:${c}`;
  if (visited.has(key)) return 0;
  const raw = rows[r]?.[c];
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  if (str.startsWith("=")) {
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    const evaled = evaluateFormulaInternal(str.slice(1), rows, nextVisited);
    return Number.isFinite(evaled) ? evaled : null;
  }
  return parseNumericValue(str);
}

function collectRangeNumbers(rangeExpr, rows, visited) {
  const parts = rangeExpr.split(",").map(p => p.trim()).filter(Boolean);
  const nums = [];
  for (const part of parts) {
    if (part.includes(":")) {
      const [aRef, bRef] = part.split(":");
      const a = cellRefToCoords(aRef);
      const b = cellRefToCoords(bRef);
      if (!a || !b) continue;
      const r1 = Math.min(a.row, b.row);
      const r2 = Math.max(a.row, b.row);
      const c1 = Math.min(a.col, b.col);
      const c2 = Math.max(a.col, b.col);
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const n = resolveCellNumeric(rows, r, c, visited);
          if (n !== null) nums.push(n);
        }
      }
    } else {
      const coords = cellRefToCoords(part);
      if (coords) {
        const n = resolveCellNumeric(rows, coords.row, coords.col, visited);
        if (n !== null) nums.push(n);
      } else {
        const literal = parseNumericValue(part);
        if (literal !== null) nums.push(literal);
      }
    }
  }
  return nums;
}

// Avaliador aritmetico seguro (recursive descent) sem eval/Function
function evaluateSafeArithmetic(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    if (/[\d.]/.test(ch)) {
      let numStr = "";
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        numStr += expr[i++];
      }
      const num = Number(numStr);
      if (!Number.isFinite(num)) return NaN;
      tokens.push(num);
      continue;
    }
    return NaN;
  }

  let pos = 0;
  function parseExpr() {
    let left = parseTerm();
    while (tokens[pos] === "+" || tokens[pos] === "-") {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseFactor();
    while (tokens[pos] === "*" || tokens[pos] === "/") {
      const op = tokens[pos++];
      const right = parseFactor();
      if (op === "/") {
        if (right === 0) return NaN;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }
  function parseFactor() {
    if (tokens[pos] === "-") {
      pos++;
      return -parseFactor();
    }
    if (tokens[pos] === "+") {
      pos++;
      return parseFactor();
    }
    if (tokens[pos] === "(") {
      pos++;
      const val = parseExpr();
      if (tokens[pos] !== ")") return NaN;
      pos++;
      return val;
    }
    const tok = tokens[pos++];
    return typeof tok === "number" ? tok : NaN;
  }

  const val = parseExpr();
  return pos === tokens.length ? val : NaN;
}

function evaluateFormulaInternal(expr, rows, visited) {
  const trimmed = String(expr || "").trim();
  if (!trimmed) return NaN;

  const fnMatch = trimmed.match(/^(SUM|SOMA|AVG|AVERAGE|MEDIA|MIN|MAX|COUNT|CONT)\s*\(([^)]+)\)$/i);
  if (fnMatch) {
    const fn = fnMatch[1].toUpperCase();
    const nums = collectRangeNumbers(fnMatch[2], rows, visited);
    if (fn === "COUNT" || fn === "CONT") return nums.length;
    if (!nums.length) return 0;
    if (fn === "SUM" || fn === "SOMA") return nums.reduce((a, b) => a + b, 0);
    if (fn === "AVG" || fn === "AVERAGE" || fn === "MEDIA") return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (fn === "MIN") return Math.min(...nums);
    if (fn === "MAX") return Math.max(...nums);
  }

  // Substitui referencias de celulas (ex.: A1, B2) por seus valores numericos
  const substituted = trimmed.replace(/\b([A-Za-z]+\d+)\b/g, ref => {
    const coords = cellRefToCoords(ref);
    if (!coords) return "0";
    const n = resolveCellNumeric(rows, coords.row, coords.col, visited);
    return n === null ? "0" : String(n);
  });

  return evaluateSafeArithmetic(substituted.replace(/,/g, "."));
}

export function evaluateCellFormula(rawValue, rows, rowIdx = -1, colIdx = -1) {
  const str = String(rawValue ?? "");
  if (!str.trim().startsWith("=")) return str;
  const visited = new Set();
  if (rowIdx >= 0 && colIdx >= 0) {
    visited.add(`${rowIdx}:${colIdx}`);
  }
  const result = evaluateFormulaInternal(str.trim().slice(1), rows, visited);
  if (!Number.isFinite(result)) return "#ERR";
  const rounded = Math.round(result * 10000) / 10000;
  return String(rounded);
}

function escapeHtmlBasic(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderCardTableHtml(data) {
  const norm = normalizeTableData(data);
  const encoded = encodeTableData(norm);
  const rowsHtml = norm.rows
    .map((row, rIdx) => {
      const cellsHtml = row
        .map((rawVal, cIdx) => {
          const isFormula = String(rawVal || "").trim().startsWith("=");
          const displayVal = isFormula ? evaluateCellFormula(rawVal, norm.rows, rIdx, cIdx) : rawVal;
          const cellRef = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
          const formulaClass = isFormula ? " is-formula" : "";
          return `<td class="card-excel-cell${formulaClass}" contenteditable="true" data-row="${rIdx}" data-col="${cIdx}" data-raw="${escapeHtmlBasic(rawVal)}" title="${cellRef}${isFormula ? ` (${escapeHtmlBasic(rawVal)})` : ""}">${escapeHtmlBasic(displayVal)}</td>`;
        })
        .join("");
      return `<tr>${cellsHtml}</tr>`;
    })
    .join("");

  return `<div class="card-table-wrap" contenteditable="false" data-table-encoded="${encoded}"><div class="card-table-toolbar"><button type="button" class="card-table-btn" data-table-action="addRow" title="Adicionar linha">+ Lin</button><button type="button" class="card-table-btn" data-table-action="addCol" title="Adicionar coluna">+ Col</button><button type="button" class="card-table-btn" data-table-action="delRow" title="Remover linha">- Lin</button><button type="button" class="card-table-btn" data-table-action="delCol" title="Remover coluna">- Col</button><button type="button" class="card-table-btn danger" data-table-action="delTable" title="Remover tabela">×</button></div><div class="card-table-scroll"><table class="card-excel-table"><tbody>${rowsHtml}</tbody></table></div></div>`;
}
