// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  CHILD_OFFSETS,
  CoreError,
  ancestor,
  cell,
  cellKey,
  child,
  children,
  digit,
  hexDistance,
  mod7,
  neighbors,
  parent,
  parseCellKey,
  type Cell,
} from '../src';

/** Gerador pseudoaleatório fixo, só para escolher casos de teste reprodutíveis. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function sampleCells(count: number, level: number, range: number, seed = 7): Cell[] {
  const next = lcg(seed);
  const out: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const q = (next() % (2 * range + 1)) - range;
    const r = (next() % (2 * range + 1)) - range;
    out.push(cell(level, q, r));
  }
  return out;
}

function hexDisk(level: number, q0: number, r0: number, radius: number): Cell[] {
  const out: Cell[] = [];
  for (let dq = -radius; dq <= radius; dq++) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
      out.push(cell(level, q0 + dq, r0 + dr));
    }
  }
  return out;
}

/** Deslocamento de um passo t do pai, medido na grade do filho: M·t. */
function stepInChildGrid(tq: number, tr: number): { q: number; r: number } {
  return { q: 2 * tq - tr, r: tq + 3 * tr };
}

describe('dígito', () => {
  it('usa módulo correto para negativos', () => {
    expect(mod7(-1)).toBe(6);
    expect(mod7(-7)).toBe(0);
    expect(Object.is(mod7(-14), 0)).toBe(true);
    expect(mod7(-15)).toBe(6);
    expect(digit({ q: -1, r: 0 })).toBe(6);
    expect(digit({ q: 0, r: 1 })).toBe(5);
    expect(digit({ q: -3, r: 3 })).toBe(5);
  });

  it('cada vetor n_d tem dígito d', () => {
    CHILD_OFFSETS.forEach((n, d) => expect(digit(n)).toBe(d));
  });
});

describe('pai e filhos', () => {
  it('pai(filho(x, d)) = x, em vários níveis e posições', () => {
    for (const level of [1, 2, 5, 13, 20]) {
      for (const x of sampleCells(300, level, 1_000_000, level)) {
        for (let d = 0; d < 7; d++) {
          const c = child(x, d);
          expect(parent(c)).toEqual(x);
          expect(digit(c)).toBe(d);
        }
      }
    }
  });

  it('filho(pai(c), dígito(c)) = c', () => {
    for (const c of sampleCells(2000, 0, 50_000_000, 3)) {
      expect(child(parent(c), digit(c))).toEqual(c);
    }
  });

  it('os 7 filhos são distintos e o filho 0 tem o mesmo centro do pai', () => {
    const p = cell(4, -12, 31);
    const kids = children(p);
    expect(new Set(kids.map(cellKey)).size).toBe(7);
    expect(kids[0]).toEqual(cell(3, 2 * -12 - 31, -12 + 3 * 31));
  });

  it('netos: 49 descendentes distintos com o mesmo avô', () => {
    const g = cell(6, 5, -9);
    const grandkids = children(g).flatMap(children);
    expect(new Set(grandkids.map(cellKey)).size).toBe(49);
    for (const c of grandkids) expect(ancestor(c, 6)).toEqual(g);
  });
});

describe('cobertura sem sobreposição e sem buracos', () => {
  it('pai e 6 vizinhos: 49 filhos distintos que cobrem todo o disco de raio 2', () => {
    const parents = [cell(1, 0, 0), ...neighbors(cell(1, 0, 0))];
    const kids = parents.flatMap(children);
    const keys = new Set(kids.map(cellKey));
    expect(keys.size).toBe(49);
    for (const c of hexDisk(0, 0, 0, 2)) expect(keys.has(cellKey(c))).toBe(true);
  });

  it('disco de pais de raio 4: filhos sem repetição e sem buracos até a distância 8', () => {
    const parents = hexDisk(1, 0, 0, 4);
    const kids = parents.flatMap(children);
    const keys = new Set(kids.map(cellKey));
    expect(keys.size).toBe(7 * parents.length);
    for (const c of hexDisk(0, 0, 0, 8)) expect(keys.has(cellKey(c))).toBe(true);
  });

  it('cada célula de uma região aparece exatamente uma vez entre os filhos do seu pai', () => {
    for (const c of hexDisk(2, -40_000, 17_000, 12)) {
      const matches = children(parent(c)).filter((k) => cellKey(k) === cellKey(c));
      expect(matches.length).toBe(1);
    }
  });
});

