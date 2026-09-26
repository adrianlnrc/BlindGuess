# BlindGuess

Jogo de adivinhação geográfica multiplayer em tempo real. Você é jogado num ponto
aleatório do mundo no Street View, sem saber onde está, e precisa cravar o palpite
no mapa antes do tempo acabar. Quanto mais perto do local real, mais pontos.

Feito para jogar com amigos: uma pessoa cria a sala, compartilha o código de 5
letras e todo mundo joga as mesmas rodadas ao mesmo tempo, com placar ao vivo.

## Modos de jogo

| Modo | Como funciona |
| --- | --- |
| **Solo** | Partida sozinho. A pontuação entra no ranking e conta para o streak. |
| **Sala com amigos** | Todos jogam as mesmas rodadas ao mesmo tempo, com placar ao vivo. |
| **Duelo 1v1** | Vida contra vida. Cada um começa com 6.000; a cada rodada, quem chuta mais longe perde a diferença de pontos em vida. Acaba quando alguém zera. |
| **Desafio por link** | Os locais são sorteados na criação e ficam fixos. Você joga, manda o link, e cada amigo encara exatamente os mesmos lugares quando quiser. Vale a melhor marca de cada um. |
| **Sequência de países** *(em desenvolvimento)* | Sem pontuação: acertou o país onde a rodada caiu, a sequência cresce e vem outro lugar; errou, acabou. O que fica é o recorde. |

Toda partida livre (solo ou em grupo) também vira um desafio compartilhável no fim —
o link reaproveita os locais que acabaram de ser jogados.

### Desafio do dia

Cinco lugares iguais para todo mundo, trocando na virada do dia. **Uma tentativa só** —
não dá para repetir até acertar, então a marca de cada um vale. Os locais são sorteados
na primeira vez que alguém abre o desafio no dia e ficam fixos a partir daí; se duas
pessoas abrirem ao mesmo tempo, o banco decide qual conjunto vale e as duas jogam o mesmo.

O fuso que define a virada é o `BLINDGUESS_TIMEZONE`.

### Duelo

Não há contagem de rodadas: o duelo dura enquanto os dois tiverem vida.

- **6.000 de vida** para cada duelista.
- **Dano** = diferença entre as pontuações da rodada × multiplicador. Empate não tira vida.
- **Multiplicador** cresce com o tempo — 1× nas duas primeiras rodadas, 1,5× até a quarta,
  2× até a sexta, 3× depois — para o duelo não se arrastar.
- **Não palpitar conta como zero**, então sumir da rodada custa caro.
- No teto de 25 rodadas, vence quem tiver mais vida.

## Mapas

Nove mapas em três faixas de dificuldade. A dificuldade não é só um rótulo: ela muda o
quanto o sorteio pode se afastar do ponto-semente e o raio de busca do panorama —
10 km no fácil, 60 km no difícil. Na prática, mapa difícil joga você numa estrada rural,
longe de placas e pontos de referência.

| Faixa | Mapas |
| --- | --- |
| Fácil | Pontos famosos, Brasil |
| Médio | Europa, Américas, Ásia, Mundo todo |
| Difícil | África, Oceania, Mundo rural |

## Moedas e loja

Cada partida paga uma moeda por mil pontos, com bônus de 25 no desafio do dia e 40 na
vitória em duelo. As moedas compram cosméticos para o personagem — chapéus, rostos e
cores extras.

O preço vem do catálogo do servidor, nunca do cliente, e o débito e a entrega acontecem
na mesma transação. Item não comprado que chegue no perfil é revertido para o padrão pelo
servidor — o que o navegador manda sobre aparência é sugestão, não verdade.

## Amigos

Cada jogador tem um código de seis caracteres. Quem recebe o código adiciona, e a amizade
vale nos dois sentidos na hora — quem passou o código já consentiu, então não há convite
pendente. A lista mostra nível, ofensiva e quem está com o jogo aberto agora.

## Progressão

