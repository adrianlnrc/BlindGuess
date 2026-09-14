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

## Progressão

- **Streak diário**: jogar pelo menos uma partida por dia mantém a ofensiva viva. Jogar
  várias vezes no mesmo dia não infla o contador; ficar um dia fora zera, mas o recorde
  histórico fica guardado. O "dia" usa o fuso de `BLINDGUESS_TIMEZONE`.
- **Ranking** (`/ranking`): melhores partidas solo e as ofensivas mais longas.
- **Perfil**: apelido e personagem ficam no navegador (`localStorage`) e acompanham você
  entre partidas — é o que amarra streak, ranking e avatar.

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
- **Reconexão**: se você atualizar a página ou cair no meio da partida, volta para a mesma
  sala com a pontuação intacta.

## Stack

| Camada | Escolha |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4 |
| Realtime | Socket.IO sobre um servidor Node custom (`server.ts`) |
| Imagens | Google Maps JavaScript API — Street View + mini-mapa |
| Estado da partida | Em memória no servidor (salas expiram em 6 h) |
| Persistência | Arquivo JSON com escrita atômica (perfis, streaks, rankings, desafios) |

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
| `PORT` | Porta do servidor (padrão `3000`) |
| `BLINDGUESS_DATA_FILE` | Onde gravar os dados (padrão `data/blindguess.json`) |
| `BLINDGUESS_TIMEZONE` | Fuso que define a virada do dia no streak (padrão `America/Sao_Paulo`) |

## Produção

```bash
npm run build
npm start
```

⚠️ **Não dá para hospedar na Vercel.** As salas usam WebSocket persistente, e funções
serverless não mantêm conexão aberta. Use uma plataforma com processo Node de longa
duração: Railway, Render, Fly.io, um VPS ou Docker. O comando de start é `npm start`
e o processo escuta em `$PORT`.

Aponte `BLINDGUESS_DATA_FILE` para um **volume persistente**. Sem isso, streaks, rankings
e desafios somem a cada deploy, porque o disco do contêiner é efêmero.

## Estrutura

```
server.ts                 servidor HTTP + Socket.IO, embrulha o Next
src/server/rooms.ts       máquina de estados das salas (lobby → jogo → resultado)
src/server/locations.ts   sorteio de locais e validação do panorama
src/server/store.ts       persistência: perfis, streaks, rankings e desafios
src/lib/scoring.ts        haversine + fórmula de pontuação
src/lib/types.ts          contratos compartilhados entre cliente e servidor
src/lib/useRoom.ts        hook que sincroniza o estado da sala no cliente
src/lib/profile.ts        perfil e avatar no localStorage
src/components/           Street View, mapa de palpite, lobby, avatar, resultados
```

## Limitações conhecidas

- Reiniciar o servidor derruba as **salas em andamento** (o progresso já gravado —
  streaks, rankings, desafios — sobrevive no arquivo de dados).
- A persistência é um JSON reescrito inteiro a cada gravação: perfeito para um grupo de
  amigos, inadequado para escala. Trocar por Postgres mexe só em `src/server/store.ts`.
- A identidade do jogador mora no `localStorage`: limpar o navegador ou trocar de
  aparelho começa um perfil novo, com streak zerado.
- O sorteio parte de pontos-semente com desvio aleatório; a variedade é boa, mas não é
  uma amostragem uniforme do planeta.
- A cobertura do Street View é desigual — em regiões com pouca cobertura, o sorteio
  pode cair sempre nas mesmas estradas.
