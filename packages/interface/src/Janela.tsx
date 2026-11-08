// SPDX-License-Identifier: MPL-2.0

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconeFechar } from './icones.tsx';
import type { T } from './tipos.ts';

/**
 * A janela por cima da tela (feedback, entrar, criar conta). Fundo escurecido,
 * fecha com Esc ou no X; o foco vai para dentro dela ao abrir e volta ao fechar.
 * No celular ocupa a largura toda e rola por dentro.
 */
export function Janela({ titulo, t, fechar, children }: { titulo: string; t: T; fechar: () => void; children: ComponentChildren }) {
  const caixa = useRef<HTMLElement>(null);
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    const primeiro = caixa.current?.querySelector<HTMLElement>('input, textarea, button:not(.ekf-fechar), a[href]');
    primeiro?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    addEventListener('keydown', esc);
    return () => {
      removeEventListener('keydown', esc);
      antes?.focus?.();
    };
  }, []);
  return (
    <div class="ekf-fundo" onPointerDown={(e) => e.target === e.currentTarget && fechar()}>
      <section ref={caixa} class="ekf-janela" role="dialog" aria-modal="true" aria-labelledby="ekf-janela-titulo">
        <header>
          <h2 id="ekf-janela-titulo">{titulo}</h2>
          <button type="button" class="ekf-fechar" title={t('nucleo.fechar')} aria-label={t('nucleo.fechar')} onClick={fechar}>
            <IconeFechar tamanho={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
