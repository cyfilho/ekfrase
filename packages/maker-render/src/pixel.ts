// SPDX-License-Identifier: MPL-2.0

/**
 * Estilo pixel `org.ekfrase.style.pixel` (§9), versão 1.2: detalhe por zoom como num globo virtual
 * (DEC-058). Regra de ouro: **tudo no tamanho real**. O que no zoom atual fica menor que um pixel
 * não é desenhado como objeto: vira a cor média daquele pedaço de chão (como as imagens de satélite
 * vistas de longe). Assim:
 *
 * - Floresta de longe é uma massa de copas (tufos iluminados, clareiras, sombra na borda), nunca
 *   árvores-símbolo do tamanho de quilômetros. Mais perto, as copas aparecem uma a uma, coladas
 *   (sem tronco). De perto, as **mesmas** copas viram árvores desenhadas (mesma rede de posições).
 * - Montanhas são relevo sombreado, rocha e neve em qualquer zoom (sem símbolo de pico).
 * - Vilas: de longe, uma mancha; depois, telhados; de perto, casas desenhadas — também as mesmas.
 * - Praia, espuma e ondas são definidas em metros (altitude e profundidade), não em pixels.
 * - Texturas são ruído ancorado no mundo em metros; só entram as oitavas com pelo menos ~1,6 pixel
 *   (o resto vale a média), então a textura não "encolhe" com o zoom nem vira chuvisco.
 *
 * O mundo é amostrado a cada 2 pixels de arte e interpolado; texturas, copas e casas são calculadas
 * pixel a pixel. Tudo vem das coordenadas do mundo e do índice global do pixel: ladrilhos vizinhos se
 * encaixam sem emenda. Estilo é visual (porta aberta 5): pode evoluir sem afetar mapas salvos.
 */

import type { BiomeId, WorldSampler } from '@ekfrase/maker-gen';
import {
  BLOOMS,
  CANOPY,
  CONIFER,
  FOAM,
  FOREST_FLOOR,
  GRASS,
  LAGOON,
  OLIVE,
  PUDDLE,
  ROCK,
  ROOF_SLATE,
  ROOF_TERRACOTTA,
  ROOF_THATCH,
  SAND,
  SNOW,
  STREET,
  SWAMP,
  TOWN_FAR,
  TUNDRA,
  WATER,
  WET_SAND,
  blend,
  rampAt,
  shade,
  type Ramp,
} from './color';
import type { BoxLookup, EditIndex } from './edits';
import { gradPx, hashPx, smoothPx } from './noise';
import { renderMapTile } from './mapa';
import { CONIFER_HEIGHTS, DETAIL, HOUSE_WIDTHS, SPRITES, TREE_RADII, sizeClass, type Sprite } from './sprites';
import { TILE_SIZE, metersPerPixel, sampleLevelFor } from './tiles';


export interface TileInput {
  readonly sampler: WorldSampler;
  readonly s0M: number;
  readonly edits: EditIndex | null;
  readonly z: number;
  readonly tx: number;
  readonly ty: number;
  readonly size?: number;
  /** Satélite (padrão: como um globo virtual) ou Mapa (mapa ilustrado, tinta e aquarela). */
  readonly style?: TileStyle;
}

export type TileStyle = 'satellite' | 'map';
/** Identificadores dos estilos (§9). Visual, não dado: não vão para o arquivo do mapa. */
export const STYLE_IDS: Readonly<Record<TileStyle, string>> = {
  satellite: 'org.ekfrase.style.satellite@1.2.0',
  map: 'org.ekfrase.style.map@2.0.0',
};
export const STYLE_ID = STYLE_IDS.satellite;

const B_OCEAN = 0;
const B_TUNDRA = 1;
const B_DESERT = 2;
const B_PLAIN = 3;
const B_FOREST = 4;
const B_SWAMP = 5;
const BIOME_CODE: Readonly<Record<BiomeId, number>> = {
  ocean: B_OCEAN,
  tundra: B_TUNDRA,
  desert: B_DESERT,
  plain: B_PLAIN,
  forest: B_FOREST,
  swamp: B_SWAMP,
};

/** Margem da grade calculada em volta do ladrilho (relevo, sombra da borda da mata, copas vizinhas). */
const GM = 10;
/** Raio médio da copa (m): folhosa e conífera. Rede de copas: uma por célula de CROWN_CELL m. */
const BROAD_R = 4.2;
const CONIFER_R = 2.7;
const CROWN_CELL = 5.6;
/** Lotes das vilas (m) e altura média das árvores (sombra da borda da mata, m). */
const LOT = 15;
const TREE_H = 14;
/** Faixas de detalhe pelo raio da copa em pixels: textura < 1 ≤ copas por pixel < 3 ≤ árvores desenhadas. */
const CROWN_PX = 1;
const SPRITE_PX = 3;
/** Casas: telhados por pixel a partir de 1,2 px de largura; casa desenhada a partir de 7 px. */
const ROOF_PX = 1.2;
const HOUSE_PX = 7;
/** Luz do noroeste (para copas e telhados). */
const LX = -0.55;
const LY = -0.62;
const LZ = 0.56;

/** Rotações fixas (cos, sen) das oitavas das cristas. */
const ROT: readonly number[] = [1, 0, 0.8, 0.6, -0.28, 0.96, 0.6, -0.8, -0.96, -0.28];

const ROOFS: readonly Ramp[] = [ROOF_TERRACOTTA, ROOF_SLATE, ROOF_THATCH, ROOF_TERRACOTTA];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Ruído fractal ancorado no mundo (coordenadas em metros). Oitavas de comprimento `wl0`, `wl0·0,4`…;
 * as que ficam menores que `minWl` (abaixo do pixel) entram com a média, sem chuvisco.
 */
