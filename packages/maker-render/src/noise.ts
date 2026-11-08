// SPDX-License-Identifier: MPL-2.0

/**
 * Ruído na escala do pixel de arte, ancorado no índice global do pixel: a textura fica parada
 * quando o mapa se move e é igual dos dois lados da borda de um ladrilho.
 * (Visual, não geração: pode mudar entre versões do estilo sem afetar mapas salvos.)
 */

import { hash3 } from '@ekfrase/maker-gen';

const INV = 1 / 4294967296;

/** Valor em [0, 1) para o pixel (x, y) com um "sal". */
export function hashPx(x: number, y: number, salt: number): number {
  return hash3(x, y, salt) * INV;
}

/** Ruído de valor suave em [0, 1) com células de `cell` pixels. */
export function smoothPx(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hashPx(ix, iy, salt);
  const b = hashPx(ix + 1, iy, salt);
  const c = hashPx(ix, iy + 1, salt);
  const d = hashPx(ix + 1, iy + 1, salt);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sy;
}

/** Gerador pseudoaleatório determinista (para desenhar os carimbos). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  let n = 0;
  return () => {
    s = hash3(s, n++, 0x5bd1e995);
    return s * INV;
  };
}

/** 16 direções de gradiente (cos, sin), sem funções transcendentais na hora de usar. */
const GRAD: readonly number[] = Object.freeze(
  Array.from({ length: 32 }, (_, i) => {
    const a = (Math.floor(i / 2) / 16) * 2 * Math.PI;
    return i % 2 === 0 ? Math.cos(a) : Math.sin(a);
  }),
);

/**
 * Ruído de gradiente (tipo Perlin) em [0, 1), células de `cell` unidades. Sem os vincos alinhados
 * à grade do ruído de valor: bom para cristas e relevo sombreado.
 */
export function gradPx(x: number, y: number, cell: number, salt: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const dot = (i: number, j: number, dx: number, dy: number): number => {
    const g = (hash3(i, j, salt) >>> 28) * 2;
    return GRAD[g]! * dx + GRAD[g + 1]! * dy;
  };
  const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  const a = dot(ix, iy, tx, ty);
  const b = dot(ix + 1, iy, tx - 1, ty);
  const c = dot(ix, iy + 1, tx, ty - 1);
  const d = dot(ix + 1, iy + 1, tx - 1, ty - 1);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return clamp01(0.5 + (ab + (cd - ab) * sy) * 0.85);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 0.9999 ? 0.9999 : v;
}
