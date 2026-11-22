// Logica pura para o tooltip de traducao por hover (1s) e selecao de texto no tradutor.

const WORD_CHAR_RE = /[\p{L}\p{N}'’-]/u;
const EDGE_PUNCT_RE = /^['’-]+|['’-]+$/g;

export function extractWordAtOffset(text, offset) {
  const source = String(text || "");
  if (!source || offset < 0 || offset > source.length) return null;

  let idx = offset;
  if (idx === source.length || !WORD_CHAR_RE.test(source[idx])) {
    if (idx > 0 && WORD_CHAR_RE.test(source[idx - 1])) {
      idx -= 1;
    } else {
      return null;
    }
  }

  let start = idx;
  let end = idx + 1;
  while (start > 0 && WORD_CHAR_RE.test(source[start - 1])) start -= 1;
  while (end < source.length && WORD_CHAR_RE.test(source[end])) end += 1;

  const raw = source.slice(start, end);
  const leadingTrim = raw.match(/^['’-]+/)?.[0]?.length || 0;
  const trailingTrim = raw.match(/['’-]+$/)?.[0]?.length || 0;
  const cleanStart = start + leadingTrim;
  const cleanEnd = end - trailingTrim;
  const word = raw.replace(EDGE_PUNCT_RE, "").trim();

  if (!word || cleanEnd <= cleanStart) return null;
  return { word, start: cleanStart, end: cleanEnd };
}

export function resolveTooltipDirection(boxKind, currentDirection) {
  if (currentDirection === "auto") return "auto";
  if (boxKind === "output") {
    return currentDirection === "en-pt" ? "pt-en" : "en-pt";
  }
  return currentDirection === "en-pt" ? "en-pt" : "pt-en";
}

export function clampTooltipPosition(anchorRect, tooltipWidth, tooltipHeight, viewportWidth, viewportHeight, margin = 8) {
  const gap = 8;
  const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
  let left = Math.round(anchorCenterX - tooltipWidth / 2);
  left = Math.max(margin, Math.min(viewportWidth - tooltipWidth - margin, left));

  let top = Math.round(anchorRect.top - tooltipHeight - gap);
  let placement = "top";
  if (top < margin) {
    top = Math.round(anchorRect.bottom + gap);
    placement = "bottom";
  }
  top = Math.max(margin, Math.min(viewportHeight - tooltipHeight - margin, top));

  return { left, top, placement };
}
