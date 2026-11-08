// SPDX-License-Identifier: MPL-2.0

/**
 * Desenho da grade em Canvas 2D. Só lê dados do núcleo (porta aberta 5): nada aqui altera o mundo.
 * Cores e fontes vêm de variáveis CSS (`style.css`), para o tema ficar num lugar só.
 */

import {
  axialAt,
  cell,
  cellCenter,
  cellVertices,
  children,
  digit,
  parent,
  spacing,
  MAX_LEVEL,
  type Cell,
  type Point,
} from '@ekfrase/maker-core';
import { BIOMES, type BiomeId } from '@ekfrase/maker-gen';
import { screenToWorld, type Camera } from './view';

/** Faixas de sombreado por altitude (terra) ou profundidade (mar). */
const SHADES = 6;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [128, 128, 128];
}

function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export interface Theme {
  readonly paper: string;
  readonly ink: string;
  readonly grid: string;
  readonly upper: string;
  readonly accent: string;
  readonly hover: string;
  readonly hatchBlue: string;
  readonly hatchRed: string;
  readonly vignette: string;
  readonly grain: number;
  readonly fontDisplay: string;
  readonly kids: readonly string[];
  /** Cor de cada bioma em SHADES tons (do mais baixo/raso ao mais alto/fundo). */
  readonly biomes: Readonly<Record<BiomeId, readonly string[]>>;
  readonly coast: string;
}

function biomeShades(v: (name: string) => string): Record<BiomeId, string[]> {
  const out = {} as Record<BiomeId, string[]>;
  const light = v('--relief-light');
  for (const b of BIOMES) {
    const base = v(`--biome-${b}`);
    const shades: string[] = [];
    for (let i = 0; i < SHADES; i++) {
      const t = i / (SHADES - 1);
      shades.push(b === 'ocean' ? mix(base, v('--biome-deep'), t) : mix(base, light, t * 0.55));
    }
    out[b] = shades;
  }
  return out;
}

export function readTheme(el: Element): Theme {
  const css = getComputedStyle(el);
  const v = (name: string): string => css.getPropertyValue(name).trim();
  return {
    paper: v('--paper'),
    ink: v('--ink'),
    grid: v('--grid'),
    upper: v('--grid-upper'),
    accent: v('--accent'),
    hover: v('--hover'),
    hatchBlue: v('--hatch-blue'),
    hatchRed: v('--hatch-red'),
    vignette: v('--vignette'),
    grain: Number(v('--grain')) || 0,
    fontDisplay: v('--font-display'),
    kids: [0, 1, 2, 3, 4, 5, 6].map((d) => v(`--kid-${d}`)),
    biomes: biomeShades(v),
    coast: v('--coast'),
  };
}

/** O que a camada de ladrilhos oferece ao desenho (ver `tiles.ts`). */
export interface TileSource {
  draw(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr: number): void;
}

/** Pincelada em andamento: células tocadas e o bioma (null = borracha). */
export interface StrokePreview {
  readonly cells: readonly Cell[];
  readonly biome: BiomeId | null;
}

export interface Scene {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  readonly level: number;
  readonly selected: Cell | null;
  readonly hover: Cell | null;
  readonly showUpper: boolean;
  readonly showDigits: boolean;
  /** Cor (0–6) da marca que vale para a célula, própria ou herdada; null se o documento não tem edições. */
  readonly markOf: ((c: Cell) => number | undefined) | null;
  /** Mapa em pixel art; null quando não há gerador ou o terreno está escondido. */
  readonly tiles: TileSource | null;
  /** Modo edição: grade, contorno do pai, foco do cursor e seleção com os 7 filhos (DEC-007). */
  readonly editMode: boolean;
  readonly stroke: StrokePreview | null;
  /** Nomes de lugares (entidades "label") e o selecionado. */
  readonly labels: readonly PlaceLabel[];
  readonly selectedLabel: string | null;
}

export interface DrawStats {
  readonly visibleCells: number;
  /** Caixas dos nomes desenhados (para clicar e selecionar). */
  readonly labelBoxes: readonly LabelBox[];
}

export interface PlaceLabel {
  readonly id: string;
  /** Posição no mundo (m). */
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly category: string;
  /** Nível ativo quando o nome foi criado: define a faixa de zoom em que aparece. */
  readonly level: number;
}

