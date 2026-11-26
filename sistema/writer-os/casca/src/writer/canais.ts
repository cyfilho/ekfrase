// SPDX-License-Identifier: MPL-2.0

/**
 * Os CANAIS entre a página do Writer e o processo principal (o `main.ts`, pelo IPC do Electron; o mesmo no Writer
 * do computador e no Writer OS). Quem chama já conferiu que o pedido veio da página do app; aqui só se decide O QUE cada canal faz (o contrato é a `PonteCasca`).
 *
 * - `pedidos`: com resposta (o `ipcRenderer.invoke`);
 * - `sincronos`: o rascunho de emergência (a página pode estar fechando);
 * - `avisos`: sem resposta (`armazem:fechar`, `casca:pode-fechar`).
 */
import { baseDoServidor, conferirServidor, type EscolhaEspelho, type MetodoArmazem, type RespostaCasca } from '@ekfrase/writer-nucleo';
import { gravarLembrado, lerLembrado } from '../motor/pastas.ts';
import { origemDe } from '../motor/rede.ts';
import { FUSOS, TECLADOS, type Sistema } from '../motor/sistema.ts';
import type { DadosDoWriter } from './dados.ts';
import type { WriterOS } from './os.ts';

type Funcao = (...a: never[]) => unknown;

/** O que os canais `at:*` pedem: o `AtualizacoesOS` (Writer OS, U1) e o `Atualizador` (computador, U2) têm os dois. */
export interface MotorDeAtualizacoes {
  estado(): unknown;
  procurar(): Promise<unknown>;
  instalar(): Promise<unknown>;
  usarModo(m: 'automaticas' | 'perguntar'): unknown;
}

export interface Canais {
  pedidos: Record<string, Funcao>;
  sincronos: Record<string, Funcao>;
  avisos: Record<string, Funcao>;
}

/** O pedaço da rede que os canais usam (a `Rede` do Electron). */
export interface RedeDosCanais {
  readonly servidor: string;
  usar(base: string): void;
  conferir<T>(origem: string | null, conferir: (buscar: typeof fetch) => Promise<T>): Promise<T>;
}

export interface OpcoesCanais {
  dados: DadosDoWriter;
  rede: RedeDosCanais;
  /** A base padrão (`https://ekfrase.com/api/v1/`). */
  padrao: string;
  /** O arquivo do que o computador lembra (`casca.json`). */
  lembrado: string;
  writerOS: WriterOS | null;
  sistema: Sistema | null;
  /** As atualizações do app (docs/ATUALIZACOES.md): o Writer OS (U1, a cópia de reserva) ou o computador (U2). */
  atualizacoes?: MotorDeAtualizacoes | null;
  /** "Reiniciar agora" (só o computador): fecha, aplica a versão pronta e abre de novo. */
  reiniciarAtualizacao?: (() => Promise<void>) | null;
  /** "Escolher outra pasta…" (o seletor do Windows; no Writer OS não há: `null`). */
  escolherPasta: () => Promise<string | null>;
  /** Trocou de servidor: esquecer os cookies da conta e recarregar a página. */
  depoisDeTrocarServidor: () => Promise<void>;
  /** A página terminou de gravar o que faltava: pode fechar. */
  podeFechar: () => void;
}

/** Chama um canal com os argumentos que vieram da página (cada canal confere os seus). */
export const chamarCanal = (f: Funcao, a: unknown[]): unknown => (f as (...x: unknown[]) => unknown)(...a);

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

