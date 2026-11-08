// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { BIOMES, DEFAULT_GENERATOR, GenError, basic_1_0_0, findGenerator, samplerFor, type BiomeId } from '../src';

const world = (seed: string, params: Record<string, unknown> = {}) => ({
  seed,
  extentKm: { ns: 1200, ew: 1600 },
  s0M: 1,
  params,
});

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof GenError ? e.code : `not-gen-error: ${String(e)}`;
  }
  return undefined;
}

function survey(seed: string, params: Record<string, unknown> = {}) {
  const s = basic_1_0_0.create(world(seed, params));
  const counts = new Map<BiomeId, number>();
  let land = 0;
  let n = 0;
  for (let i = 0; i < 40; i++) {
    for (let j = 0; j < 30; j++) {
      const t = s.sample({ x: (i / 39 - 0.5) * 1600e3, y: (j / 29 - 0.5) * 1200e3 }, 8);
      counts.set(t.biome, (counts.get(t.biome) ?? 0) + 1);
      if (!t.water) land++;
      n++;
    }
  }
  return { counts, landFraction: land / n };
}

describe('mundo gerado', () => {
  it('cada semente dá um continente: parte terra, parte mar, dentro da extensão', () => {
    for (const seed of ['ekfrase', 'serra do mar', 'abc123', 'zzz', '', 'Açaí 🌊']) {
      const { landFraction } = survey(seed);
      expect(landFraction, seed).toBeGreaterThan(0.2);
      expect(landFraction, seed).toBeLessThan(0.9);
    }
  });

  it('fora da extensão do mundo é mar', () => {
    const s = basic_1_0_0.create(world('ekfrase'));
    for (const [x, y] of [[1200e3, 0], [-1200e3, 0], [0, 900e3], [0, -900e3], [5e6, 5e6]] as const) {
      expect(s.sample({ x, y }, 8).water).toBe(true);
    }
  });

  it('todos os biomas aparecem em alguma semente', () => {
    const seen = new Set<BiomeId>();
    for (const seed of ['ekfrase', 'serra do mar', 'abc123', 'zzz', 'norte', 'sul', 'leste']) {
      for (const b of survey(seed).counts.keys()) seen.add(b);
    }
    expect([...seen].sort()).toEqual([...BIOMES].sort());
  });

  it('mais ao norte é mais frio', () => {
    const s = basic_1_0_0.create(world('frio', { latitudeNorthDeg: 70, latitudeSouthDeg: 10 }));
    let north = 0;
    let south = 0;
    for (let i = 0; i < 50; i++) {
      const x = (i / 49 - 0.5) * 1000e3;
      north += s.sample({ x, y: -550e3 }, 8).temperatureC;
      south += s.sample({ x, y: 550e3 }, 8).temperatureC;
    }
    expect(north).toBeLessThan(south);
  });

  it('o nível do mar muda a proporção de terra', () => {
    expect(survey('ekfrase', { seaLevel: 0.4 }).landFraction).toBeGreaterThan(
      survey('ekfrase', { seaLevel: 0.7 }).landFraction,
    );
  });

  it('altitude: negativa no mar, positiva em terra, dentro dos limites', () => {
    const s = basic_1_0_0.create(world('limites', { maxElevationM: 3000, maxDepthM: 2000 }));
    for (let i = 0; i < 400; i++) {
      const t = s.sample({ x: ((i * 37) % 200) * 8e3 - 800e3, y: ((i * 53) % 150) * 8e3 - 600e3 }, 6);
      if (t.water) expect(t.elevationM).toBeLessThanOrEqual(0);
      else expect(t.elevationM).toBeGreaterThanOrEqual(0);
      expect(t.elevationM).toBeGreaterThanOrEqual(-2000);
      expect(t.elevationM).toBeLessThanOrEqual(3000);
      expect(t.moisture).toBeGreaterThanOrEqual(0);
      expect(t.moisture).toBeLessThanOrEqual(1);
      expect(t.biome === 'ocean').toBe(t.water);
    }
  });
});

describe('registro e parâmetros', () => {
  it('o gerador padrão é basic@1.0.0 e é encontrado pelo id e versão', () => {
    expect(DEFAULT_GENERATOR.id).toBe('org.ekfrase.generator.basic');
    expect(DEFAULT_GENERATOR.version).toBe('1.0.0');
    expect(findGenerator('org.ekfrase.generator.basic', '1.0.0')).toBe(basic_1_0_0);
    expect(findGenerator('org.ekfrase.generator.basic', '9.9.9')).toBeUndefined();
  });

  it('"sem gerador" não amostra; gerador desconhecido é erro', () => {
    expect(samplerFor({ id: 'org.ekfrase.generator.none', version: '0.0.0' }, world('x'))).toBeNull();
    expect(code(() => samplerFor({ id: 'org.outro', version: '1.0.0' }, world('x')))).toBe('unknown-generator');
  });

  it('parâmetros desconhecidos ou fora da faixa são recusados', () => {
    expect(code(() => basic_1_0_0.create(world('x', { mar: 1 })))).toBe('invalid-parameter');
    expect(code(() => basic_1_0_0.create(world('x', { seaLevel: 2 })))).toBe('invalid-parameter');
    expect(code(() => basic_1_0_0.create(world('x', { seaLevel: '0.5' })))).toBe('invalid-parameter');
    expect(code(() => basic_1_0_0.create({ ...world('x'), extentKm: { ns: 0, ew: 10 } }))).toBe('invalid-world');
    expect(code(() => basic_1_0_0.create(world('x')).sample({ x: 0, y: 0 }, 21))).toBe('invalid-parameter');
  });
});
