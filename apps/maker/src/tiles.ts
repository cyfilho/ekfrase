// SPDX-License-Identifier: MPL-2.0

/**
 * Camada de ladrilhos do estilo pixel: pede ladrilhos aos Workers, guarda em cache e os cola na tela.
 * O quadro nunca espera geração: o que falta aparece esticado a partir de um ladrilho mais grosso
 * já pronto, e é trocado quando o certo chega (zoom contínuo e fluido, critério da Fase 4).
 * Pintar com o pincel só invalida os ladrilhos que a pincelada toca; o antigo continua na tela até o novo chegar.
 */

import { cellCenter, spacing, type Cell } from '@ekfrase/maker-core';
import {
  TILE_SIZE,
  metersPerPixel,
  tileKey as baseKey,
  zoomForScale,
  type PaintEdit,
  type ReliefEdit,
  type TileKey,
  type TileStyle,
} from '@ekfrase/maker-render';
import type { FromWorker, ToWorker, WorkerWorld } from './tile-worker';
import { screenToWorld, worldToScreen, type Camera } from './view';

/**
 * Pixels de tela por pixel de arte (entre ART_PX e 2 × ART_PX, conforme o zoom). 1 = malha fina:
 * o pixel de arte quase some na tela e a imagem é suavizada ao esticar (DEC-058).
 */
export const ART_PX = 1;
const CACHE_MAX = 1400;
const MAX_VISIBLE = 900;
/** Folga (em pixels de arte) que carimbos e sombras podem vazar para fora da célula pintada. */
const BLEED_PX = 120;

interface Slot {
  readonly worker: Worker;
  busy: boolean;
}

interface Request {
  readonly key: string;
  readonly tile: TileKey;
  readonly worldGen: number;
  readonly editGen: number;
}

type AnyEdit = PaintEdit | ReliefEdit;
const editId = (e: AnyEdit): string => 'prop' in e ? `p${e.level}:${e.q}:${e.r}/${e.prop}=${e.value}` : `r${e.level}:${e.q}:${e.r}=${e.kind}`;

export class TileLayer {
  private readonly slots: Slot[] = [];
  private readonly cache = new Map<string, ImageBitmap>();
  private readonly inflight = new Map<number, Request>();
  private readonly requested = new Set<string>();
  /** Ladrilho invalidado por uma pincelada → geração de edição em que isso aconteceu. */
  private readonly dirty = new Map<string, number>();
  private wanted: TileKey[] = [];
  private nextId = 1;
  private style: TileStyle = 'satellite';
  /** Chave do ladrilho no cache: o estilo faz parte (trocar de visão não apaga a outra). */
  private tileKey = (t: TileKey): string => `${this.style}/${baseKey(t)}`;
  private worldGen = 0;
  private editGen = 0;
  private worldKey = '';
  private s0M = 1;
  private active = false;
  private edits = new Map<string, AnyEdit>();
  private paint: readonly PaintEdit[] = [];
  private relief: readonly ReliefEdit[] = [];
  /** Tempo médio para desenhar um ladrilho (ms), para diagnóstico. */
  averageMs = 0;

