// SPDX-License-Identifier: MPL-2.0

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, type Convite, type Escola, type PainelEscola, type Resultado, type Turma } from '../api.ts';
import type { Aviso } from '../avisos.ts';
import { t, tr } from '../textos.ts';
import { MostrarAviso } from './entrar.tsx';
import { avisoEscola, dataCurta, nomeTurma } from './escolas.tsx';

/** Como no Vernákula antigo: cursos, turmas, cadastro e matrícula são da coordenação (G e C); os papéis, da administração (A). */
const COORDENA = ['coord_geral', 'coordenacao'];
export const podeAdministrar = (e: Escola | undefined) => !!e?.papeis.some((p) => p === 'admin' || COORDENA.includes(p));

const PAPEIS = ['admin', 'coord_geral', 'coordenacao', 'docente', 'discente'] as const;
type Aba = 'turmas' | 'pessoas' | 'pendentes' | 'permissoes';

/** Faz a ação na ponte; deu certo: recarrega o painel. Deu errado: o aviso. */
type Agir = (p: Promise<Resultado<object>>, ok?: Aviso) => Promise<boolean>;

/**
 * A administração da escola: cursos e turmas (quem está em cada uma e quem
 * está pendente), as pessoas, os cadastros pendentes (convites que ainda não
 * foram abertos) e, só para a administração, as permissões.
 */
export function Administracao({ escola }: { escola: Escola }) {
  const coordena = escola.papeis.some((p) => COORDENA.includes(p));
  const admin = escola.papeis.includes('admin');
  const [painel, setPainel] = useState<PainelEscola | null>(null);
  const [aba, setAba] = useState<Aba>('turmas');
  const [aviso, setAviso] = useState<Aviso | undefined>();

  function carregar() {
    void api.painel(escola.id).then((r) => {
      if (r.ok) setPainel(r);
      else setAviso(avisoEscola(r));
    });
  }
  useEffect(carregar, [escola.id]);

  const agir: Agir = async (p, ok) => {
    setAviso(undefined);
    const r = await p;
    if (!r.ok) {
      setAviso(avisoEscola(r));
      return false;
    }
    if (ok) setAviso({ ...ok, tipo: 'ok' });
    carregar();
    return true;
  };

  const abas: Aba[] = ['turmas', 'pessoas', 'pendentes', ...(admin ? (['permissoes'] as const) : [])];
  return (
    <div class="pilha">
      <p>
        <a href="#">← {t('vernakula.menu.voltar')}</a>
      </p>
      <h1>{t('vernakula.admin.titulo')}</h1>
      <div class="abas" role="tablist" aria-label={t('vernakula.admin.titulo')}>
        {abas.map((a) => (
          <button key={a} type="button" role="tab" class="botao pequeno" aria-selected={aba === a} onClick={() => setAba(a)}>
            {t(`vernakula.admin.aba.${a}`, { count: painel?.convites.length ?? 0 })}
          </button>
        ))}
      </div>
      <div aria-live="polite">
        <MostrarAviso aviso={aviso} />
      </div>
      {!painel && !aviso && <p class="carregando">{t('nucleo.carregando')}</p>}
      {painel && aba === 'turmas' && <AbaTurmas painel={painel} coordena={coordena} agir={agir} />}
      {painel && aba === 'pessoas' && <AbaPessoas painel={painel} coordena={coordena} agir={agir} />}
      {painel && aba === 'pendentes' && <AbaPendentes convites={painel.convites} coordena={coordena} agir={agir} />}
      {painel && aba === 'permissoes' && admin && <AbaPermissoes painel={painel} agir={agir} />}
    </div>
  );
}

// ---------------------------------------------------------------- turmas

