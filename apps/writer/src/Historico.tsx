// SPDX-License-Identifier: MPL-2.0

/**
 * O HISTÓRICO DA CENA (PLANO §2.1 item 7): as versões guardadas sozinhas (a cada 5 minutos com
 * mudança e ao sair da cena), para ver e voltar. Voltar não apaga nada: o texto de agora vira uma
 * versão também, e dá para desfazer.
 */
import type { TargetedKeyboardEvent } from 'preact';
import { useState } from 'preact/hooks';
import { useSessao, useVivo } from './estado.ts';
import { useHistoriaDeAgora } from './pedidos.ts';
import { ir } from './rotas.ts';
import { diaEHora, haQuanto, palavras, t, textoDoErro } from './textos.ts';
import { avisar, confirmar } from './ui.tsx';

export function Historico({ cena: id }: { cena: string }) {
  const s = useSessao();
  const dados = useVivo(async (x) => ({ cena: await x.escrita.cena(id), versoes: await x.escrita.historicoDaCena(id) }), [id]);
  useHistoriaDeAgora(dados?.cena.historia);
  const [escolhida, setEscolhida] = useState<string | null>(null);

  if (dados === null) return <p class="vazio">{t('writer.cena.nao-existe')}</p>;
  if (!dados) return <p class="carregando">{t('writer.carregando')}</p>;
  const { cena, versoes } = dados;
  const versao = versoes.find((v) => v.id === escolhida) ?? null;
  const texto = versao ? versao.texto : cena.texto;

  const voltar = async () => {
    if (!versao) return;
    if (!(await confirmar(t('writer.historico.voltar-pergunta', { quando: diaEHora(versao.criado_em) }), t('writer.historico.voltar')))) return;
    try {
      await s.escrita.restaurarVersao(versao.id);
      avisar(t('writer.historico.voltou'));
      ir({ tela: 'escrever', id });
    } catch (e) {
      avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');
    }
  };

  const setas = (e: TargetedKeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const botoes = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const i = botoes.indexOf(document.activeElement as HTMLButtonElement);
    botoes[e.key === 'ArrowDown' ? Math.min(botoes.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
  };

  return (
    <div class="tela-historico" data-teste="tela-historico">
      <header class="cabeca-tela">
        <h1>{t('writer.historico.titulo', { titulo: cena.titulo || t('writer.cena.sem-titulo') })}</h1>
        <a class="botao" href={`#/escrever/${id}`}>
          {t('writer.historico.voltar-escrever')}
        </a>
      </header>
      <p class="dica">{t('writer.historico.explica')}</p>
      <div class="historico">
        <ul class="versoes" onKeyDown={setas} aria-label={t('writer.historico.versoes')} data-teste="versoes">
          <li>
            <button type="button" class={escolhida === null ? 'ativa' : undefined} aria-pressed={escolhida === null} onClick={() => setEscolhida(null)}>
              <strong>{t('writer.historico.agora')}</strong>
              <span>{palavras(cena.palavras)}</span>
            </button>
          </li>
          {versoes.map((v) => (
            <li key={v.id}>
              <button type="button" class={escolhida === v.id ? 'ativa' : undefined} aria-pressed={escolhida === v.id} onClick={() => setEscolhida(v.id)} data-teste="versao">
                <strong>{diaEHora(v.criado_em)}</strong>
                <span>
                  {haQuanto(v.criado_em)} · {palavras(v.palavras)}
                </span>
              </button>
            </li>
          ))}
          {versoes.length === 0 && <li class="dica">{t('writer.historico.vazio')}</li>}
        </ul>
        <section class="versao-texto" aria-label={t('writer.historico.texto')}>
          <pre data-teste="texto-versao">{texto || t('writer.historico.texto-vazio')}</pre>
          {versao && (
            <button type="button" class="botao principal" onClick={() => void voltar()} data-teste="voltar-versao">
              {t('writer.historico.voltar')}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
