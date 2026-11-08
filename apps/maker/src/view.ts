// SPDX-License-Identifier: MPL-2.0

/**
 * Câmera da visualização. É só apresentação (não é geração), então pode usar
 * Math.cos/sin/log: nada daqui entra no documento nem afeta o mapa.
 */

import { MAX_LEVEL, cell, cellCenter, spacing, type Point } from '@ekfrase/maker-core';

export interface Camera {
  /** Centro da tela no mundo, em metros. */
  readonly cx: number;
  readonly cy: number;
  /** Pixels (CSS) por metro. */
  readonly scale: number;
  /** Giro da vista em radianos (0 = norte para cima). */
  readonly rotation: number;
}

/** Faixa de tamanho, em pixels, do espaçamento do nível ativo: [MIN, MIN·√7]. */
export const ACTIVE_MIN_PX = 70;
export const ACTIVE_TARGET_PX = 114;

export const MIN_SCALE = ACTIVE_MIN_PX / spacing(MAX_LEVEL);
export const MAX_SCALE = 600;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Nível mais fino cujo espaçamento ainda ocupa pelo menos ACTIVE_MIN_PX na tela. */
export function activeLevel(scale: number): number {
  for (let l = 0; l < MAX_LEVEL; l++) if (spacing(l) * scale >= ACTIVE_MIN_PX * 0.9999) return l;
  return MAX_LEVEL;
}

export function scaleForLevel(level: number): number {
  return ACTIVE_TARGET_PX / spacing(level);
}

/** Ângulo da grade do nível na tela (sentido horário, com y para baixo). */
export function levelRotation(level: number): number {
  const east = cellCenter(cell(level, 1, 0));
  return Math.atan2(east.y, east.x);
}

export function worldToScreen(cam: Camera, w: number, h: number, p: Point): Point {
  const dx = p.x - cam.cx;
  const dy = p.y - cam.cy;
  const c = Math.cos(cam.rotation);
  const s = Math.sin(cam.rotation);
  return { x: w / 2 + (dx * c + dy * s) * cam.scale, y: h / 2 + (dy * c - dx * s) * cam.scale };
}

export function screenToWorld(cam: Camera, w: number, h: number, p: Point): Point {
  const x = (p.x - w / 2) / cam.scale;
  const y = (p.y - h / 2) / cam.scale;
  const c = Math.cos(cam.rotation);
  const s = Math.sin(cam.rotation);
  return { x: cam.cx + x * c - y * s, y: cam.cy + x * s + y * c };
}

/** Zoom mantendo fixo o ponto da tela `anchor`. */
export function zoomAt(cam: Camera, w: number, h: number, anchor: Point, factor: number): Camera {
  const before = screenToWorld(cam, w, h, anchor);
  const scaled = { ...cam, scale: clampScale(cam.scale * factor) };
  const after = screenToWorld(scaled, w, h, anchor);
  return { ...scaled, cx: cam.cx + before.x - after.x, cy: cam.cy + before.y - after.y };
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  const c = Math.cos(cam.rotation);
  const s = Math.sin(cam.rotation);
  const x = dxScreen / cam.scale;
  const y = dyScreen / cam.scale;
  return { ...cam, cx: cam.cx - (x * c - y * s), cy: cam.cy - (x * s + y * c) };
}

/** Interpolação suave entre duas câmeras (zoom em escala logarítmica, giro pelo menor caminho). */
export function lerpCamera(a: Camera, b: Camera, k: number): Camera {
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  const logScale = Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * e;
  let dr = b.rotation - a.rotation;
  while (dr > Math.PI) dr -= 2 * Math.PI;
  while (dr < -Math.PI) dr += 2 * Math.PI;
  return {
    cx: a.cx + (b.cx - a.cx) * e,
    cy: a.cy + (b.cy - a.cy) * e,
    scale: Math.exp(logScale),
    rotation: a.rotation + dr * e,
  };
}
