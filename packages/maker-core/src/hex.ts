// SPDX-License-Identifier: MPL-2.0

/**
 * Hierarquia hexagonal de abertura 7 (especificação, seção 3).
 *
 * Convenções fixas (DEC-032; mudar quebra todos os arquivos):
 * - Endereço (L, q, r): nível L (0 = mais fino) e coordenadas axiais inteiras na grade do nível.
 * - Nível 0 com hexágonos de ponta para cima; mundo em metros com x para leste e y para o SUL
 *   (mesma orientação da tela e do SVG). Por isso cada nível acima gira ≈ 19,1066° no sentido
 *   horário da tela em relação ao de baixo, como em `docs/img/hex-7-filhos.svg`.
 *
 * Só inteiros e + − × ÷ (DEC-009): nada de funções transcendentais nem Math.random.
 * As raízes aparecem apenas como constantes literais.
 */

import { CoreError } from './errors';

export interface Axial {
  readonly q: number;
  readonly r: number;
}

export interface Cell extends Axial {
  readonly level: number;
}

/** Ponto do mundo em metros: x para leste, y para o sul. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const APERTURE = 7;
export const MAX_LEVEL = 20;
export const INT32_MAX = 2147483647;

/** √3 e √7 arredondados para o double mais próximo (constantes, não cálculo). */
export const SQRT3 = 1.7320508075688772;
export const SQRT7 = 2.6457513110645907;
const SQRT3_HALF = 0.8660254037844386;

/** Vetor do centro do pai até o filho de dígito d (n0…n6 da especificação). */
export const CHILD_OFFSETS: readonly Axial[] = Object.freeze([
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
  { q: -1, r: 0 },
]);

/** Os 6 vizinhos em ordem cíclica (anti-horária na tela): L, NE, NO, O, SO, SE. */
export const NEIGHBOR_DIRECTIONS: readonly Axial[] = Object.freeze([
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]);

/** Passos do pai medidos na grade do filho: u = (2, 1), v = (−1, 3); determinante 7. */
export const PARENT_STEP_U: Axial = Object.freeze({ q: 2, r: 1 });
export const PARENT_STEP_V: Axial = Object.freeze({ q: -1, r: 3 });

// `+ 0` transforma −0 em 0, para que endereços iguais sejam idênticos.
function makeCell(level: number, q: number, r: number): Cell {
  return { level, q: q + 0, r: r + 0 };
}

/** Resto de n por 7 sempre em 0…6, inclusive para n negativo. */
export function mod7(n: number): number {
  const m = n % 7;
  return m < 0 ? m + 7 : m + 0;
}

function checkLevel(level: number): void {
  if (!Number.isInteger(level)) throw new CoreError('not-an-integer');
  if (level < 0 || level > MAX_LEVEL) throw new CoreError('level-out-of-range');
}

function checkS0(s0: number): void {
  if (!Number.isFinite(s0) || s0 <= 0) throw new CoreError('invalid-spacing');
}

/** Cria um endereço validado. */
export function cell(level: number, q: number, r: number): Cell {
  checkLevel(level);
  if (!Number.isInteger(q) || !Number.isInteger(r)) throw new CoreError('not-an-integer');
  if (Math.abs(q) > INT32_MAX || Math.abs(r) > INT32_MAX || Math.abs(q + r) > INT32_MAX) {
    throw new CoreError('coordinate-out-of-range');
  }
  return makeCell(level, q, r);
}

/** Dígito da célula dentro do pai: d = (q − 2r) mod 7. */
export function digit(c: Axial): Digit {
  return mod7(c.q - 2 * c.r) as Digit;
}

export function parent(c: Cell): Cell {
  if (c.level >= MAX_LEVEL) throw new CoreError('no-parent-above-max-level');
  const n = CHILD_OFFSETS[digit(c)]!;
  const pq = c.q - n.q;
  const pr = c.r - n.r;
  return makeCell(c.level + 1, (3 * pq + pr) / 7, (2 * pr - pq) / 7);
}

export function child(c: Cell, d: number): Cell {
  if (c.level === 0) throw new CoreError('no-children-below-level-0');
  if (!Number.isInteger(d) || d < 0 || d > 6) throw new CoreError('digit-out-of-range');
  const n = CHILD_OFFSETS[d]!;
  return makeCell(c.level - 1, 2 * c.q - c.r + n.q, c.q + 3 * c.r + n.r);
}

/** Os 7 filhos em ordem de dígito (0 = central). */
export function children(c: Cell): Cell[] {
  const result: Cell[] = [];
  for (let d = 0; d < 7; d++) result.push(child(c, d));
  return result;
}

