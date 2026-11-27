// SPDX-License-Identifier: MPL-2.0

/**
 * As telas da conta com chaves (X2, `docs/ARQUITETURA.md` §5.2 e §5.6). Só desenham: a lógica é a do `chaves.ts`.
 *
 * - `mostrarSituacao(t, situacao, idioma)`: depois de entrar, criar conta ou redefinir a senha, a janela certa por cima
 *   de qualquer app (o kit quando a pessoa nasce, o cofre trancado depois do "esqueci a senha"). Ela mora numa raiz
 *   própria no `body`: o formulário que a chamou pode sumir na hora (a conta mudou), e a janela fica.
 * - `CofreTrancado`: abrir com o kit, com a cópia deste aparelho, pedindo a outro aparelho seu ou com chaves novas.
 * - `ChavesDaConta`: as seções de Minha conta (o cofre trancado, o kit de recuperação, "Seus aparelhos" com os pedidos).
 * - `avisarSeRedefinida(t)` (X2c-4): num aparelho da pessoa que ficou sem sessão porque a senha foi redefinida pelo
 *   e-mail, o aviso "Não foi você?" com cancelar a redefinição e tirar aparelhos, pelo pedido assinado (sem senha).
 *
 * Nenhum texto aqui: as chaves são `nucleo.chaves.*` e `nucleo.kit.*`.
 */
import { render, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  abrirComCopia,
  abrirComKit,
  aoMudarChaves,
  aprovarPedido,
  cancelarRedefinicao,
  comecarPessoaNova,
  estadoDasChaves,
  listarAparelhos,
  listarPedidos,
  pedirAoOutroAparelho,
  precisaDaSenha,
  recusarPedido,
  revogar,
  temAparelhoGuardado,
  temCopiaDesteAparelho,
  tirarAparelho,
  verAvisoDoAparelho,
  verChaves,
  verKit,
  type Aparelho,
  type AparelhoDoAviso,
  type AvisoDoAparelho,
  type EstadoDasChaves,
  type KitParaMostrar,
  type PedidoAberto,
  type PedidoAoOutroAparelho,
  type Situacao,
} from './chaves.ts';
import { BarraDaSenha, textoDoErro } from './Conta.tsx';
import { Janela } from './Janela.tsx';
import { TelaDoKit } from './Kit.tsx';
import type { Resposta } from './ponte.ts';
import type { T } from './tipos.ts';

const idiomaDaTela = () => (typeof document === 'undefined' ? 'pt-BR' : document.documentElement.lang || 'pt-BR');

// ---------- a janela por cima de qualquer app ----------

let raiz: HTMLDivElement | null = null;

/** A janela da conta, presa: o foco não sai dela enquanto está aberta (o app atrás pode trocar de tela). */
function JanelaPresa({ titulo, t, fechar, children }: { titulo: string; t: T; fechar: () => void; children: ComponentChildren }) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prender = (e: FocusEvent) => {
      const c = caixa.current;
      if (!c || !(e.target instanceof Node) || c.contains(e.target)) return;
      c.querySelector<HTMLElement>('input, textarea, button:not(.ekf-fechar), a[href]')?.focus();
    };
    document.addEventListener('focusin', prender);
    return () => document.removeEventListener('focusin', prender);
  }, []);
  return (
    <div ref={caixa} class="ekf-camada-chaves">
      <Janela titulo={titulo} t={t} fechar={fechar}>
        {children}
      </Janela>
    </div>
  );
}

/**
 * Abre uma janela da conta numa raiz própria. Espera o formulário que a chamou terminar (ele pode estar numa janela
 * que fecha ao entrar e devolveria o foco para trás).
 */
function abrirJanela(t: T, titulo: string, conteudo: (fechar: () => void) => VNode): void {
  if (typeof document === 'undefined') return;
  setTimeout(() => {
    if (!raiz) {
      raiz = document.createElement('div');
      raiz.setAttribute('data-ekf', 'chaves');
      document.body.append(raiz);
    }
    const onde = raiz;
    const fechar = () => render(null, onde);
    render(null, onde);
    render(
      <JanelaPresa titulo={titulo} t={t} fechar={fechar}>
        {conteudo(fechar)}
      </JanelaPresa>,
      onde,
    );
  }, 0);
}

