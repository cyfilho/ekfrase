// SPDX-License-Identifier: MPL-2.0

import { MAX_LEVEL, cell, cellCenter, children, parent, spacing } from '@ekfrase/maker-core';
import { describe, expect, it } from 'vitest';
import { basic_1_0_0 } from '../src';
import { octaveTableForTests } from '../src/basic-1.0.0';

const WORLD = { seed: 'consistencia', extentKm: { ns: 1200, ew: 1600 }, s0M: 1, params: {} };
const sampler = basic_1_0_0.create(WORLD);
const table = octaveTableForTests(WORLD);

/** Soma das amplitudes das oitavas que o nível L usa e o nível L+1 não (o "detalhe novo"). */
function newDetail(level: number): number {
  let sum = 0;
  for (let k = table.counts[level + 1]!; k < table.counts[level]!; k++) sum += table.amplitudes[k]!;
  return sum;
}

describe('refinamento por zoom (§4)', () => {
  it('cada nível mais fino usa as oitavas do nível de cima e mais algumas, nunca menos', () => {
    for (let l = 0; l < MAX_LEVEL; l++) expect(table.counts[l]!).toBeGreaterThanOrEqual(table.counts[l + 1]!);
    expect(table.counts[0]!).toBeGreaterThan(table.counts[12]!);
  });

  it('a oitava mais fina de cada nível tem comprimento de onda ≥ 2 × o espaçamento do nível', () => {
    const wavelength0 = 1600e3;
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const n = table.counts[l]!;
      if (n > 0) expect(wavelength0 / 2 ** (n - 1)).toBeGreaterThanOrEqual(2 * spacing(l) * (1 - 1e-12));
    }
  });

  it('o valor no centro do pai ≈ valor no filho 0, diferindo só pelo detalhe novo', () => {
    let checked = 0;
    for (let l = 1; l < 14; l++) {
      for (const [q, r] of [[0, 0], [3, -2], [-5, 4], [7, 7], [-11, 2]] as const) {
        const p = cell(l, q, r);
        const c0 = children(p)[0]!;
        expect(cellCenter(c0)).toEqual(cellCenter(p)); // mesmo ponto do mundo
        const coarse = sampler.sampleCell(p);
        const fine = sampler.sampleCell(c0);
        const bound = newDetail(l - 1);
        if (bound === 0) expect(fine).toEqual(coarse);
        // Temperatura = ... − 6,5 °C/km × altitude + 4 × ruído: a diferença fica limitada ao detalhe novo
        // do ruído de temperatura (mesma tabela de oitavas) mais o efeito da diferença de altitude.
        const dElev = Math.abs(fine.elevationM - coarse.elevationM);
        const dTemp = Math.abs(fine.temperatureC - coarse.temperatureC);
        expect(dTemp).toBeLessThanOrEqual(4 * bound + (6.5 * dElev) / 1000 + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('feições grossas não mudam ao aproximar: terra ou mar quase nunca troca', () => {
    let disagreements = 0;
    let total = 0;
    for (let l = 1; l <= 10; l++) {
      const step = Math.max(1, Math.floor(40 / l));
      for (let q = -40; q <= 40; q += step) {
        for (let r = -30; r <= 30; r += step) {
          const p = cell(l, q, r);
          total++;
          if (sampler.sampleCell(p).water !== sampler.sampleCell(children(p)[0]!).water) disagreements++;
        }
      }
    }
    expect(disagreements / total).toBeLessThan(0.02);
  });

  it('o pai e o filho 0 quase sempre têm o mesmo bioma nos níveis grossos', () => {
    let same = 0;
    let total = 0;
    for (let l = 6; l <= 12; l++) {
      for (let q = -6; q <= 6; q++) {
        for (let r = -6; r <= 6; r++) {
          const p = cell(l, q, r);
          total++;
          if (sampler.sampleCell(p).biome === sampler.sampleCell(children(p)[0]!).biome) same++;
        }
      }
    }
    expect(same / total).toBeGreaterThan(0.9);
  });

  it('continuidade: pontos vizinhos têm valores próximos', () => {
    for (let i = 0; i < 200; i++) {
      const x = ((i * 7919) % 1_000_000) - 500_000;
      const y = ((i * 104729) % 800_000) - 400_000;
      const a = sampler.sample({ x, y }, 4);
      const b = sampler.sample({ x: x + 0.01, y: y - 0.01 }, 4);
      expect(Math.abs(a.temperatureC - b.temperatureC)).toBeLessThan(0.01);
      expect(Math.abs(a.moisture - b.moisture)).toBeLessThan(0.01);
    }
  });

  it('amostrar a célula é o mesmo que amostrar o centro dela com o nível dela', () => {
    const c = parent(cell(3, 120, -77));
    expect(sampler.sampleCell(c)).toEqual(sampler.sample(cellCenter(c), c.level));
  });
});