- **Streak diário**: jogar pelo menos uma partida por dia mantém a ofensiva viva. Jogar
  várias vezes no mesmo dia não infla o contador; ficar um dia fora zera, mas o recorde
  histórico fica guardado. O "dia" usa o fuso de `BLINDGUESS_TIMEZONE`.
- **Cartel de duelos**: vitórias e derrotas por jogador.
- **Nível**: os pontos acumulados viram XP numa curva quadrática — nível 2 em 2.500 pontos,
  3 em 10.000, 21 em 1 milhão. Sobe rápido no começo e vira maratona depois.
- **Ranking** (`/ranking`): melhores partidas solo e as ofensivas mais longas.
- **Perfil**: apelido e personagem ficam no navegador (`localStorage`) e acompanham você
  entre partidas — é o que amarra streak, ranking e avatar.

## Contas

Login é **opcional**: quem entra numa sala pelo código joga como convidado, sem conta.
Entrar serve para carregar o progresso entre aparelhos.

- **Google** — OAuth no mesmo projeto do Google Cloud onde já mora a chave do Maps
  (credencial diferente: um OAuth Client ID). Autorize o redirect
  `https://SEU-DOMINIO/api/auth/callback/google`.
- **Magic link** — o e-mail chega pelo Resend, sem senha.

Cada forma só aparece na tela de login se estiver configurada, então dá para ligar uma
agora e a outra depois, só mexendo nas variáveis.

No primeiro login, o perfil de convidado daquele navegador é **adotado pela conta**:
streak, pontuação e desafios continuam de onde pararam. Para quem está logado, a
identidade vem da sessão no banco — o id que o navegador manda é ignorado, então
ninguém escreve no ranking alheio. O WebSocket valida a sessão no handshake, lendo o
cookie e conferindo na tabela `sessions`.

## Personagem

Cada jogador monta um bonequinho próprio: tom de pele, cor da roupa, cor de detalhe,
chapéu (boné, explorador, gorro, fone) e rosto (sorriso, concentrado, óculos, escuros).
É tudo gerado em código, sem imagem externa: SVG no jogo, e um boneco 3D em Three.js na
tela de personalização e na tela inicial. Sem WebGL, o 3D cai para o SVG sozinho. O avatar
aparece no lobby, nos resultados de cada rodada, no placar final e nos rankings.

## Como funciona

- **Salas em tempo real** via WebSocket (Socket.IO). Código de 5 caracteres, até 12 jogadores.
- **Anfitrião configura** rodadas (1–20), tempo por rodada (30s a sem limite), região e as
  restrições clássicas: pode andar, pode girar a câmera, pode dar zoom.
- **Teclado no panorama**: setas giram e inclinam, `W`/`S` andam, `+`/`−` dão zoom, `R`
  volta ao ponto inicial, espaço confirma o palpite. Cada atalho respeita a regra da sala.
- **Regiões**: os nove mapas da tabela acima, de pontos famosos a mundo rural.
- **Pontuação**: até 5.000 pontos por rodada, com decaimento exponencial sobre a distância
  em linha reta — acertar na mosca dá 5.000, errar meio planeta dá ~0. A régua é o
  **tamanho do mapa**, não o planeta: errar 300 km vale 4.089 pontos no mundo e 2.623 no
  Brasil, porque num mapa menor o mesmo erro custa mais. Sem isso, escolher região pequena
  seria só uma forma de inflar placar.
- **Rodada fecha** quando todo mundo palpita ou quando o cronômetro zera (o servidor é a
  autoridade do tempo, não o navegador).
- **O resultado avança sozinho** — 12 s no comum, 20 s no último — para a sala não ficar
  presa se o anfitrião fechar a aba. Ele ainda pode adiantar. Sala de um jogador só não
  tem relógio aqui: ali ninguém fica preso, e dá para olhar o mapa com calma.
- **Resumo da partida** no placar final: onde cada local caiu, onde cada um chutou e
  quanto errou, com filtro por rodada e por jogador.
