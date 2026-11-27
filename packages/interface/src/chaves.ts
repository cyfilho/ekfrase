// SPDX-License-Identifier: MPL-2.0

/**
 * A conta Ekfrase com chaves, do lado do app (X2, `docs/ARQUITETURA.md` §5.2 e §5.6; o formato em
 * `docs/protocolo/identidade/` §8 a §12). **Sem tela:** as telas comuns (`Conta.tsx`, `Chaves.tsx`) e as dos apps
 * chamam estas funções. O contrato com a ponte é o bloco "X2" do `tests/ponte.test.ts`.
 *
 * - **A senha não vai à ponte.** Dela sai (Argon2id + HKDF, no `senha-worker.ts`) a chave de ENTRAR, que vai, e a do
 *   COFRE, que nunca sai daqui. A ponte devolve o cofre, e só este aparelho o abre.
 * - **A semente da pessoa não mora em aparelho nenhum.** Ela abre por instantes (entrar num aparelho novo, trocar a
 *   senha, revogar, refazer o cofre, ver o kit) e é apagada logo. Este aparelho guarda só o par DELE, a cópia
 *   cifrada da semente (a guarda fica na ponte) e as gerações da chave de caixa (`aparelho.ts`).
 * - **Um servidor não rebaixa o login:** o e-mail que já entrou com chaves neste navegador nunca mais manda a senha em
 *   claro, nem se a ponte disser que a conta é "antiga" ou não souber as rotas novas.
 * - Dado de fora estragado vira `{ok:false, erro}`, nunca exceção. Os códigos de erro novos têm texto em
 *   `nucleo.conta.erro.<código>`.
 */
import {
  abrirCaixa,
  abrirCofre,
  abrirGuardado,
  apagar,
  apresentarAparelho,
  assinarCofre,
  chaveDeCaixa,
  codigoDoAparelho,
  conferirAparelho,
  conferirDeclaracaoDeCaixa,
  contextoDeGeracao,
  declararCaixa,
  derivarDaSenha,
  doBase64url,
  fecharCaixa,
  fecharCofre,
  guardarSemente,
  identidadeDaSemente,
  idiomaDoKit,
  iguais,
  levarSemente,
  novaPessoa,
  novoAparelho,
  novosParametros,
  palavrasDaSemente,
  paraBase64url,
  parametrosValidos,
  pessoaDoKit,
  provarSessao,
  publicaDaGeracao,
  publicasDoJson,
  publicasParaJson,
  receberSemente,
  revogarAparelho,
  separarPalavras,
  type ChavesDaSenha,
  type ChavesPublicas,
  type Identidade,
  type IdiomaDoKit,
  type ParametrosDaSenha,
} from '@ekfrase/identidade';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  apagarAparelho,
  contaComChavesLembrada,
  gravarAparelho,
  lembrarContaComChaves,
  lerAparelho,
  marcarPessoaAtual,
  type AparelhoGuardado,
} from './aparelho.ts';
import { contaAtual, mudarConta, pedir as pedirNaPonte, type Conta, type Resposta } from './ponte.ts';

// ---------- o que a ponte diz das chaves da conta (o `estado` do Chaves.php) ----------

export interface EstadoDasChaves {
  /** A conta de antes da X2 (sem chaves ainda). */
  readonly antiga: boolean;
  readonly kdf: unknown;
  readonly pessoa: { readonly endereco: string; readonly assinar: string; readonly cifrar: string } | null;
  readonly cofre: unknown;
  /** A senha foi redefinida pelo e-mail: o cofre ainda é o da senha de antes (abre com o kit ou outro aparelho). */
  readonly trancado: boolean;
  readonly caixa: unknown;
  readonly geracao: number;
  readonly kit_conferido: boolean;
  /** O aparelho ligado a esta sessão (endereço), ou `null`. */
  readonly aparelho: string | null;
  readonly desafio: string;
}

/** Como a conta ficou neste aparelho depois de entrar. */
export type Situacao =
  /**
   * Tudo aberto. `kit` = a pessoa nasceu agora (conta nova, a conta de antes que trocou, a pessoa nova): as 12
   * palavras para a tela do kit, que as esquece ao fechar. `aviso` = entrou, mas este aparelho não se apresentou
   * (o código do erro; a conta funciona, só as coisas cifradas esperam).
   */
  | { readonly tipo: 'aberto'; readonly kitConferido: boolean; readonly kit?: KitParaMostrar; readonly aviso?: string }
  /** O cofre está trancado: abrir com o kit, com a cópia deste aparelho (`temCopia`) ou pedir a outro aparelho. */
  | { readonly tipo: 'trancado'; readonly temCopia: boolean }
  /** Um servidor de antes (sem as chaves): entrou do jeito de sempre. */
  | { readonly tipo: 'antiga' };

export interface KitParaMostrar {
  readonly palavras: readonly string[];
  readonly idioma: IdiomaDoKit;
}

export interface Opcoes {
  /** De 0 a 1, enquanto a senha é protegida (a barra). */
  readonly aoProgredir?: (fracao: number) => void;
  /** O idioma da interface (o kit sai nele: pt ou en). */
  readonly idioma?: string;
}

export type Pedir = <T = object>(metodo: 'GET' | 'POST', rota: string, corpo?: unknown) => Promise<Resposta<T>>;

let pedir: Pedir = pedirNaPonte;
/** Troca o caminho até a ponte (o teste usa um cliente com o cookie dele; a casca, o servidor escolhido). */
export function usarPonte(p: Pedir | null): void {
  pedir = p ?? pedirNaPonte;
}

let nomeDoAparelho: string | (() => string) | null = null;
/**
 * O nome com que este aparelho se apresenta ("Writer no computador"); sem isto, o navegador e o sistema. Uma função
 * é chamada na hora de se apresentar (o nome sai no idioma da tela daquele momento).
 */
export function definirNomeDoAparelho(n: string | (() => string) | null): void {
  nomeDoAparelho = n;
}

const b64 = paraBase64url;
const falha = (erro: string, extra: Record<string, unknown> = {}): { ok: false; erro: string; [k: string]: unknown } => ({ ok: false, erro, ...extra });

/** O nome que o aparelho leva no certificado: "Firefox · Android", "Chrome · Windows". */
export function nomePadraoDoAparelho(): string {
  const dado = typeof nomeDoAparelho === 'function' ? nomeDoAparelho() : nomeDoAparelho;
  if (dado?.trim()) return dado.trim().slice(0, 60);
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [nav, so].filter(Boolean).join(' · ') || 'Ekfrase';
}

const hashDoEmail = (email: string) => bytesToHex(sha256(utf8ToBytes(`ekfrase/email:${email.trim().toLowerCase()}`)));

