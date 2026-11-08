// SPDX-License-Identifier: MPL-2.0

import type { Tradutor } from '@ekfrase/nucleo';
import { IconeGlobo } from './icones.tsx';
import { Menu } from './Menu.tsx';

/**
 * O idioma: um botão com o globo que abre a lista. Todo idioma com pasta em
 * `locales/` aparece sozinho, pelo próprio nome. `aoTrocar` serve a app que tem
 * tradutor próprio além do do núcleo (o Maker).
 */
export function SeletorIdioma({ tr, aoTrocar }: { tr: Tradutor; aoTrocar?: (codigo: string) => void }) {
  const rotulo = tr.t('nucleo.idioma.rotulo');
  return (
    <Menu rotulo={rotulo} icone={<IconeGlobo />}>
      {(fechar) =>
        tr.idiomas().map((i) => (
          <button
            key={i.codigo}
            type="button"
            role="menuitemradio"
            aria-checked={i.codigo === tr.idioma()}
            lang={i.codigo}
            onClick={() => {
              tr.trocarIdioma(i.codigo);
              aoTrocar?.(i.codigo);
              fechar();
            }}
          >
            {i.nome}
          </button>
        ))
      }
    </Menu>
  );
}
