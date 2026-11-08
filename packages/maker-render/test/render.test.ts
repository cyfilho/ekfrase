// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cell, cellAt, cellCenter, children, spacing } from '@ekfrase/maker-core';
import { basic_1_0_0 } from '@ekfrase/maker-gen';
import { describe, expect, it } from 'vitest';
import {
  DETAIL,
  EditIndex,
  SPRITES,
  TILE_SIZE,
  metersPerPixel,
  renderTile,
  sampleLevelFor,
  tileBounds,
  zoomForScale,
} from '../src';

const sampler = basic_1_0_0.create({ seed: 'ekfrase', extentKm: { ns: 1200, ew: 1600 }, s0M: 1, params: {} });
const base = { sampler, s0M: 1, edits: null };

describe('esquema de ladrilhos', () => {
  it('metros por pixel são potências de 2 exatas', () => {
    expect([metersPerPixel(0), metersPerPixel(3), metersPerPixel(-2)]).toEqual([1, 8, 0.25]);
  });

  it('o zoom escolhido deixa o pixel de arte entre alvo e 2 × alvo pixels de tela', () => {
    for (const scale of [0.0001, 0.003, 0.5, 1, 7.3, 40]) {
      const z = zoomForScale(scale, 3);
      const px = metersPerPixel(z) * scale;
      expect(px).toBeGreaterThanOrEqual(3);
      expect(px).toBeLessThan(6);
    }
  });

  it('o nível amostrado tem espaçamento ≤ pixel e o seguinte já é maior', () => {
    for (const z of [0, 4, 9, 13]) {
      const l = sampleLevelFor(z, 1);
      expect(spacing(l)).toBeLessThanOrEqual(metersPerPixel(z));
      expect(spacing(l + 1)).toBeGreaterThan(metersPerPixel(z));
    }
  });

  it('ladrilhos vizinhos se tocam sem sobra nem buraco', () => {
    const a = tileBounds({ z: 5, tx: 2, ty: -1 });
    const b = tileBounds({ z: 5, tx: 3, ty: -1 });
    expect(a.x1).toBe(b.x0);
    expect(a.x1 - a.x0).toBe(TILE_SIZE * 32);
  });
});

describe('desenho do ladrilho', () => {
  it('é determinista e todo opaco', () => {
    const a = renderTile({ ...base, z: 10, tx: 0, ty: 0 });
    const b = renderTile({ ...base, z: 10, tx: 0, ty: 0 });
    expect(a).toEqual(b);
    expect(a.length).toBe(TILE_SIZE * TILE_SIZE * 4);
    for (let p = 3; p < a.length; p += 4) expect(a[p]).toBe(255);
  });

  it('dois ladrilhos vizinhos = um ladrilho do dobro do tamanho (sem emenda, inclusive carimbos)', { timeout: 30_000 }, () => {
    // 9 e 7: massa de copas; 2: copas uma a uma; −2: árvores desenhadas (carimbos que cruzam a borda)
    for (const [z, tx, ty] of [[9, -1, 0], [7, -4, 3], [2, 5, -4], [-2, 92, -63]] as const) {
      const S = TILE_SIZE;
      const left = renderTile({ ...base, z, tx: 2 * tx, ty: 2 * ty });
      const right = renderTile({ ...base, z, tx: 2 * tx + 1, ty: 2 * ty });
      const big = renderTile({ ...base, z, tx, ty, size: 2 * S });
      for (let y = 0; y < S; y++) {
        expect(big.subarray(y * 2 * S * 4, (y * 2 * S + S) * 4)).toEqual(left.subarray(y * S * 4, (y + 1) * S * 4));
        expect(big.subarray((y * 2 * S + S) * 4, (y + 1) * 2 * S * 4)).toEqual(right.subarray(y * S * 4, (y + 1) * S * 4));
      }
    }
  });

  it('visão Mapa sem emenda em todas as faixas de zoom, na serra (picos, bosques, colinas e curvas cruzam a borda)', { timeout: 30_000 }, () => {
    const serra = { sampler: basic_1_0_0.create({ seed: 'alpes', extentKm: { ns: 1200, ew: 1600 }, s0M: 1, params: {} }), s0M: 1, edits: null, style: 'map' as const };
    const S = TILE_SIZE;
    for (const z of [12, 10, 8, 6, 4, 2]) {
      const m = metersPerPixel(z);
      const tx = Math.floor(-300000 / m / (2 * S));
      const ty = Math.floor(75000 / m / (2 * S));
      const left = renderTile({ ...serra, z, tx: 2 * tx, ty: 2 * ty });
      const right = renderTile({ ...serra, z, tx: 2 * tx + 1, ty: 2 * ty });
      const big = renderTile({ ...serra, z, tx, ty, size: 2 * S });
      for (let y = 0; y < S; y++) {
        expect(big.subarray(y * 2 * S * 4, (y * 2 * S + S) * 4), `z${z}`).toEqual(left.subarray(y * S * 4, (y + 1) * S * 4));
        expect(big.subarray((y * 2 * S + S) * 4, (y + 1) * 2 * S * 4), `z${z}`).toEqual(right.subarray(y * S * 4, (y + 1) * S * 4));
      }
    }
  });

  it('há variedade: o mundo não é desenhado com poucas cores', () => {
    const t = renderTile({ ...base, z: 12, tx: -1, ty: -1 });
    const colors = new Set<number>();
    for (let p = 0; p < t.length; p += 4) colors.add((t[p]! << 16) | (t[p + 1]! << 8) | t[p + 2]!);
    expect(colors.size).toBeGreaterThan(60);
  });
});

