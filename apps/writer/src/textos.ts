// SPDX-License-Identifier: MPL-2.0

import { criarTradutor, montarCatalogo } from '@ekfrase/nucleo';

/**
 * Todos os arquivos de idioma entram no pacote. Um idioma novo (uma pasta nova
 * em `locales/`) aparece no seletor sem mexer aqui.
 */
const arquivos = import.meta.glob('../../../locales/*/*.json', { eager: true, import: 'default' });

export const tr = criarTradutor(montarCatalogo(arquivos));
export const t = tr.t;

/** "1.234 palavras", no idioma da pessoa. */
export const palavras = (n: number): string => t('writer.palavras', { count: n, n: tr.numero(n) });

/** O texto de um erro que chega como CÓDIGO (da ponte, do núcleo, de um arquivo). Código novo cai no genérico. */
export function textoDoErro(codigo: string | null | undefined, grupo: 'erro' | 'importar.erro' = 'erro'): string {
  const chave = `writer.${grupo}.${codigo ?? ''}`;
  return tr.padrao(chave, 'pt-BR') !== undefined ? t(chave) : t(grupo === 'erro' ? 'writer.erro.servidor' : 'writer.importar.erro.conteudo-invalido');
}

/** "há 3 dias", "agora há pouco": quando foi, em relação a agora. */
export function haQuanto(ms: number, agora: number = Date.now()): string {
  const f = new Intl.RelativeTimeFormat(tr.idioma(), { numeric: 'auto' });
  const s = Math.round((ms - agora) / 1000);
  const passos: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
  ];
  let valor = s;
  let unidade: Intl.RelativeTimeFormatUnit = 'second';
  for (const [tamanho, u] of passos) {
    unidade = u;
    if (Math.abs(valor) < tamanho) return Math.abs(s) < 45 ? t('writer.agora') : f.format(Math.round(valor), unidade);
    valor /= tamanho;
  }
  return f.format(Math.round(valor), 'year');
}

/** Dia e hora, curtos ("12/11/2026 14:05"). */
export const diaEHora = (ms: number): string => new Date(ms).toLocaleString(tr.idioma(), { dateStyle: 'short', timeStyle: 'short' });
