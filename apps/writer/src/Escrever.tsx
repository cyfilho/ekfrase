// SPDX-License-Identifier: MPL-2.0

/**
 * ESCREVER (o coração, PLANO §2.1 item 3): uma folha só, em tela cheia. O topo se esconde quando a
 * pessoa começa a digitar e volta com Esc, com o Tab de trás para a frente, levando o mouse para
 * cima ou, no toque, tocando no alto da tela (e sozinho, quando a pessoa para de digitar). O rodapé
 * discreto (palavras da cena e do dia, meta, nuvem, relógio) some enquanto se digita.
 *
 * Grava a cena inteira a cada pausa de 400 ms, ao sair do texto, ao sair da cena e quando a janela
 * perde o foco (PLANO §4.2). As gravações vão em fila (uma de cada vez). O texto que chega de fora
 * (da nuvem ou de outra aba, ver `abas.ts`) só entra na folha quando não há nada por gravar; se há,
 * a gravação confere o texto em que se baseou (`gravarTextoSobre`) e o de fora vai para o histórico.
 * Quando a página vai sumir, o que falta gravar vai na hora para o rascunho de emergência
 * (`rascunho.ts`); quando a sessão fecha, a folha grava antes de o armazém fechar.
 */
import { AcoesTopo, noApp } from '@ekfrase/interface';
import { contarPalavras, type Cena } from '@ekfrase/writer-nucleo';
import type { EditorView } from '@codemirror/view';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useComandos } from './comandos.ts';
import { SeletorStatus } from './SeletorStatus.tsx';
import { alternar, alternarTitulo, criarEditor, type Editor } from './editor.ts';
import { pulsar, useSessao, useVivo } from './estado.ts';
import { IconeEngrenagem, IconeLampada, IconeLupa, IconeNotas, IconeRelogio, IconeVoltar } from './icones.tsx';
import { NivelDeBateria } from './bateria.tsx';
import { noOS } from './computador/casca.ts';
import { BotaoSistema, RelogioOS } from './computador/SistemaOS.tsx';
import { Nuvem } from './Nuvem.tsx';
import { pedir, useHistoriaDeAgora } from './pedidos.ts';
import { mudarPrefs, usePrefs } from './prefs.ts';
import { esquecerRascunho, guardarRascunho, resumo } from './rascunho.ts';
import { ir } from './rotas.ts';
import { t, tr, textoDoErro } from './textos.ts';
import { Camada, Campo, ESPERA_GRAVAR, avisar, camadaAberta } from './ui.tsx';

type Gravacao = 'salvo' | 'gravando' | 'erro';

export function Escrever({ id }: { id: string }) {
  const s = useSessao();
  const p = usePrefs();
  const cena = useVivo((x) => x.escrita.cena(id), [id]);
  const dia = useVivo((x) => x.escrita.escritaDoDia(), []);
  useHistoriaDeAgora(cena?.historia);

  if (cena === null) {
    return (
      <main class="conteudo">
        <p class="aviso-caixa">{t('writer.cena.nao-existe')}</p>
        <a class="botao" href={noApp('writer')}>
          {t('writer.estante.ir')}
        </a>
      </main>
    );
  }
  if (cena === undefined) return <main class="folha-fundo" aria-busy="true" />;
  return <Folha key={id} cena={cena} palavrasDoDia={dia?.palavras ?? 0} metaDoDia={dia?.meta ?? 0} maquina={p.maquina} foco={p.foco} semMenus={p.semMenus} letra={p.letra} soMemoria={s.soMemoria} />;
}

interface FolhaProps {
  cena: Cena;
  palavrasDoDia: number;
  metaDoDia: number;
  maquina: boolean;
  foco: boolean;
  semMenus: boolean;
  letra: number;
  soMemoria: boolean;
}

