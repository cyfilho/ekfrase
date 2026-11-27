// SPDX-License-Identifier: MPL-2.0

import { chaveDoErro } from '@ekfrase/interface';
import type { Parametros } from '@ekfrase/nucleo';

/**
 * Um aviso na tela é guardado como CHAVE de texto (e parâmetros), nunca como o
 * texto pronto: trocar o idioma traduz o aviso que já está na tela.
 */
export interface Aviso {
  chave: string;
  p?: Parametros;
  tipo?: 'erro' | 'ok';
}

/**
 * Converte o código de erro da ponte na chave do texto: os `conhecidos` viram
 * `<prefixo>.<codigo>`; bloqueio, rede e o resto têm texto comum.
 */
export function avisoDoErro(r: { erro: string; [k: string]: unknown }, prefixo: string, conhecidos: readonly string[]): Aviso {
  if (r.erro === 'bloqueado') return { chave: 'vernakula.entrar.erro.bloqueado', p: { minutos: Number(r['minutos'] ?? 15) } };
  if (conhecidos.includes(r.erro)) return { chave: `${prefixo}.${r.erro}` };
  if (r.erro === 'rede') return { chave: 'nucleo.erro.rede' };
  return { chave: 'nucleo.erro.servidor' };
}

/**
 * Como o `avisoDoErro`, para as telas da conta (entrar, senha, perfil): o que não é dos `conhecidos` ganha o texto
 * comum da conta Ekfrase (os erros das chaves, X2: `nucleo.conta.erro.*`).
 */
export function avisoDaConta(r: { erro: string; [k: string]: unknown }, prefixo: string, conhecidos: readonly string[]): Aviso {
  if (r.erro === 'bloqueado' || r.erro === 'rede' || conhecidos.includes(r.erro)) return avisoDoErro(r, prefixo, conhecidos);
  return { chave: chaveDoErro(r.erro) };
}

/** Os marcadores {x} de um texto, em ordem (para comparar com o padrão). */
export const marcadores = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(', ');
