// SPDX-License-Identifier: MPL-2.0

/**
 * O PROCESSO PRINCIPAL do Ekfrase Writer no computador. Junta as peças do Motor (`../motor/`:
 * janela travada, rede, banco cifrado, cofre, espelho, pastas) com o que é do Writer (`dados.ts`,
 * o armazém e o espelho `.md`) e carrega o MESMO `apps/writer` do site, empacotado em `app://writer/`.
 *
 * Variáveis para os testes e o desenvolvimento (valem só fora do instalador, menos a do perfil):
 *   EKFRASE_CASCA_PERFIL=<pasta>     o `userData` (o que o computador lembra) fica aqui
 *   EKFRASE_CASCA_DOCUMENTOS=<pasta> a pasta sugerida para os dados, em vez de Documentos
 *   EKFRASE_CASCA_PASTA=<pasta>      "Escolher outra pasta…" devolve esta, sem abrir o seletor
 *   EKFRASE_CASCA_SERVIDOR=<url>     o servidor padrão (no lugar de ekfrase.com)
 *   EKFRASE_CASCA_ESPELHO_MS=<ms>    a espera do espelho (padrão 5000)
 *   EKFRASE_CASCA_DEVTOOLS=1         DevTools (no instalador, NUNCA)
 *
 * O Writer OS (o pendrive, fase 3): `--modo-os`, que só vale no Linux da imagem (com
 * `/etc/ekfrase/writer-os`). Fora dela, para os testes e os prints, `EKFRASE_CASCA_OS=simulado` (com
 * `EKFRASE_CASCA_OS_RAIZ=<pasta>`, `EKFRASE_CASCA_OS_DADOS=pendrive|sem-dados`, `EKFRASE_CASCA_OS_TESTE=1`).
 */
import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { baseDoServidor, type Mudanca } from '@ekfrase/writer-nucleo';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anotar, criarJanela, ehDoApp, registrarEsquema, servirApp, travarApp, travarPermissoes, travas } from '../motor/janela.ts';
import { lerLembrado } from '../motor/pastas.ts';
import { Rede } from '../motor/rede.ts';
import { SistemaLinux, SistemaSimulado, type Sistema } from '../motor/sistema.ts';
import { ligarAgente } from './agente-teste.ts';
import { chamarCanal, criarCanais } from './canais.ts';
import { DadosDoWriter } from './dados.ts';
import { passoDaTecla, WriterOS } from './os.ts';
import { paginaDoElectron } from './pagina.ts';

const HOST = 'writer';
const PADRAO = 'https://ekfrase.com/api/v1/';
const empacotado = app.isPackaged;
const env = (n: string): string | undefined => (empacotado ? undefined : process.env[n] || undefined);

const perfil = process.env['EKFRASE_CASCA_PERFIL'];
if (perfil) app.setPath('userData', perfil);
app.setName('Ekfrase Writer');
if (process.platform === 'win32') app.setAppUserModelId('com.ekfrase.writer');

registrarEsquema('app');
const devTools = !empacotado && process.env['EKFRASE_CASCA_DEVTOOLS'] === '1';
travarApp(devTools);

// uma casca só: duas abririam os mesmos bancos
if (!app.requestSingleInstanceLock()) app.quit();

