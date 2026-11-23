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
  const hasCheckboxes = Boolean(data?.hasCheckboxes);
  const rawRows = Array.isArray(data?.rows) ? data.rows : [];
  if (!rawRows.length) {
    return hasCheckboxes ? createTodoTableData(3, 3) : createDefaultTableData(3, 3);
  }
  const minCols = hasCheckboxes ? 2 : 1;
  const maxCols = Math.max(minCols, ...rawRows.map(r => (Array.isArray(r) ? r.length : 0)));
  const rows = rawRows.map(r => {
    const arr = Array.isArray(r) ? r.map(c => String(c ?? "")) : [];
    while (arr.length < maxCols) arr.push("");
    if (hasCheckboxes) {
      const v = arr[0].trim().toLowerCase();
      arr[0] = v === "[x]" || v === "true" || v === "1" ? "[x]" : "[ ]";
    }
    return arr;
  });
  return hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
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

export function createTodoTableData(rowCount = 3, colCount = 3) {
  const safeRows = Math.max(1, Math.min(50, Math.floor(rowCount)));
  const safeCols = Math.max(2, Math.min(26, Math.floor(colCount)));
  const rows = [];
  for (let r = 0; r < safeRows; r++) {
    const row = new Array(safeCols).fill("");
    row[0] = "[ ]";
    rows.push(row);
  }
  return { rows, hasCheckboxes: true };
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
  if (norm.hasCheckboxes) {
    newRow[0] = "[ ]";
  }
  const insertAt =
    afterIndex === null || afterIndex === undefined
      ? norm.rows.length
      : Math.max(0, Math.min(norm.rows.length, afterIndex + 1));
  const rows = norm.rows.map(r => [...r]);
  rows.splice(insertAt, 0, newRow);
  return norm.hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
}

export function removeTableRow(data, rowIndex) {
  const norm = normalizeTableData(data);
  if (norm.rows.length <= 1) return norm;
  const idx = Math.max(0, Math.min(norm.rows.length - 1, rowIndex));
  const rows = norm.rows.map(r => [...r]);
  rows.splice(idx, 1);
  return norm.hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
}

export function addTableCol(data, afterIndex = null) {
  const norm = normalizeTableData(data);
  const cols = norm.rows[0].length;
  const minInsert = norm.hasCheckboxes ? 1 : 0;
  const insertAt =
    afterIndex === null || afterIndex === undefined
      ? cols
      : Math.max(minInsert, Math.min(cols, afterIndex + 1));
  const rows = norm.rows.map(r => {
    const next = [...r];
    next.splice(insertAt, 0, "");
    return next;
  });
  return norm.hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
}

export function removeTableCol(data, colIndex) {
  const norm = normalizeTableData(data);
  const cols = norm.rows[0].length;
  const minCols = norm.hasCheckboxes ? 2 : 1;
  if (cols <= minCols) return norm;
  const minIdx = norm.hasCheckboxes ? 1 : 0;
  const idx = Math.max(minIdx, Math.min(cols - 1, colIndex));
  const rows = norm.rows.map(r => {
    const next = [...r];
    next.splice(idx, 1);
    return next;
  });
  return norm.hasCheckboxes ? { rows, hasCheckboxes: true } : { rows };
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
  return norm.hasCheckboxes ? normalizeTableData({ rows, hasCheckboxes: true }) : { rows };
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
  const match = String(ref || "").trim().toUpperCase().match(/^\$?([A-Z]+)\$?(\d+)$/);
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
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "boolean") return val ? 1 : 0;
  const str = String(val ?? "").trim();
  if (!str) return null;
  const isPercent = str.endsWith("%");
  const withoutPct = isPercent ? str.slice(0, -1).trim() : str;
  // Suporta formato brasileiro (R$ 1.234,56) e padrao (1234.56)
  const cleaned = withoutPct.replace(/R\$\s?/i, "").replace(/\s/g, "");
  let normalized = cleaned;
  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(cleaned)) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+,\d+$/.test(cleaned)) {
    normalized = cleaned.replace(",", ".");
  }
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return isPercent ? num / 100 : num;
}

