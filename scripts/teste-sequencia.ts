/**
 * Teste das regras do modo sequência de países (issue #17).
 *
 * `scripts/teste-paises.ts` já prende o contrato de `paisDe` — inclusive o cache
 * por célula e a diferença entre "não há país aqui" (devolve `null`) e "a
 * consulta falhou" (lança). Aqui o que está sob teste é o que o modo faz com
 * cada uma dessas respostas, que é onde a sequência de um jogador se ganha ou se
 * perde por engano:
 *
 *   - acertar o país aumenta a sequência e traz outro lugar;
 *   - errar encerra a partida e a grava;
 *   - palpite no mar mata a sequência, mas com o motivo escrito na tela;
 *   - alvo sem país e geocodificador fora do ar são culpa nossa e NÃO podem
 *     matar a sequência;
 *   - o país vem sempre do servidor, nunca de um código mandado pelo cliente.
 *
 * Roda direto contra o `RoomManager`, sem servidor nem socket. Nem o sorteio do
 * local nem a descoberta do país falam com o Google: as duas coisas são
 * injetadas (`pickLocation`, `paisDe`), e a injeção do país também serve de
 * contador de chamadas.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-sequencia.ts
 *
 * O banco só é usado no fim da partida (`recordGame`); sem ele as verificações
 * de gravação são puladas com aviso, e o resto passa igual.
 */

import { getPool, migrate } from "@/server/db";
import { getStats } from "@/server/store";
import { RoomManager, type RoomManagerOptions } from "@/server/rooms";
import { DEFAULT_AVATAR, type LatLng, type PlayerProfile, type RoomState } from "@/lib/types";
import type { PickedLocation } from "@/server/locations";
import type { Pais } from "@/server/paises";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";

type Resultado = { nome: string; ok: boolean; detalhe: string };
const resultados: Resultado[] = [];

