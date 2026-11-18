// SPDX-License-Identifier: MPL-2.0

import { aoMudarEndereco, entradaDoApp, irPara, noApp, paginaDoApp, partesDoEndereco } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';

/**
 * As telas do Writer, pelo caminho do endereço (padrão de `docs/ENDERECOS.md`: sem `#`; o botão de voltar do
 * navegador funciona e cada tela tem um link):
 *   /writer/                       o hall (a entrada): escrever na web, no computador, no pendrive
 *   /writer/computador             a página de download do app do computador (abre também sem conta)
 *   /writer/os                     a página do Writer OS e do Gravador (abre também sem conta)
 *   /writer/app                    a estante
 *   /writer/app/historia/<id>      a árvore de uma história
 *   /writer/app/escrever/<cena>    a folha de escrever
 *   /writer/app/historico/<cena>   o histórico da cena
 *   /writer/app/ideias[/<historia>]  o banco de ideias (ou só as de uma história)
 *   /writer/app/personagens/<id>   os personagens de uma história
 *   /writer/app/arquivos[/<id>]    exportar e importar
 *   /writer/app/abrir/<chave>      um arquivo entregue por outro app ou pelo site (packages/arquivo)
 * Os endereços antigos (`/writer/#/ideias`) viram estes no `main.tsx` (`migrarHashAntigo`).
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
  /** O hall do app (`/writer/`): os caminhos para escrever (web, computador, pendrive). Abre também sem conta. */
  | { tela: 'inicio' }
  /** A página de download do app do computador (abre também sem conta). */
  | { tela: 'computador' }
  /** A página do Writer OS e do Gravador (`/writer/os`; abre também sem conta). */
  | { tela: 'os' };

const COM_ID = ['historia', 'escrever', 'historico', 'personagens', 'abrir'] as const;
const ID_OPCIONAL = ['ideias', 'arquivos'] as const;
const ID = /^[a-f0-9-]{8,40}$/;

export function lerRota(caminho: string = location.pathname): Rota {
  const partes = partesDoEndereco('writer', caminho) ?? [];
  const [primeira = '', tela = '', id = ''] = partes;
  if (primeira === 'computador') return { tela: 'computador' };
  if (primeira === 'os') return { tela: 'os' };
  if (primeira !== 'app') return { tela: 'inicio' };
  if ((COM_ID as readonly string[]).includes(tela) && ID.test(id)) return { tela, id } as Rota;
  if ((ID_OPCIONAL as readonly string[]).includes(tela)) return (ID.test(id) ? { tela, id } : { tela }) as Rota;
  return { tela: 'estante' };
}

export function endereco(r: Rota): string {
  switch (r.tela) {
    case 'inicio':
      return entradaDoApp('writer');
    case 'computador':
    case 'os':
      return paginaDoApp('writer', r.tela);
    case 'estante':
      return noApp('writer');
    default:
      return noApp('writer', `${r.tela}${'id' in r && r.id ? `/${r.id}` : ''}`);
  }
}

/** Sai do hall para a estante. */
export function sairDoHall(): void {
  ir({ tela: 'estante' });
}

export function ir(r: Rota): void {
  irPara(endereco(r));
}

export function useRota(): Rota {
  const [rota, setRota] = useState<Rota>(() => lerRota());
  useEffect(() => aoMudarEndereco(() => setRota(lerRota())), []);
  return rota;
}
