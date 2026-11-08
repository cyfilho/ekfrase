// SPDX-License-Identifier: MPL-2.0

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cell, children } from '@ekfrase/maker-core';
import { describe, expect, it } from 'vitest';
import { DocError, DocStore, type Command } from '../src';
import { newStore, sequentialIds } from './helpers';

function code(f: () => unknown): string | undefined {
  try {
    f();
  } catch (e) {
    return e instanceof DocError ? e.code : `not-doc-error: ${String(e)}`;
  }
  return undefined;
}

describe('comandos', () => {
  it('comando inválido não muda nada nem cria passo de desfazer', () => {
    const s = newStore();
    const before = s.snapshot();
    const bad: [Command, string][] = [
      [{ type: 'edit.set', cell: cell(0, 0, 0), prop: 'a/b', value: 1 }, 'invalid-property'],
      [{ type: 'edit.set', cell: cell(0, 0, 0), prop: 'x', value: Number.NaN }, 'invalid-value'],
      [{ type: 'edit.set', cell: cell(0, 0, 0), prop: 'x', value: new Date() as never }, 'invalid-value'],
      [{ type: 'edit.set', cell: { level: 0, q: 0.5, r: 0 }, prop: 'x', value: 1 }, 'not-core-error'],
      [{ type: 'entity.move', id: 'nada', posKm: { x: 0, y: 0 } }, 'unknown-entity'],
      [{ type: 'feature.remove', id: 'nada' }, 'unknown-feature'],
      [{ type: 'annotation.remove', id: 'nada' }, 'unknown-annotation'],
      [{ type: 'plugin.drop', id: 'nada' }, 'unknown-plugin'],
      [{ type: 'entity.add', id: 'tem espaço', entity: { type: 't', posKm: { x: 0, y: 0 }, components: {} } }, 'invalid-id'],
      [{ type: 'annotation.add', annotation: { kind: 'outra' as never, data: {} } }, 'invalid-value'],
      [{ type: 'world.update', patch: { extentKm: { ns: -1, ew: 10 } } }, 'invalid-value'],
      [{ type: 'nao-existe' } as never, 'invalid-command'],
    ];
    for (const [cmd, expected] of bad) {
      const got = code(() => s.apply(cmd));
      if (expected === 'not-core-error') expect(got, cmd.type).toMatch(/not-doc-error/);
      else expect(got, cmd.type).toBe(expected);
    }
    expect(s.snapshot()).toEqual(before);
    expect(s.canUndo()).toBe(false);
  });

  it('id repetido é recusado', () => {
    const s = newStore();
    s.apply({ type: 'entity.add', id: 'a', entity: { type: 't', posKm: { x: 0, y: 0 }, components: {} } });
    expect(code(() => s.apply({ type: 'entity.add', id: 'a', entity: { type: 't', posKm: { x: 0, y: 0 }, components: {} } }))).toBe(
      'duplicate-id',
    );
  });

  it('o valor guardado é uma cópia (mudar o objeto depois não altera o documento)', () => {
    const s = newStore();
    const value = { tags: ['a'] };
    s.apply({ type: 'edit.set', cell: cell(1, 0, 0), prop: 'x', value });
    value.tags.push('b');
    expect(s.getEdit(cell(1, 0, 0), 'x')).toEqual({ tags: ['a'] });
  });

  it('ids padrão são UUID aleatórios', () => {
    const s = DocStore.create({ name: 'x', createdWith: 't', seed: 's', extentKm: { ns: 1, ew: 1 } });
    const { id } = s.apply({ type: 'entity.add', entity: { type: 't', posKm: { x: 0, y: 0 }, components: {} } });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('desfazer e refazer por usuário', () => {
  it('cada comando é um passo; desfazer e refazer voltam exatamente', () => {
    const s = newStore();
    const s0 = s.snapshot();
    s.apply({ type: 'edit.set', cell: cell(2, 1, 1), prop: 'terrain', value: 'forest' });
    const s1 = s.snapshot();
    s.apply({ type: 'meta.rename', name: 'Outro nome' });
    expect(s.undo()).toBe(true);
    expect(s.snapshot()).toEqual(s1);
    expect(s.undo()).toBe(true);
    expect(s.snapshot()).toEqual(s0);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true);
    expect(s.redo()).toBe(true);
    expect(s.snapshot().meta.name).toBe('Outro nome');
  });

  it('desfazer só desfaz o que este usuário fez, não o do outro par', () => {
    const a = newStore();
    const b = DocStore.fromUpdate(a.encodeState(), { newId: sequentialIds('b') });
    a.apply({ type: 'edit.set', cell: cell(0, 0, 0), prop: 'mark', value: 1 });
    b.apply({ type: 'edit.set', cell: cell(0, 1, 0), prop: 'mark', value: 2 });
    a.applyRemote(b.encodeState());
    expect(b.canUndo()).toBe(true);
    a.undo();
    expect(a.getEdit(cell(0, 0, 0), 'mark')).toBeUndefined();
    expect(a.getEdit(cell(0, 1, 0), 'mark')).toBe(2);
    expect(a.canUndo()).toBe(false);
  });

  it('um lote de comandos é um único passo de desfazer', () => {
    const s = newStore();
    const before = s.snapshot();
    s.applyAll([
      { type: 'edit.set', cell: cell(2, 0, 0), prop: 'biome', value: 'forest' },
      { type: 'edit.set', cell: cell(2, 1, 0), prop: 'biome', value: 'forest' },
      { type: 'edit.clear', cell: cell(2, 5, 5), prop: 'biome' },
    ]);
    expect(s.editCount()).toBe(2);
    s.undo();
    expect(s.snapshot()).toEqual(before);
    expect(s.canUndo()).toBe(false);
    s.redo();
    expect(s.editCount()).toBe(2);
  });

  it('um grupo de comandos aplicados aos poucos é um único passo de desfazer', () => {
    const s = newStore();
    s.apply({ type: 'meta.rename', name: 'antes' });
    s.beginGroup();
    s.apply({ type: 'edit.set', cell: cell(2, 0, 0), prop: 'trees', value: 'conifer' });
    s.applyAll([{ type: 'edit.set', cell: cell(2, 1, 0), prop: 'trees', value: 'conifer' }]);
    s.apply({ type: 'edit.set', cell: cell(2, 2, 0), prop: 'trees', value: 'conifer' });
    s.endGroup();
    s.apply({ type: 'meta.rename', name: 'depois' });
    s.undo(); // desfaz o renomear
    expect(s.editCount()).toBe(3);
    s.undo(); // desfaz o grupo inteiro
    expect(s.editCount()).toBe(0);
    expect(s.getMeta().name).toBe('antes');
  });

  it('se um comando do lote é inválido, nada do lote é aplicado', () => {
    const s = newStore();
    const before = s.snapshot();
    expect(
      code(() =>
        s.applyAll([
          { type: 'edit.set', cell: cell(2, 0, 0), prop: 'biome', value: 'forest' },
          { type: 'edit.set', cell: cell(2, 1, 0), prop: 'bi/ome', value: 'forest' },
        ]),
      ),
    ).toBe('invalid-property');
    expect(s.snapshot()).toEqual(before);
    expect(s.canUndo()).toBe(false);
    expect(s.applyAll([])).toEqual([]);
  });

  it('desfazer a criação e a remoção de entidades', () => {
    const s = newStore();
    const { id } = s.apply({ type: 'entity.add', entity: { type: 'site', posKm: { x: 1, y: 2 }, components: { a: 1 } } });
    s.apply({ type: 'entity.remove', id: id! });
    expect(s.getEntity(id!)).toBeUndefined();
    s.undo();
    expect(s.getEntity(id!)).toEqual({ type: 'site', posKm: { x: 1, y: 2 }, components: { a: 1 } });
    s.undo();
    expect(s.getEntity(id!)).toBeUndefined();
  });
});

describe('listar edições de uma propriedade', () => {
  it('devolve só a propriedade pedida, com a célula', () => {
    const s = newStore();
    s.apply({ type: 'edit.set', cell: cell(2, -1, 3), prop: 'biome', value: 'forest' });
    s.apply({ type: 'edit.set', cell: cell(0, 5, 5), prop: 'biome', value: 'desert' });
    s.apply({ type: 'edit.set', cell: cell(0, 5, 5), prop: 'mark', value: 2 });
    expect(s.editsOf('biome')).toEqual([
      { cell: cell(0, 5, 5), value: 'desert' },
      { cell: cell(2, -1, 3), value: 'forest' },
    ]);
    expect(s.editsOf('mark')).toEqual([{ cell: cell(0, 5, 5), value: 2 }]);
    expect(s.editsOf('nada')).toEqual([]);
  });
});

describe('edição vale para a descendência (§4)', () => {
  it('própria, depois ancestral mais próximo, depois nada', () => {
    const s = newStore();
    const big = cell(3, 2, -1);
    s.apply({ type: 'edit.set', cell: big, prop: 'terrain', value: 'forest' });
    const kid = children(big)[4]!;
    const grandkid = children(kid)[2]!;
    s.apply({ type: 'edit.set', cell: kid, prop: 'terrain', value: 'lake' });

    expect(s.effectiveEdit(big, 'terrain')).toEqual({ value: 'forest', from: big });
    expect(s.effectiveEdit(children(big)[1]!, 'terrain')).toEqual({ value: 'forest', from: big });
    expect(s.effectiveEdit(kid, 'terrain')).toEqual({ value: 'lake', from: kid });
    expect(s.effectiveEdit(grandkid, 'terrain')).toEqual({ value: 'lake', from: kid });
    expect(s.effectiveEdit(children(grandkid)[0]!, 'terrain')?.from).toEqual(kid);
    expect(s.effectiveEdit(cell(3, 9, 9), 'terrain')).toBeUndefined();
    expect(s.effectiveEdit(cell(20, 0, 0), 'terrain')).toBeUndefined();
  });
});

describe('regras do pacote doc', () => {
  it('sem DOM nem Math.random (roda igual no navegador, no Node e em Workers)', () => {
    const dir = fileURLToPath(new URL('../src', import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/\b(window|document|localStorage)\.|\bMath\.random\b/);
    }
  });
});
