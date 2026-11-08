// SPDX-License-Identifier: MPL-2.0
/**
 * O arquivo `.ekfr` (docs/formato-ekfr.md): ida e volta, os mesmos bytes, `mimetype` primeiro e sem
 * compressão (reconhecível pelos primeiros bytes), envelope conferido, formato antigo do Maker, o
 * registro (quem abre o quê) e os textos de cada erro no roteador do castelo.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { REGISTRO, TIPO_MIDIA, chaveNoEndereco, gravarEkfr, identificar, lerEkfr, nomeDeArquivo, podeAbrir, quemAbre, type Envelope } from '../packages/arquivo/src/index.ts';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const ENV = { app: 'maker', tipo: 'mundo', formato: '1.0.0', gravadoPor: 'maker-web@0.1.0', titulo: 'Terras' } as const;
const conteudo = { 'manifest.json': strToU8('{}'), 'doc.crdt': new Uint8Array([1, 2, 3]) };

describe('o arquivo .ekfr', () => {
  it('ida e volta, com os mesmos bytes para os mesmos dados', () => {
    const a = gravarEkfr(ENV, conteudo, { preview: new Uint8Array([9]) });
    expect(gravarEkfr(ENV, conteudo, { preview: new Uint8Array([9]) })).toEqual(a);
    const f = lerEkfr(a);
    expect(f.legado).toBe(false);
    expect(f.envelope).toEqual({ ekfr: 1, ...ENV });
    expect(Object.keys(f.arquivos).sort()).toEqual(['doc.crdt', 'manifest.json', 'preview.png']);
  });

  it('a 1ª entrada é o mimetype, sem compressão: dá para reconhecer pelos primeiros bytes', () => {
    const b = gravarEkfr(ENV, conteudo);
    const d = (i: number, n: number) => new TextDecoder().decode(b.subarray(i, i + n));
    expect(b[8]).toBe(0); // método 0 = guardado, sem compressão
    expect(d(30, 8)).toBe('mimetype');
    const extra = b[28]! | (b[29]! << 8);
    expect(d(38 + extra, TIPO_MIDIA.length)).toBe(TIPO_MIDIA);
    expect(Object.keys(unzipSync(b)).slice(0, 2)).toEqual(['mimetype', 'ekfr.json']);
  });

  it('nomes reservados e envelope incompleto são recusados', () => {
    expect(() => gravarEkfr(ENV, { 'ekfr.json': new Uint8Array() })).toThrow();
    expect(() => gravarEkfr({ ...ENV, formato: 'um' }, conteudo)).toThrow();
    expect(() => gravarEkfr({ ...ENV, app: 'Maker!' }, conteudo)).toThrow();
  });

  it('identificar devolve códigos, nunca exceção', () => {
    expect(identificar(strToU8('olá'))).toEqual({ ok: false, erro: 'nao-e-ekfr' });
    expect(identificar(zipSync({ 'leia.txt': strToU8('x') }))).toEqual({ ok: false, erro: 'sem-envelope' });
    expect(identificar(zipSync({ 'ekfr.json': strToU8('{') }))).toEqual({ ok: false, erro: 'envelope-invalido' });
    expect(identificar(zipSync({ 'ekfr.json': strToU8(JSON.stringify({ ekfr: 2, ...ENV })) }))).toEqual({ ok: false, erro: 'envelope-novo' });
  });

  it('o .ekfrase antigo do Maker é reconhecido (envelope deduzido)', () => {
    const antigo = readFileSync(join(raiz, 'packages', 'maker-doc', 'test', 'fixtures', 'v1.0.0.ekfrase'));
    const id = identificar(new Uint8Array(antigo));
    expect(id).toMatchObject({ ok: true, legado: true, envelope: { app: 'maker', tipo: 'mundo', formato: '1.0.0' } });
  });

  it('nome do arquivo para baixar', () => {
    expect(nomeDeArquivo('Terras: do Norte?')).toBe('Terras do Norte.ekfr');
    expect(nomeDeArquivo('   ')).toBe('ekfrase.ekfr');
  });

  it('a chave da entrega no endereço', () => {
    expect(chaveNoEndereco('#/abrir/0f8fad5b-d9cb-469f-a165-70867728950e')).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect(chaveNoEndereco('#/abrir/../x')).toBeNull();
  });
});

describe('o registro (quem abre o quê)', () => {
  it('cada app do registro existe em apps/<id> e mora em /<id>/', () => {
    const ids = new Set<string>();
    for (const a of REGISTRO) {
      expect(ids.has(a.id), a.id).toBe(false);
      ids.add(a.id);
      expect(existsSync(join(raiz, 'apps', a.id)), a.id).toBe(true);
      expect(a.endereco).toBe(`/${a.id}/`);
      expect(a.abre.length).toBeGreaterThan(0);
    }
  });

  it('podeAbrir e quemAbre', () => {
    const e = (over: Partial<Envelope>): Envelope => ({ ekfr: 1, ...ENV, ...over });
    expect(podeAbrir('maker', e({}))).toEqual({ abre: true });
    expect(podeAbrir('maker', e({ formato: '1.9.0' }))).toEqual({ abre: true });
    expect(podeAbrir('maker', e({ formato: '2.0.0' }))).toEqual({ abre: false, motivo: 'versao-nova' });
    expect(podeAbrir('maker', e({ tipo: 'baralho' }))).toEqual({ abre: false, motivo: 'tipo-desconhecido' });
    expect(podeAbrir('vernakula', e({}))).toMatchObject({ abre: false, motivo: 'outro-app', app: { id: 'maker' } });
    expect(podeAbrir('maker', e({ app: 'futuro' }))).toEqual({ abre: false, motivo: 'app-desconhecido' });
    expect(quemAbre(e({}))).toMatchObject({ app: { id: 'maker' } });
    expect(quemAbre(e({ app: 'futuro' }))).toEqual({ app: null, motivo: 'app-desconhecido' });
  });

  // o roteador fica no castelo (o site), que só existe no repositório da plataforma
  it.skipIf(!existsSync(join(raiz, 'locales', 'pt-BR', 'castelo.json')))('o roteador do castelo tem texto para todo erro e todo motivo', () => {
    const pt = JSON.parse(readFileSync(join(raiz, 'locales', 'pt-BR', 'castelo.json'), 'utf8')) as Record<string, string>;
    for (const c of ['nao-e-ekfr', 'sem-envelope', 'envelope-invalido', 'envelope-novo', 'grande', 'app-desconhecido', 'tipo-desconhecido', 'versao-nova']) {
      expect(pt[`arquivo.erro.${c}`], c).toBeTruthy();
    }
  });
});
