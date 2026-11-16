// SPDX-License-Identifier: MPL-2.0

import { ponte, type Conta } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';

/**
 * A conta, também SEM INTERNET. O `useConta` da casca comum diz "ninguém entrou" quando a ponte não
 * responde; aqui isso abriria o armazém errado (o `local`) e os textos da conta sumiriam da tela.
 * Então o Writer lembra neste aparelho a última conta que entrou: sem rede (ou com o servidor fora),
 * abre o armazém dela e escreve normalmente; a fila sobe quando a rede volta. Sair de verdade (a
 * ponte responde "ninguém") esquece a conta.
 */
const CHAVE = 'ekfrase.writer.conta';

function lembrada(): Conta | null {
  try {
    const c = JSON.parse(localStorage.getItem(CHAVE) ?? 'null') as Conta | null;
    return c && typeof c.id === 'number' ? c : null;
  } catch {
    return null;
  }
}

function lembrar(c: Conta | null): void {
  try {
    if (c) localStorage.setItem(CHAVE, JSON.stringify({ id: c.id, nome: c.nome, email: c.email, papeis: c.papeis, equipe: c.equipe }));
    else localStorage.removeItem(CHAVE);
  } catch {
    // sem armazenamento: sem rede, só o armazém local
  }
}

export interface ContaDoWriter {
  carregando: boolean;
  conta: Conta | null;
  /** A ponte não respondeu: a conta é a lembrada neste aparelho. */
  semRede: boolean;
}

export function useContaDoWriter(): ContaDoWriter {
  const [, setV] = useState(0);
  useEffect(() => {
    const parar = ponte.aoMudarConta(() => setV((n) => n + 1));
    void ponte.eu();
    // a rede voltou: pergunta de novo quem está logado (a sessão pode ter vencido)
    const voltou = () => void ponte.eu(true);
    addEventListener('online', voltou);
    return () => {
      parar();
      removeEventListener('online', voltou);
    };
  }, []);
  const e = ponte.contaAtual();
  if (e.carregando) return { carregando: true, conta: null, semRede: false };
  if (e.conta) {
    lembrar(e.conta);
    return { carregando: false, conta: e.conta, semRede: false };
  }
  if (e.erro === 'rede' || e.erro === 'servidor') {
    const c = lembrada();
    if (c) return { carregando: false, conta: c, semRede: true };
  } else {
    lembrar(null);
  }
  return { carregando: false, conta: null, semRede: false };
}
