// SPDX-License-Identifier: MPL-2.0

/**
 * Valores de referência do gerador basic@1.0.0, gravados ao publicá-lo (Fase 3, 2026-11-02).
 * NUNCA atualizar estes números: se este teste falhar, o gerador 1.0.0 mudou, o que quebraria
 * mapas salvos. Desfaça a mudança e crie uma versão nova do gerador (porta aberta 3).
 */

import { describe, expect, it } from 'vitest';
import { basic_1_0_0, hash3, hashString, type TerrainSample } from '../src';

type Row = [x: number, y: number, level: number, expected: TerrainSample];

const ROWS: Row[] = [
  [0, 0, 0, { elevationM: 166.00520763354933, temperatureC: 16.047492665942407, moisture: 0.49296752821353024, water: false, biome: 'forest' }],
  [0, 0, 5, { elevationM: 166.11402008043294, temperatureC: 16.046663665648918, moisture: 0.49280889474635775, water: false, biome: 'forest' }],
  [0, 0, 10, { elevationM: 149.8028833303264, temperatureC: 16.156316136602605, moisture: 0.4852749243713978, water: false, biome: 'forest' }],
  [0, 0, 16, { elevationM: 802.222222222222, temperatureC: 13.185555555555556, moisture: 0.2586074074074074, water: false, biome: 'plain' }],
  [123456.5, -98765.25, 0, { elevationM: 106.83820992406807, temperatureC: 15.11197782468827, moisture: 0.23892399471909834, water: false, biome: 'plain' }],
  [123456.5, -98765.25, 5, { elevationM: 106.85468953246054, temperatureC: 15.111698395410219, moisture: 0.23896014428227716, water: false, biome: 'plain' }],
  [123456.5, -98765.25, 10, { elevationM: 109.67817463103664, temperatureC: 15.118582622130361, moisture: 0.24187797323733276, water: false, biome: 'plain' }],
  [123456.5, -98765.25, 16, { elevationM: 798.0517921685354, temperatureC: 11.99090069612616, moisture: 0.25910902169987726, water: false, biome: 'plain' }],
  [-400000, 250000, 0, { elevationM: 85.77228451829434, temperatureC: 19.734907241521118, moisture: 0.09674366460766128, water: false, biome: 'desert' }],
  [-400000, 250000, 5, { elevationM: 85.73641116671116, temperatureC: 19.735070344564047, moisture: 0.09677527124930166, water: false, biome: 'desert' }],
  [-400000, 250000, 10, { elevationM: 88.34461932784119, temperatureC: 19.699596287002585, moisture: 0.08548980927837357, water: false, biome: 'desert' }],
  [-400000, 250000, 16, { elevationM: 532.4878459529176, temperatureC: 17.704454001306033, moisture: 0.29359256947829254, water: false, biome: 'plain' }],
  [610000, -330000, 0, { elevationM: -582.2399236810941, temperatureC: 12.909471230317763, moisture: 0.003827267184849409, water: true, biome: 'ocean' }],
  [610000, -330000, 5, { elevationM: -582.2373065359225, temperatureC: 12.90958168840867, moisture: 0.0037644997434913285, water: true, biome: 'ocean' }],
  [610000, -330000, 10, { elevationM: -595.813048301632, temperatureC: 12.895918142281808, moisture: 0.012740495239758537, water: true, biome: 'ocean' }],
  [610000, -330000, 16, { elevationM: 15.931123256835917, temperatureC: 13.928072698830569, moisture: 0.5563070150660157, water: false, biome: 'forest' }],
  [-12.5, 7.75, 0, { elevationM: 166.05450256340202, temperatureC: 16.047328595074042, moisture: 0.49298569319804264, water: false, biome: 'forest' }],
  [-12.5, 7.75, 5, { elevationM: 166.17694765068615, temperatureC: 16.046373920606502, moisture: 0.4928284065630954, water: false, biome: 'forest' }],
  [-12.5, 7.75, 10, { elevationM: 149.81490702184746, temperatureC: 16.156344274600396, moisture: 0.4853008125666018, water: false, biome: 'forest' }],
  [-12.5, 7.75, 16, { elevationM: 802.222222222222, temperatureC: 13.18564855533032, moisture: 0.2586074074074074, water: false, biome: 'plain' }],
  [5000000, -5000000, 0, { elevationM: -4000, temperatureC: -136.27626185707518, moisture: 0.5415202547991079, water: true, biome: 'ocean' }],
  [5000000, -5000000, 5, { elevationM: -4000, temperatureC: -136.27624539695648, moisture: 0.5415020558596121, water: true, biome: 'ocean' }],
  [5000000, -5000000, 10, { elevationM: -4000, temperatureC: -136.2986255019101, moisture: 0.5485372321217419, water: true, biome: 'ocean' }],
  [5000000, -5000000, 16, { elevationM: -4000, temperatureC: -135.35, moisture: 0.58, water: true, biome: 'ocean' }],
];

describe('determinismo bit a bit (§13)', () => {
  it('o hash de inteiros e o da semente dão sempre os mesmos números', () => {
    expect([hashString(''), hashString('ekfrase'), hashString('Açaí')]).toEqual([2166136261, 3129193496, 680544551]);
    expect([hash3(0, 0, 0), hash3(-1, 2, 3), hash3(2147483647, -2147483648, 99)]).toEqual([0, 3812251207, 4285724897]);
  });

  it('basic@1.0.0 reproduz exatamente os valores gravados', () => {
    const s = basic_1_0_0.create({ seed: 'ekfrase', extentKm: { ns: 1200, ew: 1600 }, s0M: 1, params: {} });
    for (const [x, y, level, expected] of ROWS) expect(s.sample({ x, y }, level), `${x},${y}@${level}`).toEqual(expected);
  });

  it('criar o amostrador de novo dá o mesmo resultado (sem estado escondido)', () => {
    const w = { seed: 'repetir', extentKm: { ns: 500, ew: 700 }, s0M: 2, params: { seaLevel: 0.5 } };
    const a = basic_1_0_0.create(w);
    const b = basic_1_0_0.create(w);
    for (let i = 0; i < 100; i++) {
      const p = { x: i * 4321.5 - 200000, y: i * -1234.25 + 100000 };
      expect(a.sample(p, i % 13)).toEqual(b.sample(p, i % 13));
    }
  });

  it('sementes diferentes dão mundos diferentes', () => {
    const w = (seed: string) => basic_1_0_0.create({ seed, extentKm: { ns: 1200, ew: 1600 }, s0M: 1, params: {} });
    expect(w('a').sample({ x: 1000, y: 2000 }, 6)).not.toEqual(w('b').sample({ x: 1000, y: 2000 }, 6));
  });
});