/** A conta de agora já entrou com chaves neste navegador? (então a senha em claro nunca mais sai daqui) */
function contaAtualTemChaves(): boolean {
  const c = contaAtual();
  return !c.carregando && c.conta !== null && contaComChavesLembrada(hashDoEmail(c.conta.email));
}

// ---------- a senha: o Argon2id num Worker (com a barra) ----------

let workerQuebrado = false;

/**
 * As duas chaves da senha. Num Worker (a página não trava e a barra anda); sem Worker (o teste, um navegador que
 * barra), na própria página: o resultado é o mesmo. Lança `RangeError` com parâmetros fora do aceito.
 */
export async function derivar(senha: string, kdf: ParametrosDaSenha, aoProgredir?: (f: number) => void): Promise<ChavesDaSenha> {
  if (!parametrosValidos(kdf)) throw new RangeError('parâmetros da senha fora do aceito');
  if (typeof Worker !== 'undefined' && !workerQuebrado) {
    try {
      return await new Promise<ChavesDaSenha>((resolver, recusar) => {
        const w = new Worker(new URL('./senha-worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<{ progresso?: number; entrar?: Uint8Array; cofre?: Uint8Array; erro?: string }>) => {
          const d = e.data;
          if (typeof d.progresso === 'number') return aoProgredir?.(d.progresso);
          w.terminate();
          if (d.entrar instanceof Uint8Array && d.cofre instanceof Uint8Array) resolver({ entrar: d.entrar, cofre: d.cofre });
          else recusar(new RangeError(d.erro ?? 'kdf'));
        };
        w.onerror = (e) => {
          e.preventDefault();
          w.terminate();
          recusar(new Error('worker'));
        };
        w.postMessage({ senha, kdf });
      });
    } catch (e) {
      if (e instanceof RangeError) throw e;
      workerQuebrado = true; // o Worker não sobe aqui (CSP, navegador velho): na página daqui em diante
    }
  }
  return derivarDaSenha(senha, kdf, aoProgredir ? { aoProgredir } : {});
}

// ---------- o estado, num lugar só ----------

let estadoAtual: EstadoDasChaves | null = null;
/** O que fica na memória (nunca no disco) enquanto o cofre está trancado: as chaves da senha de AGORA. */
let pendente: { kdf: ParametrosDaSenha; entrar: Uint8Array; cofre: Uint8Array; pessoa: string } | null = null;
const ouvintes = new Set<() => void>();

export function estadoDasChaves(): EstadoDasChaves | null {
  return estadoAtual;
}

export function aoMudarChaves(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

function lerEstado(x: unknown): EstadoDasChaves | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, unknown>;
  const p = e['pessoa'] as Record<string, unknown> | null | undefined;
  const pessoa = p && typeof p['endereco'] === 'string' && /^[0-9a-f]{32}$/.test(p['endereco']) ? { endereco: p['endereco'], assinar: String(p['assinar'] ?? ''), cifrar: String(p['cifrar'] ?? '') } : null;
  return {
    antiga: e['antiga'] === true || pessoa === null,
    kdf: e['kdf'],
    pessoa,
    cofre: e['cofre'],
    trancado: e['trancado'] === true,
    caixa: e['caixa'],
    geracao: typeof e['geracao'] === 'number' && Number.isSafeInteger(e['geracao']) ? e['geracao'] : 0,
    kit_conferido: e['kit_conferido'] === true,
    aparelho: typeof e['aparelho'] === 'string' ? e['aparelho'] : null,
    desafio: typeof e['desafio'] === 'string' ? e['desafio'] : '',
  };
}

function mudar(e: EstadoDasChaves | null): EstadoDasChaves | null {
  estadoAtual = e;
  if (e?.pessoa) marcarPessoaAtual(e.pessoa.endereco);
  if (!e?.trancado && pendente) esquecerPendente();
  for (const f of ouvintes) f();
  return e;
}

function esquecerPendente(): void {
  if (pendente) apagar(pendente.entrar, pendente.cofre);
  pendente = null;
}

/** Pergunta à ponte como estão as chaves da conta (e guarda). */
export async function verChaves(): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  const r = await pedir<{ chaves: unknown }>('GET', 'chaves/eu');
  if (!r.ok) return r;
  const e = lerEstado(r.chaves);
  if (!e) return falha('servidor');
  mudar(e);
  return { ok: true, chaves: e };
}

async function desafioDaSessao(): Promise<string | null> {
  const r = await pedir<{ desafio?: unknown }>('GET', 'conta/eu');
  return r.ok && typeof r.desafio === 'string' && /^[0-9a-f]{64}$/.test(r.desafio) ? r.desafio : null;
}

// ---------- o pacote das chaves de uma pessoa que nasce ----------

function sementeDoAparelho(a: AparelhoGuardado): Identidade | null {
  const s = doBase64url(a.semente);
  if (!s || s.length !== 32) return null;
  try {
    return identidadeDaSemente(s);
  } finally {
    apagar(s);
  }
}

/** As gerações que o aparelho guarda (as últimas 256: a conta revoga poucos aparelhos na vida). */
const GERACOES_GUARDADAS = 256;
function comGeracoes(a: AparelhoGuardado, semente: Uint8Array, ate: number): AparelhoGuardado {
  const caixas: Record<string, string> = { ...a.caixas };
  for (let g = Math.max(1, ate - GERACOES_GUARDADAS + 1); g <= ate; g++) {
    if (!caixas[String(g)]) {
      const c = chaveDeCaixa(semente, g);
      caixas[String(g)] = b64(c.segredo);
      apagar(c.segredo);
    }
  }
  return { ...a, caixas };
}

/**
 * O pacote que a ponte confere ao nascer uma pessoa (criar conta, a conta de antes que troca, redefinir a de antes,
 * a pessoa nova): o cofre com a senha, assinado; a geração 1; este aparelho apresentado, com a guarda e a prova.
 */
function fazerPacote(semente: Uint8Array, senha: ChavesDaSenha, kdf: ParametrosDaSenha, desafio: string) {
  const pessoa = identidadeDaSemente(semente);
  const cofre = fecharCofre(semente, senha.cofre, kdf);
  const ap = novoAparelho();
  const certificado = apresentarAparelho(pessoa, ap.identidade.publicas, nomePadraoDoAparelho());
  const { guarda, guardado } = guardarSemente(semente, ap.identidade.endereco);
  const chaves = {
    entrar: b64(senha.entrar),
    cofre,
    assinatura_cofre: assinarCofre(pessoa, cofre),
    caixa: declararCaixa(semente, 1),
    certificado,
    guarda: b64(guarda),
    prova: provarSessao(ap.identidade, desafio),
  };
  apagar(guarda);
  const local = comGeracoes({ v: 1, semente: b64(ap.semente), certificado, guardado, caixas: {} }, semente, 1);
  apagar(ap.semente);
  return { chaves, local, pessoa: pessoa.endereco };
}

