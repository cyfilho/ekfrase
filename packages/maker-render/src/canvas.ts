// SPDX-License-Identifier: MPL-2.0

/** Tela de pixels usada para desenhar os carimbos procedurais. */

import type { Ramp } from './color';

export interface Sprite {
  readonly w: number;
  readonly h: number;
  /** Âncora (pé do carimbo) dentro do sprite. */
  readonly ax: number;
  readonly ay: number;
  /** Cor de cada pixel, ou −1 se transparente. */
  readonly px: Int32Array;
  /** Projeta sombra no chão (para sudeste). */
  readonly shadow: boolean;
}

export const EMPTY = -1;

export class Canvas {
  readonly px: Int32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Int32Array(w * h).fill(EMPTY);
  }
  get(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.w || y >= this.h ? EMPTY : this.px[y * this.w + x]!;
  }
  set(x: number, y: number, c: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  /** Pixel opaco com algum vizinho (4 direções) transparente. */
  edge(x: number, y: number): boolean {
    return this.get(x - 1, y) === EMPTY || this.get(x + 1, y) === EMPTY || this.get(x, y - 1) === EMPTY || this.get(x, y + 1) === EMPTY;
  }
  sprite(ax: number, ay: number, shadow: boolean): Sprite {
    return Object.freeze({ w: this.w, h: this.h, ax, ay, px: this.px, shadow });
  }
}

export function clampIndex(r: Ramp, t: number): number {
  const i = Math.round(t);
  return r[i < 0 ? 0 : i >= r.length ? r.length - 1 : i]!;
}

