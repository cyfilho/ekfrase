// SPDX-License-Identifier: MPL-2.0

/**
 * Conversa mínima com a ponte (`/api/v1/…`), comum a todos os apps: quem sou eu, sair, esqueci a senha, feedback e
 * os documentos na nuvem. Entrar, criar conta e redefinir a senha estão no `chaves.ts` (X2: a senha não vai à ponte).
 * Guarda o token CSRF; falha de rede vira o código `rede`. O erro é sempre um
 * CÓDIGO: o texto sai dos idiomas (`nucleo.erro.<código>`).
 *
 * A conta fica num lugar só (`contaAtual`, `aoMudarConta`): o topo, a entrada do
 * app e o castelo veem a mesma coisa, e entrar num lugar vale para todos.
 */

import { esquecerChavesDesteAparelho } from './aparelho.ts';

export interface Conta {
  id: number;
  nome: string;
  email: string;
  papeis: string[];
  organizacoes: { id: number; nome: string; papeis: string[] }[];
  /** Quem cuida do site Ekfrase (lê os feedbacks). */
  equipe: boolean;
  /** X2c-2: o e-mail foi confirmado (pelo link ou pelo código). Uma ponte de antes não diz. */
  email_confirmado?: boolean;
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

/**
 * A conta mudou por outro caminho (entrar, criar conta e redefinir são do `chaves.ts`, X2: a senha não vai à ponte).
 */
export function mudarConta(conta: Conta | null): void {
  mudar({ carregando: false, conta });
}

/**
 * Pede a exclusão da conta (7 dias para se arrepender). Já sai da conta neste aparelho e apaga as chaves dele.
 * `prova` = os campos de `provaDaSenha` (do `chaves.ts`): `entrar_atual` (a senha nunca vai em claro).
 */
export async function excluirConta(prova: { entrar_atual: string }, confirmacao: string): Promise<Resposta<{ ate: string }>> {
  const r = await pedir<{ ate: string }>('POST', 'conta/excluir', { ...prova, confirmacao });
  if (r.ok) {
    esquecerChavesDesteAparelho();
    mudar({ carregando: false, conta: null });
  }
  return r;
}

export const esqueciSenha = (email: string, app: string, idioma: string) => pedir('POST', 'conta/esqueci', { email, app, idioma });

/** Sai da conta: a ponte tira este aparelho da conta, e as chaves dele somem daqui (no computador da escola, nada fica). */
export async function sair(): Promise<void> {
  await pedir('POST', 'conta/sair', {});
  esquecerChavesDesteAparelho();
  mudar({ carregando: false, conta: null });
}

// ---------- feedback ----------

export const limiteFeedback = () => pedir<{ restam: number | null; volta_em: string | null }>('GET', 'feedback/limite');
/**
 * Onde guardar o feedback quando não há internet (o Writer OS: `Ekfrase Writer/feedbacks`, no pendrive/SSD). Sem isto
 * (o site), o aviso de "sem rede" aparece como sempre.
 */
export interface FilaDeFeedback {
  guardar(campos: Record<string, string>, arquivos: { campo: string; nome: string; tipo: string; bytes: Uint8Array }[]): Promise<boolean>;
  listar(): Promise<{ id: string; campos: Record<string, string>; arquivos: { campo: string; nome: string; tipo: string; bytes: Uint8Array }[] }[]>;
  apagar(id: string): Promise<void>;
}

let fila: FilaDeFeedback | null = null;
let avisoDaFila: ((pendentes: number) => void) | null = null;

/** Liga a fila e passa a reenviar sozinho o que ficou guardado (ao ligar, a cada volta da internet e de minuto em minuto). */
export function usarFilaDeFeedback(f: FilaDeFeedback): void {
  fila = f;
  void enviarGuardados();
  addEventListener('online', () => void enviarGuardados());
  setInterval(() => void enviarGuardados(), 60_000);
}

export const aoMudarFilaDeFeedback = (f: ((pendentes: number) => void) | null) => void (avisoDaFila = f);

let reenviando = false;

/** Envia o que ficou guardado, um por um, na ordem. Para no primeiro que falhar por falta de internet. Devolve quantos enviou. */
export async function enviarGuardados(): Promise<number> {
  if (!fila || reenviando) return 0;
  reenviando = true;
  let enviados = 0;
  try {
    for (const g of await fila.listar()) {
      const d = new FormData();
      for (const [k, v] of Object.entries(g.campos)) d.append(k, v);
      for (const a of g.arquivos) d.append(a.campo, new Blob([new Uint8Array(a.bytes)], { type: a.tipo }), a.nome);
      const r = await bruto<{ numero: string }>('POST', 'feedback', d);
      if (r.ok || (!r.ok && !['rede', 'servidor', 'limite', 'csrf'].includes(r.erro))) {
        // chegou, ou o servidor recusou de vez (vazio, tipo, grande…): não adianta guardar de novo
        await fila.apagar(g.id);
        enviados++;
      } else if (!r.ok && r.erro === 'csrf') {
        await eu();
        break;
      } else break;
    }
    avisoDaFila?.((await fila.listar()).length);
  } finally {
    reenviando = false;
  }
  return enviados;
}

export async function enviarFeedback(dados: FormData): Promise<Resposta<{ numero: string; guardado?: boolean }>> {
  const r = await pedir<{ numero: string }>('POST', 'feedback', dados);
  if (r.ok || r.erro !== 'rede' || !fila) return r;
  const campos: Record<string, string> = {};
  const arquivos: { campo: string; nome: string; tipo: string; bytes: Uint8Array }[] = [];
  for (const [k, v] of dados.entries()) {
    if (typeof v === 'string') campos[k] = v;
    else arquivos.push({ campo: k, nome: v.name, tipo: v.type, bytes: new Uint8Array(await v.arrayBuffer()) });
  }
  if (!(await fila.guardar(campos, arquivos))) return r;
  void fila.listar().then((l) => avisoDaFila?.(l.length));
  return { ok: true, numero: '', guardado: true };
}

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
