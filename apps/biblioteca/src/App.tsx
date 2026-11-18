// SPDX-License-Identifier: MPL-2.0

/**
 * A Biblioteca do Ekfrase (DEC-P049). O hall é o próprio app: quem chega vê o acervo, sem conta.
 *
 * `/biblioteca/` a entrada (as formas de usar) · `/biblioteca/app` o acervo (busca, estantes pelas classes da CDD,
 * gêneros; com conta, os livros do inventário) · `/biblioteca/app/livro/<id>` a ficha (ler, pôr no inventário,
 * baixar em EPUB/TXT/DOCX/PDF, sumário) · `/biblioteca/app/ler/<id>[/<capítulo>]` o leitor (Leitor.tsx).
 * Padrão dos endereços: docs/ENDERECOS.md.
 *
 * Ler não pede conta; anotar e guardar onde parou pedem o livro no INVENTÁRIO (conta Ekfrase).
 */
import { AcoesTopo, EntradaApp, FormConta, Janela, RodapeEkfrase, acervo, aoMudarEndereco, entradaPedida, jogo, limparEntradaPedida, noApp, ponte, telaNoApp, useConta, type Livro } from '@ekfrase/interface';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import logo from './img/logo-biblioteca.png';
import { Leitor } from './Leitor.tsx';
import { t, tr } from './textos.ts';

type Rota = { tipo: 'acervo' } | { tipo: 'livro'; id: string } | { tipo: 'ler'; id: string; capitulo: number | null };

function rotaDoEndereco(): Rota {
  const h = (telaNoApp('biblioteca') ?? []).join('/');
  const livro = /^livro\/([a-z0-9-]+)$/.exec(h);
  if (livro) return { tipo: 'livro', id: livro[1]! };
  const ler = /^ler\/([a-z0-9-]+)(?:\/(\d+))?$/.exec(h);
  if (ler) return { tipo: 'ler', id: ler[1]!, capitulo: ler[2] ? Number(ler[2]) : null };
  return { tipo: 'acervo' };
}

function useRota(): Rota {
  const [r, setR] = useState(rotaDoEndereco());
  useEffect(() => {
    const mudou = () => {
      setR(rotaDoEndereco());
      scrollTo(0, 0);
    };
    return aoMudarEndereco(mudou);
  }, []);
  return r;
}

export const nomeGenero = (g: string) => {
  const k = `biblioteca.genero.${g}`;
  const v = t(k);
  return v === k ? g : v;
};

/** O nome de um código da CDD (classe ou subdivisão: `biblioteca.cdd.<código>`). */
export const nomeCdd = (c: string) => t(`biblioteca.cdd.${c}`);

// ---------- o acervo e o inventário, num lugar só ----------

export function useCatalogo(): Livro[] | null {
  const [livros, setLivros] = useState<Livro[] | null>(null);
  useEffect(() => void acervo.carregarCatalogo().then(setLivros), []);
  return livros;
}

/** Os livros do inventário de quem entrou (ids), sempre atuais. Sem conta: null. */
export function useInventario(): Set<string> | null {
  const { conta } = useConta();
  const [ids, setIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!conta) {
      setIds(null);
      return;
    }
    const ler = () =>
      void ponte.listarInventario().then((r) => {
        if (r.ok) setIds(new Set(r.itens.filter((i) => i.secao === 'livros').map((i) => i.item)));
      });
    ler();
    return ponte.aoMudarInventario(ler);
  }, [conta?.id]);
  return ids;
}

// ---------- a casca ----------

