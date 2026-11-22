import test from "node:test";
import assert from "node:assert/strict";
import {
  extractWordAtOffset,
  resolveTooltipDirection,
  clampTooltipPosition
} from "../src/translatorTooltip.js";

test("extractWordAtOffset extrai palavras com acentos, contracoes e hifens", () => {
  const line = "However, I can't seem to find a tradução bem-feita.";
  assert.deepEqual(extractWordAtOffset(line, 2), { word: "However", start: 0, end: 7 });
  assert.deepEqual(extractWordAtOffset(line, 13), { word: "can't", start: 11, end: 16 });
  assert.deepEqual(extractWordAtOffset(line, 36), { word: "tradução", start: 32, end: 40 });
  assert.deepEqual(extractWordAtOffset(line, 44), { word: "bem-feita", start: 41, end: 50 });
  // Espaco entre palavras ou pontuacao isolada retorna null
  assert.equal(extractWordAtOffset("ola   mundo", 4), null);
  assert.equal(extractWordAtOffset("...", 1), null);
});

test("resolveTooltipDirection inverte direcao no campo de saida e mantem no de entrada", () => {
  assert.equal(resolveTooltipDirection("output", "pt-en"), "en-pt");
  assert.equal(resolveTooltipDirection("output", "en-pt"), "pt-en");
  assert.equal(resolveTooltipDirection("output", "auto"), "auto");
  assert.equal(resolveTooltipDirection("input", "pt-en"), "pt-en");
  assert.equal(resolveTooltipDirection("input", "en-pt"), "en-pt");
});

test("clampTooltipPosition mantem tooltip dentro de janelas pequenas", () => {
  const topFit = clampTooltipPosition({ left: 100, right: 160, top: 80, bottom: 98 }, 180, 44, 340, 320);
  assert.equal(topFit.placement, "top");
  assert.ok(topFit.left >= 8 && topFit.left + 180 <= 332);
  assert.ok(topFit.top >= 8);

  const flipBottom = clampTooltipPosition({ left: 4, right: 40, top: 10, bottom: 28 }, 200, 50, 300, 260);
  assert.equal(flipBottom.placement, "bottom");
  assert.equal(flipBottom.left, 8);
  assert.equal(flipBottom.top, 36);
});