function kitDe(semente: Uint8Array, idioma: IdiomaDoKit): KitParaMostrar {
  return { palavras: palavrasDaSemente(semente, idioma), idioma };
}

// ---------- este aparelho: apresentar-se, guardar as gerações, ler a caixa de entrada ----------

/**
 * Com a semente da pessoa aberta: liga esta sessão ao aparelho que já existe aqui (ou apresenta um novo), guarda as
 * gerações da chave de caixa e lê a caixa de entrada. `novaGuarda` = a guarda deste aparelho saiu da ponte (ao abrir
 * a cópia ou atender um pedido): troca por outra.
 */
async function ligarAparelho(semente: Uint8Array, e: EstadoDasChaves, novaGuarda = false): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  const pessoa = identidadeDaSemente(semente);
  let estado = e;
  let local = lerAparelho(pessoa.endereco);
  const ap = local ? sementeDoAparelho(local) : null;
  const cert = local && ap ? conferirAparelho(local.certificado, { pessoa: pessoa.endereco }) : null;
  if (!cert?.ok || cert.aparelho !== ap?.endereco) local = null; // estragado ou de outro par: começa de novo
  if (local && ap && (estado.aparelho !== ap.endereco || novaGuarda)) {
    const g = novaGuarda ? guardarSemente(semente, ap.endereco) : null;
    const r = await pedir<{ chaves: unknown }>('POST', 'chaves/aparelhos', {
      certificado: local.certificado,
      ...(g ? { guarda: b64(g.guarda) } : {}),
      prova: provarSessao(ap, estado.desafio),
    });
    if (g) apagar(g.guarda);
    if (r.ok) {
      estado = lerEstado(r.chaves) ?? estado;
      if (g) local = { ...local, guardado: g.guardado };
    } else if (r.erro === 'revogado' || r.erro === 'outra_pessoa') {
      apagarAparelho(pessoa.endereco); // revogado: as chaves daqui não servem mais; o aparelho entra como novo
      local = null;
    } else return r;
  }
  if (!local) {
    const novo = novoAparelho();
    const certificado = apresentarAparelho(pessoa, novo.identidade.publicas, nomePadraoDoAparelho());
    const { guarda, guardado } = guardarSemente(semente, novo.identidade.endereco);
    const r = await pedir<{ chaves: unknown }>('POST', 'chaves/aparelhos', { certificado, guarda: b64(guarda), prova: provarSessao(novo.identidade, estado.desafio) });
    apagar(guarda);
    if (!r.ok) {
      apagar(novo.semente);
      return r;
    }
    estado = lerEstado(r.chaves) ?? estado;
    local = { v: 1, semente: b64(novo.semente), certificado, guardado, caixas: {} };
    apagar(novo.semente);
  }
  local = comGeracoes(local, semente, Math.max(1, estado.geracao));
  gravarAparelho(pessoa.endereco, local);
  mudar(estado);
  await lerCaixaDeEntrada();
  return { ok: true, chaves: estado };
}

/**
 * Lê as caixas que esperam por este aparelho e guarda as gerações novas da chave de caixa (quem revogou um aparelho
 * as mandou). As outras caixas (as chaves de documento, X4) ficam para quem as usa. Nada quebra sem rede.
 */
export async function lerCaixaDeEntrada(): Promise<void> {
  const pessoa = estadoAtual?.pessoa?.endereco;
  const local = pessoa ? lerAparelho(pessoa) : null;
  const ap = local ? sementeDoAparelho(local) : null;
  if (!pessoa || !local || !ap || estadoAtual?.aparelho !== ap.endereco) return;
  const r = await pedir<{ caixas: { id: number; contexto: string; caixa: string }[]; declaracoes?: Record<string, unknown> }>('GET', `chaves/caixa?para=${ap.endereco}`);
  if (!r.ok || !Array.isArray(r.caixas)) return;
  const caixas: Record<string, string> = { ...local.caixas };
  const lidas: number[] = [];
  for (const x of r.caixas) {
    const m = /^caixa-da-pessoa:([1-9][0-9]{0,6})$/.exec(String(x?.contexto ?? ''));
    if (!m) continue;
    const g = m[1]!;
    // M9: uma geração que este aparelho já tem não é trocada (a que ele tem veio da semente ou de uma caixa conferida)
    if (caixas[g]) {
      if (Number.isSafeInteger(x.id)) lidas.push(x.id);
      continue;
    }
    const bytes = typeof x.caixa === 'string' ? doBase64url(x.caixa) : null;
    const segredo = bytes ? abrirCaixa(ap, x.contexto, bytes) : null;
    if (!segredo) continue;
    // M9: o segredo tem de ser o da declaração daquela geração, assinada pela pessoa da conta
    const d = conferirDeclaracaoDeCaixa(r.declaracoes?.[g]);
    const publica = publicaDaGeracao(segredo);
    if (d && d.pessoa === pessoa && String(d.geracao) === g && publica && iguais(publica, d.cifrar)) {
      caixas[g] = b64(segredo);
      if (Number.isSafeInteger(x.id)) lidas.push(x.id);
    }
    apagar(segredo);
  }
  if (lidas.length === 0) return;
  gravarAparelho(pessoa, { ...local, caixas });
  await pedir('POST', 'chaves/caixa/apagar', { ids: lidas });
}

/** O cofre abriu: confere a pessoa, liga o aparelho e apaga a semente. */
async function comSementeAberta<T>(e: EstadoDasChaves, semente: Uint8Array | null, depois: (s: Uint8Array) => Promise<T>): Promise<T | { ok: false; erro: string }> {
  if (!semente) return falha('cofre');
  try {
    if (!e.pessoa || identidadeDaSemente(semente).endereco !== e.pessoa.endereco) return falha('cofre');
    return await depois(semente);
  } finally {
    apagar(semente);
  }
}

/** Depois de entrar com a senha (as chaves dela na mão): abre o cofre e prepara este aparelho, ou fica trancado. */
async function depoisDeEntrar(e: EstadoDasChaves, senha: ChavesDaSenha): Promise<Situacao> {
  mudar(e);
  if (e.antiga || !e.pessoa) return { tipo: 'antiga' };
  if (e.trancado) {
    if (!parametrosValidos(e.kdf)) return { tipo: 'trancado', temCopia: false };
    esquecerPendente();
    pendente = { kdf: e.kdf, entrar: senha.entrar.slice(), cofre: senha.cofre.slice(), pessoa: e.pessoa.endereco };
    return { tipo: 'trancado', temCopia: await ligarCopia(e) };
  }
  const r = await comSementeAberta(e, abrirCofre(e.cofre, senha.cofre), (s) => ligarAparelho(s, e));
  return r.ok ? { tipo: 'aberto', kitConferido: e.kit_conferido } : { tipo: 'aberto', kitConferido: e.kit_conferido, aviso: r.erro };
}