function AbaTurmas({ painel, coordena, agir }: { painel: PainelEscola; coordena: boolean; agir: Agir }) {
  const [curso, setCurso] = useState('');
  return (
    <>
      {painel.cursos.length === 0 && <p class="painel">{t(coordena ? 'vernakula.admin.cursos.nenhum' : 'vernakula.admin.cursos.nenhum_ver')}</p>}
      {painel.cursos.map((c) => (
        <section key={c.id} class="painel curso" aria-label={c.nome}>
          <div class="linha-titulo">
            <h2>{c.nome}</h2>
            {coordena && (
              <NomeEditavel nome={c.nome} aoSalvar={(nome) => agir(api.renomearCurso(c.id, nome))}>
                {c.turmas.length === 0 && (
                  <button
                    type="button"
                    class="botao pequeno"
                    onClick={() => confirm(t('vernakula.admin.cursos.apagar_confirma', { nome: c.nome })) && void agir(api.apagarCurso(c.id))}
                  >
                    {t('vernakula.admin.apagar')}
                  </button>
                )}
              </NomeEditavel>
            )}
          </div>
          {c.turmas.length === 0 && <p class="dica">{t('vernakula.admin.turmas.nenhuma')}</p>}
          {c.turmas.map((tu) => (
            <CartaoTurma key={tu.id} turma={tu} curso={c.nome} painel={painel} coordena={coordena} agir={agir} />
          ))}
          {coordena && <NovaTurma curso={c.id} agir={agir} />}
        </section>
      ))}
      {coordena && (
        <form
          class="painel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!curso.trim()) return;
            void agir(api.criarCurso(painel.escola.id, curso.trim())).then((ok) => ok && setCurso(''));
          }}
        >
          <label>
            {t('vernakula.admin.cursos.novo')}
            <input maxLength={100} value={curso} placeholder={t('vernakula.admin.cursos.exemplo')} onInput={(e) => setCurso(e.currentTarget.value)} />
          </label>
          <div>
            <button type="submit" class="botao">
              {t('vernakula.admin.cursos.criar')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}

function NovaTurma({ curso, agir }: { curso: number; agir: Agir }) {
  const [nome, setNome] = useState('');
  return (
    <form
      class="linha-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!nome.trim()) return;
        void agir(api.criarTurma(curso, nome.trim())).then((ok) => ok && setNome(''));
      }}
    >
      <label>
        {t('vernakula.admin.turmas.nova')}
        <input maxLength={100} value={nome} placeholder={t('vernakula.admin.turmas.exemplo')} onInput={(e) => setNome(e.currentTarget.value)} />
      </label>
      <button type="submit" class="botao pequeno">
        {t('vernakula.admin.turmas.criar')}
      </button>
    </form>
  );
}

