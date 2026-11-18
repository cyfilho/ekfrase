// SPDX-License-Identifier: MPL-2.0

/**
 * A CASCA do Ekfrase Writer: a conta, a sessão (onde os textos moram), as telas e o teclado.
 *
 * Quem não entrou vê a tela inicial do app (DEC-P046, `EntradaApp`) com uma forma a mais: "Escrever
 * sem conta". Escolhida, ela fica lembrada neste aparelho (`prefs.semConta`) e o app abre direto no
 * armazém `local`. Entrar depois (botão da conta no topo) troca para o armazém da conta e oferece
 * levar para lá o que foi escrito sem conta (`adotar`). Sair volta ao armazém local (se a pessoa já
 * tinha escolhido escrever sem conta) ou à tela inicial.
 *
 * Teclado: os atalhos de todos os comandos passam por aqui (`comandos.ts`); com uma janela ou gaveta
 * aberta, quem manda é ela.
 */
import { AcoesTopo, EntradaApp, RodapeEkfrase, definirAmbienteFechado, entradaDoApp, jogo, noApp, voltarAoModoDoApp } from '@ekfrase/interface';
import { DONO_LOCAL } from '@ekfrase/writer-nucleo';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Ajustes } from './Ajustes.tsx';
import { Abrir, Arquivos } from './Arquivos.tsx';
import { useContaDoWriter } from './conta.ts';
import { comandosDeAgora, emCampo, teclaDe, useComandos } from './comandos.ts';
import { Escrever } from './Escrever.tsx';
import { Estante, novaHistoria } from './Estante.tsx';
import { ProvedorDeSessao, abrirSessao, fecharSessao, levarLocais, textosLocais, useSessao, type Sessao } from './estado.ts';
import { Historia } from './Historia.tsx';
import { Historico } from './Historico.tsx';
import { IconeEngrenagem, IconeLampada, IconeLupa, IconePena, IconeTeclado } from './icones.tsx';
import { IdeiaRapida, Ideias } from './Ideias.tsx';
import logo from './img/logo-writer.png';
import { Nuvem } from './Nuvem.tsx';
import { Atalhos, Paleta } from './Paleta.tsx';
import { aoPedido, pedir, type Pedido } from './pedidos.ts';
import { Personagens } from './Personagens.tsx';
import { mudarPrefs, usePrefs } from './prefs.ts';
import { ir, lerRota, useRota, type Rota } from './rotas.ts';
import { t, tr, textoDoErro } from './textos.ts';
import { Avisos, Camada, Confirmacoes, avisar, camadaAberta, focarTela } from './ui.tsx';
import { naCasca, noOS } from './computador/casca.ts';
import { PendriveOS } from './computador/PendriveOS.tsx';
import { BotaoSistema, EntrarOS, MenuSistema, PortaoOS, useAvisoDeBrilho } from './computador/SistemaOS.tsx';
import { BaixarOS } from './computador/BaixarOS.tsx';
import { Baixar, PortaoDaCasca } from './computador/Telas.tsx';
import { Hall } from './Hall.tsx';

// No Writer OS nada leva para fora do app (PLANO §6.5): as peças comuns (rodapé, marca, menu da conta) tiram os links do site
definirAmbienteFechado(noOS);

/** O Writer no computador tem o botão do modo jogo; o castelo só chega lá com o Motor (até lá, o botão avisa). */
const passeioDoComputador = () => avisar(t('writer.passeio.casca'));

/**
 * No computador, a pasta, a senha e o espelho vêm antes de tudo (`PortaoDaCasca`); no pendrive (Writer
 * OS), também o idioma, o teclado, o fuso, onde guardar e o Wi-Fi (`PortaoOS`); no site, nada muda.
 */
export function App() {
  if (noOS) {
    return (
      <PortaoOS>
        <AppDoWriter />
      </PortaoOS>
    );
  }
  return (
    <PortaoDaCasca>
      <AppDoWriter />
    </PortaoDaCasca>
  );
}