function toNumber(val) {
  if (val === null || val === undefined || val === "") return 0;
  const n = parseNumericValue(val);
  if (n === null) throw new Error("#VALUE!");
  return n;
}

function toBool(val) {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  const s = String(val ?? "").trim().toUpperCase();
  if (s === "TRUE" || s === "VERDADEIRO" || s === "[X]") return true;
  if (s === "FALSE" || s === "FALSO" || s === "[ ]" || s === "") return false;
  const n = parseNumericValue(s);
  return n !== null ? n !== 0 : Boolean(s);
}

function toStr(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
  if (typeof val === "number") return String(Math.round(val * 10000) / 10000);
  return String(val);
}

function normalizeFuncName(name) {
  return String(name || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matchesCriteria(value, criteria) {
  const critStr = String(criteria ?? "").trim();
  const opMatch = critStr.match(/^(<=|>=|<>|!=|=|<|>)(.*)$/);
  if (opMatch) {
    const op = opMatch[1];
    const rhsRaw = opMatch[2].trim();
    const rhsNum = parseNumericValue(rhsRaw);
    const lhsNum = parseNumericValue(value);
    if (rhsNum !== null && lhsNum !== null) {
      if (op === "=") return lhsNum === rhsNum;
      if (op === "<>" || op === "!=") return lhsNum !== rhsNum;
      if (op === "<") return lhsNum < rhsNum;
      if (op === "<=") return lhsNum <= rhsNum;
      if (op === ">") return lhsNum > rhsNum;
      if (op === ">=") return lhsNum >= rhsNum;
    }
    const lhsText = toStr(value).toLowerCase();
    const rhsText = rhsRaw.toLowerCase();
    if (op === "=") return lhsText === rhsText;
    if (op === "<>" || op === "!=") return lhsText !== rhsText;
    return false;
  }

  const critBool = critStr.toUpperCase();
  if (critBool === "TRUE" || critBool === "VERDADEIRO") return toBool(value) === true;
  if (critBool === "FALSE" || critBool === "FALSO") return toBool(value) === false;

  const critNum = parseNumericValue(criteria);
  const valNum = parseNumericValue(value);
  if (critNum !== null && valNum !== null) {
    return valNum === critNum;
  }
  return toStr(value).trim().toLowerCase() === critStr.toLowerCase();
}

function tokenizeFormula(expr) {
  const tokens = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let str = "";
      while (i < len) {
        if (expr[i] === quote && expr[i + 1] === quote) {
          str += quote;
          i += 2;
        } else if (expr[i] === quote) {
          i++;
          break;
        } else {
          str += expr[i++];
        }
      }
      tokens.push({ type: "string", value: str });
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "<>" || two === "!=") {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/^%=<>&".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "," || ch === ";" || ch === ":") {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }
    if (/\d/.test(ch) || (ch === "." && /\d/.test(expr[i + 1] || ""))) {
      let numStr = "";
      while (i < len && /[\d.]/.test(expr[i])) {
        numStr += expr[i++];
      }
      const num = Number(numStr);
      if (!Number.isFinite(num)) throw new Error("#NUM!");
      tokens.push({ type: "number", value: num });
      continue;
    }
    if (/[\$A-Za-zÀ-ÿ_]/.test(ch)) {
      let ident = "";
      while (i < len && /[\$A-Za-zÀ-ÿ0-9_.]/.test(expr[i])) {
        ident += expr[i++];
      }
      tokens.push({ type: "ident", value: ident });
      continue;
    }
    throw new Error("#SYNTAX!");
  }

  return tokens;
}

class ExcelFormulaEngine {
  constructor(rows, visited = new Set()) {
    this.rows = rows || [];
    this.visited = visited;
    this.tokens = [];
    this.pos = 0;
  }

  evaluate(expr) {
    this.tokens = tokenizeFormula(String(expr || "").trim());
    this.pos = 0;
    if (!this.tokens.length) return "";
    const result = this.parseComparison();
    if (this.pos !== this.tokens.length) {
      throw new Error("#SYNTAX!");
    }
    return this.unwrapScalar(result);
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset] || null;
  }

  consume() {
    return this.tokens[this.pos++] || null;
  }

  resolveCellValue(r, c) {
    const key = `${r}:${c}`;
    if (this.visited.has(key)) return 0;
    const raw = this.rows[r]?.[c];
    if (raw === undefined || raw === null) return "";
    const str = String(raw);
    const trimmed = str.trim();
    if (!trimmed) return "";
    if (trimmed === "[x]" || trimmed === "[X]") return true;
    if (trimmed === "[ ]") return false;
    if (trimmed.startsWith("=")) {
      const nextVisited = new Set(this.visited);
      nextVisited.add(key);
      const child = new ExcelFormulaEngine(this.rows, nextVisited);
      return child.evaluate(trimmed.slice(1));
    }
    const num = parseNumericValue(trimmed);
    return num !== null ? num : str;
  }

  collectRangeValues(aCoords, bCoords) {
    const r1 = Math.min(aCoords.row, bCoords.row);
    const r2 = Math.max(aCoords.row, bCoords.row);
    const c1 = Math.min(aCoords.col, bCoords.col);
    const c2 = Math.max(aCoords.col, bCoords.col);
    const matrix = [];
    const flat = [];
    for (let r = r1; r <= r2; r++) {
      const rowVals = [];
      for (let c = c1; c <= c2; c++) {
        const val = this.resolveCellValue(r, c);
        rowVals.push(val);
        flat.push(val);
      }
      matrix.push(rowVals);
    }
    return { __range: true, flat, matrix };
  }

  unwrapScalar(val) {
    if (val && typeof val === "object" && val.__range) {
      return val.flat[0] ?? "";
    }
    return val;
  }

  flattenNumericArgs(args) {
    const nums = [];
    for (const arg of args) {
      if (arg && typeof arg === "object" && arg.__range) {
        for (const v of arg.flat) {
          if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
        }
      } else if (arg !== "" && arg !== null && arg !== undefined) {
        const n = parseNumericValue(arg);
        if (n !== null) nums.push(n);
      }
    }
    return nums;
  }

  flattenAllArgs(args) {
    const all = [];
    for (const arg of args) {
      if (arg && typeof arg === "object" && arg.__range) {
        all.push(...arg.flat);
      } else {
        all.push(arg);
      }
    }
    return all;
  }

  parseComparison() {
    let left = this.parseConcat();
    while (this.peek()?.type === "op" && ["=", "<>", "!=", "<", "<=", ">", ">="].includes(this.peek().value)) {
      const op = this.consume().value;
      const right = this.parseConcat();
      const a = this.unwrapScalar(left);
      const b = this.unwrapScalar(right);
      const aNum = parseNumericValue(a);
      const bNum = parseNumericValue(b);
      if (aNum !== null && bNum !== null && typeof a !== "boolean" && typeof b !== "boolean") {
        if (op === "=") left = aNum === bNum;
        else if (op === "<>" || op === "!=") left = aNum !== bNum;
        else if (op === "<") left = aNum < bNum;
        else if (op === "<=") left = aNum <= bNum;
        else if (op === ">") left = aNum > bNum;
        else if (op === ">=") left = aNum >= bNum;
      } else {
        const sa = toStr(a).toLowerCase();
        const sb = toStr(b).toLowerCase();
        if (op === "=") left = sa === sb;
        else if (op === "<>" || op === "!=") left = sa !== sb;
        else if (op === "<") left = sa < sb;
        else if (op === "<=") left = sa <= sb;
        else if (op === ">") left = sa > sb;
        else if (op === ">=") left = sa >= sb;
      }
    }
    return left;
  }

  parseConcat() {
    let left = this.parseAdditive();
    while (this.peek()?.type === "op" && this.peek().value === "&") {
      this.consume();
      const right = this.parseAdditive();
      left = toStr(this.unwrapScalar(left)) + toStr(this.unwrapScalar(right));
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.peek()?.type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume().value;
      const right = this.parseMultiplicative();
      const a = toNumber(this.unwrapScalar(left));
      const b = toNumber(this.unwrapScalar(right));
      left = op === "+" ? a + b : a - b;
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parsePower();
    while (this.peek()?.type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.consume().value;
      const right = this.parsePower();
      const a = toNumber(this.unwrapScalar(left));
      const b = toNumber(this.unwrapScalar(right));
      if (op === "/") {
        if (b === 0) throw new Error("#DIV/0!");
        left = a / b;
      } else {
        left = a * b;
      }
    }
    return left;
  }

  parsePower() {
    let left = this.parseUnary();
    if (this.peek()?.type === "op" && this.peek().value === "^") {
      this.consume();
      const right = this.parsePower();
      left = Math.pow(toNumber(this.unwrapScalar(left)), toNumber(this.unwrapScalar(right)));
    }
    return left;
  }

  parseUnary() {
    if (this.peek()?.type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume().value;
      const val = toNumber(this.unwrapScalar(this.parseUnary()));
      return op === "-" ? -val : val;
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let val = this.parsePrimary();
    while (this.peek()?.type === "op" && this.peek().value === "%") {
      this.consume();
      val = toNumber(this.unwrapScalar(val)) / 100;
    }
    return val;
  }

  parsePrimary() {
    const tok = this.peek();
    if (!tok) throw new Error("#SYNTAX!");

    if (tok.type === "number" || tok.type === "string") {
      this.consume();
      return tok.value;
    }

    if (tok.type === "punct" && tok.value === "(") {
      this.consume();
      const val = this.parseComparison();
      if (this.peek()?.type !== "punct" || this.peek().value !== ")") {
        throw new Error("#SYNTAX!");
      }
      this.consume();
      return val;
    }

    if (tok.type === "ident") {
      const ident = this.consume().value;
      const upper = normalizeFuncName(ident);

      // Chamada de funcao: NOME(arg1; arg2; ...)
      if (this.peek()?.type === "punct" && this.peek().value === "(") {
        return this.parseFunctionCall(upper);
      }

      if (upper === "TRUE" || upper === "VERDADEIRO") return true;
      if (upper === "FALSE" || upper === "FALSO") return false;

      // Referencia de celula ou intervalo A1:B3
      const startCoords = cellRefToCoords(ident);
      if (startCoords) {
        if (this.peek()?.type === "punct" && this.peek().value === ":") {
          this.consume();
          const endTok = this.consume();
          if (!endTok || endTok.type !== "ident") throw new Error("#REF!");
          const endCoords = cellRefToCoords(endTok.value);
          if (!endCoords) throw new Error("#REF!");
          return this.collectRangeValues(startCoords, endCoords);
        }
        return this.resolveCellValue(startCoords.row, startCoords.col);
      }

      throw new Error("#NAME?");
    }

    throw new Error("#SYNTAX!");
  }

  parseRawArgSlices() {
    this.consume(); // '('
    const slices = [];
    if (this.peek()?.type === "punct" && this.peek().value === ")") {
      this.consume();
      return slices;
    }

    let start = this.pos;
    let depth = 0;
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      if (t.type === "punct" && t.value === "(") {
        depth++;
      } else if (t.type === "punct" && t.value === ")") {
        if (depth === 0) {
          slices.push(this.tokens.slice(start, this.pos));
          this.pos++;
          return slices;
        }
        depth--;
      } else if (depth === 0 && t.type === "punct" && (t.value === "," || t.value === ";")) {
        slices.push(this.tokens.slice(start, this.pos));
        start = this.pos + 1;
      }
      this.pos++;
    }
    throw new Error("#SYNTAX!");
  }

  evalSlice(slice) {
    if (!slice.length) return "";
    const sub = new ExcelFormulaEngine(this.rows, this.visited);
    sub.tokens = slice;
    sub.pos = 0;
    const val = sub.parseComparison();
    if (sub.pos !== sub.tokens.length) throw new Error("#SYNTAX!");
    return val;
  }

  parseFunctionCall(fn) {
    const rawSlices = this.parseRawArgSlices();

    // Avaliacao lazy para IF/SE e IFERROR/SEERRO
    if (fn === "IF" || fn === "SE") {
      if (rawSlices.length < 2) throw new Error("#VALUE!");
      const cond = toBool(this.unwrapScalar(this.evalSlice(rawSlices[0])));
      if (cond) return this.unwrapScalar(this.evalSlice(rawSlices[1]));
      return rawSlices.length >= 3 ? this.unwrapScalar(this.evalSlice(rawSlices[2])) : false;
    }

    if (fn === "IFERROR" || fn === "SEERRO") {
      if (rawSlices.length < 2) throw new Error("#VALUE!");
      try {
        const res = this.unwrapScalar(this.evalSlice(rawSlices[0]));
        if (typeof res === "number" && !Number.isFinite(res)) {
          return this.unwrapScalar(this.evalSlice(rawSlices[1]));
        }
        return res;
      } catch (_) {
        return this.unwrapScalar(this.evalSlice(rawSlices[1]));
      }
    }

    const args = rawSlices.map(s => this.evalSlice(s));
    return this.invokeFunction(fn, args);
  }

  invokeFunction(fn, args) {
    const scalar = idx => this.unwrapScalar(args[idx]);

    switch (fn) {
      case "SUM":
      case "SOMA":
        return this.flattenNumericArgs(args).reduce((a, b) => a + b, 0);

      case "AVERAGE":
      case "AVG":
      case "MEDIA": {
        const nums = this.flattenNumericArgs(args);
        if (!nums.length) return 0;
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      }

      case "MIN":
      case "MINIMO": {
        const nums = this.flattenNumericArgs(args);
        return nums.length ? Math.min(...nums) : 0;
      }

      case "MAX":
      case "MAXIMO": {
        const nums = this.flattenNumericArgs(args);
        return nums.length ? Math.max(...nums) : 0;
      }

      case "MEDIAN":
      case "MED": {
        const nums = this.flattenNumericArgs(args).sort((a, b) => a - b);
        if (!nums.length) return 0;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
      }

      case "PRODUCT":
      case "MULT": {
        const nums = this.flattenNumericArgs(args);
        return nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
      }

      case "COUNT":
      case "CONT":
      case "CONT.NUM":
        return this.flattenNumericArgs(args).length;

      case "COUNTA":
      case "CONT.VALORES":
        return this.flattenAllArgs(args).filter(v => v !== "" && v !== null && v !== undefined).length;

      case "COUNTBLANK":
      case "CONTAR.VAZIO":
        return this.flattenAllArgs(args).filter(v => v === "" || v === null || v === undefined).length;

      case "ABS":
        return Math.abs(toNumber(scalar(0)));

      case "ROUND":
      case "ARRED": {
        const n = toNumber(scalar(0));
        const d = args.length > 1 ? Math.trunc(toNumber(scalar(1))) : 0;
        const f = Math.pow(10, d);
        return Math.round(n * f) / f;
      }

      case "ROUNDUP":
      case "ARREDONDAR.PARA.CIMA": {
        const n = toNumber(scalar(0));
        const d = args.length > 1 ? Math.trunc(toNumber(scalar(1))) : 0;
        const f = Math.pow(10, d);
        return (n >= 0 ? Math.ceil(n * f) : Math.floor(n * f)) / f;
      }

      case "ROUNDDOWN":
      case "ARREDONDAR.PARA.BAIXO": {
        const n = toNumber(scalar(0));
        const d = args.length > 1 ? Math.trunc(toNumber(scalar(1))) : 0;
        const f = Math.pow(10, d);
        return Math.trunc(n * f) / f;
      }

      case "INT":
        return Math.floor(toNumber(scalar(0)));

      case "SQRT":
      case "RAIZ": {
        const n = toNumber(scalar(0));
        if (n < 0) throw new Error("#NUM!");
        return Math.sqrt(n);
      }

      case "POWER":
      case "POTENCIA":
        return Math.pow(toNumber(scalar(0)), toNumber(scalar(1)));

      case "MOD": {
        const a = toNumber(scalar(0));
        const b = toNumber(scalar(1));
        if (b === 0) throw new Error("#DIV/0!");
        return ((a % b) + b) % b;
      }

      case "AND":
      case "E":
        return this.flattenAllArgs(args).every(v => toBool(v));

      case "OR":
      case "OU":
        return this.flattenAllArgs(args).some(v => toBool(v));

      case "NOT":
      case "NAO":
        return !toBool(scalar(0));

      case "COUNTIF":
      case "CONT.SE": {
        const rangeVals = this.flattenAllArgs([args[0]]);
        const crit = scalar(1);
        return rangeVals.filter(v => matchesCriteria(v, crit)).length;
      }

      case "SUMIF":
      case "SOMASE": {
        const checkVals = this.flattenAllArgs([args[0]]);
        const crit = scalar(1);
        const sumVals = args.length >= 3 ? this.flattenAllArgs([args[2]]) : checkVals;
        let total = 0;
        for (let idx = 0; idx < checkVals.length; idx++) {
          if (matchesCriteria(checkVals[idx], crit)) {
            const n = parseNumericValue(sumVals[idx]);
            if (n !== null) total += n;
          }
        }
        return total;
      }

      case "AVERAGEIF":
      case "MEDIASE": {
        const checkVals = this.flattenAllArgs([args[0]]);
        const crit = scalar(1);
        const avgVals = args.length >= 3 ? this.flattenAllArgs([args[2]]) : checkVals;
        let total = 0;
        let count = 0;
        for (let idx = 0; idx < checkVals.length; idx++) {
          if (matchesCriteria(checkVals[idx], crit)) {
            const n = parseNumericValue(avgVals[idx]);
            if (n !== null) {
              total += n;
              count++;
            }
          }
        }
        return count ? total / count : 0;
      }

      case "CONCAT":
      case "CONCATENATE":
      case "CONCATENAR":
        return this.flattenAllArgs(args).map(v => toStr(v)).join("");

      case "UPPER":
      case "MAIUSCULA":
        return toStr(scalar(0)).toUpperCase();

      case "LOWER":
      case "MINUSCULA":
        return toStr(scalar(0)).toLowerCase();

      case "LEN":
      case "NUM.CARACT":
        return toStr(scalar(0)).length;

      case "TRIM":
      case "ARRUMAR":
        return toStr(scalar(0)).trim().replace(/\s+/g, " ");

      case "LEFT":
      case "ESQUERDA": {
        const text = toStr(scalar(0));
        const n = args.length > 1 ? Math.max(0, Math.trunc(toNumber(scalar(1)))) : 1;
        return text.slice(0, n);
      }

      case "RIGHT":
      case "DIREITA": {
        const text = toStr(scalar(0));
        const n = args.length > 1 ? Math.max(0, Math.trunc(toNumber(scalar(1)))) : 1;
        return n === 0 ? "" : text.slice(-n);
      }

      case "MID":
      case "EXT.TEXTO": {
        const text = toStr(scalar(0));
        const start = Math.max(1, Math.trunc(toNumber(scalar(1))));
        const count = Math.max(0, Math.trunc(toNumber(scalar(2))));
        return text.slice(start - 1, start - 1 + count);
      }

      case "VLOOKUP":
      case "PROCV": {
        const key = scalar(0);
        const tableArg = args[1];
        const colIdx = Math.trunc(toNumber(scalar(2)));
        if (!tableArg?.__range || colIdx < 1 || colIdx > (tableArg.matrix[0]?.length || 0)) {
          throw new Error("#REF!");
        }
        for (const row of tableArg.matrix) {
          if (matchesCriteria(row[0], key)) {
            return row[colIdx - 1] ?? "";
          }
        }
        throw new Error("#N/A");
      }

      case "TODAY":
      case "HOJE": {
        const now = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
      }

      case "NOW":
      case "AGORA": {
        const now = new Date();
        const pad = n => String(n).padStart(2, "0");
        return `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }

      default:
        throw new Error("#NAME?");
    }
  }
}

export function evaluateCellFormula(rawValue, rows, rowIdx = -1, colIdx = -1) {
  const str = String(rawValue ?? "");
  if (!str.trim().startsWith("=")) return str;
  const visited = new Set();
  if (rowIdx >= 0 && colIdx >= 0) {
    visited.add(`${rowIdx}:${colIdx}`);
  }
  try {
    const engine = new ExcelFormulaEngine(rows, visited);
    const result = engine.evaluate(str.trim().slice(1));
    if (typeof result === "number") {
      if (!Number.isFinite(result)) return "#ERR";
      const rounded = Math.round(result * 10000) / 10000;
      return String(rounded);
    }
    if (typeof result === "boolean") {
      return result ? "TRUE" : "FALSE";
    }
    return String(result ?? "");
  } catch (_) {
    return "#ERR";
  }
}

function escapeHtmlBasic(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const TABLE_CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5"/></svg>`;

export function renderCardTableHtml(data) {
  const norm = normalizeTableData(data);
  const encoded = encodeTableData(norm);
  const hasChecks = Boolean(norm.hasCheckboxes);
  const rowsHtml = norm.rows
    .map((row, rIdx) => {
      const rowChecked = hasChecks && String(row[0] || "").trim().toLowerCase() === "[x]";
      const cellsHtml = row
        .map((rawVal, cIdx) => {
          if (hasChecks && cIdx === 0) {
            const rawFlag = rowChecked ? "[x]" : "[ ]";
            return `<td class="card-excel-cell card-excel-check-cell" contenteditable="false" data-row="${rIdx}" data-col="0" data-raw="${rawFlag}"><button type="button" class="card-table-check-btn${rowChecked ? " checked" : ""}" role="checkbox" aria-checked="${rowChecked}" title="Concluir item">${rowChecked ? TABLE_CHECK_SVG : ""}</button></td>`;
          }
          const isFormula = String(rawVal || "").trim().startsWith("=");
          const displayVal = isFormula ? evaluateCellFormula(rawVal, norm.rows, rIdx, cIdx) : rawVal;
          const cellRef = `${colIndexToLetter(cIdx)}${rIdx + 1}`;
          const formulaClass = isFormula ? " is-formula" : "";
          return `<td class="card-excel-cell${formulaClass}" contenteditable="true" data-row="${rIdx}" data-col="${cIdx}" data-raw="${escapeHtmlBasic(rawVal)}" title="${cellRef}${isFormula ? ` (${escapeHtmlBasic(rawVal)})` : ""}">${escapeHtmlBasic(displayVal)}</td>`;
        })
        .join("");
      return `<tr${rowChecked ? ` class="is-checked-row"` : ""}>${cellsHtml}</tr>`;
    })
    .join("");

  const checkAttr = hasChecks ? ` data-has-checkboxes="true"` : "";
  return `<div class="card-table-wrap" contenteditable="false" data-table-encoded="${encoded}"${checkAttr}><div class="card-table-toolbar"><button type="button" class="card-table-btn" data-table-action="addRow" title="Adicionar linha">+ Lin</button><button type="button" class="card-table-btn" data-table-action="addCol" title="Adicionar coluna">+ Col</button><button type="button" class="card-table-btn" data-table-action="delRow" title="Remover linha">- Lin</button><button type="button" class="card-table-btn" data-table-action="delCol" title="Remover coluna">- Col</button><button type="button" class="card-table-btn danger" data-table-action="delTable" title="Remover tabela">×</button></div><div class="card-table-scroll"><table class="card-excel-table"><tbody>${rowsHtml}</tbody></table></div></div>`;
}
