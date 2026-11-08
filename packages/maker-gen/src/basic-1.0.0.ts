// SPDX-License-Identifier: MPL-2.0

/**
 * Gerador `org.ekfrase.generator.basic@1.0.0` (especificação §4, passos 1 a 3).
 *
 * CONGELADO (porta aberta 3, DEC-010): depois de publicado, este arquivo não muda nunca, nem para
 * "corrigir" algo — mapas já salvos dependem dele bit a bit. Algoritmo novo = arquivo novo com
 * versão nova (ex.: basic-1.1.0.ts) registrado ao lado deste em `registry.ts`.
 * Os testes em `test/golden.test.ts` gravam valores de referência e falham se o resultado mudar.
 *
 * Só + − × ÷, Math.floor/abs/imul e comparações (DEC-009); aleatoriedade por `hash3`.
 *
 * Campos:
 * - elevação: máscara de continente tirada da extensão (super-elipse) + ruído de valor fractal;
 * - temperatura: 28 − 0,006·lat² (lat entre `latitudeNorthDeg` e `latitudeSouthDeg`) − 6,5 °C/km de altitude + ruído;
 * - umidade: ruído + mais perto da costa − no interior do continente − um pouco nas alturas;
 * - altitude em metros: curva quadrática acima do nível do mar (terras baixas predominam).
 * Refinamento por zoom (§4): o nível L usa só as oitavas com comprimento de onda ≥ 2× o espaçamento
 * do nível; níveis mais finos acrescentam oitavas e nunca alteram as grossas.
 */

import { MAX_LEVEL, cellCenter, spacing, type Cell, type Point } from '@ekfrase/maker-core';
import { GenError } from './errors';
import { hash3, hashString, unit } from './hash';
import type { BiomeId, TerrainGenerator, TerrainSample, WorldInput, WorldSampler } from './types';

const ID = 'org.ekfrase.generator.basic';
const VERSION = '1.0.0';

const DEFAULTS = Object.freeze({
  seaLevel: 0.55,
  latitudeNorthDeg: 55,
  latitudeSouthDeg: 25,
  maxElevationM: 4500,
  maxDepthM: 4000,
});

type Params = { -readonly [K in keyof typeof DEFAULTS]: number };

const RANGES: Readonly<Record<keyof Params, readonly [number, number]>> = {
  seaLevel: [0.05, 0.95],
  latitudeNorthDeg: [-90, 90],
  latitudeSouthDeg: [-90, 90],
  maxElevationM: [100, 9000],
  maxDepthM: [100, 11000],
};

const FIELD_ELEVATION = 1;
const FIELD_TEMPERATURE = 2;
const FIELD_MOISTURE = 3;
const MAX_OCTAVES = 40;

/** Giro entre oitavas (cos, sen) = (0,8, 0,6): triângulo 3-4-5, sem trigonometria. */
const ROT_C = 0.8;
const ROT_S = 0.6;

interface Octave {
  readonly invWavelength: number;
  readonly amplitude: number;
  readonly c: number;
  readonly s: number;
  readonly ox: number;
  readonly oy: number;
  readonly salt: number;
}

function readParams(raw: Readonly<Record<string, unknown>>): Params {
  const p: Params = { ...DEFAULTS };
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in DEFAULTS)) throw new GenError('invalid-parameter');
    const range = RANGES[key as keyof Params];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < range[0] || value > range[1]) {
      throw new GenError('invalid-parameter');
    }
    p[key as keyof Params] = value;
  }
  return p;
}

function lattice(ix: number, iy: number, salt: number): number {
  return unit(hash3(ix, iy, salt)) * 2 - 1;
}

/** Ruído de valor em 2D, contínuo, em [−1, 1]; interpolação suave t²(3 − 2t). */
function valueNoise(x: number, y: number, salt: number): number {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = x - fx;
  const ty = y - fy;
  const ix = fx | 0;
  const iy = fy | 0;
  const a = lattice(ix, iy, salt);
  const b = lattice((ix + 1) | 0, iy, salt);
  const c = lattice(ix, (iy + 1) | 0, salt);
  const d = lattice((ix + 1) | 0, (iy + 1) | 0, salt);
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sy;
}

function makeOctaves(seed: number, field: number, wavelength0: number, s0: number): Octave[] {
  const out: Octave[] = [];
  let wavelength = wavelength0;
  let amplitude = 0.5;
  let c = 1;
  let s = 0;
  for (let k = 0; k < MAX_OCTAVES && wavelength >= 2 * s0; k++) {
    const salt = hash3(seed, field, k);
    out.push({
      invWavelength: 1 / wavelength,
      amplitude,
      c,
      s,
      ox: unit(hash3(salt, 1, 0)) * 1024,
      oy: unit(hash3(salt, 2, 0)) * 1024,
      salt,
    });
    wavelength = wavelength / 2;
    amplitude = amplitude / 2;
    const nc = c * ROT_C - s * ROT_S;
    s = s * ROT_C + c * ROT_S;
    c = nc;
  }
  return out;
}

/** Ruído fractal com as `count` primeiras oitavas; resultado em [−1, 1]. */
function fbm(octaves: readonly Octave[], count: number, x: number, y: number): number {
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const o = octaves[k]!;
    const rx = (o.c * x - o.s * y) * o.invWavelength + o.ox;
    const ry = (o.s * x + o.c * y) * o.invWavelength + o.oy;
    sum += o.amplitude * valueNoise(rx, ry, o.salt);
  }
  return sum;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Tabela temperatura × umidade (Whittaker simplificado). */
