// SPDX-License-Identifier: MPL-2.0

import type { Cell, Point } from '@ekfrase/maker-core';

/** Biomas da v1 (especificação §4, passo 3). A tabela que os escolhe é do gerador e troca por plugin. */
export type BiomeId = 'ocean' | 'tundra' | 'desert' | 'plain' | 'forest' | 'swamp';

export const BIOMES: readonly BiomeId[] = Object.freeze(['ocean', 'tundra', 'desert', 'plain', 'forest', 'swamp']);

/** O que o gerador precisa do documento (`world` da §5), sem depender do pacote do documento. */
export interface WorldInput {
  readonly seed: string;
  readonly extentKm: { readonly ns: number; readonly ew: number };
  readonly s0M: number;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface TerrainSample {
  /** Altitude em metros (negativa no mar). */
  readonly elevationM: number;
  readonly temperatureC: number;
  /** Umidade de 0 a 1. */
  readonly moisture: number;
  readonly water: boolean;
  readonly biome: BiomeId;
}

export interface WorldSampler {
  readonly generator: string;
  /** Amostra no ponto do mundo (metros, y para o sul) com o detalhe do nível L. */
  sample(p: Point, level: number): TerrainSample;
  /** Amostra no centro da célula, com o detalhe do nível dela (§4, refinamento por zoom). */
  sampleCell(c: Cell): TerrainSample;
}

export interface TerrainGenerator {
  readonly id: string;
  /** Congelada: um gerador publicado nunca muda (porta aberta 3). */
  readonly version: string;
  readonly biomes: readonly BiomeId[];
  readonly defaults: Readonly<Record<string, number>>;
  create(world: WorldInput): WorldSampler;
}
