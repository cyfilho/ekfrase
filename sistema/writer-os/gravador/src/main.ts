// SPDX-License-Identifier: MPL-2.0

/**
 * O GRAVADOR DO EKFRASE WRITER OS (PLANO §8b): o processo principal. Uma janela pequena e travada
 * (a mesma do Motor: `casca/src/motor/janela.ts`), que lista os discos USB, baixa e confere a imagem e
 * pede a permissão de administrador SÓ para o processo que grava (elevar.ts → nucleo/trabalhador.ts).
 *
 * Com `--ekfrase-trabalhador <tarefa>` (Windows, já elevado), este mesmo executável vira o processo
 * que grava: nada de janela.
 *
 * Variáveis (só fora do pacote, para os testes e o desenvolvimento): EKFRASE_GRAVADOR_DISCOS (discos
 * simulados: um JSON de `Disco[]`, cada um um arquivo), EKFRASE_GRAVADOR_API (outro "GitHub"),
 * EKFRASE_GRAVADOR_CHAVE (outra chave pública), EKFRASE_GRAVADOR_CACHE (outra pasta de cache),
 * EKFRASE_GRAVADOR_IMAGEM ("Já tenho a imagem" sem a janela de escolher arquivo). As atualizações do próprio Gravador
 * (U2): EKFRASE_GRAVADOR_VERSAO (a versão "de agora"), EKFRASE_GRAVADOR_ATUALIZAR_ALVO (o arquivo trocado no lugar do
 * `.exe`) e EKFRASE_GRAVADOR_ATUALIZACOES_ATRASO (ms até a primeira busca).
 */
