// SPDX-License-Identifier: MPL-2.0

import type { Conta } from '@ekfrase/interface';
import { ArmazemIndexedDB, ArmazemMemoria, DONO_LOCAL, Escrita, Sincronizador, TransporteHttp, adotar, type Armazem, type EstadoSinc } from '@ekfrase/writer-nucleo';
import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { avisarQueLevou, ligarAbas } from './abas.ts';
import { antesDeTrancar, armazemDaCasca, naCasca } from './computador/casca.ts';
import { recuperarRascunhos } from './rascunho.ts';

/**
 * A SESSÃO: o armazém de quem está escrevendo agora (o da conta, ou o `local` de quem escreve sem
 * conta), as operações (`Escrita`) e a sincronização. Um armazém = um dono: trocar de conta fecha
 * uma sessão e abre outra; os textos de contas diferentes nunca se misturam no aparelho.
 */
export interface Sessao {
  dono: string;
  conta: Conta | null;
  armazem: Armazem;
  escrita: Escrita;
  sinc: Sincronizador;
  /** O navegador não deixou gravar (IndexedDB bloqueado): os textos somem ao fechar a página. */
  soMemoria: boolean;
  /**
   * O que tem de terminar antes de o armazém fechar (a folha aberta grava o que falta). Quem
   * registra devolve uma promessa; `fecharSessao` espera todas.
   */
  antesDeFechar: Set<() => Promise<void>>;
  /** Gravações que já começaram (a folha saindo da tela) e que o armazém tem de esperar antes de fechar. */
  emCurso: Set<Promise<void>>;
  /** Guardar AGORA, de forma síncrona, o que não foi gravado (a página vai recarregar). */
  guardarJa: Set<() => void>;
  /** A sessão começou a fechar: nada novo deve começar no armazém. */
  fechando: boolean;
  /** Desliga o aviso entre abas. */
  pararAbas: () => void;
}

async function abrirArmazem(dono: string): Promise<{ armazem: Armazem; soMemoria: boolean }> {
  // no computador, o banco cifrado do processo principal (a página não toca nele)
  if (naCasca) return { armazem: await armazemDaCasca(dono), soMemoria: false };
  try {
    return { armazem: await ArmazemIndexedDB.abrir({ dono }), soMemoria: false };
  } catch {
    return { armazem: new ArmazemMemoria({ dono }), soMemoria: true };
  }
}

export async function abrirSessao(conta: Conta | null): Promise<Sessao> {
  const dono = conta ? String(conta.id) : DONO_LOCAL;
  const { armazem, soMemoria } = await abrirArmazem(dono);
  const sinc = new Sincronizador({ armazem, transporte: conta ? new TransporteHttp() : null });
  const s: Sessao = { dono, conta, armazem, escrita: new Escrita(armazem), sinc, soMemoria, antesDeFechar: new Set(), emCurso: new Set(), guardarJa: new Set(), fechando: false, pararAbas: () => undefined };
  // outra aba levou os textos escritos sem conta para uma conta: esta (sem conta) guarda o que falta e abre de novo, já na conta
  s.pararAbas = ligarAbas(dono, armazem, () => {
    for (const f of [...s.guardarJa]) f();
    location.reload();
  });
  // o que sobrou de uma aba fechada às pressas entra antes de qualquer tela abrir
  await recuperarRascunhos(s).catch(() => 0);
  // no computador: fechar a janela ou os textos espera a folha gravar o que falta
  if (naCasca) {
    const gravarAntes = async () => {
      for (const f of [...s.guardarJa]) f();
      await Promise.allSettled([...[...s.antesDeFechar].map((f) => f()), ...s.emCurso]);
    };
    antesDeTrancar.add(gravarAntes);
    const parar = s.pararAbas;
    s.pararAbas = () => {
      antesDeTrancar.delete(gravarAntes);
      parar();
    };
  }
  sinc.ligar();
  return s;
}

