// SPDX-License-Identifier: MPL-2.0

/**
 * A ESTANTE (PLANO §2.1 item 1): as histórias (capa por código, título, palavras, última edição) e
 * "Nova história"; as ideias soltas num painel ao lado (no celular, numa aba); e o aviso das cópias
 * de conflito (§4.3), quando a nuvem trouxe duas versões do mesmo texto.
 */
import { partesHlc, type Cena, type Historia, type Ideia } from '@ekfrase/writer-nucleo';
import type { TargetedKeyboardEvent } from 'preact';
import { useState } from 'preact/hooks';
import { Capa } from './Capa.tsx';
import { noOS } from './computador/casca.ts';
import { useComandos } from './comandos.ts';
import { useSessao, useVivo } from './estado.ts';
import { IconeAviso, IconeLampada, IconeMais } from './icones.tsx';
import { pedir } from './pedidos.ts';
import { ir } from './rotas.ts';
import { diaEHora, haQuanto, palavras, t, textoDoErro } from './textos.ts';
import { avisar } from './ui.tsx';
import { noApp } from '@ekfrase/interface';

interface DadosEstante {
  historias: Historia[];
  palavras: Record<string, number>;
  /** Quando cada história (ou uma cena dela) mudou pela última vez (ms). */
  ultima: Record<string, number>;
  ideias: Ideia[];
  conflitos: Cena[];
}

async function carregar(s: ReturnType<typeof useSessao>): Promise<DadosEstante> {
  const historias = await s.escrita.historias();
  const { porHistoria } = await s.escrita.palavrasPorHistoria();
  const ultima: Record<string, number> = {};
  for (const h of historias) ultima[h.id] = partesHlc(h.versao).tempo;
  for (const r of await s.armazem.listar('cenas')) {
    const dono = r.dados['historia'];
    if (typeof dono !== 'string' || !(dono in ultima)) continue;
    ultima[dono] = Math.max(ultima[dono] ?? 0, partesHlc(r.versao).tempo);
  }
  historias.sort((a, b) => (ultima[b.id] ?? 0) - (ultima[a.id] ?? 0));
  return { historias, palavras: porHistoria, ultima, ideias: await s.escrita.ideias({ historia: null }), conflitos: await s.escrita.copiasDeConflito() };
}

export async function novaHistoria(s: ReturnType<typeof useSessao>): Promise<void> {
  try {
    const h = await s.escrita.criarHistoria({ titulo: t('writer.historia.nova') });
    ir({ tela: 'historia', id: h.id });
  } catch (e) {
    avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');
  }
}

