// Roteamento de links com desvio de obstaculos (cards).
//
// Gera uma polilinha ortogonal de start -> end que nunca cruza o interior de
// nenhum card, usando uma grade de Hanan (linhas nas bordas dos obstaculos,
// afastadas por uma margem) percorrida com A*. O modo "ondulada" arredonda os
// cantos da mesma rota; o modo "reta" mantem os cantos em angulo.
//
// Convencao de obstaculo: { x1, y1, x2, y2 } ja inflado pela margem.
// As funcoes sao puras (sem DOM) para ficarem faceis de testar.

const EPS = 0.5;

export function routeLinkPath({ start, end, startPort = "out", endPort = "in", obstacles = [], margin = 18, curved = false }) {
  const startStub = stubPoint(start, startPort, margin);
  const endStub = stubPoint(end, endPort, margin);

  // So importam os cards perto do corredor start->end. Filtrar mantem a grade
  // A* pequena (rapido durante o arraste) sem perder o desvio relevante.
  const pad = 140;
  const nearX1 = Math.min(start.x, end.x) - pad;
  const nearY1 = Math.min(start.y, end.y) - pad;
  const nearX2 = Math.max(start.x, end.x) + pad;
  const nearY2 = Math.max(start.y, end.y) + pad;
  const near = obstacles.filter(o => o.x2 > nearX1 && o.x1 < nearX2 && o.y2 > nearY1 && o.y1 < nearY2);

  // Garante que nenhum obstaculo engula o ponto de partida/chegada (startStub/endStub)
  // caso dois cards estejam muito proximos, evitando que o A* falhe e caia no fallback reto.
  const safeObstacles = near.map(o => clampObstacleAroundEndpoints(o, startStub, endStub));

  let waypoints = findOrthogonalRoute(startStub, endStub, safeObstacles, margin);
  if (!waypoints) {
    waypoints = simpleElbow(startStub, endStub, startPort, endPort);
  }

  const points = simplify([start, ...waypoints, end]);
  return curved ? toCurvedPath(points, margin) : toPolyline(points);
}

// Ponto "stub": empurra o port para fora do card pela margem, no sentido normal
// da face onde o port fica. Garante que a linha sai/entra perpendicular e ja
// fora do proprio card.
function stubPoint(p, port, margin) {
  switch (port) {
    case "in": return { x: Math.round(p.x - margin), y: Math.round(p.y) };
    case "out": return { x: Math.round(p.x + margin), y: Math.round(p.y) };
    case "top": return { x: Math.round(p.x), y: Math.round(p.y - margin) };
    case "bottom": return { x: Math.round(p.x), y: Math.round(p.y + margin) };
    default: return { x: Math.round(p.x + margin), y: Math.round(p.y) };
  }
}

function findOrthogonalRoute(s, t, obstacles, margin) {
  const xsSet = new Set([s.x, t.x]);
  const ysSet = new Set([s.y, t.y]);
  for (const o of obstacles) {
    xsSet.add(o.x1); xsSet.add(o.x2);
    ysSet.add(o.y1); ysSet.add(o.y2);
  }

  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  const cols = xs.length;
  const rows = ys.length;

  // Guarda de tamanho: boards muito grandes caem no fallback simples.
  if (cols * rows > 4000) return null;

  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  const sIx = xi.get(s.x), sIy = yi.get(s.y);
  const tIx = xi.get(t.x), tIy = yi.get(t.y);
  if (sIx == null || sIy == null || tIx == null || tIy == null) return null;

  const idx = (ix, iy) => iy * cols + ix;
  const N = cols * rows;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const dirArr = new Int8Array(N).fill(-1); // 0 = horizontal, 1 = vertical
  const heap = new MinHeap();

  const startId = idx(sIx, sIy);
  const goalId = idx(tIx, tIy);
  const turnPenalty = margin * 2;
  const heuristic = (ix, iy) => Math.abs(xs[ix] - t.x) + Math.abs(ys[iy] - t.y);

  gScore[startId] = 0;
  heap.push(startId, heuristic(sIx, sIy));

  while (!heap.isEmpty()) {
    const cur = heap.pop();
    if (cur === goalId) break;
    const cx = cur % cols;
    const cy = (cur / cols) | 0;
    const candidates = [
      [cx - 1, cy, 0], [cx + 1, cy, 0],
      [cx, cy - 1, 1], [cx, cy + 1, 1]
    ];

    for (const [nx, ny, dir] of candidates) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ax = xs[cx], ay = ys[cy], bx = xs[nx], by = ys[ny];
      if (segmentBlocked(ax, ay, bx, by, obstacles)) continue;

      const nId = idx(nx, ny);
      const len = Math.abs(bx - ax) + Math.abs(by - ay);
      const turn = dirArr[cur] !== -1 && dirArr[cur] !== dir ? turnPenalty : 0;
      const ng = gScore[cur] + len + turn;
      if (ng < gScore[nId]) {
        gScore[nId] = ng;
        came[nId] = cur;
        dirArr[nId] = dir;
        heap.push(nId, ng + heuristic(nx, ny));
      }
    }
  }

  if (gScore[goalId] === Infinity) return null;

  const path = [];
  let c = goalId;
  while (true) {
    const cx = c % cols;
    const cy = (c / cols) | 0;
    path.push({ x: xs[cx], y: ys[cy] });
    if (c === startId) break;
    c = came[c];
    if (c === -1) return null;
  }
  path.reverse();
  return path;
}

