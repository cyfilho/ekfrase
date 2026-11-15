// SPDX-License-Identifier: MPL-2.0

/** O contrato entre a página do Gravador e o processo principal (o preload põe em `window.gravador`). */
import type { Recusa } from './nucleo/discos.ts';

export interface DiscoNaTela {
  id: string;
  nome: string;
  tamanho: number;
  tipo: 'pendrive' | 'externo';
  setor: number;
  recusa: Recusa | null;
  writerOS: boolean;
  /** Para mostrar antes de apagar. */
  conteudo: { particoes: number; usado: number | null; rotulos: string[] };
}

export type InfoLancamento = { ok: true; versao: string; tamanho: number } | { ok: false; erro: 'sem-release' | 'sem-rede' };

export type ImagemEscolhida = { ok: true; arquivo: string; nome: string; lacre: 'ekfrase' | 'ausente'; comentario: string | null } | { ok: false; erro: string } | null;

export type FaseTela = 'baixar' | 'conferir-imagem' | 'permissao' | 'conferir' | 'preparar' | 'gravar' | 'verificar' | 'dados' | 'pronto';

export interface Progresso {
  fase: FaseTela;
  feito?: number | undefined;
  total?: number | undefined;
}

export interface PedidoGravar {
  modo: 'criar' | 'atualizar';
  disco: string;
  /** O nome do disco, como a pessoa digitou (o processo principal confere de novo). */
  confirmacao: string;
  origem: 'release' | 'arquivo';
  /** Sem o lacre: a pessoa leu o aviso vermelho e digitou a frase. */
  semLacreConfirmado: boolean;
  /** Limite da EKFRASE-DADOS, em GB (null = o resto do disco). */
  limiteGb: number | null;
}

export type ResultadoGravar = { ok: true; dados: string | null } | { ok: false; erro: string; detalhe?: string };

export interface PonteGravador {
  estado(): Promise<{ versao: string; plataforma: string; simulado: boolean }>;
  discos(): Promise<DiscoNaTela[]>;
  lancamento(): Promise<InfoLancamento>;
  escolherImagem(): Promise<ImagemEscolhida>;
  gravar(p: PedidoGravar): Promise<ResultadoGravar>;
  cancelar(): Promise<void>;
  ejetar(disco: string): Promise<{ ok: boolean; erro?: string }>;
  aoProgresso(f: (p: Progresso) => void): () => void;
  aoTentarFechar(f: () => void): () => void;
}

/** O nome do disco como a pessoa digita: sem diferença de maiúsculas e espaços. */
export const nomeNormalizado = (s: string): string => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
