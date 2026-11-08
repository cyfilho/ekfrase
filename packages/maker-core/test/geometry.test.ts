// SPDX-License-Identifier: MPL-2.0

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INT32_MAX,
  ancestor,
  cell,
  cellAt,
  cellCenter,
  cellVertices,
  children,
  parent,
  spacing,
  spacingTable,
  toLevel0,
  type Cell,
  type Point,
} from '../src';

const close = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

describe('espaçamento por nível (s0 = 1 m)', () => {
  it('níveis pares são potências exatas de 7, como na tabela da especificação', () => {
    const table = spacingTable(16);
    expect([0, 2, 4, 6, 8, 10, 12, 14, 16].map((l) => table[l])).toEqual([
      1, 7, 49, 343, 2401, 16807, 117649, 823543, 5764801,
    ]);
  });

  it('níveis ímpares valem o par anterior × √7', () => {
    for (let l = 1; l <= 19; l += 2) expect(close(spacing(l), spacing(l - 1) * Math.sqrt(7))).toBe(true);
  });

  it('s0 escala tudo', () => {
    expect(spacing(4, 2.5)).toBe(49 * 2.5);
  });

  it('a distância entre centros vizinhos é o espaçamento do nível', () => {
    for (let l = 0; l <= 12; l++) {
      const a = cellCenter(cell(l, 3, -2));
      const b = cellCenter(cell(l, 4, -2));
      expect(close(Math.hypot(b.x - a.x, b.y - a.y), spacing(l))).toBe(true);
    }
  });
});

describe('sentido do giro (golden)', () => {
  it('posições de referência fixas', () => {
    expect(cellCenter(cell(0, 1, 0))).toEqual({ x: 1, y: 0 });
    expect(cellCenter(cell(1, 1, 0))).toEqual({ x: 2.5, y: 0.8660254037844386 });
    expect(cellCenter(cell(2, 1, 0))).toEqual({ x: 5.5, y: 4.330127018922193 });
    expect(toLevel0(cell(2, 1, 0))).toEqual({ q: 3, r: 5 });
    expect(toLevel0(cell(3, -1, 2))).toEqual({ q: -37, r: 20 });
  });

  it('cada nível gira atan(√3/5) ≈ 19,1066° no sentido horário da tela (y para o sul)', () => {
    for (let l = 0; l < 10; l++) {
      const a = cellCenter(cell(l, 1, 0));
      const b = cellCenter(cell(l + 1, 1, 0));
      const turn = Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
      expect(close(turn, Math.atan(Math.sqrt(3) / 5))).toBe(true);
      expect(turn).toBeGreaterThan(0); // positivo com y para baixo = horário na tela
    }
  });
});

/** Lê a figura 1 do diagrama: o hexágono ideal do pai e os 7 filhos. */
function readDiagram(): { parent: Point[]; kids: Point[][] } {
  const svg = readFileSync(new URL('../../../docs/maker/img/hex-7-filhos.svg', import.meta.url), 'utf8').replace(
    /<metadata>[\s\S]*?<\/metadata>/,
    '',
  );
  const pts = (s: string): Point[] =>
    s
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x: x!, y: y! };
      });
  const parentMatch = /<clipPath id="parentClip"><polygon points="([^"]+)"/.exec(svg);
  const kids = [...svg.matchAll(/<polygon points="([^"]+)" fill="#[0-9a-f]{6}" fill-opacity="\.78"/g)].map((m) =>
    pts(m[1]!),
  );
  return { parent: pts(parentMatch![1]!), kids };
}

const centroid = (ps: Point[]): Point => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
});

