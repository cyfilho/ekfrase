// SPDX-License-Identifier: MPL-2.0

/**
 * APLICAR a versão nova, por sistema (docs/ATUALIZACOES.md §5, U2). Node puro (testável sem Electron):
 *
 * - `trocarNoLugar`: o arquivo do app (o AppImage, o `.exe` portátil do Gravador) é trocado pelo novo. Primeiro uma
 *   cópia ao lado (`<alvo>.novo`, no mesmo disco), conferida pelo SHA-256; depois a troca de nome por cima. No Linux o
 *   processo aberto continua com o arquivo velho até fechar. No Windows o `.exe` aberto não pode ser apagado, mas pode
 *   mudar de nome: vira `<alvo>.velho`, que `limparVelho` apaga na próxima abertura.
 * - `rodarInstalador`: o instalador NSIS do Writer em silêncio (`/S`), desligado deste processo (ele espera o app
 *   fechar e instala por cima; `--force-run` abre o Writer de novo no fim, no "Reiniciar agora").
 */
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { sha256DoArquivo } from './minisign.ts';

export const velhoDe = (alvo: string): string => `${alvo}.velho`;

/** Troca `alvo` por `novo` (conferido de novo pelo `sha256`). `guardarVelho`: o de agora vira `<alvo>.velho` (Windows). */
export async function trocarNoLugar(novo: string, alvo: string, o: { sha256: string; guardarVelho?: boolean; executavel?: boolean }): Promise<void> {
  const copia = `${alvo}.novo`;
  rmSync(copia, { force: true });
  copyFileSync(novo, copia);
  if ((await sha256DoArquivo(copia)) !== o.sha256) {
    rmSync(copia, { force: true });
    throw new Error('a cópia não confere');
  }
  if (o.executavel) chmodSync(copia, 0o755);
  if (o.guardarVelho && existsSync(alvo)) {
    rmSync(velhoDe(alvo), { force: true });
    renameSync(alvo, velhoDe(alvo));
    try {
      renameSync(copia, alvo);
    } catch (e) {
      // não deu: o de antes volta ao lugar
      renameSync(velhoDe(alvo), alvo);
      throw e;
    }
    return;
  }
  renameSync(copia, alvo);
}

/** Apaga o `<alvo>.velho` que ficou da troca anterior (o `.exe` que estava aberto). */
export function limparVelho(alvo: string): void {
  try {
    rmSync(velhoDe(alvo), { force: true });
  } catch {
    // ainda aberto (outra janela do mesmo app): fica para a próxima
  }
}

/** O instalador ainda é o que foi conferido? (o arquivo pode ter mudado entre baixar e fechar o app) */
export async function aindaConfere(arquivo: string, o: { sha256: string; tamanho: number }): Promise<boolean> {
  try {
    return statSync(arquivo).size === o.tamanho && (await sha256DoArquivo(arquivo)) === o.sha256;
  } catch {
    return false;
  }
}

/** Roda o instalador NSIS em silêncio, desligado deste processo. `abrirDepois` = o Writer abre de novo no fim. */
export function rodarInstalador(instalador: string, o: { abrirDepois: boolean }): void {
  const filho = spawn(instalador, ['/S', ...(o.abrirDepois ? ['--force-run'] : [])], { detached: true, stdio: 'ignore', windowsHide: true });
  filho.unref();
}