// Se um ponto stub cair estritamente dentro de um obstaculo inflado (ex.: gap < 2*margin),
// recua apenas a face mais proxima desse obstaculo ate a borda do stub para liberar o canal.
function clampObstacleAroundEndpoints(o, s, t) {
  let { x1, y1, x2, y2 } = o;
  for (const p of [s, t]) {
    if (p.x > x1 + EPS && p.x < x2 - EPS && p.y > y1 + EPS && p.y < y2 - EPS) {
      const dLeft = p.x - x1;
      const dRight = x2 - p.x;
      const dTop = p.y - y1;
      const dBottom = y2 - p.y;
      const minD = Math.min(dLeft, dRight, dTop, dBottom);
      if (minD === dLeft) x1 = p.x;
      else if (minD === dRight) x2 = p.x;
      else if (minD === dTop) y1 = p.y;
      else y2 = p.y;
    }
  }
  return { x1, y1, x2, y2 };
}

// Um segmento axis-aligned esta bloqueado se atravessa o INTERIOR de algum
// obstaculo. Tocar a borda (deslizar pelo canal da margem) e permitido.
function segmentBlocked(ax, ay, bx, by, obstacles) {
  const minX = Math.min(ax, bx);
  const maxX = Math.max(ax, bx);
  const minY = Math.min(ay, by);
  const maxY = Math.max(ay, by);
  for (const o of obstacles) {
    if (maxX > o.x1 + EPS && minX < o.x2 - EPS && maxY > o.y1 + EPS && minY < o.y2 - EPS) {
      return true;
    }
  }
  return false;
}

function simpleElbow(s, t, startPort, endPort) {
  const sVert = startPort === "top" || startPort === "bottom";
  const eVert = endPort === "top" || endPort === "bottom";
  if (sVert || eVert) {
    const my = (s.y + t.y) / 2;
    return [s, { x: s.x, y: my }, { x: t.x, y: my }, t];
  }
  const mx = (s.x + t.x) / 2;
  return [s, { x: mx, y: s.y }, { x: mx, y: t.y }, t];
}

// Remove pontos duplicados e colineares consecutivos.
function simplify(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < EPS && Math.abs(prev.y - p.y) < EPS) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) < EPS) out.splice(i, 1);
  }
  return out;
}

function toPolyline(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

// Arredonda cada vertice interno com uma curva quadratica, preservando o desvio
// (o raio nunca passa do meio do segmento, ficando dentro do canal da margem).
function toCurvedPath(points, margin) {
  if (points.length < 3) return toPolyline(points);
  const radius = Math.min(margin * 0.9, 26);
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const r1 = Math.min(radius, dist(p0, p1) / 2);
    const r2 = Math.min(radius, dist(p1, p2) / 2);
    const a = toward(p1, p0, r1);
    const b = toward(p1, p2, r2);
    d += ` L ${round(a.x)} ${round(a.y)} Q ${p1.x} ${p1.y} ${round(b.x)} ${round(b.y)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toward(from, to, distance) {
  const d = dist(from, to) || 1;
  return { x: from.x + (to.x - from.x) * (distance / d), y: from.y + (to.y - from.y) * (distance / d) };
}

function round(v) {
  return Math.round(v * 100) / 100;
}

// Min-heap binario simples (prioridade = f-score).
class MinHeap {
  constructor() {
    this.ids = [];
    this.keys = [];
  }
  isEmpty() {
    return this.ids.length === 0;
  }
  push(id, key) {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop() {
    const top = this.ids[0];
    const lastId = this.ids.pop();
    const lastKey = this.keys.pop();
    if (this.ids.length) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      const n = this.ids.length;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.keys[l] < this.keys[smallest]) smallest = l;
        if (r < n && this.keys[r] < this.keys[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }
  swap(a, b) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