/**
 * Fecha a sessão (trocou de conta, saiu, a sessão do servidor acabou): primeiro a folha aberta grava
 * o que falta, depois o armazém fecha. Fechar antes perdia a última pausa da digitação.
 */
export async function fecharSessao(s: Sessao): Promise<void> {
  if (s.fechando) return;
  s.fechando = true;
  s.sinc.desligar();
  s.pararAbas();
  // (a folha some da tela ANTES deste fechar: a gravação dela já está em `emCurso`)
  await Promise.allSettled([...[...s.antesDeFechar].map((f) => f()), ...s.emCurso]);
  s.armazem.fechar();
}

/** O armazém de quem escreve sem conta (no computador, o banco cifrado da pasta). */
const abrirLocal = (): Promise<Armazem> => (naCasca ? armazemDaCasca(DONO_LOCAL) : ArmazemIndexedDB.abrir({ dono: DONO_LOCAL }));

/** Quantas histórias e ideias estão guardadas só neste aparelho (escritas sem conta). */
export async function textosLocais(): Promise<{ historias: number; ideias: number }> {
  try {
    const local = await abrirLocal();
    try {
      return { historias: (await local.listar('historias')).length, ideias: (await local.listar('ideias')).length };
    } finally {
      local.fechar();
    }
  } catch {
    return { historias: 0, ideias: 0 };
  }
}

/** Leva tudo o que foi escrito sem conta para a conta (e tira do armazém local o que levou). Sobe na sincronização. */
export async function levarLocais(s: Sessao): Promise<void> {
  if (!s.conta) return;
  const local = await abrirLocal();
  try {
    await adotar(local, s.armazem);
  } finally {
    local.fechar();
  }
  // uma aba que ainda escreve sem conta passa a escrever na conta
  avisarQueLevou();
  void s.sinc.sincronizar();
}

const Contexto = createContext<Sessao | null>(null);
export const ProvedorDeSessao = Contexto.Provider;

export function useSessao(): Sessao {
  const s = useContext(Contexto);
  if (!s) throw new Error('sem sessão');
  return s;
}

// o que muda sem passar pelos registros (a meta do dia, as palavras de hoje) avisa por aqui
const pulsos = new Set<() => void>();
export function pulsar(): void {
  for (const f of [...pulsos]) f();
}

/**
 * Dados sempre em dia: carrega com `carregar` e carrega de novo toda vez que o armazém muda (aqui ou
 * vindo da nuvem). `undefined` = carregando; `null` = não existe (foi apagado, ou o link é velho).
 */
export function useVivo<T>(carregar: (s: Sessao) => Promise<T>, deps: readonly unknown[]): T | null | undefined {
  const s = useSessao();
  const [dados, setDados] = useState<T | null | undefined>(undefined);
  const funcao = useRef(carregar);
  funcao.current = carregar;
  useEffect(() => {
    let vivo = true;
    let pedido = 0;
    let marcado = false;
    const ler = () => {
      const meu = ++pedido;
      funcao.current(s).then(
        (d) => {
          if (vivo && meu === pedido) setDados(d);
        },
        () => {
          if (vivo && meu === pedido) setDados(null);
        },
      );
    };
    const marcar = () => {
      if (marcado) return;
      marcado = true;
      queueMicrotask(() => {
        marcado = false;
        if (vivo) ler();
      });
    };
    setDados(undefined);
    ler();
    const parar = s.armazem.aoMudar(marcar);
    pulsos.add(marcar);
    return () => {
      vivo = false;
      parar();
      pulsos.delete(marcar);
    };
  }, [s, ...deps]);
  return dados;
}

/** O estado da sincronização, para o indicador da nuvem. */
export function useSinc(): EstadoSinc {
  const s = useSessao();
  const [estado, setEstado] = useState<EstadoSinc>(s.sinc.estado);
  useEffect(() => {
    setEstado(s.sinc.estado);
    return s.sinc.aoMudar(setEstado);
  }, [s]);
  return estado;
}
