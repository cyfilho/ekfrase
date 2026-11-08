// SPDX-License-Identifier: MPL-2.0

/**
 * VISÃO MAPA (DEC-062): um desenho próprio, separado da Satélite (pixel.ts). Só os DADOS do mundo
 * são comuns (gerador e pinturas); cor, textura, relevo e símbolos são daqui.
 *
 * Como num mapa ilustrado de fantasia, pintado à mão:
 * - Chão em aquarela chapada por bioma e altitude, sobre papel (granulação e fibras presas à tela),
 *   pigmento acumulado nas bordas dos biomas e na costa, costa a tinta, ondas paralelas no mar.
 *   NÃO há relevo sombreado de satélite: o relevo é desenhado (montanhas, colinas, hachuras).
 * - Montanhas e colinas ficam PRESAS AO LUGAR NO MUNDO, com tamanho em metros: ao aproximar, a MESMA
 *   montanha cresce e ganha detalhe (ravinas, estratos, neve); montanhas menores só aparecem fora da
 *   área das maiores. Quando a montanha passa do tamanho da tela, vira o próprio terreno, desenhado
 *   com hachuras a pena na direção da encosta.
 * - Matas são sempre um MACIÇO de arvorezinhas desenhadas, que preenche a área da mata em qualquer
 *   zoom (de longe, árvores pequenas e muitas; de perto, maiores).
 */

import type { BiomeId } from '@ekfrase/maker-gen';
import type { Sprite } from './canvas';
import {
  INK,
  INK_SOFT,
  PAPER,
  PAPER_LIGHT,
  PAPER_SHADE,
  WASH_DESERT,
  WASH_FOREST,
  WASH_HIGH,
  WASH_MEADOW,
  WASH_PLAIN,
  WASH_ROCK,
  WASH_SEA,
  WASH_SNOW,
  WASH_SWAMP,
  WASH_TOWN,
  WASH_TUNDRA,
  CANOPY_MAP,
  PEAK_LIT,
  PEAK_MID,
  PEAK_SHADE,
  blend,
  rampAt,
  shade,
} from './color';
import type { BoxLookup } from './edits';
import { mapDune, mapHill, mapHouse, mapMarsh, mapPeak, mapPine, mapTree, mapTuft } from './mapa-arte';
import { gradPx, hashPx, smoothPx } from './noise';
import type { TileInput } from './pixel';
import { TILE_SIZE, metersPerPixel, sampleLevelFor } from './tiles';

const OCEAN = 0;
const TUNDRA = 1;
const DESERT = 2;
const PLAIN = 3;
const FOREST = 4;
const SWAMP = 5;
const CODE: Readonly<Record<BiomeId, number>> = { ocean: OCEAN, tundra: TUNDRA, desert: DESERT, plain: PLAIN, forest: FOREST, swamp: SWAMP };

/** Margem da grade (gradiente e costa). */
const GM = 4;
/** Níveis de montanhas: células de 80 km, 40 km… 625 m. A montanha ocupa 95% da célula. */
const PEAK_LEVELS = 8;
const PEAK_CELL0 = 80_000;
/** Faixa de tamanho (px) em que a montanha é desenhada como símbolo. Acima, vira terreno (hachuras). */
const PEAK_MIN_PX = 8;
const PEAK_MAX_PX = 320;

interface Px {
  e: number;
  tmp: number;
  moist: number;
  b: number;
  trees: number;
  building: number;
  water: boolean;
}

interface Peak {
  readonly x: number;
  readonly y: number;
  readonly wm: number;
  readonly hill: boolean;
  readonly snowy: boolean;
  readonly variant: number;
}

interface Stamp {
  readonly s: Sprite;
  readonly x: number;
  readonly y: number;
}

/** Flores miúdas do capim no zoom máximo. */
const FLORES: readonly number[] = [0xf2e6a6, 0x9ab6e8, 0xf4f4f0, 0xe9a3b6];

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** Rotações fixas (cos, sen) das oitavas das cristas: os mesmos números do mundo da Satélite. */
const ROT: readonly number[] = [1, 0, 0.8, 0.6, -0.28, 0.96, 0.6, -0.8, -0.96, -0.28];

