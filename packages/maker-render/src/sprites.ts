// SPDX-License-Identifier: MPL-2.0

/**
 * Carimbos procedurais (§9): árvores, pinheiros, casas, arbustos, juncos, tufos, rochas, cactos.
 * Cada um é desenhado por código, pixel a pixel, com luz vinda do noroeste, em várias variações
 * (semente fixa), e guardado em cache na carga do módulo — como o `art-cache` do Aqy.
 * As formas e paletas são originais; as referências de `assets-organizado/` só orientaram
 * densidade de tons, contorno, volume e sombra (DEC-023).
 */

import { CACTUS, CANOPY, GRASS, OLIVE, REED, ROCK, TRUNK, type Ramp } from './color';
import { makeBroadleaf, makeHouse, makeTallConifer } from './trees';
import { EMPTY, Canvas, clampIndex, type Sprite } from './canvas';
import { hashPx, rng } from './noise';

export type { Sprite } from './canvas';

/** Tronco curto e escuro com um fio de luz à esquerda. */
function trunk(c: Canvas, cx: number, top: number, bottom: number, wide: boolean): void {
  for (let y = top; y <= bottom; y++) {
    c.set(cx - 1, y, TRUNK[y === bottom ? 1 : 3]!);
    c.set(cx, y, TRUNK[y === bottom ? 0 : 1]!);
    if (wide) c.set(cx + 1, y, TRUNK[0]!);
  }
  c.set(cx - 2, bottom, TRUNK[1]!);
  if (wide) c.set(cx + 2, bottom, TRUNK[0]!);
}

/**
 * Árvore de copa larga: cachos esféricos sobrepostos, iluminados do noroeste, com vincos escuros
 * entre os cachos, grão de folhagem em blocos de 2 px, pintas de realce e contorno escuro.
 * `trunkLen` 0 = sem tronco (floresta densa: só a massa de copas aparece).
 */
export function makeCanopy(radius: number, seed: number, trunkLen: number, lift = 0): Sprite {
  const r = rng(seed);
  const size = radius * 2 + 3;
  const withTrunk = trunkLen > 0;
  const trunkH = trunkLen;
  const c = new Canvas(size, size + trunkH);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const clusters: { x: number; y: number; r: number }[] = [{ x: cx, y: cy + 0.3, r: radius * 0.82 }];
  const n = 3 + Math.floor(r() * 3) + (radius > 4 ? 2 : 0);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.2832;
    const d = r() * radius * 0.55;
    clusters.push({
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d * 0.85 - radius * 0.1,
      r: radius * (0.42 + r() * 0.28),
    });
  }
  if (withTrunk) trunk(c, Math.round(cx), size - 2, size - 1 + trunkH, radius >= 5);

  const light = { x: -0.55, y: -0.62, z: 0.56 };
  const canopy = new Canvas(size, size + trunkH);
  const depth = new Float64Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = -1;
      let bestH = 0;
      let second = 0;
      clusters.forEach((k, i) => {
        const dx = (x - k.x) / k.r;
        const dy = (y - k.y) / k.r;
        const h = 1 - dx * dx - dy * dy;
        if (h > bestH) {
          second = bestH;
          bestH = h;
          best = i;
        } else if (h > second) second = h;
      });
      if (best < 0) continue;
      const k = clusters[best]!;
      const nx = (x - k.x) / k.r;
      const ny = (y - k.y) / k.r;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lum = nx * light.x + ny * light.y + nz * light.z;
      const global = -((x - cx) / radius) * 0.22 - ((y - cy) / radius) * 0.32;
      // grão de folhagem: blocos de 2 px com tom próprio
      const leaf = (hashPx(x >> 1, y >> 1, seed) - 0.5) * 1.6;
      let t = 3.9 + lum * 4.2 + global * 3.2 + leaf + (r() - 0.5) * 0.8 + lift;
      // vinco entre cachos: onde dois cachos quase empatam, fica a sombra entre eles
      if (second > 0 && bestH - second < 0.14) t -= 2.6;
      depth[y * size + x] = t;
      canopy.set(x, y, clampIndex(CANOPY, t));
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (canopy.get(x, y) === EMPTY) continue;
      const t = depth[y * size + x]!;
      let color = canopy.get(x, y);
      if (canopy.edge(x, y)) color = CANOPY[x < cx && y < cy ? 2 : 0]!;
      else if (t > 6.3 && r() < 0.5) color = CANOPY[8]!; // pintas de luz nas folhas
      c.set(x, y, color);
    }
  }
  return c.sprite(Math.round(cx), size - 1 + trunkH, true);
}

/** Touceira de juncos com pontas claras e poça escura na base. */
export function makeReeds(seed: number): Sprite {
  const r = rng(seed);
  const w = 5;
  const h = 6;
  const c = new Canvas(w, h);
  for (let x = 0; x < w; x++) c.set(x, h - 1, x % 2 ? 0x1b2a26 : 0x22352f);
  for (let k = 0; k < 3; k++) {
    const x = k * 2;
    const top = 1 + Math.floor(r() * 3);
    for (let y = top; y < h - 1; y++) c.set(x, y, REED[y === top ? 4 : y < top + 2 ? 3 : 1]!);
  }
  return c.sprite(2, h - 1, false);
}