function Folha({ cena, palavrasDoDia, metaDoDia, maquina, foco, semMenus, letra, soMemoria }: FolhaProps) {
  const s = useSessao();
  const id = cena.id;
  const lugar = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const pendente = useRef<string | null>(null);
  /** O texto que está sendo gravado agora (já saiu de `pendente`, ainda não chegou ao armazém). */
  const emVoo = useRef<string | null>(null);
  /** O texto que o armazém tem, até onde esta folha sabe (o que ela carregou ou gravou por último). */
  const base = useRef(cena.texto);
  /** Já guardou a versão de saída no histórico (a sessão fechando e a folha saindo fazem isso uma vez só). */
  const saiu = useRef(false);
  /** O último toque foi de dedo ou caneta (sem teclado físico, o topo volta sozinho). */
  const toque = useRef(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fila = useRef<Promise<void>>(Promise.resolve());
  const [gravacao, setGravacao] = useState<Gravacao>('salvo');
  const [palavras, setPalavras] = useState(cena.palavras);
  const [topo, setTopo] = useState(!semMenus);
  const semMenusRef = useRef(semMenus);
  semMenusRef.current = semMenus;
  const [digitando, setDigitando] = useState(false);
  const [notas, setNotas] = useState(false);
  const [selecao, setSelecao] = useState<{ x: number; y: number } | null>(null);
  const parouDeDigitar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const palavrasNaFolha = useRef(cena.palavras);
  const topoRef = useRef<HTMLElement>(null);
  const [alturaTopo, setAlturaTopo] = useState(56);
  useEffect(() => {
    const el = topoRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setAlturaTopo(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- gravar ----------
  const gravarAgora = (): Promise<void> => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    fila.current = fila.current.then(async () => {
      const texto = pendente.current;
      if (texto === null) return;
      pendente.current = null;
      emVoo.current = texto;
      try {
        const feito = await s.escrita.gravarTextoSobre(id, texto, base.current);
        base.current = texto;
        emVoo.current = null;
        if (feito.outro) avisar(t('writer.escrever.outra-aba'));
        if (pendente.current === null) {
          setGravacao('salvo');
          // gravou tudo: o rascunho de emergência (se a aba chegou a se esconder) não serve mais
          esquecerRascunho(id);
        } else setGravacao('gravando');
        pulsar();
      } catch (e) {
        emVoo.current = null;
        // não gravou: o texto continua esperando (vai de novo na próxima pausa, ou para o rascunho)
        pendente.current ??= texto;
        setGravacao('erro');
        avisar(textoDoErro((e as { codigo?: string }).codigo ?? 'servidor'), 'erro');
      }
    });
    return fila.current;
  };
  /** Guarda na hora (síncrono) o que ainda não foi gravado. `false` = havia texto e não coube. */
  const guardarJa = (): boolean => {
    const texto = pendente.current ?? emVoo.current;
    if (texto === null) return true;
    return guardarRascunho({ dono: s.dono, cena: id, texto, base: resumo(base.current), quando: Date.now() });
  };
  const guardarJaRef = useRef(guardarJa);
  guardarJaRef.current = guardarJa;
  /** Ao sair da cena: grava o que falta e guarda uma versão no histórico (uma vez só). */
  const sair = async (): Promise<void> => {
    await gravarRef.current();
    if (saiu.current) return;
    saiu.current = true;
    await s.escrita.sairDaCena(id).catch(() => undefined);
  };
  const gravarRef = useRef(gravarAgora);
  gravarRef.current = gravarAgora;

  const novaCena = async () => {
    await gravarRef.current();
    try {
      const nova = await s.escrita.criarCena(cena.historia, { titulo: t('writer.cena.nova'), capitulo: cena.capitulo }, { depoisDe: id });
      ir({ tela: 'escrever', id: nova.id });
    } catch (e) {
      avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');
    }
  };
  const novaCenaRef = useRef(novaCena);
  novaCenaRef.current = novaCena;

  // ---------- o editor ----------
  useEffect(() => {
    const pai = lugar.current;
    if (!pai) return;
    const ed = criarEditor({
      pai,
      texto: cena.texto,
      rotulo: t('writer.escrever.rotulo', { titulo: cena.titulo || t('writer.cena.sem-titulo') }),
      dica: t('writer.escrever.dica'),
      maquina,
      foco,
      aoMudar: (texto) => {
        pendente.current = texto;
        setGravacao('gravando');
        const n = contarPalavras(texto);
        palavrasNaFolha.current = n;
        setPalavras(n);
        setTopo(false);
        setDigitando(true);
        if (parouDeDigitar.current) clearTimeout(parouDeDigitar.current);
        parouDeDigitar.current = setTimeout(() => {
          setDigitando(false);
          // no toque não há Esc nem mouse no alto: o topo volta quando a pessoa para de digitar
          if (toque.current && !semMenusRef.current) setTopo(true);
        }, 1500);
        if (espera.current) clearTimeout(espera.current);
        espera.current = setTimeout(() => void gravarRef.current(), ESPERA_GRAVAR);
      },
      aoSair: () => void gravarRef.current(),
      aoSelecionar: (v: EditorView) => {
        const r = v.state.selection.main;
        if (r.empty || !v.hasFocus) {
          setSelecao(null);
          return;
        }
        const c = v.coordsAtPos(r.from);
        const caixa = pai.getBoundingClientRect();
        setSelecao(c ? { x: Math.max(8, Math.min(c.left - caixa.left, caixa.width - 200)), y: c.top - caixa.top + pai.scrollTop } : null);
      },
      aoIdeia: () => pedir('ideia'),
      aoNovaCena: () => void novaCenaRef.current(),
    });
    editor.current = ed;
    ed.view.focus();
    const sairDaJanela = () => void gravarRef.current();
    // a página vai sumir: o que falta vai para o rascunho na hora (o IndexedDB pode não dar tempo)
    const sumindo = () => {
      guardarJaRef.current();
      void gravarRef.current();
    };
    const escondida = () => {
      if (document.visibilityState === 'hidden') sumindo();
    };
    const fechando = (e: BeforeUnloadEvent) => {
      // só pergunta se o rascunho não coube (texto enorme, armazenamento cheio)
      if (!guardarJaRef.current()) {
        e.preventDefault();
        e.returnValue = true;
      }
      void gravarRef.current();
    };
    addEventListener('blur', sairDaJanela);
    addEventListener('pagehide', sumindo);
    addEventListener('beforeunload', fechando);
    document.addEventListener('visibilitychange', escondida);
    // a sessão vai fechar (saiu da conta, a sessão do servidor acabou): grava antes do armazém fechar
    const antesDeFechar = () => sair();
    const ja = () => void guardarJaRef.current();
    s.antesDeFechar.add(antesDeFechar);
    s.guardarJa.add(ja);
    // o texto que vem de fora (a nuvem, outra aba) entra na folha se não há nada por gravar aqui
    const parar = s.armazem.aoMudar((m) => {
      if (m.origem === 'local' || !m.ids.includes(id)) return;
      void s.escrita.cena(id).then(
        (c) => {
          if (pendente.current === null && emVoo.current === null && editor.current) {
            editor.current.trocarTexto(c.texto);
            base.current = c.texto;
            palavrasNaFolha.current = c.palavras;
            setPalavras(c.palavras);
          }
        },
        () => undefined,
      );
    });
    return () => {
      parar();
      s.antesDeFechar.delete(antesDeFechar);
      s.guardarJa.delete(ja);
      removeEventListener('blur', sairDaJanela);
      removeEventListener('pagehide', sumindo);
      removeEventListener('beforeunload', fechando);
      document.removeEventListener('visibilitychange', escondida);
      if (parouDeDigitar.current) clearTimeout(parouDeDigitar.current);
      // ao sair da cena: grava o que falta e guarda uma versão no histórico (com a sessão fechando,
      // `antesDeFechar` já fez isso). Se a sessão fechar logo depois, o armazém espera esta gravação
      // (`emCurso`); e o rascunho de emergência cobre o caso de ela não chegar ao fim.
      if (!s.fechando) {
        guardarJaRef.current();
        const fim: Promise<void> = sair().finally(() => s.emCurso.delete(fim));
        s.emCurso.add(fim);
      }
      ed.destruir();
      editor.current = null;
    };
  }, [id]);

  useEffect(() => editor.current?.modos({ maquina, foco }), [maquina, foco]);
  // ligou ou desligou o "sem menus": o topo e o rodapé somem ou voltam, e a pessoa continua no texto
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    setTopo(!semMenus);
    if (semMenus) editor.current?.view.focus();
  }, [semMenus]);

  // o mouse no alto da tela traz o topo de volta; no toque, tocar no alto da tela
  const alturaRef = useRef(alturaTopo);
  alturaRef.current = alturaTopo;
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      // o mouse numa borda (em cima ou embaixo) traz o topo e o rodapé de volta
      if (e.clientY < 48 || e.clientY > innerHeight - 40) return setTopo(true);
      // sem menus: longe das bordas, eles somem de novo (menos se o foco está dentro deles)
      if (semMenusRef.current && e.clientY > alturaRef.current + 24 && e.clientY < innerHeight - 64 && !topoRef.current?.contains(document.activeElement)) setTopo(false);
    };
    const tocar = (e: PointerEvent) => {
      toque.current = e.pointerType !== 'mouse';
      if (toque.current && (e.clientY < Math.max(48, alturaRef.current) || e.clientY > innerHeight - 48)) setTopo(true);
    };
    addEventListener('pointermove', mover);
    addEventListener('pointerdown', tocar, true);
    return () => {
      removeEventListener('pointermove', mover);
      removeEventListener('pointerdown', tocar, true);
    };
  }, []);

  const voltarAoTexto = () => editor.current?.view.focus();

  useComandos(() => [
    {
      id: 'topo',
      rotulo: t('writer.cmd.topo'),
      atalho: 'Escape',
      fazer: () => setTopo((v) => !v),
    },
    {
      id: 'sem-menus',
      rotulo: semMenus ? t('writer.cmd.sem-menus-desligar') : t('writer.cmd.sem-menus-ligar'),
      atalho: 'Alt+M',
      fazer: () => mudarPrefs({ semMenus: !semMenus }),
    },
    { id: 'nova-cena', rotulo: t('writer.cmd.nova-cena-abaixo'), atalho: 'Ctrl+Enter', fazer: () => void novaCena() },
    { id: 'notas', rotulo: t('writer.cmd.notas'), fazer: () => setNotas(true) },
    { id: 'historico', rotulo: t('writer.cmd.historico'), fazer: () => ir({ tela: 'historico', id }) },
    { id: 'voltar-historia', rotulo: t('writer.cmd.voltar-historia'), fazer: () => ir({ tela: 'historia', id: cena.historia }) },
    { id: 'modo-maquina', rotulo: maquina ? t('writer.cmd.maquina-desligar') : t('writer.cmd.maquina-ligar'), fazer: () => mudarPrefs({ maquina: !maquina }) },
    { id: 'modo-foco', rotulo: foco ? t('writer.cmd.foco-desligar') : t('writer.cmd.foco-ligar'), fazer: () => mudarPrefs({ foco: !foco }) },
    { id: 'voltar-texto', rotulo: t('writer.cmd.voltar-texto'), fazer: voltarAoTexto },
    { id: 'negrito', rotulo: t('writer.cmd.negrito'), fazer: () => editor.current && alternar(editor.current.view, '**') },
    { id: 'italico', rotulo: t('writer.cmd.italico'), fazer: () => editor.current && alternar(editor.current.view, '*') },
    { id: 'titulo-texto', rotulo: t('writer.cmd.titulo-texto'), fazer: () => editor.current && alternarTitulo(editor.current.view) },
  ]);

  const metaCena = cena.meta_palavras;
  const agora = useRelogio();
  const mostraTopo = topo && !camadaAberta();

  return (
    <div class={`folha-fundo${digitando ? ' digitando' : ''}${semMenus ? ' sem-menus' : ''}${semMenus && mostraTopo ? ' menus-vistos' : ''}`} data-teste="tela-escrever" style={{ '--letra-folha': `${letra}px`, '--altura-topo': `${alturaTopo}px` }}>
      <header ref={topoRef} class={`folha-topo${mostraTopo ? '' : ' escondido'}`} onFocusIn={() => setTopo(true)} data-teste="folha-topo">
        <div class="folha-topo-esq">
          <a class="ekf-icone" href={noApp('writer', `historia/${cena.historia}`)} title={t('writer.cmd.voltar-historia')} aria-label={t('writer.cmd.voltar-historia')} data-teste="voltar-historia">
            <IconeVoltar tamanho={16} />
          </a>
          <TituloDaCena cena={cena} />
        </div>
        <div class="folha-topo-dir">
          <button type="button" class="ekf-icone" title={t('writer.cmd.notas')} aria-label={t('writer.cmd.notas')} onClick={() => setNotas(true)} data-teste="abrir-notas">
            <IconeNotas tamanho={16} />
          </button>
          <a class="ekf-icone" href={noApp('writer', `historico/${id}`)} title={t('writer.cmd.historico')} aria-label={t('writer.cmd.historico')} data-teste="abrir-historico">
            <IconeRelogio tamanho={16} />
          </a>
          <button type="button" class="ekf-icone" title={t('writer.cmd.ideia')} aria-label={t('writer.cmd.ideia')} onClick={() => pedir('ideia')}>
            <IconeLampada tamanho={16} />
          </button>
          <button type="button" class="botao-modo" aria-pressed={maquina} onClick={() => mudarPrefs({ maquina: !maquina })} data-teste="modo-maquina">
            {t('writer.modo.maquina')}
          </button>
          <button type="button" class="botao-modo" aria-pressed={semMenus} onClick={() => mudarPrefs({ semMenus: !semMenus })} title={`${t('writer.cmd.sem-menus-ligar')} (Alt+M)`} data-teste="modo-sem-menus">
            {t('writer.modo.sem-menus')}
          </button>
          <button type="button" class="botao-modo" aria-pressed={foco} onClick={() => mudarPrefs({ foco: !foco })} data-teste="modo-foco">
            {t('writer.modo.foco')}
          </button>
          <button type="button" class="ekf-icone" title={t('writer.cmd.paleta')} aria-label={t('writer.cmd.paleta')} onClick={() => pedir('paleta')}>
            <IconeLupa tamanho={16} />
          </button>
          {/* no Writer OS os Ajustes moram no menu do sistema, e a conta também (a engrenagem é dele) */}
          {!noOS && (
            <button type="button" class="ekf-icone" title={t('writer.cmd.ajustes')} aria-label={t('writer.cmd.ajustes')} onClick={() => pedir('ajustes')}>
              <IconeEngrenagem tamanho={16} />
            </button>
          )}
          <AcoesTopo t={t} tr={tr} app="writer" entrar={!noOS} semConta={noOS} />
          {noOS && <BotaoSistema tamanho={16} />}
        </div>
      </header>

      <main class="folha" ref={lugar} data-teste="folha">
        {selecao && (
          <div class="menu-selecao" style={{ left: `${selecao.x}px`, top: `${Math.max(0, selecao.y - 48)}px` }} role="toolbar" aria-label={t('writer.selecao.rotulo')}>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current && alternar(editor.current.view, '**')} title={t('writer.cmd.negrito')}>
              <strong>{t('writer.selecao.negrito')}</strong>
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current && alternar(editor.current.view, '*')} title={t('writer.cmd.italico')}>
              <em>{t('writer.selecao.italico')}</em>
            </button>
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.current && alternarTitulo(editor.current.view)} title={t('writer.cmd.titulo-texto')}>
              {t('writer.selecao.titulo')}
            </button>
          </div>
        )}
      </main>

      <footer class="folha-rodape" onFocusIn={() => setTopo(true)} data-teste="folha-rodape">
        <span data-teste="palavras-cena">
          {t('writer.rodape.cena', { n: tr.numero(palavras) })}
          {metaCena > 0 && ` / ${tr.numero(metaCena)}`}
        </span>
        <span data-teste="palavras-dia">
          {t('writer.rodape.hoje', { n: tr.numero(palavrasDoDia) })}
          {metaDoDia > 0 && ` / ${tr.numero(metaDoDia)}`}
          {metaDoDia > 0 && palavrasDoDia >= metaDoDia && <span class="meta-ok"> {t('writer.rodape.meta-ok')}</span>}
        </span>
        <span class={`gravacao ${gravacao}`} data-teste="gravacao" data-estado={gravacao}>
          {t(`writer.gravacao.${gravacao}`)}
        </span>
        {soMemoria && <span class="selo-memoria">{t('writer.nuvem.selo-memoria')}</span>}
        <Nuvem />
        {/* no Writer OS a data e a hora ficam no canto das outras telas; aqui, no meio do rodapé (RelogioOS) */}
        {noOS ? (
          <RelogioOS embutido />
        ) : (
          <>
            <time class="relogio">{agora}</time>
            <NivelDeBateria />
          </>
        )}
      </footer>

      {notas && <NotasDaCena cena={cena} fechar={() => setNotas(false)} />}
    </div>
  );
}

