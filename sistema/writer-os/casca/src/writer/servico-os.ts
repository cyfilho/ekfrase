// SPDX-License-Identifier: MPL-2.0

/**
 * O SERVIÇO DO WRITER OS (o pendrive) SEM O ELECTRON (prompt P3, 18/11/2026). Faz o que o processo principal do
 * Electron (`main.ts`) fazia no Writer OS, com o Node do Debian, e o navegador passa a ser o Cog (WPE WebKit):
 *
 * - serve o MESMO `apps/writer` (o build em `app/`) em `http://127.0.0.1:47800/writer/`, só no 127.0.0.1, e confere
 *   o `Host` de todo pedido; a página nunca sai daqui (o Cog do Writer OS só navega nesta origem e tem um proxy
 *   morto para todo o resto: `imagem/cog/ekfrase.patch`, `--proxy`);
 * - atende os mesmos canais (`canais.ts`: o banco cifrado, o cofre, os `os:*`), pedidos com a ficha desta sessão
 *   (`x-ekfrase-ficha`, que só a ponte da página tem: `ponte-pagina.ts`, que o Cog injeta antes de tudo);
 * - leva o `/api/...` ao servidor escolhido (`rede-node.ts`, os cookies da conta só aqui);
 * - abre o Cog (o único filho; o Cage mostra a janela dele) e o abre de novo se ele cair; fecha os bancos ao sair.
 *
 * Roda como o filho do Cage (`imagem/raiz/usr/lib/ekfrase/ekfrase-sessao.sh` → `/opt/ekfrase-writer/ekfrase-writer`).
 * Só vale no Linux da imagem (`--modo-os` e `/etc/ekfrase/writer-os`) ou simulado, para os testes
 * (`EKFRASE_CASCA_OS=simulado`, `EKFRASE_CASCA_OS_RAIZ`, `EKFRASE_CASCA_OS_DADOS`, `EKFRASE_CASCA_OS_TESTE`,
 * `EKFRASE_CASCA_PORTA`, `EKFRASE_CASCA_PERFIL`, e `EKFRASE_CASCA_NAVEGADOR=nenhum`: sem o Cog, o teste liga o
 * navegador dele). Diz numa linha quando está pronto: `ekfrase-servico pronto <origem> <arquivo da ponte>`.
 */
import { baseDoServidor, type Mudanca } from '@ekfrase/writer-nucleo';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerLembrado } from '../motor/pastas.ts';
import { RedeNode } from '../motor/rede-node.ts';
import { anotar, arquivoDoApp, CSP } from '../motor/servir.ts';
import { SistemaLinux, SistemaSimulado, type Sistema } from '../motor/sistema.ts';
import { ligarAgente } from './agente-teste.ts';
import { chamarCanal, criarCanais } from './canais.ts';
import { DadosDoWriter } from './dados.ts';
import { deJson, paraJson } from './json-bytes.ts';
import { WriterOS } from './os.ts';
import type { Pagina } from './pagina.ts';

const PADRAO = 'https://ekfrase.com/api/v1/';
const AQUI = __dirname;
const simulado = process.env['EKFRASE_CASCA_OS'] === 'simulado';
const env = (n: string): string | undefined => (simulado ? process.env[n] || undefined : undefined);
const dizer = (linha: string) => process.stdout.write(`ekfrase-servico ${linha}\n`);

function versao(): string {
  try {
    return String((JSON.parse(readFileSync(join(AQUI, 'package.json'), 'utf8')) as { version?: string }).version ?? '');
  } catch {
    return '';
  }
}

// ---- o Writer OS (o pendrive) ou o simulado dele
function sistemaDoOS(): Sistema | null {
  if (simulado) {
    const raiz = env('EKFRASE_CASCA_OS_RAIZ') ?? join(tmpdir(), 'ekfrase-os-simulado');
    const s = new SistemaSimulado(raiz, env('EKFRASE_CASCA_OS_TESTE') === '1');
    const comDados = (env('EKFRASE_CASCA_OS_DADOS') ?? 'pendrive') === 'pendrive';
    if (comDados) mkdirSync(s.caminhos.dados, { recursive: true });
    writeFileSync(join(s.caminhos.run, 'dados.json'), JSON.stringify(comDados ? { modo: 'pendrive', motivo: '' } : { modo: 'sem-dados', motivo: 'sem-espaco' }));
    return s;
  }
  if (process.argv.includes('--modo-os') && process.platform === 'linux' && existsSync('/etc/ekfrase/writer-os')) return new SistemaLinux(existsSync('/etc/ekfrase/teste'));
  return null;
}

