// SPDX-License-Identifier: MPL-2.0

/**
 * As telas do WRITER OS (o pendrive, fase 3; PLANO §6.3, §6.4, §4.5). Só aparecem quando a casca
 * abriu dentro da imagem (`casca.os`); no computador e no site, nada disto existe.
 *
 * - `PortaoOS`: o primeiro uso, nesta ordem: idioma → teclado → fuso → onde guardar (só se não há a
 *   partição de dados) → senha → espelho `.md` → Wi-Fi ("pular") → o app (que mostra a conta, com
 *   "Escrever sem conta"). Nos usos seguintes: senha → app.
 * - `FaixaMemoria`: a faixa âmbar fixa quando os textos estão na memória (somem ao desligar).
 * - `PainelSistema` (Ctrl+Alt+S e o botão de ligar no topo): Wi-Fi, bateria, brilho, teclado, fuso,
 *   servidor, pendrives, desligar, reiniciar e "Sobre". Nada mais (§6.4).
 *
 * Toda tela tem `data-teste` (o agente de teste conta qual está aberta) e o foco começa na opção
 * padrão: Enter segue em frente (o CI digita pelo QMP do QEMU).
 */
import type { Bateria, DiscoUSB, PonteSistema, RedeWifi, RespostaCasca, SobreOS } from '@ekfrase/writer-nucleo';
import { FormConta, IconeEngrenagem, Janela, ponte, useConta } from '@ekfrase/interface';
import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconeLigar } from '../icones.tsx';
import { pedir } from '../pedidos.ts';
import { t, tr } from '../textos.ts';
import { Camada, avisar, confirmar, focaveis } from '../ui.tsx';
import { gravarAgora, mudarEstado, mudarEstadoOS, noOS, sistemaOS, useEstadoCasca, useEstadoOS } from './casca.ts';
import { EscolhaServidor, Moldura, PerguntaEspelho, Senha, textoDoErroCasca } from './Telas.tsx';

/** O sistema (só é usado com `noOS`; cada tela é desenhada só dentro do `PortaoOS`). */
const os = sistemaOS as PonteSistema;

