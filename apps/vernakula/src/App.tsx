// SPDX-License-Identifier: MPL-2.0

import { EntradaApp, FormConta, TelaDoCadastro, entradaPedida, limparEntradaPedida, ponte } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';
import { api, type Conta, type Escola, type TextosEscola } from './api.ts';
import { Cabecalho, Rodape } from './casca.tsx';
import logoVernakula from './img/logo-vernakula.png';
import { irPara, useEndereco, type Rota } from './rotas.ts';
import { Administracao, podeAdministrar } from './telas/admin.tsx';
import { TelaConvite } from './telas/convite.tsx';
import { Entrar, PrimeiroAcesso } from './telas/entrar.tsx';
import { escolaAtual, escolaGuardada, guardarEscola, MinhasEscolas, PedirEscola } from './telas/escolas.tsx';
import { Esqueci, Redefinir } from './telas/esqueci.tsx';
import { Inicio } from './telas/inicio.tsx';
import { MinhaConta } from './telas/minha-conta.tsx';
import { podeEditarTextos, TextosDaEscola } from './telas/textos-escola.tsx';
import { t, tr } from './textos.ts';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'instalacao' }
  | { fase: 'fora'; aviso?: string }
  | { fase: 'dentro'; conta: Conta };

export function App() {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [trocas, setTrocas] = useState<TextosEscola>({});
  const { rota, parametro } = useEndereco();
  // Trocar o idioma (ou um texto da escola) redesenha tudo: os textos são lidos na hora de desenhar.
  const [, setVersaoTextos] = useState(0);
  useEffect(() => tr.aoTrocar(() => setVersaoTextos((n) => n + 1)), []);

  useEffect(() => {
    void api.eu().then((r) => {
      if (r.ok && r.conta) setEstado({ fase: 'dentro', conta: r.conta });
      else if (r.ok && r.instalacao) setEstado({ fase: 'instalacao' });
      else setEstado(r.ok ? { fase: 'fora' } : { fase: 'fora', aviso: `nucleo.erro.${r.erro === 'rede' ? 'rede' : 'servidor'}` });
    });
  }, []);

  // A escola em que a pessoa está agora (DEC-P059): a única, ou a escolhida em "Minhas escolas".
  const [escolhida, setEscolhida] = useState<number | null>(escolaGuardada());
  const escola = estado.fase === 'dentro' ? escolaAtual(estado.conta, escolhida) : undefined;

  // Dentro: os textos da escola passam a valer por cima do padrão. Fora: só o padrão.
  const escolaId = escola?.id;
  useEffect(() => {
    if (escolaId === undefined) {
      setTrocas({});
      tr.sobrepor({});
      return;
    }
    void api.textos(escolaId).then((r) => {
      if (!r.ok) return;
      setTrocas(r.textos);
      tr.sobrepor(r.textos);
    });
  }, [escolaId]);

  function mudarTrocas(novas: TextosEscola) {
    setTrocas(novas);
    tr.sobrepor(novas);
  }

  const [entradaVista, setEntradaVista] = useState(() => entradaPedida());

  function entrou(conta: Conta) {
    setEstado({ fase: 'dentro', conta });
    // entrar passou pelo `chaves` (a sessão nova): este app relê o token dele
    void api.eu();
  }

  function escolher(id: number) {
    guardarEscola(id);
    setEscolhida(id);
    irPara('inicio');
  }

  /** Entrou pelo formulário comum (criar conta, convite): relê a conta e o token pela ponte deste app. */
  function sincronizar() {
    void api.eu().then((r) => {
      if (r.ok && r.conta) setEstado({ fase: 'dentro', conta: r.conta });
    });
  }

  // o `sair` comum: além da sessão, apaga as chaves deste aparelho (no computador da escola, nada fica)
  const sair = () => {
    void ponte.sair().finally(() => {
      irPara('entrada');
      setEstado({ fase: 'fora' });
    });
  };

  // Quem não entrou e chega no começo do app vê a tela inicial (o hall do modo normal: computador,
  // online), com o topo do Ekfrase — também quando desliga o modo jogo no hall ou nas salas.
  // Quem entrou e chega por link direto (ou pelo botão do modo jogo, `?inicio`) também a vê, com o "Abrir o Vernákula".
  const telaInicial = (estado.fase === 'fora' && rota === 'entrada' && !estado.aviso) || (estado.fase === 'dentro' && rota === 'entrada' && entradaVista);
  if (telaInicial) {
    return (
      <EntradaApp
        t={t}
        tr={tr}
        app="vernakula"
        logo={logoVernakula}
        nome={t('vernakula.nome_curto')}
        descricao={t('vernakula.descricao')}
        podeCriar
        arquivos={false}
        aoEntrar={sincronizar}
        entrarProprio={(modo) => irPara(modo === 'criar' ? 'criar' : 'entrar')}
        {...(estado.fase === 'dentro' ? { aoAbrir: () => (limparEntradaPedida(), setEntradaVista(false)) } : {})}
      />
    );
  }

  const dentro = estado.fase === 'dentro' ? estado.conta : null;
  return (
    <div class="casca">
      <Cabecalho escola={escola?.nome} entrou={estado.fase === 'dentro'} />
      <main class="conteudo">
        {estado.fase === 'carregando' && <p class="carregando">{t('nucleo.carregando')}</p>}
        {estado.fase === 'instalacao' && <PrimeiroAcesso aoCriar={entrou} />}
        {estado.fase === 'fora' && rota === 'esqueci' && <Esqueci />}
        {(estado.fase === 'fora' || estado.fase === 'dentro') && rota === 'redefinir' && <Redefinir codigo={parametro} aoEntrar={entrou} />}
        {(estado.fase === 'fora' || estado.fase === 'dentro') && rota === 'convite' && (
          <TelaConvite
            codigo={parametro}
            conta={dentro}
            aoEntrar={sincronizar}
            aoAceitar={(c, id) => {
              entrou(c);
              escolher(id);
            }}
          />
        )}
        {(estado.fase === 'fora' || estado.fase === 'dentro') && rota === 'cadastro' && (
          <section class="painel entrar">
            <TelaDoCadastro t={t} codigo={parametro} idioma={tr.idioma()} app="vernakula" aoEntrar={sincronizar} />
          </section>
        )}
        {estado.fase === 'fora' && rota === 'criar' && (
          <section class="painel entrar" aria-labelledby="titulo-criar">
            <h1 id="titulo-criar">{t('vernakula.criar.titulo')}</h1>
            <p>{t('vernakula.criar.explicacao')}</p>
            <FormConta t={t} app="vernakula" idioma={tr.idioma()} inicial="criar" podeCriar aoEntrar={sincronizar} />
          </section>
        )}
        {estado.fase === 'fora' && !['esqueci', 'redefinir', 'convite', 'criar', 'cadastro'].includes(rota) && <Entrar aviso={estado.aviso} aoEntrar={entrou} />}
        {dentro && rota !== 'redefinir' && rota !== 'convite' && rota !== 'cadastro' && (
          <Dentro conta={dentro} escola={escola} rota={rota} trocas={trocas} mudarTrocas={mudarTrocas} entrou={entrou} escolher={escolher} sair={sair} />
        )}
      </main>
      <Rodape />
    </div>
  );
}

