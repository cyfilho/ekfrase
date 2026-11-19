// SPDX-License-Identifier: MPL-2.0
/**
 * A casca do computador sem o Electron (sistema/writer-os/casca): o banco cifrado, o cofre (senha
 * obrigatória, DEC-P063), os dados do Writer (pasta → senha → espelho), o espelho `.md` e as teclas
 * que nunca chegam ao Chromium. A janela, a rede e as travas de navegação rodam no Electron e são
 * conferidas por `npm run teclado` (tests/casca.spec.ts).
 */
import { DONO_LOCAL, Escrita, marcaDoComputador, nomeConfere, nomeDoDisco, servirArmazem, tipoDaParte } from '@ekfrase/writer-nucleo';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { abrirBanco, ErroDoBanco, modoDoBanco, senhaAbre } from '../sistema/writer-os/casca/src/motor/banco.ts';
import { Cofre } from '../sistema/writer-os/casca/src/motor/cofre.ts';
import { caminhoSeguro, EspelhoDePasta, LISTA } from '../sistema/writer-os/casca/src/motor/espelho.ts';
import { lerMarcador, pastaDoApp } from '../sistema/writer-os/casca/src/motor/pastas.ts';
import { destinoDaApi } from '../sistema/writer-os/casca/src/motor/destino.ts';
import { escolherLuz, lerConsulta, lerLinhaInstalar, SistemaSimulado } from '../sistema/writer-os/casca/src/motor/sistema.ts';
import { teclaProibida } from '../sistema/writer-os/casca/src/motor/teclas.ts';
import { lerEfi } from '../sistema/writer-os/casca/src/writer/agente-teste.ts';
import { DadosDoWriter, NOME_DA_PASTA } from '../sistema/writer-os/casca/src/writer/dados.ts';
import { dadosSimulados, passoDaTecla, WriterOS } from '../sistema/writer-os/casca/src/writer/os.ts';

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

