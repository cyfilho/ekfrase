// SPDX-License-Identifier: MPL-2.0

/**
 * O leitor da Biblioteca (o EPUB já preparado por scripts/biblioteca.ts: um capítulo por vez).
 *
 * - Para todo mundo: sumário, capítulo anterior/próximo (botões ou ← →), tamanho da letra, tema do
 *   leitor (claro, sépia, noturno; fica neste aparelho) e o MODO FOCO TOTAL (tela cheia, só o texto;
 *   Esc sai).
 * - Com o livro no INVENTÁRIO (conta Ekfrase): destacar trechos (4 cores), anotar, a lista das
 *   anotações com exportação (.md e .txt) e guardar onde parou (capítulo e quanto já foi), na nuvem.
 *   Sem o livro no inventário, a seleção mostra o convite para pôr o livro lá.
 */
import { Janela, RodapeEkfrase, acervo, irPara, noApp, ponte, useConta } from '@ekfrase/interface';
import { temaEfetivo } from '@ekfrase/nucleo';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { BotaoInventario, useCatalogo } from './App.tsx';
import { CORES, baixar, exportar, lerDados, marcar, selecaoEm, type Anotacao, type Cor, type DadosLivro } from './anotacoes.ts';
import { t } from './textos.ts';

type Tema = 'claro' | 'sepia' | 'noturno';
interface Preferencias {
  tema: Tema;
  tamanho: number;
}
const CHAVE_PREF = 'biblioteca.leitor';
const TEMAS: readonly Tema[] = ['claro', 'sepia', 'noturno'];

