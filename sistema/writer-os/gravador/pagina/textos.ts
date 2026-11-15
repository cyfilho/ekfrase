// SPDX-License-Identifier: MPL-2.0

import { criarTradutor, montarCatalogo } from '@ekfrase/nucleo';

/** Só os textos do Gravador (`locales/<idioma>/gravador.json`): um idioma novo aparece sozinho. */
const arquivos = import.meta.glob('../../../../locales/*/gravador.json', { eager: true, import: 'default' });

export const tr = criarTradutor(montarCatalogo(arquivos));
export const t = tr.t;

/** "15,5 GB" (como os fabricantes contam: 1 GB = 10⁹ bytes, que é o que vem escrito no pendrive). */
export function tamanho(bytes: number): string {
  const f = (n: number, u: string) => `${new Intl.NumberFormat(tr.idioma(), { maximumFractionDigits: n >= 100 ? 0 : 1 }).format(n)} ${u}`;
  if (bytes >= 1e12) return f(bytes / 1e12, 'TB');
  if (bytes >= 1e9) return f(bytes / 1e9, 'GB');
  return f(Math.max(bytes, 0) / 1e6, 'MB');
}

/** O texto de um erro que chega como código; código novo cai no genérico. */
export function textoDoErro(codigo: string): string {
  const chave = `gravador.erro.${codigo}`;
  return tr.padrao(chave, 'pt-BR') !== undefined ? t(chave) : t('gravador.erro.escrita');
}