// o SQLite cifrado deriva a chave a cada abertura (lento de propósito): no runner do público passava de 5 s (15/11/2026)
describe('banco cifrado (motor/banco.ts)', { timeout: 60_000 }, () => {
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

describe('cofre (senha obrigatória, rascunho de emergência)', { timeout: 60_000 }, () => {
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

describe('dados do Writer: pasta → senha → espelho', { timeout: 60_000 }, () => {
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

describe('Writer OS: importar e salvar só dentro dos pendrives (os.ts, PLANO §6.5 item 5 e §7)', () => {
  /** Um Writer OS simulado com o 2º pendrive (OUTRO) montado e um arquivo de cada tipo nele. */
  async function comPendrive() {
    const raiz = temp();
    const sistema = new SistemaSimulado(raiz, false);
    const os = new WriterOS(sistema);
    const pendrive = (await os.abrirDisco('/dev/sdb1')) as { ok: true; raiz: string };
    expect(pendrive.ok).toBe(true);
    mkdirSync(join(pendrive.raiz, 'Contos'), { recursive: true });
    writeFileSync(join(pendrive.raiz, 'Contos', 'cena.md'), '# Cena\n\nTexto.');
    writeFileSync(join(pendrive.raiz, 'historia.ekfr'), 'x');
    writeFileSync(join(pendrive.raiz, 'foto.png'), 'png');
    writeFileSync(join(pendrive.raiz, '.escondido.md'), 'oculto');
    return { raiz, os, pendrive: pendrive.raiz };
  }

  it('lista as pastas e só os arquivos que o Writer importa (pastas primeiro, sem ocultos)', async () => {
    const { os, pendrive } = await comPendrive();
    const l = await os.listar(pendrive);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.itens.map((i) => `${i.pasta ? 'pasta' : 'arquivo'}:${i.nome}`)).toEqual(['pasta:Contos', 'arquivo:historia.ekfr']);
  });

  it('lê um arquivo do pendrive e grava um novo sem passar por cima do que existe', async () => {
    const { os, pendrive } = await comPendrive();
    const lido = await os.lerArquivo(join(pendrive, 'Contos', 'cena.md'));
    expect(lido.ok && new TextDecoder().decode(lido.bytes)).toBe('# Cena\n\nTexto.');
    const bytes = new TextEncoder().encode('conteúdo');
    const a = await os.gravarArquivo(join(pendrive, 'Contos'), 'Minha história.md', bytes);
    const b = await os.gravarArquivo(join(pendrive, 'Contos'), 'Minha história.md', bytes);
    expect(a).toEqual({ ok: true, nome: 'Minha história.md' });
    expect(b).toEqual({ ok: true, nome: 'Minha história (2).md' });
    expect(readFileSync(join(pendrive, 'Contos', 'Minha história.md'), 'utf8')).toBe('conteúdo');
  });

  it('o nome do arquivo não escapa da pasta nem fica escondido', async () => {
    const { os, pendrive } = await comPendrive();
    const bytes = new Uint8Array([1]);
    const r = await os.gravarArquivo(pendrive, 'a/b\\c.md', bytes);
    expect(r).toEqual({ ok: true, nome: 'a_b_c.md' });
    expect(existsSync(join(pendrive, 'a_b_c.md'))).toBe(true);
    // "../x" vira ".._x": começa com ponto, então é recusado (nada de arquivo oculto)
    expect(await os.gravarArquivo(pendrive, '../../fora.md', bytes)).toEqual({ ok: false, erro: 'negado' });
    expect(await os.gravarArquivo(pendrive, '.oculto.md', bytes)).toEqual({ ok: false, erro: 'negado' });
    expect(await os.gravarArquivo(pendrive, '', bytes)).toEqual({ ok: false, erro: 'negado' });
  });

  it('nada fora de um pendrive: o sistema, a pasta dos textos, "..", um pendrive ejetado', async () => {
    const { raiz, os, pendrive } = await comPendrive();
    const fora = join(raiz, 'run');
    expect(await os.listar(fora)).toEqual({ ok: false, erro: 'negado' });
    expect(await os.listar(join(pendrive, '..', '..', 'run'))).toEqual({ ok: false, erro: 'negado' });
    expect(await os.listar(raiz)).toEqual({ ok: false, erro: 'negado' });
    expect(await os.lerArquivo(join(raiz, 'run', 'sistema.json'))).toEqual({ ok: false, erro: 'negado' });
    expect(await os.gravarArquivo(fora, 'a.md', new Uint8Array([1]))).toEqual({ ok: false, erro: 'negado' });
    expect(await os.listar('')).toEqual({ ok: false, erro: 'negado' });
    expect(await os.listar(undefined as unknown as string)).toEqual({ ok: false, erro: 'negado' });
    expect(await os.gravarArquivo(pendrive, 'a.md', 'texto' as unknown as Uint8Array)).toEqual({ ok: false, erro: 'grande' });
    // ejetado: o mesmo caminho deixa de valer
    await os.sistema.ejetar('/dev/sdb1');
    expect(await os.listar(pendrive)).toEqual({ ok: false, erro: 'negado' });
  });

  it('um atalho (link) no pendrive que aponta para fora não leva para fora', async () => {
    const { raiz, os, pendrive } = await comPendrive();
    try {
      symlinkSync(join(raiz, 'run'), join(pendrive, 'atalho'), 'dir');
    } catch {
      return; // sem permissão para criar link (Windows sem modo desenvolvedor): o caso é do Linux do CI
    }
    expect(await os.listar(join(pendrive, 'atalho'))).toEqual({ ok: false, erro: 'negado' });
  });
});

describe('Writer OS: o brilho e o Num Lock (pedidos de 18/11)', () => {
  it('as teclas de brilho do notebook: +10 e -10, só ao apertar', () => {
    expect(passoDaTecla({ type: 'keyDown', key: 'BrightnessUp', code: 'BrightnessUp' })).toBe(10);
    expect(passoDaTecla({ type: 'keyDown', key: 'Unidentified', code: 'BrightnessDown' })).toBe(-10);
    expect(passoDaTecla({ type: 'keyUp', key: 'BrightnessUp', code: 'BrightnessUp' })).toBe(0);
    expect(passoDaTecla({ type: 'keyDown', key: 'a', code: 'KeyA' })).toBe(0);
  });

  it('a luz da tela: a do firmware antes da da plataforma e da "raw" do driver', () => {
    expect(escolherLuz([{ nome: 'intel_backlight', tipo: 'raw' }, { nome: 'acpi_video0', tipo: 'firmware' }])).toBe('acpi_video0');
    expect(escolherLuz([{ nome: 'amdgpu_bl1', tipo: 'raw' }, { nome: 'ideapad', tipo: 'platform' }])).toBe('ideapad');
    expect(escolherLuz([{ nome: 'b', tipo: '' }, { nome: 'a', tipo: 'raw' }])).toBe('a');
    expect(escolherLuz([])).toBeUndefined();
  });

  it('a tecla muda 10% (começa em 50%), e não muda de novo se o firmware já mudou sozinho', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-brilho-'));
    const sistema = new SistemaSimulado(raiz, false);
    const os = new WriterOS(sistema);
    expect(await sistema.brilho()).toBe(50);
    expect(await os.teclaDeBrilho(10, 1)).toBe(60);
    expect(await os.teclaDeBrilho(-10, 1)).toBe(50);
    // o firmware mudou o brilho logo depois da tecla: só conta o novo
    const mudar = setTimeout(() => void sistema.brilho(-20), 5);
    expect(await os.teclaDeBrilho(10, 60)).toBe(30);
    clearTimeout(mudar);
    // segurar a tecla: um pedido por vez
    const [a, b] = await Promise.all([os.teclaDeBrilho(10, 20), os.teclaDeBrilho(10, 20)]);
    expect([a, b].filter((x) => x !== null)).toEqual([40]);
    rmSync(raiz, { recursive: true, force: true });
  });

  it('a janela apareceu: o aviso que liga o Num Lock (run/sessao/pronta)', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-numlock-'));
    const os = new WriterOS(new SistemaSimulado(raiz, false));
    os.sessaoPronta();
    expect(readFileSync(join(raiz, 'run', 'sessao', 'pronta'), 'utf8')).toMatch(/^\d+ \d+\n$/);
    rmSync(raiz, { recursive: true, force: true });
  });
});
describe('Writer OS: instalar no computador (PLANO §8c, fase 3d)', () => {
  const T = String.fromCharCode(9);
  const N = String.fromCharCode(10);
  const linhas = (...l: string[][]) => l.map((c) => c.join(T)).join(N) + N;

  it('lê o consultar do ekfrase-instalar.sh (discos, partições em ordem, o maior livre) e exige o fim', () => {
    const saida = linhas(
      ['boot', 'usb'],
      ['uefi', 'sim'],
      ['disco', 'nvme0n1', '256060514304', '237296943104', '17179869184', 'gpt', 'nao', 'SAMSUNG MZ'],
      ['parte', 'nvme0n1', '122683392', '236870000000', 'ntfs', 'Basic data partition', 'Windows'],
      ['parte', 'nvme0n1', '1048576', '104857600', 'vfat', 'EFI system partition', 'SYSTEM'],
      ['disco', 'sda', '500107862016', '0', '0', 'dos', 'nao', ''],
      ['fim'],
    );
    const info = lerConsulta(saida);
    expect(info?.uefi).toBe(true);
    expect(info?.discos.map((d) => d.id)).toEqual(['nvme0n1', 'sda']);
    const d = info!.discos[0]!;
    expect(d).toMatchObject({ tamanho: 256060514304, livreInicio: 237296943104, livre: 17179869184, tabela: 'gpt', writer: false, modelo: 'SAMSUNG MZ' });
    expect(d.partes.map((p) => p.rotulo)).toEqual(['SYSTEM', 'Windows']);
    expect(info!.discos[1]!.tabela).toBe('dos');
    // cortada no meio (o serviço caiu): nada
    expect(lerConsulta(saida.replace(`fim${N}`, ''))).toBeNull();
    expect(lerConsulta(linhas(['uefi', 'nao'], ['fim']))).toEqual({ uefi: false, discos: [] });
  });

  it('lê o progresso do instalar: passos, ok, erro (código desconhecido vira falhou)', () => {
    expect(lerLinhaInstalar(['passo', 'copiar', '100', '600'].join(T))).toEqual({ passo: 'copiar', feito: 100, total: 600 });
    expect(lerLinhaInstalar(['passo', 'particoes'].join(T))).toEqual({ passo: 'particoes', feito: 0, total: 0 });
    expect(lerLinhaInstalar('ok')).toEqual({ ok: true });
    expect(lerLinhaInstalar(['erro', 'sem-espaco'].join(T))).toEqual({ ok: false, erro: 'sem-espaco' });
    expect(lerLinhaInstalar(['erro', 'pedido'].join(T))).toEqual({ ok: false, erro: 'falhou' });
    expect(lerLinhaInstalar(['passo', 'rm -rf'].join(T))).toBeNull();
    expect(lerLinhaInstalar('qualquer coisa')).toBeNull();
  });

  const comBoot = (lugar: string) => {
    const raiz = temp();
    const sistema = new SistemaSimulado(raiz, false);
    mkdirSync(sistema.caminhos.dados, { recursive: true });
    writeFileSync(join(sistema.caminhos.run, 'dados.json'), JSON.stringify({ modo: 'pendrive', motivo: '', lugar }));
    return { sistema, os: new WriterOS(sistema) };
  };

  it('o estado diz de onde ligou; "Só pelo pendrive" fica lembrado no sistema.json', () => {
    expect(comBoot('computador').os.estado()).toMatchObject({ boot: 'computador', usoVisto: false, instalado: false });
    expect(comBoot('').os.estado().boot).toBe('outro');
    const { os, sistema } = comBoot('usb');
    expect(os.estado()).toMatchObject({ boot: 'usb', usoVisto: false });
    expect(os.passarUso().usoVisto).toBe(true);
    expect(JSON.parse(readFileSync(join(sistema.caminhos.run, 'sistema.json'), 'utf8')).uso).toBe('pendrive');
    expect(dadosSimulados(true, 'computador')).toContain('"lugar":"computador"');
    expect(dadosSimulados(false, undefined)).toContain('"lugar":"usb"');
  });

  it('instalar: só ligado pelo pendrive, só um nome de disco do kernel; o progresso chega e o estado vira instalado', async () => {
    expect(await comBoot('computador').os.instalar('nvme0n1', true)).toEqual({ ok: false, erro: 'nao-usb' });
    const { os, sistema } = comBoot('usb');
    expect(await os.instalar('nvme0n1; reboot', true)).toEqual({ ok: false, erro: 'disco' });
    expect(await os.instalar('/dev/nvme0n1', true)).toEqual({ ok: false, erro: 'disco' });
    const passos: string[] = [];
    os.ouvirInstalacao((p) => passos.push(p));
    let fim = '';
    os.aoInstalar = (r) => (fim = r);
    const r = await os.instalar('nvme0n1', true);
    expect(r.ok && r.estado.instalado).toBe(true);
    expect(fim).toBe('ok');
    expect(new Set(passos)).toEqual(new Set(['particoes', 'copiar', 'conferir', 'textos', 'entrada']));
    expect(sistema.instalou).toEqual({ disco: 'nvme0n1', levar: true });
    // instalado, não instala de novo
    expect(await os.instalar('nvme0n1', true)).toEqual({ ok: false, erro: 'ja-instalado' });
  });

  it('o agente lê o BootOrder e a entrada "Ekfrase Writer OS" das variáveis do firmware', () => {
    const pasta = temp();
    const G = '8be4df61-93ca-11d2-aa0d-00e098032b8c';
    const atr = Buffer.from([7, 0, 0, 0]);
    const u16 = (...n: number[]) => Buffer.from(new Uint16Array(n).buffer);
    writeFileSync(join(pasta, `BootOrder-${G}`), Buffer.concat([atr, u16(0x0001, 0x0000, 0x0003)]));
    const opcao = (nome: string) => Buffer.concat([atr, Buffer.from([1, 0, 0, 0]), u16(4), Buffer.from(nome + String.fromCharCode(0), 'utf16le'), Buffer.from([0x7f, 0xff, 4, 0])]);
    writeFileSync(join(pasta, `Boot0001-${G}`), opcao('Windows Boot Manager'));
    writeFileSync(join(pasta, `Boot0003-${G}`), opcao('Ekfrase Writer OS'));
    writeFileSync(join(pasta, `Boot0003-00000000-0000-0000-0000-000000000000`), opcao('Ekfrase Writer OS'));
    expect(lerEfi(pasta)).toEqual({ ordem: '0001,0000,0003', writer: ['0003'] });
    expect(lerEfi(join(pasta, 'nao-existe'))).toEqual({ ordem: null, writer: [] });
  });
});

describe('Writer OS: apagar o disco inteiro e a marca do computador (W3f)', () => {
  const comInterno = (interno: string, marca?: string) => {
    const antes = { i: process.env['EKFRASE_CASCA_OS_INTERNO'], m: process.env['EKFRASE_CASCA_OS_MARCA'] };
    process.env['EKFRASE_CASCA_OS_INTERNO'] = interno;
    if (marca === undefined) delete process.env['EKFRASE_CASCA_OS_MARCA'];
    else process.env['EKFRASE_CASCA_OS_MARCA'] = marca;
    const raiz = temp();
    const sistema = new SistemaSimulado(raiz, false);
    if (antes.i === undefined) delete process.env['EKFRASE_CASCA_OS_INTERNO'];
    else process.env['EKFRASE_CASCA_OS_INTERNO'] = antes.i;
    mkdirSync(sistema.caminhos.dados, { recursive: true });
    writeFileSync(join(sistema.caminhos.run, 'dados.json'), JSON.stringify({ modo: 'pendrive', motivo: '', lugar: 'usb' }));
    const os = new WriterOS(sistema);
    // a marca é lida a cada estado(): a variável fica até o fim do teste
    return { sistema, os, fim: () => (antes.m === undefined ? delete process.env['EKFRASE_CASCA_OS_MARCA'] : (process.env['EKFRASE_CASCA_OS_MARCA'] = antes.m)) };
  };

  it('o passo "apagar" e o erro "confirmacao" do serviço', () => {
    expect(lerLinhaInstalar('passo\tapagar')).toEqual({ passo: 'apagar', feito: 0, total: 0 });
    expect(lerLinhaInstalar('erro\tconfirmacao')).toEqual({ ok: false, erro: 'confirmacao' });
  });

  it('a marca pelo sys_vendor do firmware', () => {
    expect(marcaDoComputador('LENOVO')).toBe('lenovo');
    expect(marcaDoComputador('Dell Inc.')).toBe('dell');
    expect(marcaDoComputador('HP')).toBe('hp');
    expect(marcaDoComputador('Hewlett-Packard')).toBe('hp');
    expect(marcaDoComputador('ASUSTeK COMPUTER INC.')).toBe('asus');
    expect(marcaDoComputador('Micro-Star International Co., Ltd.')).toBe('msi');
    expect(marcaDoComputador('SAMSUNG ELECTRONICS CO., LTD.')).toBe('samsung');
    expect(marcaDoComputador('Positivo Tecnologia SA')).toBe('positivo');
    expect(marcaDoComputador('Acer')).toBe('acer');
    expect(marcaDoComputador('QEMU')).toBe('outra');
    expect(marcaDoComputador('')).toBe('outra');
    expect(marcaDoComputador('HPE-ish')).toBe('outra');
  });

  it('o nome digitado (a regra do Gravador) e o que é cada partição', () => {
    const d = { modelo: '  Samsung  SSD 980 ', id: 'nvme0n1' };
    expect(nomeDoDisco(d)).toBe('Samsung  SSD 980');
    expect(nomeConfere(d, 'samsung ssd 980')).toBe(true);
    expect(nomeConfere(d, ' SAMSUNG SSD   980 ')).toBe(true);
    expect(nomeConfere(d, 'samsung')).toBe(false);
    expect(nomeConfere(d, '')).toBe(false);
    expect(nomeConfere({ modelo: '', id: 'vda' }, 'vda')).toBe(true);
    const p = (fs: string, nome = '', rotulo = '', tamanho = 100 * 1024 ** 3) => ({ inicio: 0, tamanho, fs, nome, rotulo });
    expect(tipoDaParte(p('ntfs', 'Basic data partition', 'Windows'))).toBe('windows');
    expect(tipoDaParte(p('BitLocker'))).toBe('windows');
    expect(tipoDaParte(p('', 'Microsoft reserved partition', '', 16 * 1024 ** 2))).toBe('windows');
    expect(tipoDaParte(p('ntfs', 'Basic data partition', 'Recovery', 750 * 1024 ** 2))).toBe('recuperacao');
    expect(tipoDaParte(p('vfat', 'EFI system partition', 'SYSTEM', 100 * 1024 ** 2))).toBe('efi');
    expect(tipoDaParte(p('ext4', '', 'ubuntu'))).toBe('linux');
    expect(tipoDaParte(p('swap'))).toBe('linux');
    expect(tipoDaParte(p('vfat', 'EKFRASE-BOOT', 'EKFR-BOOT'))).toBe('writer');
    expect(tipoDaParte(p('vfat', '', 'FOTOS', 64 * 1024 ** 3))).toBe('outra');
  });

  it('apagar: o nome errado não tranca nada nem chega ao serviço; o certo apaga, e o estado diz "disco todo"', async () => {
    const { os, sistema, fim } = comInterno('linux', 'Dell Inc.');
    try {
      expect(os.estado()).toMatchObject({ marca: 'dell', discoTodo: false });
      expect(await os.instalar('nvme0n1', false, 'outro disco')).toEqual({ ok: false, erro: 'confirmacao' });
      expect(await os.instalar('sda', false, 'SSD Linux Simulado')).toEqual({ ok: false, erro: 'disco' });
      expect(sistema.instalou).toBeNull();
      const passos: string[] = [];
      os.ouvirInstalacao((p) => passos.push(p));
      const r = await os.instalar('nvme0n1', true, 'ssd linux simulado');
      expect(r.ok && r.estado).toMatchObject({ instalado: true, discoTodo: true, marca: 'dell' });
      expect(passos[0]).toBe('apagar');
      expect(sistema.instalou).toEqual({ disco: 'nvme0n1', levar: true, apagar: 238 * 1024 ** 3 });
    } finally {
      fim();
    }
  });

  it('o simulado diz o tamanho do disco ao serviço: outro tamanho é outro disco', async () => {
    const { sistema, fim } = comInterno('vazio');
    try {
      const info = await sistema.consultarInstalacao();
      expect(info?.discos[0]).toMatchObject({ id: 'sda', tabela: 'nenhuma', partes: [] });
      expect(await sistema.instalar('sda', false, () => undefined, 1)).toEqual({ ok: false, erro: 'disco' });
      expect((await sistema.instalar('sda', false, () => undefined, info!.discos[0]!.tamanho)).ok).toBe(true);
    } finally {
      fim();
    }
  });
});