function CartaoTurma({ turma, curso, painel, coordena, agir }: { turma: Turma; curso: string; painel: PainelEscola; coordena: boolean; agir: Agir }) {
  const [quem, setQuem] = useState('');
  const docentes = turma.pessoas.filter((p) => p.papel === 'docente');
  const discentes = turma.pessoas.filter((p) => p.papel === 'discente');
  // Quem já é da escola com o papel e ainda não está nesta turma com ele.
  const podeEntrar = painel.pessoas.flatMap((p) =>
    (['docente', 'discente'] as const)
      .filter((papel) => p.papeis.includes(papel) && !turma.pessoas.some((x) => x.id === p.id && x.papel === papel))
      .map((papel) => ({ valor: `${p.id}|${papel}`, rotulo: `${p.nome} (${t(`nucleo.papel.${papel}`)})` })),
  );
  return (
    <details class="turma">
      <summary>
        <strong>{turma.nome}</strong>{' '}
        <span class="dica">
          {t('vernakula.admin.turmas.resumo', { count: turma.pessoas.length })}
          {turma.pendentes.length > 0 && ` · ${t('vernakula.admin.turmas.pendentes', { count: turma.pendentes.length })}`}
        </span>
      </summary>
      <div class="turma-miolo">
        {coordena && (
          <NomeEditavel nome={turma.nome} aoSalvar={(nome) => agir(api.renomearTurma(turma.id, nome))}>
            {turma.pessoas.length === 0 && turma.pendentes.length === 0 && (
              <button
                type="button"
                class="botao pequeno"
                onClick={() => confirm(t('vernakula.admin.turmas.apagar_confirma', { nome: `${curso} — ${turma.nome}` })) && void agir(api.apagarTurma(turma.id))}
              >
                {t('vernakula.admin.apagar')}
              </button>
            )}
          </NomeEditavel>
        )}
        {[
          ['docente', docentes],
          ['discente', discentes],
        ].map(([papel, lista]) => (
          <div key={papel as string}>
            <h3>{t(`vernakula.admin.turmas.grupo.${papel as string}`, { count: (lista as Turma['pessoas']).length })}</h3>
            <ul class="lista">
              {(lista as Turma['pessoas']).map((p) => (
                <li key={p.id} class="item-lista">
                  <span>{p.nome}</span>
                  {coordena && (
                    <button type="button" class="botao pequeno" onClick={() => void agir(api.desmatricular(turma.id, p.id, p.papel))}>
                      {t('vernakula.admin.turmas.tirar')}
                    </button>
                  )}
                </li>
              ))}
              {turma.pendentes
                .filter((c) => c.papel === papel)
                .map((c) => (
                  <li key={`c${c.id}`} class="item-lista pendente">
                    <span>
                      {c.nome} <span class="dica">({c.email})</span>
                    </span>
                    <span class="situacao aberto">{t('vernakula.admin.pendente')}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {coordena && (
          <>
            <FormCadastro escola={painel.escola.id} turma={turma.id} agir={agir} />
            {podeEntrar.length > 0 && (
              <form
                class="linha-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const [conta, papel] = quem.split('|');
                  if (!conta || !papel) return;
                  void agir(api.matricular(turma.id, Number(conta), papel)).then((ok) => ok && setQuem(''));
                }}
              >
                <label>
                  {t('vernakula.admin.turmas.da_escola')}
                  <select value={quem} onChange={(e) => setQuem(e.currentTarget.value)}>
                    <option value="">{t('vernakula.admin.turmas.escolha')}</option>
                    {podeEntrar.map((o) => (
                      <option key={o.valor} value={o.valor}>
                        {o.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" class="botao pequeno" disabled={!quem}>
                  {t('vernakula.admin.turmas.matricular')}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/** Cadastrar uma pessoa (com a turma, se houver): sai o convite por e-mail; quem já é da escola entra direto. */
function FormCadastro({ escola, turma, agir }: { escola: number; turma: number | null; agir: Agir }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState<'discente' | 'docente'>('discente');
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<Aviso | undefined>();

  async function enviar(e: Event) {
    e.preventDefault();
    if (!nome.trim() || !email.trim()) return;
    setOcupado(true);
    setFeito(undefined);
    let matriculado = false;
    const ok = await agir(
      api.convidar(escola, { nome: nome.trim(), email: email.trim(), papel, turma, idioma: tr.idioma() }).then((r) => {
        matriculado = r.ok && r.matriculado === true;
        return r;
      }),
    );
    setOcupado(false);
    if (!ok) return;
    setFeito({ chave: matriculado ? 'vernakula.admin.cadastro.matriculado' : 'vernakula.admin.cadastro.enviado', p: { email: email.trim() }, tipo: 'ok' });
    setNome('');
    setEmail('');
  }

  return (
    <form class="cadastro" onSubmit={enviar} noValidate>
      <h3>{t(turma === null ? 'vernakula.admin.cadastro.titulo_escola' : 'vernakula.admin.cadastro.titulo_turma')}</h3>
      <label>
        {t('vernakula.admin.cadastro.nome')}
        <input maxLength={150} autoComplete="off" value={nome} onInput={(e) => setNome(e.currentTarget.value)} />
      </label>
      <label>
        {t('vernakula.admin.cadastro.email')}
        <input type="email" inputMode="email" autoComplete="off" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
      </label>
      <label>
        {t('vernakula.admin.cadastro.papel')}
        <select value={papel} onChange={(e) => setPapel(e.currentTarget.value as 'discente' | 'docente')}>
          <option value="discente">{t('nucleo.papel.discente')}</option>
          <option value="docente">{t('nucleo.papel.docente')}</option>
        </select>
      </label>
      <p class="dica">{t('vernakula.admin.cadastro.dica')}</p>
      <MostrarAviso aviso={feito} />
      <div>
        <button type="submit" class="botao principal" disabled={ocupado || !nome.trim() || !email.trim()} aria-busy={ocupado}>
          {t('vernakula.admin.cadastro.enviar')}
        </button>
      </div>
    </form>
  );
}

/** O nome com o botão Renomear (e o que mais vier ao lado, como Apagar). */
function NomeEditavel({ nome, aoSalvar, children }: { nome: string; aoSalvar: (nome: string) => Promise<boolean>; children?: ComponentChildren }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(nome);
  if (!editando) {
    return (
      <div class="linha-acoes">
        <button
          type="button"
          class="botao pequeno"
          onClick={() => {
            setValor(nome);
            setEditando(true);
          }}
        >
          {t('vernakula.admin.renomear')}
        </button>
        {children}
      </div>
    );
  }
  return (
    <form
      class="linha-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valor.trim()) return;
        void aoSalvar(valor.trim()).then((ok) => ok && setEditando(false));
      }}
    >
      <label>
        <span class="so-leitor">{t('vernakula.admin.renomear')}</span>
        <input maxLength={100} value={valor} onInput={(e) => setValor(e.currentTarget.value)} />
      </label>
      <button type="submit" class="botao pequeno principal">
        {t('vernakula.admin.salvar')}
      </button>
      <button type="button" class="botao pequeno" onClick={() => setEditando(false)}>
        {t('vernakula.admin.cancelar')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- pessoas

function AbaPessoas({ painel, coordena, agir }: { painel: PainelEscola; coordena: boolean; agir: Agir }) {
  const turmasDe = (id: number) =>
    painel.cursos.flatMap((c) => c.turmas.filter((tu) => tu.pessoas.some((p) => p.id === id)).map((tu) => `${c.nome} — ${tu.nome}`));
  return (
    <>
      <section class="painel">
        <h2>{t('vernakula.admin.pessoas.titulo', { count: painel.pessoas.length })}</h2>
        <ul class="lista">
          {painel.pessoas.map((p) => {
            const turmas = turmasDe(p.id);
            return (
              <li key={p.id} class="item-lista">
                <div>
                  <strong>{p.nome}</strong> <span class="dica">{p.email}</span>
                  <br />
                  <span class="dica">{turmas.length ? turmas.join(' · ') : t('vernakula.admin.pessoas.sem_turma')}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {coordena && (
        <section class="painel">
          <FormCadastro escola={painel.escola.id} turma={null} agir={agir} />
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- pendentes

function AbaPendentes({ convites, coordena, agir }: { convites: Convite[]; coordena: boolean; agir: Agir }) {
  return (
    <section class="painel">
      <h2>{t('vernakula.admin.pendentes.titulo')}</h2>
      <p class="dica">{t('vernakula.admin.pendentes.explicacao')}</p>
      {convites.length === 0 && <p>{t('vernakula.admin.pendentes.nenhum')}</p>}
      <ul class="lista">
        {convites.map((c) => (
          <li key={c.id} class="item-lista">
            <div>
              <strong>{c.nome}</strong> <span class="dica">{c.email}</span>
              <br />
              <span class="dica">
                {t(`nucleo.papel.${c.papel}`)}
                {nomeTurma(c) && ` · ${nomeTurma(c)}`}
              </span>
              <br />
              <span class={`situacao ${c.vencido ? 'recusado' : 'aberto'}`}>
                {t(c.vencido ? 'vernakula.admin.pendentes.vencido' : 'vernakula.admin.pendentes.vale', { enviado: dataCurta(c.enviado_em), ate: dataCurta(c.expira_em) })}
              </span>
            </div>
            {coordena && (
              <div class="linha-acoes">
                <button type="button" class="botao pequeno" onClick={() => void agir(api.reenviarConvite(c.id), { chave: 'vernakula.admin.cadastro.enviado', p: { email: c.email } })}>
                  {t('vernakula.admin.pendentes.reenviar')}
                </button>
                <button
                  type="button"
                  class="botao pequeno"
                  onClick={() => confirm(t('vernakula.admin.pendentes.cancelar_confirma', { nome: c.nome })) && void agir(api.cancelarConvite(c.id))}
                >
                  {t('vernakula.admin.pendentes.cancelar')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- permissões (só a administração)

function AbaPermissoes({ painel, agir }: { painel: PainelEscola; agir: Agir }) {
  return (
    <section class="painel">
      <h2>{t('vernakula.admin.permissoes.titulo')}</h2>
      <p class="dica">{t('vernakula.admin.permissoes.explicacao')}</p>
      <ul class="lista">
        {painel.pessoas.map((p) => (
          <Permissoes key={`${p.id}|${p.papeis.join()}`} escola={painel.escola.id} pessoa={p} agir={agir} />
        ))}
      </ul>
    </section>
  );
}

function Permissoes({ escola, pessoa, agir }: { escola: number; pessoa: PainelEscola['pessoas'][number]; agir: Agir }) {
  const [marcados, setMarcados] = useState<string[]>(pessoa.papeis);
  const mudou = [...marcados].sort().join() !== [...pessoa.papeis].sort().join();
  return (
    <li class="item-lista permissoes">
      <fieldset>
        <legend>
          <strong>{pessoa.nome}</strong> <span class="dica">{pessoa.email}</span>
        </legend>
        {PAPEIS.map((p) => (
          <label key={p} class="marcar">
            <input
              type="checkbox"
              checked={marcados.includes(p)}
              onChange={(e) => {
                const sim = e.currentTarget.checked;
                setMarcados((m) => (sim ? [...m, p] : m.filter((x) => x !== p)));
              }}
            />
            {t(`nucleo.papel.${p}`)}
          </label>
        ))}
        {marcados.length === 0 && <p class="dica">{t('vernakula.admin.permissoes.sai')}</p>}
        <div>
          <button
            type="button"
            class="botao pequeno principal"
            disabled={!mudou}
            onClick={() =>
              (marcados.length > 0 || confirm(t('vernakula.admin.permissoes.sai_confirma', { nome: pessoa.nome }))) &&
              void agir(api.mudarPapeis(escola, pessoa.id, marcados), { chave: 'vernakula.admin.permissoes.salvo', p: { nome: pessoa.nome } })
            }
          >
            {t('vernakula.admin.salvar')}
          </button>
        </div>
      </fieldset>
    </li>
  );
}
