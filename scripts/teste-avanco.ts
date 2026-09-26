/**
 * Teste do avanço automático da rodada.
 *
 * O defeito da issue #16 é de sala presa: `nextRound` só aceita o anfitrião, e
 * se ele fecha a aba no resultado ninguém mais destrava a partida. Estas
 * verificações prendem o avanço sozinho e, principalmente, o caso em que ele
 * pode fazer mal: o anfitrião clicando quase junto com o timer e a sala pulando
 * duas rodadas de uma vez.
 *
 * Roda direto contra o `RoomManager`, sem servidor nem socket: os tempos do
 * resultado são injetados em milissegundos (`resultMs`/`finalResultMs`) e o
 * sorteio do local é falso, então o teste inteiro leva segundos em vez de
 * esperar os 12 s de verdade em cada caso.
 *
 * Rodar:
 *   DATABASE_URL=postgresql://... npx tsx scripts/teste-avanco.ts
 *
 * O banco só é usado no fim da partida (`recordGame`); sem ele o teste ainda
 * passa, apenas com reclamação no log.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { getPool, migrate } from "@/server/db";
import { RoomManager, type RoomManagerOptions } from "@/server/rooms";
import { DEFAULT_AVATAR, type PlayerProfile, type RoomSettings, type RoomState } from "@/lib/types";
import type { PickedLocation } from "@/server/locations";

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

// --------------------------------------------------------------- cenário base

const CONFIG: RoomSettings = {
  rounds: 3,
  // Sem cronômetro de rodada: a rodada fecha quando todos palpitam, e o único
  // relógio em jogo passa a ser o do resultado, que é o que está sob teste.
  roundSeconds: 0,
  region: "world",
  allowMove: true,
  allowPan: true,
  allowZoom: true,
};

function perfil(nome: string): PlayerProfile {
  return { id: `avanco-${nome}`, name: nome, avatar: { ...DEFAULT_AVATAR } };
}

/** Sorteio falso: nunca falha, a não ser quando o teste pede. */
function sorteioFalso(): { pick: RoomManagerOptions["pickLocation"]; falhar: (v: boolean) => void } {
  let falhando = false;
  let n = 0;
  const pick = async (): Promise<PickedLocation | null> => {
    if (falhando) return null;
    n += 1;
    return { lat: -23.5 + n, lng: -46.6 + n, panoId: `avanco-pano-${n}` };
  };
  return { pick, falhar: (v: boolean) => (falhando = v) };
}

type Bancada = {
  manager: RoomManager;
  falhar: (v: boolean) => void;
  /** Último estado que foi para os clientes, por sala. */
  ultimo: Map<string, RoomState>;
};

function bancada(opcoes: { resultMs: number; finalResultMs: number }): Bancada {
  const { pick, falhar } = sorteioFalso();
  const ultimo = new Map<string, RoomState>();
  const manager: RoomManager = new RoomManager(
    (code) => {
      const state = manager.getState(code);
      if (state) ultimo.set(code, state);
    },
    { pickLocation: pick, retryDelaysMs: [1, 1, 1], ...opcoes },
  );
  return { manager, falhar, ultimo };
}

/**
 * Espião no estado interno da sala: é o único jeito de provar que nenhum timer
 * sobrou vivo, que é exatamente o vazamento de memória que a issue teme.
 */
type SalaInterna = { timer: unknown; resultTimer: unknown; resultEndsAt: number | null };

function salaInterna(manager: RoomManager, code: string): SalaInterna {
  const rooms = (manager as unknown as { rooms: Map<string, SalaInterna> }).rooms;
  const room = rooms.get(code);
  exige(room, `sala ${code} não existe mais`);
  return room;
}