export function App() {
  const rota = useRota();
  const [, setV] = useState(0);
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  // ekfrase.com/biblioteca cai na tela inicial (as formas de usar); a Biblioteca é livre, então "Abrir" serve a todos
  const [entrada, setEntrada] = useState(() => entradaPedida());
  if (entrada && rota.tipo === 'acervo') {
    return (
      <EntradaApp
        t={t}
        tr={tr}
        app="biblioteca"
        logo={logo}
        nome={t('biblioteca.nome')}
        descricao={t('biblioteca.lema')}
        podeCriar={false}
        arquivos={false}
        aoEntrar={() => undefined}
        aoAbrir={() => (limparEntradaPedida(), setEntrada(false))}
      />
    );
  }

  if (rota.tipo === 'ler') return <Leitor id={rota.id} capitulo={rota.capitulo} />;
  return (
    <div class="casca">
      <header class="topo">
        <a class="marca" href={noApp('biblioteca')}>
          <img src={logo} width={48} height={48} alt="" />
          <span>{t('biblioteca.nome')}</span>
        </a>
        <AcoesTopo t={t} tr={tr} app="biblioteca" passeio={jogo.sala('biblioteca')} entrar />
      </header>
      <main class="conteudo bib">{rota.tipo === 'livro' ? <Ficha id={rota.id} /> : <Acervo />}</main>
      <RodapeEkfrase t={t} />
    </div>
  );
}

// ---------- capa ----------

export function Capa({ livro, largura }: { livro: Livro; largura: number }) {
  const tela = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const desenhar = () => tela.current && acervo.desenharCapa(tela.current, livro, largura);
    desenhar();
    void document.fonts?.ready.then(desenhar);
  }, [livro.id, largura]);
  return <canvas ref={tela} class="capa" role="img" aria-label={t('biblioteca.capa', { titulo: livro.titulo })} />;
}

// ---------- o acervo (o hall) ----------

function Acervo() {
  const livros = useCatalogo();
  const inventario = useInventario();
  const [termo, setTermo] = useState('');
  // a estante = uma classe da CDD (DEC-P058): só aparecem as classes que têm livros
  const [classe, setClasse] = useState<string | null>(null);
  const [genero, setGenero] = useState<string | null>(null);
  const daClasse = (l: Livro) => !classe || acervo.classeDe(l.cdd) === classe;

  const achados = useMemo(() => {
    let l = acervo.buscar(livros ?? [], termo, nomeGenero, nomeCdd);
    l = l.filter(daClasse);
    if (genero) l = l.filter((x) => x.generos.includes(genero));
    return l;
  }, [livros, termo, classe, genero]);
  const generos = useMemo(
    () => [...new Set((livros ?? []).filter(daClasse).flatMap((l) => l.generos))].sort((a, b) => nomeGenero(a).localeCompare(nomeGenero(b))),
    [livros, classe],
  );
  const classes = useMemo(() => acervo.classesComLivros(livros ?? []), [livros]);
  const meus = (livros ?? []).filter((l) => inventario?.has(l.id));

  return (
    <>
      <section class="bib-hall">
        <h1>{t('biblioteca.titulo')}</h1>
        <p class="lema">{t('biblioteca.lema')}</p>
        <form class="bib-busca" role="search" onSubmit={(e) => e.preventDefault()}>
          <label for="busca" class="so-leitor">
            {t('biblioteca.buscar')}
          </label>
          <input id="busca" type="search" value={termo} placeholder={t('biblioteca.buscar.exemplo')} onInput={(e) => setTermo(e.currentTarget.value)} />
        </form>
      </section>

      {meus.length > 0 && (
        <section class="bib-secao">
          <h2>{t('biblioteca.inventario.titulo')}</h2>
          <ul class="bib-livros">
            {meus.map((l) => (
              <CartaoLivro key={l.id} livro={l} continuar />
            ))}
          </ul>
        </section>
      )}

      <section class="bib-secao">
        <h2>{t('biblioteca.estantes')}</h2>
        <div class="bib-chips" role="group" aria-label={t('biblioteca.estantes')}>
          <button type="button" class="chip" aria-pressed={classe === null} onClick={() => (setClasse(null), setGenero(null))}>
            {t('biblioteca.todas')}
          </button>
          {classes.map((c) => {
            const n = (livros ?? []).filter((l) => acervo.classeDe(l.cdd) === c).length;
            return (
              <button key={c} type="button" class="chip" aria-pressed={classe === c} onClick={() => (setClasse(classe === c ? null : c), setGenero(null))}>
                <span class="cdd-num">{c}</span> {t(`biblioteca.cdd.${c}`)} <small>{n}</small>
              </button>
            );
          })}
        </div>
        {generos.length > 0 && (
          <div class="bib-chips generos" role="group" aria-label={t('biblioteca.generos')}>
            {generos.map((g) => (
              <button key={g} type="button" class="chip pequeno" aria-pressed={genero === g} onClick={() => setGenero(genero === g ? null : g)}>
                {nomeGenero(g)}
              </button>
            ))}
          </div>
        )}
        {livros === null ? (
          <p class="carregando">{t('nucleo.carregando')}</p>
        ) : achados.length ? (
          <ul class="bib-livros">
            {achados.map((l) => (
              <CartaoLivro key={l.id} livro={l} />
            ))}
          </ul>
        ) : (
          <p class="dica">{t(termo ? 'biblioteca.nada' : 'biblioteca.estante_vazia')}</p>
        )}
      </section>

      <section class="bib-sobre painel">
        <h2>{t('biblioteca.sobre.titulo')}</h2>
        <p>{t('biblioteca.sobre.texto')}</p>
        <p>{t('biblioteca.sobre.cdd')}</p>
      </section>
    </>
  );
}

