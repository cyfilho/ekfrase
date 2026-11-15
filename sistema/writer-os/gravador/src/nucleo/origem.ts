// SPDX-License-Identifier: MPL-2.0

/**
 * DE ONDE VEM A IMAGEM (PLANO §12, linhas 11 e 12):
 *
 * - do Release mais novo do Writer OS no repositório público (`cyfilho/ekfrase`, tag `writer-os-v*`):
 *   o `.img.xz`, o `.sha256` e o `.minisig`. Baixa com RETOMADA (a internet caiu: continua de onde
 *   parou) para a pasta do Gravador (`%LOCALAPPDATA%\Ekfrase\Gravador` ou `~/.cache/ekfrase-gravador`),
 *   que serve de cache na próxima vez. O download SEMPRE exige o lacre válido.
 * - ou de um arquivo que a pessoa já tem ("Já tenho a imagem"): o `.sha256` e o `.minisig` ao lado,
 *   se houver. Lacre presente e errado, ou SHA-256 diferente = recusa. Sem lacre = aceita, mas só com o
 *   aviso vermelho e a confirmação escrita (quem faz o próprio Writer OS consegue gravar).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { CHAVE_EKFRASE } from './chave.ts';
import { Fluxo, lerCabecaImagem, ErroImagem } from './imagem.ts';
import { conferirAssinatura, hashesDoArquivo, lerChavePublica, lerSha256 } from './minisign.ts';

export const REPOSITORIO = 'cyfilho/ekfrase';
export const PREFIXO_TAG = 'writer-os-v';
export const API_GITHUB = 'https://api.github.com';

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

export class ErroOrigem extends Error {
  readonly codigo: 'sem-rede' | 'sem-release' | 'lacre-invalido' | 'sha-diferente' | 'nao-e-writer-os' | 'imagem-corrompida' | 'cancelado' | 'sem-espaco';
  readonly detalhe: string;
  constructor(codigo: ErroOrigem['codigo'], detalhe = '') {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

export interface Lancamento {
  tag: string;
  versao: string;
  imagem: { nome: string; url: string; tamanho: number };
  sha256: string;
  minisig: string;
}

const versao = (v: string) => v.split('.').map((x) => Number(x));
const maisNova = (a: string, b: string) => {
  const x = versao(a);
  const y = versao(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

interface ReleaseGitHub {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

/** O Release mais novo do Writer OS que tem os três arquivos (ou null: ainda não publicado). */
export async function ultimoLancamento(buscar: Buscar, api = API_GITHUB): Promise<Lancamento | null> {
  let r: Response;
  try {
    r = await buscar(`${api}/repos/${REPOSITORIO}/releases?per_page=50`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Ekfrase-Gravador' } });
  } catch (e) {
    throw new ErroOrigem('sem-rede', (e as Error).message);
  }
  if (r.status === 404) return null;
  if (!r.ok) throw new ErroOrigem('sem-rede', `HTTP ${r.status}`);
  const lista = (await r.json()) as ReleaseGitHub[];
  const candidatos = lista
    .filter((x) => !x.draft && !x.prerelease && typeof x.tag_name === 'string' && /^\d+\.\d+\.\d+$/.test(x.tag_name.slice(PREFIXO_TAG.length)) && x.tag_name.startsWith(PREFIXO_TAG))
    .sort((a, b) => maisNova(b.tag_name!.slice(PREFIXO_TAG.length), a.tag_name!.slice(PREFIXO_TAG.length)));
  for (const c of candidatos) {
    const arquivos = c.assets ?? [];
    const img = arquivos.find((a) => /^ekfrase-writer-os-[\w.-]+\.img\.xz$/.test(a.name ?? ''));
    const sha = img && arquivos.find((a) => a.name === `${img.name}.sha256`);
    const sig = img && arquivos.find((a) => a.name === `${img.name}.minisig`);
    if (img?.browser_download_url && sha?.browser_download_url && sig?.browser_download_url) {
      return { tag: c.tag_name!, versao: c.tag_name!.slice(PREFIXO_TAG.length), imagem: { nome: img.name!, url: img.browser_download_url, tamanho: img.size ?? 0 }, sha256: sha.browser_download_url, minisig: sig.browser_download_url };
    }
  }
  return null;
}

const esperar = (ms: number, sinal?: AbortSignal) =>
  new Promise<void>((ok, nao) => {
    const t = setTimeout(ok, ms);
    sinal?.addEventListener('abort', () => {
      clearTimeout(t);
      nao(new ErroOrigem('cancelado'));
    });
  });

async function baixarTexto(buscar: Buscar, url: string): Promise<string> {
  for (let i = 0; ; i++) {
    try {
      const r = await buscar(url, { headers: { 'user-agent': 'Ekfrase-Gravador' } });
      if (r.ok) return await r.text();
      if (r.status < 500 && r.status !== 429) throw new ErroOrigem('sem-rede', `HTTP ${r.status}`);
    } catch (e) {
      if (i >= 3) throw e instanceof ErroOrigem ? e : new ErroOrigem('sem-rede', (e as Error).message);
    }
    if (i >= 3) throw new ErroOrigem('sem-rede');
    await esperar(1000 * (i + 1));
  }
}

/**
 * Baixa para `destino` com retomada: o que já veio fica em `destino.parte`; a cada queda, pede o resto
 * (`Range`). Se o servidor não aceitar o pedaço, começa de novo. Só vira `destino` quando completo.
 */
export async function baixarArquivo(buscar: Buscar, url: string, destino: string, o: { tamanho?: number | undefined; aoBaixar?: ((feito: number, total: number) => void) | undefined; sinal?: AbortSignal | undefined; tentativas?: number } = {}): Promise<void> {
  const parte = `${destino}.parte`;
  const tentativas = o.tentativas ?? 8;
  let total = o.tamanho ?? 0;
  for (let i = 0; ; i++) {
    if (o.sinal?.aborted) throw new ErroOrigem('cancelado');
    let inicio = existsSync(parte) ? statSync(parte).size : 0;
    if (total && inicio > total) {
      rmSync(parte, { force: true });
      inicio = 0;
    }
    if (total && inicio === total) break;
    try {
      const r = await buscar(url, { headers: { 'user-agent': 'Ekfrase-Gravador', ...(inicio ? { range: `bytes=${inicio}-` } : {}) }, ...(o.sinal ? { signal: o.sinal } : {}) });
      if (r.status === 416 && total && inicio === total) break;
      if (r.status !== 200 && r.status !== 206) {
        if (r.status < 500 && r.status !== 429 && r.status !== 416) throw new ErroOrigem('sem-rede', `HTTP ${r.status}`);
        throw new Error(`HTTP ${r.status}`);
      }
      if (r.status === 200) inicio = 0; // o servidor mandou o arquivo inteiro
      const comprimento = Number(r.headers.get('content-length') ?? 0);
      if (!total && comprimento) total = inicio + comprimento;
      const fh = await open(parte, inicio ? 'r+' : 'w');
      try {
        if (!inicio) await fh.truncate(0);
        let pos = inicio;
        if (!r.body) throw new Error('sem corpo');
        for await (const pedaco of r.body as unknown as AsyncIterable<Uint8Array>) {
          await fh.write(pedaco, 0, pedaco.length, pos);
          pos += pedaco.length;
          o.aoBaixar?.(pos, total);
        }
        await fh.sync();
      } finally {
        await fh.close();
      }
      const agora = statSync(parte).size;
      if (!total || agora === total) break;
      throw new Error(`veio ${agora} de ${total}`);
    } catch (e) {
      if (e instanceof ErroOrigem) throw e;
      if (o.sinal?.aborted) throw new ErroOrigem('cancelado');
      if ((e as NodeJS.ErrnoException).code === 'ENOSPC') throw new ErroOrigem('sem-espaco');
      if (i + 1 >= tentativas) throw new ErroOrigem('sem-rede', (e as Error).message);
      await esperar(Math.min(15_000, 1000 * 2 ** i), o.sinal);
    }
  }
  await rename(parte, destino);
}

/** A pasta do Gravador (o cache da imagem). */
export function pastaCache(): string {
  if (process.platform === 'win32') return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Ekfrase', 'Gravador');
  return join(process.env['XDG_CACHE_HOME'] || join(homedir(), '.cache'), 'ekfrase-gravador');
}

export interface ImagemPronta {
  arquivo: string;
  nome: string;
  sha256: string;
  /** O lacre (texto do `.minisig`), se veio com ele e confere. */
  minisig: string | null;
  lacre: 'ekfrase' | 'ausente';
  /** O comentário de confiança do lacre ("Ekfrase Writer OS 0.1.0"). */
  comentario: string | null;
  versao: string | null;
}

export type Etapa = { etapa: 'baixar'; feito: number; total: number } | { etapa: 'conferir'; feito: number; total: number };

async function conferirCabeca(arquivo: string): Promise<void> {
  const f = new Fluxo(arquivo);
  try {
    await lerCabecaImagem(f);
  } catch (e) {
    if (e instanceof ErroImagem) throw new ErroOrigem(e.codigo === 'nao-e-writer-os' ? 'nao-e-writer-os' : 'imagem-corrompida');
    throw e;
  } finally {
    await f.fechar();
  }
}

/** O Release: baixa (ou acha no cache) e confere o SHA-256 e o lacre. */
export async function imagemDoLancamento(buscar: Buscar, l: Lancamento, o: { pasta?: string; aviso?: ((e: Etapa) => void) | undefined; sinal?: AbortSignal | undefined; chave?: string } = {}): Promise<ImagemPronta> {
  const raiz = o.pasta ?? pastaCache();
  const pasta = join(raiz, l.tag);
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, basename(l.imagem.nome));
  const shaEsperado = lerSha256(await baixarTexto(buscar, l.sha256));
  const minisig = await baixarTexto(buscar, l.minisig);
  if (!shaEsperado) throw new ErroOrigem('sha-diferente', 'o .sha256 do Release não tem um hash');
  const conferir = async () => hashesDoArquivo(arquivo, (feito) => o.aviso?.({ etapa: 'conferir', feito, total: statSync(arquivo).size }));
  let h = existsSync(arquivo) ? await conferir() : null;
  if (!h || h.sha256 !== shaEsperado) {
    await rm(arquivo, { force: true });
    await baixarArquivo(buscar, l.imagem.url, arquivo, { tamanho: l.imagem.tamanho || undefined, aoBaixar: (feito, total) => o.aviso?.({ etapa: 'baixar', feito, total }), sinal: o.sinal });
    h = await conferir();
  }
  if (h.sha256 !== shaEsperado) {
    await rm(arquivo, { force: true });
    throw new ErroOrigem('sha-diferente');
  }
  const r = conferirAssinatura(lerChavePublica(o.chave ?? CHAVE_EKFRASE), minisig, h.blake2b);
  if (!r.ok) {
    await rm(arquivo, { force: true });
    throw new ErroOrigem('lacre-invalido', r.motivo);
  }
  await conferirCabeca(arquivo);
  // as versões antigas saem do cache
  for (const p of readdirSync(raiz)) if (p !== l.tag && p.startsWith(PREFIXO_TAG)) rmSync(join(raiz, p), { recursive: true, force: true });
  return { arquivo, nome: basename(arquivo), sha256: h.sha256, minisig, lacre: 'ekfrase', comentario: r.comentario, versao: l.versao };
}

