// SPDX-License-Identifier: MPL-2.0

/**
 * Árvores e casas detalhadas, em vários tamanhos, para o detalhe crescer com o zoom (§9):
 * de longe aparecem como símbolos pequenos; de perto, no tamanho real, com cachos de folhas
 * iluminados um a um, vãos que deixam ver os galhos, casca e raízes no tronco.
 * Formas e paletas originais; as referências (`assets-organizado/arvores`, `construcoes`) só
 * orientaram escala, densidade de tons e volume (DEC-023).
 */

import { Canvas, EMPTY, clampIndex, type Sprite } from './canvas';
import {
  CONIFER,
  ROOF_SLATE,
  ROOF_TERRACOTTA,
  ROOF_THATCH,
  SNOW,
  TIMBER,
  TRUNK,
  WALL,
  WINDOW_DARK,
  WINDOW_LIT,
  type Ramp,
} from './color';
import { hashPx, rng } from './noise';

/** Linha de 1 px (Bresenham) com a cor dada. */
function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, color: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    c.set(x, y, color);
    if (x === xe && y === ye) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Árvore de folhas largas. `r` é o raio da copa em pixels de arte (3 a 16).
 * Copa = cachos esféricos iluminados do noroeste; cada cacho é feito de "folhas" de 3–4 px com
 * luz própria (borda de cima clara, de baixo escura); vincos entre cachos; vãos nas bordas mostram
 * os galhos; contorno escuro com fio de luz no lado iluminado.
 */
export function makeBroadleaf(r: number, seed: number, leaves: Ramp): Sprite {
  const rnd = rng(seed);
  const W = Math.round(2 * r * 1.12) + 5;
  const canopyH = Math.round(2 * r * 0.9) + 3;
  const trunkH = Math.max(2, Math.round(r * 0.42) + 1);
  const H = canopyH + trunkH;
  const c = new Canvas(W, H);
  const cx = (W - 1) / 2;
  const cy = canopyH / 2;
  const tw = r < 5 ? 1 : r < 8 ? 2 : r < 12 ? 3 : 4;
  const trunkTop = Math.round(cy + r * 0.35);

  // Tronco com casca (luz à esquerda, veios escuros) e raízes abertas na base.
  const k0 = -Math.floor((tw - 1) / 2);
  for (let y = trunkTop; y < H; y++) {
    for (let k = k0; k < k0 + tw; k++) {
      const x = Math.round(cx) + k;
      const side = (k - k0 + 0.5) / tw;
      let t = tw === 1 ? 2 : side < 0.34 ? 4 : side < 0.67 ? 3 : 1;
      if (hashPx(x, y >> 1, seed) < 0.25) t -= 1;
      c.set(x, y, TRUNK[t]!);
    }
  }
  const spread = Math.max(1, Math.round(tw * 0.8 + r * 0.12));
  for (let k = 1; k <= spread; k++) {
    c.set(Math.round(cx) + k0 - k, H - 1, TRUNK[k === spread ? 1 : 3]!);
    c.set(Math.round(cx) + k0 + tw - 1 + k, H - 1, TRUNK[k === spread ? 0 : 1]!);
  }

  // Cachos da copa.
  const clusters: { x: number; y: number; r: number }[] = [{ x: cx, y: cy + r * 0.05, r: r * 0.86 }];
  const n = 4 + Math.floor(r * 0.9);
  for (let i = 0; i < n; i++) {
    const a = rnd() * 6.2832;
    const d = Math.sqrt(rnd()) * r * 0.62;
    clusters.push({
      x: cx + Math.cos(a) * d * 1.18,
      y: cy + Math.sin(a) * d * 0.82 - r * 0.08,
      r: r * (0.3 + rnd() * 0.22) + 0.8,
    });
  }
  // Escamas de folha: pontos espalhados em grade irregular; cada pixel pertence à escama mais próxima.
  const step = r >= 8 ? 3.3 : r >= 5 ? 2.7 : 2.2;
  const cols = Math.ceil(W / step) + 2;
  const rowsN = Math.ceil(canopyH / step) + 2;
  const scales: { x: number; y: number }[] = [];
  for (let j = 0; j < rowsN; j++) {
    for (let i = 0; i < cols; i++) {
      scales.push({ x: (i - 0.5 + rnd() * 0.9) * step, y: (j - 0.5 + rnd() * 0.9) * step });
    }
  }
  const nearestScale = (x: number, y: number): { dx: number; dy: number; d: number; id: number } => {
    const gi = Math.floor(x / step + 0.5);
    const gj = Math.floor(y / step + 0.5);
    let best = { dx: 0, dy: 0, d: 1e9, id: 0 };
    for (let j = gj - 1; j <= gj + 1; j++) {
      for (let i = gi - 1; i <= gi + 1; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= rowsN) continue;
        const s = scales[j * cols + i]!;
        const dx = x - s.x;
        const dy = y - s.y;
        const d = dx * dx + dy * dy;
        if (d < best.d) best = { dx, dy, d, id: j * cols + i };
      }
    }
    return best;
  };
  // Galhos do topo do tronco até alguns cachos (aparecem nos vãos).
  if (r >= 7) {
    for (const k of clusters.slice(1, 6)) line(c, cx, trunkTop + 1, k.x, k.y + k.r * 0.3, TRUNK[1]!);
  }

  const light = { x: -0.55, y: -0.62, z: 0.56 };
  const canopy = new Canvas(W, canopyH);
  const tone = new Float64Array(W * canopyH);
  for (let y = 0; y < canopyH; y++) {
    for (let x = 0; x < W; x++) {
      let best = -1;
      let bestH = 0;
      let second = 0;
      for (let i = 0; i < clusters.length; i++) {
        const k = clusters[i]!;
        const dx = (x - k.x) / k.r;
        const dy = (y - k.y) / k.r;
        const h = 1 - dx * dx - dy * dy;
        if (h > bestH) {
          second = bestH;
          bestH = h;
          best = i;
        } else if (h > second) second = h;
      }
      if (best < 0) continue;
      const k = clusters[best]!;
      const nx = (x - k.x) / k.r;
      const ny = (y - k.y) / k.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lum = nx * light.x + ny * light.y + nz * light.z;
      const global = -((x - cx) / r) * 0.22 - ((y - cy) / r) * 0.3;
      // escama de folha: luz própria (lado de cima/esquerda claro), beirada de baixo escura
      const s = nearestScale(x, y);
      const sr = step * 0.62;
      const su = s.dx / sr;
      const sv = s.dy / sr;
      const edgeOfScale = s.d > sr * sr;
      const leafLum = -su * 0.45 - sv * 0.6 + (hashPx(s.id, 0, seed + 7) - 0.5) * 0.8 - (edgeOfScale && sv > 0 ? 0.9 : 0);
      let t = 4 + lum * 3 + global * 2.4 + leafLum * (r >= 5 ? 1.15 : 0.7) + (rnd() - 0.5) * 0.4;
      if (second > 0 && bestH - second < 0.12) t -= 1.6; // vinco entre cachos
      // contorno recortado: na borda da copa, só ficam as escamas inteiras
      const outer = bestH < 0.22;
      if (outer && edgeOfScale) continue;
      // vãos nas árvores grandes (deixam ver os galhos)
      if (r >= 7 && bestH < 0.4 && lum < 0.1 && hashPx(s.id, 1, seed + 3) < 0.18) continue;
      tone[y * W + x] = t;
      canopy.set(x, y, clampIndex(leaves, t));
    }
  }
  for (let y = 0; y < canopyH; y++) {
    for (let x = 0; x < W; x++) {
      if (canopy.get(x, y) === EMPTY) continue;
      const t = tone[y * W + x]!;
      let color = canopy.get(x, y);
      // borda: só um tom abaixo do próprio (sem contorno preto de jogo antigo)
      if (canopy.edge(x, y)) color = clampIndex(leaves, t - (x < cx && y < cy ? 0.6 : 1.4));
      else if (t > 6.6 && hashPx(x, y, seed + 9) < 0.18) color = leaves[leaves.length - 2]!;
      c.set(x, y, color);
    }
  }
  return c.sprite(Math.round(cx), H - 1, true);
}

