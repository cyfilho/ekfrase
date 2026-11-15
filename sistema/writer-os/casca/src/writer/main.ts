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
import { baseDoServidor, conferirServidor, type EscolhaEspelho, type MetodoArmazem, type Mudanca, type RespostaCasca } from '@ekfrase/writer-nucleo';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anotar, criarJanela, ehDoApp, registrarEsquema, servirApp, travarApp, travarPermissoes, travas } from '../motor/janela.ts';
import { gravarLembrado, lerLembrado } from '../motor/pastas.ts';
import { origemDe, Rede } from '../motor/rede.ts';
import { FUSOS, SistemaLinux, SistemaSimulado, TECLADOS, type Sistema } from '../motor/sistema.ts';
import { ligarAgente } from './agente-teste.ts';
import { DadosDoWriter } from './dados.ts';
import { WriterOS } from './os.ts';

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

  const dados = new DadosDoWriter({
    lembrado: arquivoLembrado(),
    sugerida: writerOS ? writerOS.pastaDoPendrive : (env('EKFRASE_CASCA_DOCUMENTOS') ?? app.getPath('documents')),
    nativo,
    servidor: () => ({ base: rede.servidor, padrao: rede.servidor === padrao }),
    aoMudar: (alca: string, m: Mudanca) => janela?.webContents.send('armazem:mudou', alca, m),
    atrasoDoEspelho: Number(env('EKFRASE_CASCA_ESPELHO_MS') ?? 5000),
    ...(writerOS ? { os: () => ({ destino: writerOS.destino }) } : {}),
  });
  (globalThis as { ekfraseCasca?: unknown }).ekfraseCasca = { travas, dados, rede, os: writerOS };
  if (writerOS) {
    await writerOS.ligar({
      dados,
      janela: () => janela,
      versaoApp: app.getVersion(),
      sair: async () => {
        await writerOS.salvarPagina();
        await fecharDeVez();
        app.exit(0);
      },
    });
    // o que a página guarda (escrever sem conta, idioma, tema) vai cifrado para o cofre de tempos em tempos
    setInterval(() => void writerOS.salvarPagina(), 20000);
    if (sistemaOS?.caminhos.teste) writerOS.depurar = ligarAgente({ relato: join(sistemaOS.caminhos.teste, 'relato'), janela: () => janela, dados, sistema: sistemaOS });
  }

  servirApp({ sessao: sessaoPagina, host: HOST, pasta: join(__dirname, 'app'), base: '/writer/', api: (p, c) => rede.levar(p, c) });

  // ---- as mensagens da página (só da página do app; de qualquer outra coisa, nada)
  const daPagina = (e: IpcMainInvokeEvent | IpcMainEvent): boolean => !!janela && e.sender === janela.webContents && ehDoApp(e.senderFrame?.url ?? '', HOST);
  const responder = <A extends unknown[], R>(canal: string, f: (...a: A) => Promise<R> | R) =>
    ipcMain.handle(canal, async (e, ...a) => {
      if (!daPagina(e)) throw new Error('recusado');
      return f(...(a as A));
    });

  responder('casca:estado', () => dados.estado());
  responder('casca:escolher-pasta', async () => {
    // no Writer OS não há seletor de pastas (§7): os pendrives vêm pela tela "onde guardar"
    if (writerOS) return null;
    const teste = env('EKFRASE_CASCA_PASTA');
    if (teste) return teste;
    if (!janela) return null;
    const r = await dialog.showOpenDialog(janela, { properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });
  responder('casca:usar-pasta', (c: string): Promise<RespostaCasca> => (writerOS ? Promise.resolve({ ok: false, erro: 'pasta' }) : dados.usarPasta(String(c ?? ''))));
  const abriu = async (r: RespostaCasca): Promise<RespostaCasca> => {
    if (!r.ok || !writerOS) return r;
    await writerOS.aplicarEspelho();
    void writerOS.depoisDeAbrir();
    return { ok: true, estado: dados.estado() };
  };
  responder('casca:criar-senha', async (s: string) => abriu(await dados.criarSenha(String(s ?? ''))));
  responder('casca:abrir', async (s: string) => abriu(await dados.abrir(String(s ?? ''))));
  responder('casca:trancar', async () => {
    await writerOS?.salvarPagina();
    return dados.trancar();
  });

  // ---- o Writer OS: o primeiro uso e o painel do sistema (§6.3, §6.4)
  if (writerOS && sistemaOS) {
    const s = sistemaOS;
    const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
    responder('os:estado', () => writerOS.estado());
    responder('os:idioma', (c: string) => writerOS.usarIdioma(texto(c)));
    responder('os:teclados', () => [...TECLADOS]);
    responder('os:teclado', (id: string) => writerOS.usarTeclado(texto(id)));
    responder('os:fusos', () => [...FUSOS]);
    responder('os:fuso', (id: string) => writerOS.usarFuso(texto(id)));
    responder('os:passar-wifi', () => writerOS.passarWifi());
    responder('os:redes', () => s.redes());
    responder('os:conectar', (ssid: string, senha: string | null) => writerOS.conectar(texto(ssid), senha === null ? null : texto(senha)));
    responder('os:esquecer', (ssid: string) => writerOS.esquecer(texto(ssid)));
    responder('os:bateria', () => s.bateria());
    responder('os:brilho', (passo?: number) => s.brilho(typeof passo === 'number' && Number.isFinite(passo) ? Math.max(-50, Math.min(50, passo)) : undefined));
    responder('os:discos', () => s.discos());
    responder('os:guardar-em', (id: string) => writerOS.guardarEm(texto(id)));
    responder('os:guardar-na-memoria', () => writerOS.guardarNaMemoria());
    responder('os:ejetar', (id: string) => s.ejetar(texto(id)));
    responder('os:desligar', () => writerOS.desligar(false));
    responder('os:reiniciar', () => writerOS.desligar(true));
    responder('os:sobre', () => writerOS.sobre());
  }
  responder('casca:espelho', (r: EscolhaEspelho) => {
    writerOS?.lembrarEspelho(r);
    return dados.responderEspelho(r);
  });
  responder('armazem:abrir', (dono: string) => dados.abrirArmazem(String(dono ?? '')));
  responder('armazem:chamar', (alca: string, metodo: MetodoArmazem, args: unknown[]) => dados.chamar(String(alca), metodo, Array.isArray(args) ? args : []));
  ipcMain.on('armazem:fechar', (e, alca: string) => daPagina(e) && dados.fecharAlca(String(alca)));
  // o rascunho de emergência é SÍNCRONO (a página está fechando)
  ipcMain.on('rascunho:por', (e, chave: string, valor: string) => (e.returnValue = daPagina(e) && dados.porRascunho(chave, valor)));
  ipcMain.on('rascunho:tirar', (e, chave: string) => {
    if (daPagina(e)) dados.tirarRascunho(chave);
    e.returnValue = true;
  });
  ipcMain.on('rascunho:todos', (e) => (e.returnValue = daPagina(e) ? dados.rascunhos() : {}));
  responder('servidor:conferir', (endereco: string) => {
    const base = baseDoServidor(String(endereco ?? ''));
    return rede.conferir(base ? origemDe(base) : null, (buscar) => conferirServidor(String(endereco ?? ''), buscar));
  });
  responder('servidor:usar', async (base: string | null) => {
    const nova = base === null ? padrao : baseDoServidor(String(base));
    if (!nova) return;
    // trocar de servidor = outra conta: fecha os textos da conta, volta à tela de entrar
    rede.usar(nova);
    gravarLembrado(arquivoLembrado(), { ...lerLembrado(arquivoLembrado()), servidor: nova === padrao ? null : nova });
    await sessaoRede.clearStorageData({ storages: ['cookies'] });
    setTimeout(() => janela?.webContents.reload(), 50);
  });
  ipcMain.on('casca:pode-fechar', (e) => {
    if (!daPagina(e)) return;
    void fecharDeVez();
  });

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
    preload: join(__dirname, 'preload.cjs'),
    titulo: 'Ekfrase Writer',
    icone: join(__dirname, 'app', 'icones', 'icone-512.png'),
    devTools,
    argumentos: [`--ekfrase-versao=${app.getVersion()}`, ...(writerOS ? ['--ekfrase-os=1'] : [])],
    telaCheia: !!writerOS && !sistemaOS?.simulado,
  });
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