/**
 * Cofre trancado: se este aparelho tem a cópia da pessoa, liga a sessão a ele (com a prova), para a ponte poder
 * entregar a guarda. `true` = a cópia está aqui e a sessão ficou ligada.
 */
async function ligarCopia(e: EstadoDasChaves): Promise<boolean> {
  const local = e.pessoa ? lerAparelho(e.pessoa.endereco) : null;
  const ap = local ? sementeDoAparelho(local) : null;
  if (!local || !ap || !e.pessoa) return false;
  if (e.aparelho === ap.endereco) return true;
  const r = await pedir<{ chaves: unknown }>('POST', 'chaves/aparelhos', { certificado: local.certificado, prova: provarSessao(ap, e.desafio) });
  if (!r.ok) {
    if (r.erro === 'revogado' || r.erro === 'outra_pessoa') apagarAparelho(e.pessoa.endereco);
    return false;
  }
  mudar(lerEstado(r.chaves) ?? e);
  return true;
}

// ---------- entrar, criar conta, redefinir ----------

type ComConta = Resposta<{ conta: Conta; situacao: Situacao }>;

/**
 * Entra com e-mail e senha. A ponte diz os parâmetros da conta (`conta/parametros`); a conta de antes ("antigo")
 * manda a senha uma última vez, junto do pacote que a troca para as chaves; as outras mandam só a chave de entrar.
 * Um servidor sem as rotas novas entra do jeito de antes, só se este e-mail nunca entrou aqui com chaves.
 */
export async function entrar(email: string, senha: string, o: Opcoes = {}): Promise<ComConta> {
  const e = email.trim().toLowerCase();
  if (!e || !senha) return falha('vazio');
  const p = await pedir<{ kdf: unknown; antigo: unknown }>('POST', 'conta/parametros', { email: e });
  if (!p.ok) {
    if (p.erro !== 'rota') return p;
    if (contaComChavesLembrada(hashDoEmail(e))) return falha('rebaixado');
    const r = await pedir<{ conta: Conta }>('POST', 'conta/entrar', { email: e, senha });
    if (!r.ok) return r;
    mudarConta(r.conta);
    return { ok: true, conta: r.conta, situacao: { tipo: 'antiga' } };
  }
  if (p.antigo === true) {
    if (contaComChavesLembrada(hashDoEmail(e))) return falha('rebaixado');
    const desafio = await desafioDaSessao();
    if (!desafio) return falha('servidor');
    const kdf = novosParametros();
    const k = await derivar(senha, kdf, o.aoProgredir);
    const nova = novaPessoa(idiomaDoKit(o.idioma ?? 'pt-BR'));
    const pac = fazerPacote(nova.kit.semente, k, kdf, desafio);
    apagar(k.entrar, k.cofre);
    const r = await pedir<{ conta: Conta; chaves: unknown }>('POST', 'conta/entrar', { email: e, senha, chaves: pac.chaves });
    const kit = kitDe(nova.kit.semente, nova.kit.idioma);
    apagar(nova.kit.semente);
    if (!r.ok && r.erro === 'sem_sodium') {
      // o servidor ainda não confere chaves (o sodium do PHP desligado): entra do jeito de antes, como num servidor de
      // antes (este e-mail nunca entrou com chaves aqui: conferido acima); a conta troca quando ele puder
      const v = await pedir<{ conta: Conta }>('POST', 'conta/entrar', { email: e, senha });
      if (!v.ok) return v;
      mudarConta(v.conta);
      return { ok: true, conta: v.conta, situacao: { tipo: 'antiga' } };
    }
    if (!r.ok) return r;
    gravarAparelho(pac.pessoa, pac.local);
    lembrarContaComChaves(hashDoEmail(e));
    mudar(lerEstado(r.chaves));
    mudarConta(r.conta);
    await lerCaixaDeEntrada();
    return { ok: true, conta: r.conta, situacao: { tipo: 'aberto', kitConferido: false, kit } };
  }
  if (!parametrosValidos(p.kdf)) return falha('kdf');
  let k: ChavesDaSenha;
  try {
    k = await derivar(senha, p.kdf, o.aoProgredir);
  } catch {
    return falha('kdf');
  }
  try {
    const r = await pedir<{ conta: Conta; chaves: unknown }>('POST', 'conta/entrar', { email: e, entrar: b64(k.entrar) });
    if (!r.ok) return r;
    const est = lerEstado(r.chaves);
    lembrarContaComChaves(hashDoEmail(e));
    mudarConta(r.conta);
    const situacao: Situacao = est ? await depoisDeEntrar(est, k) : { tipo: 'antiga' };
    return { ok: true, conta: r.conta, situacao };
  } finally {
    apagar(k.entrar, k.cofre);
  }
}

/** Cria a conta: a pessoa nasce aqui (o kit volta para a tela mostrar). A senha não vai; vai o pacote. */
export async function criarConta(d: { nome: string; email: string; senha: string; idioma: string; site?: string }, o: Opcoes = {}): Promise<ComConta> {
  const email = d.email.trim().toLowerCase();
  if (!d.nome.trim() || !email || !d.senha) return falha('vazio');
  if (d.senha.length < 8) return falha('senha_curta');
  const desafio = await desafioDaSessao();
  if (!desafio) return falha('servidor');
  const kdf = novosParametros();
  const k = await derivar(d.senha, kdf, o.aoProgredir);
  const nova = novaPessoa(idiomaDoKit(o.idioma ?? d.idioma));
  const pac = fazerPacote(nova.kit.semente, k, kdf, desafio);
  apagar(k.entrar, k.cofre);
  const kit = kitDe(nova.kit.semente, nova.kit.idioma);
  apagar(nova.kit.semente);
  const r = await pedir<{ conta: Conta; chaves: unknown }>('POST', 'conta/criar', { nome: d.nome.trim(), email, idioma: d.idioma, site: d.site ?? '', chaves: pac.chaves });
  if (!r.ok) return r;
  gravarAparelho(pac.pessoa, pac.local);
  lembrarContaComChaves(hashDoEmail(email));
  mudar(lerEstado(r.chaves));
  mudarConta(r.conta);
  return { ok: true, conta: r.conta, situacao: { tipo: 'aberto', kitConferido: false, kit } };
}

/**
 * O primeiro acesso de um site recém-instalado (o Vernákula: a conta de administração e a escola, com o código de
 * instalação). Como criar conta: a pessoa nasce aqui e a senha não vai, vai o pacote.
 */
