// SPDX-License-Identifier: MPL-2.0

import type { ComponentChildren, VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Um botão-ícone que abre uma listinha logo abaixo (idioma, conta). Fecha ao
 * escolher, com Esc ou tocando fora.
 */
export function Menu({ rotulo, icone, children }: { rotulo: string; icone: VNode; children: (fechar: () => void) => ComponentChildren }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: Event) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false);
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  return (
    <div class="ekf-menu" ref={raiz}>
      <button type="button" class="ekf-icone" title={rotulo} aria-label={rotulo} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
        {icone}
      </button>
      {aberto && (
        <div class="ekf-menu-lista" role="menu">
          {children(() => setAberto(false))}
        </div>
      )}
    </div>
  );
}
