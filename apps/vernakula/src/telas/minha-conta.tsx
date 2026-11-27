// SPDX-License-Identifier: MPL-2.0

import { BarraDaSenha, ChavesDaConta, chaves, mostrarKit } from '@ekfrase/interface';
import { aplicarTema, temaAtual, type Tema } from '@ekfrase/nucleo';
import { useState } from 'preact/hooks';
import { api, type Conta, type Escola } from '../api.ts';
import { avisoDaConta, avisoDoErro, type Aviso } from '../avisos.ts';
import { t, tr } from '../textos.ts';
import { MostrarAviso } from './entrar.tsx';

const ERROS = ['senha_atual', 'email_em_uso', 'email', 'senha_curta', 'vazio', 'proibido'] as const;

/**
 * Minha conta: nome, e-mail, senha, as chaves da conta (o kit de recuperação e "Seus aparelhos", as mesmas de Minha
 * conta Ekfrase) e, para a administração, o nome da escola. A senha não vai à ponte (X2): vai a prova dela.
 */
export function MinhaConta({ conta, escola, aoMudar }: { conta: Conta; escola: Escola | undefined; aoMudar: (c: Conta) => void }) {
  const ehAdmin = !!escola?.papeis.includes('admin');
  return (
    <div class="pilha">
      <p>
        <a href="#">← {t('vernakula.menu.voltar')}</a>
      </p>
      <h1>{t('vernakula.conta.titulo')}</h1>
      <Perfil conta={conta} aoMudar={aoMudar} />
      <Senha />
      <ChavesDaConta t={t} idioma={tr.idioma()} classe="painel" />
      <Aparencia />
      {ehAdmin && escola && <Escola id={escola.id} nome={escola.nome} aoMudar={aoMudar} />}
    </div>
  );
}

function Perfil({ conta, aoMudar }: { conta: Conta; aoMudar: (c: Conta) => void }) {
  const [nome, setNome] = useState(conta.nome);
  const [email, setEmail] = useState(conta.email);
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [aviso, setAviso] = useState<Aviso | undefined>();
  const mudouEmail = email.trim().toLowerCase() !== conta.email;

  async function enviar(e: Event) {
    e.preventDefault();
    if (!nome.trim() || !email.trim()) return setAviso({ chave: 'vernakula.conta.erro.vazio' });
    if (mudouEmail && !senha) return setAviso({ chave: 'vernakula.conta.erro.senha_atual' });
    setOcupado(true);
    setAviso(undefined);
    // trocar o e-mail pede a prova da senha (a chave de entrar), nunca a senha
    const prova = mudouEmail ? await chaves.provaDaSenha(senha, { aoProgredir: setProgresso }) : null;
    setProgresso(null);
    if (prova && !prova.ok) {
      setOcupado(false);
      return setAviso(avisoDaConta(prova, 'vernakula.conta.erro', ERROS));
    }
    const r = await api.perfil({ nome: nome.trim(), email: email.trim(), ...(prova?.ok ? prova.campos : {}) });
    setOcupado(false);
    if (!r.ok) return setAviso(avisoDaConta(r, 'vernakula.conta.erro', ERROS));
    setSenha('');
    setAviso({ chave: 'vernakula.conta.salvo', tipo: 'ok' });
    aoMudar(r.conta);
  }

  return (
    <section class="painel" aria-labelledby="titulo-perfil">
      <h2 id="titulo-perfil">{t('vernakula.conta.perfil')}</h2>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.conta.nome')}
          <input type="text" autocomplete="name" value={nome} onInput={(e) => setNome(e.currentTarget.value)} />
        </label>
        <label>
          {t('vernakula.entrar.email')}
          <input type="email" autocomplete="email" inputMode="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        {mudouEmail && (
          <label>
            {t('vernakula.conta.senha_atual')}
            <small class="dica">{t('vernakula.conta.senha_atual_dica')}</small>
            <input type="password" autocomplete="current-password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} />
          </label>
        )}
        <BarraDaSenha t={t} fracao={progresso} />
        <MostrarAviso aviso={aviso} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.conta.salvando') : t('vernakula.conta.salvar')}
        </button>
      </form>
    </section>
  );
}

