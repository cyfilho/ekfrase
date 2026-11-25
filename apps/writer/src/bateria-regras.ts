// SPDX-License-Identifier: MPL-2.0

import type { Bateria } from '@ekfrase/writer-nucleo';

/** Os níveis do alerta (como o Windows: bateria fraca e quase no fim). */
export const NIVEL_FRACA = 20;
export const NIVEL_MUITO_FRACA = 10;

export type Alerta = 0 | typeof NIVEL_FRACA | typeof NIVEL_MUITO_FRACA;

/** Qual alerta a bateria pede agora (cada um só uma vez por descida; ligou na tomada ou subiu de 20%, recomeça). */
export function alertaDaBateria(b: Bateria, ja: Alerta): Alerta {
  if (b.carregando || b.nivel > NIVEL_FRACA) return 0;
  if (b.nivel <= NIVEL_MUITO_FRACA) return NIVEL_MUITO_FRACA;
  return ja === NIVEL_MUITO_FRACA ? ja : NIVEL_FRACA;
}