export async function primeiroAcesso(
  d: { codigo: string; organizacao: string; nome: string; email: string; senha: string; idioma: string },
  o: Opcoes = {},
): Promise<ComConta> {
  const email = d.email.trim().toLowerCase();
  if (!d.codigo || !d.organizacao.trim() || !d.nome.trim() || !email || !d.senha) return falha('vazio');
  if (d.senha.length < 8) return falha('senha_curta');
  const desafio = await desafioDaSessao();
  if (!desafio) return falha('servidor');
  const kdf = novosParametros();
  const k = await derivar(d.senha, kdf, o.aoProgredir);
  const nova = novaPessoa(idiomaDoKit(o.idioma ?? d.idioma));
  const pac = fazerPacote(nova.kit.semente, k, kdf, desafio);
  apagar(k.entrar, k.cofre);
  const kit = kitDe(nova.kit.semente, nova.kit.idioma);
  apagar(nova.kit.semente);
  const r = await pedir<{ conta: Conta; chaves: unknown }>('POST', 'conta/primeira', {
    codigo: d.codigo,
    organizacao: d.organizacao.trim(),
    nome: d.nome.trim(),
    email,
    chaves: pac.chaves,
  });
  if (!r.ok) return r;
  gravarAparelho(pac.pessoa, pac.local);
  lembrarContaComChaves(hashDoEmail(email));
  mudar(lerEstado(r.chaves));
  mudarConta(r.conta);
  return { ok: true, conta: r.conta, situacao: { tipo: 'aberto', kitConferido: false, kit } };
}

/**
 * A senha nova pelo link do e-mail. Manda sempre o pacote feito com ela: a conta de antes o usa (a pessoa nasce, e o
 * kit volta); a conta que já tinha chaves fica com o cofre TRANCADO (abre com o kit, a cópia deste aparelho ou outro
 * aparelho seu).
 */
export async function redefinir(codigo: string, nova: string, o: Opcoes = {}): Promise<ComConta> {
  if (!nova) return falha('vazio');
  if (nova.length < 8) return falha('senha_curta');
  const desafio = await desafioDaSessao();
  if (!desafio) return falha('servidor');
  const kdf = novosParametros();
  const k = await derivar(nova, kdf, o.aoProgredir);
  const pessoa = novaPessoa(idiomaDoKit(o.idioma ?? 'pt-BR'));
  const pac = fazerPacote(pessoa.kit.semente, k, kdf, desafio);
  const kit = kitDe(pessoa.kit.semente, pessoa.kit.idioma);
  apagar(pessoa.kit.semente);
  try {
    const r = await pedir<{ conta: Conta; chaves: unknown }>('POST', 'conta/redefinir', { codigo, entrar: b64(k.entrar), kdf, chaves: pac.chaves });
    if (!r.ok) return r;
    const est = lerEstado(r.chaves);
    lembrarContaComChaves(hashDoEmail(r.conta.email));
    mudarConta(r.conta);
    if (est && !est.antiga && !est.trancado && est.pessoa?.endereco === pac.pessoa) {
      gravarAparelho(pac.pessoa, pac.local);
      mudar(est);
      await lerCaixaDeEntrada();
      return { ok: true, conta: r.conta, situacao: { tipo: 'aberto', kitConferido: false, kit } };
    }
    return { ok: true, conta: r.conta, situacao: est ? await depoisDeEntrar(est, k) : { tipo: 'antiga' } };
  } finally {
    apagar(k.entrar, k.cofre);
  }
}

// ---------- o cofre trancado ----------

/** Trancado e sem as chaves da senha na memória (a página recarregou): as ações abaixo pedem a senha de novo. */
export function precisaDaSenha(): boolean {
  return pendente === null;
}

/** Este aparelho guarda a cópia cifrada da pessoa da conta (o `abrirComCopia` e o `aprovarPedido` precisam dela). */
export function temCopiaDesteAparelho(): boolean {
  const p = estadoAtual?.pessoa?.endereco;
  const local = p ? lerAparelho(p) : null;
  return local !== null && sementeDoAparelho(local) !== null;
}

/** O código de erro do kit lido (`kit_quantidade`, `kit_palavra` com as posições, `kit_conferencia`). */
const erroDoKit = (erro: string) => (erro === 'quantidade' ? 'kit_quantidade' : erro === 'palavra-desconhecida' ? 'kit_palavra' : 'kit_conferencia');

async function garantirPendente(senha: string | undefined, o: Opcoes): Promise<Resposta<{ estado: EstadoDasChaves }>> {
  const v = await verChaves();
  if (!v.ok) return v;
  const e = v.chaves;
  if (!e.pessoa || e.antiga) return falha('antiga');
  if (!e.trancado) return falha('nao_trancado');
  if (pendente && pendente.pessoa === e.pessoa.endereco) return { ok: true, estado: e };
  if (!senha) return falha('senha_atual');
  if (!parametrosValidos(e.kdf)) return falha('kdf');
  const k = await derivar(senha, e.kdf, o.aoProgredir);
  pendente = { kdf: e.kdf, entrar: k.entrar, cofre: k.cofre, pessoa: e.pessoa.endereco };
  return { ok: true, estado: e };
}

/** Refaz o cofre com a senha de agora (a semente veio do kit, da cópia ou de outro aparelho) e destranca. */
async function refazerCofre(semente: Uint8Array, e: EstadoDasChaves, novaGuarda: boolean): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  if (!pendente) return falha('senha_atual');
  const pessoa = identidadeDaSemente(semente);
  const cofre = fecharCofre(semente, pendente.cofre, pendente.kdf);
  const r = await pedir<{ chaves: unknown }>('POST', 'chaves/cofre', { cofre, assinatura: assinarCofre(pessoa, cofre) });
  if (!r.ok) return r;
  const est = lerEstado(r.chaves) ?? { ...e, trancado: false };
  mudar(est);
  return ligarAparelho(semente, est, novaGuarda);
}

/** Abre o cofre trancado com as 12 palavras. `senha` só quando `precisaDaSenha()`. */
export async function abrirComKit(palavras: string | readonly string[], senha?: string, o: Opcoes = {}): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  const k = pessoaDoKit(palavras);
  if (!k.ok) return falha(erroDoKit(k.erro), k.posicoes ? { posicoes: k.posicoes } : {});
  try {
    const p = await garantirPendente(senha, o);
    if (!p.ok) return p;
    if (k.identidade.endereco !== p.estado.pessoa?.endereco) return falha('kit_outra_pessoa');
    return await refazerCofre(k.semente, p.estado, false);
  } finally {
    apagar(k.semente);
  }
}