function AppDoWriter() {
  const [, setV] = useState(0);
  const rotaAgora = useRota();
  useEffect(() => tr.aoTrocar(() => setV((n) => n + 1)), []);
  const { carregando, conta, semRede } = useContaDoWriter();
  const p = usePrefs();
  // com conta, chegou por link direto e da última vez passeava pelo castelo: volta às salas da torre (DEC-P048)
  const [voltou, setVoltou] = useState(false);
  useEffect(() => {
    if (carregando || !conta || semRede || voltou) return;
    setVoltou(true);
    if (!naCasca && lerRota().tela === 'inicio') voltarAoModoDoApp('writer');
  }, [carregando, conta]);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const dono = carregando ? null : conta ? String(conta.id) : p.semConta ? DONO_LOCAL : null;
  // saiu da conta (ou a sessão do servidor acabou) com o Writer aberto: a tela diz que o texto ficou guardado
  const [saiu, setSaiu] = useState(false);
  const donoAntes = useRef<string | null>(null);

  useEffect(() => {
    if (donoAntes.current !== null && donoAntes.current !== DONO_LOCAL && dono !== donoAntes.current && !conta) setSaiu(true);
    if (conta) setSaiu(false);
    if (dono !== null) donoAntes.current = dono;
    setSessao(null);
    if (dono === null) return;
    let viva = true;
    let aberta: Sessao | null = null;
    void abrirSessao(conta).then((s) => {
      if (!viva) return void fecharSessao(s);
      aberta = s;
      setSessao(s);
    });
    return () => {
      viva = false;
      // a folha aberta grava o que falta ANTES de o armazém fechar (ver fecharSessao)
      if (aberta) void fecharSessao(aberta);
    };
  }, [dono]);

  const avisoDeSaida = saiu && (
    <div class="aviso-saiu" role="status" data-teste="aviso-saiu">
      <p>{t('writer.sessao.saiu')}</p>
      <button type="button" class="botao" onClick={() => setSaiu(false)}>
        {t('writer.fechar')}
      </button>
    </div>
  );

  // a página de download do app do computador abre também sem conta (no computador, não há)
  if (rotaAgora.tela === 'computador' && !naCasca) return <Baixar />;
  if (rotaAgora.tela === 'os' && !naCasca) return <BaixarOS />;
  if (carregando) return <div class="tela-cheia-carregando" aria-busy="true" />;
  // o hall: os caminhos para escrever (web, computador, pendrive). Sem onde escrever, é a própria tela inicial.
  if (rotaAgora.tela === 'inicio' && dono !== null) return <Hall />;
  if (dono === null) {
    return (
      <>
        {avisoDeSaida}
        <EntradaApp
          t={t}
          tr={tr}
          app="writer"
          semPasseio={noOS}
          {...(naCasca && !noOS ? { aoPasseio: passeioDoComputador } : {})}
          logo={logo}
          nome={t(noOS ? 'writer.os.nome' : 'writer.nome')}
          descricao={t('writer.entrada.descricao')}
          podeCriar
          arquivos
          computador={naCasca ? null : { aoEscolher: () => ir({ tela: 'computador' }) }}
          pendrive={naCasca ? null : { titulo: t('writer.entrada.os.titulo'), texto: t('writer.entrada.os.texto'), aoEscolher: () => ir({ tela: 'os' }) }}
          aoEntrar={() => undefined}
          outraForma={{
            icone: <IconePena tamanho={36} />,
            titulo: t('writer.entrada.sem-conta.titulo'),
            texto: t(naCasca ? 'writer.computador.sem-conta.texto' : 'writer.entrada.sem-conta.texto'),
            botao: t('writer.entrada.sem-conta.botao'),
            // "Começar a escrever" leva à estante (e não ao hall do começo)
            aoEscolher: () => {
              mudarPrefs({ semConta: true });
              if (rotaAgora.tela === 'inicio') ir({ tela: 'estante' });
            },
          }}
        />
      </>
    );
  }
  if (!sessao) return <div class="tela-cheia-carregando" aria-busy="true" />;
  return (
    <ProvedorDeSessao value={sessao}>
      {avisoDeSaida}
      <Casca />
    </ProvedorDeSessao>
  );
}

function Tela({ rota }: { rota: Rota }) {
  switch (rota.tela) {
    case 'historia':
      return <Historia id={rota.id} />;
    case 'historico':
      return <Historico cena={rota.id} />;
    case 'ideias':
      return <Ideias {...(rota.id ? { historia: rota.id } : {})} />;
    case 'personagens':
      return <Personagens historia={rota.id} />;
    case 'arquivos':
      return <Arquivos {...(rota.id ? { historia: rota.id } : {})} />;
    case 'abrir':
      return <Abrir chave={rota.id} />;
    default:
      return <Estante />;
  }
}

