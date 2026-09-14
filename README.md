# BlindGuess

Jogo de adivinhação geográfica multiplayer em tempo real. Você é jogado num ponto
aleatório do mundo no Street View, sem saber onde está, e precisa cravar o palpite
no mapa antes do tempo acabar. Quanto mais perto do local real, mais pontos.

Feito para jogar com amigos: uma pessoa cria a sala, compartilha o código de 5
letras e todo mundo joga as mesmas rodadas ao mesmo tempo, com placar ao vivo.

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
| Estado | Em memória no servidor (sem banco; salas expiram em 6 h) |

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

## Produção

```bash
npm run build
npm start
```

⚠️ **Não dá para hospedar na Vercel.** As salas usam WebSocket persistente, e funções
serverless não mantêm conexão aberta. Use uma plataforma com processo Node de longa
duração: Railway, Render, Fly.io, um VPS ou Docker. O comando de start é `npm start`
e o processo escuta em `$PORT`.

## Estrutura

```
server.ts                 servidor HTTP + Socket.IO, embrulha o Next
src/server/rooms.ts       máquina de estados das salas (lobby → jogo → resultado)
src/server/locations.ts   sorteio de locais e validação do panorama
src/lib/scoring.ts        haversine + fórmula de pontuação
src/lib/types.ts          contratos compartilhados entre cliente e servidor
src/lib/useRoom.ts        hook que sincroniza o estado da sala no cliente
src/components/           Street View, mapa de palpite, lobby, resultados
```

## Limitações conhecidas

- Estado em memória: reiniciar o servidor derruba as salas em andamento.
- O sorteio parte de pontos-semente com desvio aleatório; a variedade é boa, mas não é
  uma amostragem uniforme do planeta.
- A cobertura do Street View é desigual — em regiões com pouca cobertura, o sorteio
  pode cair sempre nas mesmas estradas.
