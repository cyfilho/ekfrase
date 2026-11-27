// SPDX-License-Identifier: MPL-2.0

/**
 * @ekfrase/identidade — a identidade por chaves da família Ekfrase (DEC-P077, `docs/ARQUITETURA.md` §5 e §13.3).
 * O formato de cada coisa, para quem fizer uma implementação em outra linguagem: `docs/protocolo/identidade/README.md`.
 */
export { apagar, doBase64url, iguais, paraBase64url } from './bytes.ts';
export { bytesCanonicos, canonico, ErroCanonico, textoCanonicoValido, type ValorCanonico } from './canonico.ts';
export {
  assinar,
  conferirAssinatura,
  enderecoDe,
  enderecoValido,
  esquecer,
  identidadeDaSemente,
  novaSementeDeAparelho,
  publicasDoJson,
  publicasParaJson,
  segredoReticulum,
  TAMANHOS_DE_SEMENTE,
  type ChavesPublicas,
  type ChavesPublicasJson,
  type Identidade,
} from './chaves.ts';
export {
  conferirAparelho,
  conferirCertificado,
  conferirRevogacao,
  CONTEXTO_CERTIFICADO,
  CONTEXTO_REVOGACAO,
  emitirCertificado,
  NOME_MAXIMO,
  nomeDeAparelho,
  revogarAparelho,
  type AparelhoConferido,
  type CertificadoDeAparelho,
  type ErroDeCertificado,
  type Revogacao,
} from './certificado.ts';
export { abrirCaixa, abrirCaixaComSegredo, fecharCaixa, SOBRA_DA_CAIXA } from './caixa.ts';
export {
  chaveDeDocumento,
  Chaveiro,
  cifrarComChave,
  decifrarComChave,
  entregarChave,
  novaChaveDeDocumento,
  receberChave,
  type ChaveDeDocumento,
} from './documento.ts';
export { idiomaDoKit, lerKit, novoKit, palavrasDaSemente, separarPalavras, type ErroDoKit, type IdiomaDoKit, type Kit, type KitLido } from './kit.ts';
export {
  abrirCofre,
  abrirComSenha,
  ARGON2ID_MAXIMO,
  assinarCofre,
  conferirCofreAssinado,
  CONTEXTO_COFRE,
  ARGON2ID_MINIMO,
  ARGON2ID_PADRAO,
  derivarDaSenha,
  fecharCofre,
  fecharComSenha,
  lerCofre,
  novosParametros,
  parametrosValidos,
  trocarSenha,
  type ChavesDaSenha,
  type Cofre,
  type OpcoesDaSenha,
  type ParametrosDaSenha,
} from './cofre.ts';
export { apresentarAparelho, levarSemente, novaPessoa, novoAparelho, pessoaDoKit, receberSemente, type AparelhoNovo, type PessoaNova } from './pessoa.ts';
export {
  abrirComChaveDeCaixa,
  chaveDeCaixa,
  conferirDeclaracaoDeCaixa,
  contextoDeGeracao,
  CONTEXTO_DECLARACAO_DE_CAIXA,
  declararCaixa,
  GERACAO_MAXIMA,
  publicaDaGeracao,
  type ChaveDeCaixa,
  type DeclaracaoConferida,
  type DeclaracaoDeCaixa,
} from './geracoes.ts';
export {
  abrirGuardado,
  assinarPedido,
  codigoDoAparelho,
  conferirPedido,
  CONTEXTO_PEDIDO,
  CONTEXTO_SESSAO,
  guardarSemente,
  provarSessao,
  type AcaoDoPedido,
  type Guardado,
  type PedidoDoAparelho,
} from './guarda.ts';
