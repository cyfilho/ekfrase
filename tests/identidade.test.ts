// SPDX-License-Identifier: MPL-2.0

/**
 * packages/identidade (X1, DEC-P077): os vetores oficiais das peças (RFC 8032, 7748, 5869, 9106, 9180 e o rascunho
 * do XChaCha20-Poly1305; o BIP39 da Trezor), os casos congelados do protocolo (`docs/protocolo/identidade/*.json`),
 * o comportamento de cada parte, a recuperação de ponta a ponta e a conferência cruzada com o `sodium` do PHP (o
 * que a ponte vai usar na X2; pulada se não houver PHP com sodium).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  abrirCaixa,
  abrirCofre,
  abrirComChaveDeCaixa,
  abrirGuardado,
  abrirComSenha,
  apresentarAparelho,
  ARGON2ID_PADRAO,
  assinar,
  assinarCofre,
  assinarPedido,
  chaveDeCaixa,
  codigoDoAparelho,
  conferirCofreAssinado,
  conferirDeclaracaoDeCaixa,
  conferirPedido,
  contextoDeGeracao,
  CONTEXTO_SESSAO,
  declararCaixa,
  guardarSemente,
  provarSessao,
  bytesCanonicos,
  canonico,
  chaveDeDocumento,
  Chaveiro,
  cifrarComChave,
  conferirAparelho,
  conferirAssinatura,
  conferirCertificado,
  conferirRevogacao,
  decifrarComChave,
  derivarDaSenha,
  doBase64url,
  emitirCertificado,
  entregarChave,
  enderecoDe,
  ErroCanonico,
  fecharCaixa,
  fecharCofre,
  fecharComSenha,
  identidadeDaSemente,
  iguais,
  lerCofre,
  lerKit,
  levarSemente,
  novaChaveDeDocumento,
  novaPessoa,
  novoAparelho,
  novoKit,
  novosParametros,
  palavrasDaSemente,
  paraBase64url,
  parametrosValidos,
  pessoaDoKit,
  publicasDoJson,
  publicasParaJson,
  receberChave,
  receberSemente,
  revogarAparelho,
  segredoReticulum,
  trocarSenha,
  novaSementeDeAparelho,
  type ParametrosDaSenha,
  type PedidoDoAparelho,
  type ValorCanonico,
} from '@ekfrase/identidade';
import { _abrirHpke, _derivarParHpke, _selarHpke } from '../packages/identidade/src/caixa.ts';

const RAIZ = join(import.meta.dirname, '..');
const caso = <T>(nome: string): T => JSON.parse(readFileSync(join(RAIZ, 'docs', 'protocolo', 'identidade', nome), 'utf8')) as T;
const h = hexToBytes;
const seq = (de: number, n: number) => Uint8Array.from({ length: n }, (_, i) => (de + i) & 0xff);

// ------------------------------------------------------------------------------------------------------------
describe('as peças: vetores oficiais', () => {
  it('Ed25519 (RFC 8032 §7.1, testes 1 a 3)', () => {
    const casos = [
      ['9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', '', 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
      ['4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb', '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', '72', '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
      ['c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7', 'fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025', 'af82', '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'],
    ] as const;
    for (const [segredo, publica, msg, assinatura] of casos) {
      expect(bytesToHex(ed25519.getPublicKey(h(segredo)))).toBe(publica);
      expect(bytesToHex(ed25519.sign(h(msg), h(segredo)))).toBe(assinatura);
      expect(ed25519.verify(h(assinatura), h(msg), h(publica), { zip215: false })).toBe(true);
    }
  });

  it('X25519 (RFC 7748 §6.1)', () => {
    const a = h('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const b = h('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb');
    expect(bytesToHex(x25519.getPublicKey(a))).toBe('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a');
    expect(bytesToHex(x25519.getPublicKey(b))).toBe('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    const k = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742';
    expect(bytesToHex(x25519.getSharedSecret(a, x25519.getPublicKey(b)))).toBe(k);
    expect(bytesToHex(x25519.getSharedSecret(b, x25519.getPublicKey(a)))).toBe(k);
  });

  it('HKDF-SHA256 (RFC 5869 A.1)', () => {
    const okm = hkdf(sha256, h('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'), h('000102030405060708090a0b0c'), h('f0f1f2f3f4f5f6f7f8f9'), 42);
    expect(bytesToHex(okm)).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha-03 A.3.1)', () => {
    const texto = h('4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e');
    const c = xchacha20poly1305(h('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f'), h('404142434445464748494a4b4c4d4e4f5051525354555657'), h('50515253c0c1c2c3c4c5c6c7')).encrypt(texto);
    expect(bytesToHex(c)).toBe(
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52e' +
        'c0875924c1c7987947deafd8780acf49',
    );
  });

  it('Argon2id (RFC 9106 §5.3; o @noble não tem o argon2 auditado, por isso também a conferência com o PHP abaixo)', () => {
    const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), { t: 3, m: 32, p: 4, dkLen: 32, key: new Uint8Array(8).fill(3), personalization: new Uint8Array(12).fill(4) });
    expect(bytesToHex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it('HPKE modo base, DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, ChaCha20Poly1305 (RFC 9180 A.2.1)', () => {
    const e = _derivarParHpke(h('909a9b35d3dc4713a5e72a4da274b55d3d3821a37e5d099e74a647db583a904b'));
    const r = _derivarParHpke(h('1ac01f181fdf9f352797655161c58b75c656a6cc2716dcb66372da835542e1df'));
    expect(bytesToHex(e.segredo)).toBe('f4ec9b33b792c372c1d2c2063507b684ef925b8c75a42dbcbf57d63ccd381600');
    expect(bytesToHex(e.publica)).toBe('1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a');
    expect(bytesToHex(r.segredo)).toBe('8057991eef8f1f1af18f4a9491d16a1ce333f695d4db8e38da75975c4478e0fb');
    expect(bytesToHex(r.publica)).toBe('4310ee97d88cc1f088a5576c77ab0cf5c3ac797f3d95139c6c84b5429c59662a');
    const info = h('4f6465206f6e2061204772656369616e2055726e');
    const aad = h('436f756e742d30');
    const pt = h('4265617574792069732074727574682c20747275746820626561757479');
    const { enc, cifrado } = _selarHpke(r.publica, info, aad, pt, e.segredo);
    expect(bytesToHex(enc)).toBe('1afa08d3dec047a643885163f1180476fa7ddb54c6a8029ea33f95796bf2ac4a');
    expect(bytesToHex(cifrado)).toBe('1c5250d8034ec2b784ba2cfd69dbdb8af406cfe3ff938e131f0def8c8b60b4db21993c62ce81883d2dd1b51a28');
    expect(bytesToHex(_abrirHpke(r.segredo, enc, info, aad, cifrado)!)).toBe(bytesToHex(pt));
    expect(_abrirHpke(r.segredo, enc, info, h('436f756e742d31'), cifrado)).toBeNull();
  });

  it('BIP39 em inglês (vetores da Trezor, 128 bits)', () => {
    const casos = [
      ['00000000000000000000000000000000', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
      ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow'],
      ['80808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'],
      ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
    ] as const;
    for (const [semente, frase] of casos) {
      expect(palavrasDaSemente(h(semente), 'en').join(' ')).toBe(frase);
      const lido = lerKit(frase);
      expect(lido.ok && bytesToHex(lido.semente)).toBe(semente);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------
type IdCaso = { semente: string; segredos: { assinar: string; cifrar: string }; publicas: { assinar: string; cifrar: string }; endereco: string };

describe('os casos congelados do protocolo (docs/protocolo/identidade)', () => {
  it('chaves.json: semente → segredos, públicas e endereço; assinaturas com contexto', () => {
    const c = caso<{ identidades: IdCaso[]; assinaturas: { semente: string; contexto: string; mensagem: string; assinatura: string }[] }>('chaves.json');
    for (const i of c.identidades) {
      const id = identidadeDaSemente(h(i.semente));
      expect(bytesToHex(id.segredos.assinar)).toBe(i.segredos.assinar);
      expect(bytesToHex(id.segredos.cifrar)).toBe(i.segredos.cifrar);
      expect(publicasParaJson(id.publicas)).toEqual(i.publicas);
      expect(id.endereco).toBe(i.endereco);
    }
    for (const a of c.assinaturas) {
      const id = identidadeDaSemente(h(a.semente));
      expect(bytesToHex(assinar(id, a.contexto, h(a.mensagem)))).toBe(a.assinatura);
      expect(conferirAssinatura(id.publicas.assinar, a.contexto, h(a.mensagem), h(a.assinatura))).toBe(true);
    }
  });

  it('canonico.json', () => {
    const c = caso<{ casos: { valor: ValorCanonico; canonico: string }[]; recusados: { valor: ValorCanonico }[] }>('canonico.json');
    for (const x of c.casos) expect(canonico(x.valor)).toBe(x.canonico);
    for (const x of c.recusados) expect(() => canonico(x.valor)).toThrow(ErroCanonico);
  });

  it('certificados.json: as conferências', () => {
    const c = caso<{ certificados: unknown[]; revogacoes: unknown[]; conferir: { certificado: number; revogacoes: number[]; pessoa: string; resultado: { ok: boolean; aparelho?: string; erro?: string } }[] }>('certificados.json');
    for (const x of c.conferir) {
      const r = conferirAparelho(c.certificados[x.certificado], { pessoa: x.pessoa, revogacoes: x.revogacoes.map((i) => c.revogacoes[i]) });
      if (x.resultado.ok) expect(r.ok && r.aparelho).toBe(x.resultado.aparelho);
      else expect(!r.ok && r.erro).toBe(x.resultado.erro);
    }
    // e são exatamente o que a pessoa assina hoje (a assinatura Ed25519 é determinística)
    const pessoa = identidadeDaSemente(seq(0, 16));
    expect(emitirCertificado(pessoa, identidadeDaSemente(seq(0x20, 32)).publicas, 'Notebook da Ana', 1795000000000)).toEqual(c.certificados[0]);
  });

  it('caixa.json: abre (e fecha igual com a mesma chave de uso único)', () => {
    const c = caso<{ casos: { semente_destino: string; contexto: string; efemero: string; dados: string; caixa: string }[] }>('caixa.json');
    for (const x of c.casos) {
      const id = identidadeDaSemente(h(x.semente_destino));
      expect(bytesToHex(abrirCaixa(id, x.contexto, h(x.caixa))!)).toBe(x.dados);
      const { enc, cifrado } = _selarHpke(id.publicas.cifrar, utf8ToBytes(`ekfrase/caixa/${x.contexto}`), new Uint8Array(0), h(x.dados), h(x.efemero));
      expect(bytesToHex(enc) + bytesToHex(cifrado)).toBe(x.caixa);
    }
  });

  it('documento.json', () => {
    const c = caso<{ casos: { doc: string; epoca: number; chave: string; aad: string; dados: string; cifrado: string }[] }>('documento.json');
    for (const x of c.casos) {
      const k = chaveDeDocumento(x.doc, x.epoca, h(x.chave));
      expect(bytesToHex(decifrarComChave(k, h(x.cifrado), h(x.aad))!)).toBe(x.dados);
    }
  });

  it('kit.json: semente ↔ palavras nas duas línguas', () => {
    const c = caso<{ casos: { semente: string; pt: string; en: string }[] }>('kit.json');
    for (const x of c.casos) {
      expect(palavrasDaSemente(h(x.semente), 'pt').join(' ')).toBe(x.pt);
      expect(palavrasDaSemente(h(x.semente), 'en').join(' ')).toBe(x.en);
      for (const frase of [x.pt, x.en]) {
        const lido = lerKit(frase);
        expect(lido.ok && bytesToHex(lido.semente)).toBe(x.semente);
      }
    }
  });

  it('geracoes.json: as gerações da chave de caixa, a declaração, o cofre assinado, a guarda, o código e a prova da sessão (X2)', () => {
    type G = {
      semente_da_pessoa: string;
      pessoa: { publicas: { assinar: string; cifrar: string }; endereco: string };
      geracoes: { geracao: number; segredo: string; publica: string }[];
      declaracao: Record<string, unknown>;
      cofre: { cofre: unknown; assinatura: string };
      aparelho: { semente: string; endereco: string; codigo: string };
      guarda: { aparelho: string; guarda: string; guardado: unknown; semente: string };
      entrega_de_geracao: { contexto: string; caixa: string; segredo: string };
      sessao: { desafio: string; prova: string };
      pedido: { tirar: PedidoDoAparelho; cancelar: PedidoDoAparelho };
    };
    const c = caso<G>('geracoes.json');
    const semente = h(c.semente_da_pessoa);
    for (const g of c.geracoes) {
      const k = chaveDeCaixa(semente, g.geracao);
      expect(bytesToHex(k.segredo)).toBe(g.segredo);
      expect(paraBase64url(k.publica)).toBe(g.publica);
    }
    // a declaração é determinística (Ed25519) e confere
    expect(declararCaixa(semente, 1, 1795000000000)).toEqual(c.declaracao);
    expect(conferirDeclaracaoDeCaixa(c.declaracao)).toMatchObject({ pessoa: c.pessoa.endereco, geracao: 1 });
    const pessoa = identidadeDaSemente(semente);
    expect(assinarCofre(pessoa, c.cofre.cofre as never)).toBe(c.cofre.assinatura);
    expect(conferirCofreAssinado(pessoa.publicas.assinar, c.cofre.cofre, c.cofre.assinatura)).toBe(true);
    const aparelho = identidadeDaSemente(h(c.aparelho.semente));
    expect(aparelho.endereco).toBe(c.aparelho.endereco);
    expect(codigoDoAparelho(aparelho.publicas)).toBe(c.aparelho.codigo);
    expect(bytesToHex(abrirGuardado(c.guarda.guardado, doBase64url(c.guarda.guarda)!, c.guarda.aparelho)!)).toBe(c.guarda.semente);
    expect(bytesToHex(abrirCaixa(aparelho, c.entrega_de_geracao.contexto, doBase64url(c.entrega_de_geracao.caixa)!)!)).toBe(c.entrega_de_geracao.segredo);
    expect(provarSessao(aparelho, c.sessao.desafio)).toBe(c.sessao.prova);
    // X2c-4: o pedido assinado pelo aparelho (determinístico) e a conferência dele
    for (const p of [c.pedido.tirar, c.pedido.cancelar]) {
      expect(assinarPedido(aparelho, p.pessoa, p.acao, p.alvo, p.desafio)).toEqual(p);
      expect(conferirPedido(p, aparelho.publicas.assinar, p.desafio)).toBe(true);
    }
  });

  it('o pedido assinado pelo aparelho: formato estrito, o desafio certo e a chave do aparelho (X2c-4)', () => {
    const ap = identidadeDaSemente(novaSementeDeAparelho());
    const outro = identidadeDaSemente(novaSementeDeAparelho());
    const pessoa = '3b98041e2b6b0799c6db09d32d30a928';
    const d = 'ab'.repeat(32);
    const p = assinarPedido(ap, pessoa, 'tirar', outro.endereco, d);
    expect(conferirPedido(p, ap.publicas.assinar, d)).toBe(true);
    expect(conferirPedido(p, ap.publicas.assinar, 'cd'.repeat(32))).toBe(false); // outro desafio
    expect(conferirPedido(p, outro.publicas.assinar, d)).toBe(false); // outra chave
    expect(conferirPedido({ ...p, alvo: pessoa }, ap.publicas.assinar, d)).toBe(false); // mudou o que foi assinado
    expect(conferirPedido({ ...p, extra: 1 }, ap.publicas.assinar, d)).toBe(false);
    const { alvo: _, ...semAlvo } = p;
    expect(conferirPedido(semAlvo, ap.publicas.assinar, d)).toBe(false);
    expect(conferirPedido(assinarPedido(ap, pessoa, 'ver', null, d), ap.publicas.assinar, d)).toBe(true);
    // o alvo só no tirar, e nunca o próprio aparelho
    expect(() => assinarPedido(ap, pessoa, 'tirar', null, d)).toThrow(RangeError);
    expect(() => assinarPedido(ap, pessoa, 'tirar', ap.endereco, d)).toThrow(RangeError);
    expect(() => assinarPedido(ap, pessoa, 'cancelar', outro.endereco, d)).toThrow(RangeError);
    expect(() => assinarPedido(ap, pessoa, 'ver', null, 'curto')).toThrow(RangeError);
    expect(() => assinarPedido(ap, 'XYZ', 'ver', null, d)).toThrow(RangeError);
  });

  it('cofre.json: a senha dá as mesmas chaves e abre o cofre', async () => {
    const c = caso<{ casos: { senha: string; kdf: ParametrosDaSenha; mestra: string; entrar: string; chave_do_cofre: string; cofre: unknown; segredo: string }[] }>('cofre.json');
    for (const x of c.casos) {
      const ch = await derivarDaSenha(x.senha, x.kdf);
      expect(bytesToHex(ch.entrar)).toBe(x.entrar);
      expect(bytesToHex(ch.cofre)).toBe(x.chave_do_cofre);
      expect(bytesToHex(abrirCofre(x.cofre, ch.cofre)!)).toBe(x.segredo);
      // a mesma senha digitada em NFD (o "ç" do Mac) dá o mesmo
      const nfd = await derivarDaSenha(x.senha.normalize('NFD'), x.kdf);
      expect(bytesToHex(nfd.entrar)).toBe(x.entrar);
    }
  });
});

// ------------------------------------------------------------------------------------------------------------
describe('bytes e JSON canônico', () => {
  it('base64url: ida e volta, e uma escrita só por valor', () => {
    for (let n = 0; n < 70; n++) {
      const b = seq(n * 7, n);
      expect(bytesToHex(doBase64url(paraBase64url(b))!)).toBe(bytesToHex(b));
    }
    expect(doBase64url('AA')).not.toBeNull();
    expect(doBase64url('AB')).toBeNull(); // bits de sobra diferentes de zero
    expect(doBase64url('AA==')).toBeNull();
    expect(doBase64url('A+/=')).toBeNull();
    expect(doBase64url('A')).toBeNull();
  });

  it('iguais', () => {
    expect(iguais(seq(1, 5), seq(1, 5))).toBe(true);
    expect(iguais(seq(1, 5), seq(2, 5))).toBe(false);
    expect(iguais(seq(1, 5), seq(1, 4))).toBe(false);
  });

  it('canônico: ordem das chaves, e o que é recusado', () => {
    expect(canonico({ b: [1, { d: null, c: 'ç' }], a: true })).toBe('{"a":true,"b":[1,{"c":"ç","d":null}]}');
    expect(() => canonico(-0)).toThrow(ErroCanonico);
    expect(() => canonico(Number.NaN)).toThrow(ErroCanonico);
    expect(() => canonico('solto ' + String.fromCharCode(0xd800))).toThrow(ErroCanonico);
    expect(() => canonico({ a: undefined } as unknown as ValorCanonico)).toThrow(ErroCanonico);
    expect(new TextDecoder().decode(bytesCanonicos({ x: 'ã' }))).toBe('{"x":"ã"}');
  });
});

describe('chaves e assinaturas', () => {
  it('a mesma semente dá a mesma identidade; o endereço é o do Reticulum', () => {
    const a = identidadeDaSemente(seq(9, 16));
    const b = identidadeDaSemente(seq(9, 16));
    expect(a.endereco).toBe(b.endereco);
    expect(a.endereco).toMatch(/^[0-9a-f]{32}$/);
    expect(a.endereco).toBe(bytesToHex(sha256(new Uint8Array([...a.publicas.cifrar, ...a.publicas.assinar])).subarray(0, 16)));
    expect(enderecoDe(a.publicas)).toBe(a.endereco);
    expect(bytesToHex(segredoReticulum(a))).toBe(bytesToHex(a.segredos.cifrar) + bytesToHex(a.segredos.assinar));
    expect(() => identidadeDaSemente(seq(0, 20))).toThrow(RangeError);
  });

  it('as públicas em JSON: ida e volta; tamanho errado ou ponto inválido, null', () => {
    const id = identidadeDaSemente(seq(3, 32));
    const j = publicasParaJson(id.publicas);
    expect(bytesToHex(publicasDoJson(j)!.assinar)).toBe(bytesToHex(id.publicas.assinar));
    expect(publicasDoJson({ ...j, cifrar: 'AAAA' })).toBeNull();
    expect(publicasDoJson({ assinar: j.assinar })).toBeNull();
    expect(publicasDoJson(null)).toBeNull();
    // um y que não está na curva (o 2 não é a coordenada de ponto nenhum do Ed25519)
    const fora = new Uint8Array(32);
    fora[0] = 2;
    expect(ed25519.utils.isValidPublicKey(fora, false)).toBe(false);
    expect(publicasDoJson({ ...j, assinar: paraBase64url(fora) })).toBeNull();
    // o ponto neutro (ordem pequena): é um ponto da curva, mas não serve de chave
    const neutro = new Uint8Array(32);
    neutro[0] = 1;
    expect(ed25519.utils.isValidPublicKey(neutro, false)).toBe(true);
    expect(publicasDoJson({ ...j, assinar: paraBase64url(neutro) })).toBeNull();
    // e a "assinatura" trivial com ele não passa na conferência estrita
    const trivial = new Uint8Array(64);
    trivial[0] = 1;
    expect(conferirAssinatura(neutro, 'teste', utf8ToBytes('qualquer'), trivial)).toBe(false);
  });

  it('o contexto separa as assinaturas; mexer na mensagem derruba', () => {
    const id = identidadeDaSemente(seq(1, 16));
    const msg = utf8ToBytes('mensagem');
    const s = assinar(id, 'envelope', msg);
    expect(conferirAssinatura(id.publicas.assinar, 'envelope', msg, s)).toBe(true);
    expect(conferirAssinatura(id.publicas.assinar, 'certificado-aparelho', msg, s)).toBe(false);
    expect(conferirAssinatura(id.publicas.assinar, 'envelope', utf8ToBytes('mensagen'), s)).toBe(false);
    expect(conferirAssinatura(identidadeDaSemente(seq(2, 16)).publicas.assinar, 'envelope', msg, s)).toBe(false);
    expect(conferirAssinatura(id.publicas.assinar, 'Contexto Ruim', msg, s)).toBe(false);
    expect(conferirAssinatura(id.publicas.assinar, 'envelope', msg, s.subarray(0, 63))).toBe(false);
    expect(() => assinar(id, 'Contexto Ruim', msg)).toThrow(RangeError);
  });

  it('a conferência é estrita: a mesma assinatura com S + L (não canônica) é recusada', () => {
    const id = identidadeDaSemente(seq(1, 16));
    const msg = utf8ToBytes('x');
    const s = assinar(id, 'teste', msg);
    // S fica nos 32 últimos bytes, little-endian; soma-se a ordem L do grupo
    const L = 2n ** 252n + 27742317777372353535851937790883648493n;
    let S = 0n;
    for (let i = 63; i >= 32; i--) S = (S << 8n) | BigInt(s[i]!);
    let S2 = S + L;
    const ruim = new Uint8Array(s);
    for (let i = 32; i < 64; i++) {
      ruim[i] = Number(S2 & 0xffn);
      S2 >>= 8n;
    }
    expect(S2).toBe(0n); // coube nos 32 bytes
    expect(conferirAssinatura(id.publicas.assinar, 'teste', msg, ruim)).toBe(false);
  });
});

describe('certificados e revogação', () => {
  const pessoa = identidadeDaSemente(seq(0x10, 16));
  const ap = identidadeDaSemente(seq(0x30, 32));

  it('emite e confere; o nome entra em NFC', () => {
    const c = emitirCertificado(pessoa, ap.publicas, '  Celular do Joa' + String.fromCharCode(0x303) + 'o ', 1795000000000);
    expect(c.nome).toBe('Celular do João');
    const r = conferirCertificado(c);
    expect(r.ok && [r.pessoa, r.aparelho, r.nome]).toEqual([pessoa.endereco, ap.endereco, 'Celular do João']);
    expect(conferirAparelho(c, { pessoa: pessoa.endereco }).ok).toBe(true);
  });

  it('nome, data ou endereço inválidos não viram certificado', () => {
    expect(() => emitirCertificado(pessoa, ap.publicas, '   ')).toThrow(RangeError);
    expect(() => emitirCertificado(pessoa, ap.publicas, 'x'.repeat(61))).toThrow(RangeError);
    expect(() => emitirCertificado(pessoa, ap.publicas, 'com\ttab')).toThrow(RangeError);
    expect(() => emitirCertificado(pessoa, ap.publicas, 'ok', 1.5)).toThrow(RangeError);
    expect(() => revogarAparelho(pessoa, 'nao-e-endereco')).toThrow(RangeError);
  });

  it('mexer em qualquer campo derruba; campo a mais ou a menos é formato', () => {
    const c = emitirCertificado(pessoa, ap.publicas, 'Notebook', 1795000000000);
    expect(conferirCertificado({ ...c, nome: 'Notebook2' })).toEqual({ ok: false, erro: 'assinatura' });
    expect(conferirCertificado({ ...c, criado: c.criado + 1 })).toEqual({ ok: false, erro: 'assinatura' });
    expect(conferirCertificado({ ...c, aparelho: publicasParaJson(identidadeDaSemente(seq(0x31, 32)).publicas) })).toEqual({ ok: false, erro: 'assinatura' });
    expect(conferirCertificado({ ...c, extra: 1 })).toEqual({ ok: false, erro: 'formato' });
    const { assinatura: _a, ...sem } = c;
    expect(conferirCertificado(sem)).toEqual({ ok: false, erro: 'formato' });
    expect(conferirCertificado({ ...c, v: 2 })).toEqual({ ok: false, erro: 'formato' });
    // um certificado que outra pessoa assinou pondo as públicas desta pessoa
    const intrusa = identidadeDaSemente(seq(0x50, 16));
    const falso = emitirCertificado(intrusa, ap.publicas, 'Notebook', 1795000000000);
    expect(conferirCertificado({ ...falso, pessoa: c.pessoa })).toEqual({ ok: false, erro: 'assinatura' });
    expect(conferirAparelho(falso, { pessoa: pessoa.endereco })).toEqual({ ok: false, erro: 'outra-pessoa' });
  });

  it('nunca lança com dado de fora estragado', () => {
    const lixo: unknown[] = [null, undefined, 1, 'x', [], {}, { v: 1 }, { v: 1, pessoa: {}, aparelho: {}, nome: 1, criado: 'x', assinatura: 2 }];
    for (const x of lixo) {
      expect(conferirCertificado(x).ok).toBe(false);
      expect(conferirRevogacao(x)).toBeNull();
      expect(conferirAparelho(x, { revogacoes: [x] }).ok).toBe(false);
    }
  });

  it('a revogação vale só se for da mesma pessoa e do mesmo aparelho', () => {
    const c = emitirCertificado(pessoa, ap.publicas, 'Notebook', 1795000000000);
    const outro = identidadeDaSemente(seq(0x32, 32));
    const rOutroAparelho = revogarAparelho(pessoa, outro.endereco, 1795000001000);
    const rOutraPessoa = revogarAparelho(identidadeDaSemente(seq(0x50, 16)), ap.endereco, 1795000001000);
    const rCerta = revogarAparelho(pessoa, ap.endereco, 1795000001000);
    expect(conferirRevogacao(rCerta)).toEqual({ pessoa: pessoa.endereco, aparelho: ap.endereco, quando: 1795000001000 });
    expect(conferirAparelho(c, { revogacoes: [rOutroAparelho, rOutraPessoa] }).ok).toBe(true);
    expect(conferirAparelho(c, { revogacoes: [{ ...rCerta, quando: 1 }] }).ok).toBe(true); // revogação mexida: ignorada
    expect(conferirAparelho(c, { revogacoes: [rOutroAparelho, rCerta] })).toEqual({ ok: false, erro: 'revogado' });
  });
});

describe('a caixa para uma pessoa', () => {
  const ana = identidadeDaSemente(seq(0x70, 16));
  const bia = identidadeDaSemente(seq(0x71, 16));

  it('só quem recebe abre, e só com o mesmo contexto', () => {
    const dados = utf8ToBytes('a chave do documento');
    const caixa = fecharCaixa(ana.publicas.cifrar, 'teste:um', dados);
    expect(caixa.length).toBe(dados.length + 48);
    expect(new TextDecoder().decode(abrirCaixa(ana, 'teste:um', caixa)!)).toBe('a chave do documento');
    expect(abrirCaixa(bia, 'teste:um', caixa)).toBeNull();
    expect(abrirCaixa(ana, 'teste:dois', caixa)).toBeNull();
    const mexida = new Uint8Array(caixa);
    mexida[40]! ^= 1;
    expect(abrirCaixa(ana, 'teste:um', mexida)).toBeNull();
    expect(abrirCaixa(ana, 'teste:um', caixa.subarray(0, 47))).toBeNull();
    expect(abrirCaixa(ana, 'Contexto Ruim', caixa)).toBeNull();
    // duas caixas da mesma coisa não se parecem (a chave de uso único é sorteada)
    expect(bytesToHex(fecharCaixa(ana.publicas.cifrar, 'teste:um', dados))).not.toBe(bytesToHex(caixa));
  });

  it('recusa a pública de ordem pequena (o segredo daria zero)', () => {
    expect(() => fecharCaixa(new Uint8Array(32), 'teste', new Uint8Array(1))).toThrow();
    expect(() => fecharCaixa(seq(1, 31), 'teste', new Uint8Array(1))).toThrow(RangeError);
  });
});

describe('a chave de documento por época', () => {
  const doc = '0193a5c0-0000-7000-8000-0000000000aa';

  it('cifra e decifra; outro documento, outra época ou outro aad não abre', () => {
    const k = novaChaveDeDocumento(doc, 2);
    const c = cifrarComChave(k, utf8ToBytes('texto'), utf8ToBytes('cab'));
    expect(new TextDecoder().decode(decifrarComChave(k, c, utf8ToBytes('cab'))!)).toBe('texto');
    expect(decifrarComChave(k, c, utf8ToBytes('cabx'))).toBeNull();
    expect(decifrarComChave(chaveDeDocumento('outro', 2, k.chave), c, utf8ToBytes('cab'))).toBeNull();
    expect(decifrarComChave(chaveDeDocumento(doc, 3, k.chave), c, utf8ToBytes('cab'))).toBeNull();
    expect(decifrarComChave(k, c.subarray(0, 39))).toBeNull();
    expect(() => novaChaveDeDocumento('com espaço')).toThrow(RangeError);
    expect(() => novaChaveDeDocumento(doc, -1)).toThrow(RangeError);
  });

  it('a entrega da chave: só a pessoa certa, só para aquele documento e aquela época', () => {
    const ana = identidadeDaSemente(seq(0x80, 16));
    const bia = identidadeDaSemente(seq(0x81, 16));
    const k = novaChaveDeDocumento(doc, 5);
    const caixa = entregarChave(k, bia.publicas.cifrar);
    const recebida = receberChave(bia, doc, 5, caixa);
    expect(recebida && bytesToHex(recebida.chave)).toBe(bytesToHex(k.chave));
    expect(receberChave(ana, doc, 5, caixa)).toBeNull();
    expect(receberChave(bia, doc, 4, caixa)).toBeNull();
    expect(receberChave(bia, 'outro', 5, caixa)).toBeNull();
    expect(receberChave(bia, 'com espaço', 5, caixa)).toBeNull();
  });

  it('o chaveiro: época nova a cada saída, a atual é a maior', () => {
    const ch = new Chaveiro(doc);
    expect(ch.atual()).toBeUndefined();
    const e0 = ch.novaEpoca();
    const e1 = ch.novaEpoca();
    expect([e0.epoca, e1.epoca]).toEqual([0, 1]);
    expect(bytesToHex(e0.chave)).not.toBe(bytesToHex(e1.chave));
    ch.guardar(chaveDeDocumento(doc, 7, seq(1, 32)));
    expect(ch.atual()?.epoca).toBe(7);
    expect(ch.novaEpoca().epoca).toBe(8);
    expect(ch.epocas()).toEqual([0, 1, 7, 8]);
    expect(ch.daEpoca(1)).toBe(e1);
    expect(() => ch.guardar(chaveDeDocumento('outro', 0, seq(1, 32)))).toThrow(RangeError);
  });
});

describe('o kit de recuperação', () => {
  it('ida e volta em português e em inglês', () => {
    for (const idioma of ['pt', 'en'] as const) {
      const k = novoKit(idioma);
      expect(k.palavras).toHaveLength(12);
      const lido = lerKit(k.palavras);
      expect(lido.ok && [bytesToHex(lido.semente), lido.idioma]).toEqual([bytesToHex(k.semente), idioma]);
    }
  });

  it('aceita maiúsculas, acentos, vírgulas, espaços a mais e as 4 primeiras letras', () => {
    const k = palavrasDaSemente(seq(0, 16), 'pt'); // abacate afivelar inativo afivelar donzela achatar barulho beber albergue exalar cuidado banir
    const digitado = `  ABACATE, afiv; ináTIVO\nafivelar - donz achatar   barulho bebér albe exal cuidado BANIR `;
    const lido = lerKit(digitado);
    expect(lido.ok && bytesToHex(lido.semente)).toBe(bytesToHex(seq(0, 16)));
    expect(lido.ok && lido.palavras).toEqual(k);
  });

  it('diz o que está errado', () => {
    const k = palavrasDaSemente(seq(0, 16), 'pt');
    expect(lerKit(k.slice(0, 11))).toEqual({ ok: false, erro: 'quantidade' });
    expect(lerKit([...k.slice(0, 3), 'xyzzy', ...k.slice(4, 10), 'abc', k[11]!])).toEqual({ ok: false, erro: 'palavra-desconhecida', posicoes: [3, 10] });
    expect(lerKit([k[1]!, k[0]!, ...k.slice(2)])).toEqual({ ok: false, erro: 'conferencia' });
    // misturar as duas listas não vale
    const en = palavrasDaSemente(seq(0, 16), 'en');
    expect(lerKit([...k.slice(0, 6), ...en.slice(6)]).ok).toBe(false);
  });
});

describe('o cofre com senha', () => {
  it('fecha, abre, recusa a senha errada e troca a senha', async () => {
    const segredo = seq(0, 16);
    const progresso: number[] = [];
    const { cofre, entrar } = await fecharComSenha(segredo, 'senha boa', { aoProgredir: (f) => progresso.push(f) });
    expect(progresso.length).toBeGreaterThan(0);
    expect(progresso.at(-1)).toBeCloseTo(1, 2);
    expect(cofre.kdf).toMatchObject({ alg: 'argon2id', ...ARGON2ID_PADRAO });
    const aberto = await abrirComSenha(cofre, 'senha boa');
    expect(aberto && bytesToHex(aberto.segredo)).toBe(bytesToHex(segredo));
    expect(aberto && bytesToHex(aberto.entrar)).toBe(bytesToHex(entrar));
    expect(await abrirComSenha(cofre, 'senha ruim')).toBeNull();
    expect(await abrirComSenha(cofre, '')).toBeNull();

    const novo = await trocarSenha(cofre, 'senha boa', 'senha nova');
    expect(novo).not.toBeNull();
    expect(novo!.cofre.kdf.sal).not.toBe(cofre.kdf.sal);
    expect(bytesToHex(novo!.entrar)).not.toBe(bytesToHex(entrar));
    expect(await abrirComSenha(novo!.cofre, 'senha boa')).toBeNull();
    expect(bytesToHex((await abrirComSenha(novo!.cofre, 'senha nova'))!.segredo)).toBe(bytesToHex(segredo));
    expect(await trocarSenha(cofre, 'errada', 'x')).toBeNull();
  }, 30_000);

  it('a chave de entrar e a do cofre são diferentes; mexer nos parâmetros guardados faz o cofre não abrir', async () => {
    const kdf = novosParametros();
    const ch = await derivarDaSenha('uma senha', kdf);
    expect(bytesToHex(ch.entrar)).not.toBe(bytesToHex(ch.cofre));
    const cofre = fecharCofre(seq(5, 16), ch.cofre, kdf);
    expect(abrirCofre(cofre, ch.cofre)).not.toBeNull();
    expect(abrirCofre(cofre, ch.entrar)).toBeNull();
    expect(abrirCofre({ ...cofre, kdf: { ...kdf, t: 3 } }, ch.cofre)).toBeNull();
    expect(abrirCofre({ ...cofre, cifrado: paraBase64url(seq(0, 10)) }, ch.cofre)).toBeNull();
  }, 30_000);

  it('parâmetros fracos ou enormes são recusados (um servidor não consegue pedir)', async () => {
    const bom = novosParametros();
    expect(parametrosValidos(bom)).toBe(true);
    for (const ruim of [{ ...bom, m: 19455 }, { ...bom, t: 1 }, { ...bom, p: 0 }, { ...bom, m: 262145 }, { ...bom, t: 11 }, { ...bom, p: 5 }, { ...bom, sal: 'AAAA' }, { ...bom, alg: 'argon2i' }, { ...bom, extra: 1 }, null, 'x']) {
      expect(parametrosValidos(ruim)).toBe(false);
      expect(lerCofre({ v: 1, kdf: ruim, nonce: paraBase64url(seq(0, 24)), cifrado: 'AAAA' })).toBeNull();
    }
    await expect(derivarDaSenha('x', { ...bom, t: 1 })).rejects.toThrow(RangeError);
    await expect(derivarDaSenha('', bom)).rejects.toThrow(RangeError);
  });
});

describe('a recuperação de ponta a ponta (X1: o "pronto")', () => {
  it('esqueceu a senha: as 12 palavras refazem a pessoa, abrem as chaves entregues e apresentam o aparelho novo', async () => {
    // 1. A Ana começa: a pessoa, o cofre com a senha, o notebook apresentado.
    const { kit, identidade: ana } = novaPessoa('pt');
    const { cofre } = await fecharComSenha(kit.semente, 'a senha que ela vai esquecer');
    const notebook = novoAparelho();
    const certNotebook = apresentarAparelho(ana, notebook.identidade.publicas, 'Notebook da Ana');
    expect(conferirAparelho(certNotebook, { pessoa: ana.endereco }).ok).toBe(true);

    // 2. A Bia convida a Ana para um documento: a chave da época 0 vai numa caixa para a Ana.
    const k = novaChaveDeDocumento('0193a5c0-0000-7000-8000-0000000000bb', 0);
    const entrega = entregarChave(k, ana.publicas.cifrar);
    const trecho = cifrarComChave(k, utf8ToBytes('O livro de nós duas'));

    // 3. O notebook foi roubado e a senha, esquecida: sem ela o cofre não abre...
    expect(await abrirComSenha(cofre, 'outra senha')).toBeNull();
    // ... mas as 12 palavras (digitadas com descuido) refazem a mesma pessoa.
    const volta = pessoaDoKit(kit.palavras.map((p, i) => (i % 2 ? p.toUpperCase() : p.slice(0, 4))).join('  '));
    expect(volta.ok).toBe(true);
    if (!volta.ok) return;
    expect(volta.identidade.endereco).toBe(ana.endereco);

    // 4. Com a pessoa de volta: a chave do documento abre, e o texto também.
    const chave = receberChave(volta.identidade, k.doc, 0, entrega);
    expect(new TextDecoder().decode(decifrarComChave(chave!, trecho)!)).toBe('O livro de nós duas');

    // 5. O celular novo é apresentado, o notebook roubado é revogado, e um cofre novo nasce com a senha nova.
    const celular = novoAparelho();
    const certCelular = apresentarAparelho(volta.identidade, celular.identidade.publicas, 'Celular novo');
    const revogacao = revogarAparelho(volta.identidade, notebook.identidade.endereco);
    expect(conferirAparelho(certCelular, { pessoa: ana.endereco, revogacoes: [revogacao] }).ok).toBe(true);
    expect(conferirAparelho(certNotebook, { pessoa: ana.endereco, revogacoes: [revogacao] })).toEqual({ ok: false, erro: 'revogado' });
    const { cofre: cofreNovo } = await fecharComSenha(volta.semente, 'senha nova');
    expect(bytesToHex((await abrirComSenha(cofreNovo, 'senha nova'))!.segredo)).toBe(bytesToHex(kit.semente));
  }, 30_000);

  it('"confirme no outro aparelho": a semente vai de um aparelho aberto para o novo, numa caixa', () => {
    const { kit, identidade: ana } = novaPessoa('en');
    const novo = novoAparelho();
    const caixa = levarSemente(kit.semente, novo.identidade.publicas.cifrar);
    const s = receberSemente(novo.identidade, caixa);
    expect(s && identidadeDaSemente(s).endereco).toBe(ana.endereco);
    expect(receberSemente(novoAparelho().identidade, caixa)).toBeNull();
    // a caixa da semente não se passa por entrega de chave de documento (contextos diferentes)
    expect(receberChave(novo.identidade, 'x', 0, caixa)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------------------
describe('a chave de caixa por gerações e a guarda dividida (X2: o aparelho roubado)', () => {
  it('cada geração é outra chave; o kit refaz todas; a entrega da geração nova só abre no aparelho que ficou', () => {
    const { kit } = novaPessoa('pt');
    const g1 = chaveDeCaixa(kit.semente, 1);
    const g2 = chaveDeCaixa(kit.semente, 2);
    expect(iguais(g1.publica, g2.publica)).toBe(false);
    // o kit (as mesmas palavras) dá as mesmas gerações
    const volta = pessoaDoKit(kit.palavras.join(' '));
    expect(volta.ok && bytesToHex(chaveDeCaixa(volta.semente, 2).segredo)).toBe(bytesToHex(g2.segredo));
    // uma chave de documento mandada para a geração 2 abre com a geração 2, e com a 1 não
    const caixa = fecharCaixa(g2.publica, 'chave-doc:doc1:0', utf8ToBytes('a chave'));
    expect(new TextDecoder().decode(abrirComChaveDeCaixa(g2, 'chave-doc:doc1:0', caixa)!)).toBe('a chave');
    expect(abrirComChaveDeCaixa(g1, 'chave-doc:doc1:0', caixa)).toBeNull();
    // a geração 2 entregue ao aparelho que ficou: o revogado não abre
    const ficou = novoAparelho();
    const revogado = novoAparelho();
    const entrega = fecharCaixa(ficou.identidade.publicas.cifrar, contextoDeGeracao(2), g2.segredo);
    expect(bytesToHex(abrirCaixa(ficou.identidade, contextoDeGeracao(2), entrega)!)).toBe(bytesToHex(g2.segredo));
    expect(abrirCaixa(revogado.identidade, contextoDeGeracao(2), entrega)).toBeNull();
    expect(() => chaveDeCaixa(kit.semente, 0)).toThrow(RangeError);
    expect(() => chaveDeCaixa(new Uint8Array(32), 1)).toThrow(RangeError);
  });

  it('a declaração da geração: mexida, de outra pessoa ou com geração fora não vale', () => {
    const { kit } = novaPessoa('pt');
    const d = declararCaixa(kit.semente, 3, 1795000000000);
    expect(conferirDeclaracaoDeCaixa(d)?.geracao).toBe(3);
    expect(conferirDeclaracaoDeCaixa({ ...d, geracao: 4 })).toBeNull();
    expect(conferirDeclaracaoDeCaixa({ ...d, cifrar: paraBase64url(chaveDeCaixa(kit.semente, 4).publica) })).toBeNull();
    expect(conferirDeclaracaoDeCaixa({ ...d, pessoa: publicasParaJson(novaPessoa().identidade.publicas) })).toBeNull();
    expect(conferirDeclaracaoDeCaixa({ ...d, extra: 1 })).toBeNull();
    expect(conferirDeclaracaoDeCaixa({ ...d, geracao: 1.5 })).toBeNull();
    expect(conferirDeclaracaoDeCaixa(null)).toBeNull();
  });

  it('o cofre assinado: outro cofre, outra pessoa ou assinatura estragada não passam', async () => {
    const { kit, identidade } = novaPessoa('pt');
    const { cofre } = await fecharComSenha(kit.semente, 'senha boa 123');
    const a = assinarCofre(identidade, cofre);
    expect(conferirCofreAssinado(identidade.publicas.assinar, cofre, a)).toBe(true);
    expect(conferirCofreAssinado(novaPessoa().identidade.publicas.assinar, cofre, a)).toBe(false);
    expect(conferirCofreAssinado(identidade.publicas.assinar, { ...cofre, nonce: paraBase64url(new Uint8Array(24)) }, a)).toBe(false);
    // estragar um byte de verdade (trocar o fim por 'AA' não muda nada quando a assinatura já termina em 'AA': 1 em 256)
    const estragada = Uint8Array.from(doBase64url(a)!);
    estragada[10]! ^= 1;
    expect(conferirCofreAssinado(identidade.publicas.assinar, cofre, paraBase64url(estragada))).toBe(false);
    // a assinatura do cofre não serve como a de um certificado (contexto)
    expect(conferirAssinatura(identidade.publicas.assinar, 'certificado-aparelho', bytesCanonicos(cofre), doBase64url(a)!)).toBe(false);
  }, 30_000);

  it('a guarda dividida: só a guarda certa, para o mesmo aparelho, abre a cópia', () => {
    const { kit } = novaPessoa('pt');
    const aparelho = novoAparelho().identidade.endereco;
    const { guarda, guardado } = guardarSemente(kit.semente, aparelho);
    expect(bytesToHex(abrirGuardado(guardado, guarda, aparelho)!)).toBe(bytesToHex(kit.semente));
    expect(abrirGuardado(guardado, guardarSemente(kit.semente, aparelho).guarda, aparelho)).toBeNull();
    expect(abrirGuardado(guardado, guarda, novoAparelho().identidade.endereco)).toBeNull();
    expect(abrirGuardado({ ...guardado, v: 2 }, guarda, aparelho)).toBeNull();
    expect(abrirGuardado('lixo', guarda, aparelho)).toBeNull();
    // a cópia guardada no aparelho não tem a semente em claro
    expect(JSON.stringify(guardado)).not.toContain(paraBase64url(kit.semente));
  });

  it('o código do aparelho tem 6 algarismos e muda com o aparelho; a prova da sessão confere só com o aparelho certo', () => {
    const a = novoAparelho().identidade;
    const b = novoAparelho().identidade;
    expect(codigoDoAparelho(a.publicas)).toMatch(/^\d{3} \d{3}$/);
    expect(codigoDoAparelho(a.publicas)).toBe(codigoDoAparelho(a.publicas));
    expect(codigoDoAparelho(a.publicas)).not.toBe(codigoDoAparelho(b.publicas));
    const desafio = 'ab'.repeat(32);
    const prova = doBase64url(provarSessao(a, desafio))!;
    expect(conferirAssinatura(a.publicas.assinar, CONTEXTO_SESSAO, utf8ToBytes(desafio), prova)).toBe(true);
    expect(conferirAssinatura(b.publicas.assinar, CONTEXTO_SESSAO, utf8ToBytes(desafio), prova)).toBe(false);
    expect(() => provarSessao(a, 'curto')).toThrow(RangeError);
  });
});

// ------------------------------------------------------------------------------------------------------------
// A conferência cruzada com o sodium do PHP: o Argon2id (o @noble não tem esta parte auditada), as públicas, as
// assinaturas dos certificados com o JSON canônico refeito em PHP (o que a ponte fará na X2) e as cifras XChaCha20.

const PHP = existsSync('C:/xampp/php/php.exe') ? 'C:/xampp/php/php.exe' : 'php';
const temSodium = (() => {
  const r = spawnSync(PHP, ['-r', "exit(extension_loaded('sodium') && function_exists('array_is_list') ? 0 : 1);"], { encoding: 'utf8' });
  return !r.error && r.status === 0;
})();

/** Roda um script PHP (gravado num arquivo temporário) com os dados em JSON na entrada. */
function rodarPhp(script: string, dados: unknown): { stdout: string; stderr: string } {
  const pasta = mkdtempSync(join(tmpdir(), 'ekfrase-identidade-'));
  try {
    const arquivo = join(pasta, 'conferir.php');
    writeFileSync(arquivo, script);
    const r = spawnSync(PHP, ['-d', 'memory_limit=256M', arquivo], { input: JSON.stringify(dados), encoding: 'utf8' });
    return { stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error) : '') };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const CONFERIR_PHP = `<?php
$e = json_decode(stream_get_contents(STDIN), true);
function ordenar($v) {
  if (!is_array($v) || array_is_list($v)) return is_array($v) ? array_map('ordenar', $v) : $v;
  ksort($v, SORT_STRING);
  return array_map('ordenar', $v);
}
function canonico($v) { return json_encode(ordenar($v), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); }
function b64u($s) { return sodium_base642bin($s, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING); }
function u64b($b) { return sodium_bin2base64($b, SODIUM_BASE64_VARIANT_URLSAFE_NO_PADDING); }
$r = [];
$c = $e['cofre'];
$mestra = sodium_crypto_pwhash(32, $c['senha'], b64u($c['kdf']['sal']), $c['kdf']['t'], $c['kdf']['m'] * 1024, SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13);
$r['mestra'] = bin2hex($mestra);
$r['entrar'] = bin2hex(hash_hkdf('sha256', $mestra, 32, 'ekfrase/senha/entrar', ''));
$r['chave_do_cofre'] = bin2hex(hash_hkdf('sha256', $mestra, 32, 'ekfrase/senha/cofre', ''));
$ad = 'ekfrase/cofre/v1' . chr(0) . canonico(['v' => 1, 'kdf' => $c['cofre']['kdf']]);
$s = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(b64u($c['cofre']['cifrado']), $ad, b64u($c['cofre']['nonce']), hex2bin($r['chave_do_cofre']));
$r['segredo'] = $s === false ? null : bin2hex($s);
$r['assinados'] = [];
foreach ($e['assinados'] as $a) {
  $o = $a['objeto'];
  $sig = b64u($o['assinatura']);
  unset($o['assinatura']);
  $corpo = canonico($o);
  $ok = sodium_crypto_sign_verify_detached($sig, 'ekfrase/' . $a['contexto'] . chr(0) . $corpo, b64u($o['pessoa']['assinar']));
  $r['assinados'][] = ['corpo' => $corpo, 'ok' => $ok];
}
$d = $e['documento'];
$ct = hex2bin($d['cifrado']);
$ad = 'ekfrase/doc/v1' . chr(0) . $d['doc'] . chr(0) . pack('N', $d['epoca']) . hex2bin($d['aad']);
$pt = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(substr($ct, 24), $ad, substr($ct, 0, 24), hex2bin($d['chave']));
$r['documento'] = $pt === false ? null : bin2hex($pt);
$r['publicas'] = [];
foreach ($e['identidades'] as $i) {
  $par = sodium_crypto_sign_seed_keypair(hex2bin($i['segredos']['assinar']));
  $r['publicas'][] = ['assinar' => u64b(sodium_crypto_sign_publickey($par)), 'cifrar' => u64b(sodium_crypto_scalarmult_base(hex2bin($i['segredos']['cifrar'])))];
}
echo json_encode($r);
`;