/** Trocar a senha: o cofre das chaves é refeito com a nova (a conta de antes ganha as chaves e o kit aparece). */
function Senha() {
  const [d, setD] = useState({ atual: '', nova: '', repetir: '' });
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const [aviso, setAviso] = useState<Aviso | undefined>();
  const campo = (k: keyof typeof d) => ({
    value: d[k],
    onInput: (e: Event) => setD({ ...d, [k]: (e.currentTarget as HTMLInputElement).value }),
  });

  async function enviar(e: Event) {
    e.preventDefault();
    if (!d.atual || !d.nova) return setAviso({ chave: 'vernakula.conta.erro.vazio' });
    if (d.nova !== d.repetir) return setAviso({ chave: 'vernakula.conta.erro.repetir' });
    setOcupado(true);
    setAviso(undefined);
    const r = await chaves.trocarSenha(d.atual, d.nova, { idioma: tr.idioma(), aoProgredir: setProgresso });
    setOcupado(false);
    setProgresso(null);
    if (!r.ok) return setAviso(avisoDaConta(r, 'vernakula.conta.erro', ERROS));
    setD({ atual: '', nova: '', repetir: '' });
    setAviso({ chave: 'vernakula.conta.senha_trocada', tipo: 'ok' });
    if (r.kit) mostrarKit(t, r.kit);
  }

  return (
    <section class="painel" aria-labelledby="titulo-senha">
      <h2 id="titulo-senha">{t('vernakula.conta.senha_titulo')}</h2>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.conta.senha_atual')}
          <input type="password" autocomplete="current-password" {...campo('atual')} />
        </label>
        <label>
          {t('vernakula.conta.nova')}
          <input type="password" autocomplete="new-password" {...campo('nova')} />
        </label>
        <label>
          {t('vernakula.conta.repetir')}
          <input type="password" autocomplete="new-password" {...campo('repetir')} />
        </label>
        <BarraDaSenha t={t} fracao={progresso} />
        <MostrarAviso aviso={aviso} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.conta.salvando') : t('vernakula.conta.trocar')}
        </button>
      </form>
    </section>
  );
}

function Escola({ id, nome: inicial, aoMudar }: { id: number; nome: string; aoMudar: (c: Conta) => void }) {
  const [nome, setNome] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | undefined>();

  async function enviar(e: Event) {
    e.preventDefault();
    if (!nome.trim()) return setAviso({ chave: 'vernakula.conta.erro.vazio' });
    setOcupado(true);
    const r = await api.renomearEscola(id, nome.trim());
    setOcupado(false);
    if (!r.ok) return setAviso(avisoDoErro(r, 'vernakula.conta.erro', ERROS));
    setAviso({ chave: 'vernakula.conta.salvo', tipo: 'ok' });
    aoMudar(r.conta);
  }

  return (
    <section class="painel" aria-labelledby="titulo-escola">
      <h2 id="titulo-escola">{t('vernakula.conta.escola_titulo')}</h2>
      <form onSubmit={enviar} noValidate>
        <label>
          {t('vernakula.conta.escola_nome')}
          <input type="text" autocomplete="organization" value={nome} onInput={(e) => setNome(e.currentTarget.value)} />
        </label>
        <MostrarAviso aviso={aviso} />
        <button type="submit" class="botao principal" disabled={ocupado} aria-busy={ocupado}>
          {ocupado ? t('vernakula.conta.salvando') : t('vernakula.conta.salvar')}
        </button>
      </form>
    </section>
  );
}

/** Aparência: além do botão do topo (claro/escuro), aqui dá para voltar a seguir o aparelho. */
function Aparencia() {
  const [tema, setTema] = useState<Tema>(temaAtual());
  return (
    <section class="painel" aria-labelledby="titulo-aparencia">
      <h2 id="titulo-aparencia">{t('nucleo.tema.aparencia')}</h2>
      <p>{t('nucleo.tema.explicacao')}</p>
      <label>
        {t('nucleo.tema.rotulo')}
        <select
          value={tema}
          onChange={(e) => {
            const v = e.currentTarget.value as Tema;
            setTema(v);
            aplicarTema(v);
            // O botão do topo lê o tema ao desenhar; recarregar a tela não é preciso: ele se ajusta no próximo clique.
            dispatchEvent(new Event('ekfrase-tema'));
          }}
        >
          <option value="sistema">{t('nucleo.tema.sistema')}</option>
          <option value="claro">{t('nucleo.tema.claro')}</option>
          <option value="escuro">{t('nucleo.tema.escuro')}</option>
        </select>
      </label>
    </section>
  );
}
