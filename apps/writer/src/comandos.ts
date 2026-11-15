// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from 'preact/hooks';

/**
 * Os COMANDOS: toda ação do Writer é um comando com nome, e é daqui que saem a paleta (Ctrl+K) e os
 * atalhos de teclado. Cada tela registra os seus com `useComandos`; o que está na tela agora é o que
 * a paleta mostra. Assim nada fica só no mouse (PLANO §2.4).
 */
export interface Comando {
  /** Estável (serve de `data-teste` na paleta). */
  id: string;
  /** Já traduzido. */
  rotulo: string;
  /** "Ctrl+K", "Alt+ArrowUp", "F1", "?"… (como `teclaDe` devolve). */
  atalho?: string;
  /** Não dispara pelo atalho enquanto a pessoa digita num campo (a paleta sempre pode). */
  foraDeCampo?: boolean;
  fazer: () => void;
}

type Fonte = () => readonly Comando[];
const fontes = new Set<{ atual: Fonte }>();

/** Registra os comandos de uma tela enquanto ela estiver aberta (a lista é lida na hora do uso). */
export function useComandos(fonte: Fonte): void {
  const ref = useRef({ atual: fonte });
  ref.current.atual = fonte;
  useEffect(() => {
    const r = ref.current;
    fontes.add(r);
    return () => {
      fontes.delete(r);
    };
  }, []);
}

/** Todos os comandos que valem agora (os da tela aberta por último primeiro), sem repetir o id. */
export function comandosDeAgora(): Comando[] {
  const vistos = new Set<string>();
  const saida: Comando[] = [];
  for (const f of [...fontes].reverse()) {
    for (const c of f.atual()) {
      if (vistos.has(c.id)) continue;
      vistos.add(c.id);
      saida.push(c);
    }
  }
  return saida;
}

/** A tecla de um evento, do jeito que os comandos escrevem: "Ctrl+K", "Alt+ArrowUp", "Ctrl+,", "F1", "?". */
export function teclaDe(e: KeyboardEvent): string {
  const partes: string[] = [];
  if (e.ctrlKey || e.metaKey) partes.push('Ctrl');
  if (e.altKey) partes.push('Alt');
  // o Shift só conta em tecla com nome (Shift+Tab); em letra e sinal ele já mudou o caractere ("?")
  if (e.shiftKey && e.key.length > 1) partes.push('Shift');
  partes.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
  return partes.join('+');
}

/** Como o atalho aparece para a pessoa ("Alt+↑"). */
export function atalhoBonito(atalho: string): string {
  return atalho.replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→');
}

/** Sem acento e em minúsculas: "Capítulo" acha "capitulo". */
export const semAcento = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** A pessoa está digitando num campo? (Atalho de uma tecla só, como "?", não pode disparar aí.) */
export function emCampo(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

/** Filtra pelo que foi digitado: todas as palavras têm de aparecer no nome (sem acento). */
export function buscarComandos(lista: readonly Comando[], busca: string): Comando[] {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  if (!termos.length) return [...lista];
  const primeiro = termos[0]!;
  return lista
    .map((c) => ({ c, nome: semAcento(c.rotulo) }))
    .filter(({ nome }) => termos.every((p) => nome.includes(p)))
    .sort((a, b) => Number(b.nome.startsWith(primeiro)) - Number(a.nome.startsWith(primeiro)))
    .map(({ c }) => c);
}
