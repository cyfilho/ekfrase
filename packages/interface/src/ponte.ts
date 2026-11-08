// SPDX-License-Identifier: MPL-2.0

/**
 * Conversa mínima com a ponte (`/api/v1/…`), comum a todos os apps: quem sou eu,
 * entrar, criar conta, sair, esqueci a senha, feedback e os documentos na nuvem.
 * Guarda o token CSRF; falha de rede vira o código `rede`. O erro é sempre um
 * CÓDIGO: o texto sai dos idiomas (`nucleo.erro.<código>`).
 *
 * A conta fica num lugar só (`contaAtual`, `aoMudarConta`): o topo, a entrada do
 * app e o castelo veem a mesma coisa, e entrar num lugar vale para todos.
 */

export interface Conta {
  id: number;
  nome: string;
  email: string;
  papeis: string[];
  organizacoes: { id: number; nome: string; papeis: string[] }[];
  /** Quem cuida do site Ekfrase (lê os feedbacks). */
  equipe: boolean;
}

export type Resposta<T = object> = ({ ok: true } & T) | { ok: false; erro: string; [extra: string]: unknown };

const BASE = '/api/v1/';
let csrf = '';

async function bruto<T>(metodo: 'GET' | 'POST', rota: string, corpo?: unknown): Promise<Resposta<T>> {
  try {
    const multipart = corpo instanceof FormData;
    const r = await fetch(BASE + rota, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(metodo === 'POST' ? { 'X-CSRF-Token': csrf } : {}),
        ...(metodo === 'POST' && !multipart ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(corpo === undefined ? {} : { body: multipart ? corpo : JSON.stringify(corpo) }),
    });
    let dados: Record<string, unknown>;
    try {
      dados = (await r.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, erro: r.status === 413 ? 'grande' : 'servidor' };
    }
    if (typeof dados['csrf'] === 'string') csrf = dados['csrf'];
    return dados as Resposta<T>;
  } catch {
    return { ok: false, erro: 'rede' };
  }
}

/** Pede; se o token CSRF venceu, pega outro e tenta de novo uma vez. */
export async function pedir<T = object>(metodo: 'GET' | 'POST', rota: string, corpo?: unknown): Promise<Resposta<T>> {
  if (metodo === 'POST' && !csrf) await eu();
  const r = await bruto<T>(metodo, rota, corpo);
  if (!r.ok && r.erro === 'csrf') return bruto<T>(metodo, rota, corpo);
  return r;
}

// ---------- a conta, num lugar só ----------

type EstadoConta = { carregando: true } | { carregando: false; conta: Conta | null; erro?: string };
let estado: EstadoConta = { carregando: true };
let pedido: Promise<EstadoConta> | null = null;
const ouvintes = new Set<() => void>();

function mudar(novo: EstadoConta): void {
  estado = novo;
  for (const f of ouvintes) f();
}

export function contaAtual(): EstadoConta {
  return estado;
}

