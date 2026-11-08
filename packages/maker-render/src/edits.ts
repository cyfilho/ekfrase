// SPDX-License-Identifier: MPL-2.0

/**
 * Camadas pintadas à mão com os pincéis (DEC-048).
 *
 * Pintura (bioma, árvores, construções): uma edição na célula de nível L vale para toda a
 * descendência (§4). O pixel pertence à célula se o seu ancestral naquele nível for ela — o pai
 * "de verdade", de contorno irregular —, e a edição mais fina vence a do ancestral.
 *
 * Relevo (montanha, colina): cada célula pintada vira uma elevação suave centrada nela, com altura
 * proporcional ao tamanho da célula. As elevações se SOMAM:
 * com raio de 1,25 × o espaçamento do nível, células vizinhas formam uma cordilheira contínua; um bloco de quatro ou mais soma no meio e vira
 * uma montanha maior. Pintar de longe faz serras de quilômetros; de perto, morros de dezenas de metros.
 */

import { MAX_LEVEL, cellAt, cellCenter, cellKey, parent, spacing, type Cell, type Point } from '@ekfrase/maker-core';
import type { BiomeId } from '@ekfrase/maker-gen';

export type PaintProp = 'biome' | 'trees' | 'building';
export type TreeKind = 'broadleaf' | 'conifer';
export type ReliefKind = 'mountain' | 'hill';

export interface PaintEdit {
  readonly level: number;
  readonly q: number;
  readonly r: number;
  readonly prop: PaintProp;
  readonly value: string;
}

export interface ReliefEdit {
  readonly level: number;
  readonly q: number;
  readonly r: number;
  readonly kind: ReliefKind;
}

export interface Painted {
  biome?: BiomeId;
  trees?: TreeKind;
  building?: string;
}

export interface Bump {
  readonly x: number;
  readonly y: number;
  /** Raio de influência (m). */
  readonly radius: number;
  /** Altura no centro (m). */
  readonly height: number;
  readonly kind: ReliefKind;
  /** Quantas elevações do mesmo tipo encostam nesta (para o símbolo crescer num maciço). */
  neighbors: number;
}

export interface ReliefAt {
  /** Altura somada (m). */
  readonly h: number;
  /** Amplitude extra de cristas e ravinas (m). */
  readonly rugged: number;
}

export interface BoxLookup {
  readonly paint: ((p: Point) => Painted | null) | null;
  readonly relief: ((p: Point) => ReliefAt) | null;
  readonly bumps: readonly Bump[];
}

/** Folga do contorno irregular além do centro (o pai "de verdade" passa um pouco do hexágono). */
const REACH = 0.85;

/** Altura de uma elevação pintada no nível com espaçamento `s` (m). */
export function bumpHeight(kind: ReliefKind, s: number): number {
  return kind === 'mountain' ? Math.min(3400, Math.max(25, s * 0.32)) : Math.min(700, Math.max(6, s * 0.09));
}

export class EditIndex {
  private readonly paints: { edit: PaintEdit; x: number; y: number; reach: number }[];
  private readonly bumpsAll: Bump[];

  constructor(
    paint: readonly PaintEdit[],
    relief: readonly ReliefEdit[],
    private readonly s0M: number,
  ) {
    this.paints = paint.map((edit) => {
      const c = cellCenter(edit as Cell, s0M);
      return { edit, x: c.x, y: c.y, reach: spacing(edit.level, s0M) * REACH };
    });
    this.bumpsAll = relief.map((e) => {
      const c = cellCenter(e as Cell, s0M);
      const s = spacing(e.level, s0M);
      return { x: c.x, y: c.y, radius: s * 1.25, height: bumpHeight(e.kind, s), kind: e.kind, neighbors: 0 };
    });
    for (const a of this.bumpsAll) {
      for (const b of this.bumpsAll) {
        if (a !== b && a.kind === b.kind && Math.hypot(a.x - b.x, a.y - b.y) < Math.max(a.radius, b.radius)) a.neighbors++;
      }
    }
  }

  get size(): number {
    return this.paints.length + this.bumpsAll.length;
  }

  /** Busca só com as edições que podem tocar a caixa. */
  forBox(x0: number, y0: number, x1: number, y1: number, startLevel: number): BoxLookup {
    return { paint: this.paintFor(x0, y0, x1, y1, startLevel), ...this.reliefFor(x0, y0, x1, y1) };
  }

  private paintFor(x0: number, y0: number, x1: number, y1: number, startLevel: number): BoxLookup['paint'] {
    const keys = new Map<string, Map<PaintProp, string>>();
    const levels = new Set<number>();
    let minLevel = MAX_LEVEL;
    let maxLevel = 0;
    for (const it of this.paints) {
      if (it.x + it.reach < x0 || it.x - it.reach > x1 || it.y + it.reach < y0 || it.y - it.reach > y1) continue;
      const key = cellKey(it.edit as Cell);
      let props = keys.get(key);
      if (!props) keys.set(key, (props = new Map()));
      props.set(it.edit.prop, it.edit.value);
      levels.add(it.edit.level);
      if (it.edit.level < minLevel) minLevel = it.edit.level;
      if (it.edit.level > maxLevel) maxLevel = it.edit.level;
    }
    if (keys.size === 0) return null;
    const base = Math.min(startLevel, minLevel);
    const s0 = this.s0M;
    return (p) => {
      let c = cellAt(base, p, s0);
      let out: Painted | null = null;
      for (;;) {
        if (levels.has(c.level)) {
          const props = keys.get(cellKey(c));
          if (props) {
            // a mais fina vence: só preenche o que ainda não foi definido por um descendente
            out ??= {};
            if (out.biome === undefined && props.has('biome')) out.biome = props.get('biome') as BiomeId;
            if (out.trees === undefined && props.has('trees')) out.trees = props.get('trees') as TreeKind;
            if (out.building === undefined && props.has('building')) out.building = props.get('building')!;
          }
        }
        if (c.level >= maxLevel) return out;
        c = parent(c);
      }
    };
  }

  private reliefFor(x0: number, y0: number, x1: number, y1: number): Pick<BoxLookup, 'relief' | 'bumps'> {
    const bumps = this.bumpsAll.filter((b) => b.x + b.radius >= x0 && b.x - b.radius <= x1 && b.y + b.radius >= y0 && b.y - b.radius <= y1);
    if (bumps.length === 0) return { relief: null, bumps };
    return {
      bumps,
      relief: (p) => {
        let h = 0;
        let rugged = 0;
        for (const b of bumps) {
          const dx = p.x - b.x;
          const dy = p.y - b.y;
          const t2 = (dx * dx + dy * dy) / (b.radius * b.radius);
          if (t2 >= 1) continue;
          const f = (1 - t2) * (1 - t2);
          h += b.height * f;
          rugged += b.height * f * (b.kind === 'mountain' ? 0.5 : 0.12);
        }
        return { h, rugged };
      },
    };
  }
}