/** Abre o cofre trancado com a cópia deste aparelho (a ponte entrega a guarda e avisa por e-mail). */
export async function abrirComCopia(senha?: string, o: Opcoes = {}): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  const p = await garantirPendente(senha, o);
  if (!p.ok) return p;
  const e = p.estado;
  const local = e.pessoa ? lerAparelho(e.pessoa.endereco) : null;
  const ap = local ? sementeDoAparelho(local) : null;
  if (!local || !ap || !(await ligarCopia(e))) return falha('sem_copia');
  const g = await pedir<{ guarda: string }>('POST', 'chaves/guarda', {});
  if (!g.ok) return g;
  const guarda = doBase64url(g.guarda);
  const semente = guarda ? abrirGuardado(local.guardado, guarda, ap.endereco) : null;
  if (guarda) apagar(guarda);
  return comSementeAberta(e, semente, (s) => refazerCofre(s, estadoAtual ?? e, true));
}

export interface PedidoAoOutroAparelho {
  /** Os 6 algarismos ("123 456") que o outro aparelho também mostra. */
  readonly codigo: string;
  /** Espera o outro aparelho aprovar (até 15 min); destranca e liga este aparelho. */
  esperar(): Promise<Resposta<{ chaves: EstadoDasChaves }>>;
  /** Desiste de esperar. */
  cancelar(): void;
}

/**
 * "Confirme no outro aparelho": este aparelho (novo) pede a um aparelho seu já aberto que lhe entregue a semente.
 * Mostra o código; no outro aparelho, a pessoa digita esse código e aprova (`aprovarPedido`, M8).
 */
export async function pedirAoOutroAparelho(senha?: string, o: Opcoes & { intervalo?: number } = {}): Promise<Resposta<{ pedido: PedidoAoOutroAparelho }>> {
  const p = await garantirPendente(senha, o);
  if (!p.ok) return p;
  const novo = novoAparelho();
  const r = await pedir<{ pedido: { id: number } }>('POST', 'chaves/pedidos', { publicas: publicasParaJson(novo.identidade.publicas), nome: nomePadraoDoAparelho() });
  if (!r.ok) {
    apagar(novo.semente);
    return r;
  }
  let parar = false;
  const intervalo = o.intervalo ?? 3000;
  const ate = Date.now() + 15 * 60_000;
  const esperar = async (): Promise<Resposta<{ chaves: EstadoDasChaves }>> => {
    try {
      while (!parar && Date.now() < ate) {
        const c = await pedir<{ caixas: { contexto: string; caixa: string }[] }>('GET', `chaves/caixa?para=${novo.identidade.endereco}`);
        const x = c.ok && Array.isArray(c.caixas) ? c.caixas.find((y) => y?.contexto === 'semente-da-pessoa') : undefined;
        const bytes = x && typeof x.caixa === 'string' ? doBase64url(x.caixa) : null;
        if (bytes) {
          const semente = receberSemente(novo.identidade, bytes);
          const e = estadoAtual ?? p.estado;
          // a semente nova chegou: este aparelho se apresenta com o par do pedido
          if (semente && e.pessoa && identidadeDaSemente(semente).endereco === e.pessoa.endereco) {
            const cert = apresentarAparelho(identidadeDaSemente(semente), novo.identidade.publicas, nomePadraoDoAparelho());
            gravarAparelho(e.pessoa.endereco, { v: 1, semente: b64(novo.semente), certificado: cert, guardado: guardarSemente(semente, novo.identidade.endereco).guardado, caixas: {} });
            // o guardado acima é provisório: o `ligarAparelho` troca a guarda (vai à ponte junto do certificado)
          }
          return await comSementeAberta(e, semente, (s) => refazerCofre(s, e, true));
        }
        if (!c.ok && c.erro !== 'rede') return c;
        await new Promise((ok) => setTimeout(ok, intervalo));
      }
      return falha(parar ? 'cancelado' : 'pedido_vencido');
    } finally {
      apagar(novo.semente);
    }
  };
  return {
    ok: true,
    pedido: {
      codigo: codigoDoAparelho(novo.identidade.publicas),
      esperar,
      cancelar: () => {
        parar = true;
      },
    },
  };
}

/**
 * Sem kit e sem outro aparelho: a conta recomeça com uma pessoa nova. O que estava cifrado para a pessoa de antes não
 * abre mais, e os aparelhos de antes saem (a tela avisa antes). O kit novo volta para a tela mostrar.
 */
export async function comecarPessoaNova(senha?: string, o: Opcoes = {}): Promise<Resposta<{ chaves: EstadoDasChaves; kit: KitParaMostrar }>> {
  const p = await garantirPendente(senha, o);
  if (!p.ok) return p;
  if (!pendente) return falha('senha_atual');
  const antes = p.estado.pessoa?.endereco ?? '';
  const nova = novaPessoa(idiomaDoKit(o.idioma ?? 'pt-BR'));
  const pac = fazerPacote(nova.kit.semente, { entrar: pendente.entrar, cofre: pendente.cofre }, pendente.kdf, p.estado.desafio);
  const kit = kitDe(nova.kit.semente, nova.kit.idioma);
  apagar(nova.kit.semente);
  const r = await pedir<{ chaves: unknown }>('POST', 'chaves/pessoa', { entrar: pac.chaves.entrar, chaves: pac.chaves });
  if (!r.ok) return r;
  apagarAparelho(antes);
  gravarAparelho(pac.pessoa, pac.local);
  const est = lerEstado(r.chaves);
  if (!est) return falha('servidor');
  mudar(est);
  return { ok: true, chaves: est, kit };
}

// ---------- com a conta aberta: a prova da senha, trocar a senha, o kit ----------

/** Abre o cofre com a senha (o estado vem da ponte agora). Devolve a semente: quem chama a apaga. */
async function abrirComSenhaAtual(senha: string, o: Opcoes): Promise<Resposta<{ estado: EstadoDasChaves; senha: ChavesDaSenha; semente: Uint8Array | null }>> {
  const v = await verChaves();
  if (!v.ok) return v;
  const e = v.chaves;
  if (e.antiga || !e.pessoa) return falha('antiga');
  if (!parametrosValidos(e.kdf)) return falha('kdf');
  const k = await derivar(senha, e.kdf, o.aoProgredir);
  const semente = e.trancado ? null : abrirCofre(e.cofre, k.cofre);
  if (!e.trancado && (!semente || identidadeDaSemente(semente).endereco !== e.pessoa.endereco)) {
    if (semente) apagar(semente);
    apagar(k.entrar, k.cofre);
    return falha('senha_atual'); // a senha errada não abre o cofre
  }
  return { ok: true, estado: e, senha: k, semente };
}

/**
 * Os campos que provam a senha de agora para a ponte (excluir a conta, trocar o e-mail): `entrar_atual` numa conta
 * com chaves, `senha_atual` (em claro) só na conta de antes e só se este e-mail nunca entrou aqui com chaves.
 */