function CartaoLivro({ livro, continuar }: { livro: Livro; continuar?: boolean }) {
  return (
    <li class="bib-cartao">
      <a href={continuar ? noApp('biblioteca', `ler/${livro.id}`) : noApp('biblioteca', `livro/${livro.id}`)}>
        <Capa livro={livro} largura={120} />
        <strong>{livro.titulo}</strong>
        <small>{livro.autor}</small>
        {continuar && <span class="botao pequeno principal">{t('biblioteca.continuar')}</span>}
      </a>
    </li>
  );
}

// ---------- a ficha de um livro ----------

/** Pôr no inventário (pede conta: sem ela, abre o entrar/criar conta e põe logo depois). */
export function BotaoInventario({ livro, tem }: { livro: Livro; tem: boolean }) {
  const { conta } = useConta();
  const [pedindoConta, setPedindoConta] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const por = async () => {
    setOcupado(true);
    const r = await ponte.porNoInventario('livros', livro.id);
    setOcupado(false);
    setErro(r.ok ? '' : t('nucleo.erro.servidor'));
  };
  if (tem)
    return (
      <button
        type="button"
        class="botao"
        disabled={ocupado}
        onClick={async () => {
          if (!confirm(t('biblioteca.inventario.tirar.confirmar', { titulo: livro.titulo }))) return;
          setOcupado(true);
          await ponte.tirarDoInventario('livros', livro.id);
          setOcupado(false);
        }}
      >
        {t('biblioteca.inventario.tirar')}
      </button>
    );
  return (
    <>
      <button type="button" class="botao" disabled={ocupado} onClick={() => (conta ? void por() : setPedindoConta(true))}>
        {t('biblioteca.inventario.por')}
      </button>
      {erro && <p class="erro">{erro}</p>}
      {pedindoConta && (
        <Janela titulo={t('biblioteca.inventario.por')} t={t} fechar={() => setPedindoConta(false)}>
          <p>{t('biblioteca.inventario.pede_conta')}</p>
          <FormConta
            t={t}
            app="biblioteca"
            idioma={tr.idioma()}
            podeCriar
            aoEntrar={() => {
              setPedindoConta(false);
              void por();
            }}
          />
        </Janela>
      )}
    </>
  );
}

const FORMATOS = ['epub', 'pdf', 'docx', 'txt'] as const;