const sistema = sistemaDoOS();
if (!sistema) {
  process.stderr.write('ekfrase-servico: só roda no Writer OS (--modo-os, com /etc/ekfrase/writer-os) ou simulado (EKFRASE_CASCA_OS=simulado)\n');
  process.exit(2);
}
const writerOS = new WriterOS(sistema);
const PORTA = Number(env('EKFRASE_CASCA_PORTA') ?? 47800);
const HOST = `127.0.0.1:${PORTA}`;
const ORIGEM = `http://${HOST}`;
const INICIO = `${ORIGEM}/writer/`;
const ficha = randomBytes(24).toString('hex');
const perfil = env('EKFRASE_CASCA_PERFIL') ?? join(homedir(), '.config', 'Ekfrase Writer');
mkdirSync(perfil, { recursive: true });
const arquivoLembrado = join(perfil, 'casca.json');
const padrao = baseDoServidor(env('EKFRASE_CASCA_SERVIDOR') ?? '') ?? PADRAO;

// ---- a página (o Cog): recados por EventSource e pedidos com resposta (o que o Electron fazia por executeJavaScript)
const clientes = new Set<ServerResponse>();
const esperando = new Map<number, { ok: (v: unknown) => void; falhou: (e: Error) => void }>();
let proximo = 1;
const mandar = (m: unknown) => {
  const linha = `data: ${paraJson(m)}\n\n`;
  for (const c of clientes) c.write(linha);
};
const pedirAPagina = (pedido: string, arg?: string): Promise<unknown> =>
  new Promise((ok, falhou) => {
    if (!clientes.size) return falhou(new Error('sem página'));
    const id = proximo++;
    const prazo = setTimeout(() => {
      esperando.delete(id);
      falhou(new Error('a página não respondeu'));
    }, 5000);
    esperando.set(id, {
      ok: (v) => {
        clearTimeout(prazo);
        ok(v);
      },
      falhou: (e) => {
        clearTimeout(prazo);
        falhou(e);
      },
    });
    mandar({ id, pedido, arg });
  });
const pagina: Pagina = {
  aberta: () => clientes.size > 0,
  enviar: (canal, ...a) => mandar({ canal, a }),
  copiarGuardado: async () => String(await pedirAPagina('copiar-guardado')),
  porGuardado: async (json) => (await pedirAPagina('por-guardado', json)) === true,
  qualTela: async () => String((await pedirAPagina('qual-tela')) ?? ''),
  recarregar: () => mandar({ pedido: 'recarregar' }),
};

const rede = new RedeNode({ base: lerLembrado(arquivoLembrado).servidor ?? padrao, aoBloquear: (url) => anotar({ tipo: 'rede', alvo: url }) });
const dados = new DadosDoWriter({
  lembrado: arquivoLembrado,
  sugerida: writerOS.pastaDoPendrive,
  nativo: join(AQUI, 'nativo', 'better_sqlite3.node'),
  servidor: () => ({ base: rede.servidor, padrao: rede.servidor === padrao }),
  aoMudar: (alca: string, m: Mudanca) => pagina.enviar('armazem:mudou', alca, m),
  atrasoDoEspelho: Number(env('EKFRASE_CASCA_ESPELHO_MS') ?? 5000),
  os: () => ({ destino: writerOS.destino }),
});

let fechando = false;
let cog: ChildProcess | null = null;
const fecharDeVez = async (): Promise<void> => {
  if (fechando) return;
  fechando = true;
  await writerOS.salvarPagina();
  await dados.trancar().catch(() => undefined);
  cog?.kill('SIGTERM');
};
/** Fechar com a página gravando o que falta (a folha aberta): como o "close" da janela do Electron. */
let aoPoderFechar: (() => void) | null = null;
const pedirParaFechar = async (): Promise<void> => {
  if (fechando) return;
  if (clientes.size) {
    await new Promise<void>((ok) => {
      aoPoderFechar = ok;
      mandar({ canal: 'casca:fechar', a: [] });
      setTimeout(ok, 8000);
    });
  }
  await fecharDeVez();
};

const canais = criarCanais({
  dados,
  rede,
  padrao,
  lembrado: arquivoLembrado,
  writerOS,
  sistema,
  escolherPasta: async () => null,
  depoisDeTrocarServidor: async () => {
    rede.biscoitos.esquecer();
    setTimeout(() => pagina.recarregar(), 50);
  },
  podeFechar: () => (aoPoderFechar ? aoPoderFechar() : void fecharDeVez()),
});
// as teclas de brilho do notebook: a página avisa (ponte-pagina.ts), o serviço muda e conta o novo
canais.avisos['os:tecla-brilho'] = (passo: number) => {
  const p = passo === 10 || passo === -10 ? passo : 0;
  if (p) void writerOS.teclaDeBrilho(p).then((n) => n !== null && pagina.enviar('os:brilho-mudou', n));
};