function Casca() {
  const s = useSessao();
  const rota = useRota();
  const [aberta, setAberta] = useState<Pedido | null>(null);

  useEffect(() => aoPedido(setAberta), []);
  useAvisoDeBrilho();
  useEffect(() => {
    scrollTo(0, 0);
    // trocou de tela pelo teclado e o foco ficou na tela velha: vai ao título da nova
    focarTela();
  }, [rota.tela, 'id' in rota ? rota.id : '']);

  // entrou na conta depois de escrever sem ela: oferece levar os textos (uma vez por visita)
  useEffect(() => {
    if (!s.conta) return;
    let vivo = true;
    void textosLocais().then((n) => {
      if (!vivo || (!n.historias && !n.ideias)) return;
      try {
        if (sessionStorage.getItem('ekfrase.writer.levar') === s.dono) return;
      } catch {
        // sem sessionStorage: pergunta
      }
      setAberta((a) => a ?? 'levar');
    });
    return () => {
      vivo = false;
    };
  }, [s.dono]);

  useComandos(() => [
    { id: 'paleta', rotulo: t('writer.cmd.paleta'), atalho: 'Ctrl+K', fazer: () => pedir('paleta') },
    { id: 'atalhos', rotulo: t('writer.cmd.atalhos'), atalho: 'F1', fazer: () => pedir('atalhos') },
    { id: 'ajustes', rotulo: t('writer.cmd.ajustes'), atalho: 'Ctrl+,', fazer: () => pedir('ajustes') },
    { id: 'ideia', rotulo: t('writer.cmd.ideia'), atalho: 'Ctrl+I', fazer: () => pedir('ideia') },
    { id: 'estante', rotulo: t('writer.cmd.estante'), fazer: () => ir({ tela: 'estante' }) },
    { id: 'inicio', rotulo: t('writer.cmd.inicio'), fazer: () => ir({ tela: 'inicio' }) },
    { id: 'nova-historia', rotulo: t('writer.cmd.nova-historia'), fazer: () => void novaHistoria(s) },
    { id: 'banco-ideias', rotulo: t('writer.cmd.banco-ideias'), fazer: () => ir({ tela: 'ideias' }) },
    { id: 'arquivos', rotulo: t('writer.cmd.arquivos'), fazer: () => ir({ tela: 'arquivos' }) },
    s.conta
      ? { id: 'sincronizar', rotulo: t('writer.cmd.sincronizar'), fazer: () => void s.sinc.sincronizar() }
      : { id: 'entrar', rotulo: t('writer.cmd.entrar'), fazer: () => (noOS ? pedir('conta') : document.querySelector<HTMLElement>(`.ekf-acoes button[aria-label="${t('nucleo.conta.entrar.ekfrase')}"]`)?.click()) },
    ...(s.conta ? [{ id: 'levar', rotulo: t('writer.levar.botao'), fazer: () => pedir('levar') }] : []),
    { id: 'ir-conteudo', rotulo: t('writer.cmd.ir-conteudo'), fazer: () => document.getElementById('conteudo')?.focus() },
    ...(noOS ? [{ id: 'sistema', rotulo: t('writer.os.menu.titulo'), atalho: 'Ctrl+Alt+S', fazer: () => pedir('sistema') }] : []),
  ]);

  // o teclado: o atalho de cada comando (F1 também é "?", fora de um campo)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.defaultPrevented || camadaAberta()) return;
      let k = teclaDe(e);
      if (k === '?') {
        if (emCampo(e.target)) return;
        k = 'F1';
      }
      const c = comandosDeAgora().find((x) => x.atalho === k);
      if (!c || (c.foraDeCampo && emCampo(e.target))) return;
      e.preventDefault();
      c.fazer();
    };
    addEventListener('keydown', tecla);
    return () => removeEventListener('keydown', tecla);
  }, []);

  const fechar = () => setAberta(null);
  const camadas = (
    <>
      {aberta === 'paleta' && <Paleta fechar={fechar} />}
      {aberta === 'atalhos' && <Atalhos fechar={fechar} />}
      {aberta === 'ajustes' && <Ajustes fechar={fechar} />}
      {aberta === 'ideia' && <IdeiaRapida fechar={fechar} />}
      {aberta === 'levar' && <Levar fechar={fechar} />}
      {aberta === 'sistema' && <MenuSistema fechar={fechar} />}
      {aberta === 'conta' && <EntrarOS fechar={fechar} />}
      {noOS && <PendriveOS />}
      <Confirmacoes />
      <Avisos />
    </>
  );

  if (rota.tela === 'escrever') {
    return (
      <>
        <Escrever id={rota.id} />
        {camadas}
      </>
    );
  }

  return (
    <div class="casca">
      <a class="pular" href="#conteudo" onClick={(e) => (e.preventDefault(), document.getElementById('conteudo')?.focus())}>
        {t('writer.pular')}
      </a>
      <header class="topo">
        <a class="marca" href={noApp('writer')} data-teste="marca">
          <img src={logo} width={48} height={48} alt="" class="pixel" />
          <span>{t(noOS ? 'writer.os.nome' : 'writer.nome')}</span>
        </a>
        <nav class="topo-nav" aria-label={t('writer.nav.rotulo')}>
          {/* "Início" antes de todas as outras (pedido do Alcy em 18/11) */}
          <a href={entradaDoApp('writer')} data-teste="nav-inicio">
            {t('writer.nav.inicio')}
          </a>
          <a href={noApp('writer')} aria-current={rota.tela === 'estante' ? 'page' : undefined} data-teste="nav-estante">
            {t('writer.estante.titulo')}
          </a>
          <a href={noApp('writer', 'ideias')} aria-current={rota.tela === 'ideias' ? 'page' : undefined} data-teste="nav-ideias">
            {t('writer.ideias.titulo')}
          </a>
          <a href={noApp('writer', 'arquivos')} aria-current={rota.tela === 'arquivos' ? 'page' : undefined} data-teste="nav-arquivos">
            {t('writer.arquivos.curto')}
          </a>
        </nav>
        <AcoesTopo
          t={t}
          tr={tr}
          app="writer"
          entrar={!noOS}
          semConta={noOS}
          {...(noOS ? {} : { passeio: naCasca ? passeioDoComputador : jogo.sala('writer') })}
          antes={
            <>
              <Nuvem />
              <button type="button" class="ekf-icone" title={t('writer.cmd.ideia')} aria-label={t('writer.cmd.ideia')} onClick={() => pedir('ideia')} data-teste="botao-ideia">
                <IconeLampada />
              </button>
              <button type="button" class="ekf-icone" title={`${t('writer.cmd.paleta')} (Ctrl+K)`} aria-label={t('writer.cmd.paleta')} onClick={() => pedir('paleta')} data-teste="botao-paleta">
                <IconeLupa />
              </button>
              <button type="button" class="ekf-icone" title={`${t('writer.cmd.atalhos')} (F1)`} aria-label={t('writer.cmd.atalhos')} onClick={() => pedir('atalhos')} data-teste="botao-atalhos">
                <IconeTeclado />
              </button>
              {/* no Writer OS os Ajustes moram no menu do sistema (a engrenagem é dele) */}
              {noOS ? (
                <BotaoSistema />
              ) : (
                <button type="button" class="ekf-icone" title={`${t('writer.cmd.ajustes')} (Ctrl+,)`} aria-label={t('writer.cmd.ajustes')} onClick={() => pedir('ajustes')} data-teste="botao-ajustes">
                  <IconeEngrenagem />
                </button>
              )}
            </>
          }
        />
      </header>
      <main class="conteudo writer" id="conteudo" tabIndex={-1}>
        <Tela rota={rota} />
      </main>
      <RodapeEkfrase t={t} />
      {camadas}
    </div>
  );
}

