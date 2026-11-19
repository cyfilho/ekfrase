// SPDX-License-Identifier: MPL-2.0

/**
 * OS RELEASES do repositório público (`cyfilho/ekfrase`), por prefixo de tag e canal (docs/ATUALIZACOES.md §3): o
 * Writer no computador é `writer-v*`; o Writer OS e o Gravador, `writer-os-v*`. Sem conta, o GitHub deixa 60 pedidos
 * por hora: uma busca a cada 6 horas não chega perto disso.
 *
 * O canal estável só vê os Releases `<prefixo>X.Y.Z` (nunca uma pré-release); o de teste vê também as pré-releases
 * `<prefixo>X.Y.Z-teste.N`. Rascunhos, nunca.
 */
import { AGENTE, ErroBaixar, type Buscar } from './baixar.ts';
import { canalAceita, compararVersoes, ehDeTeste, type Canal } from './versoes.ts';

export const REPOSITORIO = 'cyfilho/ekfrase';
export const API_GITHUB = 'https://api.github.com';

export interface ArquivoDoLancamento {
  nome: string;
  url: string;
  tamanho: number;
}

export interface Lancamento {
  tag: string;
  versao: string;
  arquivos: ArquivoDoLancamento[];
}

interface ReleaseGitHub {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown }[];
}

/** Os Releases que o canal vê, do mais novo para o mais velho. `[]` = nenhum publicado (o 404 também). */
export async function lancamentos(buscar: Buscar, o: { prefixo: string; canal: Canal; api?: string; repositorio?: string; agente?: string }): Promise<Lancamento[]> {
  const api = (o.api ?? API_GITHUB).replace(/\/+$/, '');
  let r: Response;
  try {
    r = await buscar(`${api}/repos/${o.repositorio ?? REPOSITORIO}/releases?per_page=50`, { headers: { accept: 'application/vnd.github+json', 'user-agent': o.agente ?? AGENTE } });
  } catch (e) {
    throw new ErroBaixar('sem-rede', (e as Error).message);
  }
  if (r.status === 404) return [];
  if (!r.ok) throw new ErroBaixar('sem-rede', `HTTP ${r.status}`);
  let lista: unknown;
  try {
    lista = await r.json();
  } catch {
    throw new ErroBaixar('sem-rede', 'resposta sem JSON');
  }
  if (!Array.isArray(lista)) throw new ErroBaixar('sem-rede', 'resposta sem a lista');
  const saida: Lancamento[] = [];
  for (const x of lista as ReleaseGitHub[]) {
    if (x?.draft === true || typeof x?.tag_name !== 'string' || !x.tag_name.startsWith(o.prefixo)) continue;
    const versao = x.tag_name.slice(o.prefixo.length);
    if (!canalAceita(o.canal, versao)) continue;
    // uma estável marcada como pré-release (ou uma de teste que não é) não vale
    if ((x.prerelease === true) !== ehDeTeste(versao)) continue;
    const arquivos: ArquivoDoLancamento[] = [];
    for (const a of x.assets ?? []) {
      if (typeof a?.name === 'string' && typeof a.browser_download_url === 'string') arquivos.push({ nome: a.name, url: a.browser_download_url, tamanho: typeof a.size === 'number' ? a.size : 0 });
    }
    saida.push({ tag: x.tag_name, versao, arquivos });
  }
  return saida.sort((a, b) => compararVersoes(b.versao, a.versao));
}

export const arquivoDe = (l: Lancamento, nome: string): ArquivoDoLancamento | undefined => l.arquivos.find((a) => a.nome === nome);