/** "Já tenho a imagem": confere o arquivo e o que estiver ao lado dele. */
export async function imagemDoArquivo(arquivo: string, o: { aviso?: ((e: Etapa) => void) | undefined; chave?: string } = {}): Promise<ImagemPronta> {
  if (!/\.img(\.xz)?$/i.test(arquivo)) throw new ErroOrigem('nao-e-writer-os');
  const ler = async (f: string) => (existsSync(f) ? await readFile(f, 'utf8') : null);
  const shaTexto = await ler(`${arquivo}.sha256`);
  const minisig = await ler(`${arquivo}.minisig`);
  const total = statSync(arquivo).size;
  const h = await hashesDoArquivo(arquivo, (feito) => o.aviso?.({ etapa: 'conferir', feito, total }));
  if (shaTexto !== null && lerSha256(shaTexto) !== h.sha256) throw new ErroOrigem('sha-diferente');
  let comentario: string | null = null;
  if (minisig !== null) {
    const r = conferirAssinatura(lerChavePublica(o.chave ?? CHAVE_EKFRASE), minisig, h.blake2b);
    if (!r.ok) throw new ErroOrigem('lacre-invalido', r.motivo);
    comentario = r.comentario;
  }
  await conferirCabeca(arquivo);
  return { arquivo, nome: basename(arquivo), sha256: h.sha256, minisig, lacre: minisig !== null ? 'ekfrase' : 'ausente', comentario, versao: null };
}
