# BlindGuess

Jogo de adivinhar lugares pelo Street View, para jogar com amigos. Next.js 15
(App Router) + Socket.IO num servidor Node próprio (`server.ts`, rodado com
`tsx`). **Não roda na Vercel**: os WebSockets precisam de processo persistente.

## Estado atual

O jogo **nunca foi executado de verdade** — falta a chave do Google Maps, que só
o dono do projeto pode criar. Sem ela o mapa e o panorama mostram mensagem de
erro e todas as capturas em `design/` têm o retângulo do mapa vazio. Tudo foi
verificado contra dublês, fixtures e testes de navegador.

`/api/health` diagnostica o que falta em português.

## Comandos

```bash
npm test              # as 17 suítes, 19 execuções (precisa de build + Postgres)
npm run test:rapido   # só as que não sobem servidor
npm run typecheck
npm run build
```

`npm test` **pula** as suítes que precisam de servidor quando falta build ou
Postgres, e diz no resumo que a cobertura ficou incompleta. Pular não é passar.

Para subir o Postgres local: `pg_ctlcluster 16 main start`.

## Armadilhas do ambiente

- **Nunca** use `pkill -f tsx` para matar servidor de teste: o padrão casa com a
  própria sessão e a mata. Use `fuser -k -n tcp PORTA`.
- Dois `next build` ao mesmo tempo corrompem `.next` com erros de manifesto que
  não têm relação com o código. Se acontecer: `rm -rf .next` e builde sozinho.
- Chromium já está em `/opt/pw-browsers/chromium`. **Nunca** rode
  `playwright install`. Para WebGL headless:
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
- `next/font` às vezes falha com `Cannot read properties of null` — é rede, não
  código. Tente de novo.

## Convenções

- Comentários em português, explicando **por que**, não o quê. Nomes em
  português para o domínio do jogo (`sequencia`, `assento`, `convite`).
- Mensagens de commit em português, sem acento (o histórico é assim).
- Cada suíte em `scripts/teste-*.ts`, rodável com `npx tsx`, imprimindo
  `N/N verificações passaram` e saindo diferente de zero quando falha.
- Suíte nova entra em `SUITES` dentro de `scripts/testes.ts`. Se ela sobe
  servidor, marque `precisaServidor: true` — errar isso faz a suíte falhar de um
  jeito que parece bug do jogo. Confira rodando com `DATABASE_URL` falsa: ela
  tem que **pular**, não falhar.

## Invariantes que não podem ser quebradas

**Identidade vem da conexão, nunca do payload.** Quem fala, convida, compra ou
palpita é `socket.data`, resolvido por `resolvePlayerId`. O payload diz no
máximo *sobre quem* é a ação, e essa escolha passa por conferência no banco
(`areFriends`, `enforceOwnership`). Um payload forjado com o id de outra pessoa
é recusado — `scripts/teste-seguranca.ts` e `teste-chat.ts` provam isso.

**Entrada do cliente é hostil.** `sanitizeSettings` confere a região contra o
catálogo e prende os números; item pago só vale se comprado; texto de chat é
cortado no servidor. O `maxLength` do input é conveniência, não defesa.

**`/api/health` é pública.** Nenhum valor de chave, host, porta ou usuário de
banco pode aparecer na resposta — o motivo exato vai para o log.
`scripts/teste-diagnostico.ts` planta segredos e confere.

## Dois padrões de bug que já apareceram quatro vezes

1. **Estado que o React não enxerga.** Ler `localStorage` no meio do render, ou
   pendurar um handler que capturou um valor antigo, produz bug que só aparece
   quando alguém reconecta ou troca de identidade. Se um valor pode mudar, ele
   vive em estado ou num ref lido na hora do uso.
2. **Memória por jogador precisa de chave por jogador.** Convidado e conta
   convivem na mesma máquina de propósito. Chave global mistura os dois.

## Onde as coisas estão

- `src/lib/types.ts` — contratos compartilhados cliente/servidor. Mude aqui
  primeiro; é o que impede dois agentes de divergirem.
- `src/server/rooms.ts` — máquina de estados das salas (todos os modos).
- `src/components/hudZonas.ts` — âncoras do HUD da tela de jogo. Três
  componentes desenham sobre o panorama sem se conhecerem; mexer no canto de um
  deles é uma edição aqui, não três lá.