export function neighbors(c: Cell): Cell[] {
  return NEIGHBOR_DIRECTIONS.map((n) => makeCell(c.level, c.q + n.q, c.r + n.r));
}

/** Distância em passos entre duas células do mesmo nível. */
export function hexDistance(a: Cell, b: Cell): number {
  if (a.level !== b.level) throw new CoreError('level-mismatch');
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Ancestral no nível pedido (o próprio, se for o mesmo nível). */
export function ancestor(c: Cell, level: number): Cell {
  checkLevel(level);
  if (level < c.level) throw new CoreError('level-out-of-range');
  let a = c;
  while (a.level < level) a = parent(a);
  return a;
}

/** Aplica L vezes o mapa "centro do filho 0": (q, r) → (2q − r, q + 3r). */
function downToLevel0(q: number, r: number, level: number): Axial {
  for (let i = 0; i < level; i++) {
    const nq = 2 * q - r;
    r = q + 3 * r;
    q = nq;
  }
  return { q: q + 0, r: r + 0 };
}

/** Centro da célula em coordenadas axiais inteiras do nível 0. */
export function toLevel0(c: Cell): Axial {
  return downToLevel0(c.q, c.r, c.level);
}

function level0ToWorld(q: number, r: number, s0: number): Point {
  return { x: s0 * (q + r / 2), y: s0 * r * SQRT3_HALF };
}

/** Espaçamento entre centros no nível L, em metros: s0 · √7^L. */
export function spacing(level: number, s0 = 1): number {
  checkLevel(level);
  checkS0(s0);
  let s = s0;
  for (let i = 0; i < level >> 1; i++) s *= 7;
  return level % 2 === 1 ? s * SQRT7 : s;
}

/** Tabela de espaçamento dos níveis 0…maxLevel. */
export function spacingTable(maxLevel = MAX_LEVEL, s0 = 1): number[] {
  checkLevel(maxLevel);
  const table: number[] = [];
  for (let l = 0; l <= maxLevel; l++) table.push(spacing(l, s0));
  return table;
}

/** Posição do centro da célula no mundo, em metros. */
export function cellCenter(c: Cell, s0 = 1): Point {
  checkS0(s0);
  const p = toLevel0(c);
  return level0ToWorld(p.q, p.r, s0);
}

/**
 * Os 6 cantos do hexágono "ideal" da célula, em ordem anti-horária na tela,
 * começando pelo canto entre os vizinhos L e NE. Cada canto é (dir_k + dir_k+1) / 3
 * levado ao nível 0, então só há multiplicações inteiras e uma divisão por 3.
 */
export function cellVertices(c: Cell, s0 = 1): Point[] {
  checkS0(s0);
  const center = toLevel0(c);
  const result: Point[] = [];
  for (let k = 0; k < 6; k++) {
    const a = NEIGHBOR_DIRECTIONS[k]!;
    const b = NEIGHBOR_DIRECTIONS[(k + 1) % 6]!;
    const off = downToLevel0(a.q + b.q, a.r + b.r, c.level);
    result.push(level0ToWorld(center.q + off.q / 3, center.r + off.r / 3, s0));
  }
  return result;
}

function roundAxial(q: number, r: number): Axial {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };
}

/** Coordenadas axiais fracionárias, na grade do nível L, de um ponto do mundo (metros). */
export function axialAt(level: number, p: Point, s0 = 1): Axial {
  checkLevel(level);
  checkS0(s0);
  let r = p.y / (s0 * SQRT3_HALF);
  let q = p.x / s0 - r / 2;
  for (let i = 0; i < level; i++) {
    const nq = (3 * q + r) / 7;
    r = (2 * r - q) / 7;
    q = nq;
  }
  return { q, r };
}

/** Célula do nível L cujo hexágono ideal contém o ponto do mundo (metros). */
export function cellAt(level: number, p: Point, s0 = 1): Cell {
  const f = axialAt(level, p, s0);
  const a = roundAxial(f.q, f.r);
  return cell(level, a.q, a.r);
}

/** Chave textual "L:q:r" (a mesma usada em `edits` no documento). */
export function cellKey(c: Cell): string {
  return `${c.level}:${c.q}:${c.r}`;
}

export function parseCellKey(key: string): Cell {
  const m = /^(\d+):(-?\d+):(-?\d+)$/.exec(key);
  if (!m) throw new CoreError('invalid-cell-key');
  return cell(Number(m[1]), Number(m[2]), Number(m[3]));
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.level === b.level && a.q === b.q && a.r === b.r;
}
