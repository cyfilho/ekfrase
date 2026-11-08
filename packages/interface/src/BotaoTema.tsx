// SPDX-License-Identifier: MPL-2.0

import { aoMudarAparelho, aplicarTema, temaEfetivo } from '@ekfrase/nucleo';
import { useEffect, useState } from 'preact/hooks';
import { IconeLua, IconeSol } from './icones.tsx';
import type { T } from './tipos.ts';

/**
 * O botão de tema: só o desenho do tema PARA ONDE ele leva (a lua com a tela
 * clara, o sol com a escura); o nome vai no `title` e no `aria-label`. Sem
 * escolha, a tela segue o aparelho; o primeiro clique grava a escolha. Voltar a
 * seguir o aparelho fica em "Minha conta" (que avisa pelo evento `ekfrase-tema`).
 */
export function BotaoTema({ t }: { t: T }) {
  const [agora, setAgora] = useState(temaEfetivo());
  useEffect(() => {
    const ver = () => setAgora(temaEfetivo());
    addEventListener('ekfrase-tema', ver);
    const parar = aoMudarAparelho(ver);
    return () => {
      removeEventListener('ekfrase-tema', ver);
      parar();
    };
  }, []);
  const destino = agora === 'escuro' ? 'claro' : 'escuro';
  const rotulo = t(`nucleo.tema.mudar_para_${destino}`);
  return (
    <button
      type="button"
      class="ekf-icone"
      title={rotulo}
      aria-label={rotulo}
      onClick={() => {
        aplicarTema(destino);
        setAgora(destino);
        dispatchEvent(new Event('ekfrase-tema'));
      }}
    >
      {destino === 'escuro' ? <IconeLua /> : <IconeSol />}
    </button>
  );
}