/** Quem entrou: sem escola (ou sem escolher), "Minhas escolas"; com escola, as telas dela. */
function Dentro(p: {
  conta: Conta;
  escola: Escola | undefined;
  rota: Rota;
  trocas: TextosEscola;
  mudarTrocas: (t: TextosEscola) => void;
  entrou: (c: Conta) => void;
  escolher: (id: number) => void;
  sair: () => void;
}) {
  const { conta, escola, rota } = p;
  if (rota === 'conta') return <MinhaConta conta={conta} escola={escola} aoMudar={p.entrou} />;
  if (rota === 'pedir') return <PedirEscola temEscola={conta.organizacoes.length > 0} />;
  if (rota === 'escolas' || !escola)
    return (
      <MinhasEscolas
        conta={conta}
        aoEscolher={p.escolher}
        aoAceitar={(c, id) => {
          p.entrou(c);
          p.escolher(id);
        }}
      />
    );
  if (rota === 'textos' && podeEditarTextos(escola)) return <TextosDaEscola escola={escola} trocas={p.trocas} aoMudar={p.mudarTrocas} />;
  if (rota === 'admin' && podeAdministrar(escola)) return <Administracao key={escola.id} escola={escola} />;
  return <Inicio conta={conta} escola={escola} aoSair={p.sair} />;
}
