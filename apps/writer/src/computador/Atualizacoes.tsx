// SPDX-License-Identifier: MPL-2.0

/**
 * AS ATUALIZAÇÕES na tela (DEC-P072, docs/ATUALIZACOES.md §1; no Writer OS desde a U1, no computador na U2):
 *
 * - `ParteAtualizacoes`: a parte "Atualizações" do menu do sistema (no computador, dentro dos Ajustes). A versão, o ajuste ("Automáticas (recomendado)" ou
 *   "Perguntar antes de instalar"), "Procurar agora", o andamento, e o que aconteceu (pronta, erro, a que não ligou).
 * - `AvisoDeAtualizacao`: o aviso discreto no canto, em todas as telas: "Há uma versão nova", com Instalar e Agora não
 *   (modo perguntar); "Atualização pronta: vale na próxima vez que você ligar"; "a versão X não ligou, voltei para a Y".
 *   Nunca pega o foco (a pessoa pode estar escrevendo); chega-se a ele com Tab.
 *
 * Só aparece se a casca tem `atualizacoes` (fora dela, no site, nada disto existe).
 */
import type { EstadoAtualizacoes, ModoAtualizacoes, PonteAtualizacoes } from '@ekfrase/writer-nucleo';
import { useEffect, useState } from 'preact/hooks';
import { diaEHora, t } from '../textos.ts';
import { casca, noOS } from './casca.ts';

export const atualizacoesDaCasca: PonteAtualizacoes | null = casca?.atualizacoes ?? null;

let atual: EstadoAtualizacoes | null = null;
const ouvintes = new Set<() => void>();
function mudar(e: EstadoAtualizacoes): void {
  atual = e;
  for (const f of [...ouvintes]) f();
}
atualizacoesDaCasca?.aoMudar(mudar);

/** O estado das atualizações (`null` enquanto carrega, e sempre fora da casca). */
export function useAtualizacoes(): EstadoAtualizacoes | null {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintes.add(f);
    if (!atual && atualizacoesDaCasca) void atualizacoesDaCasca.estado().then(mudar);
    return () => void ouvintes.delete(f);
  }, []);
  return atual;
}

const pct = (e: EstadoAtualizacoes): number => (e.total > 0 ? Math.min(100, Math.floor((e.feito / e.total) * 100)) : 0);

/** As frases que mudam no computador (U2): ele não "liga", abre; e o que falta é espaço no computador, não no pendrive. */
const DO_PC = new Set(['situacao.parado', 'situacao.aplicando', 'situacao.pronta', 'modo.automaticas.dica', 'erro.sem-espaco']);
const chave = (k: string): string => (!noOS && DO_PC.has(k) ? `writer.atualizacoes.${k}.pc` : `writer.atualizacoes.${k}`);

/** A frase da situação (com o motivo, se é erro). */
function situacao(e: EstadoAtualizacoes): string {
  const base = t(chave(`situacao.${e.situacao}`), { nova: e.nova ?? '', pct: pct(e) });
  return e.situacao === 'erro' && e.erro ? `${base} ${t(chave(`erro.${e.erro}`))}` : base;
}

/**
 * A parte "Atualizações": no Writer OS, dentro do menu do sistema (o foco começa no ajuste de agora); no computador
 * (U2), dentro dos Ajustes (`focoInicial={false}`: o foco dos Ajustes continua onde estava).
 */