/** O kit na janela; ao conferir, uma linha de "pronto". */
function KitNaJanela({ t, kit, fechar }: { t: T; kit: KitParaMostrar; fechar: () => void }) {
  const [conferido, setConferido] = useState(false);
  if (conferido) return <Pronto t={t} texto={t('nucleo.kit.conferido')} fechar={fechar} />;
  return <TelaDoKit t={t} kit={kit} semTitulo aoTerminar={(ok) => (ok ? setConferido(true) : fechar())} />;
}

/** Põe o foco no elemento quando `quando` fica verdadeiro (o campo que acabou de aparecer). */
function useFoco<E extends HTMLElement>(quando: boolean) {
  const ref = useRef<E>(null);
  useEffect(() => {
    if (quando) ref.current?.focus();
  }, [quando]);
  return ref;
}

function Pronto({ t, texto, fechar }: { t: T; texto: string; fechar: () => void }) {
  const botao = useFoco<HTMLButtonElement>(true);
  return (
    <div class="ekf-form">
      <p class="ekf-ok" role="status">
        {texto}
      </p>
      <div class="ekf-linha">
        <button type="button" class="ekf-botao principal" onClick={fechar} ref={botao}>
          {t('nucleo.fechar')}
        </button>
      </div>
    </div>
  );
}

/** Mostra o kit numa janela por cima (a pessoa nasceu agora: criar conta, o cadastro pelo e-mail, a pessoa nova). */
export function mostrarKit(t: T, kit: KitParaMostrar): void {
  abrirJanela(t, t('nucleo.kit.titulo'), (fechar) => <KitNaJanela t={t} kit={kit} fechar={fechar} />);
}

/**
 * Depois de entrar, criar conta ou redefinir a senha: a janela que a `situacao` pede (o kit, o cofre trancado), ou
 * nada (tudo aberto, a conta de antes).
 */
export function mostrarSituacao(t: T, s: Situacao, idioma: string = idiomaDaTela()): void {
  if (s.tipo === 'aberto' && s.kit) mostrarKit(t, s.kit);
  else if (s.tipo === 'trancado')
    abrirJanela(t, t('nucleo.chaves.trancado.titulo'), (fechar) => <CofreTrancado t={t} idioma={idioma} temCopia={s.temCopia} aoAbrir={() => undefined} fechar={fechar} />);
}

// ---------- o cofre trancado ----------

type PassoDoCofre = 'escolher' | 'kit' | 'outro' | 'nova' | 'kit-novo' | 'aberto';

/**
 * O cofre trancado (a senha foi refeita pelo e-mail): as quatro saídas. `fechar` = está numa janela ("Agora não" e o
 * "Fechar" do fim); sem ele, é uma seção de Minha conta. `aoAbrir` é chamado quando destrancou.
 */