function fbm(x: number, y: number, wl0: number, octaves: number, minWl: number, salt: number): number {
  let sum = 0;
  let wsum = 0;
  let w = 1;
  let wl = wl0;
  for (let k = 0; k < octaves; k++) {
    sum += w * (wl >= minWl ? smoothPx(x, y, wl, salt + k) : 0.5);
    wsum += w;
    w *= 0.55;
    wl *= 0.4;
  }
  return sum / wsum;
}

/** Quanto uma oitava de ruído (vista como relevo) está voltada para a luz do noroeste: −1 a 1. */
function facing(x: number, y: number, wl: number, salt: number): number {
  const d = wl * 0.2;
  return (smoothPx(x + d, y + d, wl, salt) - smoothPx(x - d, y - d, wl, salt)) * 2;
}

interface Node {
  readonly e: number;
  readonly tmp: number;
  readonly moist: number;
  readonly b: number;
  readonly rugged: number;
  /** Árvores pintadas: 0 nenhuma, 1 folhosas, 2 coníferas. */
  readonly trees: number;
  readonly building: number;
}

/** Dados de um pixel de arte (interpolados dos nós + detalhe do relevo). */
interface Px {
  e: number;
  tmp: number;
  moist: number;
  b: number;
  trees: number;
  building: number;
  water: boolean;
}

interface Crown {
  /** Centro em pixels globais (fracionário) e raio em pixels. */
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly conifer: boolean;
  readonly snowy: boolean;
  readonly pal: number;
  readonly tone: number;
  readonly lift: number;
  readonly variant: number;
}

interface Lot {
  readonly x: number;
  readonly y: number;
  /** Meia largura e meia profundidade em pixels. */
  readonly hw: number;
  readonly hd: number;
  readonly roof: Ramp;
  readonly variant: number;
}

interface Stamp {
  readonly sprite: Sprite;
  readonly x: number;
  readonly y: number;
}

