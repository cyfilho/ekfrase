// SPDX-License-Identifier: MPL-2.0

/**
 * A HISTÓRIA (PLANO §2.1 item 2): a árvore capítulos → cenas, o status e as palavras de cada cena, a
 * meta, e a ficha numa gaveta.
 *
 * Teclado (§2.4): cada linha da árvore recebe foco. ↑ ↓ andam entre as linhas; Alt+↑ ↓ movem a cena
 * ou o capítulo (é o arrastar do teclado); Alt+→ põe uma cena solta no primeiro capítulo (num
 * capítulo, vai para a primeira cena dele); Alt+← tira a cena do capítulo; Enter abre a cena;
 * Ctrl+Enter cria uma cena logo abaixo; F2 renomeia; Delete apaga. Com o mouse, arrastar pela alça.
 */
import { partesHlc, type Arvore, type Capitulo, type Cena, type Historia as THistoria, type Totais } from '@ekfrase/writer-nucleo';
import type { TargetedKeyboardEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Capa, capaDe, proximaCapa } from './Capa.tsx';
import { teclaDe, useComandos } from './comandos.ts';
import { SeletorStatus } from './SeletorStatus.tsx';
import { useSessao, useVivo } from './estado.ts';
import { IconeAlca, IconeAviso, IconeMais, IconeNotas, IconePena } from './icones.tsx';
import { useHistoriaDeAgora } from './pedidos.ts';
import { ir } from './rotas.ts';
import { diaEHora, palavras, t, tr, textoDoErro } from './textos.ts';
import { Camada, Campo, MenuAcoes, avisar, confirmar } from './ui.tsx';
import { noApp } from '@ekfrase/interface';

interface Dados {
  arvore: Arvore;
  totais: Totais;
}

type Item = { tipo: 'cena'; cena: Cena } | { tipo: 'capitulo'; capitulo: Capitulo };
type Arrastando = { tipo: 'cena' | 'capitulo'; id: string } | null;

const falhou = (e: unknown) => avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');

