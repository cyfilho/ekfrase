// SPDX-License-Identifier: MPL-2.0

import { cell } from '@ekfrase/maker-core';
import { DocStore, type DocStoreOptions } from '../src';

/** Ids previsíveis nos testes (no app são crypto.randomUUID). */
export function sequentialIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

export function newStore(options: DocStoreOptions = {}): DocStore {
  return DocStore.create(
    {
      name: 'Terras de Ékfrase',
      createdWith: 'ekfrase-test@0.0.0',
      seed: 'serra do mar',
      extentKm: { ns: 1200, ew: 1800 },
    },
    { newId: sequentialIds(), ...options },
  );
}

/** Documento com um pouco de tudo, incluindo coordenadas negativas e acentos. */
export function richStore(): DocStore {
  const s = newStore();
  s.apply({ type: 'meta.rename', name: 'Reino de Açaí — mapa 1' });
  s.apply({ type: 'world.update', patch: { style: 'pixel', extentKm: { ns: 900, ew: 1400 } } });
  s.apply({ type: 'edit.set', cell: cell(3, -12, 7), prop: 'terrain', value: 'forest' });
  s.apply({ type: 'edit.set', cell: cell(3, -12, 7), prop: 'height', value: 412.5 });
  s.apply({ type: 'edit.set', cell: cell(0, 1234567, -7654321), prop: 'note', value: { text: 'ponte', tags: ['velha', 'pedra'] } });
  s.apply({ type: 'edit.set', cell: cell(17, 0, 0), prop: 'climate', value: null });
  s.apply({
    type: 'entity.add',
    entity: { type: 'site', posKm: { x: -12.5, y: 40 }, components: { name: 'Vila Nova', population: 1200 } },
  });
  s.apply({
    type: 'feature.add',
    feature: { kind: 'road', pointsKm: [{ x: 0, y: 0 }, { x: 3.25, y: -1 }, { x: 7, y: 2 }], props: { surface: 'dirt' } },
  });
  s.apply({ type: 'annotation.add', annotation: { kind: 'note', data: { text: 'Fronteira disputada' } } });
  s.apply({
    type: 'annotation.add',
    annotation: { kind: 'measurement', data: { mode: 'polyline', transport: 'foot' } },
  });
  s.apply({ type: 'plugin.require', id: 'org.ekfrase.transport.medieval', plugin: { version: '1.0.0', source: 'builtin' } });
  return s;
}
