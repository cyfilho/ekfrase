// SPDX-License-Identifier: MPL-2.0

/**
 * Entrar, criar conta, esqueci a senha e senha nova: os mesmos em todo app que
 * usa o "online" (o Maker, o castelo). A conta é uma só no site inteiro.
 * O Vernákula tem a tela de entrar dele e usa este formulário para criar conta e no convite.
 */
import type { VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { ambienteFechado } from './ambiente.ts';
import { site } from './enderecos.ts';
import { PassosDoCadastro } from './Cadastro.tsx';
import { criarConta, entrar, modoDoCadastro, pedirCadastro, redefinir } from './chaves.ts';
import { mostrarSituacao } from './Chaves.tsx';
import { esqueciSenha, type Conta } from './ponte.ts';
import type { T } from './tipos.ts';

/** Os códigos com texto em `nucleo.conta.erro.<código>` (os da conta de sempre e os das chaves, X2). */
const ERROS = new Set([
  'dados', 'vazio', 'email', 'senha_curta', 'email_usado', 'bloqueado', 'email_desligado', 'codigo_invalido', 'rede',
  'senha_atual', 'antiga', 'versao', 'chaves', 'sem_sodium', 'kdf', 'assinatura', 'revogado', 'trancado', 'rebaixado', 'cofre',
  'kit_quantidade', 'kit_palavra', 'kit_conferencia', 'kit_outra_pessoa', 'sem_copia', 'pedido_vencido', 'cancelado',
  'nao_trancado', 'muitos', 'prova', 'outra_pessoa', 'nome', 'codigo_errado', 'codigo_recusado', 'servidor_antigo', 'recente',
]);
/** A chave do texto de um código de erro da conta (para quem guarda o aviso como chave, como o Vernákula). */
export function chaveDoErro(codigo: string): string {
  return ERROS.has(codigo) ? `nucleo.conta.erro.${codigo}` : 'nucleo.erro.servidor';
}
/** O texto de um código de erro da conta (o que não tem texto vira "algo deu errado no servidor"). */
export function textoDoErro(t: T, codigo: string, extra: Record<string, unknown> = {}): string {
  return t(chaveDoErro(codigo), { minutos: Number(extra['minutos'] ?? 15), restam: Number(extra['restam'] ?? 0) });
}

/** A barra "Protegendo a sua senha" (o Argon2id leva alguns segundos; `fracao` de 0 a 1, ou `null` = escondida). */
export function BarraDaSenha({ t, fracao }: { t: T; fracao: number | null }) {
  if (fracao === null) return null;
  const pct = Math.round(Math.min(1, Math.max(0, fracao)) * 100);
  return (
    <div class="ekf-barra-senha" role="status">
      <span id="ekf-barra-senha-rotulo">{t('nucleo.conta.protegendo')}</span>
      <div class="ekf-barra" role="progressbar" aria-labelledby="ekf-barra-senha-rotulo" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <small>{t('nucleo.conta.protegendo.dica')}</small>
    </div>
  );
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
  convite,
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
  /**
   * O código do convite de escola (o Vernákula): criar conta com ele cria na hora, sem outro e-mail (o convite já
   * provou o e-mail, que tem de ser o dele).
   */
  convite?: string;
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
  const [progresso, setProgresso] = useState<number | null>(null);
  // X2c-2: como o servidor cria conta. "email" = em dois passos (sem a senha no primeiro); "direto" = na hora
  const [cadastro, setCadastro] = useState<'email' | 'direto' | null>(null);
  // o passo 1 foi: a espera pelo código (o nome e o e-mail pedidos)
  const [pedido, setPedido] = useState<{ nome: string; email: string } | null>(null);
  const comSenha = modo !== 'criar' || Boolean(convite) || cadastro === 'direto';

  useEffect(() => {
    if (modo === 'criar' && !convite && cadastro === null) void modoDoCadastro().then((r) => r.ok && setCadastro(r.modo));
  }, [modo, convite, cadastro]);

  const trocar = (m: ModoConta) => {
    setModo(m);
    setErro('');
    setAviso('');
  };

  if (modo === 'criar' && pedido) {
    return (
      <>
        {antesDoFormulario?.(modo)}
        <PassosDoCadastro t={t} app={app} idioma={idioma} nome={pedido.nome} email={pedido.email} aoEntrar={aoEntrar} aoVoltar={() => (setPedido(null), setErro(''))} />
      </>
    );
  }

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
    const o = { idioma, aoProgredir: setProgresso };
    if (modo === 'criar' && !convite) {
      // o servidor pode ter mudado (a casca do Writer: "Servidor: Outro…"): pergunta de novo
      const m = await modoDoCadastro();
      if (!m.ok) {
        setOcupado(false);
        return setErro(textoDoErro(t, m.erro, m));
      }
      setCadastro(m.modo);
      if (m.modo === 'email') {
        const p = await pedirCadastro({ nome: v('nome').trim(), email, idioma, app, site: v('site') });
        setOcupado(false);
        if (!p.ok) return setErro(textoDoErro(t, p.erro, p));
        if (p.modo === 'email') return setPedido({ nome: v('nome').trim(), email: email.toLowerCase() });
        setCadastro('direto');
        return; // um servidor que mudou de ideia: o campo da senha aparece
      }
      if (!comSenha) {
        setOcupado(false);
        return; // o servidor cria na hora: agora o campo da senha aparece
      }
    }
    const r =
      modo === 'entrar'
        ? await entrar(email, senha, o)
        : await criarConta({ nome: v('nome').trim(), email, senha, idioma, site: v('site'), app, ...(convite ? { convite } : {}) }, o);
    setOcupado(false);
    setProgresso(null);
    if (r.ok) {
      aoEntrar(r.conta);
      mostrarSituacao(t, r.situacao, idioma); // o kit (a pessoa nasceu) ou o cofre trancado, por cima de tudo
    } else setErro(textoDoErro(t, r.erro, r));
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
        {modo === 'criar' && !comSenha && <p class="ekf-dica">{t('nucleo.cadastro.passo1')}</p>}
        {modo !== 'esqueci' && comSenha && (
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
                <a href={site.pagina('termos')} target="_blank" rel="noopener">
                  {t('nucleo.rodape.termos')}
                </a>
                {t('nucleo.conta.aceite.e')}
                <a href={site.pagina('privacidade')} target="_blank" rel="noopener">
                  {t('nucleo.conta.aceite.privacidade')}
                </a>
                .
              </>
            )}
          </p>
        )}
        <BarraDaSenha t={t} fracao={progresso} />
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
            {t(modo === 'criar' && !comSenha ? 'nucleo.cadastro.continuar' : `nucleo.conta.${modo}.botao`)}
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
export function FormRedefinir({ t, codigo, idioma, aoEntrar }: { t: T; codigo: string; idioma?: string; aoEntrar: (c: Conta) => void }) {
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  return (
    <form
      class="ekf-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setErro('');
        setOcupado(true);
        const r = await redefinir(codigo, nova, { aoProgredir: setProgresso, ...(idioma ? { idioma } : {}) });
        setOcupado(false);
        setProgresso(null);
        if (r.ok) {
          aoEntrar(r.conta);
          // a conta de antes nasce com o kit; a que já tinha chaves fica com o cofre trancado
          mostrarSituacao(t, r.situacao, idioma);
        } else setErro(textoDoErro(t, r.erro, r));
      }}
    >
      <label class="ekf-campo">
        <span>{t('nucleo.conta.senha_nova')}</span>
        <input type="password" autoComplete="new-password" required minLength={8} value={nova} onInput={(e) => setNova(e.currentTarget.value)} />
        <small>{t('nucleo.conta.senha.ajuda')}</small>
      </label>
      <BarraDaSenha t={t} fracao={progresso} />
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
