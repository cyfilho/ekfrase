// SPDX-License-Identifier: MPL-2.0
/**
 * A casca do computador sem o Electron (sistema/writer-os/casca): o banco cifrado, o cofre (senha
 * obrigatória, DEC-P063), os dados do Writer (pasta → senha → espelho), o espelho `.md` e as teclas
 * que nunca chegam ao Chromium. A janela, a rede e as travas de navegação rodam no Electron e são
 * conferidas por `npm run teclado` (tests/casca.spec.ts).
 */
import { DONO_LOCAL, Escrita, servirArmazem } from '@ekfrase/writer-nucleo';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirBanco, ErroDoBanco, modoDoBanco, senhaAbre } from '../sistema/writer-os/casca/src/motor/banco.ts';
import { Cofre } from '../sistema/writer-os/casca/src/motor/cofre.ts';
import { caminhoSeguro, EspelhoDePasta, LISTA } from '../sistema/writer-os/casca/src/motor/espelho.ts';
import { lerMarcador, pastaDoApp } from '../sistema/writer-os/casca/src/motor/pastas.ts';
import { destinoDaApi } from '../sistema/writer-os/casca/src/motor/destino.ts';
import { teclaProibida } from '../sistema/writer-os/casca/src/motor/teclas.ts';
import { DadosDoWriter, NOME_DA_PASTA } from '../sistema/writer-os/casca/src/writer/dados.ts';

const pastas: string[] = [];
const temp = (): string => {
  const p = mkdtempSync(join(tmpdir(), 'ekfrase-casca-teste-'));
  pastas.push(p);
  return p;
};
afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

function todos(pasta: string): string[] {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n);
    return statSync(c).isDirectory() ? todos(c) : [c];
  });
}

describe('rede: para onde vai o pedido da página (motor/rede.ts)', () => {
  // a página pede app://writer/api/v1/…; a janela entrega o que vem depois de /api/
  it('a versão não entra duas vezes (o login do computador dava "rota" em 14/11)', () => {
    expect(destinoDaApi('v1/conta/eu', 'https://ekfrase.com/api/v1/')).toBe('https://ekfrase.com/api/v1/conta/eu');
    expect(destinoDaApi('/v1/conta/entrar', 'https://ekfrase.com/api/v1/')).toBe('https://ekfrase.com/api/v1/conta/entrar');
    expect(destinoDaApi('v1/escrita/lote', 'https://outro.exemplo/ekfrase/api/v1')).toBe('https://outro.exemplo/ekfrase/api/v1/escrita/lote');
  });
  it('sem a versão no caminho, segue igual', () => {
    expect(destinoDaApi('conta/eu', 'https://ekfrase.com/api/v1/')).toBe('https://ekfrase.com/api/v1/conta/eu');
  });
});

describe('banco cifrado (motor/banco.ts)', () => {
  it('WAL + synchronous=FULL; com a senha errada não abre; o texto não fica legível no arquivo', () => {
    const f = join(temp(), 'b.db');
    const db = abrirBanco(f, 'senha certa');
    expect(modoDoBanco(db)).toEqual({ journal: 'wal', synchronous: 2 });
    db.exec("CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('segredo do capítulo um')");
    db.close();
    expect(() => abrirBanco(f, 'senha errada', { deveExistir: true })).toThrow(ErroDoBanco);
    expect(senhaAbre(f, 'senha errada')).toBe(false);
    expect(senhaAbre(f, 'senha certa')).toBe(true);
    for (const a of todos(join(f, '..'))) expect(readFileSync(a).includes(Buffer.from('segredo do capítulo'))).toBe(false);
    // a tentativa errada não estragou nada
    const de = abrirBanco(f, 'senha certa', { deveExistir: true });
    expect(de.prepare('SELECT x FROM t').get()).toEqual({ x: 'segredo do capítulo um' });
    de.close();
  });

  it('sem senha não existe', () => {
    expect(() => abrirBanco(join(temp(), 'b.db'), '')).toThrow(/sem-senha/);
  });
});

