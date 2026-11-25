// SPDX-License-Identifier: MPL-2.0

/**
 * DE ONDE VEM A IMAGEM (PLANO §12, linhas 11 e 12):
 *
 * - do Release mais novo do Writer OS no repositório público (`cyfilho/ekfrase`, tag `writer-os-v*`):
 *   o `.img.xz`, o `.sha256` e o `.minisig`. Baixa com RETOMADA (a internet caiu: continua de onde
 *   parou) para a pasta do Gravador (`%LOCALAPPDATA%\Ekfrase\Gravador` ou `~/.cache/ekfrase-gravador`).
 *   NÃO HÁ CACHE (Bloco E, 20/11/2026): toda gravação baixa de novo e quem chama apaga a pasta ao terminar
 *   (`apagarDownload`), dê certo ou errado; só o `.parte` de um download que caiu fica, para retomar. O download
 *   SEMPRE exige o lacre válido.
 * - ou de um arquivo que a pessoa já tem ("Já tenho a imagem"): o `.sha256` e o `.minisig` ao lado,
 *   se houver. Lacre presente e errado, ou SHA-256 diferente = recusa. Sem lacre = aceita, mas só com o
 *   aviso vermelho e a confirmação escrita (quem faz o próprio Writer OS consegue gravar).
 */
import { API_GITHUB, arquivoDe, baixarArquivo as baixarComRetomada, baixarTexto as baixarTextoComRetomada, CHAVE_EKFRASE, conferirAssinatura, ErroBaixar, hashesDoArquivo, lancamentos, lerChavePublica, lerSha256, type Buscar, type Canal, type OpcoesBaixar } from '@ekfrase/atualizacoes';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { Fluxo, lerCabecaImagem, ErroImagem } from './imagem.ts';

export { API_GITHUB, type Buscar, type Canal };
export const PREFIXO_TAG = 'writer-os-v';
const AGENTE = 'Ekfrase-Gravador';

export class ErroOrigem extends Error {
  readonly codigo: 'sem-rede' | 'sem-release' | 'lacre-invalido' | 'sha-diferente' | 'nao-e-writer-os' | 'imagem-corrompida' | 'cancelado' | 'sem-espaco';
  readonly detalhe: string;
  constructor(codigo: ErroOrigem['codigo'], detalhe = '') {
    super(detalhe ? `${codigo}: ${detalhe}` : codigo);
    this.codigo = codigo;
    this.detalhe = detalhe;
  }
}

/** Os erros do download (o pacote `@ekfrase/atualizacoes`) com os códigos do Gravador. */
async function comoOrigem<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof ErroBaixar) throw new ErroOrigem(e.codigo, e.detalhe);
    throw e;
  }
}

export interface Lancamento {
  tag: string;
  versao: string;
  imagem: { nome: string; url: string; tamanho: number };
  sha256: string;
  minisig: string;
}

/**
 * O Release mais novo do Writer OS que tem os três arquivos (ou null: ainda não publicado), no `canal`. O CANAL
 * (15/11/2026): o Gravador do público ("estavel") só vê os Releases `writer-os-vX.Y.Z`; o de teste (montado com
 * EKFRASE_GRAVADOR_CANAL=teste e publicado SÓ dentro da pré-release `writer-os-vX.Y.Z-teste.N`) vê também as
 * pré-releases de teste. A estável de uma versão vence as de teste dela (`@ekfrase/atualizacoes`, versoes.ts).
 */
export async function ultimoLancamento(buscar: Buscar, api = API_GITHUB, canal: Canal = 'estavel'): Promise<Lancamento | null> {
  const lista = await comoOrigem(() => lancamentos(buscar, { prefixo: PREFIXO_TAG, canal, api, agente: AGENTE }));
  for (const c of lista) {
    const img = c.arquivos.find((a) => /^ekfrase-writer-os-[\w.-]+\.img\.xz$/.test(a.nome));
    const sha = img && arquivoDe(c, `${img.nome}.sha256`);
    const sig = img && arquivoDe(c, `${img.nome}.minisig`);
    if (img && sha && sig) return { tag: c.tag, versao: c.versao, imagem: img, sha256: sha.url, minisig: sig.url };
  }
  return null;
}

const baixarTexto = (buscar: Buscar, url: string) => comoOrigem(() => baixarTextoComRetomada(buscar, url, { agente: AGENTE }));

/**
 * Baixa para `destino` com retomada (o `baixarArquivo` do `@ekfrase/atualizacoes`, com os erros do Gravador).
 */
export const baixarArquivo = (buscar: Buscar, url: string, destino: string, o: OpcoesBaixar = {}): Promise<void> => comoOrigem(() => baixarComRetomada(buscar, url, destino, { agente: AGENTE, ...o }));

/** A pasta do Gravador (o download da imagem, só enquanto grava; os ajustes). */
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
  // sem cache: uma imagem inteira que sobrou de antes não vale; só o `.parte` (download que caiu) é retomado
  await rm(arquivo, { force: true });
  await baixarArquivo(buscar, l.imagem.url, arquivo, { tamanho: l.imagem.tamanho || undefined, aoBaixar: (feito, total) => o.aviso?.({ etapa: 'baixar', feito, total }), sinal: o.sinal });
  const h = await conferir();
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

/** Apaga o que o download deixou (a imagem; o `.parte` só fica se o download caiu no meio) da pasta do Release: chamar ao terminar a gravação, dê certo ou errado. */
export function apagarDownload(l: Pick<Lancamento, 'tag'>, pasta = pastaCache()): void {
  const dir = join(pasta, l.tag);
  for (const f of existsSync(dir) ? readdirSync(dir) : []) if (!f.endsWith('.parte')) rmSync(join(dir, f), { recursive: true, force: true });
  // um download que caiu no meio deixa o `.parte` para retomar; sem ele, a pasta inteira vai
  if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
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
