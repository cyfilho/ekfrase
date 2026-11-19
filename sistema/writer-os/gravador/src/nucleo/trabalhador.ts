// SPDX-License-Identifier: MPL-2.0

/**
 * O PROCESSO QUE GRAVA (com permissão de administrador). A janela não grava: ela escreve a tarefa num
 * arquivo, abre um canal local (pipe nomeado no Windows, socket no Linux) e pede ao sistema para rodar
 * este processo elevado (UAC no Windows, pkexec no Linux; ver elevar.ts). Ele lê a tarefa, apaga o
 * arquivo, liga no canal, manda o token e depois só AVISA (fase e progresso). Não recebe nenhum comando
 * pelo canal: tudo o que ele faz está na tarefa, e ele mesmo confere o disco e a imagem (gravar.ts).
 *
 * A tarefa pode ter também a do COMPUTADOR (PLANO §8c, computador.ts): "preparar" (depois de gravar, no mesmo
 * UAC; se falhar, o pendrive continua gravado e a janela conta só o que faltou) ou "remover" (sozinha).
 *
 * É Node puro (nada do Electron, nada nativo): no Linux roda como `ELECTRON_RUN_AS_NODE=1`, e os
 * testes do CI o chamam direto com um disco virtual.
 */
import { readFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { once } from 'node:events';
import { ambienteLinux, ambienteSimulado, ambienteWindows } from './ambientes.ts';
import { ErroComputador, executarComputador, type TarefaComputador } from './computador.ts';
import { executar, normalizarErro, type Ambiente, type Aviso, type Tarefa } from './gravar.ts';

export interface Pedido {
  /** Gravar o pendrive (sem ela, só a do computador). */
  tarefa?: Tarefa;
  /** Preparar este computador (depois de gravar) ou remover o Writer OS dele. */
  computador?: TarefaComputador;
  /** O canal da janela e o token que prova que somos nós. */
  canal: string;
  token: string;
  /** O disco do executável, da imagem e da pasta temporária nunca é apagado. */
  protegidos: string[];
  /** Só nos testes e no desenvolvimento: o JSON dos discos simulados. */
  simulado?: string;
}

/** O que a tarefa do computador deu: o resultado (JSON) ou o erro. */
export type FimComputador = { ok: true; resultado: string } | { ok: false; erro: string; detalhe: string };

export type Mensagem =
  | { token: string }
  | { aviso: Aviso | { fase: 'computador'; etapa: string } }
  | { fim: true; ok: true; dados: string | null; computador?: FimComputador }
  | { fim: true; ok: false; erro: string; detalhe: string };

export function ambienteDoSistema(p: Pick<Pedido, 'protegidos' | 'simulado'> & { tarefa: Tarefa }): Ambiente {
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
    let dados: string | null = null;
    if (pedido.tarefa) {
      const r = await executar(pedido.tarefa, ambienteDoSistema({ ...pedido, tarefa: pedido.tarefa }), (aviso) => enviar({ aviso }));
      dados = r.plano.dados?.sistema ?? null;
    }
    let computador: FimComputador | undefined;
    if (pedido.computador) {
      try {
        const r = await executarComputador(pedido.computador, { simulado: !!pedido.simulado, avisar: (etapa) => enviar({ aviso: { fase: 'computador', etapa } }) });
        computador = { ok: true, resultado: JSON.stringify(r) };
      } catch (e) {
        const c = e instanceof ErroComputador ? e : new ErroComputador('falhou', String((e as Error)?.message ?? e).slice(0, 300));
        computador = { ok: false, erro: c.codigo, detalhe: c.detalhe };
        // só remover: o erro é o resultado da tarefa inteira
        if (!pedido.tarefa) codigo = 1;
      }
    }
    enviar({ fim: true, ok: true, dados, ...(computador ? { computador } : {}) });
  } catch (e) {
    const g = normalizarErro(e);
    enviar({ fim: true, ok: false, erro: g.codigo, detalhe: g.detalhe });
    codigo = 1;
  }
  await new Promise<void>((r) => canal.end(r));
  return codigo;
}
