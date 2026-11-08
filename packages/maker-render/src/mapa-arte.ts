// SPDX-License-Identifier: MPL-2.0

/**
 * A arte da visão Mapa (só dela; a Satélite tem a sua em sprites.ts e trees.ts): mapa ilustrado
 * pintado à mão, a pena e aquarela. Cada desenho é gerado no TAMANHO EM QUE APARECE na tela e
 * guardado em cache: uma montanha de 12 px e a mesma montanha com 200 px são o mesmo desenho
 * (mesma semente), e a de 200 px tem mais detalhe (ravinas, estratos, neve, picos secundários).
 * Originais, por código; as referências (`assets-organizado/`) só orientaram o clima (DEC-023).
 */

import { Canvas, EMPTY, clampIndex, type Sprite } from './canvas';
import {
  HILL_LIT,
  HILL_SHADE,
  INK,
  INK_LEAF,
  INK_LEAF_AUTUMN,
  INK_PINE,
  INK_SOFT,
  PAPER_SHADE,
  PEAK_DEEP,
  PEAK_LIT,
  PEAK_MID,
  PEAK_SHADE,
  WASH_DESERT,
  WASH_SNOW,
  WASH_SNOW_SHADE,
  WASH_TOWN,
  blend,
  hex,
  type Ramp,
} from './color';
import { hashPx, rng } from './noise';

const cache = new Map<string, Sprite>();
function memo(chave: string, f: () => Sprite): Sprite {
  let s = cache.get(chave);
  if (!s) {
    s = f();
    // Cache limitado: os tamanhos mudam com o zoom; os mais antigos saem.
    if (cache.size > 4000) cache.delete(cache.keys().next().value!);
    cache.set(chave, s);
  }
  return s;
}

/** Arredonda a largura (px) para poucos tamanhos: 1 px até 40, 2 px até 100, 4 px depois. */
export function quantize(w: number): number {
  if (w <= 40) return Math.round(w);
  if (w <= 100) return Math.round(w / 2) * 2;
  return Math.round(w / 4) * 4;
}

// ---------- montanhas ----------

/** Pico pintado no tamanho `w` (px). `variant` fixa o formato: é a identidade daquela montanha. */
export function mapPeak(w: number, variant: number, snowy: boolean): Sprite {
  const wq = Math.max(7, quantize(w));
  // a proporção (alta e pontuda, ou larga e baixa) é da montanha: vem da variante
  const prop = 0.5 + (variant % 7) * 0.035;
  return memo(`p${wq}|${variant}|${snowy ? 1 : 0}`, () => makePeak(wq, Math.round(wq * prop), 52000 + variant * 7919, snowy));
}

function makePeak(w: number, h: number, seed: number, snowy: boolean): Sprite {
  const rnd = rng(seed);
  const c = new Canvas(w, h);
  const main = (w - 1) / 2 + (rnd() - 0.5) * w * 0.16;
  // Os vizinhos e o principal saem sempre na mesma ordem do sorteio: crescer não muda o formato.
  const left = { on: rnd() < 0.85, at: main - w * (0.24 + rnd() * 0.08), hw: w * 0.25, hh: h * (0.48 + rnd() * 0.18) };
  const right = { on: rnd() < 0.85, at: main + w * (0.22 + rnd() * 0.08), hw: w * 0.25, hh: h * (0.44 + rnd() * 0.18) };
  const mainHw = w * (0.44 + rnd() * 0.06);
  const sub = rng(seed + 1);
  // cumes de trás, ao longo da crista (o maciço)
  if (w >= 24) {
    const atras = rng(seed + 4);
    for (let i = 0; i < 2; i++) {
      const at = main + (i === 0 ? -1 : 1) * w * (0.12 + atras() * 0.1);
      drawPeak(c, at, w * 0.2, h * (0.7 + atras() * 0.15), snowy, rng(seed + 10 + i));
    }
  }
  if (w >= 14 && left.on) drawPeak(c, left.at, left.hw, left.hh, snowy, rng(seed + 2));
  if (w >= 14 && right.on) drawPeak(c, right.at, right.hw, right.hh, snowy, rng(seed + 3));
  drawPeak(c, main, mainHw, h, snowy, sub);
  // contrafortes na frente (mais baixos, dão profundidade)
  if (w >= 34) {
    const frente = rng(seed + 5);
    for (let i = 0; i < 2; i++) {
      const at = main + (i === 0 ? -1 : 1) * w * (0.2 + frente() * 0.12);
      drawPeak(c, at, w * 0.17, h * (0.32 + frente() * 0.12), false, rng(seed + 20 + i));
    }
  }
  return c.sprite(Math.round(main), h - 1, false);
}