describe.skipIf(!temSodium)('conferência cruzada com o sodium do PHP', () => {
  it('o PHP chega aos mesmos bytes: Argon2id, HKDF, o cofre, as públicas, as assinaturas e o documento', () => {
    type CofreCaso = { senha: string; kdf: ParametrosDaSenha; mestra: string; entrar: string; chave_do_cofre: string; cofre: { kdf: ParametrosDaSenha; nonce: string; cifrado: string }; segredo: string };
    const cofre = caso<{ casos: CofreCaso[] }>('cofre.json').casos[0]!;
    const certs = caso<{ certificados: { assinatura: string }[]; revogacoes: { assinatura: string }[] }>('certificados.json');
    const documento = caso<{ casos: unknown[] }>('documento.json').casos[0];
    const identidades = caso<{ identidades: IdCaso[] }>('chaves.json').identidades;
    const assinados = [...certs.certificados.map((o) => ({ objeto: o, contexto: 'certificado-aparelho' })), ...certs.revogacoes.map((o) => ({ objeto: o, contexto: 'revogacao-aparelho' }))];
    const saida = rodarPhp(CONFERIR_PHP, { cofre, assinados, documento, identidades });
    expect(saida.stderr).toBe('');
    const php = JSON.parse(saida.stdout) as { mestra: string; entrar: string; chave_do_cofre: string; segredo: string | null; assinados: { corpo: string; ok: boolean }[]; documento: string | null; publicas: { assinar: string; cifrar: string }[] };
    expect(php.mestra).toBe(cofre.mestra);
    expect(php.entrar).toBe(cofre.entrar);
    expect(php.chave_do_cofre).toBe(cofre.chave_do_cofre);
    expect(php.segredo).toBe(cofre.segredo);
    expect(php.documento).toBe((documento as { dados: string }).dados);
    expect(php.publicas).toEqual(identidades.map((i) => i.publicas));
    php.assinados.forEach((a, i) => {
      const { assinatura: _s, ...corpo } = assinados[i]!.objeto as Record<string, ValorCanonico>;
      expect(a.corpo).toBe(canonico(corpo));
      expect(a.ok).toBe(true);
    });
  }, 60_000);

  it('o Argon2id do @noble e o do PHP batem em senhas sorteadas (inclusive com acento)', () => {
    const senhas = ['a', 'Coração', 'senha com espaços e 123', String.fromCharCode(0x1f600) + 'emoji'];
    const sal = seq(0x42, 16);
    const kdf = { alg: 'argon2id', ...ARGON2ID_PADRAO, sal: paraBase64url(sal) } as const;
    const nossas = senhas.map((s) => bytesToHex(argon2id(utf8ToBytes(s.normalize('NFC')), sal, { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32 })));
    const script = `<?php $e = json_decode(stream_get_contents(STDIN), true); $o = []; foreach ($e['senhas'] as $s) { $o[] = bin2hex(sodium_crypto_pwhash(32, $s, hex2bin($e['sal']), $e['t'], $e['m'] * 1024, SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13)); } echo json_encode($o);`;
    const saida = rodarPhp(script, { senhas: senhas.map((s) => s.normalize('NFC')), sal: bytesToHex(sal), t: kdf.t, m: kdf.m });
    expect(saida.stderr).toBe('');
    expect(JSON.parse(saida.stdout)).toEqual(nossas);
  }, 60_000);
});
