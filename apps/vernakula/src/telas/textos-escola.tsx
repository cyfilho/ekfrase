// SPDX-License-Identifier: MPL-2.0

import { useState } from 'preact/hooks';
import { api, type Conta, type TextosEscola } from '../api.ts';
import { marcadores } from '../avisos.ts';
import { t, tr } from '../textos.ts';

/** Quem troca os textos da escola (o mesmo que a ponte confere). */
const PAPEIS = ['admin', 'coord_geral', 'coordenacao'];
export const podeEditarTextos = (c: Conta) => !!c.organizacoes[0]?.papeis.some((p) => PAPEIS.includes(p));

/** Só os textos que este app mostra (o do Editor de Textos fica de fora). */
const DESTE_APP = /^(vernakula|nucleo)\./;

type Situacao = { tipo: 'salvando' } | { tipo: 'salvo'; hora: string } | { tipo: 'erro'; chave: string; p?: Record<string, string> };

/**
 * Textos da escola: a administração troca, no próprio site, como uma tela fala
 * com a escola. Vale na hora e só para ela; em branco volta ao padrão.
 * Edita no idioma que está escolhido no alto da página.
 */
export function TextosDaEscola({
  conta,
  trocas,
  aoMudar,
}: {
  conta: Conta;
  trocas: TextosEscola;
  aoMudar: (novas: TextosEscola) => void;
}) {
  const escola = conta.organizacoes[0]!;
  const idioma = tr.idioma();
  const nomeIdioma = tr.idiomas().find((i) => i.codigo === idioma)?.nome ?? idioma;
  const [busca, setBusca] = useState('');
  const [soTrocados, setSoTrocados] = useState(false);
  const [situacao, setSituacao] = useState<Record<string, Situacao>>({});
  const doIdioma = trocas[idioma] ?? {};

  const termo = busca.trim().toLowerCase();
  const chaves = tr.chaves().filter((k) => {
    if (!DESTE_APP.test(k) || k === 'nucleo.idioma.nome') return false;
    if (soTrocados && !(k in doIdioma)) return false;
    if (!termo) return true;
    const padrao = tr.padrao(k) ?? '';
    return k.includes(termo) || padrao.toLowerCase().includes(termo) || (doIdioma[k] ?? '').toLowerCase().includes(termo);
  });

  async function salvar(chave: string, valor: string) {
    const texto = valor.trim();
    if (texto === (doIdioma[chave] ?? '')) return;
    const padrao = tr.padrao(chave) ?? '';
    if (texto !== '' && marcadores(texto) !== marcadores(padrao)) {
      return setSituacao((s) => ({ ...s, [chave]: { tipo: 'erro', chave: 'vernakula.textos.erro.marcadores', p: { marcadores: marcadores(padrao) || '—' } } }));
    }
    setSituacao((s) => ({ ...s, [chave]: { tipo: 'salvando' } }));
    const r = await api.salvarTexto({ organizacao: escola.id, idioma, chave, texto });
    if (!r.ok) return setSituacao((s) => ({ ...s, [chave]: { tipo: 'erro', chave: 'vernakula.textos.erro.salvar' } }));
    const novoIdioma = { ...doIdioma };
    if (texto === '') delete novoIdioma[chave];
    else novoIdioma[chave] = texto;
    aoMudar({ ...trocas, [idioma]: novoIdioma });
    const hora = new Date().toLocaleTimeString(idioma, { hour: '2-digit', minute: '2-digit' });
    setSituacao((s) => ({ ...s, [chave]: { tipo: 'salvo', hora } }));
  }

  return (
    <div class="pilha">
      <p>
        <a href="#">← {t('vernakula.menu.voltar')}</a>
      </p>
      <h1>{t('vernakula.textos.titulo')}</h1>
      <section class="painel filtros">
        <p>{t('vernakula.textos.explicacao', { escola: escola.nome })}</p>
        <p class="dica">{t('vernakula.textos.idioma', { idioma: nomeIdioma })}</p>
        <label>
          {t('vernakula.textos.buscar')}
          <input type="search" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} />
        </label>
        <label class="marcar">
          <input type="checkbox" checked={soTrocados} onChange={(e) => setSoTrocados(e.currentTarget.checked)} />
          {t('vernakula.textos.so_trocados', { count: Object.keys(doIdioma).length })}
        </label>
      </section>

      {chaves.map((chave) => {
        const s = situacao[chave];
        const trocado = chave in doIdioma;
        return (
          <article key={`${idioma}|${chave}`} class={`painel texto${trocado ? ' trocado' : ''}`}>
            <p class="padrao">
              <span class="rotulo">{t('vernakula.textos.padrao')}</span> {tr.padrao(chave)}
            </p>
            <label>
              <span class="so-leitor">{chave}</span>
              <textarea
                rows={Math.min(5, Math.max(1, Math.ceil((tr.padrao(chave) ?? '').length / 55)))}
                placeholder={tr.padrao(chave)}
                defaultValue={doIdioma[chave] ?? ''}
                onBlur={(e) => void salvar(chave, e.currentTarget.value)}
              />
            </label>
            <div class="linha-acoes">
              {s?.tipo === 'salvando' && <small>{t('vernakula.textos.salvando')}</small>}
              {s?.tipo === 'salvo' && <small class="ok">{t('vernakula.textos.salvo', { hora: s.hora })}</small>}
              {s?.tipo === 'erro' && <small class="erro-curto">{t(s.chave, s.p)}</small>}
              {trocado && (
                <button
                  type="button"
                  class="botao pequeno"
                  onClick={(e) => {
                    const area = (e.currentTarget.closest('article') as HTMLElement).querySelector('textarea')!;
                    area.value = '';
                    void salvar(chave, '');
                  }}
                >
                  {t('vernakula.textos.voltar_padrao')}
                </button>
              )}
              <small class="chave">{chave}</small>
            </div>
          </article>
        );
      })}
    </div>
  );
}