describe('cofre (senha obrigatória, rascunho de emergência)', () => {
  it('cria com senha mínima, abre só com a certa e guarda o rascunho cifrado', () => {
    const pasta = temp();
    const c = new Cofre(pasta);
    expect(() => c.criar('123')).toThrow(ErroDoBanco);
    c.criar('senha boa');
    expect(c.porRascunho('writer.rascunho.x', 'texto que ia se perder')).toBe(true);
    c.fechar();
    expect(c.rascunhos()).toEqual({});
    const d = new Cofre(pasta);
    expect(() => d.abrir('outra senha')).toThrow(ErroDoBanco);
    d.abrir('senha boa');
    expect(d.rascunhos()).toEqual({ 'writer.rascunho.x': 'texto que ia se perder' });
    d.fechar();
    for (const a of todos(pasta)) expect(readFileSync(a).includes(Buffer.from('ia se perder'))).toBe(false);
  });
});

describe('dados do Writer: pasta → senha → espelho', () => {
  const novo = (base: string) =>
    new DadosDoWriter({
      lembrado: join(base, 'perfil', 'casca.json'),
      sugerida: join(base, 'Documentos'),
      servidor: () => ({ base: 'https://ekfrase.com/api/v1/', padrao: true }),
      atrasoDoEspelho: 0,
    });

  it('o caminho inteiro, e a segunda vez lembra a pasta e pede a senha', async () => {
    const base = temp();
    const d = novo(base);
    expect(d.estado()).toMatchObject({ pasta: null, aberta: false, espelho: 'perguntar' });
    expect(d.estado().sugerida).toBe(join(base, 'Documentos', NOME_DA_PASTA));
    expect(await d.usarPasta(d.estado().sugerida)).toMatchObject({ ok: true });
    expect(d.estado()).toMatchObject({ temSenha: false });
    expect(await d.criarSenha('curta')).toEqual({ ok: false, erro: 'senha-curta' });
    expect(await d.criarSenha('senha dos testes')).toMatchObject({ ok: true, estado: { aberta: true, espelho: 'perguntar' } });
    await d.responderEspelho('sempre');
    expect(lerMarcador(d.pastaDoApp!)?.espelho).toBe('sempre');

    // escreve pela ponte (como a página faz)
    const alca = await d.abrirArmazem(DONO_LOCAL);
    const r = await d.chamar(alca, 'aparelho', []);
    expect(r.ok).toBe(true);
    await d.trancar();

    // uma escrita de verdade, direto no armazém do processo principal
    const d2 = novo(base);
    expect(d2.estado()).toMatchObject({ pasta: d.pastaDoApp, temSenha: true, aberta: false });
    expect(await d2.abrir('errada')).toEqual({ ok: false, erro: 'senha' });
    expect(await d2.abrir('senha dos testes')).toMatchObject({ ok: true, estado: { aberta: true, espelho: 'sempre' } });
    await d2.trancar();
  });

  it('o espelho .md fica em dia, não é ligado sem pedir e não vaza para fora da pasta', async () => {
    const base = temp();
    const d = novo(base);
    await d.usarPasta(join(base, 'Documentos'));
    await d.criarSenha('senha dos testes');
    await d.responderEspelho('nao');
    const alca = await d.abrirArmazem(DONO_LOCAL);
    // a Escrita usa o mesmo armazém que a página usa pela ponte
    const armazem = (d as unknown as { abertos: Map<string, { armazem: Parameters<typeof servirArmazem>[0] }> }).abertos.get(DONO_LOCAL)!.armazem;
    const e = new Escrita(armazem);
    const h = await e.criarHistoria({ titulo: 'A travessia' });
    const cena = await e.criarCena(h.id);
    await e.gravarTexto(cena.id, 'O barco saiu de madrugada.');
    await d.descarregar();
    expect(todos(d.pastaDoApp!).some((f) => f.endsWith('.md'))).toBe(false);

    await d.responderEspelho('sim');
    await d.descarregar();
    const mds = todos(join(d.pastaDoApp!, 'espelho')).filter((f) => f.endsWith('.md'));
    expect(mds.some((f) => readFileSync(f, 'utf8').includes('O barco saiu de madrugada.'))).toBe(true);
    expect(d.estado().espelhoEmDia).toBe(true);
    expect(todos(base).filter((f) => f.endsWith('.md')).every((f) => f.startsWith(d.pastaDoApp!))).toBe(true);
    d.fecharAlca(alca);
    await d.trancar();
  });

  it('uma pasta que não dá para gravar é recusada', async () => {
    const base = temp();
    const arquivo = join(base, 'nao-e-pasta');
    writeFileSync(arquivo, 'x');
    expect(await novo(base).usarPasta(join(arquivo, 'dentro'))).toEqual({ ok: false, erro: 'pasta' });
  });

  it('a pasta escolhida vira a pasta do app (ou já é ela)', () => {
    expect(pastaDoApp(join('x', 'Documentos'), NOME_DA_PASTA)).toBe(join('x', 'Documentos', NOME_DA_PASTA));
    expect(pastaDoApp(join('x', NOME_DA_PASTA), NOME_DA_PASTA)).toBe(join('x', NOME_DA_PASTA));
  });
});