export function ParteAtualizacoes({ focoInicial = true }: { focoInicial?: boolean }) {
  const e = useAtualizacoes();
  const a = atualizacoesDaCasca;
  if (!a || !e) return <p aria-busy="true">…</p>;
  const ocupado = e.situacao === 'procurando' || e.situacao === 'baixando' || e.situacao === 'aplicando';
  const disponivel = e.situacao === 'disponivel';
  const escolher = (m: ModoAtualizacoes) => void a.usarModo(m).then(mudar);
  return (
    <section class="secao-os atualizacoes" data-teste="os-painel-atualizacoes" aria-label={t('writer.atualizacoes.titulo')}>
      {!noOS && <h3 class="titulo-atualizacoes">{t('writer.atualizacoes.titulo')}</h3>}
      <p data-teste="atualizacoes-versao">{t(e.canal === 'teste' ? 'writer.atualizacoes.versao.teste' : 'writer.atualizacoes.versao', { versao: e.versao })}</p>
      {e.voltou && (
        <p class="ekf-erro" role="alert" data-teste="atualizacoes-voltou">
          {t('writer.atualizacoes.voltou', { de: e.voltou.de, para: e.voltou.para })}
        </p>
      )}
      <fieldset class="escolha-atualizacoes">
        <legend>{t('writer.atualizacoes.modo.rotulo')}</legend>
        {(['automaticas', 'perguntar'] as const).map((m) => (
          <label class="opcao-atualizacoes" key={m}>
            <input type="radio" name="modo-atualizacoes" value={m} checked={e.modo === m} onChange={() => escolher(m)} {...(focoInicial && e.modo === m ? { 'data-foco-inicial': true } : {})} data-teste={`atualizacoes-modo-${m}`} />
            <span>
              <strong>{t(`writer.atualizacoes.modo.${m}`)}</strong>
              <small class="dica">{t(chave(`modo.${m}.dica`))}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p role="status" data-teste={`atualizacoes-situacao-${e.situacao}`}>
        {situacao(e)}
      </p>
      {(e.situacao === 'baixando' || e.situacao === 'aplicando') && <progress max={100} value={pct(e)} aria-label={situacao(e)} />}
      {e.ultimaBusca !== null && <p class="dica">{t('writer.atualizacoes.ultima', { quando: diaEHora(e.ultimaBusca) })}</p>}
      <div class="acoes-linha">
        {/* UM botão só, que troca de papel ("Instalar" quando há uma nova esperando): o foco nunca se perde nele */}
        <button
          type="button"
          class={disponivel ? 'botao principal' : 'botao'}
          aria-disabled={ocupado}
          onClick={() => {
            if (!ocupado) void (disponivel ? a.instalar() : a.procurar()).then(mudar);
          }}
          data-teste={disponivel ? 'atualizacoes-instalar' : 'atualizacoes-procurar'}
        >
          {t(disponivel ? 'writer.atualizacoes.instalar' : 'writer.atualizacoes.procurar')}
        </button>
        {/* no computador, a pronta vale ao fechar; "Reiniciar agora" fecha (gravando tudo), aplica e abre de novo */}
        {a.reiniciar && e.situacao === 'pronta' && (
          <button type="button" class="botao" onClick={() => void a.reiniciar?.()} data-teste="atualizacoes-reiniciar">
            {t('writer.atualizacoes.reiniciar')}
          </button>
        )}
      </div>
    </section>
  );
}

/** O que o aviso do canto já mostrou e a pessoa dispensou (por versão), nesta sessão. */
const dispensados = new Set<string>();

export function AvisoDeAtualizacao() {
  const e = useAtualizacoes();
  const [, setV] = useState(0);
  const a = atualizacoesDaCasca;
  if (!a || !e) return null;
  const chave = e.voltou ? `voltou:${e.voltou.de}` : e.situacao === 'disponivel' || e.situacao === 'pronta' ? `${e.situacao}:${e.nova}` : null;
  if (!chave || dispensados.has(chave)) return null;
  const dispensar = () => {
    dispensados.add(chave);
    setV((n) => n + 1);
  };
  const texto = e.voltou ? t('writer.atualizacoes.voltou', { de: e.voltou.de, para: e.voltou.para }) : situacao(e);
  return (
    <aside class="aviso-atualizacao" aria-label={t('writer.atualizacoes.aviso')} data-teste="aviso-atualizacao">
      <p role="status">{texto}</p>
      <div class="acoes-linha">
        {!e.voltou && e.situacao === 'disponivel' ? (
          <>
            <button type="button" class="botao pequeno principal" onClick={() => void a.instalar().then(mudar)} data-teste="aviso-atualizacao-instalar">
              {t('writer.atualizacoes.instalar')}
            </button>
            <button type="button" class="botao pequeno" onClick={dispensar} data-teste="aviso-atualizacao-agora-nao">
              {t('writer.atualizacoes.agora-nao')}
            </button>
          </>
        ) : (
          <>
            {!e.voltou && e.situacao === 'pronta' && a.reiniciar && (
              <button type="button" class="botao pequeno" onClick={() => void a.reiniciar?.()} data-teste="aviso-atualizacao-reiniciar">
                {t('writer.atualizacoes.reiniciar')}
              </button>
            )}
            <button type="button" class="botao pequeno" onClick={dispensar} data-teste="aviso-atualizacao-entendi">
              {t('writer.atualizacoes.entendi')}
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
