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
import { escolherLuz, estadoDoCabo, lerConsulta, lerLinhaInstalar, SistemaSimulado } from '../sistema/writer-os/casca/src/motor/sistema.ts';
import { teclaProibida } from '../sistema/writer-os/casca/src/motor/teclas.ts';
import { lerEfi } from '../sistema/writer-os/casca/src/writer/agente-teste.ts';
import { DadosDoWriter, NOME_DA_PASTA } from '../sistema/writer-os/casca/src/writer/dados.ts';
import { ARQUIVO_DO_SELO, dadosSimulados, passoDaTecla, WriterOS } from '../sistema/writer-os/casca/src/writer/os.ts';
import type { Pagina } from '../sistema/writer-os/casca/src/writer/pagina.ts';
import { abrirSelado, novoPar, publicaDaPrivada, selar } from '../sistema/writer-os/casca/src/motor/selo.ts';
import { abrirNaMesma, deixarPassar, lerConectividade, siteDe } from '../sistema/writer-os/casca/src/motor/portal-regras.ts';
import { COM_ARQUIVO_OVPN, filtrarOvpn, filtrarWireguard, nomeDaVpn, PROIBIDAS_OVPN, PROIBIDAS_WIREGUARD, qualLigarSozinha, tipoDaVpn } from '../sistema/writer-os/casca/src/motor/vpn-regras.ts';
import { lerRespostaVpn, lerVpnsNmcli } from '../sistema/writer-os/casca/src/motor/sistema.ts';

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
describe('Writer OS: a internet por cabo (Bloco D)', () => {
  it('lê o estado das placas do nmcli: sem placa, sem cabo, cabo sem endereço e cabo conectado', () => {
    expect(estadoDoCabo([])).toBeNull();
    expect(estadoDoCabo([['enp3s0', 'unavailable']])).toEqual({ conectado: false, plugado: false });
    expect(estadoDoCabo([['enp3s0', 'disconnected']])).toEqual({ conectado: false, plugado: true });
    expect(estadoDoCabo([['enp3s0', 'connecting (getting IP configuration)']])).toEqual({ conectado: false, plugado: true });
    expect(estadoDoCabo([['enp3s0', 'connected']])).toEqual({ conectado: true, plugado: true });
  });

  it('o simulado: sem placa por padrão; com o cabo plugado, "conectar" liga', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-cabo-'));
    expect(await new SistemaSimulado(raiz, false).cabo()).toBeNull();
    process.env['EKFRASE_CASCA_OS_CABO'] = 'plugado';
    try {
      const s = new SistemaSimulado(raiz, false);
      expect(await s.cabo()).toEqual({ conectado: false, plugado: true });
      expect(await s.conectarCabo()).toEqual({ ok: true });
      expect(await s.cabo()).toEqual({ conectado: true, plugado: true });
      process.env['EKFRASE_CASCA_OS_CABO'] = 'solto';
      expect(await new SistemaSimulado(raiz, false).conectarCabo()).toMatchObject({ ok: false });
    } finally {
      delete process.env['EKFRASE_CASCA_OS_CABO'];
      rmSync(raiz, { recursive: true, force: true });
    }
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

describe('Writer OS: o feedback guardado sem internet fica selado (Bloco F, segurança item 2)', { timeout: 60_000 }, () => {
  const PRINT = 'o print mostra o capitulo secreto';
  const feedback = (n: number) => ({ campos: { texto: `feedback ${n}`, app: 'writer' }, arquivos: [{ campo: 'print', nome: 'tela.png', tipo: 'image/png', bytes: new Uint8Array(Buffer.from(PRINT)) }] });
  const semPagina = { aberta: () => false } as unknown as Pagina;

  async function comPendrive(raiz = temp()) {
    const sistema = new SistemaSimulado(raiz, false);
    mkdirSync(sistema.caminhos.dados, { recursive: true });
    writeFileSync(join(sistema.caminhos.run, 'dados.json'), dadosSimulados(true, 'usb'));
    const os = new WriterOS(sistema);
    const dados = new DadosDoWriter({ lembrado: join(raiz, 'perfil', 'casca.json'), sugerida: join(raiz, 'Documentos'), servidor: () => ({ base: 'https://ekfrase.com/api/v1/', padrao: true }), atrasoDoEspelho: 0 });
    await os.ligar({ dados, pagina: semPagina, sair: async () => undefined, versaoApp: '0' });
    return { raiz, os, dados, feedbacks: join(os.pastaDoPendrive, 'feedbacks') };
  }
  const nada = (pasta: string) => {
    for (const a of todos(pasta)) expect(readFileSync(a).includes(Buffer.from('capitulo secreto')), a).toBe(false);
  };

  it('sem a chave ainda, espera na memória; dada a senha, vai ao disco selado, e trancado não abre', async () => {
    const { raiz, os, dados, feedbacks } = await comPendrive();
    expect(await os.guardarFeedback(feedback(1))).toEqual({ ok: true });
    expect(existsSync(feedbacks)).toBe(false);
    expect((await os.feedbacksGuardados()).map((f) => f.id)).toEqual([expect.stringMatching(/\.memoria$/)]);

    expect((await dados.criarSenha('senha dos testes')).ok).toBe(true);
    await os.depoisDeAbrir();
    expect(readdirSync(feedbacks)).toEqual([expect.stringMatching(/^feedback-.*\.cifrado$/)]);
    expect(existsSync(join(os.pastaDoPendrive, 'dados', ARQUIVO_DO_SELO))).toBe(true);
    const abertos = await os.feedbacksGuardados();
    expect(abertos).toHaveLength(1);
    expect(abertos[0]!.campos['texto']).toBe('feedback 1');
    expect(Buffer.from(abertos[0]!.arquivos[0]!.bytes).toString()).toBe(PRINT);

    // trancado: guarda selado na hora (a pública basta), mas só a senha lê
    await dados.trancar();
    expect(await os.guardarFeedback(feedback(2))).toEqual({ ok: true });
    expect(readdirSync(feedbacks).filter((n) => n.endsWith('.cifrado'))).toHaveLength(2);
    expect(await os.feedbacksGuardados()).toEqual([]);
    nada(raiz);

    // enviado: apagar pelo id de quando estava na memória tira o selado também
    expect((await dados.abrir('senha dos testes')).ok).toBe(true);
    await os.depoisDeAbrir();
    const ids = (await os.feedbacksGuardados()).map((f) => f.id);
    expect(ids).toHaveLength(2);
    await os.apagarFeedback(ids[0]!.replace(/\.cifrado$/, '.memoria'));
    await os.apagarFeedback('../../dados/cofre.db');
    expect(await os.feedbacksGuardados()).toHaveLength(1);
    expect(existsSync(join(os.pastaDoPendrive, 'dados', 'cofre.db'))).toBe(true);
    await dados.trancar();
  });

  it('os .json em claro das versões 0.2.4 a 0.2.6 são selados quando a senha é dada; o selo.pub trocado volta', async () => {
    const { raiz, os, dados, feedbacks } = await comPendrive();
    expect((await dados.criarSenha('senha dos testes')).ok).toBe(true);
    await os.depoisDeAbrir();
    await dados.trancar();
    mkdirSync(feedbacks, { recursive: true });
    const antigo = { campos: { texto: 'antigo' }, arquivos: [{ campo: 'print', nome: 'tela.png', tipo: 'image/png', dados: Buffer.from(PRINT).toString('base64') }] };
    writeFileSync(join(feedbacks, 'feedback-2026-11-25T10-00-00-000Z-abcd.json'), JSON.stringify(antigo));
    // alguém troca a chave pública por outra (para ler os próximos): a senha a refaz
    const pub = join(os.pastaDoPendrive, 'dados', ARQUIVO_DO_SELO);
    const certa = readFileSync(pub, 'utf8');
    writeFileSync(pub, novoPar().publica);
    // trancado, o antigo ainda é lido (era assim) e segue para o envio
    expect((await os.feedbacksGuardados()).map((f) => f.campos['texto'])).toEqual(['antigo']);

    expect((await dados.abrir('senha dos testes')).ok).toBe(true);
    await os.depoisDeAbrir();
    expect(readFileSync(pub, 'utf8')).toBe(certa);
    expect(readdirSync(feedbacks)).toEqual(['feedback-2026-11-25T10-00-00-000Z-abcd.cifrado']);
    expect((await os.feedbacksGuardados()).map((f) => f.campos['texto'])).toEqual(['antigo']);
    await dados.trancar();
    nada(raiz);
  });

  it('o selo: só a privada do par abre; mexido, não abre', () => {
    const par = novoPar();
    const s = selar(par.publica, Buffer.from(PRINT));
    expect(s.includes('capitulo')).toBe(false);
    expect(abrirSelado(par.privada, s)?.toString()).toBe(PRINT);
    expect(abrirSelado(novoPar().privada, s)).toBeNull();
    const j = JSON.parse(s) as { dados: string };
    const b = Buffer.from(j.dados, 'base64');
    b[0] = b[0]! ^ 1;
    expect(abrirSelado(par.privada, JSON.stringify({ ...j, dados: b.toString('base64') }))).toBeNull();
    expect(abrirSelado(par.privada, 'lixo')).toBeNull();
    expect(publicaDaPrivada(par.privada)).toBe(par.publica);
  });
});

describe('Writer OS: a janela do portal cativo (PLANO §7, W4)', () => {
  it('o site de cada endereço: o IP, localhost, ou os dois últimos nomes (três em com.br, co.uk…)', () => {
    expect(siteDe('http://wifi.hotel.com.br/entrar')).toBe('hotel.com.br');
    expect(siteDe('https://login.cafe.co.uk/x')).toBe('cafe.co.uk');
    expect(siteDe('https://portal.rede.net/a?b=1')).toBe('rede.net');
    expect(siteDe('http://192.168.0.1:8080/login')).toBe('192.168.0.1');
    expect(siteDe('http://[fe80::1]/')).toBe('[fe80::1]');
    expect(siteDe('http://localhost:3000/')).toBe('localhost');
    expect(siteDe('http://com.br/')).toBe('com.br');
    for (const fora of ['file:///etc/passwd', 'app://writer/writer/', 'chrome://gpu', 'javascript:alert(1)', 'ftp://x.com/', 'lixo']) expect(siteDe(fora)).toBeNull();
  });

  it('a primeira cadeia ensina os sites do portal; depois, só se navega dentro deles', () => {
    const sites = new Set<string>();
    // o teste do NetworkManager e o redirecionamento do hotel: os dois viram sites do portal
    expect(deixarPassar('http://network-test.debian.org/nm', 'principal', sites, true)).toBe(true);
    expect(deixarPassar('https://wifi.hotel.com.br/entrar', 'principal', sites, true)).toBe(true);
    expect([...sites].sort()).toEqual(['debian.org', 'hotel.com.br']);
    // depois da 1ª página: dentro do portal, sim; fora, não (página e quadro)
    expect(deixarPassar('https://pagar.hotel.com.br/ok', 'principal', sites, false)).toBe(true);
    expect(deixarPassar('https://outro-site.com/', 'principal', sites, false)).toBe(false);
    expect(deixarPassar('https://anuncio.com/q', 'quadro', sites, false)).toBe(false);
    expect(deixarPassar('https://wifi.hotel.com.br/q', 'quadro', sites, false)).toBe(true);
    // recursos (imagem, estilo, script) de outro site passam; esquemas estranhos, nunca
    expect(deixarPassar('https://cdn.exemplo.net/estilo.css', 'outro', sites, false)).toBe(true);
    expect(deixarPassar('data:image/png;base64,AAAA', 'outro', sites, false)).toBe(true);
    expect(deixarPassar('data:text/html,<b>oi</b>', 'principal', sites, false)).toBe(false);
    expect(deixarPassar('file:///dados/x', 'outro', sites, false)).toBe(false);
    expect(deixarPassar('file:///dados/x', 'principal', sites, true)).toBe(false);
    expect(deixarPassar('about:blank', 'quadro', sites, false)).toBe(true);
    expect(deixarPassar('about:blank', 'principal', sites, false)).toBe(false);
    expect(sites.size).toBe(2);
  });

  it('janela nova só se for um site do portal (e abre na mesma)', () => {
    const sites = new Set(['hotel.com.br']);
    expect(abrirNaMesma('https://termos.hotel.com.br/', sites)).toBe(true);
    expect(abrirNaMesma('https://facebook.com/', sites)).toBe(false);
    expect(abrirNaMesma('file:///etc/passwd', sites)).toBe(false);
  });

  it('o que o NetworkManager responde vira internet, portal, sem ou desconhecida', () => {
    expect(lerConectividade(' full \t')).toBe('internet');
    expect(lerConectividade('portal')).toBe('portal');
    expect(lerConectividade('limited')).toBe('sem');
    expect(lerConectividade('none')).toBe('sem');
    expect(lerConectividade('unknown')).toBe('desconhecida');
    expect(lerConectividade('')).toBe('desconhecida');
  });

  it('o simulado: sem rede = sem; com EKFRASE_CASCA_OS_PORTAL, o /nm diz se é portal', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-portal-'));
    const antes = process.env['EKFRASE_CASCA_OS_PORTAL'];
    const { createServer } = await import('node:http');
    let entrou = false;
    const srv = createServer((q, r) => {
      if (q.url === '/nm' && entrou) r.writeHead(204, { 'X-NetworkManager-Status': 'online' }).end();
      else r.writeHead(302, { location: '/entrar' }).end();
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const porta = (srv.address() as { port: number }).port;
      process.env['EKFRASE_CASCA_OS_PORTAL'] = `http://127.0.0.1:${porta}/`;
      const s = new SistemaSimulado(raiz, false);
      expect(s.enderecoDoTeste()).toBe(`http://127.0.0.1:${porta}/nm`);
      expect(await s.conectividade()).toBe('sem');
      await s.conectar('Biblioteca', null);
      expect(await s.conectividade()).toBe('portal');
      entrou = true;
      expect(await s.conectividade()).toBe('internet');
      delete process.env['EKFRASE_CASCA_OS_PORTAL'];
      const sem = new SistemaSimulado(raiz, false);
      await sem.conectar('Biblioteca', null);
      expect(sem.enderecoDoTeste()).toBeNull();
      expect(await sem.conectividade()).toBe('internet');
    } finally {
      srv.close();
      if (antes === undefined) delete process.env['EKFRASE_CASCA_OS_PORTAL'];
      else process.env['EKFRASE_CASCA_OS_PORTAL'] = antes;
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});

describe('Writer OS: a VPN (PLANO §7, W4 parte 2c)', { timeout: 60_000 }, () => {
  const CHAVE = Buffer.alloc(32, 7).toString('base64');
  const WG = `[Interface]\nPrivateKey = ${CHAVE}\nAddress = 10.0.0.2/32\n\n[Peer]\nPublicKey = ${CHAVE}\nAllowedIPs = 0.0.0.0/0\nEndpoint = vpn.exemplo.org:51820\n`;
  const OVPN = ['client', 'dev tun', 'remote vpn.escola.example 1194', 'remote 203.0.113.7 443 tcp', 'persist-tun', 'user nobody', 'auth-user-pass', '<ca>', '-----BEGIN CERTIFICATE-----', 'up /bin/sh', '-----END CERTIFICATE-----', '</ca>', 'verb 3', ''].join('\n');

  it('o tipo vem da extensão e o nome é limpo, curto (até 15) e sem repetir', () => {
    expect(tipoDaVpn('Casa.CONF')).toBe('wireguard');
    expect(tipoDaVpn('escola.ovpn')).toBe('openvpn');
    expect(tipoDaVpn('notas.txt')).toBeNull();
    expect(nomeDaVpn('Proton São Paulo #12.conf', [])).toBe('Proton-Sao-Paul');
    expect(nomeDaVpn('/media/x/../wg0.conf', [])).toBe('wg0');
    expect(nomeDaVpn('wg0.conf', ['WG0'])).toBe('wg0-2');
    expect(nomeDaVpn('....ovpn', [])).toBe('vpn');
    expect(nomeDaVpn('abcdefghijklmnopq.conf', ['abcdefghijklmno'])).toBe('abcdefghijklm-2');
  });

  it('o .ovpn: certificados embutidos e usuário/senha passam; programa e arquivo do sistema, não', () => {
    // o "up" dentro do bloco <ca> é só texto do certificado
    expect(filtrarOvpn(OVPN)).toEqual({ ok: true, pedeSenha: true, servidores: ['vpn.escola.example', '203.0.113.7'] });
    expect(filtrarOvpn('client\nremote a.example\nca [inline]\n<ca>\nx\n</ca>\n')).toMatchObject({ ok: true, pedeSenha: false });
    expect(filtrarOvpn('client\nremote a.example\nup /bin/sh -c id\n')).toEqual({ ok: false, erro: 'proibida', diretiva: 'up' });
    expect(filtrarOvpn('client\nremote a.example\n  --Script-Security 2\n')).toEqual({ ok: false, erro: 'proibida', diretiva: 'script-security' });
    expect(filtrarOvpn('client\nremote a.example\nmanagement-hold\n')).toMatchObject({ ok: false, erro: 'proibida' });
    expect(filtrarOvpn('client\nremote a.example\nplugin /x.so\n')).toMatchObject({ ok: false, erro: 'proibida' });
    expect(filtrarOvpn('client\nremote a.example\n<script>\nx\n</script>\n')).toEqual({ ok: false, erro: 'proibida', diretiva: '<script>' });
    expect(filtrarOvpn('client\nremote a.example\nca /etc/shadow\n')).toEqual({ ok: false, erro: 'arquivo', diretiva: 'ca' });
    expect(filtrarOvpn('client\nremote a.example\nauth-user-pass /etc/senha\n')).toEqual({ ok: false, erro: 'arquivo', diretiva: 'auth-user-pass' });
    expect(filtrarOvpn('client\nremote a.example\nhttp-proxy p 8080 /etc/passwd\n')).toMatchObject({ ok: false, erro: 'arquivo' });
    expect(filtrarOvpn('client\nremote a.example\nhttp-proxy p 8080 auto\n')).toMatchObject({ ok: true });
    expect(filtrarOvpn('client\n<ca>\nx\n')).toEqual({ ok: false, erro: 'invalido' });
    expect(filtrarOvpn('client\ndev tun\n')).toEqual({ ok: false, erro: 'invalido' });
    expect(filtrarOvpn('client\nremote a\n\0')).toEqual({ ok: false, erro: 'invalido' });
    // <connection> só agrupa diretivas comuns: elas são olhadas do mesmo jeito
    expect(filtrarOvpn('client\n<connection>\nremote a.example\nup /x\n</connection>\n')).toMatchObject({ ok: false, erro: 'proibida' });
  });

  it('o .conf do WireGuard: a chave e o par; PostUp e afins, não', () => {
    expect(filtrarWireguard(WG)).toEqual({ ok: true, pedeSenha: false, servidores: ['vpn.exemplo.org'] });
    expect(filtrarWireguard(WG.replace('Endpoint = vpn.exemplo.org:51820', 'Endpoint = [2001:db8::1]:51820'))).toMatchObject({ servidores: ['2001:db8::1'] });
    expect(filtrarWireguard(`${WG}PostUp = iptables -F\n`)).toEqual({ ok: false, erro: 'proibida', diretiva: 'PostUp' });
    expect(filtrarWireguard(WG.replace(/PublicKey = .*/, 'PublicKey = curta'))).toEqual({ ok: false, erro: 'invalido' });
    expect(filtrarWireguard('[Interface]\nPrivateKey = x\n')).toEqual({ ok: false, erro: 'invalido' });
    expect(filtrarWireguard('isto não é uma VPN')).toEqual({ ok: false, erro: 'invalido' });
  });

  it('o ekfrase-vpn.sh da imagem (que importa como root) recusa pela MESMA lista', () => {
    const sh = readFileSync('sistema/writer-os/imagem/raiz/usr/lib/ekfrase/ekfrase-vpn.sh', 'utf8');
    const lista = (nome: string) => (new RegExp(`^${nome}='([^']*)'$`, 'm').exec(sh)?.[1] ?? '').split('|').sort();
    expect(lista('PROIBIDAS')).toEqual([...PROIBIDAS_OVPN].sort());
    expect(lista('ARQUIVOS')).toEqual([...COM_ARQUIVO_OVPN].sort());
    expect(lista('PROIBIDAS_WG')).toEqual([...PROIBIDAS_WIREGUARD].sort());
    // o nome: o mesmo padrão da casca
    expect(sh).toContain('([A-Za-z0-9_-]{1,15})');
  });

  it('as respostas do sistema: a lista do nmcli e o que o serviço diz', () => {
    expect(lerVpnsNmcli('Casa:802-11-wireless:activated\ncasa:wireguard:activated\nescola:vpn:\nCabo:802-3-ethernet:activated\n')).toEqual([
      { nome: 'casa', tipo: 'wireguard', ligada: true },
      { nome: 'escola', tipo: 'openvpn', ligada: false },
    ]);
    expect(lerRespostaVpn('ok')).toEqual({ ok: true });
    expect(lerRespostaVpn('erro proibida')).toEqual({ ok: false, erro: 'proibida' });
    expect(lerRespostaVpn('erro importar')).toEqual({ ok: false, erro: 'invalido' });
    expect(lerRespostaVpn('erro dono')).toEqual({ ok: false, erro: 'negado' });
    expect(lerRespostaVpn(null)).toEqual({ ok: false, erro: 'falhou' });
  });

  it('Portal + VPN: a que liga sozinha só liga com a internet de verdade, uma por vez, e não a desligada à mão', () => {
    const v = (nome: string, o: Partial<{ ligada: boolean; sozinha: boolean; faltaSenha: boolean }> = {}) => ({ nome, ligada: false, sozinha: true, faltaSenha: false, ...o });
    expect(qualLigarSozinha([v('casa')], 'portal', new Set())).toBeNull();
    expect(qualLigarSozinha([v('casa')], 'sem', new Set())).toBeNull();
    expect(qualLigarSozinha([v('casa')], 'internet', new Set())).toBe('casa');
    expect(qualLigarSozinha([v('casa', { sozinha: false }), v('escola')], 'internet', new Set())).toBe('escola');
    expect(qualLigarSozinha([v('casa'), v('escola', { ligada: true })], 'internet', new Set())).toBeNull();
    expect(qualLigarSozinha([v('casa')], 'internet', new Set(['casa']))).toBeNull();
    expect(qualLigarSozinha([v('casa', { faltaSenha: true })], 'internet', new Set())).toBeNull();
  });

  it('importar, ligar com senha, o cofre e a volta no outro boot (simulado)', async () => {
    const raiz = temp();
    const semPagina = { aberta: () => false } as unknown as Pagina;
    const abrir = async () => {
      const sistema = new SistemaSimulado(raiz, false);
      mkdirSync(sistema.caminhos.dados, { recursive: true });
      writeFileSync(join(sistema.caminhos.run, 'dados.json'), dadosSimulados(true, 'usb'));
      const os = new WriterOS(sistema);
      const dados = new DadosDoWriter({ lembrado: join(raiz, 'perfil', 'casca.json'), sugerida: join(raiz, 'Documentos'), servidor: () => ({ base: 'https://ekfrase.com/api/v1/', padrao: true }), atrasoDoEspelho: 0 });
      await os.ligar({ dados, pagina: semPagina, sair: async () => undefined, versaoApp: '0' });
      return { os, dados };
    };
    const bytes = (t: string) => new Uint8Array(Buffer.from(t));
    const um = await abrir();
    expect((await um.dados.criarSenha('senha dos testes')).ok).toBe(true);
    await um.os.depoisDeAbrir();
    expect(await um.os.importarVpn('Casa.conf', bytes(WG))).toEqual({ ok: true, nome: 'Casa' });
    expect(await um.os.importarVpn('escola.ovpn', bytes(OVPN))).toEqual({ ok: true, nome: 'escola' });
    expect(await um.os.importarVpn('ruim.ovpn', bytes('client\nremote a\nup /bin/sh\n'))).toEqual({ ok: false, erro: 'proibida', diretiva: 'up' });
    expect(await um.os.importarVpn('grande.conf', new Uint8Array(70 * 1024))).toEqual({ ok: false, erro: 'grande' });
    expect(await um.os.importarVpn('notas.txt', bytes('x'))).toEqual({ ok: false, erro: 'tipo' });
    expect(await um.os.importarVpn('Casa.conf', bytes(WG))).toEqual({ ok: true, nome: 'Casa-2' });
    await um.os.esquecerVpn('Casa-2');

    expect(await um.os.ligarVpn('Casa')).toEqual({ ok: true, nome: 'Casa' });
    expect(await um.os.ligarVpn('escola')).toEqual({ ok: false, erro: 'senha' });
    expect(await um.os.ligarVpn('escola', 'aluno', 'errada')).toEqual({ ok: false, erro: 'senha' });
    expect(await um.os.ligarVpn('escola', 'aluno', 'vpn123')).toEqual({ ok: true, nome: 'escola' });
    let lista = await um.os.vpns();
    expect(lista.map((v) => [v.nome, v.ligada, v.pedeSenha, v.temSenha, v.usuario])).toEqual([
      ['Casa', false, false, false, null],
      ['escola', true, true, true, 'aluno'],
    ]);
    expect(JSON.stringify(lista)).not.toContain('vpn123');
    expect((await um.os.desligarVpn('escola')).ok).toBe(true);
    await um.os.vpnSozinha('Casa', true);
    // nada da VPN em claro no pendrive (o arquivo, o usuário e a senha vão cifrados no cofre)
    for (const a of todos(raiz)) {
      const c = readFileSync(a);
      expect(c.includes(Buffer.from('vpn.escola.example')) || c.includes(Buffer.from('vpn123')) || c.includes(Buffer.from(CHAVE)), a).toBe(false);
    }
    await um.dados.trancar();

    // o outro boot: o NetworkManager começa vazio; dada a senha, as VPNs voltam do cofre (e a que liga sozinha, com a internet)
    const dois = await abrir();
    expect(await dois.os.vpns()).toEqual([]);
    expect((await dois.dados.abrir('senha dos testes')).ok).toBe(true);
    await dois.os.depoisDeAbrir();
    await dois.os.vpnsVoltaram;
    lista = await dois.os.vpns();
    expect(lista.map((v) => [v.nome, v.temSenha, v.sozinha])).toEqual([
      ['Casa', false, true],
      ['escola', true, false],
    ]);
    // sem rede, nada liga sozinha; com a rede (o simulado: conectado = internet), a "Casa" liga
    expect(await dois.os.vezDaVpn()).toBeNull();
    expect((await dois.os.conectar('Biblioteca', null)).ok).toBe(true);
    expect(await dois.os.vezDaVpn()).toBe('Casa');
    // a senha guardada liga a escola sem perguntar
    expect(await dois.os.ligarVpn('escola')).toEqual({ ok: true, nome: 'escola' });
    await dois.dados.trancar();
  });
});