import { app, dialog, ipcMain, net, session, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { criarJanela, registrarEsquema, servirApp, travarApp, travarPermissoes } from '../../casca/src/motor/janela.ts';
import { gravarElevado } from './elevar.ts';
import { ambienteSimulado } from './nucleo/ambientes.ts';
import { Atualizador, CHAVE_EKFRASE, ehVersao, lerModo, limparVelho, trocarNoLugar, type ModoAtualizacoes } from '@ekfrase/atualizacoes';
import { computadorSimulado, GB, infoDoComputador, recusaDoPreparar, TAMANHOS_GB, type InfoComputador, type Removido, type TarefaComputador } from './nucleo/computador.ts';
import { listarDiscos, resumoDoConteudo, type Disco } from './nucleo/discos.ts';
declare const __EKFRASE_CANAL__: string;
import { API_GITHUB, apagarDownload, type Canal, ErroOrigem, imagemDoArquivo, imagemDoLancamento, pastaCache, ultimoLancamento, type Buscar, type Etapa, type ImagemPronta, type Lancamento } from './nucleo/origem.ts';
import { rodarTrabalhador } from './nucleo/trabalhador.ts';
import { nomeNormalizado, SEGUNDOS_PARA_REINICIAR, type DiscoNaTela, type FaseTela, type InfoLancamento, type PedidoGravar, type Progresso, type ResultadoGravar, type ResultadoPreparar, type ResultadoReiniciar, type ResultadoRemover } from './ponte.ts';

const rodar = promisify(execFile);
const iTrabalhador = process.argv.indexOf('--ekfrase-trabalhador');

if (iTrabalhador >= 0) {
  // o processo que grava (Windows, já com a permissão de administrador): nada de janela
  app.disableHardwareAcceleration();
  rodarTrabalhador(process.argv[iTrabalhador + 1] ?? '').then(
    (c) => app.exit(c),
    () => app.exit(2),
  );
} else {
  iniciar();
}

function iniciar(): void {
  const dev = !app.isPackaged;
  const amb = (n: string) => (dev ? process.env[n] || undefined : undefined);
  const SIMULADO = amb('EKFRASE_GRAVADOR_DISCOS');
  /** O computador simulado (`livre`, `writer`, `pouco`, `legado`): só junto com os discos simulados. */
  const PC_SIMULADO = SIMULADO ? amb('EKFRASE_GRAVADOR_COMPUTADOR') : undefined;
  const API = amb('EKFRASE_GRAVADOR_API') ?? API_GITHUB;
  /** O canal vem da montagem (scripts/montar.ts: EKFRASE_GRAVADOR_CANAL=teste só no Gravador da pré-release de teste). */
  const CANAL: Canal = (amb('EKFRASE_GRAVADOR_CANAL') ?? __EKFRASE_CANAL__) === 'teste' ? 'teste' : 'estavel';
  const CHAVE = amb('EKFRASE_GRAVADOR_CHAVE') ? readFileSync(amb('EKFRASE_GRAVADOR_CHAVE')!, 'utf8') : CHAVE_EKFRASE;
  const CACHE = amb('EKFRASE_GRAVADOR_CACHE') ?? pastaCache();
  /** A versão: a da tag `writer-os-vX.Y.Z[-teste.N]` que o montou (scripts/montar.ts); nos testes, EKFRASE_GRAVADOR_VERSAO. */
  const VERSAO = amb('EKFRASE_GRAVADOR_VERSAO') ?? app.getVersion();
  const DIST = __dirname;
  /** Só fora do pacote, com EKFRASE_GRAVADOR_LOG=1: os passos no stderr (o roteiro mostra). */
  const registro = (...a: unknown[]) => {
    if (amb('EKFRASE_GRAVADOR_LOG')) console.error('[gravador]', ...a);
  };

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  registrarEsquema();
  app.setName('Ekfrase Gravador');

  let janela: BrowserWindow | null = null;
  let ultimaLista: Disco[] = [];
  let escolhida: ImagemPronta | null = null;
  let ocupado = false;
  let cancelar: AbortController | null = null;

  const protegidos = (): string[] =>
    [process.execPath, app.getAppPath(), process.env['PORTABLE_EXECUTABLE_FILE'], process.env['APPIMAGE'], CACHE, tmpdir(), app.getPath('userData'), escolhida?.arquivo].filter((x): x is string => !!x);

  const buscar: Buscar = (url, init) => net.fetch(url, init);
  const enviar = (p: Progresso) => janela?.webContents.send('gravador:progresso', p);
  const daPagina = (e: IpcMainInvokeEvent) => !!janela && e.sender === janela.webContents && (e.senderFrame?.url ?? '').startsWith('app://gravador/');

  const lerDiscos = async (): Promise<Disco[]> => (SIMULADO ? ambienteSimulado(SIMULADO).inventario() : listarDiscos({ caminhosProtegidos: protegidos() }));
  const naTela = (d: Disco): DiscoNaTela => ({ id: d.id, nome: d.nome, tamanho: d.tamanho, tipo: d.tipo, setor: d.setor, recusa: d.recusa, writerOS: d.writerOS, conteudo: resumoDoConteudo(d) });
  const etapa = (e: Etapa) => enviar({ fase: e.etapa === 'baixar' ? 'baixar' : 'conferir-imagem', feito: e.feito, total: e.total });

  let lancamento: Lancamento | null | undefined;
  const acharLancamento = async (): Promise<Lancamento | null> => {
    if (lancamento === undefined || lancamento === null) lancamento = await ultimoLancamento(buscar, API, CANAL);
    return lancamento;
  };

  const tratar = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => (e: IpcMainInvokeEvent, ...a: A): Promise<R> => {
    if (!daPagina(e)) return Promise.reject(new Error('fora da página do Gravador'));
    return f(...a);
  };

  ipcMain.handle('gravador:estado', tratar(async () => ({ versao: VERSAO, plataforma: process.platform, simulado: !!SIMULADO })));

  // ---- o Gravador se atualiza (U2, docs/ATUALIZACOES.md §5): o `.exe` portátil (ou o AppImage) trocado no lugar.
  // Vale na próxima vez que abrir; nunca no meio de uma gravação. Só com um arquivo para trocar (o pacote; nos testes,
  // EKFRASE_GRAVADOR_ATUALIZAR_ALVO): o `npm run gravador` sem ele não se atualiza.
  const arquivoAjustes = join(CACHE, 'ajustes.json');
  const lerAjustes = (): { atualizacoes?: unknown } => {
    try {
      return JSON.parse(readFileSync(arquivoAjustes, 'utf8')) as { atualizacoes?: unknown };
    } catch {
      return {};
    }
  };
  const alvo = amb('EKFRASE_GRAVADOR_ATUALIZAR_ALVO') ?? (app.isPackaged ? (process.env['PORTABLE_EXECUTABLE_FILE'] ?? process.env['APPIMAGE']) : undefined);
  if (alvo) limparVelho(alvo);
  const atrasoAt = Number(amb('EKFRASE_GRAVADOR_ATUALIZACOES_ATRASO') ?? '');
  const atualizador =
    alvo && ehVersao(VERSAO)
      ? new Atualizador({
          app: 'ekfrase-gravador',
          nome: 'Ekfrase Gravador',
          prefixo: 'writer-os-v',
          versao: VERSAO,
          canal: CANAL,
          papel: process.platform === 'linux' ? 'linux' : 'windows',
          pasta: join(CACHE, 'atualizacao'),
          modo: () => lerModo(lerAjustes().atualizacoes),
          gravarModo: (m: ModoAtualizacoes) => {
            mkdirSync(CACHE, { recursive: true });
            writeFileSync(arquivoAjustes, `${JSON.stringify({ ...lerAjustes(), atualizacoes: m }, null, 2)}\n`);
          },
          // o `.exe` aberto não pode ser apagado no Windows, mas muda de nome (vira `.velho`, apagado na próxima vez)
          preparar: (arquivo, _v, sha256) => trocarNoLugar(arquivo, alvo, { sha256, guardarVelho: process.platform === 'win32', executavel: process.platform !== 'win32' }),
          podeAgora: () => !ocupado,
          buscar,
          api: API,
          chaves: [CHAVE],
          agente: 'Ekfrase-Gravador',
          ...(Number.isFinite(atrasoAt) && atrasoAt > 0 ? { atrasoInicial: atrasoAt } : {}),
        })
      : null;
  atualizador?.aoMudar((e) => janela?.webContents.send('gravador:at-mudou', e));
  ipcMain.handle('gravador:at-estado', tratar(async () => atualizador?.estado() ?? null));
  ipcMain.handle('gravador:at-procurar', tratar(async () => atualizador?.procurar() ?? null));
  // nunca no meio de uma gravação: o botão também espera
  ipcMain.handle('gravador:at-instalar', tratar(async () => (ocupado ? (atualizador?.estado() ?? null) : (atualizador?.instalar() ?? null))));
  ipcMain.handle('gravador:at-modo', tratar(async (m: string) => atualizador?.usarModo(m === 'perguntar' ? 'perguntar' : 'automaticas') ?? null));

  // ---- o disco deste computador (PLANO §8c): preparar para instalar e remover o Writer OS
  const lerComputador = (): Promise<InfoComputador> => (SIMULADO ? Promise.resolve(computadorSimulado(PC_SIMULADO)) : infoDoComputador());
  ipcMain.handle('gravador:computador', tratar(lerComputador));
  const avisoDoTrabalhador = (a: { fase: string; feito?: number | undefined; total?: number | undefined; etapa?: string }) => {
    if (a.fase === 'computador') return enviar({ fase: 'computador', etapa: a.etapa });
    if (a.fase !== 'gravar' && a.fase !== 'verificar') registro('aviso', a.fase);
    enviar({ fase: a.fase as FaseTela, feito: a.feito, total: a.total });
  };

  ipcMain.handle(
    'gravador:remover',
    tratar(async (copiar: boolean): Promise<ResultadoRemover> => {
      if (ocupado) return { ok: false, erro: 'ocupado' };
      ocupado = true;
      try {
        const info = await lerComputador();
        if (!info.disponivel || !info.disco || !info.windows) return { ok: false, erro: 'nao-windows' };
        if (!info.writer) return { ok: false, erro: 'sem-writer' };
        const dia = new Date().toISOString().slice(0, 10);
        const destino = copiar === true ? join(SIMULADO ? tmpdir() : app.getPath('documents'), `Ekfrase Writer (Writer OS, ${dia})`) : null;
        const computador: TarefaComputador = { tipo: 'remover', disco: info.disco.numero, serial: info.disco.serial, letra: info.windows.letra, copiarPara: destino };
        enviar({ fase: 'permissao' });
        const r = await gravarElevado({
          pedido: { computador, protegidos: protegidos(), ...(SIMULADO ? { simulado: SIMULADO } : {}) },
          executavel: process.execPath,
          trabalhador: join(DIST, 'trabalhador.cjs'),
          aviso: avisoDoTrabalhador,
          semElevar: !!SIMULADO,
        });
        registro('remover', JSON.stringify(r));
        if (!r.ok) return { ok: false, erro: r.erro, detalhe: r.detalhe ?? '' };
        if (!r.computador) return { ok: false, erro: 'falhou' };
        if (!r.computador.ok) return { ok: false, erro: r.computador.erro, detalhe: r.computador.detalhe };
        const feito = JSON.parse(r.computador.resultado) as Removido;
        return { ok: true, copiado: feito.copiado, espaco: feito.espaco };
      } catch (e) {
        return { ok: false, erro: 'falhou', detalhe: String((e as Error)?.message ?? e).slice(0, 300) };
      } finally {
        ocupado = false;
      }
    }),
  );

  // ---- "Reiniciar no Writer OS": o trabalhador elevado deixa o PRÓXIMO ligar para a entrada "Ekfrase Writer OS"
  // (`bcdedit /set {fwbootmgr} bootsequence {guid}`, uma vez só); aqui, sem administrador, vem o `shutdown /r /t 5`
  // (5 s para o Cancelar: `shutdown /a`). Simulado (roteiro): nada reinicia nem cancela de verdade.
  ipcMain.handle(
    'gravador:reiniciar',
    tratar(async (): Promise<ResultadoReiniciar> => {
      if (ocupado) return { ok: false, erro: 'ocupado' };
      ocupado = true;
      try {
        const info = await lerComputador();
        if (!info.disponivel || !info.windows) return { ok: false, erro: 'nao-windows' };
        if (!info.writer) return { ok: false, erro: 'sem-writer' };
        enviar({ fase: 'permissao' });
        const r = await gravarElevado({
          pedido: { computador: { tipo: 'reiniciar' }, protegidos: protegidos(), ...(SIMULADO ? { simulado: SIMULADO } : {}) },
          executavel: process.execPath,
          trabalhador: join(DIST, 'trabalhador.cjs'),
          aviso: avisoDoTrabalhador,
          semElevar: !!SIMULADO,
        });
        registro('reiniciar', JSON.stringify(r));
        if (!r.ok) return { ok: false, erro: r.erro, detalhe: r.detalhe ?? '' };
        if (!r.computador) return { ok: false, erro: 'falhou' };
        if (!r.computador.ok) return { ok: false, erro: r.computador.erro, detalhe: r.computador.detalhe };
        if (!SIMULADO) await rodar('shutdown.exe', ['/r', '/t', String(SEGUNDOS_PARA_REINICIAR)], { windowsHide: true, timeout: 30_000 });
        return { ok: true, segundos: SEGUNDOS_PARA_REINICIAR };
      } catch (e) {
        return { ok: false, erro: 'falhou', detalhe: String((e as Error)?.message ?? e).slice(0, 300) };
      } finally {
        ocupado = false;
      }
    }),
  );
  ipcMain.handle(
    'gravador:cancelar-reinicio',
    tratar(async (): Promise<{ ok: boolean }> => {
      if (SIMULADO) return { ok: true };
      try {
        await rodar('shutdown.exe', ['/a'], { windowsHide: true, timeout: 30_000 });
        return { ok: true };
      } catch {
        return { ok: false };
      }
    }),
  );

  ipcMain.handle(
    'gravador:discos',
    tratar(async (): Promise<DiscoNaTela[]> => {
      try {
        ultimaLista = await lerDiscos();
      } catch {
        ultimaLista = [];
      }
      return ultimaLista.map(naTela);
    }),
  );

  ipcMain.handle(
    'gravador:lancamento',
    tratar(async (): Promise<InfoLancamento> => {
      try {
        const l = await acharLancamento();
        return l ? { ok: true, versao: l.versao, tamanho: l.imagem.tamanho } : { ok: false, erro: 'sem-release' };
      } catch {
        return { ok: false, erro: 'sem-rede' };
      }
    }),
  );

  ipcMain.handle(
    'gravador:escolher-imagem',
    tratar(async () => {
      let arquivo = amb('EKFRASE_GRAVADOR_IMAGEM');
      if (!arquivo) {
        const r = await dialog.showOpenDialog(janela!, { properties: ['openFile'], filters: [{ name: 'Writer OS', extensions: ['xz', 'img'] }] });
        if (r.canceled || !r.filePaths[0]) return null;
        arquivo = r.filePaths[0];
      }
      try {
        escolhida = await imagemDoArquivo(arquivo, { aviso: etapa, chave: CHAVE });
        return { ok: true as const, arquivo: escolhida.arquivo, nome: escolhida.nome, lacre: escolhida.lacre, comentario: escolhida.comentario };
      } catch (e) {
        escolhida = null;
        return { ok: false as const, erro: e instanceof ErroOrigem ? e.codigo : 'imagem-corrompida' };
      }
    }),
  );

  ipcMain.handle(
    'gravador:cancelar',
    tratar(async () => {
      cancelar?.abort();
    }),
  );

  ipcMain.handle(
    'gravador:gravar',
    tratar(async (p: PedidoGravar): Promise<ResultadoGravar> => {
      if (ocupado) return { ok: false, erro: 'ocupado' };
      ocupado = true;
      registro('gravar', p.modo, p.disco, p.origem);
      cancelar = new AbortController();
      let baixado: Lancamento | null = null;
      try {
        const d = ultimaLista.find((x) => x.id === p.disco);
        if (!d) return { ok: false, erro: 'disco-sumiu' };
        if (d.recusa) return { ok: false, erro: 'recusado' };
        if (p.modo === 'atualizar' && !d.writerOS) return { ok: false, erro: 'nao-e-writer-os' };
        if (nomeNormalizado(p.confirmacao) !== nomeNormalizado(d.nome)) return { ok: false, erro: 'confirmacao' };
        let img: ImagemPronta;
        if (p.origem === 'release') {
          const l = await acharLancamento();
          if (!l) return { ok: false, erro: 'sem-release' };
          baixado = l;
          img = await imagemDoLancamento(buscar, l, { pasta: CACHE, aviso: etapa, sinal: cancelar.signal, chave: CHAVE });
        } else {
          if (!escolhida) return { ok: false, erro: 'sem-imagem' };
          // de novo: o arquivo pode ter mudado desde que foi escolhido
          img = await imagemDoArquivo(escolhida.arquivo, { aviso: etapa, chave: CHAVE });
          if (img.lacre === 'ausente' && !p.semLacreConfirmado) return { ok: false, erro: 'sem-lacre' };
        }
        registro('imagem pronta', img.arquivo, img.lacre);
        const limiteDados = p.modo === 'criar' && p.limiteGb && p.limiteGb > 0 ? Math.floor(p.limiteGb * 1e9) : null;
        // "Também preparar este computador" (PLANO §8c): no mesmo UAC, depois de gravar; uma recusa não impede gravar
        let computador: TarefaComputador | undefined;
        let preparar: ResultadoPreparar | undefined;
        const gb = p.prepararGb;
        if (typeof gb === 'number' && (TAMANHOS_GB as readonly number[]).includes(gb)) {
          const info = await lerComputador();
          const recusa = recusaDoPreparar(info, gb);
          if (recusa || !info.disco || !info.windows) preparar = { ok: false, erro: recusa ?? 'nao-windows' };
          else computador = { tipo: 'preparar', disco: info.disco.numero, serial: info.disco.serial, letra: info.windows.letra, bytes: gb * GB };
        }
        enviar({ fase: 'permissao' });
        const r = await gravarElevado({
          pedido: { tarefa: { modo: p.modo, disco: d, imagem: { arquivo: img.arquivo, sha256: img.sha256 }, limiteDados }, ...(computador ? { computador } : {}), protegidos: protegidos(), ...(SIMULADO ? { simulado: SIMULADO } : {}) },
          executavel: process.platform === 'linux' ? (process.env['APPIMAGE'] ?? process.execPath) : process.execPath,
          trabalhador: join(DIST, 'trabalhador.cjs'),
          aviso: avisoDoTrabalhador,
          semElevar: !!SIMULADO,
        });
        registro('resultado', JSON.stringify(r));
        if (!r.ok) return { ok: false, erro: r.erro, detalhe: r.detalhe ?? '' };
        if (r.computador?.ok) preparar = { ok: true, livre: Number((JSON.parse(r.computador.resultado) as { livre?: number }).livre ?? 0) };
        else if (r.computador) preparar = { ok: false, erro: r.computador.erro, ...(r.computador.erro === 'nao-encolhe' ? { maximo: Number(r.computador.detalhe) || 0 } : {}) };
        return { ok: true, dados: r.dados, ...(preparar ? { preparar } : {}) };
      } catch (e) {
        registro('erro', e);
        return { ok: false, erro: e instanceof ErroOrigem ? e.codigo : 'escrita', detalhe: String((e as Error)?.stack ?? e).slice(0, 600) };
      } finally {
        // Bloco E: a imagem baixada não fica (dê certo ou errado); só o `.parte` de um download que caiu sobra, para retomar
        if (baixado) {
          try {
            apagarDownload(baixado, CACHE);
          } catch {
            /* o que não saiu fica para a próxima limpeza */
          }
        }
        ocupado = false;
        cancelar = null;
      }
    }),
  );

  ipcMain.handle(
    'gravador:ejetar',
    tratar(async (id: string) => {
      if (SIMULADO) return { ok: true };
      const d = (await lerDiscos()).find((x) => x.id === id);
      if (!d) return { ok: true }; // já saiu
      try {
        if (process.platform === 'win32') {
          const letra = d.particoes.flatMap((p) => p.montagens).find((m) => /^[A-Z]:$/i.test(m));
          if (letra) await rodar('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject Shell.Application).Namespace(17).ParseName('${letra}').InvokeVerb('Eject')`], { windowsHide: true, timeout: 30_000 });
        } else {
          const { particaoLinux } = await import('./nucleo/ambientes.ts');
          for (const p of d.particoes) if (p.montagens.length) await rodar('udisksctl', ['unmount', '-b', particaoLinux(d.caminho, p.numero)], { timeout: 30_000 });
          await rodar('udisksctl', ['power-off', '-b', d.caminho], { timeout: 30_000 });
        }
        return { ok: true };
      } catch {
        return { ok: false, erro: 'ejetar' };
      }
    }),
  );

  app.on('second-instance', () => {
    if (janela?.isMinimized()) janela.restore();
    janela?.focus();
  });
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    travarApp(dev && process.env['EKFRASE_GRAVADOR_DEVTOOLS'] === '1');
    const sessao = session.fromPartition('gravador');
    travarPermissoes(sessao);
    servirApp({ sessao, host: 'gravador', pasta: join(DIST, 'pagina') });
    janela = criarJanela({ sessao, host: 'gravador', preload: join(DIST, 'preload.cjs'), titulo: 'Gravador Writer OS', largura: 520, altura: 620, devTools: dev && process.env['EKFRASE_GRAVADOR_DEVTOOLS'] === '1', argumentos: [`--ekfrase-gravador-versao=${VERSAO}`] });
    atualizador?.iniciar();
    janela.on('close', (e) => {
      if (ocupado) {
        e.preventDefault();
        janela?.webContents.send('gravador:tentou-fechar');
      }
    });
    janela.on('closed', () => {
      janela = null;
    });
  });
}
