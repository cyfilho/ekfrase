// SPDX-License-Identifier: MPL-2.0

/**
 * O BANCO DE IDEIAS (PLANO §2.1 item 4): cartões com tipo, etiquetas e fixar; "transformar em"
 * história, cena ou personagem (a ideia fica e guarda em que virou). E a IDEIA RÁPIDA (Ctrl+I): uma
 * caixinha para anotar sem sair do que se está fazendo; já nasce ligada à história aberta.
 */
import { TIPOS_IDEIA, type Historia, type Ideia, type TipoIdeia, type Virou } from '@ekfrase/writer-nucleo';
import { useMemo, useState } from 'preact/hooks';
import { semAcento, useComandos } from './comandos.ts';
import { useSessao, useVivo } from './estado.ts';
import { IconeAlfinete, IconeMais } from './icones.tsx';
import { historiaDeAgora, pedir, useHistoriaDeAgora } from './pedidos.ts';
import { ir } from './rotas.ts';
import { t, textoDoErro } from './textos.ts';
import { Camada, MenuAcoes, avisar, confirmar } from './ui.tsx';
import { noApp } from '@ekfrase/interface';

const falhou = (e: unknown) => avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');

/** As etiquetas digitadas ("magia, norte , ") viram lista limpa e sem repetir. */
export const lerEtiquetas = (texto: string): string[] => [...new Set(texto.split(',').map((e) => e.trim()).filter(Boolean))];

/**
 * As "letras" de um texto como a pessoa vê: um emoji (mesmo os de várias partes, como 👩‍💻 ou
 * 👍🏽) é uma letra só. Cortar por unidade UTF-16 deixava meio emoji solto no título.
 */
export function letras(texto: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(texto)].map((s) => s.segment);
  return Array.from(texto);
}

/** A primeira linha vira o título (até 80 letras); o resto, o texto. */
export function dividirIdeia(bruto: string): { titulo: string; texto: string } {
  const limpo = bruto.trim();
  const [primeira = '', ...resto] = limpo.split('\n');
  const ls = letras(primeira);
  if (ls.length <= 80) return { titulo: primeira.trim(), texto: resto.join('\n').trim() };
  return { titulo: `${ls.slice(0, 77).join('').trimEnd()}…`, texto: limpo };
}

export function IdeiaRapida({ fechar }: { fechar: () => void }) {
  const s = useSessao();
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState<TipoIdeia>('outro');
  const historia = historiaDeAgora();
  const gravar = async () => {
    if (!texto.trim()) return fechar();
    try {
      await s.escrita.criarIdeia({ ...dividirIdeia(texto), tipo, historia });
      avisar(t('writer.ideia.guardada'));
      fechar();
    } catch (e) {
      falhou(e);
    }
  };
  return (
    <Camada titulo={t('writer.ideia.rapida')} fechar={fechar} teste="ideia-rapida">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void gravar();
        }}
      >
        <label>
          {t('writer.ideia.o-que')}
          <textarea
            rows={4}
            value={texto}
            onInput={(e) => setTexto(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void gravar();
              }
            }}
            data-foco-inicial
            data-teste="ideia-texto"
          />
        </label>
        <p class="dica">{t('writer.ideia.dica-enter')}</p>
        <SeletorTipo valor={tipo} mudar={setTipo} />
        <div class="acoes-linha">
          <button type="button" class="botao" onClick={fechar}>
            {t('writer.cancelar')}
          </button>
          <button type="submit" class="botao principal" data-teste="ideia-gravar">
            {t('writer.gravar')}
          </button>
        </div>
      </form>
    </Camada>
  );
}

