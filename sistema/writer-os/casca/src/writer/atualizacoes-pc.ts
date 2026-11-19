// SPDX-License-Identifier: MPL-2.0

/**
 * O WRITER NO COMPUTADOR SE ATUALIZA (DEC-P072, docs/ATUALIZACOES.md §5, U2). O `Atualizador` de `@ekfrase/atualizacoes`
 * procura no Release `writer-v*` do público, baixa para `userData/atualizacao/<versão>/` e confere o lacre do manifesto
 * `ekfrase-writer-<v>.atualizacao.json` e o SHA-256. Daí, por sistema:
 *
 * - **Windows (o instalador NSIS, por pessoa):** o `Ekfrase-Writer-Setup.exe` fica guardado; ao fechar a janela, os
 *   textos já trancados, ele roda em silêncio (`/S`) e instala por cima ("Reiniciar agora": `/S --force-run`, abre de
 *   novo no fim). Os textos ficam na pasta deles, fora do instalador.
 * - **Linux (o AppImage):** o arquivo novo troca de nome por cima do `$APPIMAGE` logo depois de conferido; o processo
 *   aberto continua com o velho até fechar.
 * - **Simulado** (os testes, só fora do instalador): `EKFRASE_CASCA_ATUALIZACOES_API` (o "GitHub" local),
 *   `_CHAVE` (mais uma chave em que confiar), `_ATRASO`, `EKFRASE_CASCA_VERSAO` (a versão "de agora") e
 *   `EKFRASE_CASCA_ATUALIZACOES_RELATO` (um arquivo: em vez de instalar, escreve ali o que teria feito).
 *
 * Fora disso (o `npm run casca` sem o simulado, um Linux sem AppImage, o Windows sem o desinstalador do NSIS ao lado):
 * nada de atualizações, e a tela não mostra a parte.
 *
 * O Writer OS não passa por aqui: ele tem a cópia de reserva do sistema (`atualizacoes-os.ts`).
 */
import { aindaConfere, Atualizador, canalDaVersao, CHAVE_EKFRASE, ehVersao, rodarInstalador, trocarNoLugar, type ModoAtualizacoes } from '@ekfrase/atualizacoes';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gravarLembrado, lerLembrado } from '../motor/pastas.ts';

export const PREFIXO_PC = 'writer-v';
export const APP_PC = 'ekfrase-writer';
export const NOME_PC = 'Ekfrase Writer';

export type JeitoDeAplicar = 'nsis' | 'appimage' | 'simulado';

export interface OpcoesPC {
  /** `app.getVersion()` (a do instalador, da tag `writer-vX.Y.Z[-teste.N]`). */
  versao: string;
  plataforma: NodeJS.Platform;
  empacotado: boolean;
  userData: string;
  /** O `casca.json` (o modo fica nele: `atualizacoes`). */
  lembrado: string;
  execPath: string;
  /** As variáveis do ambiente (o `$APPIMAGE` e, fora do instalador, as do simulado). */
  ambiente: NodeJS.ProcessEnv;
}

export interface AtualizacoesPC {
  atualizador: Atualizador;
  jeito: JeitoDeAplicar;
  /**
   * O app vai fechar (os textos já trancados): no Windows, roda o instalador que ficou pronto. Devolve `true` se algo
   * foi posto para rodar (quem chama sai logo depois, sem esperar).
   */
  aoFechar(abrirDepois: boolean): Promise<boolean>;
}

const lerSeHa = (f: string | undefined): string | null => {
  try {
    return f ? readFileSync(f, 'utf8').slice(0, 4096) : null;
  } catch {
    return null;
  }
};

export function atualizacoesDoPC(o: OpcoesPC): AtualizacoesPC | null {
  const fora = (n: string): string | undefined => (o.empacotado ? undefined : o.ambiente[n] || undefined);
  const api = fora('EKFRASE_CASCA_ATUALIZACOES_API');
  let jeito: JeitoDeAplicar | null = null;
  if (api) jeito = 'simulado';
  else if (o.empacotado && o.plataforma === 'win32' && existsSync(join(dirname(o.execPath), `Uninstall ${NOME_PC}.exe`))) jeito = 'nsis';
  else if (o.empacotado && o.plataforma === 'linux' && o.ambiente['APPIMAGE'] && existsSync(o.ambiente['APPIMAGE'])) jeito = 'appimage';
  if (!jeito) return null;

  const versao = fora('EKFRASE_CASCA_VERSAO') ?? o.versao;
  if (!ehVersao(versao)) return null;
  const extra = lerSeHa(fora('EKFRASE_CASCA_ATUALIZACOES_CHAVE'));
  const atraso = Number(fora('EKFRASE_CASCA_ATUALIZACOES_ATRASO') ?? '');
  const relato = fora('EKFRASE_CASCA_ATUALIZACOES_RELATO');
  const relatar = (l: string) => {
    if (relato) appendFileSync(relato, `${l}\n`);
  };
  const appimage = o.ambiente['APPIMAGE'] ?? '';

  const atualizador = new Atualizador({
    app: APP_PC,
    nome: NOME_PC,
    prefixo: PREFIXO_PC,
    versao,
    canal: canalDaVersao(versao),
    papel: o.plataforma === 'linux' ? 'linux' : 'windows',
    pasta: join(o.userData, 'atualizacao'),
    modo: () => lerLembrado(o.lembrado).atualizacoes ?? 'automaticas',
    gravarModo: (m: ModoAtualizacoes) => gravarLembrado(o.lembrado, { ...lerLembrado(o.lembrado), atualizacoes: m }),
    preparar: async (arquivo, v, sha256) => {
      if (jeito === 'appimage') await trocarNoLugar(arquivo, appimage, { sha256, executavel: true });
      relatar(`pronta ${v} ${arquivo}`);
    },
    chaves: extra ? [CHAVE_EKFRASE, extra] : [CHAVE_EKFRASE],
    ...(api ? { api } : {}),
    ...(Number.isFinite(atraso) && atraso > 0 ? { atrasoInicial: atraso } : {}),
    agente: 'Ekfrase-Writer',
  });

  return {
    atualizador,
    jeito,
    async aoFechar(abrirDepois) {
      const p = atualizador.pronta();
      if (!p) return false;
      // no Linux o AppImage já foi trocado; no Windows o instalador roda agora (se ainda é o que foi conferido)
      if (jeito === 'appimage') return false;
      if (!(await aindaConfere(p.arquivo, p))) {
        relatar(`nao-confere ${p.versao}`);
        return false;
      }
      if (jeito === 'simulado') {
        relatar(`instalar ${p.versao} ${p.arquivo} abrir=${abrirDepois ? 'sim' : 'nao'}`);
        return true;
      }
      rodarInstalador(p.arquivo, { abrirDepois });
      return true;
    },
  };
}
