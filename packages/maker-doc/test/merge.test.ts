// SPDX-License-Identifier: MPL-2.0

import { cell } from '@ekfrase/maker-core';
import { describe, expect, it } from 'vitest';
import { DocStore } from '../src';
import { newStore, sequentialIds } from './helpers';

/** Um par que começa do estado de outro (como ao abrir o mesmo arquivo ou entrar na sessão). */
function peerOf(base: DocStore, prefix: string): DocStore {
  return DocStore.fromUpdate(base.encodeState(), { newId: sequentialIds(prefix) });
}

/** Troca nos dois sentidos só o que falta a cada um (vetor de estado). */
function sync(a: DocStore, b: DocStore): void {
  const forB = a.encodeDiff(b.stateVector());
  const forA = b.encodeDiff(a.stateVector());
  b.applyRemote(forB);
  a.applyRemote(forA);
}

describe('edições concorrentes convergem (CRDT)', () => {
  it('propriedades diferentes da mesma célula: as duas sobrevivem', () => {
    const a = newStore();
    const b = peerOf(a, 'b');
    const c = cell(4, 10, -3);
    a.apply({ type: 'edit.set', cell: c, prop: 'terrain', value: 'forest' });
    b.apply({ type: 'edit.set', cell: c, prop: 'height', value: 120 });
    sync(a, b);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.snapshot().edits['4:10:-3']).toEqual({ height: 120, terrain: 'forest' });
  });

  it('a mesma propriedade ao mesmo tempo: os dois ficam com o mesmo valor (o último vence)', () => {
    const a = newStore();
    const b = peerOf(a, 'b');
    const c = cell(0, 0, 0);
    a.apply({ type: 'edit.set', cell: c, prop: 'terrain', value: 'desert' });
    b.apply({ type: 'edit.set', cell: c, prop: 'terrain', value: 'swamp' });
    sync(a, b);
    expect(a.getEdit(c, 'terrain')).toBe(b.getEdit(c, 'terrain'));
    expect(['desert', 'swamp']).toContain(a.getEdit(c, 'terrain'));
  });

  it('entidades, feições, anotações, plugins e metadados editados nos dois lados', () => {
    const a = newStore();
    const { id: villa } = a.apply({
      type: 'entity.add',
      entity: { type: 'site', posKm: { x: 1, y: 1 }, components: { name: 'Vila' } },
    });
    const b = peerOf(a, 'b');
    a.apply({ type: 'entity.move', id: villa!, posKm: { x: 2, y: 3 } });
    b.apply({ type: 'entity.setComponent', id: villa!, name: 'population', value: 300 });
    a.apply({ type: 'feature.add', feature: { kind: 'river', pointsKm: [{ x: 0, y: 0 }], props: {} } });
    b.apply({ type: 'annotation.add', annotation: { kind: 'note', data: { text: 'oi' } } });
    a.apply({ type: 'meta.rename', name: 'Nome de A' });
    b.apply({ type: 'plugin.require', id: 'org.example.p', plugin: { version: '2.0.0', source: 'local' } });
    sync(a, b);
    const snap = a.snapshot();
    expect(b.snapshot()).toEqual(snap);
    expect(snap.entities[villa!]).toEqual({
      type: 'site',
      posKm: { x: 2, y: 3 },
      components: { name: 'Vila', population: 300 },
    });
    expect(Object.keys(snap.features)).toHaveLength(1);
    expect(Object.keys(snap.annotations)).toHaveLength(1);
    expect(snap.meta.name).toBe('Nome de A');
  });

  it('remoção de um lado e edição do outro convergem', () => {
    const a = newStore();
    const { id } = a.apply({ type: 'entity.add', entity: { type: 'npc', posKm: { x: 0, y: 0 }, components: {} } });
    const b = peerOf(a, 'b');
    a.apply({ type: 'entity.remove', id: id! });
    b.apply({ type: 'entity.setComponent', id: id!, name: 'mood', value: 'feliz' });
    sync(a, b);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('três pares, atualizações em ordens diferentes, mesmo resultado', () => {
    const a = newStore();
    const b = peerOf(a, 'b');
    const c = peerOf(a, 'c');
    const updates: Uint8Array[] = [];
    for (const [peer, n] of [[a, 1], [b, 2], [c, 3]] as const) {
      const off = peer.onUpdate((u, local) => local && updates.push(u));
      peer.apply({ type: 'edit.set', cell: cell(2, n, -n), prop: 'terrain', value: `t${n}` });
      peer.apply({ type: 'edit.set', cell: cell(2, 0, 0), prop: 'shared', value: n });
      off();
    }
    const fresh = () => DocStore.fromUpdate(a.encodeState());
    const forward = fresh();
    const backward = fresh();
    for (const u of updates) forward.applyRemote(u);
    for (const u of [...updates].reverse()) backward.applyRemote(u);
    // Aplicar a mesma atualização duas vezes não muda nada (idempotente).
    for (const u of updates) backward.applyRemote(u);
    expect(forward.snapshot()).toEqual(backward.snapshot());
    expect(Object.keys(forward.snapshot().edits)).toHaveLength(4);
  });

  it('muitas edições aleatórias de dois pares convergem', () => {
    const a = newStore();
    const b = peerOf(a, 'b');
    let s = 12345;
    const rand = (n: number) => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) % n);
    for (let round = 0; round < 20; round++) {
      for (const peer of [a, b]) {
        for (let i = 0; i < 10; i++) {
          const c = cell(rand(3), rand(5) - 2, rand(5) - 2);
          if (rand(4) === 0) peer.apply({ type: 'edit.clear', cell: c, prop: 'p' + rand(3) });
          else peer.apply({ type: 'edit.set', cell: c, prop: 'p' + rand(3), value: rand(100) });
        }
      }
      if (rand(3) === 0) sync(a, b);
    }
    sync(a, b);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.encodeState().length).toBeGreaterThan(0);
  });
});

describe('handshake de compatibilidade', () => {
  it('pares com o mesmo gerador e plugins podem sincronizar; versões diferentes não', () => {
    const a = newStore();
    const b = peerOf(a, 'b');
    expect(a.syncKey()).toBe(b.syncKey());
    a.apply({ type: 'plugin.require', id: 'org.example.p', plugin: { version: '1.0.0', source: 'x' } });
    b.apply({ type: 'plugin.require', id: 'org.example.p', plugin: { version: '1.1.0', source: 'x' } });
    expect(a.syncKey()).not.toBe(b.syncKey());
    expect(a.syncKey()).toBe('org.ekfrase.generator.none@0.0.0|org.example.p@1.0.0');
  });
});
