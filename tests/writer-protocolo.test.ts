// SPDX-License-Identifier: MPL-2.0

/**
 * Os CASOS DE CONFORMIDADE do protocolo do Writer (docs/writer/protocolo/cliente/*.json) aplicados
 * ao núcleo em TypeScript. Os mesmos arquivos servem a qualquer outra implementação (o futuro
 * Writer Lite): quem passa por eles gera as mesmas versões, mescla igual e cria as mesmas cópias.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Relogio,
  compararHlc,
  copiaDeConflito,
  ehHlc,
  ehOrdem,
  ehUuidV7,
  entre,
  idDaCopia,
  idDeterministico,
  iguais,
  lapide,
  logoDepois,
  maiorHlc,
  mesclar,
  sha256,
  variasEntre,
  type Registro,
  type VersoesDeCampo,
} from '../packages/writer-nucleo/src/index.ts';

const pasta = fileURLToPath(new URL('../docs/writer/protocolo/cliente/', import.meta.url));
const ler = <T>(nome: string): T => JSON.parse(readFileSync(join(pasta, nome), 'utf8')) as T;
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

interface CasoMescla {
  nome: string;
  entrada: { local: Registro; servidor: Registro; baseV: VersoesDeCampo | null };
  saida: { dados: Record<string, unknown>; apagado: boolean; igualAoServidor: boolean; copia: Registro | null };
}

function conferirMescla(casos: readonly CasoMescla[]): void {
  for (const c of casos) {
    const antes = JSON.stringify(c.entrada);
    const s = mesclar(c.entrada);
    expect(iguais(s.dados, c.saida.dados), `${c.nome}: dados`).toBe(true);
    expect(s.apagado, `${c.nome}: apagado`).toBe(c.saida.apagado);
    expect(s.igualAoServidor, `${c.nome}: igualAoServidor`).toBe(c.saida.igualAoServidor);
    expect(s.copia, `${c.nome}: copia`).toEqual(c.saida.copia);
    expect(JSON.stringify(c.entrada), `${c.nome}: a entrada não muda`).toBe(antes);
  }
}

describe('protocolo do Writer: casos de conformidade do cliente', () => {
  it('a pasta tem os quatro arquivos (e só dados)', () => {
    expect(readdirSync(pasta).sort()).toEqual(['conflito-texto.json', 'hlc.json', 'mesclar.json', 'ordem.json']);
  });

  it('HLC: gerar, absorver, comparar, formato', () => {
    type Passo = { op: 'agora'; fisico: number; espera: string } | { op: 'absorver'; versao: string };
    const d = ler<{
      gerar: { nome: string; aparelho: string; ultimo: string | null; passos: Passo[]; ultimoNoFim: string | null }[];
      comparar: { a: string; b: string; espera: number }[];
      maior: { versoes: string[]; espera: string }[];
      formato: { versao: string; valido: boolean }[];
    }>('hlc.json');
    expect(d.gerar.length).toBeGreaterThan(5);
    for (const r of d.gerar) {
      let fisico = 0;
      const relogio = new Relogio({ aparelho: r.aparelho, ultimo: r.ultimo, agora: () => fisico });
      let anterior = '';
      for (const [i, p] of r.passos.entries()) {
        if (p.op === 'absorver') {
          relogio.absorver(p.versao);
          continue;
        }
        fisico = p.fisico;
        const v = relogio.agora();
        expect(v, `${r.nome}, passo ${i + 1}`).toBe(p.espera);
        expect(ehHlc(v)).toBe(true);
        expect(v > anterior, `${r.nome}: sempre maior que a anterior`).toBe(true);
        anterior = v;
      }
      expect(relogio.ultimo, r.nome).toBe(r.ultimoNoFim);
    }
    for (const c of d.comparar) {
      expect(compararHlc(c.a, c.b), `${c.a} x ${c.b}`).toBe(c.espera);
      expect(compararHlc(c.b, c.a) + c.espera).toBe(0);
    }
    for (const c of d.maior) expect(maiorHlc(...c.versoes)).toBe(c.espera);
    for (const c of d.formato) expect(ehHlc(c.versao), JSON.stringify(c.versao)).toBe(c.valido);
  });

  it('mesclar registros: campo a campo e lápide', () => {
    const d = ler<{ casos: CasoMescla[] }>('mesclar.json');
    expect(d.casos.length).toBeGreaterThan(10);
    conferirMescla(d.casos);
    // nenhum destes casos mexe em texto de cena dos dois lados: nunca há cópia
    for (const c of d.casos) expect(c.saida.copia, c.nome).toBeNull();
  });

  it('conflito de texto: a cópia, o id determinístico e a lápide', () => {
    const d = ler<{
      casos: CasoMescla[];
      copia: { perdedor: Registro; espera: Registro }[];
      id: { tempo: number; semente: string; sha256: string; espera: string }[];
      idDaCopia: { cena: string; versaoDoTexto: string; espera: string }[];
      lapide: { apagado: boolean; v: VersoesDeCampo; espera: boolean }[];
    }>('conflito-texto.json');
    expect(d.casos.length).toBeGreaterThan(8);
    conferirMescla(d.casos);
    expect(d.casos.some((c) => c.saida.copia !== null)).toBe(true);
    for (const c of d.copia) {
      const copia = copiaDeConflito(c.perdedor);
      expect(copia).toEqual(c.espera);
      expect(ehUuidV7(copia.id)).toBe(true);
      // o texto nunca se perde: a cópia leva o texto do registro que perdeu, inteiro
      expect(copia.dados['texto']).toBe(c.perdedor.dados['texto']);
      expect(copia.dados['conflito_de']).toBe(c.perdedor.id);
    }
    for (const c of d.id) {
      const bytes = new TextEncoder().encode(c.semente);
      // o SHA-256 próprio do núcleo confere com o do Node
      expect(hex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(hex(sha256(bytes))).toBe(c.sha256);
      expect(idDeterministico(c.tempo, c.semente)).toBe(c.espera);
      expect(ehUuidV7(c.espera)).toBe(true);
    }
    for (const c of d.idDaCopia) expect(idDaCopia(c.cena, c.versaoDoTexto)).toBe(c.espera);
    for (const c of d.lapide) expect(lapide(c.apagado, c.v), JSON.stringify(c)).toBe(c.espera);
  });

  it('conflito de texto: os dois aparelhos chegam ao mesmo estado, e resolver de novo não cria outra cópia', () => {
    const d = ler<{ casos: CasoMescla[] }>('conflito-texto.json');
    const [ida, volta] = d.casos as [CasoMescla, CasoMescla];
    // o mesmo conflito com os papéis trocados
    expect(ida.entrada.local).toEqual(volta.entrada.servidor);
    expect(ida.entrada.servidor).toEqual(volta.entrada.local);
    expect(iguais(ida.saida.dados, volta.saida.dados)).toBe(true);
    expect(ida.saida.apagado).toBe(volta.saida.apagado);
    expect(ida.saida.copia).toEqual(volta.saida.copia);
    expect(ida.saida.copia).not.toBeNull();
    // segunda rodada: o resultado de um lado contra o do outro não gera mais nada
    const resultado = (c: CasoMescla, versao: string): Registro => ({ id: c.entrada.local.id, colecao: 'cenas', versao, apagado: c.saida.apagado, dados: c.saida.dados });
    const de = mesclar({ local: resultado(ida, '1794480009000-0000-aaaaaaaa'), servidor: resultado(volta, '1794480009500-0000-bbbbbbbb'), baseV: null });
    expect(de.copia).toBeNull();
    expect(de.igualAoServidor).toBe(true);
    // a cópia contra ela mesma (cada aparelho criou a sua, idênticas)
    const copia = ida.saida.copia!;
    const dasCopias = mesclar({ local: copia, servidor: copia, baseV: null });
    expect(dasCopias.copia).toBeNull();
    expect(dasCopias.igualAoServidor).toBe(true);
  });

  it('SHA-256 próprio: tamanhos em volta do bloco de 64 bytes', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(hex(sha256(bytes)), String(n)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });

  it('índice fracionário', () => {
    const d = ler<{
      alfabeto: string;
      entre: { a: string | null; b: string | null; espera: string }[];
      erro: { a: string | null; b: string | null }[];
      valida: { chave: string; valida: boolean }[];
      logoDepois: { ordem: string; espera: string }[];
      variasEntre: { a: string | null; b: string | null; n: number; espera: string[] }[];
      sequencias: Record<string, string[]>;
    }>('ordem.json');
    expect(d.entre.length).toBeGreaterThan(20);
    for (const c of d.entre) {
      const k = entre(c.a, c.b);
      expect(k, `entre(${c.a}, ${c.b})`).toBe(c.espera);
      expect(ehOrdem(k)).toBe(true);
      if (c.a !== null) expect(c.a < k).toBe(true);
      if (c.b !== null) expect(k < c.b).toBe(true);
    }
    expect(d.erro.length).toBeGreaterThan(5);
    for (const c of d.erro) expect(() => entre(c.a, c.b), `entre(${c.a}, ${c.b})`).toThrow();
    for (const c of d.valida) expect(ehOrdem(c.chave), c.chave).toBe(c.valida);
    for (const c of d.logoDepois) {
      expect(logoDepois(c.ordem)).toBe(c.espera);
      expect(c.ordem < c.espera && ehOrdem(c.espera)).toBe(true);
    }
    for (const c of d.variasEntre) expect(variasEntre(c.a, c.b, c.n)).toEqual(c.espera);
    for (const [nome, lista] of Object.entries(d.sequencias)) {
      expect(lista.length).toBeGreaterThan(10);
      expect([...lista].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), nome).toEqual(lista);
      expect(new Set(lista).size, nome).toBe(lista.length);
      for (const k of lista) expect(ehOrdem(k), k).toBe(true);
    }
    // as sequências saem da própria função
    const fim: string[] = [];
    for (let i = 0; i < d.sequencias['fim']!.length; i++) fim.push(entre(fim.at(-1) ?? null, null));
    expect(fim).toEqual(d.sequencias['fim']);
    const comeco: string[] = [];
    for (let i = 0; i < d.sequencias['comeco']!.length; i++) comeco.unshift(entre(null, comeco[0] ?? null));
    expect(comeco).toEqual(d.sequencias['comeco']);
  });
});
