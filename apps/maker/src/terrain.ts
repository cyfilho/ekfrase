// SPDX-License-Identifier: MPL-2.0

/**
 * Liga o mundo do documento ao gerador: recria o amostrador quando semente, extensão ou gerador
 * mudam, e guarda as amostras já calculadas (a geração é uma função pura, então o cache é seguro).
 */

import { cellKey, type Cell } from '@ekfrase/maker-core';
import type { World } from '@ekfrase/maker-doc';
import { GenError, samplerFor, type TerrainSample, type WorldSampler } from '@ekfrase/maker-gen';

const CACHE_LIMIT = 250_000;

export class TerrainView {
  private key = '';
  private sampler: WorldSampler | null = null;
  private failure: GenError | null = null;
  private readonly cache = new Map<string, TerrainSample>();

  /** Atualiza o amostrador se o mundo mudou. Devolve true quando mudou. */
  update(world: World): boolean {
    const key = JSON.stringify(world);
    if (key === this.key) return false;
    this.key = key;
    this.cache.clear();
    this.failure = null;
    try {
      this.sampler = samplerFor(world.generator, {
        seed: world.seed,
        extentKm: world.extentKm,
        s0M: world.s0M,
        params: world.generator.params,
      });
    } catch (e) {
      if (!(e instanceof GenError)) throw e;
      this.sampler = null;
      this.failure = e;
    }
    return true;
  }

  get available(): boolean {
    return this.sampler !== null;
  }

  get error(): GenError | null {
    return this.failure;
  }

  sample(c: Cell): TerrainSample | undefined {
    if (!this.sampler) return undefined;
    const k = cellKey(c);
    let s = this.cache.get(k);
    if (!s) {
      if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
      s = this.sampler.sampleCell(c);
      this.cache.set(k, s);
    }
    return s;
  }
}
