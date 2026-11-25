// SPDX-License-Identifier: MPL-2.0

/**
 * O que todo app faz no navegador: lembrar o idioma e o tema escolhidos.
 * Guardado só neste navegador (localStorage); sem armazenamento (janela
 * privada), segue o aparelho e nada quebra.
 */
import type { Tradutor } from './i18n.ts';

const CHAVE_IDIOMA = 'ekfrase.idioma';
const CHAVE_TEMA = 'ekfrase.tema';

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null): void {
  try {
    if (valor === null) localStorage.removeItem(chave);
    else localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento: a escolha vale só até fechar
  }
}

/** A escolha da pessoa vale mais que o idioma do aparelho. */
export function iniciarIdioma(tr: Tradutor): void {
  tr.trocarIdioma(ler(CHAVE_IDIOMA) ?? tr.detectar(navigator.languages));
  document.documentElement.lang = tr.idioma();
  tr.aoTrocar(() => {
    document.documentElement.lang = tr.idioma();
    gravar(CHAVE_IDIOMA, tr.idioma());
  });
}

export type Tema = 'claro' | 'escuro' | 'sistema';

let temaPadrao: Tema = 'sistema';

/** O tema de quem ainda não escolheu (o Writer OS e o Gravador começam no escuro). A escolha gravada vale mais. */
export function definirTemaPadrao(tema: Tema): void {
  temaPadrao = tema;
}

export function temaAtual(): Tema {
  const v = ler(CHAVE_TEMA);
  return v === 'claro' || v === 'escuro' ? v : temaPadrao;
}

/** O tema que está na tela agora: a escolha da pessoa ou, sem escolha, o do aparelho. */
export function temaEfetivo(): 'claro' | 'escuro' {
  const t = temaAtual();
  if (t !== 'sistema') return t;
  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
  } catch {
    return 'claro';
  }
}

/** Avisa quando o aparelho troca de claro para escuro (só importa enquanto a pessoa não escolheu). */
export function aoMudarAparelho(fn: () => void): () => void {
  try {
    const m = matchMedia('(prefers-color-scheme: dark)');
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  } catch {
    return () => {};
  }
}

/** "sistema" tira o atributo e deixa o CSS seguir o aparelho (prefers-color-scheme). */
export function aplicarTema(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'sistema') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', tema);
  gravar(CHAVE_TEMA, tema === 'sistema' ? null : tema);
}