export function Historia({ id }: { id: string }) {
  const s = useSessao();
  const dados = useVivo(async (x): Promise<Dados> => ({ arvore: await x.escrita.arvore(id), totais: await x.escrita.totais(id) }), [id]);
  useHistoriaDeAgora(id);
  const [ficha, setFicha] = useState(false);
  const [renomear, setRenomear] = useState<Item | null>(null);
  const focarDepois = useRef<string | null>(null);
  /** Depois de apagar pelo teclado: a linha nesta posição (ou a última, ou o título) recebe o foco. */
  const focarPosicao = useRef<number | null>(null);
  const arvoreRef = useRef<HTMLDivElement>(null);
  const [, setArrastandoEstado] = useState<Arrastando>(null);
  // os eventos de arrastar leem daqui (o estado só chega depois do próximo desenho)
  const arrastandoRef = useRef<Arrastando>(null);
  const setArrastando = (a: Arrastando) => {
    arrastandoRef.current = a;
    setArrastandoEstado(a);
  };
  const [alvo, setAlvo] = useState<string | null>(null);
  const fila = useRef<Promise<unknown>>(Promise.resolve());
  /** Um movimento de cada vez: com a tecla repetida, cada um parte da árvore que o anterior deixou. */
  const emFila = (f: () => Promise<unknown>): Promise<unknown> => (fila.current = fila.current.then(f).catch(falhou));

  // depois de mover ou criar, o foco fica no item (a árvore foi desenhada de novo)
  // (vale até a pessoa pôr o foco em outro lugar: com a tecla repetida, a linha é desenhada várias vezes)
  useEffect(() => {
    const pos = focarPosicao.current;
    if (pos !== null && dados) {
      focarPosicao.current = null;
      const todas = [...(arvoreRef.current?.querySelectorAll<HTMLElement>('.linha') ?? [])];
      // a linha que ficou no lugar da apagada; sem nenhuma linha, o título da tela (o foco nunca se perde)
      const el = todas[Math.min(pos, todas.length - 1)] ?? document.querySelector<HTMLElement>('#conteudo h1');
      if (el) {
        if (!el.hasAttribute('tabindex')) el.tabIndex = -1;
        el.focus();
      }
      return;
    }
    const quem = focarDepois.current;
    if (!quem || !dados) return;
    const el = arvoreRef.current?.querySelector<HTMLElement>(`[data-item="${quem}"]`);
    if (el && document.activeElement !== el) el.focus();
  }, [dados]);
  useEffect(() => {
    const outro = (e: FocusEvent) => {
      if (focarDepois.current && (e.target as HTMLElement | null)?.dataset?.['item'] !== focarDepois.current) focarDepois.current = null;
    };
    document.addEventListener('focusin', outro);
    return () => document.removeEventListener('focusin', outro);
  }, []);

  const h = dados?.arvore.historia;

  const novoCapitulo = async () => {
    if (!dados) return;
    try {
      const c = await s.escrita.criarCapitulo(id, { titulo: t('writer.capitulo.novo', { n: dados.arvore.capitulos.length + 1 }) });
      focarDepois.current = c.id;
    } catch (e) {
      falhou(e);
    }
  };

  /** Cena nova: logo abaixo de `depoisDe`, no fim de um capítulo, ou no fim da história. */
  const novaCena = async (onde: { depoisDe?: string; capitulo?: string | null } = {}) => {
    if (!dados) return;
    const ultimo = dados.arvore.capitulos.at(-1)?.capitulo.id ?? null;
    const capitulo = onde.capitulo !== undefined ? onde.capitulo : ultimo;
    try {
      const c = await s.escrita.criarCena(id, { titulo: t('writer.cena.nova'), capitulo }, onde.depoisDe ? { depoisDe: onde.depoisDe } : {});
      focarDepois.current = c.id;
    } catch (e) {
      falhou(e);
    }
  };

  const escreverPrimeira = () => {
    if (!dados) return;
    const todas = [...dados.arvore.soltas, ...dados.arvore.capitulos.flatMap((c) => c.cenas)];
    const maisRecente = [...todas].sort((a, b) => (a.versao < b.versao ? 1 : -1))[0];
    if (maisRecente) ir({ tela: 'escrever', id: maisRecente.id });
    else void novaCena().then(() => focarDepois.current && ir({ tela: 'escrever', id: focarDepois.current }));
  };

  const apagarHistoria = async () => {
    if (!h) return;
    if (!(await confirmar(t('writer.historia.apagar-pergunta', { titulo: h.titulo || t('writer.historia.sem-titulo') }), t('writer.apagar'), true))) return;
    await s.escrita.apagarHistoria(id).catch(falhou);
    avisar(t('writer.historia.apagada'));
    ir({ tela: 'estante' });
  };

  useComandos(() => [
    { id: 'novo-capitulo', rotulo: t('writer.cmd.novo-capitulo'), fazer: () => void novoCapitulo() },
    { id: 'nova-cena', rotulo: t('writer.cmd.nova-cena'), atalho: 'Ctrl+Enter', fazer: () => void novaCena() },
    { id: 'ficha', rotulo: t('writer.cmd.ficha'), fazer: () => setFicha(true) },
    { id: 'escrever', rotulo: t('writer.cmd.escrever'), fazer: escreverPrimeira },
    { id: 'personagens', rotulo: t('writer.cmd.personagens'), fazer: () => ir({ tela: 'personagens', id }) },
    { id: 'ideias-historia', rotulo: t('writer.cmd.ideias-historia'), fazer: () => ir({ tela: 'ideias', id }) },
    { id: 'exportar-historia', rotulo: t('writer.cmd.exportar-historia'), fazer: () => ir({ tela: 'arquivos', id }) },
    { id: 'apagar-historia', rotulo: t('writer.cmd.apagar-historia'), fazer: () => void apagarHistoria() },
    { id: 'ir-arvore', rotulo: t('writer.cmd.ir-arvore'), fazer: () => arvoreRef.current?.querySelector<HTMLElement>('.linha')?.focus() },
  ]);

  if (dados === null) {
    return (
      <div class="vazio">
        <p>{t('writer.historia.nao-existe')}</p>
        <a class="botao" href={noApp('writer')}>
          {t('writer.estante.ir')}
        </a>
      </div>
    );
  }
  if (!dados || !h) return <p class="carregando">{t('writer.carregando')}</p>;
  const { arvore, totais } = dados;

  // ---------- mover ----------
  const mover = (item: Item, direcao: 'cima' | 'baixo' | 'dentro' | 'fora') =>
    emFila(async () => {
      if (item.tipo === 'cena') {
        focarDepois.current = item.cena.id;
        await s.escrita.moverCena(item.cena.id, direcao);
      } else if (direcao === 'cima' || direcao === 'baixo') {
        focarDepois.current = item.capitulo.id;
        await s.escrita.moverCapitulo(item.capitulo.id, direcao);
      }
    });

  const apagar = async (item: Item) => {
    const titulo = item.tipo === 'cena' ? item.cena.titulo || t('writer.cena.sem-titulo') : item.capitulo.titulo;
    const pergunta = item.tipo === 'cena' ? t('writer.cena.apagar-pergunta', { titulo }) : t('writer.capitulo.apagar-pergunta', { titulo });
    const linha = arvoreRef.current?.querySelector<HTMLElement>(`[data-item="${item.tipo === 'cena' ? item.cena.id : item.capitulo.id}"]`) ?? null;
    const pos = linha ? linhas().indexOf(linha) : 0;
    if (!(await confirmar(pergunta, t('writer.apagar'), true))) return;
    try {
      focarDepois.current = null;
      focarPosicao.current = Math.max(0, pos);
      if (item.tipo === 'cena') await s.escrita.apagarCena(item.cena.id);
      else await s.escrita.apagarCapitulo(item.capitulo.id);
      avisar(t('writer.apagado'));
    } catch (e) {
      focarPosicao.current = null;
      falhou(e);
    }
  };

  const linhas = (): HTMLElement[] => [...(arvoreRef.current?.querySelectorAll<HTMLElement>('.linha') ?? [])];

  const teclaNaLinha = (item: Item) => (e: TargetedKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    const k = teclaDe(e);
    const todas = linhas();
    const i = todas.indexOf(e.currentTarget);
    const parar = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      parar();
      todas[k === 'ArrowDown' ? Math.min(todas.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    } else if (k === 'Home' || k === 'End') {
      parar();
      (k === 'Home' ? todas[0] : todas.at(-1))?.focus();
    } else if (k === 'Alt+ArrowUp' || k === 'Alt+ArrowDown') {
      parar();
      void mover(item, k === 'Alt+ArrowUp' ? 'cima' : 'baixo');
    } else if (k === 'Alt+ArrowRight') {
      parar();
      if (item.tipo === 'cena') void mover(item, 'dentro');
      else todas[i + 1]?.dataset['tipo'] === 'cena' && todas[i + 1]?.focus();
    } else if (k === 'Alt+ArrowLeft') {
      parar();
      if (item.tipo === 'cena') void mover(item, 'fora');
    } else if (k === 'Enter') {
      parar();
      if (item.tipo === 'cena') ir({ tela: 'escrever', id: item.cena.id });
      else setRenomear(item);
    } else if (k === 'Ctrl+Enter') {
      parar();
      void (item.tipo === 'cena' ? novaCena({ depoisDe: item.cena.id }) : novaCena({ capitulo: item.capitulo.id }));
    } else if (k === 'F2') {
      parar();
      setRenomear(item);
    } else if (k === 'Delete') {
      parar();
      void apagar(item);
    }
  };

  // ---------- arrastar (mouse) ----------
  const arrastar = (tipo: 'cena' | 'capitulo', idItem: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer?.setData('text/plain', idItem);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      setArrastando({ tipo, id: idItem });
    },
    onDragEnd: () => {
      setArrastando(null);
      setAlvo(null);
    },
  });
  /** Soltar em cima de uma cena: a cena arrastada fica antes dela. Em cima de um capítulo: vai para o fim dele. */
  const soltarEm = (destino: { cena?: Cena; capitulo?: string | null }) => ({
    onDragOver: (e: DragEvent) => {
      const a = arrastandoRef.current;
      if (!a) return;
      if (a.tipo === 'capitulo' && destino.cena) return;
      e.preventDefault();
      e.stopPropagation();
      setAlvo(destino.cena?.id ?? destino.capitulo ?? 'soltas');
    },
    onDragLeave: () => setAlvo(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const a = arrastandoRef.current;
      setArrastando(null);
      setAlvo(null);
      if (!a) return;
      const pronto = (p: () => Promise<unknown>) => void emFila(p);
      if (a.tipo === 'cena') {
        if (destino.cena) {
          if (destino.cena.id !== a.id) pronto(() => s.escrita.moverCenaPara(a.id, { capitulo: destino.cena!.capitulo, antesDe: destino.cena!.id }));
        } else pronto(() => s.escrita.moverCenaPara(a.id, { capitulo: destino.capitulo ?? null }));
      } else if (destino.capitulo && destino.capitulo !== a.id) {
        pronto(() => s.escrita.moverCapituloPara(a.id, { antesDe: destino.capitulo! }));
      }
    },
  });

  const linhaCena = (c: Cena) => {
    const item: Item = { tipo: 'cena', cena: c };
    const meta = c.meta_palavras;
    return (
      <li key={c.id} class={`no-cena${alvo === c.id ? ' alvo' : ''}`} {...soltarEm({ cena: c })}>
        <div class="linha" tabIndex={0} data-item={c.id} data-tipo="cena" data-teste="linha-cena" onKeyDown={teclaNaLinha(item)} aria-label={t('writer.arvore.cena', { titulo: c.titulo || t('writer.cena.sem-titulo') })}>
          <span class="alca" title={t('writer.arvore.arrastar')} {...arrastar('cena', c.id)}>
            <IconeAlca tamanho={14} />
          </span>
          <a class="linha-titulo" href={noApp('writer', `escrever/${c.id}`)} tabIndex={-1}>
            {c.titulo || t('writer.cena.sem-titulo')}
          </a>
          {c.conflito_de && (
            <span class="selo-conflito" title={t('writer.conflito.dica', { aparelho: c.conflito_aparelho ?? '', quando: c.conflito_em ? diaEHora(c.conflito_em) : '' })}>
              <IconeAviso tamanho={12} /> {t('writer.conflito.selo')}
            </span>
          )}
          <SeletorStatus cena={c} teste="status-cena" />
          <span class="linha-palavras">{meta > 0 ? `${tr.numero(c.palavras)} / ${tr.numero(meta)}` : tr.numero(c.palavras)}</span>
          <MenuAcoes
            rotulo={t('writer.mais-acoes')}
            teste="acoes-cena"
            itens={[
              { rotulo: t('writer.cmd.escrever'), fazer: () => ir({ tela: 'escrever', id: c.id }) },
              { rotulo: t('writer.renomear'), fazer: () => setRenomear(item) },
              { rotulo: t('writer.mover.cima'), fazer: () => void mover(item, 'cima') },
              { rotulo: t('writer.mover.baixo'), fazer: () => void mover(item, 'baixo') },
              c.capitulo === null && arvore.capitulos.length > 0 && { rotulo: t('writer.mover.dentro'), fazer: () => void mover(item, 'dentro') },
              c.capitulo !== null && { rotulo: t('writer.mover.fora'), fazer: () => void mover(item, 'fora') },
              { rotulo: t('writer.cmd.nova-cena-abaixo'), fazer: () => void novaCena({ depoisDe: c.id }) },
              { rotulo: t('writer.cmd.historico'), fazer: () => ir({ tela: 'historico', id: c.id }) },
              c.conflito_de !== null && { rotulo: t('writer.conflito.manter'), fazer: () => void s.escrita.dispensarConflito(c.id).catch(falhou) },
              { rotulo: t('writer.apagar'), perigo: true, fazer: () => void apagar(item) },
            ]}
          />
        </div>
      </li>
    );
  };

  const pct = totais.meta > 0 ? Math.min(100, Math.round((totais.palavras / totais.meta) * 100)) : 0;

  return (
    <div class="tela-historia" data-teste="tela-historia">
      <header class="historia-cabeca">
        <Capa historia={h} largura={64} />
        <div class="historia-nome">
          <h1 data-teste="titulo-historia">{h.titulo || t('writer.historia.sem-titulo')}</h1>
          {h.subtitulo && <p class="lema">{h.subtitulo}</p>}
          <p class="historia-numeros">
            {palavras(totais.palavras)}
            {totais.meta > 0 && ` · ${t('writer.meta.de', { meta: tr.numero(totais.meta), pct })}`}
            {` · ${t('writer.historia.n-cenas', { count: totais.cenas, n: totais.cenas })} · ${t('writer.historia.n-capitulos', { count: totais.capitulos, n: totais.capitulos })}`}
          </p>
          {totais.meta > 0 && (
            <div class="barra-meta" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('writer.meta.rotulo')}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
        <div class="historia-acoes">
          <button type="button" class="botao principal" onClick={escreverPrimeira} data-teste="escrever">
            <IconePena tamanho={16} /> {t('writer.cmd.escrever')}
          </button>
          <button type="button" class="botao" onClick={() => setFicha(true)} data-teste="abrir-ficha">
            <IconeNotas tamanho={16} /> {t('writer.ficha.rotulo')}
          </button>
          <MenuAcoes
            rotulo={t('writer.mais-acoes')}
            teste="acoes-historia"
            itens={[
              { rotulo: t('writer.cmd.personagens'), fazer: () => ir({ tela: 'personagens', id }) },
              { rotulo: t('writer.cmd.ideias-historia'), fazer: () => ir({ tela: 'ideias', id }) },
              { rotulo: t('writer.cmd.exportar-historia'), fazer: () => ir({ tela: 'arquivos', id }) },
              { rotulo: t('writer.cmd.apagar-historia'), perigo: true, fazer: () => void apagarHistoria() },
            ]}
          />
        </div>
      </header>

      <nav class="historia-links" aria-label={t('writer.historia.partes')}>
        <a href={noApp('writer', `personagens/${id}`)}>{t('writer.cmd.personagens')}</a>
        <a href={noApp('writer', `ideias/${id}`)}>{t('writer.cmd.ideias-historia')}</a>
        <a href={noApp('writer', `arquivos/${id}`)}>{t('writer.cmd.exportar-historia')}</a>
      </nav>

      <div class="arvore-acoes">
        <button type="button" class="botao" onClick={() => void novoCapitulo()} data-teste="novo-capitulo">
          <IconeMais tamanho={14} /> {t('writer.cmd.novo-capitulo')}
        </button>
        <button type="button" class="botao" onClick={() => void novaCena()} data-teste="nova-cena">
          <IconeMais tamanho={14} /> {t('writer.cmd.nova-cena')}
        </button>
      </div>

      <div class="arvore" ref={arvoreRef} data-teste="arvore" role="group" aria-label={t('writer.arvore.rotulo')}>
        <p class="dica arvore-dica">{t('writer.arvore.dica')}</p>
        {/* (a zona das soltas não aparece no meio do arrastar: a árvore não pode pular debaixo do mouse) */}
        {arvore.soltas.length > 0 && (
          <section class={`grupo soltas${alvo === 'soltas' ? ' alvo' : ''}`} {...soltarEm({ capitulo: null })}>
            {arvore.capitulos.length > 0 && <h2 class="grupo-titulo">{t('writer.arvore.soltas')}</h2>}
            <ul>{arvore.soltas.map(linhaCena)}</ul>
          </section>
        )}
        {arvore.capitulos.map(({ capitulo, cenas }) => {
          const item: Item = { tipo: 'capitulo', capitulo };
          const soma = cenas.reduce((n, c) => n + c.palavras, 0);
          return (
            <section key={capitulo.id} class={`grupo capitulo${alvo === capitulo.id ? ' alvo' : ''}`} {...soltarEm({ capitulo: capitulo.id })}>
              <div
                class="linha linha-capitulo"
                tabIndex={0}
                data-item={capitulo.id}
                data-tipo="capitulo"
                data-teste="linha-capitulo"
                onKeyDown={teclaNaLinha(item)}
                aria-label={t('writer.arvore.capitulo', { titulo: capitulo.titulo, n: cenas.length })}
              >
                <span class="alca" title={t('writer.arvore.arrastar')} {...arrastar('capitulo', capitulo.id)}>
                  <IconeAlca tamanho={14} />
                </span>
                <h2 class="linha-titulo">{capitulo.titulo || t('writer.capitulo.sem-titulo')}</h2>
                <span class="linha-palavras">{tr.numero(soma)}</span>
                <MenuAcoes
                  rotulo={t('writer.mais-acoes')}
                  teste="acoes-capitulo"
                  itens={[
                    { rotulo: t('writer.cmd.nova-cena-capitulo'), fazer: () => void novaCena({ capitulo: capitulo.id }) },
                    { rotulo: t('writer.renomear'), fazer: () => setRenomear(item) },
                    { rotulo: t('writer.mover.cima'), fazer: () => void mover(item, 'cima') },
                    { rotulo: t('writer.mover.baixo'), fazer: () => void mover(item, 'baixo') },
                    { rotulo: t('writer.apagar'), perigo: true, fazer: () => void apagar(item) },
                  ]}
                />
              </div>
              {cenas.length > 0 ? (
                <ul>{cenas.map(linhaCena)}</ul>
              ) : (
                <p class="dica grupo-vazio">
                  <button type="button" class="link" onClick={() => void novaCena({ capitulo: capitulo.id })}>
                    {t('writer.cmd.nova-cena-capitulo')}
                  </button>
                </p>
              )}
            </section>
          );
        })}
        {arvore.soltas.length === 0 && arvore.capitulos.length === 0 && (
          <div class="vazio" data-teste="arvore-vazia">
            <p>{t('writer.arvore.vazia')}</p>
          </div>
        )}
      </div>

      {ficha && <Ficha historia={h} fechar={() => setFicha(false)} />}
      {renomear && <Renomear item={renomear} fechar={() => setRenomear(null)} />}
    </div>
  );
}

