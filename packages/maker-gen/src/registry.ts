// SPDX-License-Identifier: MPL-2.0

/**
 * Geradores conhecidos, por id e versão. O app mantém todas as versões publicadas para que
 * um mapa salvo com `gerador@versão` sempre abra igual (porta aberta 3).
 */

import { basic_1_0_0 } from './basic-1.0.0';
import { GenError } from './errors';
import type { TerrainGenerator, WorldInput, WorldSampler } from './types';

export const GENERATORS: readonly TerrainGenerator[] = Object.freeze([basic_1_0_0]);

/** Gerador padrão para mundos novos. */
export const DEFAULT_GENERATOR = basic_1_0_0;

/** "Sem gerador" (documentos da Fase 2): o mapa fica só com a grade. */
export const NO_GENERATOR_ID = 'org.ekfrase.generator.none';

export function findGenerator(id: string, version: string): TerrainGenerator | undefined {
  return GENERATORS.find((g) => g.id === id && g.version === version);
}

/** Cria o amostrador do mundo; `null` para "sem gerador"; erro para um gerador desconhecido. */
export function samplerFor(
  generator: { readonly id: string; readonly version: string },
  world: WorldInput,
): WorldSampler | null {
  if (generator.id === NO_GENERATOR_ID) return null;
  const g = findGenerator(generator.id, generator.version);
  if (!g) throw new GenError('unknown-generator');
  return g.create(world);
}
