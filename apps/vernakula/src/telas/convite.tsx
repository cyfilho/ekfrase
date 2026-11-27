// SPDX-License-Identifier: MPL-2.0

import { FormConta } from '@ekfrase/interface';
import { useEffect, useState } from 'preact/hooks';
import { api, type Conta, type Convite } from '../api.ts';
import type { Aviso } from '../avisos.ts';
import { enderecoDe } from '../rotas.ts';
import { t, tr } from '../textos.ts';
import { MostrarAviso } from './entrar.tsx';
import { avisoEscola, dataCurta, nomeTurma } from './escolas.tsx';

/**
 * O link do e-mail de convite (/vernakula/convite/<código>): mostra a escola, a turma e
 * o papel. Quem não entrou entra ou cria a conta Ekfrase ali mesmo (com o
 * e-mail do convite preenchido); quem entrou aceita ou recusa.
 */
export function TelaConvite({
  codigo,
  conta,
  aoEntrar,
  aoAceitar,
}: {
  codigo: string;
  conta: Conta | null;
  /** Entrou ou criou a conta pelo formulário daqui. */
  aoEntrar: () => void;
  aoAceitar: (c: Conta, escola: number) => void;
}) {
  const [convite, setConvite] = useState<Convite | null | 'invalido'>(null);
  const [aviso, setAviso] = useState<Aviso | undefined>();
  const [ocupado, setOcupado] = useState(false);
  const [recusado, setRecusado] = useState(false);

  useEffect(() => {
    void api.verConvite(codigo).then((r) => {
      if (r.ok) setConvite(r.convite);
      else if (r.erro === 'codigo_invalido') setConvite('invalido');
      else setAviso(avisoEscola(r));
    });
  }, [codigo]);

  if (convite === 'invalido' || recusado) {
    return (
      <section class="painel entrar">
        <h1>{t(recusado ? 'vernakula.convite.recusado.titulo' : 'vernakula.convite.invalido.titulo')}</h1>
        <p>{t(recusado ? 'vernakula.convite.recusado.texto' : 'vernakula.convite.invalido.texto')}</p>
        <div class="acoes">
          <a class="botao" href={enderecoDe('entrada')}>
            {t('vernakula.menu.voltar')}
          </a>
        </div>
      </section>
    );
  }
  if (convite === null) return aviso ? <MostrarAviso aviso={aviso} /> : <p class="carregando">{t('nucleo.carregando')}</p>;

  async function responder(aceitar: boolean) {
    setOcupado(true);
    setAviso(undefined);
    if (aceitar) {
      const r = await api.aceitarConvite({ codigo });
      setOcupado(false);
      if (!r.ok) return setAviso(avisoEscola(r));
      return aoAceitar(r.conta, r.escola);
    }
    const r = await api.recusarConvite({ codigo });
    setOcupado(false);
    if (!r.ok) return setAviso(avisoEscola(r));
    setRecusado(true);
  }

  const c = convite;
  const outraConta = conta !== null && conta.email !== c.email;
  return (
    <section class="painel entrar convite" aria-labelledby="titulo-convite">
      <h1 id="titulo-convite">{t('vernakula.convite.titulo', { escola: c.escola ?? '' })}</h1>
      <dl class="ficha">
        <dt>{t('vernakula.convite.para')}</dt>
        <dd>
          {c.nome} <span class="dica">({c.email})</span>
        </dd>
        <dt>{t('vernakula.convite.como')}</dt>
        <dd>{t(`nucleo.papel.${c.papel}`)}</dd>
        {nomeTurma(c) && (
          <>
            <dt>{t('vernakula.convite.turma')}</dt>
            <dd>{nomeTurma(c)}</dd>
          </>
        )}
        <dt>{t('vernakula.convite.vale_ate')}</dt>
        <dd>{dataCurta(c.expira_em)}</dd>
      </dl>
      <MostrarAviso aviso={aviso} />
      {conta === null ? (
        <>
          <p>{t(c.tem_conta ? 'vernakula.convite.entre' : 'vernakula.convite.crie', { email: c.email })}</p>
          {/* criar conta com o convite: na hora, sem outro e-mail (o convite já provou o e-mail; X2c-2) */}
          <FormConta
            t={t}
            app="vernakula"
            idioma={tr.idioma()}
            inicial={c.tem_conta ? 'entrar' : 'criar'}
            podeCriar
            emailInicial={c.email}
            convite={codigo}
            aoEntrar={aoEntrar}
          />
        </>
      ) : (
        <>
          {outraConta && <p class="dica">{t('vernakula.convite.outra_conta', { sua: conta.email, email: c.email })}</p>}
          <div class="acoes">
            <button type="button" class="botao principal" disabled={ocupado} aria-busy={ocupado} onClick={() => void responder(true)}>
              {t('vernakula.convite.aceitar')}
            </button>
            <button type="button" class="botao" disabled={ocupado} onClick={() => void responder(false)}>
              {t('vernakula.convite.recusar')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
