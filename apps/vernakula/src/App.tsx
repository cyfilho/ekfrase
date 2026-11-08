// SPDX-License-Identifier: MPL-2.0

import { EntradaApp, voltarAoModoDoApp } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';
import { api, type Conta, type TextosEscola } from './api.ts';
import { Cabecalho, Rodape } from './casca.tsx';
import logoVernakula from './img/logo-vernakula.png';
import { irPara, useEndereco } from './rotas.ts';
import { Entrar, PrimeiroAcesso } from './telas/entrar.tsx';
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

  // Dentro: os textos da escola passam a valer por cima do padrão. Fora: só o padrão.
  const escolaId = estado.fase === 'dentro' ? estado.conta.organizacoes[0]?.id : undefined;
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

  function entrou(conta: Conta) {
    setEstado({ fase: 'dentro', conta });
  }

  // Quem não entrou e chega no começo do app vê a tela inicial (o hall do modo normal: computador,
  // online), com o topo do Ekfrase — também quando desliga o modo jogo no hall ou nas salas.
  // Quem entrou e chegou por um link direto aparece no modo da última vez (DEC-P048).
  const telaInicial = estado.fase === 'fora' && rota === 'inicio' && !estado.aviso;
  const dentroNoComeco = estado.fase === 'dentro' && rota === 'inicio';
  useEffect(() => {
    if (dentroNoComeco) voltarAoModoDoApp('vernakula');
  }, [dentroNoComeco]);
  if (telaInicial) {
    return (
      <EntradaApp
        t={t}
        tr={tr}
        app="vernakula"
        logo={logoVernakula}
        nome={t('vernakula.nome_curto')}
        descricao={t('vernakula.descricao')}
        podeCriar={false}
        arquivos={false}
        aoEntrar={entrou}
        entrarProprio={() => irPara('entrar')}
      />
    );
  }

  return (
    <div class="casca">
      <Cabecalho />
      <main class="conteudo">
        {estado.fase === 'carregando' && <p class="carregando">{t('nucleo.carregando')}</p>}
        {estado.fase === 'instalacao' && <PrimeiroAcesso aoCriar={entrou} />}
        {estado.fase === 'fora' && rota === 'esqueci' && <Esqueci />}
        {(estado.fase === 'fora' || estado.fase === 'dentro') && rota === 'redefinir' && <Redefinir codigo={parametro} aoEntrar={entrou} />}
        {estado.fase === 'fora' && rota !== 'esqueci' && rota !== 'redefinir' && <Entrar aviso={estado.aviso} aoEntrar={entrou} />}
        {estado.fase === 'dentro' && rota === 'conta' && <MinhaConta conta={estado.conta} aoMudar={entrou} />}
        {estado.fase === 'dentro' && rota === 'textos' && podeEditarTextos(estado.conta) && (
          <TextosDaEscola conta={estado.conta} trocas={trocas} aoMudar={mudarTrocas} />
        )}
        {estado.fase === 'dentro' && (rota === 'inicio' || rota === 'entrar' || rota === 'esqueci' || (rota === 'textos' && !podeEditarTextos(estado.conta))) && (
          <Inicio
            conta={estado.conta}
            aoSair={() => {
              void api.sair().finally(() => {
                irPara('inicio');
                setEstado({ fase: 'fora' });
              });
            }}
          />
        )}
      </main>
      <Rodape />
    </div>
  );
}
