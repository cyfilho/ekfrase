// SPDX-License-Identifier: MPL-2.0

/**
 * AS ATUALIZAÇÕES DO GRAVADOR (DEC-P072, docs/ATUALIZACOES.md §5, U2): a tela "Atualizações" (o botão ↻ do topo) e o
 * aviso discreto embaixo. A versão, "Automáticas (recomendado)" ou "Perguntar antes de instalar", um botão só que é
 * "Procurar agora" ou "Instalar", o andamento. A nova vale na próxima vez que o Gravador abrir (o `.exe` é trocado no
 * lugar); nunca no meio de uma gravação. Um Gravador que não se atualiza (o `npm run gravador`) não mostra nada disto.
 */
import { useEffect, useState } from 'preact/hooks';
import type { EstadoDoAtualizador, ModoAtualizacoes } from '../src/ponte.ts';
import { t } from './textos.ts';

const ponte = window.gravador!.atualizacoes;

let atual: EstadoDoAtualizador | null = null;
const ouvintes = new Set<() => void>();
function mudar(e: EstadoDoAtualizador | null): void {
  if (!e) return;
  atual = e;
  for (const f of [...ouvintes]) f();
}
ponte.aoMudar(mudar);

/** O estado (`null` enquanto carrega, e sempre num Gravador que não se atualiza). */
export function useAtualizacoes(): EstadoDoAtualizador | null {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintes.add(f);
    if (!atual) void ponte.estado().then(mudar);
    return () => void ouvintes.delete(f);
  }, []);
  return atual;
}

const pct = (e: EstadoDoAtualizador): number => (e.total > 0 ? Math.min(100, Math.floor((e.feito / e.total) * 100)) : 0);
const ERROS = new Set(['sem-rede', 'lacre', 'sem-espaco', 'falhou']);

function situacao(e: EstadoDoAtualizador): string {
  const base = t(`gravador.atualizacoes.situacao.${e.situacao}`, { nova: e.nova ?? '', pct: pct(e) });
  if (e.situacao !== 'erro' || !e.erro) return base;
  return `${base} ${t(`gravador.atualizacoes.erro.${ERROS.has(e.erro) ? e.erro : 'falhou'}`)}`;
}

export function TelaAtualizacoes({ e, voltar }: { e: EstadoDoAtualizador; voltar: () => void }) {
  const ocupado = e.situacao === 'procurando' || e.situacao === 'baixando' || e.situacao === 'aplicando';
  const disponivel = e.situacao === 'disponivel';
  const escolher = (m: ModoAtualizacoes) => void ponte.usarModo(m).then(mudar);
  return (
    <>
      <p data-teste="atualizacoes-versao">{t(e.canal === 'teste' ? 'gravador.atualizacoes.versao.teste' : 'gravador.atualizacoes.versao', { versao: e.versao })}</p>
      <fieldset class="modo">
        <legend>{t('gravador.atualizacoes.modo.rotulo')}</legend>
        {(['automaticas', 'perguntar'] as const).map((m) => (
          <label key={m}>
            <input type="radio" name="modo-atualizacoes" checked={e.modo === m} onChange={() => escolher(m)} data-teste={`atualizacoes-modo-${m}`} />
            <span>
              <strong>{t(`gravador.atualizacoes.modo.${m}`)}</strong> {t(`gravador.atualizacoes.modo.${m}.dica`)}
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" class={e.situacao === 'erro' ? 'aviso' : e.situacao === 'pronta' ? 'lacre-ok' : ''} data-teste={`atualizacoes-situacao-${e.situacao}`}>
        {situacao(e)}
      </p>
      {(e.situacao === 'baixando' || e.situacao === 'aplicando') && <progress max={100} value={pct(e)} aria-label={situacao(e)} />}
      {e.ultimaBusca !== null && <p class="nota">{t('gravador.atualizacoes.ultima', { quando: new Date(e.ultimaBusca).toLocaleString() })}</p>}
      <div class="acoes">
        <button type="button" class="botao" onClick={voltar} data-teste="atualizacoes-voltar">
          {t('gravador.atualizacoes.voltar')}
        </button>
        {/* UM botão só, que troca de papel ("Instalar" quando há uma nova esperando): o foco nunca se perde nele */}
        <button
          type="button"
          class={disponivel ? 'botao principal' : 'botao'}
          aria-disabled={ocupado}
          onClick={() => {
            if (!ocupado) void (disponivel ? ponte.instalar() : ponte.procurar()).then(mudar);
          }}
          data-teste={disponivel ? 'atualizacoes-instalar' : 'atualizacoes-procurar'}
        >
          {t(disponivel ? 'gravador.atualizacoes.instalar' : 'gravador.atualizacoes.procurar')}
        </button>
      </div>
    </>
  );
}

/** O que o aviso já mostrou e a pessoa dispensou (por versão), nesta vez que abriu. */
const dispensados = new Set<string>();

/** O aviso discreto embaixo de todos os passos: há uma nova (perguntar) ou a nova está pronta. Nunca pega o foco. */
export function AvisoDeAtualizacao({ e }: { e: EstadoDoAtualizador | null }) {
  const [, setV] = useState(0);
  if (!e) return null;
  const chave = e.situacao === 'disponivel' || e.situacao === 'pronta' ? `${e.situacao}:${e.nova}` : null;
  if (!chave || dispensados.has(chave)) return null;
  const dispensar = () => {
    dispensados.add(chave);
    setV((n) => n + 1);
  };
  return (
    <aside class="aviso-atualizacao" aria-label={t('gravador.atualizacoes.aviso')} data-teste="aviso-atualizacao">
      <p role="status">{situacao(e)}</p>
      <div class="acoes">
        {e.situacao === 'disponivel' && (
          <button type="button" class="botao principal" onClick={() => void ponte.instalar().then(mudar)} data-teste="aviso-atualizacao-instalar">
            {t('gravador.atualizacoes.instalar')}
          </button>
        )}
        <button type="button" class="botao" onClick={dispensar} data-teste={e.situacao === 'disponivel' ? 'aviso-atualizacao-agora-nao' : 'aviso-atualizacao-entendi'}>
          {t(e.situacao === 'disponivel' ? 'gravador.atualizacoes.agora-nao' : 'gravador.atualizacoes.entendi')}
        </button>
      </div>
    </aside>
  );
}