const nomeDoFuso = (id: string): string => id.replace(/_/g, ' ').replace(/\//g, ' / ');

export const tamanho = (bytes: number): string => (bytes >= 1024 ** 3 ? `${tr.numero(Math.round(bytes / 1024 ** 3))} GB` : `${tr.numero(Math.max(1, Math.round(bytes / 1024 ** 2)))} MB`);

// ---------- o portão do Writer OS ----------

export function PortaoOS({ children }: { children: ComponentChildren }) {
  const estado = useEstadoCasca();
  const osEstado = useEstadoOS();
  const [escolhendo, setEscolhendo] = useState(false);
  if (!estado || !osEstado) return <div class="tela-cheia-carregando" aria-busy="true" />;
  if (!osEstado.idioma) return <EscolherIdioma />;
  if (!osEstado.teclado) return <EscolherTeclado />;
  if (!osEstado.fuso) return <EscolherFuso />;
  if (!estado.aberta) {
    // sem a partição de dados: outro pendrive, ou a memória (§4.5)
    if (!estado.destino || !estado.pasta || escolhendo) return <OndeGuardar motivo={osEstado.motivo} aoEscolher={() => setEscolhendo(false)} />;
    return (
      <Senha
        nova={!estado.temSenha}
        pasta={estado.pasta}
        aviso={t('writer.os.senha.aviso')}
        {...(estado.destino === 'pendrive' ? {} : { trocar: () => setEscolhendo(true) })}
      />
    );
  }
  if (estado.espelho === 'perguntar') return <PerguntaEspelho />;
  if (!osEstado.wifiVisto) return <WifiPrimeiroUso />;
  return (
    <>
      {estado.destino === 'ram' && <FaixaMemoria />}
      {children}
    </>
  );
}

/** Uma lista de escolhas: a atual (ou a primeira) começa com o foco; Enter escolhe. */
function Escolhas<T extends string>({ opcoes, atual, nome, escolher, teste, lang }: { opcoes: readonly T[]; atual: T | null; nome: (o: T) => string; escolher: (o: T) => void; teste: string; lang?: (o: T) => string }) {
  const padrao = atual && opcoes.includes(atual) ? atual : opcoes[0];
  return (
    <div class="acoes-coluna lista-os">
      {opcoes.map((o) => (
        <button
          key={o}
          type="button"
          class={o === padrao ? 'botao principal' : 'botao'}
          onClick={() => escolher(o)}
          {...(o === padrao ? { 'data-foco-inicial': true } : {})}
          {...(lang ? { lang: lang(o) } : {})}
          data-teste={`${teste}-${o}`}
        >
          {nome(o)}
        </button>
      ))}
    </div>
  );
}

function EscolherIdioma() {
  const idiomas = tr.idiomas();
  const escolher = async (codigo: string) => {
    tr.trocarIdioma(codigo);
    mudarEstadoOS(await os.usarIdioma(codigo));
  };
  return (
    <Moldura titulo={t('writer.os.idioma.titulo')} teste="os-idioma" foco="idioma">
      <p>{t('writer.os.boas-vindas')}</p>
      <Escolhas
        opcoes={idiomas.map((i) => i.codigo)}
        atual={tr.idioma()}
        nome={(c) => idiomas.find((i) => i.codigo === c)?.nome ?? c}
        lang={(c) => c}
        escolher={(c) => void escolher(c)}
        teste="os-idioma"
      />
    </Moldura>
  );
}

function EscolherTeclado() {
  const [lista, setLista] = useState<string[] | null>(null);
  const [reabrindo, setReabrindo] = useState(false);
  useEffect(() => void os.teclados().then(setLista), []);
  const escolher = async (id: string) => {
    const r = await os.usarTeclado(id);
    if (r.reabrindo) setReabrindo(true);
    else mudarEstadoOS(r.estado);
  };
  return (
    <Moldura titulo={t('writer.os.teclado.titulo')} teste="os-teclado" foco={lista ? 'teclado' : 'carregando'}>
      <p>{t('writer.os.teclado.texto')}</p>
      {reabrindo ? (
        <p role="status">{t('writer.os.teclado.reabrindo')}</p>
      ) : (
        lista && <Escolhas opcoes={lista} atual="br" nome={(id) => t(`writer.os.teclado.${id}`)} escolher={(id) => void escolher(id)} teste="os-teclado" />
      )}
    </Moldura>
  );
}

function EscolherFuso() {
  const [lista, setLista] = useState<string[] | null>(null);
  useEffect(() => void os.fusos().then(setLista), []);
  return (
    <Moldura titulo={t('writer.os.fuso.titulo')} teste="os-fuso" foco={lista ? 'fuso' : 'carregando'}>
      <p>{t('writer.os.fuso.texto')}</p>
      {lista && <Escolhas opcoes={lista} atual={null} nome={nomeDoFuso} escolher={(id) => void os.usarFuso(id).then(mudarEstadoOS)} teste="os-fuso" />}
    </Moldura>
  );
}

// ---------- onde guardar (sem a partição de dados) ----------

/**
 * Desliga (ou reinicia) o computador: pergunta, grava o que falta e pede ao sistema. É o que o botão
 * "Desligar" do topo e o do painel do sistema fazem (PLANO §6.5 item 2); `recado` mostra o "desligando…".
 */
export async function desligarOS(reiniciar: boolean, recado?: (texto: string) => void): Promise<void> {
  if (!(await confirmar(t(reiniciar ? 'writer.os.reiniciar.confirmar' : 'writer.os.desligar.confirmar'), t(reiniciar ? 'writer.os.reiniciar' : 'writer.os.desligar')))) return;
  recado?.(t('writer.os.desligando'));
  await gravarAgora();
  await (reiniciar ? os.reiniciar() : os.desligar());
}

/**
 * O botão do menu do sistema (só no Writer OS): a engrenagem no topo de todas as telas, no lugar do antigo botão
 * de ligar (pedido do Alcy em 18/11). Abre o `MenuSistema` (Ctrl+Alt+S também).
 */
export function BotaoSistema({ tamanho }: { tamanho?: number } = {}) {
  const nome = t('writer.os.menu.titulo');
  return (
    <button type="button" class="ekf-icone" title={`${nome} (Ctrl+Alt+S)`} aria-label={nome} aria-haspopup="menu" onClick={() => pedir('sistema')} data-teste="botao-sistema">
      <IconeEngrenagem {...(tamanho ? { tamanho } : {})} />
    </button>
  );
}

/** Entrar na conta Ekfrase pelo menu do sistema (no Writer OS não há o botão da conta no topo). */
export function EntrarOS({ fechar }: { fechar: () => void }) {
  return (
    <Janela titulo={t('nucleo.conta.titulo')} t={t} fechar={fechar}>
      <p>{t('nucleo.conta.ekfrase.explicacao')}</p>
      <FormConta t={t} app="ekfrase" idioma={document.documentElement.lang || 'pt-BR'} podeCriar aoEntrar={fechar} />
    </Janela>
  );
}

/** As teclas de brilho do notebook (a casca as lê, PLANO §6.4): um recado curto com o brilho novo. */
export function useAvisoDeBrilho(): void {
  useEffect(() => (noOS ? os.aoMudarBrilho((n) => avisar(t('writer.os.brilho.valor', { n }))) : undefined), []);
}

export function useDiscos(): [DiscoUSB[] | null, () => void] {
  const [discos, setDiscos] = useState<DiscoUSB[] | null>(null);
  const ler = () => void os.discos().then(setDiscos);
  useEffect(() => {
    ler();
    // um pendrive que chega agora aparece sozinho
    const i = setInterval(ler, 3000);
    return () => clearInterval(i);
  }, []);
  return [discos, ler];
}

function OndeGuardar({ motivo, aoEscolher }: { motivo: string | null; aoEscolher: () => void }) {
  const estado = useEstadoCasca();
  const [discos] = useDiscos();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const usar = async (f: () => Promise<RespostaCasca>) => {
    setOcupado(true);
    setErro(null);
    const r = await f();
    setOcupado(false);
    if (!r.ok) return setErro(r.erro === 'ja-tem' ? t('writer.os.onde.ja-tem') : textoDoErroCasca(r.erro));
    mudarEstado(r.estado);
    aoEscolher();
  };
  return (
    <Moldura titulo={t('writer.os.onde.titulo')} teste="os-onde-guardar" foco={discos?.length ?? -1}>
      <p>{t('writer.os.onde.texto')}</p>
      {motivo && <p class="dica">{t(`writer.os.onde.motivo.${motivo}`)}</p>}
      <div class="acoes-coluna">
        {(discos ?? []).map((d, i) => (
          <button
            key={d.id}
            type="button"
            class={i === 0 ? 'botao principal' : 'botao'}
            disabled={ocupado}
            onClick={() => void usar(() => os.guardarEm(d.id))}
            {...(i === 0 ? { 'data-foco-inicial': true } : {})}
            data-teste="os-guardar-disco"
          >
            {t(d.temWriter ? 'writer.os.onde.abrir-disco' : 'writer.os.onde.usar-disco', { nome: d.rotulo || d.nome || d.id, tamanho: tamanho(d.tamanho) })}
          </button>
        ))}
        {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
        <button
          type="button"
          class={discos?.length ? 'botao' : 'botao principal'}
          disabled={ocupado || estado?.destino === 'ram'}
          onClick={() => void usar(() => os.guardarNaMemoria())}
          {...(discos?.length ? {} : { 'data-foco-inicial': true })}
          data-teste="os-guardar-memoria"
        >
          {t('writer.os.onde.memoria')}
        </button>
        <small class="dica">{t('writer.os.onde.memoria.dica')}</small>
      </div>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </Moldura>
  );
}

/** A faixa âmbar: os textos estão só na memória. */
function FaixaMemoria() {
  const [abrir, setAbrir] = useState(false);
  return (
    <div class="faixa-memoria" role="status" data-teste="os-faixa-memoria">
      <span>{t('writer.os.memoria.faixa')}</span>
      <button type="button" class="botao pequeno" onClick={() => setAbrir(true)} data-teste="os-faixa-guardar">
        {t('writer.os.memoria.guardar')}
      </button>
      {abrir && (
        <Camada titulo={t('writer.os.onde.titulo')} fechar={() => setAbrir(false)} teste="os-levar-memoria">
          <LevarDaMemoria fechar={() => setAbrir(false)} />
        </Camada>
      )}
    </div>
  );
}

function LevarDaMemoria({ fechar }: { fechar: () => void }) {
  const [discos] = useDiscos();
  const [erro, setErro] = useState<string | null>(null);
  const levar = async (id: string) => {
    await gravarAgora();
    const r = await os.guardarEm(id);
    if (!r.ok) return setErro(r.erro === 'ja-tem' ? t('writer.os.onde.ja-tem') : textoDoErroCasca(r.erro));
    fechar();
    mudarEstado(r.estado);
  };
  return (
    <div class="acoes-coluna">
      <p>{t('writer.os.memoria.levar')}</p>
      {(discos ?? []).map((d) => (
        <button key={d.id} type="button" class="botao" onClick={() => void levar(d.id)} data-teste="os-levar-disco">
          {t('writer.os.onde.usar-disco', { nome: d.rotulo || d.nome || d.id, tamanho: tamanho(d.tamanho) })}
        </button>
      ))}
      {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

// ---------- Wi-Fi ----------

/** A lista de redes; `aoMudar` recebe a lista a cada leitura (o primeiro uso troca "Seguir" por "Concluir"). */
function ListaRedes({ aoMudar }: { aoMudar?: (redes: RedeWifi[]) => void } = {}) {
  const [redes, setRedes] = useState<RedeWifi[] | null>(null);
  const [escolhida, setEscolhida] = useState<RedeWifi | null>(null);
  const [senha, setSenha] = useState('');
  const [recado, setRecado] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // escolheu uma rede com senha: o foco vai para a senha (que fica ACIMA da lista: o Tab não chegaria lá)
  const campoSenha = useRef<HTMLInputElement>(null);
  // junto com a tela (layout), não depois de pintar: no WebKit do Writer OS o Enter seguinte já cairia no botão
  useLayoutEffect(() => {
    if (escolhida) campoSenha.current?.focus();
  }, [escolhida]);
  // a senha sumiu (Cancelar, ou conectou): o foco volta para o botão da rede, nunca fica perdido
  const raiz = useRef<HTMLDivElement>(null);
  const voltarARede = (ssid: string) =>
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return;
      [...(raiz.current?.querySelectorAll<HTMLElement>('[data-teste="os-rede"]') ?? [])].find((b) => b.dataset['ssid'] === ssid)?.focus();
    }, 0);
  const ler = () =>
    void os.redes().then((lista) => {
      setRedes(lista);
      aoMudar?.(lista);
    });
  useEffect(ler, []);
  const conectar = async (rede: RedeWifi, comSenha: string | null) => {
    setOcupado(true);
    setRecado({ texto: t('writer.os.wifi.conectando', { rede: rede.ssid }), erro: false });
    const r = await os.conectar(rede.ssid, comSenha);
    setOcupado(false);
    if (r.ok) {
      setEscolhida(null);
      setSenha('');
      setRecado({ texto: t('writer.os.wifi.conectou', { rede: rede.ssid }), erro: false });
      ler();
      voltarARede(rede.ssid);
    } else setRecado({ texto: t(`writer.os.wifi.erro.${r.erro}`), erro: true });
  };
  const tocar = (rede: RedeWifi) => {
    if (rede.segura && !rede.conhecida) {
      setEscolhida(rede);
      setSenha('');
    } else void conectar(rede, null);
  };
  return (
    <div class="redes-os" data-teste="os-redes" ref={raiz}>
      {redes === null && <p aria-busy="true">{t('writer.os.wifi.procurando')}</p>}
      {redes && !redes.length && <p class="dica">{t('writer.os.wifi.nenhuma')}</p>}
      {/* a senha da rede escolhida fica logo ACIMA da lista (pedido do Alcy em 18/11): à vista, sem rolar */}
      {escolhida && (
        <form
          class="form-casca"
          onSubmit={(e) => {
            e.preventDefault();
            void conectar(escolhida, senha);
          }}
          noValidate
        >
          <label class="campo">
            <span>{t('writer.os.wifi.senha', { rede: escolhida.ssid })}</span>
            <input type="password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campoSenha} data-teste="os-rede-senha" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal" disabled={ocupado || !senha} data-teste="os-rede-conectar">
              {t('writer.os.wifi.conectar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                setEscolhida(null);
                voltarARede(escolhida.ssid);
              }}
              data-teste="os-rede-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </form>
      )}
      <div class="acoes-coluna" role="list">
        {(redes ?? []).map((r) => (
          <div class="linha-rede" role="listitem" key={r.ssid}>
            <button type="button" class="botao" disabled={ocupado} onClick={() => tocar(r)} aria-pressed={r.conectada} data-ssid={r.ssid} data-teste="os-rede">
              {r.ssid}
              <small>
                {' · '}
                {t('writer.os.wifi.sinal', { n: r.sinal })}
                {r.segura ? ` · ${t('writer.os.wifi.segura')}` : ''}
                {r.conectada ? ` · ${t('writer.os.wifi.conectada')}` : ''}
              </small>
            </button>
            {r.conhecida && (
              <button type="button" class="botao pequeno" disabled={ocupado} onClick={() => void os.esquecer(r.ssid).then(ler)} data-teste="os-rede-esquecer">
                {t('writer.os.wifi.esquecer')}
              </button>
            )}
          </div>
        ))}
      </div>
      <div class="acoes-linha">
        <button type="button" class="botao pequeno" disabled={ocupado} onClick={ler} data-teste="os-redes-procurar">
          {t('writer.os.wifi.procurar')}
        </button>
      </div>
      {recado && (
        <p class={recado.erro ? 'ekf-erro' : 'dica'} role={recado.erro ? 'alert' : 'status'}>
          {recado.texto}
        </p>
      )}
    </div>
  );
}

/** Sem rede conectada, "Seguir (o Wi-Fi fica para depois)"; conectou, o botão vira "Concluir" e recebe o foco. */
function WifiPrimeiroUso() {
  const [conectado, setConectado] = useState(false);
  const concluir = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (conectado) concluir.current?.focus();
  }, [conectado]);
  const seguir = () => void os.passarWifi().then(mudarEstadoOS);
  return (
    <Moldura titulo={t('writer.os.wifi.titulo')} teste="os-wifi" foco="wifi">
      <p>{t('writer.os.wifi.texto')}</p>
      <div class="acoes-coluna">
        {conectado ? (
          <button type="button" class="botao principal" onClick={seguir} ref={concluir} data-foco-inicial data-teste="os-wifi-concluir">
            {t('writer.os.wifi.concluir')}
          </button>
        ) : (
          <button type="button" class="botao principal" onClick={seguir} data-foco-inicial data-teste="os-wifi-seguir">
            {t('writer.os.wifi.seguir')}
          </button>
        )}
      </div>
      <ListaRedes aoMudar={(redes) => setConectado(redes.some((r) => r.conectada))} />
    </Moldura>
  );
}

// ---------- o menu do sistema (§6.4) ----------

/** As partes do sistema que o menu abre (PLANO §6.4); cada uma é uma tela dentro do próprio menu. */
type SecaoOS = 'wifi' | 'energia' | 'teclado' | 'fuso' | 'servidor' | 'discos' | 'sobre';
const SECOES: readonly { id: SecaoOS; titulo: string }[] = [
  { id: 'wifi', titulo: 'writer.os.wifi.titulo' },
  { id: 'energia', titulo: 'writer.os.energia.titulo' },
  { id: 'teclado', titulo: 'writer.os.teclado.titulo' },
  { id: 'fuso', titulo: 'writer.os.fuso.titulo' },
  { id: 'servidor', titulo: 'writer.os.servidor.titulo' },
  { id: 'discos', titulo: 'writer.os.discos.titulo' },
  { id: 'sobre', titulo: 'writer.os.sobre.titulo' },
];

/** Setas para cima e para baixo (e Home, End) andam pelos itens do menu, em roda. */
function andarPeloMenu(e: TargetedKeyboardEvent<HTMLElement>): void {
  const itens = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  if (!itens.length) return;
  const i = itens.indexOf(document.activeElement as HTMLElement);
  const j = e.key === 'ArrowDown' ? (i + 1) % itens.length : e.key === 'ArrowUp' ? (i <= 0 ? itens.length - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? itens.length - 1 : -1;
  if (j < 0) return;
  e.preventDefault();
  itens[j]?.focus();
}

/**
 * O MENU DO SISTEMA do Writer OS (pedido do Alcy em 18/11), no estilo do Menu Iniciar: preso ao canto de cima,
 * abre pela engrenagem do topo ou por Ctrl+Alt+S. Em cima, Desligar e Reiniciar; depois a conta (quem entrou, com
 * Sair; ou Entrar); depois as partes do sistema (Wi-Fi, bateria e tela, teclado, fuso, servidor, pendrives,
 * Sobre) e os Ajustes do Writer. Cada parte abre dentro do próprio menu; Esc volta ao menu, e no menu, fecha.
 * Tudo pelo teclado: setas, Enter, Esc (e Tab, que gira dentro).
 */
export function MenuSistema({ fechar }: { fechar: () => void }) {
  const [secao, setSecao] = useState<SecaoOS | null>(null);
  // a volta de uma parte põe o foco no item dela
  const [ultimo, setUltimo] = useState('os-desligar');
  const [recado, setRecado] = useState<string | null>(null);
  const { conta } = useConta();
  const miolo = useRef<HTMLDivElement>(null);

  // a Camada só põe o foco ao abrir; ao trocar entre o menu e uma parte, quem põe é aqui
  const primeira = useRef(true);
  useLayoutEffect(() => {
    if (primeira.current) {
      primeira.current = false;
      return;
    }
    // o que a parte mostra chega aos poucos (a bateria, as redes): espera um pouco pelo primeiro campo dela
    let vezes = 0;
    const tentar = () => {
      const m = miolo.current;
      if (!m) return;
      const parte = m.querySelector<HTMLElement>('.secao-os');
      const alvo = m.querySelector<HTMLElement>('[data-foco-inicial]') ?? (parte ? focaveis(parte)[0] : undefined);
      if (alvo) alvo.focus();
      else if (++vezes < 10) setTimeout(tentar, 50);
      else focaveis(m)[0]?.focus();
    };
    tentar();
  }, [secao]);

  const abrir = (s: SecaoOS) => {
    setUltimo(`os-menu-${s}`);
    setSecao(s);
  };
  const foco = (teste: string) => (teste === ultimo ? { 'data-foco-inicial': true } : {});
  const titulo = secao ? t(SECOES.find((s) => s.id === secao)?.titulo ?? 'writer.os.menu.titulo') : t('writer.os.menu.titulo');

  return (
    <Camada titulo={titulo} fechar={secao ? () => setSecao(null) : fechar} tipo="menu" teste="menu-sistema" classe="painel-sistema">
      <div ref={miolo}>
        {recado && (
          <p class="aviso-casca" role="status" data-teste="os-recado">
            {recado}
          </p>
        )}
        {secao ? (
          <>
            <ParteDoSistema secao={secao} recado={setRecado} />
            <div class="acoes-linha">
              <button type="button" class="botao" onClick={() => setSecao(null)} data-teste="os-menu-voltar">
                {t('writer.os.menu.voltar')}
              </button>
            </div>
          </>
        ) : (
          <div class="menu-sistema" role="menu" aria-label={t('writer.os.menu.titulo')} onKeyDown={andarPeloMenu}>
            <div class="menu-sistema-energia">
              <button type="button" role="menuitem" class="item-menu-os" onClick={() => void desligarOS(false, setRecado)} {...foco('os-desligar')} data-teste="os-desligar">
                <IconeLigar tamanho={16} />
                <span>{t('writer.os.desligar')}</span>
              </button>
              <button type="button" role="menuitem" class="item-menu-os" onClick={() => void desligarOS(true, setRecado)} {...foco('os-reiniciar')} data-teste="os-reiniciar">
                <span>{t('writer.os.reiniciar')}</span>
              </button>
            </div>
            <div class="menu-sistema-conta" role="group" aria-label={t('writer.os.menu.conta-titulo')} data-teste="os-menu-conta">
              <p>{conta ? t('writer.os.menu.conta', { nome: conta.nome }) : t('writer.os.menu.sem-conta')}</p>
              {conta ? (
                <button type="button" role="menuitem" class="item-menu-os" onClick={() => void ponte.sair()} {...foco('os-conta-sair')} data-teste="os-conta-sair">
                  <span>{t('nucleo.conta.sair')}</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  class="item-menu-os"
                  onClick={() => {
                    fechar();
                    pedir('conta');
                  }}
                  {...foco('os-conta-entrar')}
                  data-teste="os-conta-entrar"
                >
                  <span>{t('nucleo.conta.entrar.botao')}</span>
                </button>
              )}
            </div>
            <div class="menu-sistema-partes">
              {SECOES.map((s) => (
                <button key={s.id} type="button" role="menuitem" class="item-menu-os" onClick={() => abrir(s.id)} {...foco(`os-menu-${s.id}`)} data-teste={`os-menu-${s.id}`}>
                  <span>{t(s.titulo)}</span>
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                class="item-menu-os"
                onClick={() => {
                  fechar();
                  pedir('ajustes');
                }}
                data-teste="os-menu-ajustes"
              >
                <span>{t('writer.os.menu.ajustes')}</span>
                <small>Ctrl+,</small>
              </button>
            </div>
          </div>
        )}
      </div>
    </Camada>
  );
}

function Secao({ titulo, children, teste }: { titulo: string; children: ComponentChildren; teste: string }) {
  return (
    <section class="secao-os" data-teste={teste} aria-label={titulo}>
      {children}
    </section>
  );
}

/** Uma parte do sistema, aberta pelo menu (§6.4). O foco começa no primeiro campo dela. */
function ParteDoSistema({ secao, recado }: { secao: SecaoOS; recado: (texto: string) => void }) {
  const osEstado = useEstadoOS();
  const [bateria, setBateria] = useState<Bateria | null | undefined>(undefined);
  const [luz, setLuz] = useState<number | null | undefined>(undefined);
  const [teclados, setTeclados] = useState<string[]>([]);
  const [fusos, setFusos] = useState<string[]>([]);
  const [sobre, setSobre] = useState<SobreOS | null>(null);
  useEffect(() => {
    if (secao === 'energia') {
      void os.bateria().then(setBateria);
      void os.brilho().then(setLuz);
      // as teclas de brilho do notebook mudam o número aqui também
      return os.aoMudarBrilho(setLuz);
    }
    if (secao === 'teclado') void os.teclados().then(setTeclados);
    if (secao === 'fuso') void os.fusos().then(setFusos);
    if (secao === 'sobre') void os.sobre().then(setSobre);
    return undefined;
  }, [secao]);

  const trocarTeclado = async (id: string) => {
    if (id === osEstado?.teclado) return;
    if (!(await confirmar(t('writer.os.teclado.confirmar'), t('writer.os.teclado.trocar')))) return;
    await gravarAgora();
    const r = await os.usarTeclado(id);
    if (r.reabrindo) recado(t('writer.os.teclado.reabrindo'));
    else mudarEstadoOS(r.estado);
  };

  switch (secao) {
    case 'wifi':
      return (
        <Secao titulo={t('writer.os.wifi.titulo')} teste="os-painel-wifi">
          <ListaRedes />
        </Secao>
      );
    case 'energia':
      return (
        <Secao titulo={t('writer.os.energia.titulo')} teste="os-painel-energia">
          <p>{bateria === undefined ? '…' : bateria ? t(bateria.carregando ? 'writer.os.bateria.carregando' : 'writer.os.bateria.nivel', { n: bateria.nivel }) : t('writer.os.bateria.sem')}</p>
          {luz !== null && (
            <div class="acoes-linha" role="group" aria-label={t('writer.os.brilho')}>
              <span>{t('writer.os.brilho.valor', { n: luz ?? 0 })}</span>
              <button type="button" class="botao pequeno" onClick={() => void os.brilho(-10).then(setLuz)} data-teste="os-brilho-menos">
                {t('writer.os.brilho.menos')}
              </button>
              <button type="button" class="botao pequeno" onClick={() => void os.brilho(10).then(setLuz)} data-foco-inicial data-teste="os-brilho-mais">
                {t('writer.os.brilho.mais')}
              </button>
            </div>
          )}
          {luz !== null && <p class="dica">{t('writer.os.brilho.dica')}</p>}
        </Secao>
      );
    case 'teclado':
      return (
        <Secao titulo={t('writer.os.teclado.titulo')} teste="os-painel-teclado">
          <label class="campo">
            <span>{t('writer.os.teclado.rotulo')}</span>
            <select value={osEstado?.teclado ?? 'br'} onChange={(e) => void trocarTeclado(e.currentTarget.value)} data-teste="os-painel-teclado-lista">
              {teclados.map((id) => (
                <option key={id} value={id}>
                  {t(`writer.os.teclado.${id}`)}
                </option>
              ))}
            </select>
          </label>
        </Secao>
      );
    case 'fuso':
      return (
        <Secao titulo={t('writer.os.fuso.titulo')} teste="os-painel-fuso">
          <label class="campo">
            <span>{t('writer.os.fuso.rotulo')}</span>
            <select value={osEstado?.fuso ?? ''} onChange={(e) => void os.usarFuso(e.currentTarget.value).then(mudarEstadoOS)} data-teste="os-painel-fuso-lista">
              {fusos.map((id) => (
                <option key={id} value={id}>
                  {nomeDoFuso(id)}
                </option>
              ))}
            </select>
          </label>
        </Secao>
      );
    case 'servidor':
      return (
        <Secao titulo={t('writer.os.servidor.titulo')} teste="os-painel-servidor">
          <EscolhaServidor />
          <p class="dica">{t('writer.os.conta.dica')}</p>
        </Secao>
      );
    case 'discos':
      return <ParteDosDiscos recado={recado} />;
    case 'sobre':
      return (
        <Secao titulo={t('writer.os.sobre.titulo')} teste="os-painel-sobre">
          {sobre && (
            <p>
              {t('writer.os.sobre.texto', { sistema: sobre.sistema, app: sobre.app, kernel: sobre.kernel })}
              <br />
              {t(`writer.os.sobre.secure-boot.${sobre.secureBoot}`)}
            </p>
          )}
          <p>{t('writer.os.sobre.licenca')}</p>
          <p>{t('writer.os.sobre.privacidade')}</p>
        </Secao>
      );
  }
}

function ParteDosDiscos({ recado }: { recado: (texto: string) => void }) {
  const [discos, lerDiscos] = useDiscos();
  const ejetar = async (d: DiscoUSB) => {
    const r = await os.ejetar(d.id);
    recado(r.ok ? t('writer.os.discos.pode-tirar', { nome: d.rotulo || d.nome }) : t(`writer.os.discos.erro.${r.erro}`));
    lerDiscos();
  };
  return (
    <Secao titulo={t('writer.os.discos.titulo')} teste="os-painel-discos">
      {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
      {(discos ?? []).map((d) => (
        <div class="linha-rede" key={d.id}>
          <span>
            {d.rotulo || d.nome || d.id} · {tamanho(d.tamanho)}
          </span>
          {d.montado && (
            <button type="button" class="botao pequeno" onClick={() => void ejetar(d)} data-teste="os-ejetar">
              {t('writer.os.discos.ejetar')}
            </button>
          )}
        </div>
      ))}
    </Secao>
  );
}