/** Duas pessoas numa sala de festa, partida já começada na rodada 1. */
async function salaDeDois(
  b: Bancada,
  settings: Partial<RoomSettings> = {},
): Promise<{ code: string; anfitriaoId: string; visitanteId: string }> {
  const { code, playerId: anfitriaoId } = b.manager.createRoom(perfil("anfitriao"), "sock-a", {
    settings: { ...CONFIG, ...settings },
  });
  const entrada = b.manager.joinRoom(code, perfil("visitante"), "sock-b");
  exige(entrada.ok, "visitante não entrou na sala");

  await b.manager.startGame(code, anfitriaoId);
  const estado = b.manager.getState(code);
  exige(estado?.phase === "playing", `a partida não começou (fase ${estado?.phase})`);

  return { code, anfitriaoId, visitanteId: entrada.playerId };
}

/** Todo mundo palpita: é assim que a rodada fecha e o resultado aparece. */
function todosPalpitam(b: Bancada, code: string, ids: string[]): RoomState {
  for (const [i, id] of ids.entries()) {
    b.manager.submitGuess(code, id, { lat: 10 + i, lng: 20 + i });
  }
  const estado = b.manager.getState(code);
  exige(estado?.phase === "round-result", `a rodada não fechou (fase ${estado?.phase})`);
  return estado;
}

function fase(manager: RoomManager, code: string): string {
  return manager.getState(code)?.phase ?? "sem sala";
}

function rodada(manager: RoomManager, code: string): number {
  return manager.getState(code)?.round ?? -1;
}

// ------------------------------------------------------------------- execução

