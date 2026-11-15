// SPDX-License-Identifier: MPL-2.0

/**
 * O PROCESSO QUE GRAVA (com permissão de administrador). A janela não grava: ela escreve a tarefa num
 * arquivo, abre um canal local (pipe nomeado no Windows, socket no Linux) e pede ao sistema para rodar
 * este processo elevado (UAC no Windows, pkexec no Linux; ver elevar.ts). Ele lê a tarefa, apaga o
 * arquivo, liga no canal, manda o token e depois só AVISA (fase e progresso). Não recebe nenhum comando
 * pelo canal: tudo o que ele faz está na tarefa, e ele mesmo confere o disco e a imagem (gravar.ts).
 *
 * É Node puro (nada do Electron, nada nativo): no Linux roda como `ELECTRON_RUN_AS_NODE=1`, e os
 * testes do CI o chamam direto com um disco virtual.
 */
import { readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { once } from 'node:events';
import { ambienteLinux, ambienteSimulado, ambienteWindows } from './ambientes.ts';
import { executar, normalizarErro, type Ambiente, type Aviso, type Tarefa } from './gravar.ts';

export interface Pedido {
  tarefa: Tarefa;
  /** O canal da janela e o token que prova que somos nós. */
  canal: string;
  token: string;
  /** O disco do executável, da imagem e da pasta temporária nunca é apagado. */
  protegidos: string[];
  /** Só nos testes e no desenvolvimento: o JSON dos discos simulados. */
  simulado?: string;
}

export type Mensagem = { token: string } | { aviso: Aviso } | { fim: true; ok: true; dados: string | null } | { fim: true; ok: false; erro: string; detalhe: string };

export function ambienteDoSistema(p: Pick<Pedido, 'protegidos' | 'simulado' | 'tarefa'>): Ambiente {
  if (p.simulado) return ambienteSimulado(p.simulado);
  const ctx = { caminhosProtegidos: [...p.protegidos, process.execPath, p.tarefa.imagem.arquivo] };
  if (process.platform === 'win32') return ambienteWindows(ctx);
  if (process.platform === 'linux') return ambienteLinux(ctx);
  throw new Error(`sistema sem suporte: ${process.platform}`);
}

/** Roda a tarefa do arquivo e devolve o código de saída (0 = gravou e conferiu). */
export async function rodarTrabalhador(arquivo: string): Promise<number> {
  const pedido = JSON.parse(readFileSync(arquivo, 'utf8')) as Pedido;
  rmSync(arquivo, { force: true });
  const canal = connect(pedido.canal);
  await once(canal, 'connect');
  const enviar = (m: Mensagem) => canal.write(`${JSON.stringify(m)}\n`);
  enviar({ token: pedido.token });
  let codigo = 0;
  try {
    const r = await executar(pedido.tarefa, ambienteDoSistema(pedido), (aviso) => enviar({ aviso }));
    enviar({ fim: true, ok: true, dados: r.plano.dados?.sistema ?? null });
  } catch (e) {
    const g = normalizarErro(e);
    enviar({ fim: true, ok: false, erro: g.codigo, detalhe: g.detalhe });
    codigo = 1;
  }
  await new Promise<void>((r) => canal.end(r));
  return codigo;
}
