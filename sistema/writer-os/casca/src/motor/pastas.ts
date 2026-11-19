// SPDX-License-Identifier: MPL-2.0

/**
 * A PASTA DOS DADOS (parte do Motor): onde os textos de um app moram no computador ou no pendrive.
 * A pessoa escolhe uma pasta (ou aceita a sugerida, em Documentos); dentro dela fica a pasta do app:
 *
 *   <escolhida>/Ekfrase Writer/
 *     ekfrase.json          o marcador (sem texto nenhum; não cifrado): formato e a escolha do espelho
 *     dados/cofre.db        cifrado: confere a senha e guarda o rascunho de emergência
 *     dados/textos-<dono>.db  cifrado: um por dono (sem conta = `local`; cada conta, o seu)
 *     Textos/…              o espelho `.md` (só se a pessoa quis; NÃO cifrado)
 *
 * E o que este computador lembra (em `userData`, fora da pasta dos dados): a última pasta e o
 * servidor escolhido. Nada de texto, nada de senha.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const MARCADOR = 'ekfrase.json';
export const FORMATO = 1;

export interface MarcadorDaPasta {
  formato: number;
  app: string;
  /** "sempre neste": o espelho `.md` liga sozinho ao abrir esta pasta. */
  espelho: 'sempre' | null;
}

/** Grava um arquivo de uma vez: num temporário ao lado e depois troca (nunca fica pela metade). */
export function gravarInteiro(caminho: string, conteudo: string | Uint8Array): void {
  mkdirSync(dirname(caminho), { recursive: true });
  const temp = `${caminho}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(temp, conteudo, { flush: true });
  renameSync(temp, caminho);
}

const ehPasta = (c: string): boolean => {
  try {
    return statSync(c).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Da pasta escolhida para a pasta do app: se a escolhida já é a do app (tem o marcador, ou tem o
 * nome do app), usa ela; senão, a pasta do app fica dentro dela.
 */
export function pastaDoApp(escolhida: string, nomeDoApp: string): string {
  if (existsSync(join(escolhida, MARCADOR)) || basename(escolhida) === nomeDoApp) return escolhida;
  return join(escolhida, nomeDoApp);
}

export function lerMarcador(pasta: string): MarcadorDaPasta | null {
  try {
    const m = JSON.parse(readFileSync(join(pasta, MARCADOR), 'utf8')) as Partial<MarcadorDaPasta>;
    return { formato: typeof m.formato === 'number' ? m.formato : FORMATO, app: typeof m.app === 'string' ? m.app : '', espelho: m.espelho === 'sempre' ? 'sempre' : null };
  } catch {
    return null;
  }
}

export function gravarMarcador(pasta: string, m: MarcadorDaPasta): void {
  gravarInteiro(join(pasta, MARCADOR), `${JSON.stringify(m, null, 2)}\n`);
}

/** Dá para usar esta pasta? (Existe, ou dá para criar, e dá para gravar nela.) */
export function pastaGravavel(pasta: string): boolean {
  try {
    mkdirSync(pasta, { recursive: true });
    if (!ehPasta(pasta)) return false;
    const teste = join(pasta, `.ekfrase-teste-${process.pid}`);
    writeFileSync(teste, '');
    unlinkSync(teste);
    return true;
  } catch {
    return false;
  }
}

export { ehPasta };

// ---------- o que este computador lembra ----------

export interface Lembrado {
  /** A pasta do app usada da última vez. */
  pasta: string | null;
  /** A base da API do servidor escolhido (`null` = o padrão). */
  servidor: string | null;
  /** As atualizações do Writer no computador (U2): "Automáticas" (o padrão, quando falta) ou "Perguntar". */
  atualizacoes?: 'automaticas' | 'perguntar';
}

export function lerLembrado(arquivo: string): Lembrado {
  try {
    const l = JSON.parse(readFileSync(arquivo, 'utf8')) as Partial<Lembrado>;
    const at = l.atualizacoes === 'automaticas' || l.atualizacoes === 'perguntar' ? { atualizacoes: l.atualizacoes } : {};
    return { pasta: typeof l.pasta === 'string' ? l.pasta : null, servidor: typeof l.servidor === 'string' ? l.servidor : null, ...at };
  } catch {
    return { pasta: null, servidor: null };
  }
}

export function gravarLembrado(arquivo: string, l: Lembrado): void {
  gravarInteiro(arquivo, `${JSON.stringify(l, null, 2)}\n`);
}