export function aoMudarConta(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** Pergunta à ponte quem está logado (uma vez; `forcar` pergunta de novo). */
export function eu(forcar = false): Promise<EstadoConta> {
  if (!pedido || forcar) {
    pedido = bruto<{ conta: Conta | null }>('GET', 'conta/eu').then((r) => {
      const novo: EstadoConta = r.ok ? { carregando: false, conta: r.conta } : { carregando: false, conta: null, erro: r.erro };
      mudar(novo);
      return novo;
    });
  }
  return pedido;
}

async function comConta(r: Promise<Resposta<{ conta: Conta }>>): Promise<Resposta<{ conta: Conta }>> {
  const v = await r;
  if (v.ok) mudar({ carregando: false, conta: v.conta });
  return v;
}

export const entrar = (email: string, senha: string) => comConta(pedir('POST', 'conta/entrar', { email, senha }));

export const criarConta = (d: { nome: string; email: string; senha: string; idioma: string; site: string }) =>
  comConta(pedir('POST', 'conta/criar', d));

export const redefinirSenha = (codigo: string, nova: string) => comConta(pedir('POST', 'conta/redefinir', { codigo, nova }));

export const esqueciSenha = (email: string, app: string, idioma: string) => pedir('POST', 'conta/esqueci', { email, app, idioma });

export async function sair(): Promise<void> {
  await pedir('POST', 'conta/sair', {});
  mudar({ carregando: false, conta: null });
}

// ---------- feedback ----------

export const limiteFeedback = () => pedir<{ restam: number | null; volta_em: string | null }>('GET', 'feedback/limite');
export const enviarFeedback = (dados: FormData) => pedir<{ numero: string }>('POST', 'feedback', dados);

// ---------- documentos na nuvem ----------

export interface Documento {
  id: number;
  nome: string;
  tamanho: number;
  atualizado_em: string;
}

export const listarDocumentos = (app: string) =>
  pedir<{ documentos: Documento[]; usado: number; cota: number }>('GET', `documentos?app=${encodeURIComponent(app)}`);

export function salvarDocumento(app: string, nome: string, bytes: Uint8Array, id?: number) {
  const f = new FormData();
  f.append('arquivo', new Blob([new Uint8Array(bytes)]), 'documento');
  f.append('app', app);
  f.append('nome', nome);
  if (id) f.append('id', String(id));
  return pedir<{ documento: Documento }>('POST', 'documentos', f);
}

export async function abrirDocumento(id: number): Promise<Uint8Array | null> {
  try {
    const r = await fetch(`${BASE}documentos/${id}`, { credentials: 'same-origin' });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export const apagarDocumento = (id: number) => pedir('POST', `documentos/${id}/apagar`, {});

// ---------- perfil: o personagem do modo jogo e a foto (DEC-P050) ----------

/** As escolhas do personagem (a ponte aceita só estes campos). Sem campo = o padrão. */
export interface Avatar {
  pele?: string;
  cabelo?: string;
  roupa?: string;
  calca?: string;
  /** Sem capa = sem o campo. */
  capa?: string;
  penteado?: 'curto' | 'longo' | 'coque' | 'cacheado' | 'raspado';
  chapeu?: 'nenhum' | 'capuz' | 'bruxo' | 'boina';
  traje?: 'tunica' | 'vestido';
  barba?: boolean;
  oculos?: boolean;
}

export interface Perfil {
  avatar: Avatar | null;
  foto: string | null;
}

let perfil: Promise<Perfil | null> | null = null;
const ouvintesPerfil = new Set<(p: Perfil | null) => void>();

/** O perfil de quem entrou (uma vez por página; sem conta, null). */
export function verPerfil(forcar = false): Promise<Perfil | null> {
  if (!perfil || forcar) {
    perfil = eu().then(async (e) => {
      if (e.carregando || !e.conta) return null;
      const r = await pedir<Perfil>('GET', 'avatar');
      return r.ok ? { avatar: r.avatar, foto: r.foto } : null;
    });
  }
  return perfil;
}

export function aoMudarPerfil(f: (p: Perfil | null) => void): () => void {
  ouvintesPerfil.add(f);
  return () => ouvintesPerfil.delete(f);
}

/** Grava o personagem e/ou a foto (`foto: null` tira a foto). */
export async function salvarPerfil(d: { avatar?: Avatar | null; foto?: string | null }): Promise<Resposta<Perfil>> {
  const r = await pedir<Perfil>('POST', 'avatar', d);
  if (r.ok) {
    const p = { avatar: r.avatar, foto: r.foto };
    perfil = Promise.resolve(p);
    for (const f of ouvintesPerfil) f(p);
  }
  return r;
}

aoMudarConta(() => {
  // entrou ou saiu: o perfil é outro (só pergunta de novo se alguém está mostrando o perfil)
  perfil = null;
  if (ouvintesPerfil.size === 0) return;
  void verPerfil().then((p) => {
    for (const f of ouvintesPerfil) f(p);
  });
});

// ---------- inventário (DEC-P049/P050) ----------

export interface ItemInventario {
  secao: string;
  item: string;
  adicionado_em: string;
  atualizado_em: string;
}

const ouvintesInventario = new Set<() => void>();
export function aoMudarInventario(f: () => void): () => void {
  ouvintesInventario.add(f);
  return () => ouvintesInventario.delete(f);
}
const avisarInventario = <R>(r: R): R => {
  for (const f of ouvintesInventario) f();
  return r;
};

export const listarInventario = () => pedir<{ itens: ItemInventario[] }>('GET', 'inventario');
export const porNoInventario = (secao: string, item: string) => pedir('POST', 'inventario', { secao, item }).then(avisarInventario);
export const tirarDoInventario = (secao: string, item: string) => pedir('POST', 'inventario/tirar', { secao, item }).then(avisarInventario);
export const dadosDoItem = <D>(secao: string, item: string) =>
  pedir<{ item: { dados: D | null } }>('GET', `inventario/item?secao=${encodeURIComponent(secao)}&item=${encodeURIComponent(item)}`);
export const gravarDadosDoItem = (secao: string, item: string, dados: object) => pedir('POST', 'inventario/item', { secao, item, dados });
export const contagemInventario = (secao: string) =>
  pedir<{ contagem: Record<string, number> }>('GET', `inventario/contagem?secao=${encodeURIComponent(secao)}`);