export async function provaDaSenha(senha: string, o: Opcoes = {}): Promise<Resposta<{ campos: { entrar_atual: string } | { senha_atual: string } }>> {
  if (!senha) return falha('senha_atual');
  const v = await verChaves();
  if ((!v.ok && v.erro === 'rota') || (v.ok && v.chaves.antiga)) return contaAtualTemChaves() ? falha('rebaixado') : { ok: true, campos: { senha_atual: senha } };
  if (!v.ok) return v;
  if (!parametrosValidos(v.chaves.kdf)) return falha('kdf');
  const k = await derivar(senha, v.chaves.kdf, o.aoProgredir);
  const campos = { entrar_atual: b64(k.entrar) };
  apagar(k.entrar, k.cofre);
  return { ok: true, campos };
}

/**
 * Troca a senha: o cofre é refeito com a nova (assinado pela pessoa). Na conta de antes, a troca também cria as
 * chaves (a pessoa nasce: o kit volta). Com o cofre trancado, só os parâmetros mudam.
 */
export async function trocarSenha(atual: string, nova: string, o: Opcoes = {}): Promise<Resposta<{ chaves: EstadoDasChaves; kit?: KitParaMostrar }>> {
  if (!atual) return falha('senha_atual');
  if (!nova) return falha('vazio');
  if (nova.length < 8) return falha('senha_curta');
  const v = await verChaves();
  if (!v.ok) return v;
  const kdf = novosParametros();
  if (v.chaves.antiga) {
    if (contaAtualTemChaves()) return falha('rebaixado');
    const k = await derivar(nova, kdf, o.aoProgredir);
    const pessoa = novaPessoa(idiomaDoKit(o.idioma ?? 'pt-BR'));
    const pac = fazerPacote(pessoa.kit.semente, k, kdf, v.chaves.desafio);
    apagar(k.entrar, k.cofre);
    const kit = kitDe(pessoa.kit.semente, pessoa.kit.idioma);
    apagar(pessoa.kit.semente);
    const r = await pedir<{ chaves: unknown }>('POST', 'conta/senha', { senha_atual: atual, chaves: pac.chaves });
    if (!r.ok) return r;
    gravarAparelho(pac.pessoa, pac.local);
    const est = lerEstado(r.chaves);
    if (!est) return falha('servidor');
    mudar(est);
    return { ok: true, chaves: est, kit };
  }
  const a = await abrirComSenhaAtual(atual, o);
  if (!a.ok) return a;
  const k = await derivar(nova, kdf, o.aoProgredir);
  try {
    const base = { entrar_atual: b64(a.senha.entrar), entrar: b64(k.entrar) };
    let corpo: object;
    if (a.semente) {
      const cofre = fecharCofre(a.semente, k.cofre, kdf);
      corpo = { ...base, cofre, assinatura: assinarCofre(identidadeDaSemente(a.semente), cofre) };
    } else corpo = { ...base, kdf };
    const r = await pedir<{ chaves: unknown }>('POST', 'conta/senha', corpo);
    if (!r.ok) return r;
    const est = lerEstado(r.chaves);
    if (!est) return falha('servidor');
    if (est.trancado && est.pessoa && parametrosValidos(est.kdf)) {
      esquecerPendente();
      pendente = { kdf: est.kdf, entrar: k.entrar.slice(), cofre: k.cofre.slice(), pessoa: est.pessoa.endereco };
    }
    mudar(est);
    return { ok: true, chaves: est };
  } finally {
    if (a.semente) apagar(a.semente);
    apagar(a.senha.entrar, a.senha.cofre, k.entrar, k.cofre);
  }
}

/** "Ver o meu kit": as 12 palavras de novo, com a senha (o cofre abre, a semente some logo). */
export async function verKit(senha: string, o: Opcoes = {}): Promise<Resposta<{ kit: KitParaMostrar }>> {
  const a = await abrirComSenhaAtual(senha, o);
  if (!a.ok) return a;
  apagar(a.senha.entrar, a.senha.cofre);
  if (!a.semente) return falha('trancado');
  try {
    return { ok: true, kit: kitDe(a.semente, idiomaDoKit(o.idioma ?? 'pt-BR')) };
  } finally {
    apagar(a.semente);
  }
}

/** Confere as palavras que a pessoa escreveu nas posições pedidas (0 a 11). */
export function conferirPalavras(kit: KitParaMostrar, posicoes: readonly number[], respostas: readonly string[]): boolean {
  return posicoes.length > 0 && posicoes.every((p, i) => {
    const certa = kit.palavras[p];
    const dada = separarPalavras(respostas[i] ?? '');
    const c = certa === undefined ? '' : (separarPalavras(certa)[0] ?? '');
    const d = dada.length === 1 ? dada[0]! : '';
    return c !== '' && (d === c || (d.length >= 4 && c.startsWith(d)));
  });
}

/** Três posições diferentes, sorteadas, para conferir o kit. */
export function posicoesParaConferir(): number[] {
  const todas = Array.from({ length: 12 }, (_, i) => i);
  const r = new Uint32Array(12);
  crypto.getRandomValues(r);
  for (let i = 11; i > 0; i--) {
    const j = r[i]! % (i + 1);
    [todas[i], todas[j]] = [todas[j]!, todas[i]!];
  }
  return todas.slice(0, 3).sort((a, b) => a - b);
}

/** A pessoa conferiu o kit (as 3 palavras): o lembrete some. */
export async function marcarKitConferido(): Promise<Resposta> {
  const r = await pedir('POST', 'chaves/kit', {});
  if (r.ok && estadoAtual) mudar({ ...estadoAtual, kit_conferido: true });
  return r;
}

// ---------- "Seus aparelhos" ----------

export interface Aparelho {
  readonly endereco: string;
  readonly nome: string;
  readonly criado: number;
  readonly vistoEm: string | null;
  readonly revogado: boolean;
  /** É este aparelho (o da sessão). */
  readonly este: boolean;
  /** O certificado confere (assinado pela pessoa da conta). Um aparelho que não confere não recebe nada. */
  readonly confere: boolean;
  readonly publicas: ChavesPublicas | null;
}

export async function listarAparelhos(): Promise<Resposta<{ aparelhos: Aparelho[] }>> {
  const v = estadoAtual?.pessoa ? { ok: true as const, chaves: estadoAtual } : await verChaves();
  if (!v.ok) return v;
  const pessoa = v.chaves.pessoa?.endereco;
  const r = await pedir<{ aparelhos: Record<string, unknown>[] }>('GET', 'chaves/aparelhos');
  if (!r.ok) return r;
  const aparelhos = (Array.isArray(r.aparelhos) ? r.aparelhos : []).map((a): Aparelho => {
    const c = pessoa ? conferirAparelho(a['certificado'], { pessoa }) : null;
    const confere = c?.ok === true && c.aparelho === a['endereco'];
    return {
      endereco: String(a['endereco'] ?? ''),
      nome: String(a['nome'] ?? ''),
      criado: Number(a['criado'] ?? 0),
      vistoEm: typeof a['visto_em'] === 'string' ? a['visto_em'] : null,
      revogado: a['revogacao'] !== null && a['revogacao'] !== undefined,
      este: a['este'] === true,
      confere,
      publicas: confere && c?.ok ? c.publicas : null,
    };
  });
  return { ok: true, aparelhos };
}

