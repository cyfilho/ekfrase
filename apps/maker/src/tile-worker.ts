// SPDX-License-Identifier: MPL-2.0

/**
 * Worker que desenha ladrilhos (visão Satélite ou Mapa) (§12: geração em Web Workers). Recebe o mundo e as
 * camadas pintadas (bioma, árvores, construções, relevo); para cada pedido devolve um ImageBitmap transferido (sem cópia).
 * As mensagens são processadas em ordem: um pedido feito depois de "edits" já usa as edições novas.
 */

import { samplerFor, type WorldSampler } from '@ekfrase/maker-gen';
import { EditIndex, TILE_SIZE, renderTile, type PaintEdit, type ReliefEdit, type TileStyle } from '@ekfrase/maker-render';

export interface WorkerWorld {
  readonly seed: string;
  readonly extentKm: { readonly ns: number; readonly ew: number };
  readonly s0M: number;
  readonly generator: { readonly id: string; readonly version: string; readonly params: Readonly<Record<string, unknown>> };
}

export type ToWorker =
  | { readonly type: 'world'; readonly world: WorkerWorld }
  | { readonly type: 'edits'; readonly paint: readonly PaintEdit[]; readonly relief: readonly ReliefEdit[] }
  | { readonly type: 'tile'; readonly id: number; readonly z: number; readonly tx: number; readonly ty: number; readonly style: TileStyle };

export type FromWorker =
  | { readonly type: 'tile'; readonly id: number; readonly bitmap: ImageBitmap; readonly ms: number }
  | { readonly type: 'failed'; readonly id: number };

interface WorkerScope {
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
let sampler: WorldSampler | null = null;
let s0M = 1;
let edits: EditIndex | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'world') {
    s0M = msg.world.s0M;
    try {
      sampler = samplerFor(msg.world.generator, {
        seed: msg.world.seed,
        extentKm: msg.world.extentKm,
        s0M,
        params: msg.world.generator.params,
      });
    } catch {
      sampler = null;
    }
    return;
  }
  if (msg.type === 'edits') {
    edits = msg.paint.length || msg.relief.length ? new EditIndex(msg.paint, msg.relief, s0M) : null;
    return;
  }
  if (!sampler) {
    scope.postMessage({ type: 'failed', id: msg.id });
    return;
  }
  const t0 = performance.now();
  const rgba = renderTile({ sampler, s0M, edits, z: msg.z, tx: msg.tx, ty: msg.ty, style: msg.style });
  const image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, TILE_SIZE, TILE_SIZE);
  void createImageBitmap(image).then((bitmap) => {
    scope.postMessage({ type: 'tile', id: msg.id, bitmap, ms: performance.now() - t0 }, [bitmap]);
  });
};