/** Tufo de capim (2 tons de luz sobre base escura), opcionalmente com flor. */
export function makeTuft(ground: Ramp, seed: number, bloom: number): Sprite {
  const r = rng(seed);
  const c = new Canvas(5, 3);
  c.set(1, 2, ground[2]!);
  c.set(2, 2, ground[2]!);
  c.set(3, 2, ground[1]!);
  c.set(1, 1, ground[6]!);
  c.set(2, 0, ground[7]!);
  c.set(3, 1, ground[5]!);
  if (r() < 0.5) c.set(0, 1, ground[5]!);
  if (bloom >= 0) c.set(2, 0, bloom);
  return c.sprite(2, 2, false);
}

/** Pedra pequena com topo claro e base escura. */
export function makeRock(seed: number, ramp: Ramp): Sprite {
  const r = rng(seed);
  const w = 3 + Math.floor(r() * 3);
  const h = 2 + Math.floor(r() * 2);
  const c = new Canvas(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && y === 0) continue;
      const t = 5.5 - x * 0.8 - y * 1.4 + (r() - 0.5);
      c.set(x, y, clampIndex(ramp, t));
    }
  }
  for (let x = 0; x < w; x++) c.set(x, h - 1, ramp[1]!);
  return c.sprite(Math.floor(w / 2), h - 1, true);
}

/** Cacto colunar com braços. */
export function makeCactus(seed: number): Sprite {
  const r = rng(seed);
  const h = 6 + Math.floor(r() * 3);
  const c = new Canvas(5, h);
  for (let y = 0; y < h; y++) {
    c.set(2, y, CACTUS[y === 0 ? 3 : 2]!);
    c.set(1, y, CACTUS[y === 0 ? 2 : 3]!);
  }
  const arm = 2 + Math.floor(r() * 2);
  c.set(0, arm, CACTUS[3]!);
  c.set(0, arm - 1, CACTUS[3]!);
  c.set(3, arm + 1, CACTUS[1]!);
  c.set(4, arm + 1, CACTUS[1]!);
  c.set(4, arm, CACTUS[1]!);
  c.set(1, h - 1, CACTUS[0]!);
  c.set(2, h - 1, CACTUS[0]!);
  return c.sprite(2, h - 1, true);
}

// ---------- cache: todas as variações, geradas uma vez ----------

const variants = <T>(n: number, f: (i: number) => T): readonly T[] => Object.freeze(Array.from({ length: n }, (_, i) => f(i)));

export const SPRITES = Object.freeze({
  /** Arbusto (copa pequena sem tronco). */
  bush: variants(6, (i) => makeCanopy(3, 7000 + i, 0, 0.6)),
  reeds: variants(4, (i) => makeReeds(9000 + i)),
  tuft: variants(4, (i) => makeTuft(GRASS, 9100 + i, -1)),
  rock: variants(4, (i) => makeRock(9200 + i, ROCK)),
  cactus: variants(3, (i) => makeCactus(9300 + i)),
});

// ---------- detalhe por tamanho (o zoom escolhe a classe) ----------

/** Raios de copa disponíveis (pixels de arte). */
export const TREE_RADII = Object.freeze([3, 4, 5, 6, 8, 10, 12, 15, 19, 24, 30, 38]);
/** Alturas de pinheiro disponíveis. */
export const CONIFER_HEIGHTS = Object.freeze([9, 12, 16, 21, 27, 34, 43, 54, 68]);
/** Larguras de casa disponíveis (7 = símbolo). */
export const HOUSE_WIDTHS = Object.freeze([7, 11, 16, 23, 31, 42]);

export const DETAIL = Object.freeze({
  /** [classe de tamanho][variação]: metade verde, metade oliva. */
  broadleaf: Object.freeze(
    TREE_RADII.map((rad) => variants(8, (i) => makeBroadleaf(rad, 20000 + rad * 100 + i, i % 2 ? OLIVE : CANOPY))),
  ),
  conifer: Object.freeze(CONIFER_HEIGHTS.map((h) => variants(5, (i) => makeTallConifer(h, 21000 + h * 100 + i, false)))),
  coniferSnow: Object.freeze(CONIFER_HEIGHTS.map((h) => variants(5, (i) => makeTallConifer(h, 22000 + h * 100 + i, true)))),
  house: Object.freeze(HOUSE_WIDTHS.map((w) => variants(6, (i) => makeHouse(w, 25000 + w * 100 + i)))),
});

/** Índice da maior classe que não passa de `target` (ou a menor). */
export function sizeClass(sizes: readonly number[], target: number): number {
  let k = 0;
  while (k + 1 < sizes.length && sizes[k + 1]! <= target) k++;
  return k;
}

/** Maior distância de um pixel de carimbo até a âncora (margem do ladrilho). */
export const SPRITE_MARGIN = 112;
