// SPDX-License-Identifier: MPL-2.0

/**
 * Catálogo de pincéis (DEC-048). Cada pincel pinta uma camada das células da grade no nível ativo:
 * de longe as células são grandes (regiões inteiras), de perto são pequenas (detalhes). A pintura
 * vale para a célula e toda a descendência (§4); a mais fina vence.
 * `maxLevel` limita pincéis que só fazem sentido de perto (ex.: construções).
 * Pincel novo = uma entrada aqui + o desenho correspondente em `@ekfrase/maker-render`.
 */

import { BIOMES, type BiomeId } from '@ekfrase/maker-gen';
import type { PaintEdit, PaintProp, ReliefEdit, ReliefKind } from '@ekfrase/maker-render';
import { BIOME_KEYS } from './i18n';

/** Camada que o pincel pinta; `relief` vira elevação somável (montanha, colina). */
export type BrushLayer = PaintProp | 'relief';

export interface Brush {
  readonly id: string;
  readonly layer: BrushLayer;
  readonly value: string;
  /** Chave de tradução do nome (dica completa) e, se houver, do nome curto mostrado no botão. */
  readonly nameKey: string;
  readonly shortKey?: string;
  readonly group: 'biome' | 'vegetation' | 'relief' | 'building';
  /** Nível mais grosso em que o pincel funciona (células maiores não fazem sentido). */
  readonly maxLevel?: number;
  /** Cor de fundo do botão (variável CSS) ou ícone. */
  readonly swatch: string;
  readonly icon?: string;
}

const ICON_TREE = 'M12 3c3.5 0 6 2.6 6 5.6 0 2.8-2.2 4.9-5 5.2V20h-2v-6.2c-2.8-.3-5-2.4-5-5.2C6 5.6 8.5 3 12 3z';
const ICON_CONIFER = 'M12 2l5 7h-2.5l4 6H14v5h-4v-5H5.5l4-6H7z';
const ICON_MOUNTAIN = 'M2 20l7-12 3 5 3-4 7 11z';
const ICON_HILL = 'M2 19c3-6 6-8 10-8s7 2 10 8z';
const ICON_HOUSE = 'M4 11l8-7 8 7v9h-5v-5h-6v5H4z';

export const BRUSHES: readonly Brush[] = Object.freeze([
  ...BIOMES.map(
    (b): Brush => ({ id: `biome:${b}`, layer: 'biome', value: b, nameKey: BIOME_KEYS[b as BiomeId], group: 'biome', swatch: `var(--biome-${b})` }),
  ),
  { id: 'trees:broadleaf', layer: 'trees', value: 'broadleaf', nameKey: 'brush.broadleaf', group: 'vegetation', swatch: 'var(--biome-forest)', icon: ICON_TREE },
  { id: 'trees:conifer', layer: 'trees', value: 'conifer', nameKey: 'brush.conifer', group: 'vegetation', swatch: 'var(--biome-swamp)', icon: ICON_CONIFER },
  { id: 'relief:mountain', layer: 'relief', value: 'mountain', nameKey: 'brush.mountain', shortKey: 'brush.mountainShort', group: 'relief', swatch: 'var(--biome-tundra)', icon: ICON_MOUNTAIN },
  { id: 'relief:hill', layer: 'relief', value: 'hill', nameKey: 'brush.hill', group: 'relief', swatch: 'var(--biome-plain)', icon: ICON_HILL },
  { id: 'building:house', layer: 'building', value: 'house', nameKey: 'brush.house', shortKey: 'brush.houseShort', group: 'building', maxLevel: 5, swatch: 'var(--biome-desert)', icon: ICON_HOUSE },
]);

export function brushAvailable(b: Brush, level: number): boolean {
  return b.maxLevel === undefined || level <= b.maxLevel;
}

/** Valores válidos por camada (o documento aceita qualquer texto; o desenho só entende estes). */
const VALID: Readonly<Record<BrushLayer, readonly string[]>> = {
  biome: BIOMES,
  trees: ['broadleaf', 'conifer'],
  building: ['house'],
  relief: ['mountain', 'hill'],
};

/** Lê as camadas pintadas do documento no formato que o desenho entende. */
export function layersOf(editsOf: (prop: string) => { cell: { level: number; q: number; r: number }; value: unknown }[]): {
  paint: PaintEdit[];
  relief: ReliefEdit[];
} {
  const paint: PaintEdit[] = [];
  for (const prop of ['biome', 'trees', 'building'] as const) {
    for (const { cell: c, value } of editsOf(prop)) {
      if (typeof value === 'string' && VALID[prop].includes(value)) paint.push({ level: c.level, q: c.q, r: c.r, prop, value });
    }
  }
  const relief: ReliefEdit[] = [];
  for (const { cell: c, value } of editsOf('relief')) {
    if (typeof value === 'string' && VALID.relief.includes(value)) relief.push({ level: c.level, q: c.q, r: c.r, kind: value as ReliefKind });
  }
  return { paint, relief };
}