describe('bioma pintado à mão (pincel)', () => {
  it('muda só os pixels dentro da célula pintada e da sua vizinhança imediata', () => {
    const z = 8;
    const m = metersPerPixel(z);
    const level = sampleLevelFor(z, 1) + 3; // célula bem maior que o pixel
    const target = cell(level, 3, -2);
    const center = cellCenter(target);
    const tx = Math.floor(center.x / (TILE_SIZE * m));
    const ty = Math.floor(center.y / (TILE_SIZE * m));
    const edits = new EditIndex([{ level: target.level, q: target.q, r: target.r, prop: 'biome', value: 'desert' }], [], 1);
    const before = renderTile({ ...base, z, tx, ty });
    const after = renderTile({ ...base, edits, z, tx, ty });
    const reach = spacing(level) * 0.85 + 30 * m; // contorno irregular + carimbos e sombras que vazam
    let changed = 0;
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const p = (y * TILE_SIZE + x) * 4;
        if (before[p] === after[p] && before[p + 1] === after[p + 1] && before[p + 2] === after[p + 2]) continue;
        changed++;
        const wx = (tx * TILE_SIZE + x + 0.5) * m;
        const wy = (ty * TILE_SIZE + y + 0.5) * m;
        expect(Math.hypot(wx - center.x, wy - center.y)).toBeLessThan(reach);
      }
    }
    expect(changed).toBeGreaterThan(50);
  });

  it('a edição mais fina vence a do ancestral (§4)', () => {
    const big = cell(6, 0, 0);
    const small = cell(3, 0, 0); // descendente central de `big`
    const index = new EditIndex(
      [
        { level: big.level, q: big.q, r: big.r, prop: 'biome', value: 'desert' },
        { level: small.level, q: small.q, r: small.r, prop: 'biome', value: 'swamp' },
        { level: big.level, q: big.q, r: big.r, prop: 'trees', value: 'conifer' },
      ],
      [],
      1,
    );
    const paint = index.forBox(-1e5, -1e5, 1e5, 1e5, 0).paint!;
    const lookup = (p: { x: number; y: number }) => paint(p)?.biome;
    expect(lookup(cellCenter(small))).toBe('swamp');
    expect(lookup(cellCenter(cell(5, 0, 0)))).toBe('swamp');
    // propriedades diferentes se combinam: o bioma vem do descendente, as árvores do ancestral
    expect(paint(cellCenter(small))?.trees).toBe('conifer');
    // centro de outro filho de `big` (fora do ramo de `small`): vale a edição do ancestral
    expect(lookup(cellCenter(children(big)[1]!))).toBe('desert');
    expect(lookup({ x: 5e6, y: 0 })).toBeUndefined();
  });

  it('sem edições perto, o índice nem é consultado', () => {
    const index = new EditIndex([{ level: 2, q: 0, r: 0, prop: 'biome', value: 'desert' }], [], 1);
    const box = index.forBox(1e6, 1e6, 1.1e6, 1.1e6, 0);
    expect(box.paint).toBeNull();
    expect(box.relief).toBeNull();
  });
});

