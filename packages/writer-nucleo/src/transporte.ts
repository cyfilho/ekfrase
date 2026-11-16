// SPDX-License-Identifier: MPL-2.0

/**
 * O TRANSPORTE: como o sincronizador fala com o servidor (docs/writer/protocolo/README.md §7).
 * É uma interface, para os testes usarem um servidor falso e a casca do Writer OS usar o dela.
 *
 * `TransporteHttp` fala com a ponte (`/api/v1/escrita/*`) como o `ponte.ts` da casca comum: cookie
 * de sessão, token CSRF em `X-CSRF-Token` (vem no campo `csrf` das respostas), erro sempre como
 * CÓDIGO (`rede`, `servidor`, `login`…). A base do endereço é parâmetro: é o "outro servidor".
 */
import { ehHlc } from './hlc.ts';
import { ehColecao, type RegistroEnvio, type RegistroServidor } from './modelo.ts';

export const VERSAO_PROTOCOLO = 1;
/** O máximo de registros num pedido (dos dois lados). */
export const MAX_POR_PEDIDO = 500;

export type Resposta<T = object> = ({ ok: true } & T) | { ok: false; erro: string };

export interface Mudancas {
  registros: RegistroServidor[];
  cursor: number;
  mais: boolean;
}

export type ResultadoEnvio =
  | { id: string; estado: 'aceito'; seq: number }
  | { id: string; estado: 'conflito'; servidor: RegistroServidor }
  | { id: string; estado: 'recusado'; erro: string };

export interface Envio {
  resultados: ResultadoEnvio[];
  cursor: number;
}

export interface Transporte {
  /** `GET escrita/mudancas`: o que mudou no servidor depois do cursor. */
  mudancas(desde: number, limite?: number): Promise<Resposta<Mudancas>>;
  /** `POST escrita/enviar`: de 1 a 500 registros; um resultado para cada, na mesma ordem. */
  enviar(registros: readonly RegistroEnvio[]): Promise<Resposta<Envio>>;
}

/** A função de pedir à ponte (a do `ponte.ts` da casca comum serve). */
export type Pedir = (metodo: 'GET' | 'POST', rota: string, corpo?: unknown) => Promise<Resposta<Record<string, unknown>>>;

const inteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function registroDoServidor(v: unknown): v is RegistroServidor {
  const r = v as Partial<RegistroServidor> | null;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && ehColecao(r.colecao) && ehHlc(r.versao) && typeof r.apagado === 'boolean' && !!r.dados && typeof r.dados === 'object' && inteiro(r.seq);
}

function resultado(v: unknown): v is ResultadoEnvio {
  const r = v as { id?: unknown; estado?: unknown; seq?: unknown; servidor?: unknown; erro?: unknown } | null;
  if (!r || typeof r !== 'object' || typeof r.id !== 'string') return false;
  if (r.estado === 'aceito') return inteiro(r.seq);
  if (r.estado === 'conflito') return registroDoServidor(r.servidor);
  return r.estado === 'recusado' && typeof r.erro === 'string';
}

/** Um transporte em cima de qualquer função de pedir. Resposta fora do contrato vira o erro `servidor`. */
export function transporteCom(pedir: Pedir): Transporte {
  return {
    async mudancas(desde, limite = MAX_POR_PEDIDO) {
      const r = await pedir('GET', `escrita/mudancas?desde=${desde}&limite=${limite}`);
      if (!r.ok) return r;
      const { registros, cursor, mais } = r;
      if (!Array.isArray(registros) || !registros.every(registroDoServidor) || !inteiro(cursor) || typeof mais !== 'boolean') return { ok: false, erro: 'servidor' };
      return { ok: true, registros, cursor, mais };
    },
    async enviar(registros) {
      const r = await pedir('POST', 'escrita/enviar', { registros });
      if (!r.ok) return r;
      const { resultados, cursor } = r;
      if (!Array.isArray(resultados) || !resultados.every(resultado) || !inteiro(cursor)) return { ok: false, erro: 'servidor' };
      return { ok: true, resultados, cursor };
    },
  };
}

export interface OpcoesHttp {
  /** A base da API, com barra no fim (padrão: `/api/v1/`, o próprio site). */
  base?: string;
  /** Para os testes e para a casca (padrão: o `fetch` global). */
  fetch?: typeof fetch;
}