function biomeOf(water: boolean, temperatureC: number, moisture: number, elevationM: number): BiomeId {
  if (water) return 'ocean';
  if (temperatureC < -2) return 'tundra';
  if (moisture < 0.28) return temperatureC >= 16 ? 'desert' : 'plain';
  if (moisture > 0.74 && elevationM < 250 && temperatureC > 2) return 'swamp';
  if (moisture > 0.48) return 'forest';
  return 'plain';
}

function create(world: WorldInput): WorldSampler {
  const ns = world.extentKm?.ns;
  const ew = world.extentKm?.ew;
  const s0 = world.s0M;
  if (!(ns > 0) || !(ew > 0) || !(s0 > 0) || !Number.isFinite(ns + ew + s0) || typeof world.seed !== 'string') {
    throw new GenError('invalid-world');
  }
  const p = readParams(world.params ?? {});
  const nsM = ns * 1000;
  const ewM = ew * 1000;
  const halfNs = nsM / 2;
  const halfEw = ewM / 2;
  const seed = hashString(world.seed);
  const wavelength0 = nsM > ewM ? nsM : ewM;

  const elevation = makeOctaves(seed, FIELD_ELEVATION, wavelength0, s0);
  const temperature = makeOctaves(seed, FIELD_TEMPERATURE, wavelength0, s0);
  const moisture = makeOctaves(seed, FIELD_MOISTURE, wavelength0 / 2, s0);

  // Quantas oitavas cada nível usa: comprimento de onda ≥ 2 × espaçamento do nível.
  const countFor = (octaves: readonly Octave[]): number[] => {
    const table: number[] = [];
    for (let l = 0; l <= MAX_LEVEL; l++) {
      const limit = 2 * spacing(l, s0);
      let n = 0;
      while (n < octaves.length && 1 / octaves[n]!.invWavelength >= limit) n++;
      table.push(n);
    }
    return table;
  };
  const nElevation = countFor(elevation);
  const nTemperature = countFor(temperature);
  const nMoisture = countFor(moisture);

  const sample = (pt: Point, level: number): TerrainSample => {
    if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) throw new GenError('invalid-parameter');
    const x = pt.x;
    const y = pt.y;

    // Máscara de continente: 1 no centro, 0 no meio das bordas, negativa nos cantos e fora.
    const u = x / halfEw;
    const v = y / halfNs;
    const u2 = u * u;
    const v2 = v * v;
    const mask = 1 - (u2 * u2 + v2 * v2);
    const e = 0.36 + 0.38 * mask + 0.62 * fbm(elevation, nElevation[level]!, x, y);

    const water = e < p.seaLevel;
    const elevationM = water
      ? clamp(((e - p.seaLevel) / p.seaLevel) * p.maxDepthM, -p.maxDepthM, 0)
      : (() => {
          // Curva quadrática: predominam terras baixas; montanhas são raras.
          const t = clamp((e - p.seaLevel) / (1 - p.seaLevel), 0, 1);
          return t * t * p.maxElevationM;
        })();
    const land = elevationM > 0 ? elevationM : 0;

    const lat = p.latitudeNorthDeg + (y / nsM + 0.5) * (p.latitudeSouthDeg - p.latitudeNorthDeg);
    const temperatureC = 28 - 0.006 * lat * lat - (6.5 * land) / 1000 + 4 * fbm(temperature, nTemperature[level]!, x, y);

    const coast = water ? 0 : 1 - clamp((e - p.seaLevel) / 0.15, 0, 1);
    const m = clamp(
      0.58 + 0.8 * fbm(moisture, nMoisture[level]!, x, y) + 0.18 * coast - 0.3 * (mask > 0 ? mask : 0) - (0.12 * land) / p.maxElevationM,
      0,
      1,
    );

    return { elevationM, temperatureC, moisture: m, water, biome: biomeOf(water, temperatureC, m, elevationM) };
  };

  return {
    generator: `${ID}@${VERSION}`,
    sample,
    sampleCell: (c: Cell) => sample(cellCenter(c, s0), c.level),
  };
}

export const basic_1_0_0: TerrainGenerator = Object.freeze({
  id: ID,
  version: VERSION,
  biomes: Object.freeze(['ocean', 'tundra', 'desert', 'plain', 'forest', 'swamp'] as BiomeId[]),
  defaults: DEFAULTS,
  create,
});

/** Só para testes: quantas oitavas de elevação cada nível usa e a amplitude de cada uma. */
export function octaveTableForTests(world: WorldInput): { counts: number[]; amplitudes: number[] } {
  const nsM = world.extentKm.ns * 1000;
  const ewM = world.extentKm.ew * 1000;
  const octaves = makeOctaves(hashString(world.seed), FIELD_ELEVATION, nsM > ewM ? nsM : ewM, world.s0M);
  const counts: number[] = [];
  for (let l = 0; l <= MAX_LEVEL; l++) {
    const limit = 2 * spacing(l, world.s0M);
    let n = 0;
    while (n < octaves.length && 1 / octaves[n]!.invWavelength >= limit) n++;
    counts.push(n);
  }
  return { counts, amplitudes: octaves.map((o) => o.amplitude) };
}