/** A ficha da história (logline, sinopse, gênero, formato, ponto de vista, tempo verbal…), numa gaveta. */
function Ficha({ historia: h, fechar }: { historia: THistoria; fechar: () => void }) {
  const s = useSessao();
  type CampoTexto = 'titulo' | 'subtitulo' | 'logline' | 'sinopse' | 'genero' | 'formato' | 'ponto_vista' | 'tempo_verbal' | 'tema' | 'publico';
  const editar = (campo: CampoTexto) => (v: string) => s.escrita.editarHistoria(h.id, { [campo]: campo === 'titulo' ? v.trim() : v });
  const campo = (c: CampoTexto, area = false, foco = false) => (
    <Campo rotulo={t(`writer.ficha.${c}`)} valor={h[c]} tipo={area ? 'area' : 'texto'} gravar={editar(c)} teste={`ficha-${c}`} focoInicial={foco} />
  );
  const desde = partesHlc(h.versao).tempo;
  return (
    <Camada tipo="gaveta" titulo={t('writer.ficha.rotulo')} fechar={fechar} teste="gaveta-ficha">
      <div class="ficha-capa">
        <Capa historia={h} largura={56} />
        <button type="button" class="botao pequeno" onClick={() => void s.escrita.editarHistoria(h.id, { capa: { ...proximaCapa(capaDe(h)) } })} data-teste="trocar-capa">
          {t('writer.ficha.trocar-capa')}
        </button>
      </div>
      {campo('titulo', false, true)}
      {campo('subtitulo')}
      {campo('logline', true)}
      {campo('sinopse', true)}
      {campo('genero')}
      {campo('formato')}
      {campo('ponto_vista')}
      {campo('tempo_verbal')}
      {campo('tema')}
      {campo('publico')}
      <Campo
        rotulo={t('writer.ficha.meta_palavras')}
        valor={h.meta_palavras}
        tipo="numero"
        dica={t('writer.meta.zero')}
        gravar={(v) => s.escrita.editarHistoria(h.id, { meta_palavras: Math.max(0, Math.floor(Number(v) || 0)) })}
        teste="ficha-meta"
      />
      <p class="dica">{t('writer.ficha.editada', { quando: diaEHora(desde) })}</p>
    </Camada>
  );
}