export function Estante() {
  const s = useSessao();
  const dados = useVivo(carregar, []);
  const [aba, setAba] = useState<'historias' | 'ideias'>('historias');

  useComandos(() => [{ id: 'aba-ideias', rotulo: t('writer.cmd.aba-ideias'), fazer: () => setAba('ideias') }]);

  const abas = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const nova = aba === 'historias' ? 'ideias' : 'historias';
    setAba(nova);
    (e.currentTarget.querySelector(`[data-aba="${nova}"]`) as HTMLElement | null)?.focus();
  };

  return (
    <div class={`estante aba-${aba}`} data-teste="tela-estante">
      <div class="abas" role="tablist" aria-label={t('writer.estante.titulo')} onKeyDown={abas}>
        <button type="button" role="tab" id="aba-historias" data-aba="historias" aria-selected={aba === 'historias'} aria-controls="painel-historias" tabIndex={aba === 'historias' ? 0 : -1} onClick={() => setAba('historias')} data-teste="aba-historias">
          {t('writer.estante.historias')}
        </button>
        <button type="button" role="tab" id="aba-ideias" data-aba="ideias" aria-selected={aba === 'ideias'} aria-controls="painel-ideias" tabIndex={aba === 'ideias' ? 0 : -1} onClick={() => setAba('ideias')} data-teste="aba-ideias">
          {t('writer.estante.ideias')}
        </button>
      </div>

      <section class="estante-historias" id="painel-historias" aria-labelledby="titulo-estante">
        <header class="cabeca-tela">
          <h1 id="titulo-estante">{t('writer.estante.titulo')}</h1>
          <button type="button" class="botao principal" onClick={() => void novaHistoria(s)} data-teste="nova-historia">
            <IconeMais tamanho={14} /> {t('writer.cmd.nova-historia')}
          </button>
        </header>

        {!s.conta && !s.soMemoria && (
          <p class="aviso-caixa suave" data-teste="aviso-sem-conta">
            {t(noOS ? 'writer.estante.sem-conta.os' : 'writer.estante.sem-conta')}
          </p>
        )}
        {s.soMemoria && (
          <p class="aviso-caixa memoria" role="alert" data-teste="aviso-memoria">
            <IconeAviso tamanho={14} /> {t('writer.estante.memoria')}
          </p>
        )}

        {dados && dados.conflitos.length > 0 && (
          <div class="aviso-caixa conflito" role="alert" data-teste="aviso-conflitos">
            <p>
              <IconeAviso tamanho={14} /> <strong>{t('writer.conflito.titulo', { count: dados.conflitos.length, n: dados.conflitos.length })}</strong>
            </p>
            <p>{t('writer.conflito.explica')}</p>
            <ul>
              {dados.conflitos.map((c) => (
                <li key={c.id}>
                  <a href={noApp('writer', `escrever/${c.id}`)}>{t('writer.conflito.copia', { titulo: c.titulo || t('writer.cena.sem-titulo'), quando: c.conflito_em ? diaEHora(c.conflito_em) : '' })}</a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {dados === undefined && <p class="carregando">{t('writer.carregando')}</p>}
        {dados && dados.historias.length === 0 && (
          <div class="vazio" data-teste="estante-vazia">
            <p>{t('writer.estante.vazia')}</p>
          </div>
        )}
        {dados && dados.historias.length > 0 && (
          <ul class="livros" data-teste="livros">
            {dados.historias.map((h) => (
              <li key={h.id}>
                <a class="livro" href={noApp('writer', `historia/${h.id}`)} data-teste="livro">
                  <Capa historia={h} largura={72} />
                  <span class="livro-texto">
                    <strong class="livro-titulo">{h.titulo || t('writer.historia.sem-titulo')}</strong>
                    {h.logline && <span class="livro-logline">{h.logline}</span>}
                    <span class="livro-numeros">{palavras(dados.palavras[h.id] ?? 0)}</span>
                    <span class="livro-quando">{t('writer.estante.editada', { quando: haQuanto(dados.ultima[h.id] ?? 0) })}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside class="estante-ideias" id="painel-ideias" aria-labelledby="titulo-ideias-soltas">
        <header class="cabeca-tela pequena">
          <h2 id="titulo-ideias-soltas">
            <IconeLampada tamanho={16} /> {t('writer.estante.ideias-soltas')}
          </h2>
          <button type="button" class="botao pequeno" onClick={() => pedir('ideia')} data-teste="nova-ideia-estante">
            <IconeMais tamanho={12} /> {t('writer.cmd.ideia')}
          </button>
        </header>
        {dados && dados.ideias.length === 0 && <p class="dica">{t('writer.ideias.nenhuma-solta')}</p>}
        {dados && dados.ideias.length > 0 && (
          <ul class="ideias-curtas" data-teste="ideias-soltas">
            {dados.ideias.slice(0, 12).map((i) => (
              <li key={i.id} class={i.fixada ? 'fixada' : undefined}>
                <span class="selo-tipo">{t(`writer.tipo.${i.tipo}`)}</span>
                <span>{i.titulo || i.texto.split('\n')[0] || t('writer.ideia.sem-titulo')}</span>
              </li>
            ))}
          </ul>
        )}
        <a class="botao" href={noApp('writer', 'ideias')} data-teste="ir-ideias">
          {t('writer.ideias.abrir-banco')}
        </a>
      </aside>
    </div>
  );
}

/** Usado pela paleta: ir direto a uma história. */
export const irParaHistoria = (id: string) => ir({ tela: 'historia', id });
