// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'preact/hooks';
import { api, type Conta, type Convite, type Escola, type PedidoEscola } from '../api.ts';
import { avisoDoErro, type Aviso } from '../avisos.ts';
import { irPara } from '../rotas.ts';
import { t, tr } from '../textos.ts';
import { MostrarAviso } from './entrar.tsx';

/** Os códigos de erro da ponte que têm texto próprio nas telas de escola. */
export const ERROS_ESCOLA = [
  'vazio', 'email', 'dados', 'pedido_aberto', 'ja_convidado', 'nao_vazio', 'ultimo_admin', 'recente', 'sem_papel',
  'email_desligado', 'codigo_invalido', 'proibido', 'nao_achado', 'turma', 'fora',
] as const;
export const avisoEscola = (r: { erro: string; [k: string]: unknown }) => avisoDoErro(r, 'vernakula.escolas.erro', ERROS_ESCOLA);

// ---------------------------------------------------------------- a escola escolhida

const GUARDADA = 'vernakula.escola';

/** A escola da última vez (à prova de janela privada). */
export function escolaGuardada(): number | null {
  try {
    const n = Number(localStorage.getItem(GUARDADA));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function guardarEscola(id: number): void {
  try {
    localStorage.setItem(GUARDADA, String(id));
  } catch {
    /* sem armazenamento: escolhe de novo da próxima vez */
  }
}

/** Uma escola só: é ela. Várias: a escolhida (se ainda for da pessoa); senão, nenhuma (a pessoa escolhe). */
export function escolaAtual(conta: Conta, escolhida: number | null): Escola | undefined {
  if (conta.organizacoes.length === 1) return conta.organizacoes[0];
  return conta.organizacoes.find((o) => o.id === escolhida);
}

export const dataCurta = (s: string) => new Date(s.replace(' ', 'T')).toLocaleDateString(tr.idioma(), { day: '2-digit', month: '2-digit', year: 'numeric' });

/** "Inglês — Inglês 1", ou nada se o convite não tem turma. */
export const nomeTurma = (c: { curso_nome: string | null; turma_nome: string | null }) =>
  c.turma_nome === null ? '' : `${c.curso_nome ?? ''} — ${c.turma_nome}`;

// ---------------------------------------------------------------- minhas escolas

/**
 * As escolas a que a pessoa tem acesso (escolhe uma), os convites que chegaram
 * para o e-mail dela e os pedidos de cadastro de escola que ela fez. Sem
 * escola nenhuma, é a primeira tela de quem entra.
 */
export function MinhasEscolas({
  conta,
  aoEscolher,
  aoMudarConta,
}: {
  conta: Conta;
  aoEscolher: (id: number) => void;
  aoMudarConta: (c: Conta) => void;
}) {
  const [convites, setConvites] = useState<Convite[] | null>(null);
  const [pedidos, setPedidos] = useState<PedidoEscola[] | null>(null);
  const [aviso, setAviso] = useState<Aviso | undefined>();
  const [ocupado, setOcupado] = useState(false);

  function carregar() {
    void api.convitesMeus().then((r) => setConvites(r.ok ? r.convites : []));
    void api.meusPedidos().then((r) => setPedidos(r.ok ? r.pedidos : []));
  }
  useEffect(carregar, [conta.id]);

  async function responder(c: Convite, aceitar: boolean) {
    setOcupado(true);
    setAviso(undefined);
    if (aceitar) {
      const r = await api.aceitarConvite({ id: c.id });
      setOcupado(false);
      if (!r.ok) return setAviso(avisoEscola(r));
      aoMudarConta(r.conta);
      return aoEscolher(r.escola);
    }
    const r = await api.recusarConvite({ id: c.id });
    setOcupado(false);
    if (!r.ok) return setAviso(avisoEscola(r));
    setAviso({ chave: 'vernakula.escolas.convite_recusado', tipo: 'ok' });
    carregar();
  }

  const escolas = conta.organizacoes;
  const aberto = pedidos?.some((p) => p.situacao === 'aberto') ?? false;

  return (
    <div class="pilha">
      {escolas.length > 0 && (
        <p>
          <a href="#">← {t('vernakula.menu.voltar')}</a>
        </p>
      )}
      <h1>{escolas.length > 0 ? t('vernakula.escolas.titulo') : t('vernakula.escolas.nenhuma.titulo')}</h1>
      {escolas.length === 0 && <p>{t('vernakula.escolas.nenhuma.texto')}</p>}
      <MostrarAviso aviso={aviso} />

      {escolas.length > 0 && (
        <ul class="cartoes-escola" aria-label={t('vernakula.escolas.lista')}>
          {escolas.map((e) => (
            <li key={e.id}>
              <button type="button" class="botao cartao-escola" onClick={() => aoEscolher(e.id)}>
                {e.nome}
              </button>
            </li>
          ))}
        </ul>
      )}

      {convites && convites.length > 0 && (
        <section class="painel" aria-labelledby="titulo-convites">
          <h2 id="titulo-convites">{t('vernakula.escolas.convites.titulo')}</h2>
          <ul class="lista">
            {convites.map((c) => (
              <li key={c.id} class="item-lista">
                <div>
                  <strong>{c.escola}</strong>
                  <br />
                  <span class="dica">
                    {nomeTurma(c)
                      ? t('vernakula.escolas.convites.com_turma', { papel: t(`nucleo.papel.${c.papel}`), turma: nomeTurma(c) })
                      : t(`nucleo.papel.${c.papel}`)}
                  </span>
                </div>
                <div class="linha-acoes">
                  <button type="button" class="botao principal pequeno" disabled={ocupado} onClick={() => void responder(c, true)}>
                    {t('vernakula.convite.aceitar')}
                  </button>
                  <button type="button" class="botao pequeno" disabled={ocupado} onClick={() => void responder(c, false)}>
                    {t('vernakula.convite.recusar')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section class="painel" aria-labelledby="titulo-pedidos">
        <h2 id="titulo-pedidos">{t('vernakula.escolas.pedidos.titulo')}</h2>
        <p class="dica">{t('vernakula.escolas.pedidos.explicacao')}</p>
        {pedidos && pedidos.length > 0 && (
          <ul class="lista">
            {pedidos.map((p) => (
              <li key={p.id} class="item-lista">
                <div>
                  <strong>{p.nome}</strong> <span class="dica">({p.cidade})</span>
                  <br />
                  <span class={`situacao ${p.situacao}`}>{t(`vernakula.escolas.pedidos.${p.situacao}`, { data: dataCurta(p.criado_em) })}</span>
                  {p.situacao === 'recusado' && p.motivo && <p class="dica">{t('vernakula.escolas.pedidos.motivo', { motivo: p.motivo })}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {!aberto && (
          <div class="acoes">
            <a class="botao" href="#/pedir">
              {t('vernakula.escolas.pedir.botao')}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- pedir uma escola

/** O pedido de cadastro de uma escola: a equipe Ekfrase confere e responde por e-mail. */
export function PedirEscola({ temEscola }: { temEscola: boolean }) {
  const [nome, setNome] = useState('');
  const [cidade, setCidade] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | undefined>();
  const [feito, setFeito] = useState(false);

  async function enviar(e: Event) {
    e.preventDefault();
    if (!nome.trim() || !cidade.trim() || !mensagem.trim()) return setAviso({ chave: 'vernakula.escolas.erro.vazio' });
    setOcupado(true);
    setAviso(undefined);
    const r = await api.pedirEscola({ nome: nome.trim(), cidade: cidade.trim(), mensagem: mensagem.trim(), idioma: tr.idioma() });
    setOcupado(false);
    if (!r.ok) return setAviso(avisoEscola(r));
    setFeito(true);
  }

  return (
    <div class="pilha">
      <p>
        <a href="#/escolas">← {t(temEscola ? 'vernakula.escolas.voltar' : 'vernakula.menu.voltar')}</a>
      </p>
      <h1>{t('vernakula.escolas.pedir.titulo')}</h1>
      {feito ? (
        <section class="painel">
          <p class="aviso-ok" role="status">
            {t('vernakula.escolas.pedir.enviado')}
          </p>
          <div class="acoes">
            <button type="button" class="botao" onClick={() => irPara('escolas')}>
              {t('vernakula.escolas.voltar')}
            </button>
          </div>
        </section>
      ) : (
        <section class="painel">
          <p>{t('vernakula.escolas.pedir.explicacao')}</p>
          <form onSubmit={enviar} noValidate>
            <label>
              {t('vernakula.escolas.pedir.nome')}
              <input maxLength={150} value={nome} onInput={(e) => setNome(e.currentTarget.value)} />
            </label>
            <label>
              {t('vernakula.escolas.pedir.cidade')}
              <input maxLength={150} autoComplete="address-level2" value={cidade} onInput={(e) => setCidade(e.currentTarget.value)} />
            </label>
            <label>
              {t('vernakula.escolas.pedir.mensagem')}
              <textarea rows={4} maxLength={2000} value={mensagem} onInput={(e) => setMensagem(e.currentTarget.value)} />
              <small class="dica">{t('vernakula.escolas.pedir.mensagem_dica')}</small>
            </label>
            <MostrarAviso aviso={aviso} />
            <div>
              <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
                {t('vernakula.escolas.pedir.enviar')}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