/**
 * Pinheiro alto em camadas caídas, com textura de agulhas em diagonal, lado esquerdo iluminado,
 * sombra sob cada camada e, se `snowy`, neve acumulada em cima das camadas.
 */
export function makeTallConifer(height: number, seed: number, snowy: boolean): Sprite {
  const rnd = rng(seed);
  const half = Math.max(2, Math.round(height * 0.27));
  const W = 2 * half + 1;
  const trunkH = Math.max(2, Math.round(height * 0.12));
  const H = height + trunkH;
  const c = new Canvas(W, H);
  const cx = half;
  for (let y = height - 1; y < H; y++) {
    c.set(cx, y, TRUNK[y === H - 1 ? 1 : 3]!);
    if (height >= 18) c.set(cx + 1, y, TRUNK[1]!);
  }
  const tiers = Math.max(3, Math.round(height / 6));
  for (let k = 0; k < tiers; k++) {
    const top = Math.round((k / tiers) * height * 0.82);
    const bottom = Math.round(((k + 1) / tiers) * height * 0.82 + height * 0.18);
    const hw = half * (0.35 + 0.65 * ((k + 1) / tiers));
    for (let y = top; y <= bottom && y < height; y++) {
      const p = (y - top) / Math.max(1, bottom - top);
      const w = 0.6 + hw * p;
      for (let x = 0; x < W; x++) {
        const dx = x - cx;
        if (Math.abs(dx) > w) continue;
        // borda de baixo da camada sobe nas pontas (galhos caídos)
        if (y > bottom - Math.abs(dx) * 0.35) continue;
        let t = 3.6 - (dx / (half + 0.5)) * 2.4 - (p > 0.82 ? 1.4 : 0) + (p < 0.2 ? 0.6 : 0);
        if (dx < 0 && (x + y) % 3 === 0) t += 1; // agulhas claras
        if (dx > 0 && (x - y + 99) % 3 === 0) t -= 1;
        t += (rnd() - 0.5) * 0.6;
        let color = clampIndex(CONIFER, t);
        if (snowy && p < 0.3 && rnd() < (dx <= 0 ? 0.85 : 0.4)) color = dx <= 0 ? SNOW[7]! : SNOW[3]!;
        c.set(x, y, color);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < W; x++) {
      if (c.get(x, y) !== EMPTY && c.edge(x, y) && x >= cx) c.set(x, y, CONIFER[0]!);
    }
  }
  return c.sprite(cx, H - 1, true);
}

/**
 * Casa vista de frente e de cima: telhado em água dupla com fiadas de telha (claro à esquerda,
 * sombra à direita), parede de reboco com enxaimel, porta e janelas (algumas acesas).
 * `w` é a largura em pixels de arte (7 = símbolo, até ~23 = casa grande de perto).
 */
export function makeHouse(w: number, seed: number): Sprite {
  const rnd = rng(seed);
  const roofs = [ROOF_TERRACOTTA, ROOF_SLATE, ROOF_THATCH];
  const roof = roofs[Math.floor(rnd() * roofs.length)]!;
  const H = Math.round(w * 0.95);
  const c = new Canvas(w, H);
  const roofH = Math.round(H * 0.55);
  const wallTop = roofH - 1;
  const eave = 1;
  // parede
  for (let y = wallTop; y < H; y++) {
    for (let x = eave; x < w - eave; x++) {
      const t = x < w / 2 ? 3 : 2;
      c.set(x, y, WALL[y === H - 1 ? 1 : t]!);
    }
  }
  if (w >= 11) {
    // enxaimel: vigas verticais e uma horizontal
    for (let y = wallTop; y < H; y++) {
      c.set(eave, y, TIMBER);
      c.set(w - 1 - eave, y, TIMBER);
      if (w >= 16) c.set(Math.round(w / 2), y, TIMBER);
    }
    for (let x = eave; x < w - eave; x++) c.set(x, wallTop + Math.round((H - wallTop) * 0.45), TIMBER);
  }
  // porta e janelas
  const doorW = w >= 16 ? 2 : 1;
  const doorX = Math.round(w / 2) - (w >= 16 ? 2 : 0) + (rnd() < 0.5 ? -1 : 1) * (w >= 11 ? 1 : 0);
  for (let y = H - Math.max(2, Math.round((H - wallTop) * 0.55)); y < H; y++) {
    for (let k = 0; k < doorW; k++) c.set(doorX + k, y, k === 0 ? TRUNK[2]! : TRUNK[1]!);
  }
  if (w >= 9) {
    const wy = wallTop + Math.max(1, Math.round((H - wallTop) * 0.25));
    for (const wx of [Math.round(w * 0.22), Math.round(w * 0.72)]) {
      const lit = rnd() < 0.4;
      c.set(wx, wy, lit ? WINDOW_LIT : WINDOW_DARK);
      if (w >= 16) {
        c.set(wx + 1, wy, lit ? WINDOW_LIT : WINDOW_DARK);
        c.set(wx, wy + 1, WINDOW_DARK);
        c.set(wx + 1, wy + 1, WINDOW_DARK);
      }
    }
  }
  // telhado: trapézio com cumeeira; fiadas a cada 2 px; luz à esquerda
  const ridgeY = 0;
  for (let y = ridgeY; y < roofH; y++) {
    const p = (y + 1) / roofH;
    const inset = Math.round((1 - p) * w * 0.18);
    for (let x = inset; x < w - inset; x++) {
      const left = x < w / 2;
      let t = left ? 4 : 2;
      if ((y - ridgeY) % 2 === 1) t -= 1; // fiada
      if (hashPx(x, y, seed) < 0.12) t += left ? 1 : -1;
      if (y === roofH - 1) t = 1; // beiral
      c.set(x, y, roof[t < 0 ? 0 : t >= roof.length ? roof.length - 1 : t]!);
    }
  }
  // chaminé
  if (w >= 11 && rnd() < 0.6) {
    const chx = Math.round(w * (rnd() < 0.5 ? 0.3 : 0.68));
    c.set(chx, 0, ROOF_SLATE[1]!);
    c.set(chx, 1, ROOF_SLATE[2]!);
  }
  // contorno escuro em baixo e à direita
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < w; x++) {
      if (c.get(x, y) === EMPTY) continue;
      if (c.get(x + 1, y) === EMPTY || c.get(x, y + 1) === EMPTY) c.set(x, y, TIMBER);
    }
  }
  return c.sprite(Math.floor(w / 2), H - 1, true);
}