/** Um `pedir` próprio, igual ao do `ponte.ts`, para uma base qualquer. */
export function criarPedir(opcoes: OpcoesHttp = {}): Pedir {
  const base = opcoes.base ?? '/api/v1/';
  const buscar: typeof fetch = opcoes.fetch ?? ((...a) => globalThis.fetch(...a));
  // outro servidor = outra origem: o cookie só vai com `include`
  const credentials: RequestCredentials = /^https?:/i.test(base) ? 'include' : 'same-origin';
  let csrf = '';

  const bruto: Pedir = async (metodo, rota, corpo) => {
    try {
      const r = await buscar(base + rota, {
        method: metodo,
        credentials,
        headers: { Accept: 'application/json', ...(metodo === 'POST' ? { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' } : {}) },
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
      });
      let dados: Record<string, unknown>;
      try {
        dados = (await r.json()) as Record<string, unknown>;
      } catch {
        return { ok: false, erro: r.status === 413 ? 'grande' : 'servidor' };
      }
      if (!dados || typeof dados !== 'object') return { ok: false, erro: 'servidor' };
      if (typeof dados['csrf'] === 'string') csrf = dados['csrf'];
      if (dados['ok'] === true) return dados as Resposta<Record<string, unknown>>;
      return { ok: false, erro: typeof dados['erro'] === 'string' ? dados['erro'] : 'servidor' };
    } catch {
      return { ok: false, erro: 'rede' };
    }
  };

  return async (metodo, rota, corpo) => {
    if (metodo === 'POST' && !csrf) await bruto('GET', 'conta/eu');
    const r = await bruto(metodo, rota, corpo);
    // token vencido: a resposta do erro já trouxe o novo
    if (!r.ok && r.erro === 'csrf') return bruto(metodo, rota, corpo);
    return r;
  };
}

/** O transporte que fala com a ponte por HTTP. */
export class TransporteHttp implements Transporte {
  readonly base: string;
  private readonly t: Transporte;

  constructor(opcoes: OpcoesHttp = {}) {
    this.base = opcoes.base ?? '/api/v1/';
    this.t = transporteCom(criarPedir(opcoes));
  }

  mudancas(desde: number, limite?: number): Promise<Resposta<Mudancas>> {
    return this.t.mudancas(desde, limite);
  }

  enviar(registros: readonly RegistroEnvio[]): Promise<Resposta<Envio>> {
    return this.t.enviar(registros);
  }
}

export interface InfoServidor {
  nome: string;
  versaoProtocolo: number;
  aceitaCadastro: boolean;
}

/**
 * Do que a pessoa digitou ("meusite.org", "https://meusite.org/", "…/api/v1/") para a base da API.
 * `null` se não for um endereço http(s).
 */
export function baseDoServidor(endereco: string): string | null {
  const limpo = endereco.trim();
  if (!limpo) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(limpo) ? limpo : `https://${limpo}`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const caminho = u.pathname.replace(/\/+$/, '');
  const i = caminho.indexOf('/api/v1');
  return `${u.origin}${i >= 0 ? caminho.slice(0, i) : caminho}/api/v1/`;
}

export type ServidorConferido = { ok: true; base: string; servidor: InfoServidor } | { ok: false; erro: 'endereco' | 'rede' | 'nao-e-ekfrase' | 'protocolo' };

/**
 * "Conectar a outro servidor": confere se o endereço é mesmo de um servidor Ekfrase
 * (`GET escrita/servidor`, sem login) e se fala o mesmo protocolo. Devolve a base para o `TransporteHttp`.
 */
export async function conferirServidor(endereco: string, buscar: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<ServidorConferido> {
  const base = baseDoServidor(endereco);
  if (!base) return { ok: false, erro: 'endereco' };
  let dados: Record<string, unknown>;
  try {
    const r = await buscar(`${base}escrita/servidor`, { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' } });
    try {
      dados = (await r.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, erro: 'nao-e-ekfrase' };
    }
  } catch {
    return { ok: false, erro: 'rede' };
  }
  if (!dados || dados['ok'] !== true || typeof dados['nome'] !== 'string' || typeof dados['versaoProtocolo'] !== 'number') return { ok: false, erro: 'nao-e-ekfrase' };
  if (dados['versaoProtocolo'] !== VERSAO_PROTOCOLO) return { ok: false, erro: 'protocolo' };
  return { ok: true, base, servidor: { nome: dados['nome'], versaoProtocolo: dados['versaoProtocolo'], aceitaCadastro: dados['aceitaCadastro'] === true } };
}