- **Chat da sala**: painel no lobby, bolha recolhível durante a rodada. Com o campo
  focado, os atalhos do jogo não disparam.
- **Chamar amigo**: quem está na sua lista e com o jogo aberto entra na sala sem você
  passar código.
- **Contador de presença**: quantas pessoas estão com o jogo aberto, ao vivo.
- **Reconexão**: se você atualizar a página ou cair no meio da partida, volta para a mesma
  sala com a pontuação intacta.

## Stack

| Camada | Escolha |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Realtime | Socket.IO sobre um servidor Node custom (`server.ts`) |
| Imagens | Google Maps JavaScript API — Street View + mini-mapa |
| Estado da partida | Em memória no servidor (salas expiram em 6 h) |
| Persistência | Postgres (perfis, streaks, rankings, desafios, contas e sessões) |
| Autenticação | Auth.js v5 — Google e magic link por e-mail (Resend) |

## Pré-requisitos: chave do Google Maps

O jogo depende da API do Google Maps. No [Google Cloud Console](https://console.cloud.google.com/):

1. Crie um projeto e ative o faturamento (há cota gratuita mensal, mas o cartão é exigido).
2. Ative **Maps JavaScript API** e **Street View Static API**.
3. Em *Credenciais*, crie uma chave de API.
4. Restrinja a chave: por *HTTP referrer* para a chave do navegador e, se possível,
   crie uma segunda chave restrita por IP para o servidor.

A chave do navegador fica exposta no HTML — isso é normal para a Maps JS API, e a
restrição por referrer é o que impede o uso indevido. **Nunca commite o `.env`.**

## Rodando localmente

```bash
npm install
cp .env.example .env     # preencha as chaves
npm run dev              # http://localhost:3000
```

Variáveis de ambiente:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Carrega o Street View e os mapas no navegador |
| `GOOGLE_MAPS_API_KEY` | Valida os panoramas no servidor (pode ser a mesma chave) |
| `DATABASE_URL` | Postgres. Sem ele o jogo roda, mas sem login, ranking, streak nem desafio |
| `AUTH_SECRET` | Assina os cookies de sessão (`openssl rand -base64 32`) |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Login com Google (opcional) |
| `AUTH_RESEND_KEY` / `EMAIL_FROM` | Magic link por e-mail (opcional) |
| `PORT` | Porta do servidor (padrão `3000`) |
| `BLINDGUESS_TIMEZONE` | Fuso que define a virada do dia no streak (padrão `America/Sao_Paulo`) |
| `PGSSLMODE` | `disable` desliga o TLS do Postgres. Só se a conexão falhar com erro de SSL — bancos de rede interna costumam não oferecer TLS |

O schema é criado sozinho na subida do servidor — não há passo de migração manual.

## Testes

```bash
npm test              # as 15 suítes, 17 execuções
npm run test:rapido   # só as que não sobem servidor
```

Sete suítes sobem o `server.ts` de verdade, então precisam do build de produção e de um
Postgres no ar. Faltando qualquer um dos dois, elas são **puladas com o motivo** e o
resumo avisa que a cobertura ficou incompleta — pular não é passar.

Não há API do Google sendo chamada em teste nenhum: o sorteio de local, a descoberta de
país e a integração com o Maps rodam contra dublês fiéis ao contrato de cada API.

## Produção

```bash
npm run build
npm start
```

⚠️ **Não dá para hospedar na Vercel.** As salas usam WebSocket persistente, e funções
serverless não mantêm conexão aberta. Use uma plataforma com processo Node de longa
duração: Railway, Render, Fly.io, um VPS ou Docker. O comando de start é `npm start`
e o processo escuta em `$PORT`.

Adicione um **Postgres** ao projeto e aponte `DATABASE_URL` para ele (no Railway,
`${{ Postgres.DATABASE_URL }}`). Não é preciso volume: os dados moram no banco.

Lembre que `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` é embutida no bundle **em tempo de build** —
defina as variáveis antes de buildar, ou refaça o deploy depois de mudá-las.

## Diagnóstico: `/api/health`

Se o jogo não abre rodada em produção, chame `GET /api/health` antes de caçar log.
A rota verifica cada dependência **na hora** — não só se a variável existe — e
responde sempre HTTP 200, com o estado real no corpo:

```bash
curl -s https://SEU-DOMINIO/api/health
```

```json
{
  "ok": false,
  "checks": {
    "database": { "ok": true, "detail": "conectado" },
    "mapsBrowserKey": { "ok": true, "detail": "definida — ..." },
    "mapsServerKey": { "ok": false, "detail": "REQUEST_DENIED: ative a Street View Static API ..." },
    "auth": { "ok": true, "detail": "google" }
  }
}
```

- `database` faz um `SELECT 1` de verdade no pool.
- `mapsServerKey` faz uma chamada real à Street View Metadata API e traduz o
  status (`REQUEST_DENIED` = API não ativada ou chave restrita demais;
  `OVER_QUERY_LIMIT` = cota/faturamento).
- `mapsBrowserKey` só confere presença — restrição por referrer não dá para
  validar do servidor.
- `auth` lista os provedores de login ligados.

O `ok` geral ignora o banco de propósito: sem `DATABASE_URL` o jogo roda degradado
(sem login, ranking nem streak), o que não é falha fatal. Nenhum valor de chave
aparece na resposta.

## Estrutura

```
server.ts                 servidor HTTP + Socket.IO, embrulha o Next
src/server/rooms.ts       máquina de estados das salas (lobby → jogo → resultado)
src/server/locations.ts   sorteio de locais e validação do panorama
src/server/store.ts       persistência: perfis, streaks, rankings e desafios
src/server/db.ts          pool do Postgres e criação do schema
src/server/session.ts     valida a sessão do Auth.js no handshake do WebSocket
src/auth.ts               configuração do Auth.js (Google + magic link)
src/lib/scoring.ts        haversine + fórmula de pontuação
src/lib/types.ts          contratos compartilhados entre cliente e servidor
src/lib/useRoom.ts        hook que sincroniza o estado da sala no cliente
src/lib/profile.ts        perfil e avatar no localStorage
src/lib/level.ts          curva de XP e nível
src/lib/duel.ts           regras de dano do duelo
src/lib/catalog.ts        catálogo de mapas e dificuldades
src/lib/shop.ts           catálogo da loja e regra de moedas
src/server/paises.ts      descobre o país de um ponto (sequência de países)
src/components/hudZonas.ts âncoras do HUD da tela de jogo, num lugar só
src/components/           Street View, mapa de palpite, lobby, chat, avatar, resultados
src/components/three/     personagem e globo em Three.js
scripts/testes.ts         roda todas as suítes; scripts/teste-*.ts são as suítes
```

## Limitações conhecidas

- **O jogo ainda não foi jogado de verdade.** Falta a chave do Google Maps, que só o dono
  do projeto pode criar; sem ela o mapa e o panorama mostram mensagem de erro. Tudo o que
  existe foi verificado contra dublês, fixtures e testes de navegador — o que prova que o
  código faz o que diz, não que o jogo é divertido. Comece por `/api/health`.
- Reiniciar o servidor derruba as **salas em andamento** (o progresso já gravado
  sobrevive no banco).
- Convidado continua preso ao `localStorage`: limpar o navegador começa um perfil novo.
  Entrar com conta resolve isso — é justamente para isso que o login existe.
- O estado das salas vive na memória do processo, então **só funciona com uma réplica**.
  Escalar horizontalmente exigiria um adaptador de Redis no Socket.IO.
- O sorteio parte de pontos-semente com desvio aleatório; a variedade é boa, mas não é
  uma amostragem uniforme do planeta.
- A cobertura do Street View é desigual — em regiões com pouca cobertura, o sorteio
  pode cair sempre nas mesmas estradas.