async function verifica(nome: string, fn: () => Promise<string>): Promise<void> {
  try {
    const detalhe = await fn();
    resultados.push({ nome, ok: true, detalhe });
    console.log(`  ok   ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    resultados.push({ nome, ok: false, detalhe });
    console.log(`  FALHA ${nome} — ${detalhe}`);
  }
}

function exige(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new Error(mensagem);
}

// ------------------------------------------------------------- mundo de teste

/**
 * Mundo falso de duas casas: cada local sorteado cai num dos dois países, e o
 * palpite é lido pela longitude. Nada aqui chama a API do Google.
 */
const PORTUGAL: Pais = { code: "PT", name: "Portugal" };
const ESPANHA: Pais = { code: "ES", name: "Espanha" };
const EM_PORTUGAL: LatLng = { lat: 38.72, lng: -9.13 };
const EM_ESPANHA: LatLng = { lat: 40.41, lng: -3.7 };
const NO_MAR: LatLng = { lat: 30, lng: -40 };

function perfil(nome: string): PlayerProfile {
  return { id: `sequencia-${nome}`, name: nome, avatar: { ...DEFAULT_AVATAR } };
}

type MundoFalso = {
  pick: NonNullable<RoomManagerOptions["pickLocation"]>;
  paisDe: NonNullable<RoomManagerOptions["paisDe"]>;
  /** Pontos que foram perguntados ao geocodificador, em ordem. */
  consultas: LatLng[];
  /** Quantos locais o sorteio já entregou. */
  sorteios: number;
  /** O próximo alvo sorteado cai num ponto sem país (mar). */
  proximoAlvoNoMar: number;
  /** As próximas N consultas sobre o alvo falham, como cota estourada. */
  proximasFalhasDoAlvo: number;
};

/**
 * O geocodificador falso decide pela longitude: negativa longe é Portugal,
 * perto de zero é Espanha, e o meio do Atlântico não é país nenhum.
 */
function paisDoPonto(p: LatLng): Pais | null {
  if (p.lng < -30) return null;
  if (p.lng < -6) return PORTUGAL;
  return ESPANHA;
}

function mundoFalso(): MundoFalso {
  const mundo: MundoFalso = {
    consultas: [],
    sorteios: 0,
    proximoAlvoNoMar: 0,
    proximasFalhasDoAlvo: 0,
    pick: async (): Promise<PickedLocation | null> => {
      mundo.sorteios += 1;
      // O alvo pedido "no mar" só vale para o próximo sorteio: o seguinte volta
      // a cair em terra, que é o comportamento que o modo tem de aproveitar.
      if (mundo.proximoAlvoNoMar > 0) {
        mundo.proximoAlvoNoMar -= 1;
        return { ...NO_MAR, panoId: `seq-pano-mar-${mundo.sorteios}` };
      }
      return { ...EM_PORTUGAL, panoId: `seq-pano-${mundo.sorteios}` };
    },
    paisDe: async (ponto: LatLng): Promise<Pais | null> => {
      mundo.consultas.push(ponto);
      // Falha de consulta, e não "não há país": é a distinção que `paisDe` faz
      // lançando, e o modo tem de tratar as duas de formas diferentes.
      if (mundo.proximasFalhasDoAlvo > 0 && ehAlvo(ponto)) {
        mundo.proximasFalhasDoAlvo -= 1;
        throw new Error("geocode: OVER_QUERY_LIMIT");
      }
      return paisDoPonto(ponto);
    },
  };
  return mundo;
}

/** Os alvos do mundo falso são sempre um destes dois pontos. */
function ehAlvo(p: LatLng): boolean {
  return (p.lat === EM_PORTUGAL.lat && p.lng === EM_PORTUGAL.lng) || (p.lat === NO_MAR.lat && p.lng === NO_MAR.lng);
}

type Bancada = { manager: RoomManager; mundo: MundoFalso; ultimo: Map<string, RoomState> };

function bancada(): Bancada {
  const mundo = mundoFalso();
  const ultimo = new Map<string, RoomState>();
  const manager: RoomManager = new RoomManager(
    (code) => {
      const state = manager.getState(code);
      if (state) ultimo.set(code, state);
    },
    { pickLocation: mundo.pick, paisDe: mundo.paisDe, retryDelaysMs: [1, 1, 1], resultMs: 50, finalResultMs: 50 },
  );
  return { manager, mundo, ultimo };
}

/** Abre uma sequência já na primeira rodada. */
async function sequenciaComecada(
  b: Bancada,
  quem = "jogador",
): Promise<{ code: string; playerId: string; profileId: string }> {
  const p = perfil(quem);
  const { code, playerId } = b.manager.createStreakRoom(p, "sock-seq");
  await b.manager.startGame(code, playerId);
  const estado = b.manager.getState(code);
  exige(estado?.phase === "playing", `a sequência não começou (fase ${estado?.phase})`);
  return { code, playerId, profileId: p.id };
}

/**
 * Palpita e espera o veredicto. `submitGuess` é síncrono, mas na sequência ele
 * delega para uma consulta assíncrona: o teste precisa esperar a fase sair de
 * `playing` (ou o erro aparecer) antes de conferir qualquer coisa.
 */
async function palpita(b: Bancada, code: string, playerId: string, position: LatLng): Promise<RoomState> {
  const antes = b.manager.getState(code);
  b.manager.submitGuess(code, playerId, position);

  for (let i = 0; i < 200; i++) {
    const agora = b.manager.getState(code);
    if (agora && (agora.phase !== "playing" || (agora.error && agora.error !== antes?.error))) return agora;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("o palpite da sequência nunca produziu veredicto");
}

function sequencia(b: Bancada, code: string) {
  const s = b.manager.getState(code)?.streak;
  exige(s, "a sala não trouxe estado de sequência");
  return s;
}

// ------------------------------------------------------------------- execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;
  let comBanco = true;
  await migrate().catch((err) => {
    comBanco = false;
    console.log(`> sem banco (${err.message}); as verificações de gravação vão ser puladas`);
  });

  console.log("\n[1] a sala é de sequência, de um jogador só e sem relógio");

  await verifica("sala nasce com o estado da sequência e sem cronômetro", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b);
    const estado = b.manager.getState(code)!;

    exige(estado.mode === "streak", `modo errado: ${estado.mode}`);
    exige(estado.streak, "RoomState.streak veio nulo numa sala de sequência");
    exige(estado.streak!.current === 0, `a sequência não começou em zero: ${estado.streak!.current}`);
    exige(estado.roundEndsAt === null, `a rodada marcou prazo: ${estado.roundEndsAt}`);
    exige(estado.settings.roundSeconds === 0, `roundSeconds = ${estado.settings.roundSeconds}`);
    exige(!!estado.panorama, "a rodada começou sem panorama");
    exige(playerId === estado.players[0]?.id, "o criador não é o jogador da sala");
    return `modo streak, sequência 0, roundEndsAt nulo e roundSeconds 0`;
  });

  await verifica("o cronômetro não entra nem pelos ajustes do cliente", async () => {
    const b = bancada();
    // Um cliente mandando 120 s no payload de `createStreak`: o modo ignora.
    const { code } = b.manager.createStreakRoom(perfil("relojoeiro"), "sock-r", { roundSeconds: 120 });
    const estado = b.manager.getState(code)!;
    exige(estado.settings.roundSeconds === 0, `roundSeconds = ${estado.settings.roundSeconds}`);
    return "roundSeconds forçado a 0 no servidor";
  });

  await verifica("outra pessoa não entra na sequência pelo código", async () => {
    const b = bancada();
    const { code } = await sequenciaComecada(b);
    const entrada = b.manager.joinRoom(code, perfil("intruso"), "sock-i");
    exige(!entrada.ok, "um segundo jogador entrou na sequência");
    return `recusado: ${(entrada as { error: string }).error}`;
  });

  console.log("\n[2] acertar o país aumenta a sequência e traz outro lugar");

  await verifica("acerto soma 1, revela os dois países e segue para a rodada seguinte", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b);
    const panoPrimeiro = b.manager.getState(code)!.panorama!.panoId;

    const depois = await palpita(b, code, playerId, EM_PORTUGAL);
    exige(depois.phase === "round-result", `fase errada depois do acerto: ${depois.phase}`);

    const s = depois.streak!;
    exige(s.current === 1, `a sequência não subiu: ${s.current}`);
    exige(s.correct === true, `correct = ${s.correct}`);
    exige(s.over === false, "a partida encerrou num acerto");
    exige(s.countryCode === "PT" && s.countryName === "Portugal", `alvo: ${s.countryCode} ${s.countryName}`);
    exige(s.guessCountryCode === "PT", `palpite: ${s.guessCountryCode}`);

    await b.manager.nextRound(code, playerId);
    const nova = b.manager.getState(code)!;
    exige(nova.phase === "playing", `não veio outra rodada: ${nova.phase}`);
    exige(nova.panorama && nova.panorama.panoId !== panoPrimeiro, "veio o mesmo lugar de novo");
    exige(nova.streak!.current === 1, `a sequência mudou ao virar a rodada: ${nova.streak!.current}`);

    const s2 = (await palpita(b, code, playerId, EM_PORTUGAL)).streak!;
    exige(s2.current === 2, `o segundo acerto não somou: ${s2.current}`);
    return `sequência 0 → 1 → 2, sem limite de rodadas`;
  });

  await verifica("o recorde acompanha a melhor sequência do perfil", async () => {
    const b = bancada();
    const p = perfil("recordista");
    const primeira = b.manager.createStreakRoom(p, "sock-1");
    await b.manager.startGame(primeira.code, primeira.playerId);
    await palpita(b, primeira.code, primeira.playerId, EM_PORTUGAL);
    await b.manager.nextRound(primeira.code, primeira.playerId);
    await palpita(b, primeira.code, primeira.playerId, EM_PORTUGAL);
    exige(sequencia(b, primeira.code).best === 2, `recorde na partida: ${sequencia(b, primeira.code).best}`);

    // Erra e começa outra: a sequência zera, o recorde fica.
    await b.manager.nextRound(primeira.code, primeira.playerId);
    await palpita(b, primeira.code, primeira.playerId, EM_ESPANHA);

    const segunda = b.manager.createStreakRoom(p, "sock-2");
    const s = b.manager.getState(segunda.code)!.streak!;
    exige(s.current === 0, `a nova sequência não começou em zero: ${s.current}`);
    exige(s.best === 2, `o recorde não sobreviveu à partida: ${s.best}`);
    return `sequência nova em 0 com recorde 2`;
  });

  console.log("\n[3] errar encerra a partida");

  await verifica("erro marca over, encerra e grava a partida", async () => {
    const b = bancada();
    const { code, playerId, profileId } = await sequenciaComecada(b, "perdedor");
    await palpita(b, code, playerId, EM_PORTUGAL);
    await b.manager.nextRound(code, playerId);

    const antes = comBanco ? await getStats(profileId) : null;
    const depois = await palpita(b, code, playerId, EM_ESPANHA);

    const s = depois.streak!;
    exige(s.correct === false, `correct = ${s.correct}`);
    exige(s.over === true, "errou e a partida não acabou");
    exige(s.current === 1, `a sequência mudou no erro: ${s.current}`);
    exige(s.countryCode === "PT", `alvo: ${s.countryCode}`);
    exige(s.guessCountryCode === "ES", `palpite: ${s.guessCountryCode}`);
    exige(depois.phase === "finished", `fase no fim: ${depois.phase}`);
    exige(depois.lastResult, "o fim de jogo ficou sem o mapa da última rodada");

    if (!comBanco) return "sem banco: gravação não conferida (o resto passou)";

    // `recordGame` roda depois do broadcast, de propósito: a tela não espera o banco.
    for (let i = 0; i < 100 && (await getStats(profileId))?.gamesPlayed === (antes?.gamesPlayed ?? 0); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const stats = await getStats(profileId);
    exige(stats, "o perfil não foi gravado");
    exige(
      stats!.gamesPlayed === (antes?.gamesPlayed ?? 0) + 1,
      `partidas: ${antes?.gamesPlayed ?? 0} → ${stats!.gamesPlayed}`,
    );
    exige(
      stats!.roundsPlayed === (antes?.roundsPlayed ?? 0) + 2,
      `rodadas gravadas: ${antes?.roundsPlayed ?? 0} → ${stats!.roundsPlayed} (esperado +2)`,
    );
    return `over com sequência 1, e a partida gravada (${stats!.gamesPlayed} partidas, +2 rodadas)`;
  });

  await verifica("palpite no mar mata a sequência, mas com o motivo na tela", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "navegante");
    await palpita(b, code, playerId, EM_PORTUGAL);
    await b.manager.nextRound(code, playerId);

    const depois = await palpita(b, code, playerId, NO_MAR);
    const s = depois.streak!;
    exige(s.over === true, "o palpite no mar não encerrou a sequência");
    exige(s.correct === false, `correct = ${s.correct}`);
    exige(s.guessCountryCode === null && s.guessCountryName === null, `palpite: ${s.guessCountryCode}`);
    exige(!!depois.error, "encerrou em silêncio, sem dizer que o palpite caiu fora de qualquer país");
    exige(/país/i.test(depois.error!), `mensagem sem explicação: ${depois.error}`);
    return `over com aviso: "${depois.error}"`;
  });

  console.log("\n[4] falha nossa não mata a sequência do jogador");

  await verifica("alvo sem país sorteia outro local, sem contar a rodada", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "sortudo");
    await palpita(b, code, playerId, EM_PORTUGAL);

    const sorteiosAntes = b.mundo.sorteios;
    // O próximo lugar cai no meio do Atlântico: não há país para comparar.
    b.mundo.proximoAlvoNoMar = 1;
    await b.manager.nextRound(code, playerId);

    const estado = b.manager.getState(code)!;
    exige(estado.phase === "playing", `a rodada não aconteceu: ${estado.phase}`);
    exige(b.mundo.sorteios === sorteiosAntes + 2, `sorteios: ${sorteiosAntes} → ${b.mundo.sorteios} (esperado +2)`);
    exige(estado.round === 2, `a rodada descartada contou: round = ${estado.round}`);
    exige(estado.streak!.current === 1, `a sequência mudou: ${estado.streak!.current}`);
    exige(estado.streak!.over === false, "o alvo no mar matou a sequência");

    // E o lugar novo é jogável: o palpite certo continua somando.
    const s = (await palpita(b, code, playerId, EM_PORTUGAL)).streak!;
    exige(s.current === 2, `a rodada refeita não somou: ${s.current}`);
    return `um sorteio a mais, rodada ainda na 2 e sequência intacta em 1 → 2`;
  });

  await verifica("consulta do alvo fora do ar para a rodada com a sequência de pé", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "azarado");
    await palpita(b, code, playerId, EM_PORTUGAL);

    // A cota estoura em todas as tentativas da próxima rodada.
    b.mundo.proximasFalhasDoAlvo = 99;
    await b.manager.nextRound(code, playerId);

    const parado = b.manager.getState(code)!;
    exige(parado.phase === "lobby", `fase depois da falha: ${parado.phase}`);
    exige(parado.streak!.current === 1, `a falha custou a sequência: ${parado.streak!.current}`);
    exige(parado.streak!.over === false, "a falha encerrou a partida");
    exige(!!parado.error, "a falha da consulta não virou mensagem");

    // Geocodificador de volta: a sequência continua de onde estava, sem zerar.
    b.mundo.proximasFalhasDoAlvo = 0;
    await b.manager.startGame(code, playerId);
    const voltou = b.manager.getState(code)!;
    exige(voltou.phase === "playing", `não retomou: ${voltou.phase}`);
    exige(voltou.streak!.current === 1, `zerou ao retomar: ${voltou.streak!.current}`);
    const s = (await palpita(b, code, playerId, EM_PORTUGAL)).streak!;
    exige(s.current === 2, `a rodada retomada não somou: ${s.current}`);
    return `sala volta ao início com aviso, sequência 1 preservada e retomada até 2`;
  });

  await verifica("consulta do palpite fora do ar deixa a rodada aberta", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "insistente");
    const pano = b.manager.getState(code)!.panorama!.panoId;

    // Falha só na leitura do palpite: o alvo já tinha sido resolvido no sorteio.
    let falhar = true;
    const original = b.mundo.paisDe;
    const manager = b.manager as unknown as { paisDe: typeof original };
    manager.paisDe = async (ponto: LatLng) => {
      if (falhar) throw new Error("geocode: OVER_QUERY_LIMIT");
      return original(ponto);
    };

    const depois = await palpita(b, code, playerId, EM_PORTUGAL);
    exige(depois.phase === "playing", `a falha fechou a rodada: ${depois.phase}`);
    exige(depois.streak!.over === false, "a falha na leitura do palpite matou a sequência");
    exige(depois.streak!.correct === null, `a falha virou veredicto: correct = ${depois.streak!.correct}`);
    exige(depois.submitted.length === 0, "o palpite ilegível ficou registrado e travaria o jogador");
    exige(!!depois.error, "a falha do palpite não virou mensagem");
    exige(depois.panorama?.panoId === pano, "o lugar mudou no meio da rodada");

    // O jogador clica de novo, agora com o geocodificador de volta.
    falhar = false;
    const s = (await palpita(b, code, playerId, EM_PORTUGAL)).streak!;
    exige(s.current === 1, `o segundo clique não valeu: ${s.current}`);
    return `rodada segue aberta com aviso, e o clique seguinte soma`;
  });

  console.log("\n[5] o país é sempre do servidor");

  await verifica("um countryCode mandado pelo cliente não é lido", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "espertinho");

    // O cliente manda junto do ponto um país inventado — o do alvo, para tentar
    // um acerto de graça. `submitGuess` só recebe a posição, e é dela que o
    // servidor tira o país; o resto do payload não existe para ele.
    const payload = { ...EM_ESPANHA, countryCode: "PT", countryName: "Portugal", correct: true } as LatLng;
    const depois = await palpita(b, code, playerId, payload);

    const s = depois.streak!;
    exige(s.guessCountryCode === "ES", `o servidor aceitou o país do cliente: ${s.guessCountryCode}`);
    exige(s.correct === false, "o palpite forjado passou por acerto");
    exige(s.over === true, "a sequência sobreviveu a um palpite errado");

    // E a consulta feita foi sobre o ponto clicado, não sobre o país recebido.
    const ultima = b.mundo.consultas.at(-1)!;
    exige(
      ultima.lat === EM_ESPANHA.lat && ultima.lng === EM_ESPANHA.lng,
      `o servidor perguntou por outro ponto: ${ultima.lat},${ultima.lng}`,
    );
    return `palpite lido como ES a partir do ponto, ignorando "PT" do payload`;
  });

  await verifica("o alvo é consultado uma vez por rodada, não a cada clique", async () => {
    const b = bancada();
    const { code, playerId } = await sequenciaComecada(b, "economico");
    // Uma consulta até aqui: a do alvo, feita no sorteio.
    const noComeco: number = b.mundo.consultas.length;
    exige(noComeco === 1, `consultas no começo da rodada: ${noComeco}`);

    await palpita(b, code, playerId, EM_PORTUGAL);
    const comPalpite: number = b.mundo.consultas.length;
    exige(comPalpite === 2, `consultas depois do palpite: ${comPalpite}`);

    // Cliques repetidos na mesma rodada não chegam a consultar nada: a rodada já
    // fechou e o palpite já está registrado.
    b.manager.submitGuess(code, playerId, EM_ESPANHA);
    await new Promise((r) => setTimeout(r, 50));
    const depoisDoRepetido: number = b.mundo.consultas.length;
    exige(depoisDoRepetido === 2, `um clique a mais consultou de novo: ${depoisDoRepetido}`);
    return `2 consultas para 1 rodada (alvo + palpite), e o clique repetido não consulta`;
  });

  await getPool().end().catch(() => {});

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  for (const f of falhas) console.log(`  FALHA ${f.nome} — ${f.detalhe}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro fatal no teste da sequência:", err);
  process.exit(1);
});