function drawPeak(c: Canvas, apex: number, halfW: number, height: number, snowy: boolean, rnd: () => number): void {
  const base = c.h - 1;
  const top = Math.round(base - height + 1);
  const rows = base - top + 1;
  const w = halfW * 2;
  const lw = halfW * (0.85 + rnd() * 0.3);
  const rw = halfW * (0.85 + rnd() * 0.3);
  // contorno irregular: a "quebra" das encostas é proporcional ao tamanho
  const jagAmp = Math.max(0.6, w * 0.035);
  const jag: number[] = [];
  for (let i = 0; i <= 64; i++) jag.push((rnd() - 0.5) * 2);
  const jagAt = (p: number, k: number) => {
    const u = p * 16 + k * 23;
    const i = Math.floor(u) % 64;
    const f = u - Math.floor(u);
    return (jag[i]! * (1 - f) + jag[(i + 1) % 64]! * f) * jagAmp;
  };
  const snowFrac = 0.28 + rnd() * 0.12;
  const ridgeOff = (rnd() - 0.3) * 0.25;
  const ridgeAt = (y: number) => apex + ((y - top + 0.5) / rows) * rw * ridgeOff;
  const ravSeeds = Array.from({ length: 12 }, () => [rnd(), rnd(), rnd(), rnd()] as const);
  const mask = new Uint8Array(c.w * c.h);
  const lit = new Uint8Array(c.w * c.h);
  // base irregular: a montanha nasce do chão em ondas, não numa linha reta
  const baseCut = (x: number) => Math.round(Math.abs(Math.sin(x * (9 / Math.max(9, w)) + 1.3) + (hashPx(Math.floor(x / 3), 0, 0x5e) - 0.5) * 0.8) * Math.max(1, rows * 0.07));
  for (let y = Math.max(0, top); y <= base; y++) {
    const p = (y - top + 0.5) / rows;
    const pc = Math.pow(p, 0.82); // encostas côncavas (mais íngremes no alto)
    const L = apex - pc * lw + jagAt(p, 1) * p;
    const R = apex + pc * rw + jagAt(p, 2) * p;
    const ridge = ridgeAt(y);
    for (let x = Math.ceil(L); x <= Math.floor(R); x++) {
      if (x < 0 || x >= c.w || y > base - baseCut(x)) continue;
      const k = y * c.w + x;
      const isLit = x < ridge;
      let col: number;
      if (isLit) {
        // face na luz: clara junto da crista, escurecendo para a borda e para a base (pintura, não hachura)
        const f = (ridge - x) / Math.max(1, ridge - L);
        col = blend(blend(PEAK_LIT, PEAK_MID, Math.min(1, f * 0.8 + Math.max(0, p - 0.35) * 0.9)), PEAK_SHADE, Math.max(0, p - 0.8) * 0.8);
      } else {
        const f = (x - ridge) / Math.max(1, R - ridge);
        col = blend(PEAK_DEEP, PEAK_SHADE, Math.min(1, 0.25 + f * 0.85));
      }
      // pinceladas verticais: o vinco das encostas (suave)
      if (w >= 12) {
        const v = Math.sin((x - apex) * (14 / Math.max(14, w)) * 3.1 + jagAt(p, 3) * 0.6);
        if (v > 0.82) col = blend(col, PEAK_DEEP, isLit ? 0.22 : 0.3);
      }
      // estratos de rocha nos grandes
      if (w >= 60 && (y + Math.round((x - apex) * 0.3)) % 7 === 0 && hashPx(x, y, 0x5c) < 0.55) col = blend(col, PEAK_DEEP, isLit ? 0.25 : 0.35);
      if (snowy) {
        const edge = rows * snowFrac + Math.sin(x * (6 / Math.max(6, w))) * rows * 0.06 + (hashPx(x, 3, 0x51) - 0.5) * 1.5;
        if (y - top < edge + (isLit ? 1 : -0.5)) col = isLit ? WASH_SNOW : WASH_SNOW_SHADE;
      }
      c.set(x, y, col);
      mask[k] = 1;
      lit[k] = isLit ? 1 : 0;
    }
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < c.w && y < c.h && mask[y * c.w + x] === 1;
  // ravinas: mais e mais longas quanto maior o desenho (o detalhe que aparece ao aproximar)
  if (w >= 12) {
    const n = Math.min(12, 2 + Math.floor(w / 14));
    for (let i = 0; i < n; i++) {
      const [a, b, s, l] = ravSeeds[i]!;
      const y0 = Math.round(top + rows * (0.12 + a * 0.5));
      const side = i % 2 === 0 ? 1 : -1;
      let x = ridgeAt(y0);
      const len = rows * (0.25 + l * 0.4);
      const slope = side * (0.45 + s * 0.5);
      for (let k = 0; k < len; k++) {
        const y = y0 + k;
        x += slope + (hashPx(i, k, 0x5d + Math.round(b * 99)) - 0.5) * 0.7;
        const xi = Math.round(x);
        if (!inside(xi, y)) break;
        const onLit = lit[y * c.w + xi] === 1;
        c.set(xi, y, onLit ? blend(PEAK_MID, INK_SOFT, 0.55) : PEAK_DEEP);
        if (w >= 90 && k % 3 === 0 && inside(xi + side, y)) c.set(xi + side, y, onLit ? PEAK_MID : blend(PEAK_DEEP, PEAK_SHADE, 0.5));
      }
    }
  }
  // contorno a pena: 2 px do lado da sombra nos grandes; a base fica aberta
  const thick = w >= 18;
  for (let y = Math.max(0, top); y <= base; y++) {
    for (let x = 0; x < c.w; x++) {
      if (!inside(x, y)) continue;
      const out = (dx: number, dy: number) => {
        const xx = x + dx;
        const yy = y + dy;
        return xx < 0 || xx >= c.w || yy < 0 || (yy < c.h && !mask[yy * c.w + xx]);
      };
      if (out(-1, 0) || out(1, 0) || out(0, -1) || (thick && x > ridgeAt(y) && out(2, 0))) c.set(x, y, INK);
    }
  }
  for (let y = Math.max(0, top + 1); y < top + rows * 0.75; y++) {
    const x = Math.round(ridgeAt(y));
    if (inside(x, y)) c.set(x, y, INK_SOFT); // traço da crista
  }
}

/** Colina pintada no tamanho `w` (px): monte verde, luz a oeste, sombra a leste. */
export function mapHill(w: number, variant: number): Sprite {
  const wq = Math.max(7, quantize(w));
  return memo(`h${wq}|${variant}`, () => makeHill(wq, 61000 + variant * 7919));
}

function makeHill(w: number, seed: number): Sprite {
  const rnd = rng(seed);
  const h = Math.max(3, Math.round(w * 0.38));
  const c = new Canvas(w, h);
  const cx = (w - 1) / 2 + (rnd() - 0.5) * w * 0.12;
  const tops: number[] = [];
  for (let x = 0; x < w; x++) {
    const nx = (x - cx) / (w / 2);
    const y = Math.round(h - 1 - Math.max(0, 1 - nx * nx) ** 0.8 * (h - 1));
    tops.push(y);
    for (let yy = y; yy < h; yy++) {
      const fade = (yy - y) / Math.max(1, h - y);
      c.set(x, yy, nx > 0.05 ? blend(HILL_SHADE, HILL_LIT, fade * 0.5) : blend(HILL_LIT, HILL_SHADE, fade * 0.25));
    }
  }
  let prev = -1;
  for (let x = 0; x < w; x++) {
    const y = tops[x]!;
    const y0 = prev < 0 ? y : Math.min(prev, y);
    const y1 = prev < 0 ? y : Math.max(prev, y);
    if (y < h - 1 || x === 0 || x === w - 1) for (let yy = y0; yy <= y1; yy++) c.set(x, yy, INK);
    prev = y;
    const nx = (x - cx) / (w / 2);
    if (nx > 0.15 && x % 2 === 0 && hashPx(x, 0, seed) < 0.8) {
      const len = Math.max(1, Math.round((1 - nx) * h * 0.5));
      for (let k = 1; k <= len; k++) c.set(x, y + k + 1, INK_SOFT);
    }
  }
  return c.sprite(Math.round(cx), h - 1, false);
}

// ---------- árvores ----------

/** Copa redonda em cachos (raio `r` px), aguada verde, contorno a tinta. */
export function mapTree(r: number, variant: number): Sprite {
  const rr = Math.max(2, Math.round(r));
  const autumn = variant % 13 === 12;
  return memo(`t${rr}|${variant}`, () => makeCrown(rr, 30000 + rr * 100 + variant, autumn ? INK_LEAF_AUTUMN : INK_LEAF));
}

/** Pinheiro a tinta com altura `h` px. */
export function mapPine(h: number, variant: number): Sprite {
  const hh = Math.max(5, Math.round(h));
  return memo(`c${hh}|${variant}`, () => makePine(hh, 31000 + hh * 100 + variant));
}

function makeCrown(r: number, seed: number, leaf: Ramp): Sprite {
  const rnd = rng(seed);
  const trunk = Math.max(1, Math.round(r * 0.35));
  const cy = Math.round(r * 1.08) + 1;
  const W = Math.ceil(2 * r * 1.15) + 3;
  const H = cy + Math.round(r) + trunk + 1;
  const c = new Canvas(W, H);
  const cx = (W - 1) / 2;
  const lobes = Math.max(5, Math.min(10, Math.round(r * 0.3) + 4));
  const phase = rnd() * 6.2832;
  const amp: number[] = [];
  for (let i = 0; i < lobes; i++) amp.push(0.82 + rnd() * 0.22);
  const radius = (a: number): number => {
    const u = ((a + phase) / 6.2832) * lobes;
    const i = Math.floor(u);
    const f = u - i;
    const a0 = amp[((i % lobes) + lobes) % lobes]!;
    const a1 = amp[(((i + 1) % lobes) + lobes) % lobes]!;
    return r * ((a0 + (a1 - a0) * f) * 0.86 + Math.sin(f * Math.PI) * 0.16);
  };
  const inside = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = (y - cy) * 1.05;
      if (Math.sqrt(dx * dx + dy * dy) <= radius(Math.atan2(dy, dx))) inside[y * W + x] = 1;
    }
  }
  const isIn = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && inside[y * W + x] === 1;
  const tx = Math.round(cx);
  for (let y = cy + Math.round(r * 0.6); y < H; y++) c.set(tx, y, INK);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isIn(x, y)) continue;
      const t = 3.6 - ((x - cx) / r) * 1.3 - ((y - cy) / r) * 1.6 + (hashPx(x, y, seed) - 0.5) * 0.6;
      c.set(x, y, clampIndex(leaf, t));
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isIn(x, y)) continue;
      const edge = !isIn(x - 1, y) || !isIn(x + 1, y) || !isIn(x, y - 1) || !isIn(x, y + 1);
      const shadowEdge = r >= 7 && (!isIn(x + 2, y) || !isIn(x, y + 2)) && x - cx + (y - cy) > 0;
      if (edge || shadowEdge) c.set(x, y, INK);
    }
  }
  return c.sprite(tx, H - 1, false);
}