/** Levar para a conta o que foi escrito neste aparelho sem conta (`adotar`). */
function Levar({ fechar }: { fechar: () => void }) {
  const s = useSessao();
  const [n, setN] = useState<{ historias: number; ideias: number } | null>(null);
  const [levando, setLevando] = useState(false);
  useEffect(() => void textosLocais().then(setN), []);
  const lembrar = () => {
    try {
      sessionStorage.setItem('ekfrase.writer.levar', s.dono);
    } catch {
      // sem sessionStorage: pergunta de novo na próxima visita
    }
  };
  const levar = async () => {
    setLevando(true);
    try {
      await levarLocais(s);
      avisar(t('writer.levar.feito'));
      lembrar();
      fechar();
    } catch (e) {
      avisar(textoDoErro((e as { codigo?: string }).codigo), 'erro');
      setLevando(false);
    }
  };
  return (
    <Camada
      titulo={t('writer.levar.titulo')}
      fechar={() => {
        lembrar();
        fechar();
      }}
      teste="levar"
    >
      <p>{n ? t('writer.levar.texto', { historias: n.historias, ideias: n.ideias, nome: s.conta?.nome ?? '' }) : t('writer.carregando')}</p>
      <div class="acoes-linha">
        <button
          type="button"
          class="botao"
          onClick={() => {
            lembrar();
            fechar();
          }}
          data-teste="levar-nao"
        >
          {t('writer.levar.nao')}
        </button>
        <button type="button" class="botao principal" disabled={!n || levando} aria-busy={levando} onClick={() => void levar()} data-foco-inicial data-teste="levar-sim">
          {t('writer.levar.botao')}
        </button>
      </div>
    </Camada>
  );
}
