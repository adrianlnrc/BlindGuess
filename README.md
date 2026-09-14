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
| **Desafio por link** | Os locais são sorteados na criação e ficam fixos. Você joga, manda o link, e cada amigo encara exatamente os mesmos lugares quando quiser. Vale a melhor marca de cada um. |

Toda partida livre (solo ou em grupo) também vira um desafio compartilhável no fim —
o link reaproveita os locais que acabaram de ser jogados.

### Desafio do dia

Cinco lugares iguais para todo mundo, trocando na virada do dia. **Uma tentativa só** —
não dá para repetir até acertar, então a marca de cada um vale. Os locais são sorteados
na primeira vez que alguém abre o desafio no dia e ficam fixos a partir daí; se duas
pessoas abrirem ao mesmo tempo, o banco decide qual conjunto vale e as duas jogam o mesmo.

O fuso que define a virada é o `BLINDGUESS_TIMEZONE`.

## Progressão

- **Streak diário**: jogar pelo menos uma partida por dia mantém a ofensiva viva. Jogar
  várias vezes no mesmo dia não infla o contador; ficar um dia fora zera, mas o recorde
  histórico fica guardado. O "dia" usa o fuso de `BLINDGUESS_TIMEZONE`.
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
É tudo SVG gerado em código, sem imagem externa. O avatar aparece no lobby, nos
resultados de cada rodada, no placar final e nos rankings.

## Como funciona

- **Salas em tempo real** via WebSocket (Socket.IO). Código de 5 caracteres, até 12 jogadores.
- **Anfitrião configura** rodadas (1–20), tempo por rodada (30s a sem limite), região e as
  restrições clássicas: pode andar, pode girar a câmera, pode dar zoom.
- **Regiões**: mundo todo, Brasil, Europa, Américas, Ásia ou pontos famosos (modo fácil).
- **Pontuação**: até 5.000 pontos por rodada, com decaimento exponencial sobre a distância
  em linha reta — acertar na mosca dá 5.000, errar meio planeta dá ~0.
- **Rodada fecha** quando todo mundo palpita ou quando o cronômetro zera (o servidor é a
  autoridade do tempo, não o navegador).
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

O schema é criado sozinho na subida do servidor — não há passo de migração manual.

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
src/components/           Street View, mapa de palpite, lobby, avatar, resultados
```

## Limitações conhecidas

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