/** Desenha o ladrilho (z, tx, ty) e devolve RGBA (size × size × 4). */
export function renderTile(input: TileInput): Uint8ClampedArray {
  // A visão Mapa é outro desenho, inteiro (mapa.ts, DEC-062): daqui para baixo é só a Satélite.
  if (input.style === 'map') return renderMapTile(input);
  const S = input.size ?? TILE_SIZE;
  const G = S + 2 * GM;
  const m = metersPerPixel(input.z);
  const level = sampleLevelFor(input.z + 1, input.s0M); // o mundo é amostrado a cada 2 pixels
  const gx0 = input.tx * S - GM; // índice global do pixel (0, 0) da grade
  const gy0 = input.ty * S - GM;
  const minWl = 1.6 * m;
  const crownPx = BROAD_R / m;
  const housePx = 10 / m;

  // Margem dos carimbos: o maior desenho que pode vazar para dentro do ladrilho neste zoom.
  const treeMax = crownPx >= SPRITE_PX ? Math.min(TREE_RADII[TREE_RADII.length - 1]!, crownPx * 1.25) * 2.6 + 8 : 0;
  const houseMax = housePx >= HOUSE_PX ? Math.min(42, housePx * 1.2) + 6 : 0;
  const SM = Math.ceil(Math.max(12, treeMax, houseMax, m <= 0.6 ? 14 : 0));
  const BM = Math.max(SM, GM) + 24;
  const box: BoxLookup | null = input.edits
    ? input.edits.forBox((input.tx * S - BM) * m, (input.ty * S - BM) * m, ((input.tx + 1) * S + BM) * m, ((input.ty + 1) * S + BM) * m, level)
    : null;

  // ---------- amostragem do mundo: nós a cada 2 pixels, globais ----------
  const nodes = new Map<number, Node>();
  function node(ci: number, cj: number): Node {
    const key = ci * 67108864 + cj;
    const hit = nodes.get(key);
    if (hit) return hit;
    const p = { x: (2 * ci + 1) * m, y: (2 * cj + 1) * m };
    const s = input.sampler.sample(p, level);
    let b = BIOME_CODE[s.biome];
    let e = s.elevationM;
    let rugged = 0;
    if (box?.relief) {
      const rv = box.relief(p);
      if (rv.h > 0) {
        e += rv.h;
        rugged = rv.rugged;
        if (b === B_OCEAN && e > 2) b = s.temperatureC < -2 ? B_TUNDRA : B_PLAIN; // montanha no mar = ilha
      }
    }
    let trees = 0;
    let building = 0;
    if (box?.paint) {
      const painted = box.paint(p);
      if (painted?.biome) {
        b = BIOME_CODE[painted.biome];
        // Pintar terra no mar ergue o chão; pintar água na terra abre um lago.
        e = b === B_OCEAN ? Math.min(e, -25) : Math.max(e, 3);
      }
      if (painted?.trees) trees = painted.trees === 'conifer' ? 2 : 1;
      if (painted?.building) building = 1;
    }
    e = b === B_OCEAN ? Math.min(e, -0.5) : Math.max(e, 0.5);
    const n: Node = { e, tmp: s.temperatureC, moist: s.moisture, b, rugged, trees, building };
    nodes.set(key, n);
    return n;
  }

  /**
   * Cristas e ravinas ancoradas no mundo (fractal de cristas multiplicativo: cada oitava só aparece
   * onde a anterior já é crista, o que dá serras ramificadas como uma rede de drenagem). Só as oitavas
   * com ≥ 5 pixels; as menores entram com a média (sem reamplificar o que sobra de longe).
   */
  function ridged(x: number, y: number): number {
    // deformação lenta do domínio: serras curvas, não paralelas
    const wx = x + (gradPx(x, y, 26000, 0x8e) - 0.5) * 14000;
    const wy = y + (gradPx(x, y, 26000, 0x8f) - 0.5) * 14000;
    let sum = 0;
    let max = 0;
    let weight = 1;
    let amp = 1;
    let wl = 12000;
    for (let k = 0; k < 11; k++) {
      if (wl >= 5 * m) {
        // cada oitava girada (ângulo fixo): as cristas não se alinham numa grade
        const c = ROT[2 * (k % 5)]!;
        const sn = ROT[2 * (k % 5) + 1]!;
        const nv = gradPx(wx * c - wy * sn, wx * sn + wy * c, wl, 0x90 + k);
        let sig = 1 - Math.abs(2 * nv - 1);
        sig *= sig * weight;
        weight = clamp(0.45 + sig * 1.8, 0, 1);
        sum += sig * amp;
      } else {
        sum += 0.3 * weight * amp;
      }
      max += amp;
      amp *= 0.52;
      wl *= 0.45;
    }
    return clamp(sum / max / 0.6, 0, 1);
  }

  /** Dados do pixel global (gx, gy): interpolação dos 4 nós vizinhos + cristas. Função pura do pixel. */
  function fill(gx: number, gy: number, out: Px): void {
    const u = (gx - 0.5) / 2;
    const v = (gy - 0.5) / 2;
    const ci = Math.floor(u);
    const cj = Math.floor(v);
    const fx = u - ci;
    const fy = v - cj;
    const a = node(ci, cj);
    const b = node(ci + 1, cj);
    const c = node(ci, cj + 1);
    const d = node(ci + 1, cj + 1);
    const wa = (1 - fx) * (1 - fy);
    const wb = fx * (1 - fy);
    const wc = (1 - fx) * fy;
    const wd = fx * fy;
    let e = a.e * wa + b.e * wb + c.e * wc + d.e * wd;
    out.tmp = a.tmp * wa + b.tmp * wb + c.tmp * wc + d.tmp * wd;
    out.moist = a.moist * wa + b.moist * wb + c.moist * wc + d.moist * wd;
    out.water = e < 0;
    if (out.water) {
      out.b = B_OCEAN;
      out.trees = 0;
      out.building = 0;
      out.e = e;
      return;
    }
    // Bioma do nó de terra dominante; onde os nós discordam, a fronteira é ondulada por ruído.
    const list = [a, b, c, d];
    const ws = [wa, wb, wc, wd];
    let best = -1;
    let bestS = -1e9;
    const mixed = a.b !== b.b || a.b !== c.b || a.b !== d.b || a.trees !== d.trees || a.building !== d.building;
    for (let i = 0; i < 4; i++) {
      const n = list[i]!;
      if (n.b === B_OCEAN) continue;
      // fronteira orgânica: ruído em duas escalas desloca a divisa (sem degraus de 2 pixels)
      const s = ws[i]! + (mixed ? 0.95 * (smoothPx(gx, gy, 3.5, 0x31 + i) - 0.5) + 0.45 * (smoothPx(gx, gy, 1.3, 0x35 + i) - 0.5) : 0);
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
    const dom = list[best < 0 ? 0 : best]!;
    out.b = dom.b === B_OCEAN ? B_PLAIN : dom.b;
    out.trees = dom.trees;
    out.building = dom.building;
    const rugged = a.rugged * wa + b.rugged * wb + c.rugged * wc + d.rugged * wd;
    const amp = clamp((e - 700) / 1600, 0, 1) * 900 + rugged;
    if (amp > 1) e = Math.max(1, e + amp * (ridged((gx + 0.5) * m, (gy + 0.5) * m) - 0.5));
    out.e = e;
  }

  // ---------- grade do ladrilho (com margem) ----------
  const n = G * G;
  const elev = new Float32Array(n);
  const temp = new Float32Array(n);
  const moist = new Float32Array(n);
  const biome = new Uint8Array(n);
  const water = new Uint8Array(n);
  const trees = new Uint8Array(n);
  const building = new Uint8Array(n);
  const px: Px = { e: 0, tmp: 0, moist: 0, b: 0, trees: 0, building: 0, water: false };
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      fill(gx0 + i, gy0 + j, px);
      const k = j * G + i;
      elev[k] = px.e;
      temp[k] = px.tmp;
      moist[k] = px.moist;
      biome[k] = px.b;
      water[k] = px.water ? 1 : 0;
      trees[k] = px.trees;
      building[k] = px.building;
    }
  }

  const memo = new Map<number, Px>();
  /** Dados do pixel global: da grade, se estiver nela (mesmos números); senão calcula. */
  function infoAt(gx: number, gy: number): Px {
    const li = gx - gx0;
    const lj = gy - gy0;
    if (li >= 0 && lj >= 0 && li < G && lj < G) {
      const k = lj * G + li;
      return { e: elev[k]!, tmp: temp[k]!, moist: moist[k]!, b: biome[k]!, trees: trees[k]!, building: building[k]!, water: water[k] === 1 };
    }
    const key = gx * 67108864 + gy;
    const hit = memo.get(key);
    if (hit) return hit;
    const out: Px = { e: 0, tmp: 0, moist: 0, b: 0, trees: 0, building: 0, water: false };
    fill(gx, gy, out);
    memo.set(key, out);
    return out;
  }

  // ---------- cobertura de copas (0–1), igual em todos os zooms ----------
  /** Cobertura esperada do talhão: bioma, árvores pintadas, clareiras e limite das árvores na altitude. */
  function standCover(xm: number, ym: number, f: Px): number {
    if (f.water || f.building) return f.building ? 0.06 : 0;
    let c: number;
    if (f.trees) c = 0.95;
    else if (f.b === B_FOREST) c = 0.93 * clamp((fbm(xm, ym, 2600, 3, minWl, 0x40) - 0.24) / 0.1, 0.3, 1);
    else if (f.b === B_SWAMP) c = 0.3;
    else if (f.b === B_PLAIN) c = 0.07;
    else if (f.b === B_TUNDRA) c = f.tmp > -8 ? 0.06 : 0;
    else c = f.tmp > 16 ? 0.004 : 0;
    const line = f.trees ? 2600 : 2050;
    return c * clamp((line - f.e) / 700, 0, 1) * clamp((f.e - 1.5) / 2, 0, 1); // nada na praia
  }
  /** Densidade local: cobertura do talhão com bosques e clareiras (ruído fixo em metros). */
  const density = (xm: number, ym: number, cover: number, cut: number): number =>
    cover <= 0 ? 0 : clamp(cover + (fbm(xm, ym, 240, 3, cut, 0x44) - 0.5) * (0.5 + 1.4 * cover), 0, 1);
  const coniferShare = (f: Px): number => {
    if (f.trees) return f.trees === 2 ? 1 : 0;
    if (f.b === B_TUNDRA) return 1;
    return clamp((11 - f.tmp) / 8, 0, 1) * (f.b === B_SWAMP ? 0.4 : 1) + (f.e > 1300 ? clamp((f.e - 1300) / 500, 0, 1) : 0);
  };

  // ---------- rede de copas (faixas B e C): as mesmas árvores em todos os zooms ----------
  function crownAt(i: number, j: number): Crown | null {
    const xm = (i + hashPx(i, j, 0xc1)) * CROWN_CELL;
    const ym = (j + hashPx(i, j, 0xc2)) * CROWN_CELL;
    const f = infoAt(Math.floor(xm / m), Math.floor(ym / m));
    const cover = standCover(xm, ym, f);
    if (cover <= 0 || hashPx(i, j, 0xc3) >= density(xm, ym, cover, 0)) return null;
    const conifer = hashPx(i, j, 0xc4) < coniferShare(f);
    const r = (conifer ? CONIFER_R : BROAD_R) * (0.75 + 0.5 * hashPx(i, j, 0xc5));
    return {
      x: xm / m,
      y: ym / m,
      r: r / m,
      conifer,
      snowy: f.tmp < -1,
      pal: hashPx(i, j, 0xc6) < 0.45 + 0.4 * (smoothPx(xm, ym, 9000, 0x4a) - 0.5) ? 1 : 0,
      tone: (hashPx(i, j, 0xc7) - 0.5) * 1.3,
      lift: hashPx(i, j, 0xc8) * 0.25,
      variant: hashPx(i, j, 0xc9),
    };
  }
  /** Copas da região [x0, x1] × [y0, y1] (pixels globais) em uma grade direta. */
  function crownGrid(x0: number, y0: number, x1: number, y1: number) {
    const C = CROWN_CELL / m;
    const i0 = Math.floor(x0 / C) - 2;
    const j0 = Math.floor(y0 / C) - 2;
    const ni = Math.floor(x1 / C) + 2 - i0 + 1;
    const nj = Math.floor(y1 / C) + 2 - j0 + 1;
    const cells: (Crown | null)[] = new Array(ni * nj);
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) cells[j * ni + i] = crownAt(i0 + i, j0 + j);
    return { C, i0, j0, ni, nj, cells };
  }

  // ---------- lotes das vilas ----------
  function lotAt(i: number, j: number): Lot | null {
    const xm = (i + 0.3 + 0.4 * hashPx(i, j, 0xd1)) * LOT;
    const ym = (j + 0.3 + 0.4 * hashPx(i, j, 0xd2)) * LOT;
    const f = infoAt(Math.floor(xm / m), Math.floor(ym / m));
    if (!f.building || f.water || f.e < 1.5 || hashPx(i, j, 0xd3) > 0.8) return null;
    const h = hashPx(i, j, 0xd4);
    return {
      x: xm / m,
      y: ym / m,
      hw: (4 + 2 * h) / m,
      hd: (3 + 1.5 * hashPx(i, j, 0xd5)) / m,
      roof: ROOFS[Math.floor(hashPx(i, j, 0xd6) * ROOFS.length)]!,
      variant: hashPx(i, j, 0xd7),
    };
  }

  /**
   * Tom da massa de copas no ponto (m): tufos iluminados em várias escalas (só as que cabem no pixel)
   * e manchas grandes de idade e espécie. Usado de longe (textura) e por copa (faixa B), para os
   * dois zooms terem o mesmo "relevo" de copas.
   */
  function clumps(xm: number, ym: number): number {
    let t = (fbm(xm, ym, 6000, 4, minWl, 0x4d) - 0.5) * 2.4;
    for (const [wl, amp, salt] of [[110, 1.5, 0x47], [42, 1.6, 0x48], [15, 1.7, 0x49]] as const) {
      if (wl >= 3 * m) t += facing(xm, ym, wl, salt) * amp + (smoothPx(xm, ym, wl, salt) - 0.5) * amp * 0.9;
    }
    return t;
  }

  // ---------- cor do chão ----------
  const K = 3 + Math.pow(m, 0.6) * 0.35; // exagero vertical cresce com o zoom-out, para o relevo continental aparecer
  const grain = (gx: number, gy: number) => (hashPx(gx, gy, 0x52) - 0.5) * 0.3;

  /** Água; `off` = distância até a costa (m). */
  function waterColor(k: number, gx: number, gy: number, xm: number, ym: number, off: number): number {
    const depth = Math.max(0, -elev[k]!);
    let t = 7 - depth / 650 + (fbm(xm, ym, 9000, 3, minWl, 0x60) - 0.5) * 1.1;
    if (45 >= 2 * m) {
      const c = smoothPx(xm, ym * 2.6, 45, 0x61);
      t += c > 0.7 ? (c - 0.7) * 5 : c < 0.25 ? -0.4 : 0;
    }
    if (11 >= 2 * m) t += (smoothPx(xm, ym * 2.8, 11, 0x62) - 0.5) * 0.8;
    let col = rampAt(WATER, t + grain(gx, gy) * 0.6);
    if (depth < 70) {
      const sh = clamp((70 - depth) / 70, 0, 1);
      col = blend(col, rampAt(LAGOON, 1.2 + sh * 3 + (smoothPx(xm, ym, 30, 0x64) - 0.5) * 0.8), sh * sh * 0.92);
    }
    // Arrebentação: linhas de espuma paralelas à praia, numa faixa de ~16 m (larguras reais).
    if (off < 16) {
      const amt = clamp((16 - off) / 16, 0, 1);
      if (m <= 3) {
        const phase = off / 4.2 + fbm(xm, ym, 14, 2, minWl, 0x65) * 1.8;
        const line = phase - Math.floor(phase) < 0.3 ? 1 : 0.12;
        col = blend(col, FOAM, clamp(amt * line + (off < 1.2 ? 0.85 : 0), 0, 0.92));
      } else {
        col = blend(col, FOAM, amt * clamp(5 / m, 0, 0.6)); // espuma menor que o pixel: só clareia
      }
    }
    return col;
  }

  /** Chão; `dist` = distância até a água (m). */
  function groundColor(k: number, gx: number, gy: number, xm: number, ym: number, light: number, steep: number, dist: number): number {
    const b = biome[k]!;
    const e = elev[k]!;
    const tmp = temp[k]!;
    const gr = grain(gx, gy);
    const nBig = fbm(xm, ym, 2400, 3, minWl, 0x53);
    const nMid = fbm(xm, ym, 120, 3, minWl, 0x56);
    const nFine = fbm(xm, ym, 6, 3, minWl, 0x59);
    const tex = (nBig - 0.5) * 2 + (nMid - 0.5) * 1.8 + (nFine - 0.5) * 1.6;
    let col: number;
    if (b === B_DESERT) {
      // Dunas em metros: cristas alongadas com sota-vento na sombra; ondulações de areia de perto.
      let t = 4.6 + light * 2.2 + (nBig - 0.5) * 1.4 + gr;
      if (420 >= 1.8 * m) {
        const dn = smoothPx(xm * 0.55 + nMid * 200, ym * 1.3, 420, 0x66);
        const crest = 1 - Math.abs(2 * dn - 1);
        t += (crest - 0.5) * 1.2 + facing(xm * 0.55 + nMid * 200, ym * 1.3, 420, 0x66) * 2.2 * (1 - crest * 0.4);
      }
      if (2.5 >= 1.8 * m) t += Math.sin((xm * 0.5 + ym * 1.9 + nFine * 6) * 2.4) * 0.45;
      col = rampAt(SAND, t);
    } else if (b === B_SWAMP) {
      const t = 3.4 + light * 2 + tex * 0.9 + gr;
      col = rampAt(SWAMP, t);
      const pn = fbm(xm, ym, 80, 3, minWl, 0x5c);
      const pf = clamp((pn - 0.58) / 0.08, 0, 1) * clamp((moist[k]! - 0.5) * 4, 0, 1);
      if (pf > 0) col = blend(col, rampAt(PUDDLE, 1 + (pn - 0.58) * 20 + gr), pf);
    } else if (b === B_TUNDRA) {
      const ramp = tmp < -6 ? SNOW : TUNDRA;
      col = rampAt(ramp, 3.6 + light * 2.4 + tex + gr + (ramp === SNOW ? 1.6 : 0));
      if (tmp < -2 && ramp !== SNOW) {
        const sn = clamp((fbm(xm, ym, 300, 3, minWl, 0x5e) - 0.6) / 0.06, 0, 1);
        if (sn > 0) col = blend(col, rampAt(SNOW, 5.5 + light * 1.5), sn);
      }
    } else {
      const forest = b === B_FOREST;
      // Grama: tom do campo varia em várias escalas; seca puxa para o palha; perto, lâminas de capim.
      let t = (forest ? 3 : 3.6) + light * 2.4 + tex + gr + Math.min(e / 6000, 0.35);
      if (m <= 0.3) {
        if (hashPx(gx, gy, 0x58) < 0.16) t += 1.1;
        else if (hashPx(gx, gy - 1, 0x58) < 0.16) t -= 0.9;
      }
      col = rampAt(forest ? FOREST_FLOOR : GRASS, t);
      // Sob as copas que se veem uma a uma, o chão da mata é capim sombreado (a escuridão vem das sombras).
      if (forest && crownPx >= CROWN_PX) col = blend(col, rampAt(GRASS, t - 0.6), 0.45);
      if (!forest) {
        const dry = clamp((0.5 - moist[k]!) * 1.6 + (nBig - 0.5) * 0.6, 0, 0.5);
        if (dry > 0) col = blend(col, rampAt(SAND, t + 0.4), dry);
        if (m <= 0.5 && hashPx(gx, gy, 0x51) > 0.9975) return BLOOMS[Math.floor(hashPx(gx, gy, 0x57) * BLOOMS.length)]!;
      }
    }
    // Rocha nas alturas e encostas íngremes; neve no alto e no frio (misturas suaves, sem chuvisco).
    const rockN = fbm(xm, ym, 420, 4, minWl, 0x5d);
    const rocky = (e - 1900) / 500 + (steep > 0.45 && e > 300 ? (steep - 0.45) * 1.8 : 0) + (rockN - 0.5) * 1.1;
    if (rocky > 0) {
      let t = 3.7 + light * 2.8 + tex * 0.8 + gr;
      if (40 >= 1.8 * m) t += smoothPx(xm * 3, ym, 40, 0x5a) > 0.74 ? -1 : 0; // estratos
      if (m <= 0.5) {
        if (hashPx(gx, gy, 0x59) < 0.1) t += 1.6;
        else if (hashPx(gx, gy - 1, 0x59) < 0.1) t -= 1.2;
      }
      col = blend(col, rampAt(ROCK, t), clamp(rocky * 2.2, 0, 1));
    }
    const snowBase = Math.max((e - 2550) / 260, e > 1300 && tmp < -4 ? (e - 1300) / 200 : -9);
    const snow = snowBase > -1.5 ? (snowBase + (rockN - 0.5) * 1.2) * clamp((3.2 - steep) / 1.2, 0, 1) : 0;
    if (snow > 0) col = blend(col, rampAt(SNOW, 5.4 + light * 1.9 + (nMid - 0.5) * 0.8), clamp(snow * 1.6, 0, 1));
    // Praia: faixa de ~18 m a partir da água (largura real; de longe some, como no satélite).
    if (dist < 40 && b !== B_SWAMP && steep < 1.5) {
      const width = 18 + (fbm(xm, ym, 60, 2, minWl, 0x67) - 0.5) * 18;
      const beach = clamp((width - dist) / Math.max(m, 3), 0, 1);
      if (beach > 0) col = blend(col, dist < 2.5 ? WET_SAND : rampAt(SAND, 5.4 + light * 1.2 + gr + (nFine - 0.5)), beach);
    }
    return col;
  }



  // ---------- 1. chão, água e cobertura por pixel ----------
  const rho = new Float32Array(n); // fração de copas por pixel (faixa A) — para a sombra da borda da mata
  const coverG = new Float32Array(n);
  const conShare = new Float32Array(n);
  const bandA = crownPx < CROWN_PX;
  const cut = Math.max(minWl, 0);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      const k = j * G + i;
      if (water[k]) continue;
      const xm = (gx0 + i + 0.5) * m;
      const ym = (gy0 + j + 0.5) * m;
      const f = infoAt(gx0 + i, gy0 + j);
      const c = standCover(xm, ym, f);
      coverG[k] = c;
      conShare[k] = coniferShare(f);
      if (bandA) rho[k] = density(xm, ym, c, cut);
    }
  }

  const rgb = new Int32Array(S * S);
  const shadowLen = (TREE_H * 0.7) / m;
  const crowns = !bandA ? crownGrid(gx0, gy0, gx0 + G, gy0 + G) : null;
  /** De perto, sob as árvores desenhadas, as copas por pixel viram sub-bosque (maiores e na sombra). */
  const under = crownPx >= SPRITE_PX;
  const grow = 1.45;
  const maxSpriteR = TREE_RADII[TREE_RADII.length - 1]! / 1.15;
  const roofs = housePx >= ROOF_PX && housePx < HOUSE_PX;
  const lotI0 = Math.floor((gx0 * m) / LOT) - 1;
  const lotJ0 = Math.floor((gy0 * m) / LOT) - 1;
  const lotN = Math.floor(((gx0 + G) * m) / LOT) + 1 - lotI0 + 1;
  const lotM = Math.floor(((gy0 + G) * m) / LOT) + 1 - lotJ0 + 1;
  let lots: (Lot | null)[] | null = null;
  const lotGrid = (): (Lot | null)[] => {
    if (lots) return lots;
    lots = new Array(lotN * lotM);
    for (let j = 0; j < lotM; j++) for (let i = 0; i < lotN; i++) lots[j * lotN + i] = lotAt(lotI0 + i, lotJ0 + j);
    return lots;
  };
  const townFade = clamp((170 - m) / 110, 0, 1);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = (y + GM) * G + x + GM;
      const gx = gx0 + x + GM;
      const gy = gy0 + y + GM;
      const xm = (gx + 0.5) * m;
      const ym = (gy + 0.5) * m;
      // Gradiente suavizado (Sobel): relevo sem a grade da amostragem; dá também a distância à costa.
      const dzdx =
        (2 * (elev[k + 1]! - elev[k - 1]!) + elev[k - G + 1]! - elev[k - G - 1]! + elev[k + G + 1]! - elev[k + G - 1]!) / (8 * m);
      const dzdy =
        (2 * (elev[k + G]! - elev[k - G]!) + elev[k + G - 1]! - elev[k - G - 1]! + elev[k + G + 1]! - elev[k - G + 1]!) / (8 * m);
      const steep = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      // Distância (m, com sinal: + terra) até a linha d'água, pela altitude e a inclinação.
      const sd = elev[k]! / Math.max(steep, 1e-4);
      // Litoral sem degraus: o pixel cortado pela linha d'água mistura mar e terra pela área de cada um.
      const land = clamp(0.5 + sd / m, 0, 1);
      const wcol = land < 1 ? waterColor(k, gx, gy, xm, ym, Math.max(0, -sd)) : 0;
      if (land <= 0) {
        rgb[y * S + x] = wcol;
        continue;
      }
      // Relevo sombreado: encosta voltada para o noroeste clareia.
      const light = clamp((dzdx + dzdy) * 0.707 * K, -1.3, 1.3);
      let col = groundColor(k, gx, gy, xm, ym, light, steep, Math.max(0, sd));

      // Vila: ruas de terra batida; de longe, uma mancha; de meio perto, telhados um a um.
      if (building[k]) {
        if (housePx < ROOF_PX) {
          col = blend(col, TOWN_FAR, 0.55 * townFade);
        } else {
          col = blend(col, rampAt(STREET, 1.6 + light * 1.4 + (fbm(xm, ym, 4, 2, minWl, 0x68) - 0.5) * 1.6), 0.75);
        }
      }

      if (bandA) {
        // Faixa A: massa de copas. Tufos iluminados (ruído em metros) misturados ao chão sombreado.
        const r = rho[k]!;
        if (r > 0.003) {
          const t = 3.5 + light * 1.8 + grain(gx, gy) * 0.8 + clumps(xm, ym);
          const hue = clamp(0.5 + (smoothPx(xm, ym, 9000, 0x4a) - 0.5) * 1.4 + (fbm(xm, ym, 700, 2, minWl, 0x4b) - 0.5), 0, 1);
          const broad = blend(rampAt(CANOPY, t), rampAt(OLIVE, t - 0.3), hue * 0.6);
          const canopy = blend(broad, rampAt(CONIFER, t - 0.4), conShare[k]!);
          // Copas quase do tamanho do pixel: árvores esparsas viram pontinhos escuros (como no satélite).
          const speck = clamp((crownPx - 0.3) / 0.4, 0, 1);
          const frac = speck > 0 ? r + (clamp((r - hashPx(gx, gy, 0x4c)) * 5 + 0.5, 0, 1) - r) * speck : r;
          col = blend(shade(col, 1 - 0.3 * Math.min(1, r * 1.5)), canopy, frac);
        }
        // Sombra da mata sobre o campo vizinho (a sudeste da borda), com o comprimento real.
        if (r < 0.95 && shadowLen > 0.15) {
          let sh = 0;
          const L = Math.min(GM - 1, Math.ceil(shadowLen));
          for (let s = 1; s <= L; s++) {
            const w = Math.min(1, shadowLen - (s - 1));
            sh = Math.max(sh, rho[k - s * G - s]! * w);
          }
          if (sh > 0) col = shade(col, 1 - 0.45 * sh * (1 - r));
        }
      } else if (crowns) {
        // Faixa B: copas uma a uma, por pixel, com volume e sombra projetada.
        const pxx = gx + 0.5;
        const pyy = gy + 0.5;
        const ci = Math.floor(pxx / crowns.C) - crowns.i0;
        const cj = Math.floor(pyy / crowns.C) - crowns.j0;
        let top: Crown | null = null;
        let topH = -1;
        let shadowed = false;
        for (let dj = -2; dj <= 1; dj++) {
          for (let di = -2; di <= 1; di++) {
            const cr = crowns.cells[(cj + dj) * crowns.ni + ci + di];
            if (!cr) continue;
            const dx = pxx - cr.x;
            const dy = pyy - cr.y;
            const rr = under ? Math.min(cr.r, maxSpriteR) * grow : cr.r;
            const r2 = rr * rr;
            const d2 = dx * dx + dy * dy;
            if (d2 < r2) {
              const h = 1 - d2 / r2 + cr.lift;
              if (h > topH) {
                topH = h;
                top = cr;
              }
            } else if (!shadowed) {
              const sx = dx - rr * 0.6;
              const sy = dy - rr * 0.6;
              if (sx * sx + sy * sy < r2 * 0.9) shadowed = true;
            }
          }
        }
        if (top) {
          const rr = under ? Math.min(top.r, maxSpriteR) * grow : top.r;
          const nx = (pxx - top.x) / rr;
          const ny = (pyy - top.y) / rr;
          let lum: number;
          if (top.conifer) {
            const d = Math.sqrt(nx * nx + ny * ny) + 1e-6;
            lum = ((nx / d) * LX + (ny / d) * LY) * 0.75 * Math.min(1, d * 1.6) + LZ * 0.5;
          } else {
            lum = nx * LX + ny * LY + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * LZ;
          }
          const t = (top.conifer ? 3.1 : 3.4) + lum * 2.6 + top.tone + light * 1.2 + clumps(xm, ym) * 0.8 + grain(gx, gy) * (top.r >= 2 ? 1.4 : 0.6);
          col = top.conifer ? rampAt(CONIFER, t) : rampAt(top.pal ? OLIVE : CANOPY, t);
          if (under) col = shade(rampAt(top.conifer ? CONIFER : CANOPY, t - 0.6 + (fbm(xm, ym, 1.6, 3, minWl, 0x4e) - 0.5) * 3.2), 0.66);
        } else if (shadowed) {
          col = shade(col, 0.5);
        }
      }

      if (roofs && building[k]) {
        const L = lotGrid();
        const li = Math.floor(((gx + 0.5) * m) / LOT) - lotI0;
        const lj = Math.floor(((gy + 0.5) * m) / LOT) - lotJ0;
        let hit = false;
        let shadowed = false;
        for (let dj = -1; dj <= 1 && !hit; dj++) {
          for (let di = -1; di <= 1 && !hit; di++) {
            const lot = L[(lj + dj) * lotN + li + di];
            if (!lot) continue;
            const dx = gx + 0.5 - lot.x;
            const dy = gy + 0.5 - lot.y;
            if (Math.abs(dx) < lot.hw && Math.abs(dy) < lot.hd) {
              hit = true;
              // Telhado em duas águas: a metade virada para o norte recebe a luz.
              const edge = Math.abs(dx) > lot.hw - 0.9 || Math.abs(dy) > lot.hd - 0.9;
              const t = (dy < 0 ? 4.2 : 2.2) - (edge ? 1 : 0) + grain(gx, gy) + (lot.variant - 0.5);
              col = rampAt(lot.roof, t);
            } else {
              const sx = dx - 2.4 / m;
              const sy = dy - 2.4 / m;
              if (Math.abs(sx) < lot.hw && Math.abs(sy) < lot.hd) shadowed = true;
            }
          }
        }
        if (!hit && shadowed) col = shade(col, 0.6);
      }
      rgb[y * S + x] = land < 1 ? blend(wcol, col, land) : col;
    }
  }

  // ---------- 2. carimbos (faixa C): árvores, casas e miúdos no tamanho real ----------
  const stamps: Stamp[] = [];
  const left = input.tx * S - SM;
  const right = input.tx * S + S + SM;
  const top = input.ty * S - 6;
  const bottom = input.ty * S + S + SM;

  if (crownPx >= SPRITE_PX) {
    const g = crownGrid(left, top, right, bottom);
    for (const cr of g.cells) {
      if (!cr) continue;
      // a âncora é o pé do tronco: abaixo do centro da copa (a copa desenhada cai onde estava a vista de cima)
      const ay = Math.round(cr.y + (cr.conifer ? cr.r * 2.2 : cr.r * 1.3 + 1));
      if (cr.x < left || cr.x > right || ay < top || ay > bottom) continue;
      let sprite: Sprite;
      if (cr.conifer) {
        const list = (cr.snowy ? DETAIL.coniferSnow : DETAIL.conifer)[sizeClass(CONIFER_HEIGHTS, cr.r * 3.7)]!;
        sprite = list[Math.floor(cr.variant * list.length)]!;
      } else {
        const list = DETAIL.broadleaf[sizeClass(TREE_RADII, cr.r * 1.15)]!;
        sprite = list[Math.floor(cr.variant * list.length)]!;
      }
      stamps.push({ sprite, x: Math.round(cr.x), y: ay });
    }
  }

  if (housePx >= HOUSE_PX) {
    const i0 = Math.floor((left * m) / LOT) - 1;
    const i1 = Math.floor((right * m) / LOT) + 1;
    const j0 = Math.floor((top * m) / LOT) - 1;
    const j1 = Math.floor((bottom * m) / LOT) + 1;
    const cls = sizeClass(HOUSE_WIDTHS, housePx);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const lot = lotAt(i, j);
        if (!lot) continue;
        const list = DETAIL.house[cls]!;
        stamps.push({ sprite: list[Math.floor(lot.variant * list.length)]!, x: Math.round(lot.x), y: Math.round(lot.y + lot.hd) });
      }
    }
  }

  // Miúdos (tufos, arbustos, pedras, cactos, juncos): só quando o desenho tem o tamanho real.
  if (m <= 0.6) {
    const cell = 2.4; // m
    const i0 = Math.floor((left * m) / cell);
    const i1 = Math.floor((right * m) / cell);
    const j0 = Math.floor((top * m) / cell);
    const j1 = Math.floor((bottom * m) / cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const xm = (i + hashPx(i, j, 0xe1)) * cell;
        const ym = (j + hashPx(i, j, 0xe2)) * cell;
        const gx = Math.floor(xm / m);
        const gy = Math.floor(ym / m);
        const f = infoAt(gx, gy);
        if (f.water || f.e < 2.5 || f.building) continue;
        const h1 = hashPx(i, j, 0xe3);
        const v = (list: readonly Sprite[]): Sprite => list[Math.floor(hashPx(i, j, 0xe4) * list.length)]!;
        let sprite: Sprite | null = null;
        if (f.e > 1500) {
          if (h1 < 0.12) sprite = v(SPRITES.rock);
        } else if (f.b === B_PLAIN || f.b === B_FOREST) {
          if (m <= 0.2 && h1 < 0.45) sprite = v(SPRITES.tuft);
          else if (m <= 0.35 && h1 > 0.985 && f.b === B_PLAIN) sprite = v(SPRITES.bush);
        } else if (f.b === B_DESERT) {
          if (h1 < 0.05) sprite = v(SPRITES.rock);
          else if (f.tmp > 18 && h1 < 0.07) sprite = v(SPRITES.cactus);
        } else if (f.b === B_TUNDRA) {
          if (h1 < 0.1) sprite = v(SPRITES.rock);
        } else if (f.b === B_SWAMP) {
          if (m <= 0.3 && h1 < 0.4) sprite = v(SPRITES.reeds);
        }
        if (sprite) stamps.push({ sprite, x: gx, y: gy });
      }
    }
  }



  stamps.sort((a, b) => a.y - b.y || a.x - b.x);
  const ox = input.tx * S;
  const oy = input.ty * S;

  // Sombras primeiro (projetadas para sudeste), depois os carimbos de trás para a frente.
  for (const s of stamps) {
    if (!s.sprite.shadow) continue;
    const sp = s.sprite;
    for (let sy = 0; sy < sp.h; sy++) {
      for (let sx = 0; sx < sp.w; sx++) {
        if (sp.px[sy * sp.w + sx] === -1) continue;
        // achata a sombra: metade da altura, deslocada para sudeste
        const x = s.x - sp.ax + sx + 2 + ((sp.h - sy) >> 2) - ox;
        const y = s.y - ((sp.h - 1 - sy) >> 1) + 1 - oy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        rgb[y * S + x] = shade(rgb[y * S + x]!, 0.62);
      }
    }
  }
  for (const s of stamps) {
    const sp = s.sprite;
    for (let sy = 0; sy < sp.h; sy++) {
      for (let sx = 0; sx < sp.w; sx++) {
        const c = sp.px[sy * sp.w + sx]!;
        if (c === -1) continue;
        const x = s.x - sp.ax + sx - ox;
        const y = s.y - sp.ay + sy - oy;
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        rgb[y * S + x] = c;
      }
    }
  }

  const out = new Uint8ClampedArray(S * S * 4);
  for (let p = 0; p < S * S; p++) {
    const c = rgb[p]!;
    out[p * 4] = (c >> 16) & 255;
    out[p * 4 + 1] = (c >> 8) & 255;
    out[p * 4 + 2] = c & 255;
    out[p * 4 + 3] = 255;
  }
  return out;
}