function makePine(h: number, seed: number): Sprite {
  const rnd = rng(seed);
  const half = Math.max(2, Math.round(h * 0.3));
  const W = 2 * half + 1;
  const trunk = Math.max(1, Math.round(h * 0.12));
  const H = h + trunk;
  const c = new Canvas(W, H);
  const cx = half;
  for (let y = h - 1; y < H; y++) c.set(cx, y, INK);
  const tiers = Math.max(2, Math.round(h / 5));
  for (let y = 0; y < h; y++) {
    const p = (y + 1) / h;
    const phase = (p * tiers) % 1;
    const hw = (0.15 + 0.85 * p) * half * (0.55 + 0.45 * phase) + 0.2;
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      if (Math.abs(dx) > hw) continue;
      c.set(x, y, clampIndex(INK_PINE, 2.4 - dx / (half + 0.5) + (rnd() - 0.5) * 0.6));
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      if (c.get(x, y) !== EMPTY && c.edge(x, y)) c.set(x, y, INK);
    }
  }
  return c.sprite(cx, H - 1, false);
}

// ---------- casas, brejo, dunas, capim ----------

const ROOF = hex('#b0573a');
const ROOF_DARK = hex('#7d3a27');

/** Casinha de mapa (largura `w` px): parede clara, telhado vermelho em duas águas, contorno. */
export function mapHouse(w: number, variant: number): Sprite {
  const wq = Math.max(5, Math.min(24, Math.round(w)));
  return memo(`k${wq}|${variant}`, () => {
    const rnd = rng(71000 + wq * 31 + variant);
    const W = wq;
    const roofH = Math.max(2, Math.round(W * 0.45));
    const wallH = Math.max(2, Math.round(W * (0.35 + rnd() * 0.15)));
    const H = roofH + wallH;
    const c = new Canvas(W, H);
    const mid = (W - 1) / 2;
    for (let y = 0; y < roofH; y++) {
      const hw = ((y + 1) / roofH) * (W / 2);
      for (let x = 0; x < W; x++) if (Math.abs(x - mid) <= hw) c.set(x, y, x > mid ? ROOF_DARK : ROOF);
    }
    for (let y = roofH; y < H; y++) for (let x = 1; x < W - 1; x++) c.set(x, y, x > mid ? blend(WASH_TOWN, PAPER_SHADE, 0.6) : WASH_TOWN);
    if (W >= 9) c.set(Math.round(mid), H - 1, INK); // porta
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (c.get(x, y) !== EMPTY && c.edge(x, y)) c.set(x, y, INK);
    return c.sprite(Math.round(mid), H - 1, false);
  });
}