/**
 * Cristas e ravinas do MUNDO (dado, não desenho): as serras têm a mesma forma nas duas visões.
 * Fractal de cristas multiplicativo, só com as oitavas que têm ≥ 5 pixels neste zoom.
 */
function ridged(x: number, y: number, m: number): number {
  const wx = x + (gradPx(x, y, 26000, 0x8e) - 0.5) * 14000;
  const wy = y + (gradPx(x, y, 26000, 0x8f) - 0.5) * 14000;
  let sum = 0;
  let max = 0;
  let weight = 1;
  let amp = 1;
  let wl = 12000;
  for (let k = 0; k < 11; k++) {
    if (wl >= 5 * m) {
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

export function renderMapTile(input: TileInput): Uint8ClampedArray {
  const S = input.size ?? TILE_SIZE;
  const G = S + 2 * GM;
  const m = metersPerPixel(input.z);
  const level = sampleLevelFor(input.z + 1, input.s0M);
  const gx0 = input.tx * S - GM;
  const gy0 = input.ty * S - GM;
  const PM = PEAK_MAX_PX + 8;
  const box: BoxLookup | null = input.edits
    ? input.edits.forBox((input.tx * S - PM) * m - PEAK_CELL0, (input.ty * S - PM) * m - PEAK_CELL0, ((input.tx + 1) * S + PM) * m + PEAK_CELL0, ((input.ty + 1) * S + PM) * m + PEAK_CELL0, level)
    : null;

  // ---------- o mundo, amostrado a cada 2 pixels (nós globais) e interpolado ----------
  const nodes = new Map<number, Px>();
  function node(ci: number, cj: number): Px {
    const key = ci * 67108864 + cj;
    const hit = nodes.get(key);
    if (hit) return hit;
    const p = { x: (2 * ci + 1) * m, y: (2 * cj + 1) * m };
    const s = input.sampler.sample(p, level);
    let b = CODE[s.biome];
    let e = s.elevationM;
    if (box?.relief) {
      const rv = box.relief(p);
      if (rv.h > 0) {
        e += rv.h;
        if (b === OCEAN && e > 2) b = s.temperatureC < -2 ? TUNDRA : PLAIN;
      }
    }
    let trees = 0;
    let building = 0;
    if (box?.paint) {
      const painted = box.paint(p);
      if (painted?.biome) {
        b = CODE[painted.biome];
        e = b === OCEAN ? Math.min(e, -25) : Math.max(e, 3);
      }
      if (painted?.trees) trees = painted.trees === 'conifer' ? 2 : 1;
      if (painted?.building) building = 1;
    }
    e = b === OCEAN ? Math.min(e, -0.5) : Math.max(e, 0.5);
    const n: Px = { e, tmp: s.temperatureC, moist: s.moisture, b, trees, building, water: b === OCEAN };
    nodes.set(key, n);
    return n;
  }

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
    out.e = a.e * wa + b.e * wb + c.e * wc + d.e * wd;
    out.tmp = a.tmp * wa + b.tmp * wb + c.tmp * wc + d.tmp * wd;
    out.moist = a.moist * wa + b.moist * wb + c.moist * wc + d.moist * wd;
    out.water = out.e < 0;
    if (out.water) {
      out.b = OCEAN;
      out.trees = 0;
      out.building = 0;
      return;
    }
    // Bioma do nó dominante, com a divisa ondulada a mão (ruído na tela).
    const list = [a, b, c, d];
    const ws = [wa, wb, wc, wd];
    let best = 0;
    let bestS = -1e9;
    for (let i = 0; i < 4; i++) {
      if (list[i]!.b === OCEAN) continue;
      const s = ws[i]! + 0.9 * (smoothPx(gx, gy, 4, 0x131 + i) - 0.5);
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    }
    const dom = list[best]!;
    out.b = dom.b === OCEAN ? PLAIN : dom.b;
    out.trees = dom.trees;
    out.building = dom.building;
    const amp = clamp((out.e - 700) / 1600, 0, 1) * 900;
    if (amp > 1) out.e = Math.max(1, out.e + amp * (ridged((gx + 0.5) * m, (gy + 0.5) * m, m) - 0.5));
  }

  const n = G * G;
  const elev = new Float32Array(n);
  const temp = new Float32Array(n);
  const moist = new Float32Array(n);
  const biome = new Uint8Array(n);
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
      trees[k] = px.trees;
      building[k] = px.building;
    }
  }
  const memo = new Map<number, Px>();
  function infoAt(gx: number, gy: number): Px {
    const li = gx - gx0;
    const lj = gy - gy0;
    if (li >= 0 && lj >= 0 && li < G && lj < G) {
      const k = lj * G + li;
      return { e: elev[k]!, tmp: temp[k]!, moist: moist[k]!, b: biome[k]!, trees: trees[k]!, building: building[k]!, water: elev[k]! < 0 };
    }
    const key = gx * 67108864 + gy;
    const hit = memo.get(key);
    if (hit) return hit;
    const out: Px = { e: 0, tmp: 0, moist: 0, b: 0, trees: 0, building: 0, water: false };
    fill(gx, gy, out);
    memo.set(key, out);
    return out;
  }

  /** Cobertura de mata (0–1), no mundo: igual em todos os zooms. */
  /**
   * Cobertura de mata (0–1), no mundo. Manchas (clareira, bosque) só existem se forem maiores que uma
   * árvore desenhada neste zoom: de longe, a mata é um maciço e o campo é campo; ao aproximar, as
   * clareiras e os bosques aparecem. Nunca há árvore solta espalhada.
   */
  const ve = (cel: number) => cel / m >= 10;
  function cover(xm: number, ym: number, f: Px): number {
    if (f.water || f.building) return 0;
    if (f.trees) return 1;
    if (f.e > 2150) return 0; // acima do limite das árvores
    if (f.b === FOREST) return ve(3500) && smoothPx(xm, ym, 3500, 0x14a) < 0.22 ? 0 : 1;
    if (f.b === SWAMP) return ve(1500) && smoothPx(xm, ym, 1500, 0x14d) > 0.62 ? 1 : 0;
    // pinheirais entre as montanhas (como nas cordilheiras pintadas)
    if (f.e > 1100 && f.b !== DESERT) return ve(4000) && smoothPx(xm, ym, 4000, 0x14e) > 0.55 ? 1 : 0;
    if (f.b === PLAIN) return ve(1800) && smoothPx(xm, ym, 1800, 0x14b) > 0.8 ? 1 : 0;
    if (f.b === TUNDRA) return f.tmp > -8 && ve(1200) && smoothPx(xm, ym, 1200, 0x14c) > 0.7 ? 1 : 0;
    return 0;
  }

  // ---------- 1. chão: aquarela, papel, costa e mar ----------
  const washOf = (b: number, tmp: number, wet: number): number =>
    b === FOREST
      ? WASH_FOREST
      : b === DESERT
        ? WASH_DESERT
        : b === SWAMP
          ? WASH_SWAMP
          : b === TUNDRA
            ? tmp < -6
              ? WASH_SNOW
              : WASH_TUNDRA
            : blend(WASH_PLAIN, WASH_MEADOW, clamp((wet - 0.35) * 2, 0, 1));
  const rgb = new Int32Array(S * S);
  const slope = new Float32Array(S * S);
  const aspect = new Float32Array(S * S * 2);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const k = (y + GM) * G + x + GM;
      const gx = gx0 + x + GM;
      const gy = gy0 + y + GM;
      const e = elev[k]!;
      const dzdx = (elev[k + 1]! - elev[k - 1]!) / (2 * m);
      const dzdy = (elev[k + G]! - elev[k - G]!) / (2 * m);
      const st = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
      slope[y * S + x] = st;
      aspect[(y * S + x) * 2] = st > 0 ? dzdx / st : 0;
      aspect[(y * S + x) * 2 + 1] = st > 0 ? dzdy / st : 0;
      const sdPx = e / Math.max(st, 1e-4) / m; // distância à costa em pixels (+ terra)
      let col: number;
      if (e < 0) {
        const depth = -e;
        col = rampAt(WASH_SEA, 3.6 - clamp(depth / 1400, 0, 1) * 3.3 + (smoothPx(gx, gy, 90, 0x174) - 0.5) * 0.6);
        const d = -sdPx;
        col = blend(col, WASH_SEA[3]!, clamp(1 - d / 26, 0, 1) * 0.55); // brilho largo junto da costa
        col = blend(col, WASH_SEA[4]!, clamp(1 - d / 7, 0, 1) * 0.6);
        for (const [L, a] of [[3, 0.55], [6.5, 0.38], [11, 0.24], [17, 0.12]] as const) {
          const off = Math.abs(d - L - (smoothPx(gx, gy, 11, 0x176) - 0.5) * 1.4);
          if (off < 0.6) col = blend(col, blend(INK_SOFT, WASH_SEA[0]!, 0.5), a * (1 - off / 0.6));
        }
        // mar aberto: traços curtos de onda, presos à tela (gravura)
        if (d > 22 && gy % 7 === 0 && smoothPx(gx, gy, 6, 0x177) > 0.72) col = blend(col, WASH_SEA[4]!, 0.35);
      } else {
        const b = biome[k]!;
        const tmp = temp[k]!;
        col = washOf(b, tmp, moist[k]!);
        if (b !== DESERT && b !== SWAMP && e > 600) col = blend(col, WASH_HIGH, clamp((e - 600) / 1000, 0, 0.65));
        if (e > 1600) col = blend(col, WASH_ROCK, clamp((e - 1600) / 800, 0, 0.8));
        // de perto, dentro da serra: rocha pintada nos tons das montanhas, com luz e sombra de pincel
        if (m <= 300 && e > 1300) {
          const st = slope[y * S + x]!;
          const luz = clamp(-(aspect[(y * S + x) * 2]! + aspect[(y * S + x) * 2 + 1]!) * 0.707 * st * (2.5 + Math.pow(m, 0.6) * 0.3), -1, 1);
          const rocha = luz > 0 ? blend(PEAK_MID, PEAK_LIT, luz) : blend(PEAK_MID, PEAK_SHADE, -luz);
          col = blend(col, rocha, clamp((e - 1300) / 500, 0, 0.85) * clamp((300 - m) / 150, 0, 1));
        }
        const frio = clamp((-6 - tmp) / 5, 0, 1);
        const neve = Math.max((e - 3300) / 500, (frio * (e - 2000)) / 800);
        if (neve > 0) col = blend(col, WASH_SNOW, clamp(neve, 0, 0.75));
        // de perto, cascalho e blocos a pena na rocha (presos ao mundo: o mesmo cascalho em cada zoom próximo)
        if (m <= 32 && e > 1500) {
          const q = hashPx(Math.floor(((gx + 0.5) * m) / 3), Math.floor(((gy + 0.5) * m) / 3), 0x175);
          if (q < clamp((e - 1500) / 1500, 0, 1) * 0.05) col = blend(col, INK_SOFT, 0.6);
        }
        if (building[k]) col = blend(col, WASH_TOWN, 0.55);
        // fundo da mata: copas escuras vistas de cima (nos vãos entre as árvores desenhadas)
        const xm0 = (gx + 0.5) * m;
        const ym0 = (gy + 0.5) * m;
        const fp: Px = { e, tmp, moist: moist[k]!, b, trees: trees[k]!, building: building[k]!, water: false };
        if (cover(xm0, ym0, fp) >= 0.5) col = rampAt(CANOPY_MAP, 1.4 + (smoothPx(gx, gy, 5, 0x17a) - 0.5) * 2.2 + (hashPx(gx, gy, 0x17b) - 0.5) * 0.8);
        // zoom máximo: textura do chão (capim, flores, pedrinhas, terra), presa ao mundo
        if (m <= 4 && cover(xm0, ym0, fp) < 0.5 && (b === PLAIN || b === TUNDRA || b === SWAMP)) {
          const cx = Math.floor(xm0 / 0.5);
          const cy = Math.floor(ym0 / 0.5);
          const q = hashPx(cx, cy, 0x17c);
          if (smoothPx(xm0, ym0, 14, 0x17d) > 0.78) col = blend(col, WASH_DESERT, 0.45); // terra batida
          if (q < 0.18) col = blend(col, shade(col, 0.72), 0.7); // tufo de capim (sombra)
          else if (q < 0.3) col = blend(col, PAPER_LIGHT, 0.25); // ponta de capim na luz
          else if (q > 0.996) col = FLORES[Math.floor(hashPx(cx, cy, 0x17e) * FLORES.length)]!; // flor
          else if (q > 0.99) col = blend(col, PAPER_SHADE, 0.85); // pedrinha
        }
        // pigmento acumulado na borda dos biomas (aquarela) e na beira da costa
        let borda = 0;
        for (const r of [2, 4] as const) {
          if (biome[k - r]! !== b || biome[k + r]! !== b || biome[k - r * G]! !== b || biome[k + r * G]! !== b) {
            borda = r === 2 ? 0.32 : Math.max(borda, 0.12);
            break;
          }
        }
        if (borda > 0) col = blend(col, shade(col, 0.72), borda);
        if (sdPx < 5) col = blend(col, shade(col, 0.78), (1 - sdPx / 5) * 0.45);
      }
      // costa a pena
      const ad = Math.abs(sdPx);
      if (ad < 0.9) col = blend(col, INK, 1 - ad / 0.9);
      // papel: granulação da aquarela (manchas) e fibras, presas à tela
      const gran = (smoothPx(gx, gy, 48, 0x171) - 0.5) * 0.22 + (smoothPx(gx, gy, 9, 0x172) - 0.5) * 0.1;
      col = gran > 0 ? blend(col, PAPER_LIGHT, gran) : blend(col, PAPER_SHADE, -gran);
      const fibra = hashPx(gx, gy, 0x173);
      if (fibra > 0.985) col = blend(col, PAPER, 0.5);
      else if (fibra < 0.012) col = blend(col, PAPER_SHADE, 0.4);
      rgb[y * S + x] = col;
    }
  }

  // ---------- 2. hachuras: o relevo a pena, na direção da encosta ----------
  // Exagero vertical: de longe as encostas são suaves em metros, mas o mapa precisa mostrá-las.
  const K = 2.5 + Math.pow(m, 0.6) * 0.3;
  const HS = 3; // grade das hachuras (px)
  for (let gj = Math.floor((gy0 + GM - 4) / HS); gj <= Math.floor((gy0 + GM + S + 4) / HS); gj++) {
    for (let gi = Math.floor((gx0 + GM - 4) / HS); gi <= Math.floor((gx0 + GM + S + 4) / HS); gi++) {
      const ax = gi * HS + Math.floor(hashPx(gi, gj, 0x181) * HS);
      const ay = gj * HS + Math.floor(hashPx(gi, gj, 0x182) * HS);
      const lx = ax - (gx0 + GM);
      const ly = ay - (gy0 + GM);
      // gradiente: da grade, se o ponto estiver nela; senão, dos vizinhos calculados
      let st: number;
      let ux: number;
      let uy: number;
      if (lx >= 0 && ly >= 0 && lx < S && ly < S) {
        st = slope[ly * S + lx]!;
        ux = aspect[(ly * S + lx) * 2]!;
        uy = aspect[(ly * S + lx) * 2 + 1]!;
      } else {
        const c = infoAt(ax, ay);
        if (c.water) continue;
        const dx = (infoAt(ax + 1, ay).e - infoAt(ax - 1, ay).e) / (2 * m);
        const dy = (infoAt(ax, ay + 1).e - infoAt(ax, ay - 1).e) / (2 * m);
        st = Math.sqrt(dx * dx + dy * dy);
        ux = st > 0 ? dx / st : 0;
        uy = st > 0 ? dy / st : 0;
      }
      const forca = st * K;
      if (forca < 0.22 || infoAt(ax, ay).e < 1) continue;
      // traço morro abaixo (contra o gradiente); mais longo e escuro quanto mais íngreme; mais forte do lado da sombra (sudeste)
      const len = clamp(forca * 2.2, 1.2, 4.5);
      const sombra = clamp(0.5 + (ux * 0.7 + uy * 0.7) * 0.5, 0.25, 1);
      // de longe, quem desenha o relevo são as montanhas; as hachuras entram ao aproximar
      const a = clamp((forca - 0.22) * 0.9, 0.12, 0.75) * sombra * clamp((700 - m) / 450, 0, 1);
      if (a < 0.03) continue;
      for (let t = 0; t <= len; t += 0.7) {
        const x = Math.round(lx - ux * t);
        const y = Math.round(ly - uy * t);
        if (x < 0 || y < 0 || x >= S || y >= S) continue;
        rgb[y * S + x] = blend(rgb[y * S + x]!, INK_SOFT, a);
      }
    }
  }

  // ---------- 3. símbolos ----------
  const stamps: Stamp[] = [];
  const left = input.tx * S;
  const top = input.ty * S;
  const push = (s: Sprite, x: number, y: number) => {
    if (x - s.ax + s.w < left || x - s.ax > left + S || y - s.ay + s.h < top || y - s.ay > top + S) return;
    stamps.push({ s, x, y });
  };
  const grid = (step: number, salt: number, margin: number, f: (gx: number, gy: number, gi: number, gj: number) => void) => {
    for (let gj = Math.floor((top - 4) / step); gj <= Math.floor((top + S + margin) / step); gj++) {
      for (let gi = Math.floor((left - margin) / step); gi <= Math.floor((left + S + margin) / step); gi++) {
        f(gi * step + Math.floor(hashPx(gi, gj, salt) * step), gj * step + Math.floor(hashPx(gi, gj, salt + 1) * step), gi, gj);
      }
    }
  };

  // Montanhas e colinas, presas ao mundo (hierarquia de células de 80 km a 625 m).
  const peakMemo = new Map<string, Peak | null>();
  const elevWorld = (x: number, y: number, lvl: number): number => {
    const s = input.sampler.sample({ x, y }, lvl);
    let e = s.water ? Math.min(s.elevationM, -1) : s.elevationM;
    if (box?.relief) e += box.relief({ x, y }).h;
    return e;
  };
  function peakAt(k: number, i: number, j: number): Peak | null {
    const key = `${k}|${i}|${j}`;
    if (peakMemo.has(key)) return peakMemo.get(key)!;
    peakMemo.set(key, null);
    const cell = PEAK_CELL0 / 2 ** k;
    const x = (i + 0.05 + 0.9 * hashPx(i, j, 0x300 + k)) * cell;
    const y = (j + 0.05 + 0.9 * hashPx(i, j, 0x310 + k)) * cell;
    const lvl = sampleLevelFor(Math.log2(cell / 8), input.s0M);
    const e = elevWorld(x, y, lvl);
    // Toda terra alta ganha montanha (as mais altas, sempre; as de meia altura, nem sempre);
    // a terra de meia altura ganha colinas. Presas à grade do mundo: as mesmas em qualquer zoom.
    if (e < 750) return null;
    const chance = e >= 1300 ? clamp(0.4 + (e - 1300) / 2500, 0.4, 0.85) : 0.35;
    if (hashPx(i, j, 0x340 + k) > chance) return null;
    // Montanha menor dentro da área de uma maior não aparece: ao aproximar, quem cresce é a maior.
    for (let kk = 0; kk < k; kk++) {
      const cc = PEAK_CELL0 / 2 ** kk;
      const ci = Math.floor(x / cc);
      const cj = Math.floor(y / cc);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const pk = peakAt(kk, ci + di, cj + dj);
          if (!pk) continue;
          const dx = x - pk.x;
          const dy = y - pk.y;
          if (Math.abs(dx) < pk.wm * 0.5 && dy > -pk.wm * 0.75 && dy < pk.wm * 0.2) return null;
        }
      }
    }
    const tmp = input.sampler.sample({ x, y }, lvl).temperatureC;
    const hill = e < 1250;
    const p: Peak = { x, y, wm: cell * (hill ? 0.8 : 0.95), hill, snowy: !hill && (e > 2400 || tmp < -4), variant: Math.floor(hashPx(i, j, 0x320 + k) * 997) };
    peakMemo.set(key, p);
    return p;
  }
  for (let k = 0; k < PEAK_LEVELS; k++) {
    const cell = PEAK_CELL0 / 2 ** k;
    const wpx = (cell * 0.95) / m;
    if (wpx < PEAK_MIN_PX || wpx > PEAK_MAX_PX * 1.3) continue;
    const i0 = Math.floor(((left - wpx) * m) / cell);
    const i1 = Math.floor(((left + S + wpx) * m) / cell);
    const j0 = Math.floor(((top - 2) * m) / cell);
    const j1 = Math.floor(((top + S + wpx) * m) / cell);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const p = peakAt(k, i, j);
        if (!p) continue;
        const w = p.wm / m;
        if (w < PEAK_MIN_PX || w > PEAK_MAX_PX) continue; // grande demais: já é o terreno (hachuras)
        push(p.hill ? mapHill(w, p.variant) : mapPeak(w, p.variant, p.snowy), Math.round(p.x / m), Math.round(p.y / m));
      }
    }
  }
  // Montanhas e colinas pintadas à mão: presas ao lugar, do tamanho que foram pintadas.
  for (const bump of box?.bumps ?? []) {
    const w = (bump.radius * 2 * (1 + Math.min(bump.neighbors, 4) * 0.12)) / m;
    if (w < PEAK_MIN_PX || w > PEAK_MAX_PX) continue;
    const variant = Math.floor(hashPx(Math.round(bump.x), Math.round(bump.y), 0x330) * 997);
    const s = bump.kind === 'mountain' ? mapPeak(w, variant, bump.height >= 2400) : mapHill(w, variant);
    push(s, Math.round(bump.x / m), Math.round((bump.y + bump.radius * 0.3) / m));
  }

  // Matas: um maciço de arvorezinhas que preenche a mata em qualquer zoom.
  const r = clamp(Math.round(2.6 + 0.55 * Math.log2(2048 / m)), 3, 9);
  const passo = Math.max(3, Math.round(r * 1.25)); // copas se sobrepõem: a mata é um maciço
  grid(passo, 0x183, r * 3 + 4, (gx, gy, gi, gj) => {
    const f = infoAt(gx, gy);
    if (f.water || f.e < 2) return;
    const xm = (gx + 0.5) * m;
    const ym = (gy + 0.5) * m;
    const c = cover(xm, ym, f);
    if (c < 0.5) return;
    const variant = Math.floor(hashPx(gi, gj, 0x186) * 997);
    const conifer = f.trees === 2 || (f.trees !== 1 && (f.tmp < 4 || f.e > 1150));
    push(conifer ? mapPine(r * 2.6, variant % 7) : mapTree(r, variant % 13), gx, gy);
  });

  // Vilas e cidades pintadas: casinhas que crescem com o zoom.
  const casa = clamp(12 / m, 5, 22);
  grid(Math.max(5, Math.round(casa * 1.25)), 0x187, 24, (gx, gy, gi, gj) => {
    const f = infoAt(gx, gy);
    if (!f.building || f.water || hashPx(gi, gj, 0x188) > 0.8) return;
    push(mapHouse(casa * (0.85 + hashPx(gi, gj, 0x189) * 0.3), Math.floor(hashPx(gi, gj, 0x18a) * 5)), gx, gy);
  });

  // Brejo, dunas e capim: marcas pequenas, presas à tela.
  grid(8, 0x191, 10, (gx, gy, gi, gj) => {
    const f = infoAt(gx, gy);
    if (f.water || f.e < 2 || f.building) return;
    const h = hashPx(gi, gj, 0x192);
    const v = Math.floor(hashPx(gi, gj, 0x193) * 6);
    if (f.b === SWAMP && h < 0.5) push(mapMarsh(v), gx, gy);
    else if (f.b === DESERT && h < 0.22) push(mapDune(v), gx, gy);
    else if ((f.b === PLAIN || f.b === TUNDRA) && h < 0.07 && f.e < 1600) push(mapTuft(v), gx, gy);
  });

  // ---------- 4. carimbos de trás para a frente ----------
  stamps.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const st of stamps) {
    const sp = st.s;
    for (let sy = 0; sy < sp.h; sy++) {
      const y = st.y - sp.ay + sy - top;
      if (y < 0 || y >= S) continue;
      for (let sx = 0; sx < sp.w; sx++) {
        const c = sp.px[sy * sp.w + sx]!;
        if (c === -1) continue;
        const x = st.x - sp.ax + sx - left;
        if (x < 0 || x >= S) continue;
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
