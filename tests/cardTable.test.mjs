import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultTableData,
  encodeTableData,
  decodeTableData,
  serializeTableToken,
  addTableRow,
  removeTableRow,
  addTableCol,
  removeTableCol,
  parseTsvToTableData,
  applyTsvIntoTable,
  evaluateCellFormula,
  renderCardTableHtml,
  colIndexToLetter,
  cellRefToCoords
} from "../src/cardTable.js";

test("createDefaultTableData gera tabela 3x3 uniforme sem header", () => {
  const data = createDefaultTableData(3, 3);
  assert.equal(data.rows.length, 3);
  assert.equal(data.rows[0].length, 3);
  assert.deepEqual(data.rows[0], ["", "", ""]);
});

test("encode/decode preserva UTF-8, acentos, simbolos e quebras de linha", () => {
  const original = {
    rows: [
      ["Descrição", "Preço (R$)", "Observação"],
      ["Café & Pão", "12,50", "Atenção: urgente!"],
      ["Total", "=SOMA(B2:B2)", "100% ok"]
    ]
  };
  const encoded = encodeTableData(original);
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  const decoded = decodeTableData(encoded);
  assert.deepEqual(decoded, original);

  const token = serializeTableToken(original);
  assert.ok(token.startsWith("[[table:") && token.endsWith("]]"));
});

test("addTableRow, removeTableRow, addTableCol, removeTableCol respeitam limites minimos", () => {
  let data = createDefaultTableData(2, 2);
  data = addTableRow(data, 0);
  assert.equal(data.rows.length, 3);
  assert.equal(data.rows[1].length, 2);

  data = addTableCol(data, 1);
  assert.equal(data.rows[0].length, 3);
  assert.equal(data.rows[0][2], "");

  data = removeTableRow(data, 1);
  assert.equal(data.rows.length, 2);

  data = removeTableCol(data, 2);
  assert.equal(data.rows[0].length, 2);

  // Nao deve remover a ultima linha/coluna restante
  data = removeTableRow(data, 0);
  data = removeTableRow(data, 0);
  assert.equal(data.rows.length, 1);

  data = removeTableCol(data, 0);
  data = removeTableCol(data, 0);
  assert.equal(data.rows[0].length, 1);
});

test("parseTsvToTableData e applyTsvIntoTable suportam colagem direta do Excel", () => {
  const excelClipboard = "Item\tQtd\tValor\r\nTeclado\t2\t150\r\nMouse\t1\t80\r\n";
  const parsed = parseTsvToTableData(excelClipboard);
  assert.ok(parsed);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[1], ["Teclado", "2", "150"]);

  // Texto simples sem tab nao deve virar tabela
  assert.equal(parseTsvToTableData("texto comum sem colunas"), null);

  // Colar dentro de tabela existente expande automaticamente
  const base = createDefaultTableData(2, 2);
  const merged = applyTsvIntoTable(base, 1, 1, "10\t20\n30\t40");
  assert.equal(merged.rows.length, 3);
  assert.equal(merged.rows[0].length, 3);
  assert.equal(merged.rows[1][1], "10");
  assert.equal(merged.rows[2][2], "40");
});

test("evaluateCellFormula calcula =SUM, =SOMA, =AVG, =MIN, =MAX, =COUNT e aritmetica", () => {
  const rows = [
    ["Item", "Qtd", "Unit", "Total"],
    ["A", "2", "10,50", "=B2*C2"],
    ["B", "3", "20", "=B3*C3"],
    ["Soma", "=SUM(B2:B3)", "=AVG(C2:C3)", "=SOMA(D2:D3)"]
  ];

  assert.equal(evaluateCellFormula("=B2*C2", rows, 1, 3), "21");
  assert.equal(evaluateCellFormula("=B3*C3", rows, 2, 3), "60");
  assert.equal(evaluateCellFormula("=SUM(B2:B3)", rows, 3, 1), "5");
  assert.equal(evaluateCellFormula("=AVG(C2:C3)", rows, 3, 2), "15.25");
  assert.equal(evaluateCellFormula("=SOMA(D2:D3)", rows, 3, 3), "81");
  assert.equal(evaluateCellFormula("=MIN(B2:B3)", rows), "2");
  assert.equal(evaluateCellFormula("=MAX(C2:C3)", rows), "20");
  assert.equal(evaluateCellFormula("=COUNT(B2:B3)", rows), "2");
  assert.equal(evaluateCellFormula("=(B2+B3)*10", rows), "50");

  // Referencia circular nao trava e divisao por zero retorna #ERR
  const circular = [["=A1", "=10/0"]];
  assert.equal(evaluateCellFormula("=A1", circular, 0, 0), "0");
  assert.equal(evaluateCellFormula("=10/0", circular, 0, 1), "#ERR");
});

test("colIndexToLetter e cellRefToCoords convertem corretamente alem de Z", () => {
  assert.equal(colIndexToLetter(0), "A");
  assert.equal(colIndexToLetter(25), "Z");
  assert.equal(colIndexToLetter(26), "AA");
  assert.deepEqual(cellRefToCoords("B3"), { row: 2, col: 1 });
  assert.deepEqual(cellRefToCoords("AA1"), { row: 0, col: 26 });
});

test("renderCardTableHtml renderiza tabela escapada com formulas avaliadas", () => {
  const data = {
    rows: [
      ["Produto", "Valor"],
      ["<script>", "10"],
      ["Total", "=SUM(B2:B2)"]
    ]
  };
  const html = renderCardTableHtml(data);
  assert.ok(html.includes('class="card-table-wrap"'));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('data-raw="=SUM(B2:B2)"'));
  assert.ok(html.includes(">10</td>"));
});