describe('carimbos', () => {
  const all = [...Object.values(SPRITES).flat(2), ...Object.values(DETAIL).flat(2)];

  it('todos coerentes: tamanho, âncora dentro e pelo menos 3 pixels', () => {
    for (const s of all) {
      expect(s.px.length).toBe(s.w * s.h);
      expect(s.ax).toBeGreaterThanOrEqual(0);
      expect(s.ax).toBeLessThan(s.w);
      expect(s.ay).toBe(s.h - 1);
      expect([...s.px].filter((c) => c !== -1).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('as variações de cada tipo são diferentes entre si', () => {
    for (const list of [SPRITES.bush, SPRITES.rock, DETAIL.conifer[2]!, DETAIL.broadleaf[6]!, DETAIL.broadleaf[11]!, DETAIL.house[2]!]) {
      const keys = new Set(list.map((s) => [...s.px].join(',')));
      expect(keys.size).toBe(list.length);
    }
  });
});

describe('regras do renderizador', () => {
  it('sem DOM nem Math.random (roda em Web Workers)', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/\b(window|document|localStorage)\.|\bMath\.random\b/);
    }
  });
});

describe('relevo pintado (montanhas e colinas)', () => {
  const at = (index: EditIndex, p: { x: number; y: number }) => index.forBox(-1e7, -1e7, 1e7, 1e7, 0).relief!(p).h;

  it('montanhas vizinhas formam uma crista contínua (o meio do caminho não afunda até o chão)', () => {
    const a = cell(8, 0, 0);
    const b = cell(8, 1, 0);
    const index = new EditIndex([], [{ ...a, kind: 'mountain' }, { ...b, kind: 'mountain' }], 1);
    const pa = cellCenter(a);
    const pb = cellCenter(b);
    const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
    expect(at(index, mid)).toBeGreaterThan(at(index, pa) * 0.8);
  });

  it('um bloco de quatro montanhas forma uma montanha maior que uma sozinha', () => {
    const c0 = cell(8, 0, 0);
    const block = [c0, cell(8, 1, 0), cell(8, 0, 1), cell(8, 1, -1)];
    const alone = new EditIndex([], [{ ...c0, kind: 'mountain' }], 1);
    const four = new EditIndex([], block.map((c) => ({ ...c, kind: 'mountain' as const })), 1);
    const centers = block.map((c) => cellCenter(c));
    const centroid = { x: centers.reduce((s, p) => s + p.x, 0) / 4, y: centers.reduce((s, p) => s + p.y, 0) / 4 };
    expect(at(four, centroid)).toBeGreaterThan(at(alone, cellCenter(c0)) * 1.3);
  });

  it('a altura acompanha o tamanho da célula: de longe serras, de perto morros', () => {
    const far = new EditIndex([], [{ ...cell(10, 0, 0), kind: 'mountain' }], 1);
    const near = new EditIndex([], [{ ...cell(5, 0, 0), kind: 'mountain' }], 1);
    expect(at(far, { x: 0, y: 0 })).toBeGreaterThan(2000);
    expect(at(near, { x: 0, y: 0 })).toBeLessThan(100);
  });
});

describe('detalhe por zoom', () => {
  const pixelsDiffer = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.some((v, i) => v !== b[i]);

  it('construções aparecem de perto e somem de muito longe (menores que o pixel)', () => {
    const c = cell(5, 2, 1);
    const index = new EditIndex([{ ...c, prop: 'building', value: 'house' }], [], 1);
    const center = cellCenter(c);
    for (const [z, expected] of [[1, true], [6, true], [9, false]] as const) {
      const m = metersPerPixel(z);
      const tx = Math.floor(center.x / (TILE_SIZE * m));
      const ty = Math.floor(center.y / (TILE_SIZE * m));
      const plain = renderTile({ ...base, z, tx, ty });
      const built = renderTile({ ...base, edits: index, z, tx, ty });
      expect(pixelsDiffer(plain, built), `z=${z}`).toBe(expected);
    }
  });

  it('árvores pintadas aparecem na área pintada, em qualquer bioma', () => {
    const c = cellAt(6, { x: 123456.5, y: -98765.25 }); // planície (valor de referência do gerador)
    const index = new EditIndex([{ ...c, prop: 'trees', value: 'broadleaf' }], [], 1);
    const center = cellCenter(c);
    const z = 1;
    const m = metersPerPixel(z);
    const tx = Math.floor(center.x / (TILE_SIZE * m));
    const ty = Math.floor(center.y / (TILE_SIZE * m));
    expect(pixelsDiffer(renderTile({ ...base, z, tx, ty }), renderTile({ ...base, edits: index, z, tx, ty }))).toBe(true);
  });
});
