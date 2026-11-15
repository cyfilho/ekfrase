// SPDX-License-Identifier: MPL-2.0

/**
 * Entrar, criar conta, esqueci a senha e senha nova: os mesmos em todo app que
 * usa o "online" (o Maker, o castelo). A conta é uma só no site inteiro.
 * O Vernákula tem a tela de entrar dele e usa este formulário para criar conta e no convite.
 */
import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { ambienteFechado } from './ambiente.ts';
import { criarConta, entrar, esqueciSenha, redefinirSenha, type Conta } from './ponte.ts';
import type { T } from './tipos.ts';

const ERROS = ['dados', 'vazio', 'email', 'senha_curta', 'email_usado', 'bloqueado', 'email_desligado', 'codigo_invalido', 'rede'];
function textoDoErro(t: T, codigo: string, extra: Record<string, unknown>): string {
  return ERROS.includes(codigo) ? t(`nucleo.conta.erro.${codigo}`, { minutos: Number(extra['minutos'] ?? 15) }) : t('nucleo.erro.servidor');
}

export type ModoConta = 'entrar' | 'criar' | 'esqueci';

let antesDoFormulario: ((modo: ModoConta) => VNode | null) | null = null;
/**
 * Um pedaço a mais ANTES do formulário de entrar e de criar conta, em todo lugar onde ele aparece
 * (a tela inicial do app, o botão da conta no topo). A casca do computador do Writer põe aqui o
 * "Servidor: ekfrase.com / Outro…" (no site não há: o navegador esbarra no CORS).
 */
export function definirAntesDoEntrar(f: ((modo: ModoConta) => VNode | null) | null): void {
  antesDoFormulario = f;
}