export function CofreTrancado({ t, idioma, temCopia, aoAbrir, fechar }: { t: T; idioma: string; temCopia: boolean; aoAbrir: () => void; fechar?: () => void }) {
  const [passo, setPasso] = useState<PassoDoCofre>('escolher');
  const [senha, setSenha] = useState('');
  const [palavras, setPalavras] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [pedido, setPedido] = useState<PedidoAoOutroAparelho | null>(null);
  const [kitNovo, setKitNovo] = useState<KitParaMostrar | null>(null);
  // a senha só se a página recarregou (a memória esqueceu as chaves dela)
  const [pedeSenha] = useState(() => precisaDaSenha());
  const vivo = useRef(true);
  const esperando = useRef<PedidoAoOutroAparelho | null>(null);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      esperando.current?.cancelar(); // a tela fechou: para de esperar o outro aparelho
    };
  }, []);

  const ir = (p: PassoDoCofre) => {
    setErro('');
    setPasso(p);
  };

  /** Roda uma das saídas: a barra enquanto a senha é protegida, o erro em texto, o passo seguinte. */
  async function tentar<R extends Resposta<object>>(
    f: (s: string | undefined, o: { idioma: string; aoProgredir: (x: number) => void }) => Promise<R>,
    depois: (r: Extract<R, { ok: true }>) => void,
  ) {
    if (pedeSenha && !senha) return setErro(textoDoErro(t, 'senha_atual'));
    setErro('');
    setOcupado(true);
    const r = await f(pedeSenha ? senha : undefined, { idioma, aoProgredir: setProgresso });
    if (!vivo.current) return;
    setOcupado(false);
    setProgresso(null);
    if (r.ok) depois(r as Extract<R, { ok: true }>);
    else setErro(textoDoErro(t, r.erro, r));
  }

  const abriu = () => {
    setPasso('aberto');
    aoAbrir();
  };

  async function pedirAoOutro() {
    await tentar(
      (s, o) => pedirAoOutroAparelho(s, o),
      async (r) => {
        esperando.current = r.pedido;
        setPedido(r.pedido);
        setPasso('outro');
        const e = await r.pedido.esperar();
        esperando.current = null;
        if (!vivo.current) return;
        setPedido(null);
        if (e.ok) abriu();
        else {
          setPasso('escolher');
          if (e.erro !== 'cancelado') setErro(textoDoErro(t, e.erro, e));
        }
      },
    );
  }

  if (passo === 'aberto') {
    return fechar ? (
      <Pronto t={t} texto={t('nucleo.chaves.aberto')} fechar={fechar} />
    ) : (
      <p class="ekf-ok" role="status">
        {t('nucleo.chaves.aberto')}
      </p>
    );
  }
  if (passo === 'kit-novo' && kitNovo) {
    return (
      <TelaDoKit
        t={t}
        kit={kitNovo}
        semTitulo={Boolean(fechar)}
        aoTerminar={() => {
          setKitNovo(null);
          abriu();
        }}
      />
    );
  }

  const campoDaSenha = pedeSenha && passo !== 'outro' && (
    <label class="ekf-campo">
      <span>{t('nucleo.chaves.trancado.senha')}</span>
      <input type="password" autoComplete="current-password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} />
      <small>{t('nucleo.chaves.trancado.senha.dica')}</small>
    </label>
  );
  const rodape = (
    <>
      <BarraDaSenha t={t} fracao={progresso} />
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </>
  );
  const voltar = (
    <button type="button" class="ekf-botao" onClick={() => ir('escolher')} disabled={ocupado}>
      {t('nucleo.chaves.voltar')}
    </button>
  );

  if (passo === 'kit') {
    return (
      <form
        class="ekf-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void tentar((s, o) => abrirComKit(palavras, s, o), abriu);
        }}
      >
        {campoDaSenha}
        <label class="ekf-campo">
          <span>{t('nucleo.chaves.trancado.kit.campo')}</span>
          <textarea rows={4} autoComplete="off" autoCapitalize="none" spellcheck={false} value={palavras} onInput={(e) => setPalavras(e.currentTarget.value)} />
          <small>{t('nucleo.chaves.trancado.kit.dica')}</small>
        </label>
        {rodape}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
            {t('nucleo.chaves.trancado.kit.botao')}
          </button>
          {voltar}
        </div>
      </form>
    );
  }

  if (passo === 'outro' && pedido) {
    return (
      <div class="ekf-form" aria-live="polite">
        <p>{t('nucleo.chaves.trancado.outro.codigo')}</p>
        <p class="ekf-codigo" aria-label={pedido.codigo.split('').join(' ')}>
          {pedido.codigo}
        </p>
        <p class="ekf-dica" role="status">
          {t('nucleo.chaves.trancado.outro.esperando')}
        </p>
        <div class="ekf-linha">
          <button type="button" class="ekf-botao" onClick={() => pedido.cancelar()}>
            {t('nucleo.chaves.cancelar')}
          </button>
        </div>
      </div>
    );
  }

  if (passo === 'nova') {
    return (
      <form
        class="ekf-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void tentar(
            (s, o) => comecarPessoaNova(s, o),
            (r) => {
              setKitNovo(r.kit);
              setPasso('kit-novo');
            },
          );
        }}
      >
        <p class="ekf-aviso">{t('nucleo.chaves.trancado.nova.aviso')}</p>
        {campoDaSenha}
        {rodape}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
            {t('nucleo.chaves.trancado.nova.botao')}
          </button>
          {voltar}
        </div>
      </form>
    );
  }

  // escolher; M1c: durante a espera, só o kit (as outras saídas voltam na data)
  const ate = estadoDasChaves()?.esperaAte ?? null;
  const naEspera = ate !== null && ate > Date.now();
  return (
    <div class="ekf-form">
      <p>{t('nucleo.chaves.trancado.explicacao')}</p>
      {naEspera && <p class="ekf-aviso">{t('nucleo.chaves.trancado.espera', { data: quando(idioma, ate, true) })}</p>}
      {campoDaSenha}
      <ul class="ekf-saidas">
        <li>
          <button type="button" class="ekf-botao principal" onClick={() => ir('kit')} disabled={ocupado}>
            {t('nucleo.chaves.trancado.kit')}
          </button>
          <small>{t('nucleo.chaves.trancado.kit.explica')}</small>
        </li>
        {temCopia && (
          <li>
            <button type="button" class="ekf-botao" disabled={ocupado || naEspera} aria-busy={ocupado} onClick={() => void tentar((s, o) => abrirComCopia(s, o), abriu)}>
              {t('nucleo.chaves.trancado.copia')}
            </button>
            <small>{t('nucleo.chaves.trancado.copia.dica')}</small>
          </li>
        )}
        <li>
          <button type="button" class="ekf-botao" disabled={ocupado || naEspera} onClick={() => void pedirAoOutro()}>
            {t('nucleo.chaves.trancado.outro')}
          </button>
          <small>{t('nucleo.chaves.trancado.outro.dica')}</small>
        </li>
        <li>
          <button type="button" class="ekf-link" disabled={ocupado || naEspera} onClick={() => ir('nova')}>
            {t('nucleo.chaves.trancado.nova')}
          </button>
        </li>
      </ul>
      {rodape}
      {fechar && (
        <div class="ekf-linha">
          <button type="button" class="ekf-link" onClick={fechar}>
            {t('nucleo.chaves.depois')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Minha conta: o kit de recuperação ----------

function KitDeRecuperacao({ t, idioma, estado, classe }: { t: T; idioma: string; estado: EstadoDasChaves; classe: string }) {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [kit, setKit] = useState<KitParaMostrar | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [conferido, setConferido] = useState(false);
  const campo = useFoco<HTMLInputElement>(aberto && !kit);
  const fechar = () => {
    setAberto(false);
    setKit(null);
    setSenha('');
    setErro('');
  };
  return (
    <section class={classe} data-ekf-secao="kit">
      <h2>{t('nucleo.chaves.kit.titulo')}</h2>
      <div class="ekf-secao">
        {estado.kit_conferido || conferido ? <p class="ekf-dica">{t('nucleo.chaves.kit.texto')}</p> : <p class="ekf-aviso">{t('nucleo.chaves.kit.lembrete')}</p>}
        {conferido && (
          <p class="ekf-ok" role="status">
            {t('nucleo.kit.conferido')}
          </p>
        )}
        {kit ? (
          <TelaDoKit
            t={t}
            kit={kit}
            semTitulo
            aoTerminar={(ok) => {
              setConferido(ok);
              fechar();
            }}
          />
        ) : !aberto ? (
          <div class="ekf-linha">
            <button type="button" class="ekf-botao" onClick={() => (setAberto(true), setConferido(false))}>
              {t('nucleo.chaves.kit.ver')}
            </button>
          </div>
        ) : (
          <form
            class="ekf-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!senha) return setErro(textoDoErro(t, 'senha_atual'));
              setErro('');
              setOcupado(true);
              const r = await verKit(senha, { idioma, aoProgredir: setProgresso });
              setOcupado(false);
              setProgresso(null);
              setSenha('');
              if (r.ok) setKit(r.kit);
              else setErro(textoDoErro(t, r.erro, r));
            }}
          >
            <label class="ekf-campo">
              <span>{t('nucleo.chaves.kit.senha')}</span>
              <input type="password" autoComplete="current-password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campo} />
            </label>
            <BarraDaSenha t={t} fracao={progresso} />
            {erro && (
              <p class="ekf-erro" role="alert">
                {erro}
              </p>
            )}
            <div class="ekf-linha">
              <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
                {t('nucleo.chaves.kit.mostrar')}
              </button>
              <button type="button" class="ekf-botao" onClick={fechar} disabled={ocupado}>
                {t('nucleo.chaves.cancelar')}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ---------- Minha conta: seus aparelhos ----------

/** A data do banco da ponte (`AAAA-MM-DD hh:mm:ss`, no fuso de Brasília) ou em milissegundos, para ler. */
function quando(idioma: string, d: string | number | null, comHora = false): string {
  if (d === null || d === '') return '';
  const x = typeof d === 'number' ? new Date(d) : new Date(`${d.replace(' ', 'T')}-03:00`);
  if (Number.isNaN(x.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(idioma, comHora ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(x);
  } catch {
    return x.toLocaleDateString();
  }
}

function Pedido({ t, idioma, p, aoResolver }: { t: T; idioma: string; p: PedidoAberto; aoResolver: (aviso: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [codigo, setCodigo] = useState('');
  const agir = async (aprovar: boolean) => {
    setOcupado(true);
    setErro('');
    const r = aprovar ? await aprovarPedido(p, codigo) : await recusarPedido(p.id);
    setOcupado(false);
    if (r.ok) aoResolver(t(aprovar ? 'nucleo.chaves.pedido.aprovado' : 'nucleo.chaves.pedido.recusado'));
    else if (r.erro === 'codigo_recusado') aoResolver(t('nucleo.conta.erro.codigo_recusado'));
    else if (r.erro === 'codigo_errado') {
      setCodigo('');
      setErro(t('nucleo.conta.erro.codigo_errado', { restam: Number((r as { restam?: number }).restam ?? 1) }));
    } else setErro(textoDoErro(t, r.erro, r));
  };
  const id = `ekf-pedido-${p.id}`;
  return (
    <li class="ekf-pedido">
      <strong>{t('nucleo.chaves.pedido.titulo')}</strong>
      <span>{t('nucleo.chaves.pedido.texto', { nome: p.nome, quando: quando(idioma, p.criadoEm, true) })}</span>
      <form
        class="ekf-pedido-form"
        onSubmit={(e) => {
          e.preventDefault();
          void agir(true);
        }}
      >
        <label class="ekf-campo" for={id}>
          <span>{t('nucleo.chaves.pedido.digite')}</span>
          <input
            id={id}
            class="ekf-codigo-campo"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            pattern="[0-9 ]*"
            value={codigo}
            onInput={(e) => setCodigo(e.currentTarget.value)}
          />
        </label>
        {erro && (
          <span class="ekf-erro" role="alert">
            {erro}
          </span>
        )}
        <span class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado || codigo.replace(/\D/g, '').length !== 6} aria-busy={ocupado}>
            {t('nucleo.chaves.pedido.aprovar')}
          </button>
          <button type="button" class="ekf-botao" disabled={ocupado} onClick={() => void agir(false)}>
            {t('nucleo.chaves.pedido.recusar')}
          </button>
        </span>
      </form>
    </li>
  );
}

/**
 * "Tirar" sem a senha (X2c-4, com o cofre trancado): pergunta antes; o aparelho deste navegador assina o pedido. O
 * tirado perde as chaves e sai agora; sai de vez (a revogação) quando o cofre abrir.
 */
function TirarSemSenha({ t, nome, endereco, aoTirar }: { t: T; nome: string; endereco: string; aoTirar: (nome: string) => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const sim = useFoco<HTMLButtonElement>(confirmando);
  if (!confirmando) {
    return (
      <span class="ekf-linha">
        <button type="button" class="ekf-botao" onClick={() => setConfirmando(true)}>
          {t('nucleo.chaves.aparelhos.tirar')}
        </button>
      </span>
    );
  }
  return (
    <div class="ekf-form">
      <p>{t('nucleo.chaves.aparelhos.tirar.confirmar', { nome })}</p>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="ekf-linha">
        <button
          type="button"
          class="ekf-botao principal"
          ref={sim}
          disabled={ocupado}
          aria-busy={ocupado}
          onClick={async () => {
            setOcupado(true);
            setErro('');
            const r = await tirarAparelho(endereco);
            setOcupado(false);
            if (r.ok) aoTirar(nome);
            else setErro(textoDoErro(t, r.erro, r));
          }}
        >
          {t('nucleo.chaves.aparelhos.tirar.sim')}
        </button>
        <button type="button" class="ekf-botao" disabled={ocupado} onClick={() => (setConfirmando(false), setErro(''))}>
          {t('nucleo.chaves.cancelar')}
        </button>
      </div>
    </div>
  );
}

function LinhaDoAparelho({ t, idioma, a, trancado, aoTirar }: { t: T; idioma: string; a: Aparelho; trancado: boolean; aoTirar: (nome: string) => void }) {
  const [tirando, setTirando] = useState(false);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const campo = useFoco<HTMLInputElement>(tirando);
  const nome = a.nome || t('nucleo.chaves.aparelhos.sem_nome');
  return (
    <li class="ekf-aparelho" data-este={a.este ? 'sim' : undefined}>
      <span class="ekf-aparelho-nome">
        <strong>{nome}</strong>
        {a.este && <span class="ekf-etiqueta">{t('nucleo.chaves.aparelhos.este')}</span>}
        {a.tirado && <span class="ekf-etiqueta">{t('nucleo.chaves.aparelhos.tirado_etiqueta')}</span>}
      </span>
      <small>
        {[a.criado ? t('nucleo.chaves.aparelhos.desde', { data: quando(idioma, a.criado) }) : '', a.vistoEm ? t('nucleo.chaves.aparelhos.visto', { data: quando(idioma, a.vistoEm, true) }) : '']
          .filter(Boolean)
          .join(' · ')}
      </small>
      {!a.confere && <small class="ekf-alerta">{t('nucleo.chaves.aparelhos.nao_confere')}</small>}
      {!a.este && trancado && !a.tirado && <TirarSemSenha t={t} nome={nome} endereco={a.endereco} aoTirar={aoTirar} />}
      {!a.este &&
        !trancado &&
        (!tirando ? (
          <span class="ekf-linha">
            <button type="button" class="ekf-botao" onClick={() => setTirando(true)}>
              {t('nucleo.chaves.aparelhos.tirar')}
            </button>
          </span>
        ) : (
          <form
            class="ekf-form"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!senha) return setErro(textoDoErro(t, 'senha_atual'));
              setErro('');
              setOcupado(true);
              const r = await revogar(a.endereco, senha, { idioma, aoProgredir: setProgresso });
              setOcupado(false);
              setProgresso(null);
              setSenha('');
              if (r.ok) aoTirar(nome);
              else setErro(textoDoErro(t, r.erro, r));
            }}
          >
            <label class="ekf-campo">
              <span>{t('nucleo.chaves.aparelhos.tirar.senha', { nome })}</span>
              <input type="password" autoComplete="current-password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campo} />
              <small>{t('nucleo.chaves.aparelhos.tirar.dica')}</small>
            </label>
            <BarraDaSenha t={t} fracao={progresso} />
            {erro && (
              <p class="ekf-erro" role="alert">
                {erro}
              </p>
            )}
            <div class="ekf-linha">
              <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
                {t('nucleo.chaves.aparelhos.tirar')}
              </button>
              <button type="button" class="ekf-botao" disabled={ocupado} onClick={() => (setTirando(false), setSenha(''), setErro(''))}>
                {t('nucleo.chaves.cancelar')}
              </button>
            </div>
          </form>
        ))}
    </li>
  );
}

/** De quanto em quanto tempo "Seus aparelhos" olha se um aparelho novo pediu (só com a página à vista). */
const OLHAR_PEDIDOS = 5000;

/**
 * `olhar` = olhar os pedidos a cada pouco: só com o cofre trancado (um aparelho novo só pede quando a senha foi refeita pelo
 * e-mail); senão, uma vez ao abrir.
 */
function SeusAparelhos({ t, idioma, classe, olhar }: { t: T; idioma: string; classe: string; olhar: boolean }) {
  const [aparelhos, setAparelhos] = useState<Aparelho[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoAberto[]>([]);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const vivo = useRef(true);

  async function ler() {
    const [l, p] = await Promise.all([listarAparelhos(), listarPedidos()]);
    if (!vivo.current) return;
    if (l.ok) {
      // este aparelho primeiro; os outros na ordem da ponte (o usado por último antes)
      setAparelhos(l.aparelhos.filter((a) => !a.revogado).sort((a, b) => Number(b.este) - Number(a.este)));
      setErro('');
    } else setErro(textoDoErro(t, l.erro, l));
    if (p.ok) setPedidos(p.pedidos);
  }
  useEffect(() => {
    vivo.current = true;
    void ler();
    return () => {
      vivo.current = false;
    };
  }, []);
  useEffect(() => {
    if (!olhar) return;
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void listarPedidos().then((p) => vivo.current && p.ok && setPedidos(p.pedidos));
    }, OLHAR_PEDIDOS);
    return () => clearInterval(id);
  }, [olhar]);

  const resolvido = (texto: string) => {
    setAviso(texto);
    void ler();
  };
  const semEste = aparelhos !== null && aparelhos.length > 0 && !aparelhos.some((a) => a.este);

  return (
    <section class={classe} data-ekf-secao="aparelhos">
      <h2>{t('nucleo.chaves.aparelhos.titulo')}</h2>
      <div class="ekf-secao">
        <p class="ekf-dica">{t('nucleo.chaves.aparelhos.texto')}</p>
        {pedidos.length > 0 && (
          <ul class="ekf-lista-chaves" aria-live="polite">
            {pedidos.map((p) => (
              <Pedido key={p.id} t={t} idioma={idioma} p={p} aoResolver={resolvido} />
            ))}
          </ul>
        )}
        {aviso && (
          <p class="ekf-ok" role="status">
            {aviso}
          </p>
        )}
        {erro && (
          <p class="ekf-erro" role="alert">
            {erro}
          </p>
        )}
        {aparelhos === null && !erro ? (
          <p class="ekf-dica">{t('nucleo.carregando')}</p>
        ) : aparelhos && aparelhos.length === 0 ? (
          <p class="ekf-dica">{t('nucleo.chaves.aparelhos.vazio')}</p>
        ) : (
          <ul class="ekf-lista-chaves">
            {(aparelhos ?? []).map((a) => (
              <LinhaDoAparelho key={a.endereco} t={t} idioma={idioma} a={a} trancado={olhar} aoTirar={(nome) => resolvido(t('nucleo.chaves.aparelhos.tirado', { nome }))} />
            ))}
          </ul>
        )}
        {semEste && <p class="ekf-dica">{t('nucleo.chaves.aparelhos.este_fora')}</p>}
      </div>
    </section>
  );
}

// ---------- Minha conta: tudo junto ----------

/**
 * As seções das chaves em Minha conta (o castelo, o Vernákula): o cofre trancado (se estiver), o kit de recuperação
 * (com o lembrete leve enquanto não foi conferido) e "Seus aparelhos" (com os pedidos de aparelhos novos).
 * `classe` = a classe das seções no app (cada app tem o seu painel).
 */
export function ChavesDaConta({ t, idioma, classe = 'ekf-secao' }: { t: T; idioma: string; classe?: string }) {
  const [estado, setEstado] = useState<EstadoDasChaves | null>(() => estadoDasChaves());
  // o cofre fica na tela até a pessoa terminar (a pessoa nova ainda mostra o kit depois de destrancar)
  const [comCofre, setComCofre] = useState(false);
  const [abriu, setAbriu] = useState(false);
  useEffect(() => {
    const parar = aoMudarChaves(() => setEstado(estadoDasChaves()));
    void verChaves().then((r) => r.ok && setEstado(r.chaves));
    return parar;
  }, []);
  useEffect(() => {
    if (estado?.trancado) setComCofre(true);
  }, [estado?.trancado]);
  if (!estado) return null; // carregando, ou a ponte não sabe das chaves (um servidor de antes)
  if (estado.antiga) {
    return (
      <section class={classe} data-ekf-secao="antiga">
        <h2>{t('nucleo.chaves.kit.titulo')}</h2>
        <p class="ekf-dica">{t('nucleo.chaves.antiga')}</p>
      </section>
    );
  }
  return (
    <>
      {comCofre ? (
        <section class={classe} data-ekf-secao="trancado">
          <h2>{t('nucleo.chaves.trancado.titulo')}</h2>
          <CofreTrancado
            t={t}
            idioma={idioma}
            temCopia={temCopiaDesteAparelho()}
            aoAbrir={() => {
              setComCofre(false);
              setAbriu(true);
            }}
          />
        </section>
      ) : (
        <>
          {abriu && (
            <p class="ekf-ok" role="status">
              {t('nucleo.chaves.aberto')}
            </p>
          )}
          <KitDeRecuperacao t={t} idioma={idioma} estado={estado} classe={classe} />
        </>
      )}
      <SeusAparelhos t={t} idioma={idioma} classe={classe} olhar={estado.trancado} />
    </>
  );
}

// ---------- o aviso da senha redefinida, num aparelho da pessoa sem sessão (X2c-4) ----------

const AVISO_VISTO = 'ekfrase.aviso-redefinida';
let avisoOlhado = false;

function avisoJaVisto(em: number): boolean {
  try {
    return localStorage.getItem(AVISO_VISTO) === String(em);
  } catch {
    return false;
  }
}

function marcarAvisoVisto(em: number): void {
  try {
    localStorage.setItem(AVISO_VISTO, String(em));
  } catch {
    // navegador que barra o armazenamento: o aviso volta na próxima vez
  }
}

/**
 * Quem não entrou, num navegador que guarda as chaves de um aparelho (a sessão caiu porque a senha foi redefinida
 * pelo e-mail): pergunta à ponte pelo pedido assinado e, se a conta está trancada pela redefinição, mostra o aviso
 * "Não foi você?". Uma vez por página; "Fui eu" não mostra de novo a mesma redefinição.
 */
export function avisarSeRedefinida(t: T, idioma: string = idiomaDaTela()): void {
  if (avisoOlhado || !temAparelhoGuardado()) return;
  avisoOlhado = true;
  void verAvisoDoAparelho().then((r) => {
    if (!r.ok) return;
    const a = r.aviso;
    const outros = a.aparelhos.filter((x) => !x.este && !x.tirado);
    if (!a.trancado || a.redefinidaEm === null || avisoJaVisto(a.redefinidaEm) || (!a.podeCancelar && outros.length === 0)) return;
    abrirJanela(t, t('nucleo.chaves.aviso.titulo'), (fechar) => <AvisoDaRedefinicao t={t} idioma={idioma} aviso={a} fechar={fechar} />);
  });
}

function AvisoDaRedefinicao({ t, idioma, aviso, fechar }: { t: T; idioma: string; aviso: AvisoDoAparelho; fechar: () => void }) {
  const [cancelada, setCancelada] = useState(false);
  const [aparelhos, setAparelhos] = useState<readonly AparelhoDoAviso[]>(aviso.aparelhos);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const primeiro = useFoco<HTMLButtonElement>(aviso.podeCancelar);
  const soFuiEu = useFoco<HTMLButtonElement>(!aviso.podeCancelar);
  if (cancelada) return <Pronto t={t} texto={t('nucleo.chaves.aviso.cancelada')} fechar={fechar} />;
  const outros = aparelhos.filter((a) => !a.este);
  const fuiEu = () => {
    if (aviso.redefinidaEm !== null) marcarAvisoVisto(aviso.redefinidaEm);
    fechar();
  };
  return (
    <div class="ekf-form" data-ekf="aviso-redefinida">
      <p>{t('nucleo.chaves.aviso.texto', { data: quando(idioma, aviso.redefinidaEm, true) })}</p>
      {aviso.esperaAte !== null && <p class="ekf-dica">{t('nucleo.chaves.aviso.espera', { data: quando(idioma, aviso.esperaAte, true) })}</p>}
      {aviso.podeCancelar && (
        <>
          <div class="ekf-linha">
            <button
              type="button"
              class="ekf-botao principal"
              ref={primeiro}
              disabled={ocupado}
              aria-busy={ocupado}
              onClick={async () => {
                setOcupado(true);
                setErro('');
                const r = await cancelarRedefinicao();
                setOcupado(false);
                if (r.ok) setCancelada(true);
                else setErro(textoDoErro(t, r.erro, r));
              }}
            >
              {t('nucleo.chaves.aviso.cancelar')}
            </button>
          </div>
          <small>{t('nucleo.chaves.aviso.cancelar.dica')}</small>
        </>
      )}
      {outros.length > 0 && (
        <>
          <h3>{t('nucleo.chaves.aviso.aparelhos')}</h3>
          <ul class="ekf-lista-chaves">
            {outros.map((a) => {
              const nome = a.nome || t('nucleo.chaves.aparelhos.sem_nome');
              return (
                <li key={a.endereco} class="ekf-aparelho">
                  <span class="ekf-aparelho-nome">
                    <strong>{nome}</strong>
                    {a.tirado && <span class="ekf-etiqueta">{t('nucleo.chaves.aparelhos.tirado_etiqueta')}</span>}
                  </span>
                  {a.vistoEm && <small>{t('nucleo.chaves.aparelhos.visto', { data: quando(idioma, a.vistoEm, true) })}</small>}
                  {!a.tirado && (
                    <TirarSemSenha
                      t={t}
                      nome={nome}
                      endereco={a.endereco}
                      aoTirar={(n) => {
                        setOk(t('nucleo.chaves.aparelhos.tirado', { nome: n }));
                        setAparelhos((l) => l.map((x) => (x.endereco === a.endereco ? { ...x, tirado: true } : x)));
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {ok && (
        <p class="ekf-ok" role="status">
          {ok}
        </p>
      )}
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="ekf-linha">
        <button type="button" class="ekf-link" onClick={fuiEu} ref={soFuiEu}>
          {t('nucleo.chaves.aviso.fui_eu')}
        </button>
      </div>
    </div>
  );
}