export function mapMarsh(variant: number): Sprite {
  return memo(`m${variant}`, () => {
    const rnd = rng(35000 + variant);
    const w = 6 + Math.floor(rnd() * 3);
    const c = new Canvas(w, 3);
    for (let x = 0; x < w; x++) c.set(x, 2, blend(INK_SOFT, WASH_SNOW_SHADE, 0.35));
    for (let k = 0; k < 3; k++) {
      const x = 1 + k * 2 + Math.floor(rnd() * 1.5);
      c.set(x, 1, INK_PINE[2]!);
      if (rnd() < 0.6) c.set(x, 0, INK_PINE[3]!);
    }
    return c.sprite(Math.floor(w / 2), 2, false);
  });
}

export function mapDune(variant: number): Sprite {
  return memo(`d${variant}`, () => {
    const rnd = rng(36000 + variant);
    const w = 7 + Math.floor(rnd() * 4);
    const c = new Canvas(w, 3);
    for (let x = 0; x < w; x++) {
      c.set(x, x < w * 0.45 ? 1 : x < w * 0.75 ? 0 : 1, INK_SOFT);
      if (x > w * 0.5 && x < w * 0.85) c.set(x, 2, blend(WASH_DESERT, PAPER_SHADE, 0.8));
    }
    return c.sprite(Math.floor(w / 2), 2, false);
  });
}

/** Tufo de capim a pena (campos e tundra). */
export function mapTuft(variant: number): Sprite {
  return memo(`g${variant}`, () => {
    const c = new Canvas(5, 3);
    const col = variant % 2 ? INK_PINE[3]! : INK_SOFT;
    c.set(1, 2, col);
    c.set(2, 1, col);
    c.set(2, 2, col);
    c.set(3, 2, col);
    if (variant % 3 === 0) c.set(0, 1, col);
    return c.sprite(2, 2, false);
  });
}