function useRelogio(): string {
  const formatar = () => new Date().toLocaleTimeString(tr.idioma(), { hour: '2-digit', minute: '2-digit' });
  const [agora, setAgora] = useState(formatar);
  useEffect(() => {
    const i = setInterval(() => setAgora(formatar()), 15_000);
    return () => clearInterval(i);
  }, []);
  return agora;
}

function TituloDaCena({ cena }: { cena: Cena }) {
  const s = useSessao();
  const [local, setLocal] = useState(cena.titulo);
  const editando = useRef(false);
  useEffect(() => {
    if (!editando.current) setLocal(cena.titulo);
  }, [cena.titulo]);
  const gravar = () => {
    editando.current = false;
    const v = local.trim();
    if (v !== cena.titulo) void s.escrita.editarCena(cena.id, { titulo: v });
  };
  return (
    <input
      class="titulo-cena"
      value={local}
      placeholder={t('writer.cena.sem-titulo')}
      aria-label={t('writer.cena.titulo')}
      onInput={(e) => {
        editando.current = true;
        setLocal(e.currentTarget.value);
      }}
      onBlur={gravar}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          gravar();
          (document.querySelector('.cm-content') as HTMLElement | null)?.focus();
        }
      }}
      data-teste="titulo-cena"
    />
  );
}