describe('espelho de pasta', () => {
  it('grava, apaga o que saiu e nunca toca no que a pessoa pôs lá', () => {
    const pasta = temp();
    const e = new EspelhoDePasta(pasta);
    expect(e.sincronizar({ 'A/cena.md': 'um', 'B/outra.md': 'dois' })).toEqual({ escritos: 2, apagados: 0 });
    writeFileSync(join(pasta, 'minha-nota.txt'), 'da pessoa');
    expect(e.sincronizar({ 'A/cena.md': 'um' })).toEqual({ escritos: 0, apagados: 1 });
    expect(existsSync(join(pasta, 'B'))).toBe(false);
    expect(readFileSync(join(pasta, 'minha-nota.txt'), 'utf8')).toBe('da pessoa');
    expect(existsSync(join(pasta, LISTA))).toBe(true);
  });

  it('caminhos para fora da pasta não passam', () => {
    for (const ruim of ['../fora.md', 'a/../../fora.md', '/etc/x', 'C:/x.md', 'c:\\x.md', '', 'a\0b']) expect(caminhoSeguro(ruim)).toBe(false);
    expect(caminhoSeguro('História/01 - Cena.md')).toBe(true);
    const pasta = temp();
    new EspelhoDePasta(join(pasta, 'dentro')).sincronizar({ '../fora.md': 'x' });
    expect(existsSync(join(pasta, 'fora.md'))).toBe(false);
  });
});

describe('teclas que nunca chegam ao Chromium', () => {
  const tecla = (key: string, m: Partial<{ control: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) =>
    teclaProibida({ key, control: false, shift: false, alt: false, meta: false, ...m });

  it('as do navegador são barradas', () => {
    expect(tecla('F12')).toBe(true);
    expect(tecla('F5')).toBe(true);
    expect(tecla('I', { control: true, shift: true })).toBe(true);
    expect(tecla('r', { control: true })).toBe(true);
    expect(tecla('o', { control: true })).toBe(true);
    expect(tecla('p', { control: true })).toBe(true);
    expect(tecla('w', { control: true })).toBe(true);
  });

  it('as do Writer passam', () => {
    expect(tecla('k', { control: true })).toBe(false);
    expect(tecla('i', { control: true })).toBe(false);
    expect(tecla('e', { control: true })).toBe(false);
    expect(tecla('b', { control: true })).toBe(false);
    expect(tecla('z', { control: true, shift: true })).toBe(false);
    expect(tecla('Enter', { control: true })).toBe(false);
    expect(tecla(',', { control: true })).toBe(false);
    expect(tecla('F1')).toBe(false);
    expect(tecla('F2')).toBe(false);
    expect(tecla('ArrowUp', { alt: true })).toBe(false);
  });
});