function Renomear({ item, fechar }: { item: Item; fechar: () => void }) {
  const s = useSessao();
  const atual = item.tipo === 'cena' ? item.cena.titulo : item.capitulo.titulo;
  const [nome, setNome] = useState(atual);
  const gravar = async (e: Event) => {
    e.preventDefault();
    const v = nome.trim();
    try {
      if (item.tipo === 'cena') await s.escrita.editarCena(item.cena.id, { titulo: v });
      else await s.escrita.editarCapitulo(item.capitulo.id, { titulo: v });
      fechar();
    } catch (er) {
      falhou(er);
    }
  };
  return (
    <Camada titulo={item.tipo === 'cena' ? t('writer.cena.renomear') : t('writer.capitulo.renomear')} fechar={fechar} teste="renomear">
      <form onSubmit={(e) => void gravar(e)}>
        <label>
          {t('writer.renomear.nome')}
          <input value={nome} onInput={(e) => setNome(e.currentTarget.value)} data-foco-inicial data-teste="renomear-nome" />
        </label>
        <div class="acoes-linha">
          <button type="button" class="botao" onClick={fechar}>
            {t('writer.cancelar')}
          </button>
          <button type="submit" class="botao principal" data-teste="renomear-gravar">
            {t('writer.gravar')}
          </button>
        </div>
      </form>
    </Camada>
  );
}
