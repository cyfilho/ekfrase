// SPDX-License-Identifier: MPL-2.0

/**
 * Conversa com a ponte (ekfrase.com/api/v1). Toda resposta é `{ ok: true, … }`
 * ou `{ ok: false, erro: '<código>', … }`. O código do erro vira texto pelos
 * arquivos de idioma, nunca pela mensagem do servidor.
 */

export interface Conta {
  id: number;
  nome: string;
  email: string;
  papeis: string[];
  organizacoes: { id: number; nome: string; papeis: string[] }[];
}

/** Textos da escola: idioma → chave → texto (só o que a escola trocou). */
export type TextosEscola = Record<string, Record<string, string>>;

/** Um arquivo guardado na ponte (PDF, áudio, vídeo, slides, imagem…). */
export interface Arquivo {
  id: number;
  nome: string;
  mime: string;
  grupo: 'documento' | 'apresentacao' | 'planilha' | 'audio' | 'video' | 'imagem' | 'outro';
  tamanho: number;
  url: string;
}

export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string; [extra: string]: unknown };

let csrf = '';

async function pedir<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1/${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(metodo === 'POST' ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    return { ok: false, erro: 'rede' };
  }
  let dados: unknown;
  try {
    dados = await resposta.json();
  } catch {
    return { ok: false, erro: 'servidor' };
  }
  if (typeof dados !== 'object' || dados === null || !('ok' in dados)) return { ok: false, erro: 'servidor' };
  const d = dados as Resultado<T> & { csrf?: string };
  if (typeof d.csrf === 'string') csrf = d.csrf;
  return d;
}

/**
 * Envia um arquivo com barra de progresso (por isso XMLHttpRequest, e não
 * fetch: o fetch ainda não informa o progresso do envio).
 */
function enviarArquivo(
  arquivo: File,
  organizacao: number,
  aoProgredir?: (fracao: number) => void,
): Promise<Resultado<{ arquivo: Arquivo }>> {
  return new Promise((resolver) => {
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    dados.append('organizacao', String(organizacao));
    const x = new XMLHttpRequest();
    x.open('POST', '/api/v1/arquivos');
    x.setRequestHeader('X-CSRF-Token', csrf);
    x.setRequestHeader('Accept', 'application/json');
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir?.(e.loaded / e.total);
    };
    x.onerror = () => resolver({ ok: false, erro: 'rede' });
    x.onload = () => {
      try {
        const d = JSON.parse(x.responseText) as Resultado<{ arquivo: Arquivo }> & { csrf?: string };
        if (typeof d.csrf === 'string') csrf = d.csrf;
        // O servidor web (não a ponte) recusa arquivo grande demais sem JSON: 413 vira "grande".
        resolver(d);
      } catch {
        resolver({ ok: false, erro: x.status === 413 ? 'grande' : 'servidor' });
      }
    };
    x.send(dados);
  });
}

export const api = {
  eu: () => pedir<{ conta: Conta | null; instalacao?: true }>('GET', 'conta/eu'),
  /** Primeiro acesso de um site recém-instalado (só funciona enquanto não há conta nenhuma). */
  primeira: (dados: { codigo: string; organizacao: string; nome: string; email: string; senha: string }) =>
    pedir<{ conta: Conta }>('POST', 'conta/primeira', dados),
  entrar: (email: string, senha: string) => pedir<{ conta: Conta }>('POST', 'conta/entrar', { email, senha }),
  sair: () => pedir<object>('POST', 'conta/sair', {}),
  /** Manda o link de senha nova (a ponte responde igual tenha ou não conta). */
  esqueci: (email: string, idioma: string) => pedir<object>('POST', 'conta/esqueci', { email, idioma, app: 'vernakula' }),
  /** Grava a senha nova com o código do link do e-mail e já entra. */
  redefinir: (codigo: string, nova: string) => pedir<{ conta: Conta }>('POST', 'conta/redefinir', { codigo, nova }),
  perfil: (dados: { nome: string; email: string; senha_atual?: string }) => pedir<{ conta: Conta }>('POST', 'conta/perfil', dados),
  senha: (dados: { senha_atual: string; nova: string }) => pedir<object>('POST', 'conta/senha', dados),
  renomearEscola: (id: number, nome: string) => pedir<{ conta: Conta }>('POST', `organizacoes/${id}`, { nome }),
  /** As trocas de texto da escola (idioma → chave → texto). */
  textos: (organizacao: number) => pedir<{ textos: TextosEscola }>('GET', `textos?organizacao=${organizacao}`),
  /** Texto vazio volta ao padrão. */
  salvarTexto: (dados: { organizacao: number; idioma: string; chave: string; texto: string }) => pedir<object>('POST', 'textos', dados),
  enviarArquivo,
};
