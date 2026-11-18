<!-- SPDX-License-Identifier: MPL-2.0 -->
# O Cog com as travas do Ekfrase: PARADO (P3b, 18/11/2026, DEC-P071)

`ekfrase.patch` é o remendo do Cog 0.18.4 do trixie (WPE WebKit) que o Writer OS usaria no lugar do Electron:
sem as teclas do Cog (Ctrl+W, F5/Ctrl+R, Alt+setas), só a origem do app, nenhuma janela nova, download nem caixa do
sistema, e a ponte da página injetada antes de tudo.

**Não entra na imagem.** A imagem voltou ao Electron porque o Cog não a reduziu (squashfs de 484 MB contra 479) e
caía ao abrir no QEMU (teste.11), e o boot lento era o live-boot, não o navegador.

Para retomar: o bloco que compilava o Cog e os arquivos da imagem daquela época estão no commit `e5a2e66`
(`git show e5a2e66:sistema/writer-os/imagem/montar.sh`, e também `pacotes.txt`, `ganchos/30-casca.sh`, `ganchos/rodar.sh`,
`raiz/usr/lib/ekfrase/ekfrase-sessao.sh`). A casca sem o Electron é `node sistema/writer-os/casca/scripts/montar.ts --os-cog`,
testada por `npm run teclado -- --so-os-cog`.