describe('mesmo resultado em qualquer posição do plano', () => {
  const offsets = [
    [0, 0],
    [1, 0],
    [-1, 1],
    [123_457, -98_765],
    [-3_000_000, 1_000_000],
    [200_000_000, -200_000_000],
  ] as const;

  it('pai(c + M·t) = pai(c) + t', () => {
    for (const c of hexDisk(0, 0, 0, 6)) {
      const p = parent(c);
      for (const [tq, tr] of offsets) {
        const m = stepInChildGrid(tq, tr);
        expect(parent(cell(0, c.q + m.q, c.r + m.r))).toEqual(cell(1, p.q + tq, p.r + tr));
        expect(digit(cell(0, c.q + m.q, c.r + m.r))).toBe(digit(c));
      }
    }
  });

  it('filhos(p + t) = filhos(p) + M·t', () => {
    const base = children(cell(3, 0, 0));
    for (const [tq, tr] of offsets) {
      const m = stepInChildGrid(tq, tr);
      expect(children(cell(3, tq, tr))).toEqual(base.map((k) => cell(2, k.q + m.q, k.r + m.r)));
    }
  });
});

describe('valores de referência (golden)', () => {
  it('pais conferidos à mão', () => {
    expect(parent(cell(0, 1, 0))).toEqual(cell(1, 0, 0));
    expect(parent(cell(0, 3, 0))).toEqual(cell(1, 1, 0));
    expect(parent(cell(0, -1, 0))).toEqual(cell(1, 0, 0));
    expect(parent(cell(0, 0, 1))).toEqual(cell(1, 0, 0));
    expect(parent(cell(0, -2, -1))).toEqual(cell(1, -1, 0));
    expect(parent(cell(0, -3, 3))).toEqual(cell(1, -1, 1));
  });

  it('filhos conferidos à mão', () => {
    expect(children(cell(1, 0, 0)).map(cellKey)).toEqual([
      '0:0:0', '0:1:0', '0:0:-1', '0:1:-1', '0:-1:1', '0:0:1', '0:-1:0',
    ]);
    expect(children(cell(1, 1, 0)).map(cellKey)).toEqual([
      '0:2:1', '0:3:1', '0:2:0', '0:3:0', '0:1:2', '0:2:2', '0:1:1',
    ]);
  });

  it('vizinhos dos passos u = (2, 1) e v = (−1, 3) do pai', () => {
    // O centro do vizinho (1, 0) do pai cai em u; o do vizinho (0, 1) cai em v.
    expect(child(cell(1, 1, 0), 0)).toEqual(cell(0, 2, 1));
    expect(child(cell(1, 0, 1), 0)).toEqual(cell(0, -1, 3));
  });
});

describe('vizinhos e distância', () => {
  it('6 vizinhos distintos a distância 1', () => {
    const c = cell(3, -5, 8);
    const ns = neighbors(c);
    expect(new Set(ns.map(cellKey)).size).toBe(6);
    for (const n of ns) expect(hexDistance(c, n)).toBe(1);
  });

  it('distância entre níveis diferentes é erro', () => {
    expect(() => hexDistance(cell(0, 0, 0), cell(1, 0, 0))).toThrow(CoreError);
  });
});

describe('chaves e validação', () => {
  it('ida e volta da chave "L:q:r"', () => {
    for (const c of sampleCells(200, 9, 1_000_000, 11)) expect(parseCellKey(cellKey(c))).toEqual(c);
  });

  it('erros devolvem códigos, não texto', () => {
    const code = (f: () => unknown): string | undefined => {
      try {
        f();
      } catch (e) {
        return e instanceof CoreError ? e.code : 'not-core-error';
      }
      return undefined;
    };
    expect(code(() => cell(0, 0.5, 0))).toBe('not-an-integer');
    expect(code(() => cell(-1, 0, 0))).toBe('level-out-of-range');
    expect(code(() => cell(21, 0, 0))).toBe('level-out-of-range');
    expect(code(() => cell(0, 2 ** 31, 0))).toBe('coordinate-out-of-range');
    expect(code(() => child(cell(0, 0, 0), 0))).toBe('no-children-below-level-0');
    expect(code(() => child(cell(1, 0, 0), 7))).toBe('digit-out-of-range');
    expect(code(() => parent(cell(20, 0, 0)))).toBe('no-parent-above-max-level');
    expect(code(() => parseCellKey('1:a:2'))).toBe('invalid-cell-key');
  });
});