// ---- o servidor (só 127.0.0.1)
const LIMITE = 100 * 1024 * 1024;
const lerCorpo = (pedido: IncomingMessage): Promise<Buffer> =>
  new Promise((ok, falhou) => {
    const partes: Buffer[] = [];
    let tamanho = 0;
    pedido.on('data', (p: Buffer) => {
      tamanho += p.length;
      if (tamanho > LIMITE) {
        falhou(new Error('grande demais'));
        pedido.destroy();
      } else partes.push(p);
    });
    pedido.on('end', () => ok(Buffer.concat(partes)));
    pedido.on('error', falhou);
  });
const temFicha = (valor: unknown): boolean => {
  if (typeof valor !== 'string' || valor.length !== ficha.length) return false;
  return timingSafeEqual(Buffer.from(valor), Buffer.from(ficha));
};
const JSON_SEM_CACHE = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

async function atender(pedido: IncomingMessage, r: ServerResponse): Promise<void> {
  // só a página do app: o Host certo (nada de outro nome apontando para cá) e, quando há, a Origin certa
  const origem = pedido.headers.origin;
  if (pedido.headers.host !== HOST || (origem !== undefined && origem !== ORIGEM)) {
    anotar({ tipo: 'ponte', alvo: `${pedido.headers.host ?? ''} ${origem ?? ''} ${pedido.url ?? ''}` });
    r.writeHead(403).end();
    return;
  }
  const u = new URL(pedido.url ?? '/', ORIGEM);
  const caminho = decodeURIComponent(u.pathname);

  if (caminho === '/casca/eventos') {
    if (!temFicha(u.searchParams.get('ficha'))) return void r.writeHead(403).end();
    r.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    r.write(': ok\n\n');
    clientes.add(r);
    pedido.on('close', () => clientes.delete(r));
    // a página abriu: o Cage já mostra a janela, e o sistema liga o Num Lock (ekfrase-numlock.path)
    if (!primeiraPagina) {
      primeiraPagina = true;
      writerOS.sessaoPronta();
      dizer('pagina aberta');
    }
    return;
  }
  if (caminho.startsWith('/casca/') || caminho.startsWith('/api/')) {
    if (!temFicha(pedido.headers['x-ekfrase-ficha'])) {
      anotar({ tipo: 'ponte', alvo: `sem ficha ${caminho}` });
      return void r.writeHead(403).end();
    }
  }
  if (caminho.startsWith('/api/')) {
    const corpo = pedido.method === 'GET' || pedido.method === 'HEAD' ? undefined : await lerCorpo(pedido);
    const cabecalhos = new Headers();
    for (const [k, v] of Object.entries(pedido.headers)) if (typeof v === 'string') cabecalhos.set(k, v);
    const resposta = await rede.levar(new Request(u, { method: pedido.method ?? 'GET', headers: cabecalhos, ...(corpo ? { body: new Uint8Array(corpo) } : {}) }), caminho.slice('/api/'.length));
    if (resposta.type === 'error') return void r.destroy();
    const volta: Record<string, string> = { 'cache-control': 'no-store' };
    resposta.headers.forEach((v, k) => (volta[k] = v));
    r.writeHead(resposta.status, volta).end(Buffer.from(await resposta.arrayBuffer()));
    return;
  }
  if (pedido.method === 'POST' && (caminho === '/casca/pedir' || caminho === '/casca/sinc' || caminho === '/casca/aviso' || caminho === '/casca/resposta')) {
    let m: { canal?: unknown; a?: unknown; id?: unknown; valor?: unknown; erro?: unknown };
    try {
      m = deJson(String(await lerCorpo(pedido)));
    } catch {
      return void r.writeHead(400).end();
    }
    if (caminho === '/casca/resposta') {
      const quem = typeof m.id === 'number' ? esperando.get(m.id) : undefined;
      if (quem && typeof m.id === 'number') {
        esperando.delete(m.id);
        if (typeof m.erro === 'string') quem.falhou(new Error(m.erro));
        else quem.ok(m.valor);
      }
      return void r.writeHead(204).end();
    }
    const canal = typeof m.canal === 'string' ? m.canal : '';
    const a = Array.isArray(m.a) ? (m.a as unknown[]) : [];
    const tabela = caminho === '/casca/pedir' ? canais.pedidos : caminho === '/casca/sinc' ? canais.sincronos : canais.avisos;
    const f = Object.hasOwn(tabela, canal) ? tabela[canal] : undefined;
    if (!f) {
      anotar({ tipo: 'ponte', alvo: `canal ${canal}` });
      return void r.writeHead(200, JSON_SEM_CACHE).end(paraJson({ ok: false, erro: 'canal' }));
    }
    if (caminho === '/casca/aviso') {
      r.writeHead(204).end();
      chamarCanal(f, a);
      return;
    }
    try {
      const valor = await chamarCanal(f, a);
      r.writeHead(200, JSON_SEM_CACHE).end(paraJson({ ok: true, valor: valor ?? null }));
    } catch (e) {
      r.writeHead(200, JSON_SEM_CACHE).end(paraJson({ ok: false, erro: e instanceof Error ? e.message : String(e) }));
    }
    return;
  }
  if (pedido.method !== 'GET' && pedido.method !== 'HEAD') return void r.writeHead(405).end();
  if (caminho === '/') return void r.writeHead(302, { location: '/writer/' }).end();
  const arq = caminho.startsWith('/writer/') || caminho === '/writer' ? await arquivoDoApp(join(AQUI, 'app'), '/writer/', caminho) : null;
  if (!arq) return void r.writeHead(404).end();
  r.writeHead(200, { 'content-type': arq.tipo, 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' }).end(pedido.method === 'HEAD' ? undefined : arq.corpo);
}

let primeiraPagina = false;

/** A ponte da página com a ficha desta sessão, num arquivo só do writer (o Cog o lê ao abrir). */
function escreverPonte(): string {
  const pasta = simulado ? join(sistema!.caminhos.run, 'sessao') : (process.env['XDG_RUNTIME_DIR'] ?? join(perfil, 'run'));
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, 'ekfrase-ponte.js');
  const config = { ficha, versao: versao() };
  writeFileSync(arquivo, `globalThis.__EKFRASE_PONTE__ = ${JSON.stringify(config)};\n${readFileSync(join(AQUI, 'ponte-pagina.js'), 'utf8')}`, { mode: 0o600 });
  chmodSync(arquivo, 0o600);
  return arquivo;
}

/** O Cog (o WPE WebKit do Debian com o remendo do Ekfrase). Se cair, abre de novo (3 vezes em 30 s; depois, sai). */
function abrirCog(ponte: string): void {
  const quedas: number[] = [];
  const abrir = () => {
    const idioma = (writerOS.idiomaGuardado() ?? 'pt-BR').replace('-', '_');
    cog = spawn(
      process.env['EKFRASE_COG'] ?? '/usr/bin/cog',
      ['--platform=wl', '--proxy=http://127.0.0.1:9', '--ignore-host=127.0.0.1', '--webprocess-failure=restart', ...(sistema!.caminhos.teste ? ['--enable-write-console-messages-to-stdout'] : []), INICIO],
      { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, EKFRASE_COG_ORIGEM: ORIGEM, EKFRASE_COG_SCRIPT: ponte, LANGUAGE: idioma } },
    );
    cog.on('exit', (codigo, sinal) => {
      cog = null;
      if (fechando) return process.exit(0);
      dizer(`o Cog saiu (${codigo ?? sinal})`);
      const agora = Date.now();
      quedas.push(agora);
      while (quedas.length && agora - (quedas[0] ?? 0) > 30000) quedas.shift();
      if (quedas.length > 3) {
        void fecharDeVez().then(() => process.exit(1));
        return;
      }
      setTimeout(abrir, 500);
    });
  };
  abrir();
}