/** As notas da cena (como no Persis): resumo, objetivo, conflito e desfecho, o status e a meta. */
function NotasDaCena({ cena, fechar }: { cena: Cena; fechar: () => void }) {
  const s = useSessao();
  const editar = (campo: 'resumo' | 'objetivo' | 'conflito' | 'desfecho') => (v: string) => s.escrita.editarCena(cena.id, { [campo]: v });
  return (
    <Camada tipo="gaveta" titulo={t('writer.notas.titulo')} fechar={fechar} teste="gaveta-notas">
      <div class="campo">
        <label>
          {t('writer.cena.status')}
          <SeletorStatus cena={cena} />
        </label>
      </div>
      <Campo rotulo={t('writer.notas.resumo')} valor={cena.resumo} tipo="area" gravar={editar('resumo')} focoInicial teste="nota-resumo" />
      <Campo rotulo={t('writer.notas.objetivo')} valor={cena.objetivo} tipo="area" gravar={editar('objetivo')} teste="nota-objetivo" />
      <Campo rotulo={t('writer.notas.conflito')} valor={cena.conflito} tipo="area" gravar={editar('conflito')} teste="nota-conflito" />
      <Campo rotulo={t('writer.notas.desfecho')} valor={cena.desfecho} tipo="area" gravar={editar('desfecho')} teste="nota-desfecho" />
      <Campo
        rotulo={t('writer.cena.meta')}
        valor={cena.meta_palavras}
        tipo="numero"
        dica={t('writer.meta.zero')}
        gravar={(v) => s.escrita.editarCena(cena.id, { meta_palavras: Math.max(0, Math.floor(Number(v) || 0)) })}
        teste="nota-meta"
      />
    </Camada>
  );
}