/**
 * Revoga um aparelho (com a senha, que abre o cofre): nasce a geração seguinte da chave de caixa, entregue só aos
 * aparelhos que ficam e cujo certificado confere; o revogado sai da conta.
 */
export async function revogar(endereco: string, senha: string, o: Opcoes = {}): Promise<Resposta<{ chaves: EstadoDasChaves }>> {
  const a = await abrirComSenhaAtual(senha, o);
  if (!a.ok) return a;
  apagar(a.senha.entrar, a.senha.cofre);
  if (!a.semente) return falha('trancado');
  const semente = a.semente;
  try {
    const l = await listarAparelhos();
    if (!l.ok) return l;
    const g = a.estado.geracao + 1;
    const nova = chaveDeCaixa(semente, g);
    const pessoa = identidadeDaSemente(semente);
    const entregas = l.aparelhos
      .filter((x) => !x.revogado && x.endereco !== endereco && x.confere && x.publicas)
      .map((x) => ({ para: x.endereco, caixa: b64(fecharCaixa(x.publicas!.cifrar, contextoDeGeracao(g), nova.segredo)) }));
    const r = await pedir<{ chaves: unknown }>('POST', 'chaves/aparelhos/revogar', { revogacao: revogarAparelho(pessoa, endereco), caixa: declararCaixa(semente, g), entregas });
    apagar(nova.segredo);
    if (!r.ok) return r;
    const est = lerEstado(r.chaves) ?? a.estado;
    mudar(est);
    const local = lerAparelho(pessoa.endereco);
    if (local) gravarAparelho(pessoa.endereco, comGeracoes(local, semente, est.geracao));
    await lerCaixaDeEntrada();
    return { ok: true, chaves: est };
  } finally {
    apagar(semente);
  }
}

export interface PedidoAberto {
  readonly id: number;
  readonly aparelho: string;
  readonly nome: string;
  readonly criadoEm: string;
  /** O código que o aparelho novo mostra; a pessoa confere antes de aprovar. */
  readonly codigo: string;
  readonly publicas: ChavesPublicas;
}

/** Os pedidos de aparelhos novos esperando por este (o cofre está trancado e alguém pediu num aparelho novo). */
export async function listarPedidos(): Promise<Resposta<{ pedidos: PedidoAberto[] }>> {
  const r = await pedir<{ pedidos: Record<string, unknown>[] }>('GET', 'chaves/pedidos');
  if (!r.ok) return r;
  const pedidos: PedidoAberto[] = [];
  for (const p of Array.isArray(r.pedidos) ? r.pedidos : []) {
    const publicas = publicasDoJson(p['publicas']);
    if (!publicas || typeof p['id'] !== 'number') continue;
    pedidos.push({ id: p['id'], aparelho: String(p['aparelho'] ?? ''), nome: String(p['nome'] ?? ''), criadoEm: String(p['criado_em'] ?? ''), codigo: codigoDoAparelho(publicas), publicas });
  }
  return { ok: true, pedidos };
}

/** Os erros do código digitado, por pedido (3 erros recusam o pedido: M8). */
const errosDoCodigo = new Map<number, number>();
export const TENTATIVAS_DO_CODIGO = 3;

/**
 * Aprova o pedido: a pessoa DIGITA aqui os 6 algarismos que o aparelho novo mostra (M8: só quem está com o aparelho
 * novo na mão sabe o código; comparar e clicar não protegia de quem pediu com o e-mail da pessoa). Código certo: abre a
 * cópia deste aparelho (a ponte entrega a guarda e avisa por e-mail) e leva a semente ao novo. Três erros recusam o
 * pedido (`codigo_recusado`); antes disso, `codigo_errado` com `restam`.
 */
export async function aprovarPedido(p: PedidoAberto, digitado: string): Promise<Resposta<{ restam?: number }>> {
  const limpo = digitado.replace(/\D/g, '');
  const certo = p.codigo.replace(/\D/g, '');
  if (limpo.length !== certo.length || !iguais(utf8ToBytes(limpo), utf8ToBytes(certo))) {
    const erros = (errosDoCodigo.get(p.id) ?? 0) + 1;
    errosDoCodigo.set(p.id, erros);
    if (erros >= TENTATIVAS_DO_CODIGO) {
      errosDoCodigo.delete(p.id);
      await recusarPedido(p.id);
      return falha('codigo_recusado');
    }
    return { ok: false, erro: 'codigo_errado', restam: TENTATIVAS_DO_CODIGO - erros };
  }
  errosDoCodigo.delete(p.id);
  const e = estadoAtual?.pessoa ? estadoAtual : (await verChaves()).ok ? estadoAtual : null;
  const local = e?.pessoa ? lerAparelho(e.pessoa.endereco) : null;
  const ap = local ? sementeDoAparelho(local) : null;
  if (!e || !local || !ap) return falha('sem_copia');
  if (!(await ligarCopia(e))) return falha('sem_copia');
  const g = await pedir<{ guarda: string }>('POST', 'chaves/guarda', { pedido: p.id });
  if (!g.ok) return g;
  const guarda = doBase64url(g.guarda);
  const semente = guarda ? abrirGuardado(local.guardado, guarda, ap.endereco) : null;
  if (guarda) apagar(guarda);
  return comSementeAberta(estadoAtual ?? e, semente, async (s) => {
    const r = await pedir('POST', 'chaves/caixa', { para: p.aparelho, contexto: 'semente-da-pessoa', caixa: b64(levarSemente(s, p.publicas.cifrar)) });
    if (!r.ok) return r;
    // a guarda deste aparelho saiu da ponte: troca por outra
    await ligarAparelho(s, estadoAtual ?? e, true);
    return { ok: true };
  });
}

export const recusarPedido = (id: number) => pedir('POST', `chaves/pedidos/${id}/recusar`, {});

// ---------- o que o resto do app precisa saber ----------

/** As gerações da chave de caixa que este aparelho tem (para abrir as entregas, X4). */
export function geracoesDesteAparelho(): ReadonlyMap<number, Uint8Array> {
  const p = estadoAtual?.pessoa?.endereco;
  const local = p ? lerAparelho(p) : null;
  const m = new Map<number, Uint8Array>();
  for (const [g, s] of Object.entries(local?.caixas ?? {})) {
    const b = doBase64url(s);
    if (b && b.length === 32) m.set(Number(g), b);
  }
  return m;
}
