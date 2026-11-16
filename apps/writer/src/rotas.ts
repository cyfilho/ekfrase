// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'preact/hooks';

/**
 * As telas do Writer, pelo endereço depois do `#/` (assim o botão de voltar do navegador funciona e
 * cada tela tem um link):
 *   #/                      a estante
 *   #/inicio                o hall: escrever na web, no computador, no pendrive
 *   #/historia/<id>         a árvore de uma história
 *   #/escrever/<cena>       a folha de escrever
 *   #/historico/<cena>      o histórico da cena
 *   #/ideias[/<historia>]   o banco de ideias (ou só as de uma história)
 *   #/personagens/<id>      os personagens de uma história
 *   #/arquivos[/<id>]       exportar e importar
 *   #/abrir/<chave>         um arquivo entregue por outro app ou pelo site (packages/arquivo)
 */
export type Rota =
  | { tela: 'estante' }
  | { tela: 'historia'; id: string }
  | { tela: 'escrever'; id: string }
  | { tela: 'historico'; id: string }
  | { tela: 'ideias'; id?: string }
  | { tela: 'personagens'; id: string }
  | { tela: 'arquivos'; id?: string }
  | { tela: 'abrir'; id: string }
  /** O hall do app: os caminhos para escrever (web, computador, pendrive). Abre também sem conta. */
  | { tela: 'inicio' }
  /** A página de download do app do computador (abre também sem conta). */
  | { tela: 'computador' }
  /** A página do Writer OS e do Gravador (ekfrase.com/writer/os/ ou #/os; abre também sem conta). */
  | { tela: 'os' };

const COM_ID = ['historia', 'escrever', 'historico', 'personagens', 'abrir'] as const;
const ID_OPCIONAL = ['ideias', 'arquivos'] as const;
const ID = /^[a-f0-9-]{8,40}$/;

export function lerRota(hash: string = location.hash): Rota {
  const [tela = '', id = ''] = hash.replace(/^#\/?/, '').split('/');
  if ((COM_ID as readonly string[]).includes(tela) && ID.test(id)) return { tela, id } as Rota;
  if ((ID_OPCIONAL as readonly string[]).includes(tela)) return (ID.test(id) ? { tela, id } : { tela }) as Rota;
  if (tela === 'inicio') return { tela: 'inicio' };
  if (tela === 'computador') return { tela: 'computador' };
  if (tela === 'os' || (!tela && /\/writer\/os\/?$/.test(location.pathname))) return { tela: 'os' };
  return { tela: 'estante' };
}

export function endereco(r: Rota): string {
  return r.tela === 'estante' ? '#/' : `#/${r.tela}${'id' in r && r.id ? `/${r.id}` : ''}`;
}

/**
 * ekfrase.com/writer (link direto, sem `#`) mostra o hall no próprio endereço, sem trocar para `#/inicio`: o padrão de
 * todo app (`entradaPedida`). Some na primeira troca de endereço ou quando a pessoa escolhe escrever.
 */
export const comeco = { hall: false };

/** Sai do hall do começo para a estante (se o endereço já é `#/`, avisa a troca à mão: senão a tela não muda). */
export function sairDoHall(): void {
  comeco.hall = false;
  if (location.hash === '#/') dispatchEvent(new HashChangeEvent('hashchange'));
  else ir({ tela: 'estante' });
}

export function ir(r: Rota): void {
  const para = endereco(r);
  if (location.hash !== para) location.hash = para;
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(() => lerRota());
  useEffect(() => {
    const mudar = () => setRota(lerRota());
    addEventListener('hashchange', mudar);
    return () => removeEventListener('hashchange', mudar);
  }, []);
  return rota;
}
