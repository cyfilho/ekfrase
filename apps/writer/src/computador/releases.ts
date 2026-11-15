// SPDX-License-Identifier: MPL-2.0

/**
 * OS DOWNLOADS DO REPOSITÓRIO PÚBLICO. Lá há mais de um tipo de Release (o Writer no computador,
 * `writer-v*`; o Writer OS com o Gravador, `writer-os-v*`), então `releases/latest` pode apontar para
 * o tipo errado. A página pergunta à API do GitHub (aceita o navegador, sem conta) o mais novo de cada
 * prefixo. Sem resposta (sem internet, limite da API), cai no link fixo `latest` e na lista de Releases.
 */
import { useEffect, useState } from 'preact/hooks';
import { LINKS } from '@ekfrase/interface';

const API = 'https://api.github.com/repos/cyfilho/ekfrase/releases?per_page=50';

export interface ReleaseAchado {
  versao: string;
  /** nome do arquivo → endereço para baixar */
  arquivos: Record<string, string>;
}

export const LISTA_DE_RELEASES = `${LINKS.codigo}/releases`;

/** O endereço de um arquivo: o do Release achado, ou o `latest` (que serve enquanto só há um tipo de Release). */
export const enderecoDe = (r: EstadoRelease, arquivo: string): string => (r && r !== 'sem-resposta' ? r.arquivos[arquivo] : undefined) ?? `${LINKS.codigo}/releases/latest/download/${arquivo}`;

const comparar = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** undefined = procurando; null = nenhum publicado; "sem-resposta" = a API não respondeu (vale o link fixo). */
export type EstadoRelease = ReleaseAchado | null | undefined | 'sem-resposta';

/** O Release mais novo com `prefixo` (ex.: `writer-os-v`) que tem todos os `precisa`. */
export function useRelease(prefixo: string, precisa: string[]): EstadoRelease {
  const [r, setR] = useState<EstadoRelease>(undefined);
  useEffect(() => {
    let vivo = true;
    fetch(API, { headers: { accept: 'application/vnd.github+json' } })
      .then((x) => (x.ok ? x.json() : Promise.reject(new Error(String(x.status)))))
      .then((lista: { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string; browser_download_url?: string }[] }[]) => {
        const achados = lista
          .filter((x) => !x.draft && !x.prerelease && x.tag_name?.startsWith(prefixo) && /^\d+\.\d+\.\d+$/.test(x.tag_name.slice(prefixo.length)))
          .map((x) => ({ versao: x.tag_name!.slice(prefixo.length), arquivos: Object.fromEntries((x.assets ?? []).filter((a) => a.name && a.browser_download_url).map((a) => [a.name!, a.browser_download_url!])) }))
          .filter((x) => precisa.every((p) => p in x.arquivos))
          .sort((a, b) => comparar(b.versao, a.versao));
        if (vivo) setR(achados[0] ?? null);
      })
      .catch(() => {
        // sem resposta da API: o link fixo (latest) continua valendo
        if (vivo) setR('sem-resposta');
      });
    return () => {
      vivo = false;
    };
  }, [prefixo]);
  return r;
}