async function ligar(): Promise<void> {
  await writerOS.ligar({
    dados,
    pagina,
    versaoApp: versao(),
    sair: async () => {
      await writerOS.salvarPagina();
      await fecharDeVez();
      setTimeout(() => process.exit(0), 200);
    },
  });
  // o que a página guarda (escrever sem conta, idioma, tema) vai cifrado para o cofre de tempos em tempos
  setInterval(() => void writerOS.salvarPagina(), 20000);
  if (sistema!.caminhos.teste) writerOS.depurar = ligarAgente({ relato: join(sistema!.caminhos.teste, 'relato'), pagina, dados, sistema: sistema! });

  const servidor = createServer((pedido, r) => {
    atender(pedido, r).catch(() => {
      if (!r.headersSent) r.writeHead(500);
      r.end();
    });
  });
  await new Promise<void>((ok, falhou) => {
    servidor.once('error', falhou);
    servidor.listen(PORTA, '127.0.0.1', () => ok());
  });
  const ponte = escreverPonte();
  dizer(`pronto ${ORIGEM} ${ponte}`);
  if ((env('EKFRASE_CASCA_NAVEGADOR') ?? 'cog') !== 'nenhum') abrirCog(ponte);

  const sair = () => void pedirParaFechar().then(() => setTimeout(() => process.exit(0), 200));
  for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(sinal, sair);
  // só no simulado (o Windows não tem SIGTERM de verdade): "fechar" na entrada fecha como o Cage fecharia
  if (simulado)
    process.stdin.on('data', (d: Buffer) => {
      if (String(d).includes('fechar')) sair();
    });
}

void ligar().catch((e: unknown) => {
  process.stderr.write(`ekfrase-servico: não abriu (${e instanceof Error ? e.stack : String(e)})\n`);
  process.exit(1);
});