describe('o código reproduz docs/img/hex-7-filhos.svg', () => {
  const diagram = readDiagram();

  it('o diagrama tem um pai de ponta para cima e 7 filhos', () => {
    expect(diagram.parent.length).toBe(6);
    expect(diagram.kids.length).toBe(7);
    const c = centroid(diagram.parent);
    const top = diagram.parent.reduce((a, b) => (b.y < a.y ? b : a));
    expect(Math.abs(top.x - c.x)).toBeLessThan(0.01);
  });

  it('os filhos ficam nas mesmas posições em relação ao pai (inclusive o sentido do giro)', () => {
    // Referencial do pai: e1 aponta do centro do pai para o vizinho "leste" do pai.
    // No diagrama o pai está em pé, então e1 = (1, 0) da tela.
    const pc = centroid(diagram.parent);
    const parentRadius = Math.hypot(diagram.parent[0]!.x - pc.x, diagram.parent[0]!.y - pc.y);
    const parentSpacing = parentRadius * Math.sqrt(3);
    const diagramKids = diagram.kids.map((k) => {
      const c = centroid(k);
      return { a: (c.x - pc.x) / parentSpacing, b: (c.y - pc.y) / parentSpacing };
    });

    const p = cell(1, 0, 0);
    const center = cellCenter(p);
    const east = cellCenter(cell(1, 1, 0));
    const e1 = { x: (east.x - center.x) / spacing(1), y: (east.y - center.y) / spacing(1) };
    const toFrame = (k: Cell): { a: number; b: number } => {
      const c = cellCenter(k);
      const dx = (c.x - center.x) / spacing(1);
      const dy = (c.y - center.y) / spacing(1);
      return { a: dx * e1.x + dy * e1.y, b: e1.x * dy - e1.y * dx };
    };
    const codeKids = children(p).map(toFrame);

    const matches = (set: { a: number; b: number }[], mirror: boolean): boolean =>
      diagramKids.every((d) => set.some((k) => Math.hypot(k.a - d.a, (mirror ? -k.b : k.b) - d.b) < 0.005));
    expect(matches(codeKids, false)).toBe(true);
    // Controle: a imagem espelhada (giro no outro sentido) NÃO coincide.
    expect(matches(codeKids, true)).toBe(false);
  });

  it('os cantos do pai coincidem com cantos da grade dos filhos', () => {
    for (const level of [1, 2, 7]) {
      const p = cell(level, 3, -1);
      const kidCorners = children(p).flatMap((k) => cellVertices(k));
      const scale = spacing(level);
      for (const v of cellVertices(p)) {
        expect(kidCorners.some((w) => Math.hypot(w.x - v.x, w.y - v.y) < 1e-9 * scale)).toBe(true);
      }
    }
  });
});

describe('ponto → célula', () => {
  it('o centro de uma célula cai nela mesma', () => {
    for (const level of [0, 1, 3, 8, 15]) {
      for (const [q, r] of [[0, 0], [5, -3], [-77, 12], [1000, 1000]] as const) {
        const c = cell(level, q, r);
        expect(cellAt(level, cellCenter(c))).toEqual(c);
      }
    }
  });

  it('um ponto perto do centro de um filho cai no filho', () => {
    for (const k of children(cell(4, 2, -7))) {
      const c = cellCenter(k);
      expect(cellAt(3, { x: c.x + 0.3 * spacing(3), y: c.y - 0.2 * spacing(3) })).toEqual(k);
    }
  });
});

describe('faixa de int32 num mundo de 10.000 km', () => {
  it('~17 níveis bastam: o nível 16 é menor e o 17 maior que 10.000 km', () => {
    expect(spacing(16)).toBeLessThan(10_000_000);
    expect(spacing(17)).toBeGreaterThan(10_000_000);
  });

  it('coordenadas e contas intermediárias de 0 a 17 cabem em int32 em todo o mundo', () => {
    const km = 1000;
    let maxSeen = 0;
    for (let x = -10_000 * km; x <= 10_000 * km; x += 1250 * km) {
      for (let y = -10_000 * km; y <= 10_000 * km; y += 1250 * km) {
        let c = cellAt(0, { x, y });
        for (let l = 0; l < 17; l++) {
          // Mesmas contas que parent() faz por dentro.
          maxSeen = Math.max(maxSeen, Math.abs(3 * c.q + c.r) + 7, Math.abs(2 * c.r - c.q) + 7);
          const p = parent(c);
          const base = toLevel0(p);
          maxSeen = Math.max(maxSeen, Math.abs(base.q), Math.abs(base.r), Math.abs(base.q + base.r));
          c = p;
        }
        expect(ancestor(cellAt(0, { x, y }), 17)).toEqual(c);
      }
    }
    expect(maxSeen).toBeLessThan(INT32_MAX);
  });
});

describe('determinismo', () => {
  it('as mesmas contas dão exatamente o mesmo resultado', () => {
    const run = (): string =>
      JSON.stringify(
        [cell(0, 1234567, -7654321), cell(11, -3, 5), cell(17, 0, 1)].map((c) => [
          cellCenter(c),
          cellVertices(c),
          parent(c),
          cellAt(c.level, cellCenter(c, 2), 2),
        ]),
      );
    expect(run()).toBe(run());
  });
});