export function FormConta({
  t,
  app,
  idioma,
  inicial = 'entrar',
  podeCriar,
  emailInicial = '',
  aoEntrar,
}: {
  t: T;
  /** O app de onde a pessoa vem (o e-mail de "esqueci a senha" sai com a cara dele). */
  app: string;
  idioma: string;
  inicial?: ModoConta;
  podeCriar: boolean;
  /** O e-mail já preenchido (o do convite de uma escola). */
  emailInicial?: string;
  aoEntrar: (c: Conta) => void;
}) {
  const [modo, setModo] = useState<ModoConta>(inicial);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState(emailInicial);
  const [senha, setSenha] = useState('');
  const [robo, setRobo] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const trocar = (m: ModoConta) => {
    setModo(m);
    setErro('');
    setAviso('');
  };

  async function enviar(e: Event) {
    e.preventDefault();
    // lê do próprio formulário: o preenchimento automático de senha nem sempre avisa o campo
    const f = new FormData(e.currentTarget as HTMLFormElement);
    const v = (k: string) => String(f.get(k) ?? '');
    const email = v('email').trim();
    const senha = v('senha');
    setErro('');
    setOcupado(true);
    if (modo === 'esqueci') {
      const r = await esqueciSenha(email, app, idioma);
      setOcupado(false);
      if (r.ok) setAviso(t('nucleo.conta.esqueci.enviado'));
      else setErro(textoDoErro(t, r.erro, r));
      return;
    }
    const r = modo === 'entrar' ? await entrar(email, senha) : await criarConta({ nome: v('nome').trim(), email, senha, idioma, site: v('site') });
    setOcupado(false);
    if (r.ok) aoEntrar(r.conta);
    else setErro(textoDoErro(t, r.erro, r));
  }

  return (
    <>
      {antesDoFormulario?.(modo)}
      <form class="ekf-form" onSubmit={enviar} noValidate>
        {modo === 'esqueci' && <p class="ekf-dica">{t('nucleo.conta.esqueci.explicacao')}</p>}
        {modo === 'criar' && (
          <label class="ekf-campo">
            <span>{t('nucleo.conta.nome')}</span>
            <input name="nome" autoComplete="name" required maxLength={150} value={nome} onInput={(e) => setNome(e.currentTarget.value)} />
          </label>
        )}
        <label class="ekf-campo">
          <span>{t('nucleo.conta.email')}</span>
          <input name="email" type="email" autoComplete={modo === 'criar' ? 'email' : 'username'} required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        {modo !== 'esqueci' && (
          <label class="ekf-campo">
            <span>{t('nucleo.conta.senha')}</span>
            <input
              name="senha"
              type="password"
              autoComplete={modo === 'criar' ? 'new-password' : 'current-password'}
              required
              {...(modo === 'criar' ? { minLength: 8 } : {})}
              value={senha}
              onInput={(e) => setSenha(e.currentTarget.value)}
            />
            {modo === 'criar' && <small>{t('nucleo.conta.senha.ajuda')}</small>}
          </label>
        )}
        {modo === 'criar' && (
          // armadilha de robô: gente não vê nem preenche este campo
          <label class="ekf-robo" aria-hidden="true">
            <span>site</span>
            <input name="site" tabIndex={-1} autoComplete="off" value={robo} onInput={(e) => setRobo(e.currentTarget.value)} />
          </label>
        )}
        {modo === 'criar' && (
          <p class="ekf-aceite">
            {t('nucleo.conta.aceite.antes')}
            {ambienteFechado() ? (
              <>
                {t('nucleo.rodape.termos')}
                {t('nucleo.conta.aceite.e')}
                {t('nucleo.conta.aceite.privacidade')}
                {t('nucleo.conta.aceite.fechado')}
              </>
            ) : (
              <>
                <a href="/#/termos" target="_blank" rel="noopener">
                  {t('nucleo.rodape.termos')}
                </a>
                {t('nucleo.conta.aceite.e')}
                <a href="/#/privacidade" target="_blank" rel="noopener">
                  {t('nucleo.conta.aceite.privacidade')}
                </a>
                .
              </>
            )}
          </p>
        )}
        {erro && (
          <p class="ekf-erro" role="alert">
            {erro}
          </p>
        )}
        {aviso && (
          <p class="ekf-ok" role="status">
            {aviso}
          </p>
        )}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
            {t(`nucleo.conta.${modo}.botao`)}
          </button>
        </div>
        <p class="ekf-trocar">
          {modo === 'entrar' && (
            <>
              <button type="button" class="ekf-link" onClick={() => trocar('esqueci')}>
                {t('nucleo.conta.esqueci.link')}
              </button>
              {podeCriar && (
                <button type="button" class="ekf-link" onClick={() => trocar('criar')}>
                  {t('nucleo.conta.criar.link')}
                </button>
              )}
            </>
          )}
          {modo !== 'entrar' && (
            <button type="button" class="ekf-link" onClick={() => trocar('entrar')}>
              {t('nucleo.conta.entrar.link')}
            </button>
          )}
        </p>
      </form>
    </>
  );
}

/** A senha nova, pelo link do e-mail (`#/redefinir/<código>`). Já entra. */
export function FormRedefinir({ t, codigo, aoEntrar }: { t: T; codigo: string; aoEntrar: (c: Conta) => void }) {
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  return (
    <form
      class="ekf-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true);
        const r = await redefinirSenha(codigo, nova);
        setOcupado(false);
        if (r.ok) aoEntrar(r.conta);
        else setErro(textoDoErro(t, r.erro, r));
      }}
    >
      <label class="ekf-campo">
        <span>{t('nucleo.conta.senha_nova')}</span>
        <input type="password" autoComplete="new-password" required minLength={8} value={nova} onInput={(e) => setNova(e.currentTarget.value)} />
        <small>{t('nucleo.conta.senha.ajuda')}</small>
      </label>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      <div class="ekf-linha">
        <button type="submit" class="ekf-botao principal" disabled={ocupado}>
          {t('nucleo.conta.senha_nova.botao')}
        </button>
      </div>
    </form>
  );
}