function lerPref(): Preferencias {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_PREF) ?? 'null') as Partial<Preferencias> | null;
    return {
      tema: p?.tema && TEMAS.includes(p.tema) ? p.tema : temaEfetivo() === 'escuro' ? 'noturno' : 'claro',
      tamanho: typeof p?.tamanho === 'number' ? Math.min(170, Math.max(80, p.tamanho)) : 105,
    };
  } catch {
    return { tema: 'claro', tamanho: 105 };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const ir = (tela: string) => irPara(noApp('biblioteca', tela));

interface Capitulo {
  n: number;
  titulo: string;
  html: string;
}
type Selecao = NonNullable<ReturnType<typeof selecaoEm>>;

export function Leitor({ id, capitulo }: { id: string; capitulo: number | null }) {
  const livros = useCatalogo();
  const livro = livros?.find((l) => l.id === id);
  const { conta, carregando } = useConta();
  const [sumario, setSumario] = useState<string[] | null>(null);
  const [cap, setCap] = useState<Capitulo | null>(null);
  const [erro, setErro] = useState(false);
  /** Dados do livro no inventário; null = fora do inventário (ou sem conta). */
  const [dados, setDados] = useState<DadosLivro | null>(null);
  const [pronto, setPronto] = useState(false);
  const [pref, setPref] = useState(lerPref);
  const [foco, setFoco] = useState(false);
  const [painel, setPainel] = useState<null | 'sumario' | 'notas'>(null);
  const [sel, setSel] = useState<Selecao | null>(null);
  const [editando, setEditando] = useState<Anotacao | null>(null);
  const [aviso, setAviso] = useState(true);
  const texto = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const restaurar = useRef<number | null>(null);
  const dadosRef = useRef<DadosLivro | null>(null);
  const timer = useRef(0);
  const total = sumario?.length ?? livro?.capitulos ?? 0;

  useEffect(() => {
    try {
      localStorage.setItem(CHAVE_PREF, JSON.stringify(pref));
    } catch {
      // sem armazenamento: vale até fechar
    }
  }, [pref]);

  useEffect(() => {
    void fetch(`${acervo.ACERVO}${id}/livro.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ sumario: string[] }>) : Promise.reject()))
      .then((l) => setSumario(l.sumario))
      .catch(() => setErro(true));
  }, [id]);

  // está no inventário? (e, se está, onde parou e as anotações)
  useEffect(() => {
    if (carregando) return;
    const ler = () => {
      if (!conta) {
        dadosRef.current = null;
        setDados(null);
        setPronto(true);
        return;
      }
      void ponte.dadosDoItem<unknown>('livros', id).then((r) => {
        const d = r.ok ? lerDados(r.item.dados) : null;
        dadosRef.current = d;
        setDados(d);
        setPronto(true);
      });
    };
    ler();
    return ponte.aoMudarInventario(ler);
  }, [conta?.id, carregando, id]);

  // sem capítulo no endereço: volta de onde parou (ou o primeiro)
  useEffect(() => {
    if (!pronto || capitulo !== null) return;
    // o ref tem o que já foi lido nesta visita (o estado só muda com as anotações)
    const d = dadosRef.current;
    if (d && d.fracao > 0) restaurar.current = d.fracao;
    irPara(noApp('biblioteca', `ler/${id}/${d?.capitulo ?? 1}`), { substituir: true });
  }, [pronto, capitulo]);

  useEffect(() => {
    if (capitulo === null) return;
    setCap(null);
    setSel(null);
    void fetch(`${acervo.ACERVO}${id}/${pad(capitulo)}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ titulo: string; html: string }>) : Promise.reject()))
      .then((c) => setCap({ n: capitulo, ...c }))
      .catch(() => setErro(true));
  }, [id, capitulo]);

  /** Grava na nuvem pouco depois da última mudança (rolar a página muda muito). */
  const gravar = (d: DadosLivro, ja = false) => {
    clearTimeout(timer.current);
    const f = () => void ponte.gravarDadosDoItem('livros', id, d);
    if (ja) f();
    else timer.current = window.setTimeout(f, 1500);
  };
  const atualizar = (d: DadosLivro) => {
    setDados(d);
    dadosRef.current = d;
    gravar(d);
  };

  const notasDoCap = useMemo(() => dados?.anotacoes.filter((a) => a.capitulo === capitulo) ?? [], [dados, capitulo]);

  // o capítulo na tela, com os destaques; depois, volta para onde parou
  useLayoutEffect(() => {
    const el = texto.current;
    if (!el || !cap) return;
    el.innerHTML = cap.html;
    marcar(el, notasDoCap);
    if (restaurar.current !== null) {
      const f = restaurar.current;
      restaurar.current = null;
      requestAnimationFrame(() => scrollTo(0, f * (document.documentElement.scrollHeight - innerHeight)));
    }
  }, [cap, notasDoCap]);

  // a barra de progresso e onde parou
  useEffect(() => {
    if (!cap) return;
    let pedido = 0;
    const rolou = () => {
      cancelAnimationFrame(pedido);
      pedido = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight;
        const f = max > 0 ? Math.min(1, scrollY / max) : 1;
        if (barra.current) barra.current.style.width = `${Math.round(f * 100)}%`;
        const d = dadosRef.current;
        if (d && (d.capitulo !== cap.n || Math.abs(d.fracao - f) > 0.01)) {
          dadosRef.current = { ...d, capitulo: cap.n, fracao: f };
          gravar(dadosRef.current);
        }
      });
    };
    rolou();
    addEventListener('scroll', rolou, { passive: true });
    const sair = () => dadosRef.current && gravar(dadosRef.current, true);
    addEventListener('pagehide', sair);
    return () => {
      removeEventListener('scroll', rolou);
      removeEventListener('pagehide', sair);
      cancelAnimationFrame(pedido);
    };
  }, [cap, dados !== null]);

  // a seleção de um trecho
  useEffect(() => {
    let espera = 0;
    const ver = () => {
      clearTimeout(espera);
      espera = window.setTimeout(() => setSel(texto.current ? selecaoEm(texto.current) : null), 180);
    };
    document.addEventListener('selectionchange', ver);
    return () => document.removeEventListener('selectionchange', ver);
  }, []);

  // foco total: tela cheia; Esc (ou sair da tela cheia) volta
  useEffect(() => {
    if (!foco) return;
    void raiz.current?.requestFullscreen?.().catch(() => undefined);
    const saiu = () => !document.fullscreenElement && setFoco(false);
    document.addEventListener('fullscreenchange', saiu);
    return () => {
      document.removeEventListener('fullscreenchange', saiu);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [foco]);

  // teclado: ← → trocam de capítulo; Esc sai do foco e fecha os painéis
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Escape') {
        setFoco(false);
        setPainel(null);
      } else if (e.key === 'ArrowRight' && capitulo !== null && capitulo < total && !e.altKey) ir(`ler/${id}/${capitulo + 1}`);
      else if (e.key === 'ArrowLeft' && capitulo !== null && capitulo > 1 && !e.altKey) ir(`ler/${id}/${capitulo - 1}`);
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, [capitulo, total]);

  const criar = (cor: Cor): Anotacao | null => {
    if (!dados || !sel || capitulo === null) return null;
    const a: Anotacao = {
      id: crypto.randomUUID(),
      capitulo,
      inicio: sel.inicio,
      fim: sel.fim,
      texto: sel.texto.slice(0, 1000),
      nota: '',
      cor,
      criada: new Date().toISOString(),
    };
    const atual = dadosRef.current ?? dados;
    atualizar({ ...atual, anotacoes: [...atual.anotacoes, a] });
    getSelection()?.removeAllRanges();
    setSel(null);
    return a;
  };

  /** Cliques no texto: as notas de rodapé (âncoras) e os destaques. */
  const clicou = (e: MouseEvent) => {
    const alvo = e.target as HTMLElement;
    const a = alvo.closest?.('a[href^="#"]');
    if (a) {
      e.preventDefault();
      const destino = texto.current?.querySelector(`[id="${CSS.escape(a.getAttribute('href')!.slice(1))}"]`);
      destino?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const m = alvo.closest?.('mark[data-anotacao]') as HTMLElement | null;
    if (m && dados) setEditando(dados.anotacoes.find((x) => x.id === m.dataset['anotacao']) ?? null);
  };

  if (erro)
    return (
      <main class="conteudo pilha">
        <p class="erro">{t('biblioteca.nao_achado')}</p>
        <a href={noApp('biblioteca')}>{t('biblioteca.voltar')}</a>
      </main>
    );

  const titulo = livro?.titulo ?? '';
  return (
    <div ref={raiz} class={`leitor tema-${pref.tema}${foco ? ' foco' : ''}`} style={{ '--tamanho': `${pref.tamanho}%` }}>
      {!foco && (
        <header class="leitor-topo">
          <a class="botao pequeno" href={noApp('biblioteca', `livro/${id}`)} title={t('biblioteca.leitor.voltar')} aria-label={t('biblioteca.leitor.voltar')}>
            ←
          </a>
          <div class="leitor-titulo">
            <strong>{titulo}</strong>
            <small>{cap?.titulo ?? ''}</small>
          </div>
          <div class="leitor-botoes">
            <button type="button" class="botao pequeno" aria-pressed={painel === 'sumario'} onClick={() => setPainel(painel === 'sumario' ? null : 'sumario')}>
              {t('biblioteca.sumario')}
            </button>
            <button type="button" class="botao pequeno" aria-pressed={painel === 'notas'} onClick={() => setPainel(painel === 'notas' ? null : 'notas')}>
              {t('biblioteca.anotacoes')}
              {dados && dados.anotacoes.length > 0 && <small> {dados.anotacoes.length}</small>}
            </button>
            <button type="button" class="botao pequeno" title={t('biblioteca.leitor.menor')} aria-label={t('biblioteca.leitor.menor')} onClick={() => setPref({ ...pref, tamanho: Math.max(80, pref.tamanho - 10) })}>
              A−
            </button>
            <button type="button" class="botao pequeno" title={t('biblioteca.leitor.maior')} aria-label={t('biblioteca.leitor.maior')} onClick={() => setPref({ ...pref, tamanho: Math.min(170, pref.tamanho + 10) })}>
              A+
            </button>
            <button
              type="button"
              class="botao pequeno"
              title={t('biblioteca.leitor.tema', { tema: t(`biblioteca.leitor.tema.${TEMAS[(TEMAS.indexOf(pref.tema) + 1) % TEMAS.length]}`) })}
              onClick={() => setPref({ ...pref, tema: TEMAS[(TEMAS.indexOf(pref.tema) + 1) % TEMAS.length]! })}
            >
              {t(`biblioteca.leitor.tema.${pref.tema}`)}
            </button>
            <button type="button" class="botao pequeno principal" onClick={() => setFoco(true)}>
              {t('biblioteca.leitor.foco')}
            </button>
          </div>
          <div class="leitor-progresso" aria-hidden="true">
            <div ref={barra} />
          </div>
        </header>
      )}
      {foco && (
        <button type="button" class="leitor-sair-foco" onClick={() => setFoco(false)}>
          {t('biblioteca.leitor.sair_foco')}
        </button>
      )}

      {!foco && pronto && !dados && aviso && (
        <div class="leitor-aviso">
          <p>{t(conta ? 'biblioteca.leitor.sem_guardar' : 'biblioteca.leitor.sem_conta')}</p>
          {livro && <BotaoInventario livro={livro} tem={false} />}
          <button type="button" class="botao pequeno" onClick={() => setAviso(false)}>
            {t('biblioteca.fechar')}
          </button>
        </div>
      )}

      <main class="leitor-pagina">
        {!cap && <p class="carregando">{t('nucleo.carregando')}</p>}
        <div ref={texto} class="leitor-texto" lang={livro?.idioma ?? 'pt-BR'} onClick={clicou} />
        {cap && (
          <nav class="leitor-navegar" aria-label={t('biblioteca.leitor.navegar')}>
            {cap.n > 1 ? (
              <a class="botao" href={noApp('biblioteca', `ler/${id}/${cap.n - 1}`)}>
                {t('biblioteca.leitor.anterior')}
              </a>
            ) : (
              <span />
            )}
            <small>{t('biblioteca.leitor.de', { n: cap.n, total })}</small>
            {cap.n < total ? (
              <a class="botao principal" href={noApp('biblioteca', `ler/${id}/${cap.n + 1}`)}>
                {t('biblioteca.leitor.proximo')}
              </a>
            ) : (
              <a class="botao" href={noApp('biblioteca', `livro/${id}`)}>
                {t('biblioteca.leitor.fim')}
              </a>
            )}
          </nav>
        )}
      </main>

      {sel && !editando && (
        <div class="leitor-selecao" style={{ top: `${Math.max(8, sel.caixa.top - 58)}px`, left: `${Math.min(Math.max(8, sel.caixa.left + sel.caixa.width / 2 - 150), innerWidth - 308)}px` }} onMouseDown={(e) => e.preventDefault()}>
          {dados ? (
            <>
              {CORES.map((c) => (
                <button key={c} type="button" class={`cor cor-${c}`} title={t(`biblioteca.cor.${c}`)} aria-label={t('biblioteca.destacar', { cor: t(`biblioteca.cor.${c}`) })} onClick={() => criar(c)} />
              ))}
              <button
                type="button"
                class="botao pequeno principal"
                onClick={() => {
                  const a = criar('amarelo');
                  if (a) setEditando(a);
                }}
              >
                {t('biblioteca.anotar')}
              </button>
            </>
          ) : (
            <p>{t('biblioteca.leitor.anotar_pede')}</p>
          )}
        </div>
      )}

      {painel && !foco && (
        <aside class="leitor-painel" aria-label={t(painel === 'sumario' ? 'biblioteca.sumario' : 'biblioteca.anotacoes')}>
          <header>
            <h2>{t(painel === 'sumario' ? 'biblioteca.sumario' : 'biblioteca.anotacoes')}</h2>
            <button type="button" class="botao pequeno" onClick={() => setPainel(null)}>
              {t('biblioteca.fechar')}
            </button>
          </header>
          {painel === 'sumario' ? (
            <ol class="leitor-sumario">
              {(sumario ?? []).map((s, i) => (
                <li key={i} aria-current={i + 1 === capitulo ? 'page' : undefined}>
                  <a href={noApp('biblioteca', `ler/${id}/${i + 1}`)} onClick={() => setPainel(null)}>
                    {s}
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <Notas
              dados={dados}
              livro={livro ? { titulo: livro.titulo, autor: livro.autor } : { titulo, autor: '' }}
              sumario={sumario ?? []}
              id={id}
              irPara={(a) => {
                setPainel(null);
                if (a.capitulo !== capitulo) ir(`ler/${id}/${a.capitulo}`);
                setTimeout(() => texto.current?.querySelector(`mark[data-anotacao="${a.id}"]`)?.scrollIntoView({ block: 'center' }), 300);
              }}
              editar={setEditando}
              semInventario={livro ? <BotaoInventario livro={livro} tem={false} /> : null}
            />
          )}
        </aside>
      )}

      {editando && dados && (
        <EditarNota
          a={editando}
          fechar={() => setEditando(null)}
          salvar={(novo) => {
            atualizar({ ...(dadosRef.current ?? dados), anotacoes: (dadosRef.current ?? dados).anotacoes.map((x) => (x.id === novo.id ? novo : x)) });
            setEditando(null);
          }}
          apagar={() => {
            atualizar({ ...(dadosRef.current ?? dados), anotacoes: (dadosRef.current ?? dados).anotacoes.filter((x) => x.id !== editando.id) });
            setEditando(null);
          }}
        />
      )}

      {!foco && <RodapeEkfrase t={t} />}
    </div>
  );
}

function Notas(p: {
  dados: DadosLivro | null;
  livro: { titulo: string; autor: string };
  sumario: readonly string[];
  id: string;
  irPara: (a: Anotacao) => void;
  editar: (a: Anotacao) => void;
  semInventario: ComponentChildren;
}) {
  if (!p.dados)
    return (
      <div class="pilha">
        <p>{t('biblioteca.leitor.anotar_pede')}</p>
        {p.semInventario}
      </div>
    );
  const lista = [...p.dados.anotacoes].sort((a, b) => a.capitulo - b.capitulo || a.inicio - b.inicio);
  const rotulos = { nota: t('biblioteca.nota'), exportado: t('biblioteca.exportado', { data: new Date().toLocaleDateString() }) };
  return (
    <>
      {lista.length === 0 ? (
        <p class="dica">{t('biblioteca.anotacoes.vazio')}</p>
      ) : (
        <>
          <div class="acoes">
            <button type="button" class="botao pequeno" onClick={() => baixar(exportar('md', p.livro, p.sumario, lista, rotulos), `${p.id}-anotacoes.md`)}>
              {t('biblioteca.exportar.md')}
            </button>
            <button type="button" class="botao pequeno" onClick={() => baixar(exportar('txt', p.livro, p.sumario, lista, rotulos), `${p.id}-anotacoes.txt`)}>
              {t('biblioteca.exportar.txt')}
            </button>
          </div>
          <ul class="leitor-notas">
            {lista.map((a) => (
              <li key={a.id} class={`cor-${a.cor}`}>
                <small>{p.sumario[a.capitulo - 1] ?? a.capitulo}</small>
                <blockquote>{a.texto}</blockquote>
                {a.nota && <p>{a.nota}</p>}
                <div class="acoes">
                  <button type="button" class="botao pequeno" onClick={() => p.irPara(a)}>
                    {t('biblioteca.ir')}
                  </button>
                  <button type="button" class="botao pequeno" onClick={() => p.editar(a)}>
                    {t('biblioteca.editar')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function EditarNota({ a, fechar, salvar, apagar }: { a: Anotacao; fechar: () => void; salvar: (a: Anotacao) => void; apagar: () => void }) {
  const [nota, setNota] = useState(a.nota);
  const [cor, setCor] = useState<Cor>(a.cor);
  return (
    <Janela titulo={t('biblioteca.anotacao')} t={t} fechar={fechar}>
      <blockquote class={`leitor-citacao cor-${cor}`}>{a.texto}</blockquote>
      <label for="nota">{t('biblioteca.nota')}</label>
      <textarea id="nota" rows={5} maxLength={4000} value={nota} onInput={(e) => setNota(e.currentTarget.value)} />
      <div class="leitor-cores" role="group" aria-label={t('biblioteca.cor')}>
        {CORES.map((c) => (
          <button key={c} type="button" class={`cor cor-${c}`} aria-pressed={cor === c} title={t(`biblioteca.cor.${c}`)} aria-label={t(`biblioteca.cor.${c}`)} onClick={() => setCor(c)} />
        ))}
      </div>
      <div class="acoes">
        <button type="button" class="botao principal" onClick={() => salvar({ ...a, nota: nota.trim(), cor })}>
          {t('biblioteca.salvar')}
        </button>
        <button type="button" class="botao" onClick={apagar}>
          {t('biblioteca.apagar')}
        </button>
      </div>
    </Janela>
  );
}