// ---- o Writer OS (o pendrive) ou o simulado dele
function sistemaDoOS(): Sistema | null {
  if (env('EKFRASE_CASCA_OS') === 'simulado') {
    const raiz = env('EKFRASE_CASCA_OS_RAIZ') ?? join(tmpdir(), 'ekfrase-os-simulado');
    const s = new SistemaSimulado(raiz, env('EKFRASE_CASCA_OS_TESTE') === '1');
    // o que o ekfrase-dados.service da imagem teria achado
    const comDados = (env('EKFRASE_CASCA_OS_DADOS') ?? 'pendrive') === 'pendrive';
    if (comDados) mkdirSync(s.caminhos.dados, { recursive: true });
    writeFileSync(join(s.caminhos.run, 'dados.json'), JSON.stringify(comDados ? { modo: 'pendrive', motivo: '' } : { modo: 'sem-dados', motivo: 'sem-espaco' }));
    return s;
  }
  if (process.argv.includes('--modo-os') && process.platform === 'linux' && existsSync('/etc/ekfrase/writer-os')) return new SistemaLinux(existsSync('/etc/ekfrase/teste'));
  return null;
}
const sistemaOS = sistemaDoOS();
const writerOS = sistemaOS ? new WriterOS(sistemaOS) : null;
if (writerOS) {
  // o idioma escolhido no primeiro uso; antes da escolha, o português (a lista começa nele)
  app.commandLine.appendSwitch('lang', writerOS.idiomaGuardado() ?? 'pt-BR');
  // a máquina virtual do teste não tem GPU
  if (sistemaOS?.caminhos.teste && !sistemaOS.simulado) app.disableHardwareAcceleration();
}

const nativo = join(empacotado ? process.resourcesPath : __dirname, 'nativo', 'better_sqlite3.node');
const padrao = baseDoServidor(env('EKFRASE_CASCA_SERVIDOR') ?? '') ?? PADRAO;
const arquivoLembrado = (): string => join(app.getPath('userData'), 'casca.json');

/** Para os testes (`electronApp.evaluate`): o que foi bloqueado e os dados. */
(globalThis as { ekfraseCasca?: unknown }).ekfraseCasca = { travas };

let janela: BrowserWindow | null = null;
let podeFechar = false;

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  }
});

const pagina = paginaDoElectron(() => janela);

