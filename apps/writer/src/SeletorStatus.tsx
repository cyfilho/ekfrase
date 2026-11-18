// SPDX-License-Identifier: MPL-2.0

/**
 * O seletor do status da cena (a folha, as notas e a árvore da história usam). Num arquivo só dele: a árvore
 * (`Historia.tsx`) não pode importar a folha, que leva o CodeMirror (o pacote grande só carrega na folha).
 */
import { STATUS_CENA, type Cena, type StatusCena } from '@ekfrase/writer-nucleo';
import { useSessao } from './estado.ts';
import { t } from './textos.ts';

export function SeletorStatus({ cena, teste }: { cena: Cena; teste?: string }) {
  const s = useSessao();
  return (
    <select
      class="seletor-status"
      value={cena.status}
      aria-label={t('writer.cena.status')}
      onChange={(e) => void s.escrita.editarCena(cena.id, { status: e.currentTarget.value as StatusCena })}
      data-teste={teste}
    >
      {STATUS_CENA.map((st) => (
        <option key={st} value={st}>
          {t(`writer.status.${st}`)}
        </option>
      ))}
    </select>
  );
}