export interface LabelBox {
  readonly id: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Estilo de letra por tipo de lugar, como nos mapas: água em itálico azul, relevo em maiúsculas espaçadas. */
const LABEL_STYLE: Readonly<Record<string, { size: number; italic: boolean; upper: boolean; weight: number; spacing: number; color: string }>> = {
  region: { size: 22, italic: false, upper: true, weight: 600, spacing: 0.22, color: '#2b2a33' },
  sea: { size: 20, italic: true, upper: false, weight: 500, spacing: 0.08, color: '#16395c' },
  lake: { size: 15, italic: true, upper: false, weight: 500, spacing: 0.04, color: '#1b4a70' },
  river: { size: 13, italic: true, upper: false, weight: 500, spacing: 0.04, color: '#1b4a70' },
  forest: { size: 15, italic: true, upper: false, weight: 600, spacing: 0.04, color: '#1c3a1d' },
  mountain: { size: 12, italic: false, upper: true, weight: 600, spacing: 0.1, color: '#3b2b20' },
  range: { size: 16, italic: false, upper: true, weight: 600, spacing: 0.28, color: '#3b2b20' },
  city: { size: 16, italic: false, upper: false, weight: 700, spacing: 0.02, color: '#2b2a33' },
  building: { size: 12, italic: false, upper: false, weight: 600, spacing: 0, color: '#2b2a33' },
};

const MAX_CELLS = 20000;

/** Hash inteiro (só para a textura do papel). */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makePaper(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const cellSize = 16;
  const n = size / cellSize;
  const lattice = (i: number, j: number): number => hash2(((i % n) + n) % n, ((j % n) + n) % n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Manchas suaves (ruído de valor que se repete sem emenda) + grão fino + fibras horizontais.
      const fx = x / cellSize;
      const fy = y / cellSize;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const u = fx - i;
      const w = fy - j;
      const su = u * u * (3 - 2 * u);
      const sw = w * w * (3 - 2 * w);
      const a = lattice(i, j) + (lattice(i + 1, j) - lattice(i, j)) * su;
      const b = lattice(i, j + 1) + (lattice(i + 1, j + 1) - lattice(i, j + 1)) * su;
      const blot = a + (b - a) * sw;
      const grain = hash2(x, y);
      const fibre = hash2(Math.floor(x / 7), y) > 0.985 ? 0.5 : 0;
      const value = (blot - 0.5) * 0.9 + (grain - 0.5) * 0.6 + fibre;
      const k = (y * size + x) * 4;
      const shade = value < 0 ? 0 : 255;
      img.data[k] = shade;
      img.data[k + 1] = shade;
      img.data[k + 2] = shade;
      img.data[k + 3] = Math.min(255, Math.abs(value) * 90);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeHatch(ctx: CanvasRenderingContext2D, color: string, angleDeg: number): CanvasPattern | null {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.globalAlpha = 0.2;
  g.fillRect(0, 0, 8, 8);
  g.globalAlpha = 1;
  g.fillRect(0, 0, 2.6, 8);
  const p = ctx.createPattern(c, 'repeat');
  p?.setTransform(new DOMMatrix().rotate(angleDeg));
  return p;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paper: HTMLCanvasElement;
  private patterns: { blue: CanvasPattern | null; red: CanvasPattern | null; key: string } = {
    blue: null,
    red: null,
    key: '',
  };
  private dpr = 1;
  /** Mundo → tela do quadro atual (seno e cosseno calculados uma vez por quadro). */
  private toScreen: (p: Point) => Point = (p) => p;
  /** Cantos de um hexágono de cada nível em volta da origem (iguais para todas as células do nível). */
  private readonly cornerOffsets = new Map<number, Point[]>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.paper = makePaper(256);
  }

  resize(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
  }

  draw(scene: Scene, theme: Theme): DrawStats {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const { camera, width: w, height: h } = scene;
    const cos = Math.cos(camera.rotation);
    const sin = Math.sin(camera.rotation);
    this.toScreen = (p) => {
      const dx = p.x - camera.cx;
      const dy = p.y - camera.cy;
      return { x: w / 2 + (dx * cos + dy * sin) * camera.scale, y: h / 2 + (dy * cos - dx * sin) * camera.scale };
    };
    this.ensurePatterns(theme);
    this.drawPaper(scene, theme);

    const cells = this.visibleCells(scene, scene.level);
    if (scene.tiles) {
      scene.tiles.draw(ctx, camera, w, h, this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    } else {
      this.drawGroups(scene, theme, cells);
    }
    if (scene.markOf) this.drawMarks(scene, theme, cells, scene.markOf);
    if (scene.editMode) {
      if (scene.showUpper && scene.level < MAX_LEVEL) {
        this.strokeCells(scene, this.visibleCells(scene, scene.level + 1), theme.upper, 2.2);
      }
      this.strokeCells(scene, cells, theme.grid, 1);
    }
    if (scene.stroke) this.drawStroke(theme, scene.stroke);
    if (scene.editMode && scene.hover && !this.isSelected(scene, scene.hover)) {
      this.strokeCells(scene, [scene.hover], theme.hover, 2.5);
    }
    if (scene.selected) {
      if (scene.editMode) this.drawSelection(scene, theme, scene.selected);
      else this.drawSelectedOutline(scene, theme, scene.selected);
    }
    this.drawVignette(scene, theme);
    const labelBoxes = this.drawLabels(scene, theme);
    return { visibleCells: cells.length, labelBoxes };
  }

  /**
   * Nomes de lugares. Cada nome aparece na faixa de zoom em que foi criado (de 3 níveis mais perto
   * a 3 mais longe), crescendo quando se afasta, como num mapa de verdade; halo da cor do papel.
   */
  private drawLabels(scene: Scene, theme: Theme): LabelBox[] {
    const { ctx } = this;
    const boxes: LabelBox[] = [];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of scene.labels) {
      const d = l.level - scene.level;
      if (d < -3 || d > 3) continue;
      const st = LABEL_STYLE[l.category] ?? LABEL_STYLE['region']!;
      const size = st.size * Math.min(2, Math.max(0.75, 1 + d * 0.22));
      const p = this.toScreen({ x: l.x, y: l.y });
      if (p.x < -400 || p.y < -100 || p.x > scene.width + 400 || p.y > scene.height + 100) continue;
      const text = st.upper ? l.name.toLocaleUpperCase() : l.name;
      ctx.font = `${st.italic ? 'italic ' : ''}${st.weight} ${size.toFixed(1)}px ${theme.fontDisplay}`;
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(st.spacing * size).toFixed(1)}px`;
      // Contraste sobre qualquer terreno (mata escura, mar, neve) e nos dois temas: halo claro fixo,
      // largo e com brilho suave por fora, e tinta escura por cima (como os rótulos dos mapas impressos).
      ctx.globalAlpha = Math.abs(d) === 3 ? 0.8 : 1;
      ctx.lineJoin = 'round';
      ctx.shadowColor = 'rgba(250, 245, 232, 0.9)';
      ctx.shadowBlur = Math.max(4, size * 0.45);
      ctx.lineWidth = Math.max(4, size * 0.42);
      ctx.strokeStyle = 'rgba(250, 245, 232, 0.94)';
      ctx.strokeText(text, p.x, p.y);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = st.color;
      ctx.fillText(text, p.x, p.y);
      const w = ctx.measureText(text).width;
      const box = { id: l.id, x0: p.x - w / 2 - 4, y0: p.y - size * 0.7, x1: p.x + w / 2 + 4, y1: p.y + size * 0.7 };
      if (l.id === scene.selectedLabel) {
        ctx.globalAlpha = 1;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = theme.accent;
        ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
        ctx.setLineDash([]);
      }
      boxes.push(box);
    }
    ctx.restore();
    return boxes;
  }

  private isSelected(scene: Scene, c: Cell): boolean {
    const s = scene.selected;
    return !!s && s.level === c.level && s.q === c.q && s.r === c.r;
  }

  private ensurePatterns(theme: Theme): void {
    const key = theme.hatchBlue + theme.hatchRed;
    if (this.patterns.key === key) return;
    this.patterns = {
      blue: makeHatch(this.ctx, theme.hatchBlue, -45),
      red: makeHatch(this.ctx, theme.hatchRed, 45),
      key,
    };
  }

  private drawPaper(scene: Scene, theme: Theme): void {
    const { ctx } = this;
    ctx.fillStyle = theme.paper;
    ctx.fillRect(0, 0, scene.width, scene.height);
    const pattern = ctx.createPattern(this.paper, 'repeat');
    if (pattern && theme.grain > 0) {
      ctx.globalAlpha = theme.grain;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, scene.width, scene.height);
      ctx.globalAlpha = 1;
    }
  }

  private drawVignette(scene: Scene, theme: Theme): void {
    const { ctx } = this;
    const r = Math.hypot(scene.width, scene.height) / 2;
    const g = ctx.createRadialGradient(scene.width / 2, scene.height / 2, r * 0.55, scene.width / 2, scene.height / 2, r);
    g.addColorStop(0, 'transparent');
    g.addColorStop(1, theme.vignette);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, scene.width, scene.height);
  }

  private visibleCells(scene: Scene, level: number): Cell[] {
    const margin = spacing(level) * scene.camera.scale;
    const { width: w, height: h, camera } = scene;
    const corners = [
      { x: -margin, y: -margin },
      { x: w + margin, y: -margin },
      { x: -margin, y: h + margin },
      { x: w + margin, y: h + margin },
    ].map((p) => axialAt(level, screenToWorld(camera, w, h, p)));
    const qMin = Math.floor(Math.min(...corners.map((c) => c.q))) - 1;
    const qMax = Math.ceil(Math.max(...corners.map((c) => c.q))) + 1;
    const rMin = Math.floor(Math.min(...corners.map((c) => c.r))) - 1;
    const rMax = Math.ceil(Math.max(...corners.map((c) => c.r))) + 1;
    if ((qMax - qMin + 1) * (rMax - rMin + 1) > MAX_CELLS * 4) return [];
    const out: Cell[] = [];
    for (let r = rMin; r <= rMax; r++) {
      for (let q = qMin; q <= qMax; q++) {
        const c = cell(level, q, r);
        const s = this.toScreen(cellCenter(c));
        if (s.x > -margin && s.x < w + margin && s.y > -margin && s.y < h + margin) out.push(c);
      }
    }
    return out.length > MAX_CELLS ? out.slice(0, MAX_CELLS) : out;
  }

  /** Cantos da célula na tela: centro + cantos do hexágono do nível em volta da origem. */
  private corners(c: Cell): Point[] {
    let offsets = this.cornerOffsets.get(c.level);
    if (!offsets) {
      offsets = cellVertices(cell(c.level, 0, 0));
      this.cornerOffsets.set(c.level, offsets);
    }
    const center = cellCenter(c);
    return offsets.map((o) => this.toScreen({ x: center.x + o.x, y: center.y + o.y }));
  }

  private hexPath(_scene: Scene | null, c: Cell, path: Path2D = new Path2D()): Path2D {
    const pts = this.corners(c);
    path.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < 6; i++) path.lineTo(pts[i]!.x, pts[i]!.y);
    path.closePath();
    return path;
  }

  /** Prévia da pincelada até os ladrilhos novos chegarem: células na cor do bioma (ou tracejadas, na borracha). */
  private drawStroke(theme: Theme, stroke: StrokePreview): void {
    const path = new Path2D();
    for (const c of stroke.cells) this.hexPath(null, c, path);
    const { ctx } = this;
    ctx.save();
    if (stroke.biome) {
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = theme.biomes[stroke.biome][2]!;
      ctx.fill(path);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = theme.paper;
      ctx.lineWidth = 1.2;
      ctx.stroke(path);
    } else {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = theme.hatchRed;
      ctx.lineWidth = 2;
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /** No modo explorar, a seleção é só um contorno discreto (o mapa fica limpo). */
  private drawSelectedOutline(scene: Scene, theme: Theme, c: Cell): void {
    const { ctx } = this;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 4;
    this.strokeCells(scene, [c], theme.paper, 3);
    ctx.restore();
    ctx.save();
    ctx.setLineDash([7, 5]);
    this.strokeCells(scene, [c], theme.ink, 1.6);
    ctx.restore();
  }

  /** Tinge cada célula pela posição do seu pai no avô: vizinhos de grupo nunca têm a mesma cor. */
  private drawGroups(scene: Scene, theme: Theme, cells: readonly Cell[]): void {
    if (scene.level >= MAX_LEVEL) return;
    const { ctx } = this;
    const byColor: Path2D[] = theme.kids.map(() => new Path2D());
    for (const c of cells) this.hexPath(scene, c, byColor[digit(parent(c))]);
    ctx.globalAlpha = 0.17;
    byColor.forEach((p, i) => {
      ctx.fillStyle = theme.kids[i]!;
      ctx.fill(p);
    });
    ctx.globalAlpha = 1;
  }

  /** Células com marca: o pai "de verdade" de uma marca grossa aparece como a união dos descendentes. */
  private drawMarks(scene: Scene, theme: Theme, cells: readonly Cell[], markOf: (c: Cell) => number | undefined): void {
    const byColor: Path2D[] = theme.kids.map(() => new Path2D());
    let any = false;
    for (const c of cells) {
      const m = markOf(c);
      if (m !== undefined && byColor[m]) {
        this.hexPath(scene, c, byColor[m]);
        any = true;
      }
    }
    if (!any) return;
    const { ctx } = this;
    ctx.globalAlpha = 0.72;
    byColor.forEach((p, i) => {
      ctx.fillStyle = theme.kids[i]!;
      ctx.fill(p);
    });
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.2;
    byColor.forEach((p) => ctx.stroke(p));
    ctx.globalAlpha = 1;
  }

  private strokeCells(scene: Scene, cells: readonly Cell[], color: string, width: number): void {
    const path = new Path2D();
    for (const c of cells) this.hexPath(scene, c, path);
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }

  private drawSelection(scene: Scene, theme: Theme, x: Cell): void {
    const { ctx } = this;
    const ideal = this.hexPath(scene, x);
    const px = spacing(x.level) * scene.camera.scale;

    if (x.level < MAX_LEVEL) {
      ctx.save();
      ctx.shadowColor = theme.accent;
      ctx.shadowBlur = 8;
      this.strokeCells(scene, [parent(x)], theme.accent, 3);
      ctx.restore();
    }

    if (x.level === 0) {
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = theme.kids[0]!;
      ctx.fill(ideal);
      ctx.globalAlpha = 1;
    } else {
      const kids = children(x);
      const kidPaths = kids.map((k) => this.hexPath(scene, k));
      const union = new Path2D();
      kids.forEach((k) => this.hexPath(scene, k, union));

      ctx.save();
      ctx.shadowColor = theme.ink;
      ctx.shadowBlur = 10;
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = theme.ink;
      ctx.fill(union);
      ctx.restore();

      kidPaths.forEach((p, d) => {
        ctx.globalAlpha = 0.78;
        ctx.fillStyle = theme.kids[d]!;
        ctx.fill(p);
      });
      ctx.globalAlpha = 1;

      // Filho que passa do contorno ideal: hachura azul fora do hexágono da célula.
      if (this.patterns.blue) {
        ctx.save();
        const outside = new Path2D();
        outside.rect(-1e5, -1e5, 2e5, 2e5);
        outside.addPath(ideal);
        ctx.clip(outside, 'evenodd');
        ctx.fillStyle = this.patterns.blue;
        ctx.fill(union);
        ctx.restore();
      }
      // Parte do hexágono ideal que nenhum filho cobre: hachura vermelha (par-ímpar).
      if (this.patterns.red) {
        ctx.save();
        ctx.clip(ideal);
        const holes = new Path2D(ideal);
        holes.addPath(union);
        ctx.fillStyle = this.patterns.red;
        ctx.fill(holes, 'evenodd');
        ctx.restore();
      }

      ctx.strokeStyle = theme.ink;
      ctx.lineWidth = Math.min(2, Math.max(1, px / 120));
      ctx.lineJoin = 'round';
      kidPaths.forEach((p) => ctx.stroke(p));

      if (scene.showDigits) {
        const kidPx = spacing(x.level - 1) * scene.camera.scale;
        const size = Math.min(34, Math.max(10, kidPx * 0.34));
        if (kidPx > 14) {
          ctx.font = `700 ${size}px ${theme.fontDisplay}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = Math.max(2, size / 6);
          ctx.strokeStyle = theme.paper;
          ctx.fillStyle = theme.ink;
          kids.forEach((k, d) => {
            const c = this.toScreen(cellCenter(k));
            ctx.strokeText(String(d), c.x, c.y);
            ctx.fillText(String(d), c.x, c.y);
          });
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = Math.min(5, Math.max(2, px / 70));
    ctx.setLineDash([Math.max(6, px / 22), Math.max(4, px / 38)]);
    ctx.stroke(ideal);
    ctx.restore();
  }
}
