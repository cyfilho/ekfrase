// SPDX-License-Identifier: MPL-2.0

import { criarTradutor, montarCatalogo } from '@ekfrase/nucleo';

/**
 * Todos os arquivos de idioma entram no pacote. Um idioma novo (uma pasta nova
 * em `locales/`) aparece no seletor sem mexer aqui.
 */
const arquivos = import.meta.glob('../../../locales/*/*.json', { eager: true, import: 'default' });

export const tr = criarTradutor(montarCatalogo(arquivos));
export const t = tr.t;