function Ficha({ id }: { id: string }) {
  const livros = useCatalogo();
  const inventario = useInventario();
  const [sumario, setSumario] = useState<string[] | null>(null);
  const [leitores, setLeitores] = useState<number | null>(null);
  useEffect(() => {
    void fetch(`${acervo.ACERVO}${id}/livro.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ sumario: string[] }>) : { sumario: [] }))
      .then((l) => setSumario(l.sumario))
      .catch(() => setSumario([]));
    void ponte.contagemInventario('livros').then((r) => r.ok && setLeitores(r.contagem[id] ?? 0));
  }, [id]);
  if (livros === null) return <p class="carregando">{t('nucleo.carregando')}</p>;
  const l = livros.find((x) => x.id === id);
  if (!l)
    return (
      <section class="pilha">
        <p class="erro">{t('biblioteca.nao_achado')}</p>
        <a href={noApp('biblioteca')}>{t('biblioteca.voltar')}</a>
      </section>
    );
  const tem = Boolean(inventario?.has(l.id));
  return (
    <article class="bib-ficha">
      <a class="voltar" href={noApp('biblioteca')}>
        {t('biblioteca.voltar')}
      </a>
      <div class="bib-ficha-topo">
        <Capa livro={l} largura={180} />
        <div class="bib-ficha-dados">
          <h1>{l.titulo}</h1>
          {l.subtitulo && <p class="subtitulo">{l.subtitulo}</p>}
          <p class="autor">
            {l.autor}
            {l.ano ? ` (${l.ano < 0 ? t('biblioteca.ano.ac', { ano: String(-l.ano) }) : l.ano})` : ''}
          </p>
          <p class="dica">{t('biblioteca.traducao', { nome: l.traducao })}</p>
          <ul class="etiquetas">
            <li class="cdd">
              {t('biblioteca.cdd', { numero: l.cdd })} · {nomeCdd(acervo.classeDe(l.cdd))}
            </li>
            {l.generos.map((g) => (
              <li key={g}>{nomeGenero(g)}</li>
            ))}
          </ul>
          <p class="dica">
            {t('biblioteca.cdd.caminho', {
              caminho: acervo
                .caminhoCdd(l.cdd)
                .map((c) => `${c} ${nomeCdd(c)}`)
                .join(' › '),
            })}
          </p>
          <p>{l.descricao}</p>
          <p class="dica">
            {t('biblioteca.tamanho', { capitulos: l.capitulos, paginas: Math.max(1, Math.round(l.palavras / 250)) })}
            {leitores !== null && leitores > 0 && ` · ${t('biblioteca.leitores', { count: leitores })}`}
          </p>
          <div class="acoes">
            <a class="botao principal" href={noApp('biblioteca', `ler/${l.id}`)}>
              {t(tem ? 'biblioteca.continuar' : 'biblioteca.ler')}
            </a>
            <BotaoInventario livro={l} tem={tem} />
          </div>
          {!tem && <p class="dica">{t('biblioteca.inventario.por_que')}</p>}
          <h2>{t('biblioteca.baixar')}</h2>
          <div class="acoes bib-baixar">
            {FORMATOS.filter((f) => l.arquivos[f]).map((f) => (
              <a key={f} class="botao pequeno" href={`${acervo.ACERVO}${l.arquivos[f]}`} download={`${l.titulo}.${f}`}>
                {t(`biblioteca.formato.${f}`)}
              </a>
            ))}
          </div>
          <p class="dica">{t('biblioteca.licenca', { licenca: l.licenca, editora: l.editora ?? 'Ekfrase', ano: l.ano_traducao != null ? String(l.ano_traducao) : '' })}</p>
        </div>
      </div>
      {sumario && sumario.length > 0 && (
        <section class="bib-sumario">
          <h2>{t('biblioteca.sumario')}</h2>
          <ol>
            {sumario.map((s, i) => (
              <li key={i}>
                <a href={noApp('biblioteca', `ler/${l.id}/${i + 1}`)}>{s}</a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
