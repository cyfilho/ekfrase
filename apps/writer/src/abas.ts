// SPDX-License-Identifier: MPL-2.0

/**
 * AS ABAS: o Writer aberto em duas abas (ou janelas) do mesmo navegador usa o MESMO banco do
 * aparelho, mas uma aba não vê sozinha o que a outra gravou. Este canal (`BroadcastChannel`) avisa:
 *
 * - `mudou`: uma aba gravou estes registros; as outras do mesmo dono avisam quem ouve o armazém
 *   delas (origem `fora`): as telas leem de novo, e a folha aberta na mesma cena troca o texto (se
 *   não tem nada por gravar; se tem, `gravarTextoSobre` guarda o texto da outra aba no histórico);
 * - `levou`: uma aba levou os textos escritos sem conta para uma conta (`adotar`). As abas que
 *   ainda escrevem sem conta guardam o que falta (rascunho) e recarregam: abrem já na conta.
 *
 * Sem `BroadcastChannel` (navegador antigo), nada disso acontece, e a conferência do
 * `gravarTextoSobre` continua garantindo que nenhum texto se perde.
 */
import { DONO_LOCAL, type Armazem } from '@ekfrase/writer-nucleo';

const NOME = 'ekfrase-writer';

type Mensagem = { tipo: 'mudou'; dono: string; ids: string[] } | { tipo: 'levou'; dono: string };

function abrirCanal(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(NOME) : null;
  } catch {
    return null;
  }
}

/** Liga este armazém às outras abas do mesmo dono. Devolve como desligar. */
export function ligarAbas(dono: string, armazem: Armazem, aoLevar: () => void): () => void {
  const canal = abrirCanal();
  if (!canal) return () => undefined;
  const parar = armazem.aoMudar((m) => {
    if (m.origem === 'fora') return;
    try {
      canal.postMessage({ tipo: 'mudou', dono, ids: [...m.ids] } satisfies Mensagem);
    } catch {
      // canal fechado
    }
  });
  canal.onmessage = (e: MessageEvent<unknown>) => {
    const m = e.data as Partial<Mensagem> | null;
    if (!m || typeof m !== 'object' || m.dono !== dono) return;
    if (m.tipo === 'mudou' && Array.isArray(m.ids)) armazem.avisarDeFora(m.ids.filter((x): x is string => typeof x === 'string'));
    else if (m.tipo === 'levou') aoLevar();
  };
  return () => {
    parar();
    canal.close();
  };
}

/** Os textos escritos sem conta foram levados para uma conta: avisa as abas que escrevem sem conta. */
export function avisarQueLevou(): void {
  const canal = abrirCanal();
  if (!canal) return;
  try {
    canal.postMessage({ tipo: 'levou', dono: DONO_LOCAL } satisfies Mensagem);
  } finally {
    canal.close();
  }
}