async function main(): Promise<void> {
  process.env.DATABASE_URL ??= DATABASE_URL;
  await migrate().catch((err) => console.log(`> sem banco (${err.message}); o fim da partida vai reclamar`));

  console.log("\n[1] a rodada avança sozinha quando ninguém faz nada");

  await verifica("resultado marca o prazo e avança sem ninguém clicar", async () => {
    const b = bancada({ resultMs: 250, finalResultMs: 500 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);

    const resultado = todosPalpitam(b, code, [anfitriaoId, visitanteId]);
    exige(resultado.resultEndsAt !== null, "resultEndsAt continuou nulo no resultado");
    const prazo = resultado.resultEndsAt! - Date.now();
    exige(prazo > 0 && prazo <= 250, `prazo estranho: ${prazo} ms`);
    exige(
      b.ultimo.get(code)?.resultEndsAt === resultado.resultEndsAt,
      "o prazo não foi para os clientes no broadcast",
    );

    const inicio = Date.now();
    await sleep(400);
    exige(fase(b.manager, code) === "playing", `não voltou a jogar (fase ${fase(b.manager, code)})`);
    exige(rodada(b.manager, code) === 2, `rodada errada: ${rodada(b.manager, code)}`);
    exige(
      b.manager.getState(code)?.resultEndsAt === null,
      "o prazo do resultado ficou pendurado na rodada nova",
    );
    return `avançou para a rodada 2 em ~${Date.now() - inicio} ms (prazo de 250 ms)`;
  });

  await verifica("sala de um jogador só não avança sozinha (decisão da issue)", async () => {
    const b = bancada({ resultMs: 200, finalResultMs: 400 });
    const { code, playerId } = b.manager.createSolo(perfil("solo"), "sock-s", CONFIG);
    await b.manager.startGame(code, playerId);
    b.manager.submitGuess(code, playerId, { lat: 1, lng: 2 });

    exige(fase(b.manager, code) === "round-result", "a rodada solo não fechou");
    exige(b.manager.getState(code)?.resultEndsAt === null, "sala de um jogador marcou prazo");
    exige(salaInterna(b.manager, code).resultTimer === null, "sala de um jogador armou timer");

    await sleep(350);
    exige(fase(b.manager, code) === "round-result", "a sala solo avançou sozinha");
    return `parada no resultado da rodada ${rodada(b.manager, code)}, sem prazo`;
  });

  console.log("\n[2] o anfitrião avançando antes da hora não pula rodada");

  await verifica("clique do anfitrião cancela o timer e o tempo antigo não avança de novo", async () => {
    const b = bancada({ resultMs: 300, finalResultMs: 600 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);

    await b.manager.nextRound(code, anfitriaoId);
    exige(rodada(b.manager, code) === 2, `o clique não abriu a rodada 2: ${rodada(b.manager, code)}`);
    exige(salaInterna(b.manager, code).resultTimer === null, "o timer do resultado sobreviveu ao clique");

    // Passa do instante em que o timer antigo venceria: se ele ainda estiver de
    // pé, a sala pula para a rodada 3 sem ninguém ter palpitado na 2.
    await sleep(450);
    exige(rodada(b.manager, code) === 2, `pulou rodada: chegou na ${rodada(b.manager, code)}`);
    exige(fase(b.manager, code) === "playing", `fase errada: ${fase(b.manager, code)}`);
    return `ficou na rodada 2 mesmo depois de passar o prazo de 300 ms`;
  });

  await verifica("timer que já disparou no mesmo instante do clique não avança nada", async () => {
    const b = bancada({ resultMs: 5_000, finalResultMs: 5_000 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);

    // `clearTimeout` não desfaz um callback que já foi para a fila: este é o
    // empate real entre clique e timer. Chamamos o caminho do timer à mão, com
    // a mesma sala, logo depois do clique.
    const interna = salaInterna(b.manager, code);
    await b.manager.nextRound(code, anfitriaoId);
    const avancoAutomatico = (
      b.manager as unknown as { autoAdvance: (room: SalaInterna) => Promise<void> }
    ).autoAdvance.bind(b.manager);
    await avancoAutomatico(interna);

    exige(rodada(b.manager, code) === 2, `o timer atrasado pulou para a rodada ${rodada(b.manager, code)}`);
    exige(fase(b.manager, code) === "playing", `fase errada: ${fase(b.manager, code)}`);
    return "o caminho do timer virou nada: sala segue na rodada 2";
  });

  await verifica("anfitrião clicando depois do avanço automático também não pula", async () => {
    const b = bancada({ resultMs: 150, finalResultMs: 300 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);

    await sleep(300);
    exige(rodada(b.manager, code) === 2, "o avanço automático não aconteceu");

    await b.manager.nextRound(code, anfitriaoId);
    exige(rodada(b.manager, code) === 2, `o clique atrasado pulou para a rodada ${rodada(b.manager, code)}`);
    return "clique fora de hora ignorado pela fase";
  });

  console.log("\n[3] anfitrião que cai no resultado não trava a sala");

  await verifica("sala destrava sozinha com o anfitrião desconectado", async () => {
    const b = bancada({ resultMs: 250, finalResultMs: 500 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);

    b.manager.handleDisconnect(code, anfitriaoId);
    const depois = b.manager.getState(code);
    exige(depois?.players.find((p) => p.id === visitanteId)?.isHost, "o visitante não virou anfitrião");

    await sleep(400);
    exige(fase(b.manager, code) === "playing", `a sala ficou presa (fase ${fase(b.manager, code)})`);
    exige(rodada(b.manager, code) === 2, `rodada errada: ${rodada(b.manager, code)}`);
    return "rodada 2 começou sem o anfitrião original";
  });

  console.log("\n[4] sorteio falhado espera gente, não relógio");

  await verifica("canRetryRound não avança sozinho", async () => {
    const b = bancada({ resultMs: 200, finalResultMs: 400 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);

    // A rodada 2 não acha local nenhum: a sala volta ao resultado da rodada 1.
    b.falhar(true);
    await b.manager.nextRound(code, anfitriaoId);

    const estado = b.manager.getState(code);
    exige(estado?.canRetryRound, `canRetryRound não ligou (fase ${estado?.phase})`);
    exige(estado?.resultEndsAt === null, "sala para tentar de novo marcou prazo");
    exige(salaInterna(b.manager, code).resultTimer === null, "sala para tentar de novo armou timer");

    await sleep(350);
    exige(fase(b.manager, code) === "round-result", `avançou sozinha (fase ${fase(b.manager, code)})`);
    exige(rodada(b.manager, code) === 1, `mexeu na rodada: ${rodada(b.manager, code)}`);

    // E continua dando para tentar de novo quando o sorteio volta.
    b.falhar(false);
    await b.manager.nextRound(code, anfitriaoId);
    exige(rodada(b.manager, code) === 2, `a nova tentativa não abriu a rodada 2: ${rodada(b.manager, code)}`);
    return "resultEndsAt nulo com canRetryRound, e a tentativa manual funciona";
  });

  console.log("\n[5] a partida termina certo pelo avanço automático");

  await verifica("último resultado espera mais e cai no placar final", async () => {
    const b = bancada({ resultMs: 150, finalResultMs: 400 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b, { rounds: 2 });

    todosPalpitam(b, code, [anfitriaoId, visitanteId]);
    await sleep(300);
    exige(rodada(b.manager, code) === 2, `não chegou na última rodada: ${rodada(b.manager, code)}`);

    const ultimo = todosPalpitam(b, code, [anfitriaoId, visitanteId]);
    const prazo = ultimo.resultEndsAt! - Date.now();
    exige(prazo > 150, `o último resultado não ganhou tempo extra: ${prazo} ms`);

    await sleep(500);
    exige(fase(b.manager, code) === "finished", `a partida não terminou (fase ${fase(b.manager, code)})`);

    const interna = salaInterna(b.manager, code);
    exige(interna.resultTimer === null && interna.timer === null, "sobrou timer depois do fim da partida");
    exige(b.manager.getState(code)?.resultEndsAt === null, "sobrou prazo depois do fim da partida");
    return `prazo final de ~${prazo} ms (comum era 150 ms) e nenhum timer de pé`;
  });

  console.log("\n[6] nenhum timer sobra em sala que morreu ou reiniciou");

  await verifica("playAgain apaga o timer do resultado", async () => {
    const b = bancada({ resultMs: 200, finalResultMs: 400 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);
    exige(salaInterna(b.manager, code).resultTimer !== null, "o timer nem foi armado");

    b.manager.playAgain(code, anfitriaoId);
    const interna = salaInterna(b.manager, code);
    exige(interna.resultTimer === null, "playAgain deixou o timer do resultado vivo");
    exige(interna.resultEndsAt === null, "playAgain deixou o prazo no estado");

    await sleep(350);
    exige(fase(b.manager, code) === "lobby", `o timer antigo mexeu na sala (fase ${fase(b.manager, code)})`);
    exige(rodada(b.manager, code) === 0, `rodada não zerou: ${rodada(b.manager, code)}`);
    return "de volta ao lobby, sem timer e sem prazo";
  });

  await verifica("sala abandonada no resultado não deixa timer para trás", async () => {
    const b = bancada({ resultMs: 2_000, finalResultMs: 2_000 });
    const { code, anfitriaoId, visitanteId } = await salaDeDois(b);
    todosPalpitam(b, code, [anfitriaoId, visitanteId]);
    const interna = salaInterna(b.manager, code);

    // Todo mundo fecha a aba: a sala é destruída com o timer de pé.
    b.manager.handleDisconnect(code, anfitriaoId);
    b.manager.leaveRoom(code, anfitriaoId);
    b.manager.leaveRoom(code, visitanteId);

    exige(!b.manager.hasRoom(code), "a sala vazia não foi destruída");
    exige(interna.resultTimer === null, "a sala morreu com o timer do resultado vivo");

    await sleep(100);
    return "sala destruída e timer cancelado junto";
  });

  await getPool().end().catch(() => {});

  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificações passaram`);
  for (const f of falhas) console.log(`  FALHA ${f.nome} — ${f.detalhe}`);
  process.exit(falhas.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro fatal no teste de avanço:", err);
  process.exit(1);
});