export function criarCanais(o: OpcoesCanais): Canais {
  const { dados, rede, writerOS } = o;
  const abriu = async (r: RespostaCasca): Promise<RespostaCasca> => {
    if (!r.ok || !writerOS) return r;
    await writerOS.aplicarEspelho();
    void writerOS.depoisDeAbrir();
    return { ok: true, estado: dados.estado() };
  };

  const pedidos: Record<string, Funcao> = {
    'casca:estado': () => dados.estado(),
    // no Writer OS não há seletor de pastas (§7): os pendrives vêm pela tela "onde guardar"
    'casca:escolher-pasta': () => (writerOS ? null : o.escolherPasta()),
    'casca:usar-pasta': (c: string): Promise<RespostaCasca> => (writerOS ? Promise.resolve({ ok: false, erro: 'pasta' }) : dados.usarPasta(String(c ?? ''))),
    'casca:criar-senha': async (s: string) => abriu(await dados.criarSenha(String(s ?? ''))),
    'casca:abrir': async (s: string) => abriu(await dados.abrir(String(s ?? ''))),
    'casca:trancar': async () => {
      await writerOS?.salvarPagina();
      return dados.trancar();
    },
    'casca:espelho': (r: EscolhaEspelho) => {
      writerOS?.lembrarEspelho(r);
      return dados.responderEspelho(r);
    },
    'armazem:abrir': (dono: string) => dados.abrirArmazem(String(dono ?? '')),
    'armazem:chamar': (alca: string, metodo: MetodoArmazem, args: unknown[]) => dados.chamar(String(alca), metodo, Array.isArray(args) ? args : []),
    'servidor:conferir': (endereco: string) => {
      const base = baseDoServidor(String(endereco ?? ''));
      return rede.conferir(base ? origemDe(base) : null, (buscar) => conferirServidor(String(endereco ?? ''), buscar));
    },
    'servidor:usar': async (base: string | null) => {
      const nova = base === null ? o.padrao : baseDoServidor(String(base));
      if (!nova) return;
      // trocar de servidor = outra conta: fecha os textos da conta, volta à tela de entrar
      rede.usar(nova);
      gravarLembrado(o.lembrado, { ...lerLembrado(o.lembrado), servidor: nova === o.padrao ? null : nova });
      await o.depoisDeTrocarServidor();
    },
  };

  // ---- o Writer OS: o primeiro uso e o painel do sistema (§6.3, §6.4)
  if (writerOS && o.sistema) {
    const s = o.sistema;
    Object.assign(pedidos, {
      'os:estado': () => writerOS.estado(),
      'os:idioma': (c: string) => writerOS.usarIdioma(texto(c)),
      'os:teclados': () => [...TECLADOS],
      'os:teclado': (id: string) => writerOS.usarTeclado(texto(id)),
      'os:fusos': () => [...FUSOS],
      'os:fuso': (id: string) => writerOS.usarFuso(texto(id)),
      'os:passar-wifi': () => writerOS.passarWifi(),
      'os:passar-uso': () => writerOS.passarUso(),
      'os:instalacao': () => writerOS.instalacao(),
      'os:instalar': (disco: string, levar: boolean, apagar?: string | null) => writerOS.instalar(texto(disco), levar === true, typeof apagar === 'string' ? apagar : undefined),
      'os:redes': () => s.redes(),
      'os:conectar': (ssid: string, senha: string | null) => writerOS.conectar(texto(ssid), senha === null ? null : texto(senha)),
      'os:esquecer': (ssid: string) => writerOS.esquecer(texto(ssid)),
      'os:cabo': () => s.cabo(),
      'os:conectar-cabo': () => s.conectarCabo(),
      'os:internet': () => writerOS.internet(),
      'os:abrir-portal': () => writerOS.abrirPortal(),
      'os:vpns': () => writerOS.vpns(),
      'os:importar-vpn': (arquivo: string, bytes: unknown) => writerOS.importarVpn(texto(arquivo), bytes),
      'os:adicionar-vpn-empresa': (nova: unknown) => writerOS.adicionarVpnEmpresa(nova),
      'os:ligar-vpn': (nome: string, usuario: unknown, senha: unknown, extra: unknown) => writerOS.ligarVpn(texto(nome), usuario, senha, extra),
      'os:desligar-vpn': (nome: string) => writerOS.desligarVpn(texto(nome)),
      'os:esquecer-vpn': (nome: string) => writerOS.esquecerVpn(texto(nome)),
      'os:vpn-sozinha': (nome: string, sim: unknown) => writerOS.vpnSozinha(texto(nome), sim === true),
      'os:feedback-guardar': (f: unknown) => writerOS.guardarFeedback(f),
      'os:feedback-guardados': () => writerOS.feedbacksGuardados(),
      'os:feedback-apagar': (id: string) => writerOS.apagarFeedback(texto(id)),
      'os:bateria': () => s.bateria(),
      'os:brilho': (passo?: number) => s.brilho(typeof passo === 'number' && Number.isFinite(passo) ? Math.max(-50, Math.min(50, passo)) : undefined),
      'os:discos': () => s.discos(),
      'os:guardar-em': (id: string) => writerOS.guardarEm(texto(id)),
      'os:guardar-na-memoria': () => writerOS.guardarNaMemoria(),
      'os:ejetar': (id: string) => s.ejetar(texto(id)),
      'os:abrir-disco': (id: string) => writerOS.abrirDisco(texto(id)),
      'os:listar': (caminho: string, tipo?: unknown) => writerOS.listar(texto(caminho), tipo),
      'os:ler-arquivo': (caminho: string) => writerOS.lerArquivo(texto(caminho)),
      'os:gravar-arquivo': (pasta: string, nome: string, bytes: unknown) => writerOS.gravarArquivo(texto(pasta), texto(nome), bytes),
      'os:desligar': () => writerOS.desligar(false),
      'os:reiniciar': () => writerOS.desligar(true),
      'os:sobre': () => writerOS.sobre(),
    } satisfies Record<string, Funcao>);
  }

  // ---- as atualizações (DEC-P072): o ajuste, "Procurar agora", "Instalar"
  const at = o.atualizacoes;
  if (at) {
    Object.assign(pedidos, {
      'at:estado': () => at.estado(),
      'at:procurar': () => at.procurar(),
      'at:instalar': () => at.instalar(),
      'at:modo': (m: string) => at.usarModo(m === 'perguntar' ? 'perguntar' : 'automaticas'),
    } satisfies Record<string, Funcao>);
    const reiniciar = o.reiniciarAtualizacao;
    if (reiniciar) pedidos['at:reiniciar'] = () => reiniciar();
  }

  return {
    pedidos,
    sincronos: {
      'rascunho:por': (chave: string, valor: string) => dados.porRascunho(chave, valor),
      'rascunho:tirar': (chave: string) => {
        dados.tirarRascunho(chave);
        return true;
      },
      'rascunho:todos': () => dados.rascunhos(),
    },
    avisos: {
      'armazem:fechar': (alca: string) => dados.fecharAlca(String(alca)),
      'casca:pode-fechar': () => o.podeFechar(),
    },
  };
}