void app.whenReady().then(async () => {
  const sessaoPagina = session.fromPartition('persist:writer');
  const sessaoRede = session.fromPartition('ekfrase-rede');
  const lembrado = lerLembrado(arquivoLembrado());
  const rede = new Rede({
    sessao: sessaoRede,
    base: lembrado.servidor ?? padrao,
    aoBloquear: (url, onde) => anotar({ tipo: onde === 'pagina' ? 'rede-pagina' : 'rede', alvo: url }),
  });
  rede.travarPagina(sessaoPagina);
  travarPermissoes(sessaoPagina);
  // no Writer OS nenhum download abre o "salvar" do sistema (PLANO §6.5, §7): salvar é a tela do app, num pendrive
  if (writerOS) sessaoPagina.on('will-download', (e) => e.preventDefault());

  const dados = new DadosDoWriter({
    lembrado: arquivoLembrado(),
    sugerida: writerOS ? writerOS.pastaDoPendrive : (env('EKFRASE_CASCA_DOCUMENTOS') ?? app.getPath('documents')),
    nativo,
    servidor: () => ({ base: rede.servidor, padrao: rede.servidor === padrao }),
    aoMudar: (alca: string, m: Mudanca) => pagina.enviar('armazem:mudou', alca, m),
    atrasoDoEspelho: Number(env('EKFRASE_CASCA_ESPELHO_MS') ?? 5000),
    ...(writerOS ? { os: () => ({ destino: writerOS.destino }) } : {}),
  });
  (globalThis as { ekfraseCasca?: unknown }).ekfraseCasca = { travas, dados, rede, os: writerOS };
  if (writerOS) {
    await writerOS.ligar({
      dados,
      pagina,
      versaoApp: app.getVersion(),
      sair: async () => {
        await writerOS.salvarPagina();
        await fecharDeVez();
        app.exit(0);
      },
    });
    // o que a página guarda (escrever sem conta, idioma, tema) vai cifrado para o cofre de tempos em tempos
    setInterval(() => void writerOS.salvarPagina(), 20000);
    if (sistemaOS?.caminhos.teste) writerOS.depurar = ligarAgente({ relato: join(sistemaOS.caminhos.teste, 'relato'), pagina, dados, sistema: sistemaOS });
  }

  servirApp({ sessao: sessaoPagina, host: HOST, pasta: join(__dirname, 'app'), base: '/writer/', api: (p, c) => rede.levar(p, c) });

  // ---- as mensagens da página (só da página do app; de qualquer outra coisa, nada): a tabela é a de canais.ts
  const daPagina = (e: IpcMainInvokeEvent | IpcMainEvent): boolean => !!janela && e.sender === janela.webContents && ehDoApp(e.senderFrame?.url ?? '', HOST);
  const canais = criarCanais({
    dados,
    rede,
    padrao,
    lembrado: arquivoLembrado(),
    writerOS,
    sistema: sistemaOS,
    escolherPasta: async () => {
      const teste = env('EKFRASE_CASCA_PASTA');
      if (teste) return teste;
      if (!janela) return null;
      const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    depoisDeTrocarServidor: async () => {
      await sessaoRede.clearStorageData({ storages: ['cookies'] });
      setTimeout(() => janela?.webContents.reload(), 50);
    },
    podeFechar: () => void fecharDeVez(),
  });
  for (const [canal, f] of Object.entries(canais.pedidos))
    ipcMain.handle(canal, async (e, ...a: unknown[]) => {
      if (!daPagina(e)) throw new Error('recusado');
      return chamarCanal(f, a);
    });
  // o rascunho de emergência é SÍNCRONO (a página está fechando)
  for (const [canal, f] of Object.entries(canais.sincronos)) ipcMain.on(canal, (e, ...a: unknown[]) => (e.returnValue = daPagina(e) ? chamarCanal(f, a) : canal === 'rascunho:todos' ? {} : false));
  for (const [canal, f] of Object.entries(canais.avisos)) ipcMain.on(canal, (e, ...a: unknown[]) => void (daPagina(e) && chamarCanal(f, a)));

  const fecharDeVez = async () => {
    if (podeFechar) return;
    podeFechar = true;
    await writerOS?.salvarPagina();
    await dados.trancar().catch(() => undefined);
    janela?.destroy();
  };

  janela = criarJanela({
    sessao: sessaoPagina,
    host: HOST,
    // o mesmo caminho do site (ekfrase.com/writer/): o app abre direto na estante
    inicio: '/writer/',
    preload: join(__dirname, 'preload.cjs'),
    titulo: 'Ekfrase Writer',
    icone: join(__dirname, 'app', 'icones', 'icone-512.png'),
    devTools,
    argumentos: [`--ekfrase-versao=${app.getVersion()}`, ...(writerOS ? ['--ekfrase-os=1'] : [])],
    telaCheia: !!writerOS && !sistemaOS?.simulado,
  });
  // no Writer OS o Chromium nunca abre o "Sair desta página?" dele (uma caixa do sistema): quem decide é o app
  if (writerOS) janela.webContents.on('will-prevent-unload', (e) => e.preventDefault());
  if (writerOS) {
    const w = writerOS;
    // a janela apareceu: o Cage já abriu, e o sistema liga o Num Lock (ekfrase-numlock.path)
    janela.once('ready-to-show', () => w.sessaoPronta());
    // as teclas de brilho do notebook (no Cage não há quem as atenda): o recado sai na página
    janela.webContents.on('before-input-event', (_e, i) => {
      const passo = passoDaTecla(i);
      if (passo) void w.teclaDeBrilho(passo).then((n) => n !== null && pagina.enviar('os:brilho-mudou', n));
    });
  }
  // fechar: a página grava o que falta (a folha aberta), o espelho termina, os bancos fecham
  janela.on('close', (e) => {
    if (podeFechar) return;
    e.preventDefault();
    janela?.webContents.send('casca:fechar');
    setTimeout(() => void fecharDeVez(), 8000);
  });
  janela.on('closed', () => {
    janela = null;
  });
});

app.on('window-all-closed', () => app.quit());
