// SPDX-License-Identifier: MPL-2.0

/**
 * O WRITER NO COMPUTADOR: o mesmo app do site, dentro da casca Electron (`sistema/writer-os/casca`).
 * Ele descobre que está lá pela ponte do preload (`window.ekfraseCasca`, a `PonteCasca` do núcleo)
 * e SÓ AÍ mostra o que é do computador: a pasta dos dados, a senha, o espelho `.md`, o servidor.
 * No site, `casca` é `null` e nada disto aparece.
 */
import { ArmazemPonte, ponteDaCasca, type Armazem, type EstadoCasca, type EstadoOS } from '@ekfrase/writer-nucleo';
import { useEffect, useState } from 'preact/hooks';

export const casca = ponteDaCasca();
export const naCasca = casca !== null;
/** O Writer OS (o pendrive): o sistema por trás da casca. Fora dele, `null`. */
export const sistemaOS = casca?.os ?? null;
export const noOS = sistemaOS !== null;

/** O armazém de um dono, no banco cifrado do processo principal (a página não toca nele). */
export async function armazemDaCasca(dono: string): Promise<Armazem> {
  if (!casca) throw new Error('fora da casca');
  const alca = await casca.armazem.abrir(dono);
  return new ArmazemPonte(dono, {
    chamar: (metodo, args) => casca.armazem.chamar(alca, metodo, args),
    aoMudar: (f) => casca.armazem.aoMudar(alca, f),
    fechar: () => casca.armazem.fechar(alca),
  });
}

// ---------- o estado da casca, para as telas ----------

let estado: EstadoCasca | null = null;
const ouvintes = new Set<() => void>();

export function mudarEstado(e: EstadoCasca): void {
  estado = e;
  for (const f of [...ouvintes]) f();
}

export async function lerEstado(): Promise<EstadoCasca | null> {
  if (!casca) return null;
  mudarEstado(await casca.estado());
  return estado;
}

/** O estado da casca (`null` enquanto carrega). Fora da casca, sempre `null`. */
export function useEstadoCasca(): EstadoCasca | null {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintes.add(f);
    if (!estado) void lerEstado();
    return () => void ouvintes.delete(f);
  }, []);
  return estado;
}

// ---------- o estado do Writer OS (o primeiro uso) ----------

let estadoOS: EstadoOS | null = null;
const ouvintesOS = new Set<() => void>();

export function mudarEstadoOS(e: EstadoOS): void {
  estadoOS = e;
  for (const f of [...ouvintesOS]) f();
}

/** O estado do Writer OS (`null` enquanto carrega, e sempre fora do OS). */
export function useEstadoOS(): EstadoOS | null {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintesOS.add(f);
    if (!estadoOS && sistemaOS) void sistemaOS.estado().then(mudarEstadoOS);
    return () => void ouvintesOS.delete(f);
  }, []);
  return estadoOS;
}

// ---------- antes de fechar a janela ou de trancar os textos ----------

/** O que tem de gravar antes de os textos fecharem (a sessão aberta registra a dela). */
export const antesDeTrancar = new Set<() => Promise<void>>();

async function gravarTudo(): Promise<void> {
  await Promise.allSettled([...antesDeTrancar].map((f) => f()));
}

casca?.aoFechar(gravarTudo);

/** Grava o que está aberto (antes de desligar, reiniciar ou trocar o teclado no Writer OS). */
export const gravarAgora = gravarTudo;

/** Fecha os textos (para trocar de pasta): grava o que falta, depois tranca. */
export async function trancar(): Promise<void> {
  if (!casca) return;
  await gravarTudo();
  mudarEstado(await casca.trancar());
}

// ---------- o rascunho de emergência ----------

/**
 * Onde o rascunho de emergência fica: no site, o `localStorage`; na casca, o banco cifrado (pelo
 * preload, de forma síncrona), para nenhum texto ficar fora da cifra.
 */
export interface GuardaDeRascunhos {
  por(chave: string, valor: string): boolean;
  tirar(chave: string): void;
  todos(): Record<string, string>;
}

const guardaDoNavegador: GuardaDeRascunhos = {
  por(chave, valor) {
    try {
      localStorage.setItem(chave, valor);
      return true;
    } catch {
      return false;
    }
  },
  tirar(chave) {
    try {
      localStorage.removeItem(chave);
    } catch {
      // sem armazenamento
    }
  },
  todos() {
    const saida: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== null) saida[k] = localStorage.getItem(k) ?? '';
      }
    } catch {
      // sem armazenamento
    }
    return saida;
  },
};

export const guardaDeRascunhos: GuardaDeRascunhos = casca ? casca.rascunhos : guardaDoNavegador;