  constructor(private readonly onReady: () => void) {
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const worker = new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' });
      const slot: Slot = { worker, busy: false };
      worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(slot, e.data);
      this.slots.push(slot);
    }
  }

  private post(message: ToWorker): void {
    for (const s of this.slots) s.worker.postMessage(message);
  }

  /** Troca a visão (Mapa ou Satélite). Os ladrilhos da outra visão continuam no cache. */
  setStyle(style: TileStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.wanted = [];
  }

  /** Troca o mundo (ou desliga, com null). Tudo o que estava em cache deixa de valer. */
  setWorld(world: WorkerWorld | null): void {
    const key = world ? JSON.stringify(world) : '';
    if (key === this.worldKey) return;
    this.worldKey = key;
    this.worldGen++;
    for (const b of this.cache.values()) b.close();
    this.cache.clear();
    this.dirty.clear();
    this.requested.clear();
    this.wanted = [];
    this.active = !!world;
    if (world) {
      this.s0M = world.s0M;
      this.post({ type: 'world', world });
      this.post({ type: 'edits', paint: this.paint, relief: this.relief });
    }
  }

  /** Atualiza as camadas pintadas e invalida só os ladrilhos que a mudança toca. */
  setEdits(paint: readonly PaintEdit[], relief: readonly ReliefEdit[]): void {
    const list: AnyEdit[] = [...paint, ...relief];
    const next = new Map(list.map((e) => [editId(e), e]));
    const changed: AnyEdit[] = [];
    for (const [id, e] of next) if (!this.edits.has(id)) changed.push(e);
    for (const [id, e] of this.edits) if (!next.has(id)) changed.push(e);
    this.edits = next;
    if (changed.length === 0) return;
    this.editGen++;
    this.paint = paint;
    this.relief = relief;
    this.post({ type: 'edits', paint, relief });
    const boxes = changed.map((e) => {
      const c = cellCenter(e as Cell, this.s0M);
      const reach = spacing(e.level, this.s0M) * ('prop' in e ? 0.85 : 1.25);
      return { x0: c.x - reach, y0: c.y - reach, x1: c.x + reach, y1: c.y + reach };
    });
    for (const key of this.cache.keys()) {
      const [z, tx, ty] = key.split('/').slice(1).map(Number) as [number, number, number];
      const m = metersPerPixel(z);
      const span = TILE_SIZE * m;
      const bleed = BLEED_PX * m;
      const x0 = tx * span - bleed;
      const y0 = ty * span - bleed;
      const x1 = (tx + 1) * span + bleed;
      const y1 = (ty + 1) * span + bleed;
      if (boxes.some((b) => b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1)) this.dirty.set(key, this.editGen);
    }
  }

  /** Há ladrilhos visíveis esperando para serem desenhados ou redesenhados. */
  get pending(): boolean {
    return this.active && (this.wanted.length > 0 || this.inflight.size > 0);
  }

  /** Algum ladrilho **visível** ainda mostra o estado de antes da última pincelada. */
  get stale(): boolean {
    return this.staleVisible;
  }

  private staleVisible = false;

  private receive(slot: Slot, msg: FromWorker): void {
    slot.busy = false;
    const req = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    if (req) this.requested.delete(req.key);
    if (msg.type === 'tile') {
      const fresh = req && req.worldGen === this.worldGen && (this.dirty.get(req.key) ?? -1) <= req.editGen;
      if (fresh && req) {
        this.cache.get(req.key)?.close();
        this.cache.delete(req.key);
        this.cache.set(req.key, msg.bitmap);
        this.dirty.delete(req.key);
        this.averageMs = this.averageMs ? this.averageMs * 0.9 + msg.ms * 0.1 : msg.ms;
        while (this.cache.size > CACHE_MAX) {
          const oldest = this.cache.keys().next().value!;
          this.cache.get(oldest)?.close();
          this.cache.delete(oldest);
          this.dirty.delete(oldest);
        }
      } else {
        msg.bitmap.close();
      }
    }
    this.pump();
    this.onReady();
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      let next: TileKey | undefined;
      while ((next = this.wanted.shift())) {
        const key = this.tileKey(next);
        if (this.requested.has(key)) continue;
        if (this.cache.has(key) && !this.dirty.has(key)) continue;
        break;
      }
      if (!next) return;
      const id = this.nextId++;
      const key = this.tileKey(next);
      this.inflight.set(id, { key, tile: next, worldGen: this.worldGen, editGen: this.editGen });
      this.requested.add(key);
      slot.busy = true;
      slot.worker.postMessage({ type: 'tile', id, z: next.z, tx: next.tx, ty: next.ty, style: this.style } satisfies ToWorker);
    }
  }

  /** Cola os ladrilhos visíveis no canvas (em pixels de dispositivo). */
  draw(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, dpr: number): void {
    if (!this.active) return;
    const z = zoomForScale(cam.scale, ART_PX);
    const span = TILE_SIZE * metersPerPixel(z);
    const corners = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: 0, y: h },
      { x: w, y: h },
    ].map((p) => screenToWorld(cam, w, h, p));
    const tx0 = Math.floor(Math.min(...corners.map((p) => p.x)) / span);
    const tx1 = Math.floor(Math.max(...corners.map((p) => p.x)) / span);
    const ty0 = Math.floor(Math.min(...corners.map((p) => p.y)) / span);
    const ty1 = Math.floor(Math.max(...corners.map((p) => p.y)) / span);
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_VISIBLE) return;

    const center = screenToWorld(cam, w, h, { x: w / 2, y: h / 2 });
    const visible: TileKey[] = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) visible.push({ z, tx, ty });
    const dist = (t: TileKey) => Math.hypot((t.tx + 0.5) * span - center.x, (t.ty + 0.5) * span - center.y);
    visible.sort((a, b) => dist(a) - dist(b));
    this.wanted = visible.filter((t) => {
      const key = this.tileKey(t);
      return !this.requested.has(key) && (!this.cache.has(key) || this.dirty.has(key));
    });
    this.staleVisible = visible.some((t) => this.dirty.has(this.tileKey(t)));
    this.pump();

    ctx.save();
    // Suavizado ao esticar: com a malha fina, o pixel de arte não aparece como degrau.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    for (const t of visible) {
      const key = this.tileKey(t);
      const own = this.cache.get(key);
      if (own) {
        this.touch(key, own);
        this.blit(ctx, cam, w, h, dpr, own, 0, 0, TILE_SIZE, t.tx * span, t.ty * span, span);
        continue;
      }
      // Ainda não chegou: estica a parte certa de um ladrilho mais grosso que já esteja pronto.
      for (let k = 1; k <= 6; k++) {
        const f = 2 ** k;
        const parent = { z: z + k, tx: Math.floor(t.tx / f), ty: Math.floor(t.ty / f) };
        const bmp = this.cache.get(this.tileKey(parent));
        if (!bmp) continue;
        const sub = TILE_SIZE / f;
        const sx = (t.tx - parent.tx * f) * sub;
        const sy = (t.ty - parent.ty * f) * sub;
        this.blit(ctx, cam, w, h, dpr, bmp, sx, sy, sub, t.tx * span, t.ty * span, span);
        break;
      }
    }
    ctx.restore();
  }

  private touch(key: string, bmp: ImageBitmap): void {
    this.cache.delete(key);
    this.cache.set(key, bmp);
  }

  /** Desenha o recorte (sx, sy, lado `size`) do bitmap sobre o quadrado do mundo (x0, y0, lado `span`). */
  private blit(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    dpr: number,
    bmp: ImageBitmap,
    sx: number,
    sy: number,
    size: number,
    x0: number,
    y0: number,
    span: number,
  ): void {
    const p0 = worldToScreen(cam, w, h, { x: x0, y: y0 });
    if (cam.rotation === 0) {
      // Bordas arredondadas ao pixel do dispositivo: ladrilhos vizinhos encostam sem fresta.
      const p1 = worldToScreen(cam, w, h, { x: x0 + span, y: y0 + span });
      const dx0 = Math.round(p0.x * dpr);
      const dy0 = Math.round(p0.y * dpr);
      const dx1 = Math.round(p1.x * dpr);
      const dy1 = Math.round(p1.y * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bmp, sx, sy, size, size, dx0, dy0, dx1 - dx0, dy1 - dy0);
      return;
    }
    const pu = worldToScreen(cam, w, h, { x: x0 + span, y: y0 });
    const pv = worldToScreen(cam, w, h, { x: x0, y: y0 + span });
    ctx.setTransform(
      ((pu.x - p0.x) / size) * dpr,
      ((pu.y - p0.y) / size) * dpr,
      ((pv.x - p0.x) / size) * dpr,
      ((pv.y - p0.y) / size) * dpr,
      p0.x * dpr,
      p0.y * dpr,
    );
    // meio pixel a mais cobre a fresta de antisserrilhado entre ladrilhos girados
    ctx.drawImage(bmp, sx, sy, size, size, -0.25, -0.25, size + 0.5, size + 0.5);
  }
}
