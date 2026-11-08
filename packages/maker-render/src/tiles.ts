// SPDX-License-Identifier: MPL-2.0

/**
 * Esquema de ladrilhos do estilo pixel. Um "pixel de arte" no zoom z cobre 2^z metros.
 * O ladrilho (z, tx, ty) de lado `size` cobre x ∈ [tx·size·2^z, (tx+1)·size·2^z) e o mesmo em y
 * (y para o sul). Os ladrilhos ficam alinhados ao mundo (norte para cima).
 */

import { MAX_LEVEL, spacing } from '@ekfrase/maker-core';

export const TILE_SIZE = 128;
export const MIN_ZOOM = -6;
export const MAX_ZOOM = 30;

export interface TileKey {
  readonly z: number;
  readonly tx: number;
  readonly ty: number;
}

/** Metros por pixel de arte no zoom z (potência de 2 exata). */
export function metersPerPixel(z: number): number {
  let m = 1;
  if (z >= 0) for (let i = 0; i < z; i++) m *= 2;
  else for (let i = 0; i < -z; i++) m /= 2;
  return m;
}

export function tileKey(t: TileKey): string {
  return `${t.z}/${t.tx}/${t.ty}`;
}

export function tileBounds(t: TileKey, size = TILE_SIZE): { x0: number; y0: number; x1: number; y1: number } {
  const span = size * metersPerPixel(t.z);
  return { x0: t.tx * span, y0: t.ty * span, x1: (t.tx + 1) * span, y1: (t.ty + 1) * span };
}

/**
 * Zoom de ladrilho para uma escala da tela (pixels CSS por metro): o pixel de arte fica com
 * entre `targetPx` e 2·`targetPx` pixels de tela.
 */
export function zoomForScale(scale: number, targetPx: number): number {
  let z = 0;
  let px = scale; // pixels de tela por pixel de arte em z = 0
  while (px < targetPx && z < MAX_ZOOM) {
    px *= 2;
    z++;
  }
  while (px >= 2 * targetPx && z > MIN_ZOOM) {
    px /= 2;
    z--;
  }
  return z;
}

/** Nível hexagonal cujo detalhe combina com o pixel de arte: o mais grosso com espaçamento ≤ pixel. */
export function sampleLevelFor(z: number, s0M: number): number {
  const m = metersPerPixel(z);
  let level = 0;
  while (level < MAX_LEVEL && spacing(level + 1, s0M) <= m) level++;
  return level;
}