function SeletorTipo({ valor, mudar }: { valor: TipoIdeia; mudar: (t: TipoIdeia) => void }) {
  return (
    <label>
      {t('writer.ideia.tipo')}
      <select value={valor} onChange={(e) => mudar(e.currentTarget.value as TipoIdeia)} data-teste="ideia-tipo">
        {TIPOS_IDEIA.map((x) => (
          <option key={x} value={x}>
            {t(`writer.tipo.${x}`)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SeletorHistoria({ valor, mudar, historias, comNenhuma = true }: { valor: string | null; mudar: (v: string | null) => void; historias: readonly Historia[]; comNenhuma?: boolean }) {
  return (
    <label>
      {t('writer.ideia.historia')}
      <select value={valor ?? ''} onChange={(e) => mudar(e.currentTarget.value || null)} data-teste="ideia-historia">
        {comNenhuma && <option value="">{t('writer.ideia.solta')}</option>}
        {historias.map((h) => (
          <option key={h.id} value={h.id}>
            {h.titulo || t('writer.historia.sem-titulo')}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Criar ou editar uma ideia com tudo: tipo, título, texto, etiquetas e história. */
function EditorDeIdeia({ ideia, historiaInicial, historias, fechar }: { ideia: Ideia | null; historiaInicial: string | null; historias: readonly Historia[]; fechar: () => void }) {
  const s = useSessao();
  const [titulo, setTitulo] = useState(ideia?.titulo ?? '');
  const [texto, setTexto] = useState(ideia?.texto ?? '');
  const [tipo, setTipo] = useState<TipoIdeia>(ideia?.tipo ?? 'outro');
  const [etiquetas, setEtiquetas] = useState((ideia?.etiquetas ?? []).join(', '));
  const [historia, setHistoria] = useState<string | null>(ideia ? ideia.historia : historiaInicial);
  const gravar = async (e: Event) => {
    e.preventDefault();
    const campos = { titulo: titulo.trim(), texto, tipo, etiquetas: lerEtiquetas(etiquetas), historia };
    try {
      if (ideia) await s.escrita.editarIdeia(ideia.id, campos);
      else await s.escrita.criarIdeia(campos);
      fechar();
    } catch (er) {
      falhou(er);
    }
  };
  return (
    <Camada titulo={ideia ? t('writer.ideia.editar') : t('writer.ideia.nova')} fechar={fechar} teste="editor-ideia">
      <form onSubmit={(e) => void gravar(e)}>
        <label>
          {t('writer.ideia.titulo')}
          <input value={titulo} onInput={(e) => setTitulo(e.currentTarget.value)} data-foco-inicial data-teste="ideia-titulo" />
        </label>
        <label>
          {t('writer.ideia.texto')}
          <textarea rows={5} value={texto} onInput={(e) => setTexto(e.currentTarget.value)} data-teste="ideia-corpo" />
        </label>
        <SeletorTipo valor={tipo} mudar={setTipo} />
        <label>
          {t('writer.ideia.etiquetas')}
          <input value={etiquetas} onInput={(e) => setEtiquetas(e.currentTarget.value)} aria-describedby="dica-etiquetas" data-teste="ideia-etiquetas" />
        </label>
        <small id="dica-etiquetas" class="dica">
          {t('writer.ideia.etiquetas-dica')}
        </small>
        <SeletorHistoria valor={historia} mudar={setHistoria} historias={historias} />
        <div class="acoes-linha">
          <button type="button" class="botao" onClick={fechar}>
            {t('writer.cancelar')}
          </button>
          <button type="submit" class="botao principal" data-teste="ideia-salvar">
            {t('writer.gravar')}
          </button>
        </div>
      </form>
    </Camada>
  );
}

/** Para transformar em cena ou personagem uma ideia solta: em que história? */
function EscolherHistoria({ em, historias, fechar, escolher }: { em: Virou; historias: readonly Historia[]; fechar: () => void; escolher: (id: string) => void }) {
  const [id, setId] = useState<string | null>(historias[0]?.id ?? null);
  return (
    <Camada titulo={t(`writer.transformar.${em}`)} fechar={fechar} teste="escolher-historia">
      {historias.length === 0 ? (
        <p>{t('writer.transformar.sem-historias')}</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (id) escolher(id);
          }}
        >
          <p>{t('writer.transformar.qual-historia')}</p>
          <SeletorHistoria valor={id} mudar={setId} historias={historias} comNenhuma={false} />
          <div class="acoes-linha">
            <button type="button" class="botao" onClick={fechar}>
              {t('writer.cancelar')}
            </button>
            <button type="submit" class="botao principal" data-teste="transformar-ok">
              {t('writer.transformar.ok')}
            </button>
          </div>
        </form>
      )}
    </Camada>
  );
}

export function Ideias({ historia }: { historia?: string }) {
  const s = useSessao();
  useHistoriaDeAgora(historia);
  const dados = useVivo(async (x) => ({ ideias: await x.escrita.ideias(historia ? { historia } : {}), historias: await x.escrita.historias() }), [historia]);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<TipoIdeia | ''>('');
  const [editar, setEditar] = useState<Ideia | 'nova' | null>(null);
  const [escolher, setEscolher] = useState<{ ideia: Ideia; em: Virou } | null>(null);

  const nomeDaHistoria = (id: string | null) => (id ? (dados?.historias.find((h) => h.id === id)?.titulo ?? '') : '');
  const lista = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    return (dados?.ideias ?? []).filter((i) => {
      if (tipo && i.tipo !== tipo) return false;
      if (!termos.length) return true;
      const tudo = semAcento([i.titulo, i.texto, ...i.etiquetas, t(`writer.tipo.${i.tipo}`)].join(' '));
      return termos.every((p) => tudo.includes(p));
    });
  }, [dados, busca, tipo]);

  useComandos(() => [
    { id: 'nova-ideia', rotulo: t('writer.ideia.nova'), fazer: () => setEditar('nova') },
    { id: 'buscar-ideias', rotulo: t('writer.ideias.buscar'), fazer: () => document.getElementById('busca-ideias')?.focus() },
  ]);

  const transformar = async (ideia: Ideia, em: Virou, historiaEscolhida?: string) => {
    if (em !== 'historia' && !historiaEscolhida && !ideia.historia) {
      setEscolher({ ideia, em });
      return;
    }
    try {
      const r = await s.escrita.transformarIdeia(ideia.id, em, historiaEscolhida ? { historia: historiaEscolhida } : {});
      avisar(t(`writer.transformar.feito-${em}`));
      if (em === 'historia') ir({ tela: 'historia', id: r.id });
      else if (em === 'cena') ir({ tela: 'escrever', id: r.id });
      else ir({ tela: 'personagens', id: historiaEscolhida ?? ideia.historia ?? '' });
    } catch (e) {
      falhou(e);
    }
  };

  const apagar = async (i: Ideia) => {
    if (!(await confirmar(t('writer.ideia.apagar-pergunta', { titulo: i.titulo || t('writer.ideia.sem-titulo') }), t('writer.apagar'), true))) return;
    await s.escrita.apagarIdeia(i.id).catch(falhou);
    avisar(t('writer.apagado'));
  };

  const titulo = historia ? t('writer.ideias.da-historia', { titulo: nomeDaHistoria(historia) || t('writer.historia.sem-titulo') }) : t('writer.ideias.titulo');

  return (
    <div class="tela-ideias" data-teste="tela-ideias">
      <header class="cabeca-tela">
        <h1>{titulo}</h1>
        <button type="button" class="botao principal" onClick={() => setEditar('nova')} data-teste="nova-ideia">
          <IconeMais tamanho={14} /> {t('writer.ideia.nova')}
        </button>
      </header>
      {historia && (
        <p>
          <a href={noApp('writer', `historia/${historia}`)}>{t('writer.voltar-historia')}</a> · <a href={noApp('writer', 'ideias')}>{t('writer.ideias.todas')}</a>
        </p>
      )}
      <div class="filtros-ideias" role="search">
        <label>
          {t('writer.ideias.buscar')}
          <input id="busca-ideias" type="search" value={busca} onInput={(e) => setBusca(e.currentTarget.value)} data-teste="busca-ideias" />
        </label>
        <label>
          {t('writer.ideia.tipo')}
          <select value={tipo} onChange={(e) => setTipo(e.currentTarget.value as TipoIdeia | '')} data-teste="filtro-tipo">
            <option value="">{t('writer.ideias.todos-tipos')}</option>
            {TIPOS_IDEIA.map((x) => (
              <option key={x} value={x}>
                {t(`writer.tipo.${x}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {dados === undefined && <p class="carregando">{t('writer.carregando')}</p>}
      {dados && lista.length === 0 && (
        <div class="vazio">
          <p>{dados.ideias.length ? t('writer.ideias.nada-achado') : t('writer.ideias.vazio')}</p>
        </div>
      )}
      <ul class="cartoes" data-teste="cartoes-ideias">
        {lista.map((i) => (
          <li key={i.id} class={`cartao-ideia${i.fixada ? ' fixada' : ''}`} data-teste="cartao-ideia">
            <div class="cartao-topo">
              <span class="selo-tipo">{t(`writer.tipo.${i.tipo}`)}</span>
              <button
                type="button"
                class="botao-icone"
                aria-pressed={i.fixada}
                title={i.fixada ? t('writer.ideia.desafixar') : t('writer.ideia.fixar')}
                aria-label={i.fixada ? t('writer.ideia.desafixar') : t('writer.ideia.fixar')}
                onClick={() => void s.escrita.editarIdeia(i.id, { fixada: !i.fixada }).catch(falhou)}
                data-teste="fixar-ideia"
              >
                <IconeAlfinete tamanho={14} />
              </button>
              <MenuAcoes
                rotulo={t('writer.mais-acoes')}
                teste="acoes-ideia"
                itens={[
                  { rotulo: t('writer.ideia.editar'), fazer: () => setEditar(i) },
                  { rotulo: t('writer.transformar.historia'), fazer: () => void transformar(i, 'historia'), teste: 'virar-historia' },
                  { rotulo: t('writer.transformar.cena'), fazer: () => void transformar(i, 'cena'), teste: 'virar-cena' },
                  { rotulo: t('writer.transformar.personagem'), fazer: () => void transformar(i, 'personagem'), teste: 'virar-personagem' },
                  { rotulo: t('writer.apagar'), perigo: true, fazer: () => void apagar(i) },
                ]}
              />
            </div>
            <h2 class="cartao-titulo">{i.titulo || i.texto.split('\n')[0] || t('writer.ideia.sem-titulo')}</h2>
            {i.texto && i.titulo && <p class="cartao-texto">{i.texto}</p>}
            {i.etiquetas.length > 0 && (
              <ul class="etiquetas-ideia" aria-label={t('writer.ideia.etiquetas')}>
                {i.etiquetas.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <p class="cartao-pe">
              {i.historia && !historia && <a href={noApp('writer', `historia/${i.historia}`)}>{nomeDaHistoria(i.historia) || t('writer.historia.sem-titulo')}</a>}
              {i.virou_tipo && i.virou_id && <VirouEm ideia={i} />}
            </p>
          </li>
        ))}
      </ul>

      {editar && dados && <EditorDeIdeia ideia={editar === 'nova' ? null : editar} historiaInicial={historia ?? null} historias={dados.historias} fechar={() => setEditar(null)} />}
      {escolher && dados && (
        <EscolherHistoria
          em={escolher.em}
          historias={dados.historias}
          fechar={() => setEscolher(null)}
          escolher={(id) => {
            const e = escolher;
            setEscolher(null);
            void transformar(e.ideia, e.em, id);
          }}
        />
      )}
    </div>
  );
}

function VirouEm({ ideia }: { ideia: Ideia }) {
  const tipo = ideia.virou_tipo!;
  const id = ideia.virou_id!;
  const href = tipo === 'historia' ? noApp('writer', `historia/${id}`) : tipo === 'cena' ? noApp('writer', `escrever/${id}`) : ideia.historia ? noApp('writer', `personagens/${ideia.historia}`) : null;
  const texto = t(`writer.virou.${tipo}`);
  return href ? (
    <a class="selo-virou" href={href}>
      {texto}
    </a>
  ) : (
    <span class="selo-virou">{texto}</span>
  );
}

/** A paleta e a estante pedem a ideia rápida por aqui. */
export const abrirIdeiaRapida = () => pedir('ideia');
