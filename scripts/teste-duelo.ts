/**
 * O duelo 1v1 nao tinha teste nenhum, e e aritmetica de estado: vida que desce,
 * multiplicador que cresce, teto de rodadas e um vencedor. Errar aqui nao trava
 * nada — o duelo so termina na hora errada, ou no jogador errado.
 *
 * Rodar com:  npx tsx scripts/teste-duelo.ts
 */
import { RoomManager } from "../src/server/rooms.ts";
import { DUEL_MAX_ROUNDS, DUEL_START_HP, damageFor, duelMultiplier } from "../src/lib/duel.ts";
import { DEFAULT_AVATAR, type LatLng, type PlayerProfile } from "../src/lib/types.ts";

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

const perfil = (id: string, name: string): PlayerProfile => ({
  id,
  name,
  avatar: { ...DEFAULT_AVATAR },
});

/** Local fixo: o duelo nao depende de onde caiu, so da distancia relativa. */
const ALVO: LatLng = { lat: 0, lng: 0 };

async function duelo() {
  const manager = new RoomManager(() => {}, {
    pickLocation: async () => ({ ...ALVO, panoId: `pano-${Math.random()}` }),
    retryDelaysMs: [1],
    resultMs: 50,
    finalResultMs: 50,
  });

  const a = manager.createDuel(perfil("a", "Ana"), "socket-a");
  const entrou = manager.joinRoom(a.code, perfil("b", "Bia"), "socket-b");
  if (!entrou.ok) throw new Error(`Bia não entrou: ${entrou.error}`);

  await manager.startGame(a.code, a.playerId);
  return { manager, code: a.code, anaId: a.playerId, biaId: entrou.playerId };
}

/** Espera a fase sair de `playing` depois dos dois palpites. */
async function rodada(
  manager: RoomManager,
  code: string,
  anaId: string,
  biaId: string,
  distanciaDaBia: number,
) {
  // Ana crava; Bia erra por `distanciaDaBia` graus de longitude.
  manager.submitGuess(code, anaId, { ...ALVO });
  manager.submitGuess(code, biaId, { lat: 0, lng: distanciaDaBia });
  await new Promise((r) => setTimeout(r, 5));
  return manager.getState(code)!;
}

console.log("\n[1] o multiplicador cresce nas rodadas certas");
for (const [round, esperado] of [
  [1, 1], [2, 1], [3, 1.5], [4, 1.5], [5, 2], [6, 2], [7, 3], [30, 3],
] as const) {
  ok(`rodada ${round} → ×${esperado}`, duelMultiplier(round) === esperado, `×${duelMultiplier(round)}`);
}

console.log("\n[2] o dano é a diferença de pontos vezes o multiplicador");
const dano = damageFor(3, [
  { playerId: "a", score: 5000 },
  { playerId: "b", score: 1000 },
]);
ok("quem pontuou menos é quem perde vida", dano?.playerId === "b", `perdeu: ${dano?.playerId}`);
ok("4000 de diferença na rodada 3 = 6000 de dano", dano?.amount === 6000, `${dano?.amount}`);
ok("empate não tira vida de ninguém", damageFor(1, [
  { playerId: "a", score: 2500 },
  { playerId: "b", score: 2500 },
]) === null, "null");
ok("com um jogador só não há dano", damageFor(1, [{ playerId: "a", score: 10 }]) === null, "null");

console.log("\n[3] a vida começa cheia e desce");
{
  const { manager, code, anaId, biaId } = await duelo();
  let estado = manager.getState(code)!;
  ok(
    `os dois começam com ${DUEL_START_HP}`,
    estado.duel?.hp[anaId] === DUEL_START_HP && estado.duel?.hp[biaId] === DUEL_START_HP,
    `Ana ${estado.duel?.hp[anaId]} · Bia ${estado.duel?.hp[biaId]}`,
  );

  estado = await rodada(manager, code, anaId, biaId, 10);
  const perdida = DUEL_START_HP - (estado.duel?.hp[biaId] ?? 0);
  ok("Bia errou e perdeu vida", perdida > 0, `−${perdida} de vida`);
  ok("Ana cravou e não perdeu nada", estado.duel?.hp[anaId] === DUEL_START_HP, `${estado.duel?.hp[anaId]}`);
  ok(
    "o dano da rodada aparece no resultado",
    estado.lastResult?.damage?.playerId === biaId,
    `dano em ${estado.lastResult?.damage?.playerId} (×${estado.lastResult?.damage?.multiplier})`,
  );
}

console.log("\n[4] zerar a vida encerra o duelo, e a vida não fica negativa");
{
  const { manager, code, anaId, biaId } = await duelo();
  let estado = manager.getState(code)!;

  // Erro gigante: 180 graus de longitude zera a pontuacao da Bia, entao o dano
  // e 5000 por rodada. Com 6000 de vida, duas rodadas bastam.
  for (let i = 0; i < 10 && !estado.duel?.winnerId; i += 1) {
    estado = await rodada(manager, code, anaId, biaId, 180);
    if (estado.phase === "round-result" && !estado.duel?.winnerId) {
      await manager.nextRound(code, anaId);
    }
  }

  ok("Ana venceu", estado.duel?.winnerId === anaId, `vencedor: ${estado.duel?.winnerId}`);
  ok("a vida da Bia parou em zero, não abaixo", (estado.duel?.hp[biaId] ?? -1) === 0, `${estado.duel?.hp[biaId]}`);
  ok("a vida da Ana ficou intacta", estado.duel?.hp[anaId] === DUEL_START_HP, `${estado.duel?.hp[anaId]}`);
}

console.log("\n[5] não palpitar conta como zero");
{
  // Com o cronometro em 1s o servidor fecha a rodada sozinho, que e o caminho
  // real de quem sumiu — nao ha atalho para forcar isso de fora.
  const manager = new RoomManager(() => {}, {
    pickLocation: async () => ({ ...ALVO, panoId: "pano-sumico" }),
    retryDelaysMs: [1],
    resultMs: 5_000,
  });
  const a = manager.createDuel(perfil("a", "Ana"), "socket-a");
  const b = manager.joinRoom(a.code, perfil("b", "Bia"), "socket-b");
  if (!b.ok) throw new Error(b.error);

  manager.updateSettings(a.code, a.playerId, { roundSeconds: 1 });
  ok(
    "o cronômetro aceitou 1 segundo",
    manager.getState(a.code)!.settings.roundSeconds === 1,
    `${manager.getState(a.code)!.settings.roundSeconds}s`,
  );

  await manager.startGame(a.code, a.playerId);
  // Ana crava; Bia nunca palpita.
  manager.submitGuess(a.code, a.playerId, { ...ALVO });
  // 1s de cronometro + TIMER_GRACE_MS (1,5s de folga de rede) + margem.
  await new Promise((r) => setTimeout(r, 3_000));

  const estado = manager.getState(a.code)!;
  ok("a rodada fechou sozinha", estado.phase !== "playing", `fase ${estado.phase}`);
  ok(
    "quem sumiu levou o dano máximo da rodada",
    estado.lastResult?.damage?.playerId === b.playerId && estado.lastResult.damage.amount === 5000,
    `${estado.lastResult?.damage?.amount ?? 0} de dano em ${estado.lastResult?.damage?.playerId ?? "ninguém"}`,
  );
}

console.log("\n[6] no teto de rodadas ganha quem tem mais vida");
ok(
  `o teto é de ${DUEL_MAX_ROUNDS} rodadas`,
  DUEL_MAX_ROUNDS === 25,
  `${DUEL_MAX_ROUNDS}`,
);
{
  const { manager, code, anaId, biaId } = await duelo();
  let estado = manager.getState(code)!;

  // Erros pequenos: dano baixo, para o duelo chegar ao teto sem ninguem zerar.
  for (let i = 0; i < DUEL_MAX_ROUNDS + 2 && estado.phase !== "finished"; i += 1) {
    estado = await rodada(manager, code, anaId, biaId, 0.02);
    if (estado.phase === "round-result") {
      await manager.nextRound(code, anaId);
      await new Promise((r) => setTimeout(r, 5));
      estado = manager.getState(code)!;
    }
  }

  ok("o duelo terminou", estado.phase === "finished", `fase ${estado.phase}`);
  ok(
    "não passou do teto de rodadas",
    estado.round <= DUEL_MAX_ROUNDS,
    `parou na rodada ${estado.round}`,
  );
  const hpAna = estado.duel?.hp[anaId] ?? 0;
  const hpBia = estado.duel?.hp[biaId] ?? 0;
  ok(
    "venceu quem tem mais vida",
    hpAna === hpBia ? estado.duel?.winnerId === null : estado.duel?.winnerId === (hpAna > hpBia ? anaId : biaId),
    `Ana ${hpAna} · Bia ${hpBia} → ${estado.duel?.winnerId ?? "empate"}`,
  );
}

console.log("\n[7] jogar de novo devolve a vida cheia");
{
  const { manager, code, anaId, biaId } = await duelo();
  await rodada(manager, code, anaId, biaId, 180);
  manager.playAgain(code, anaId);
  await manager.startGame(code, anaId);
  const estado = manager.getState(code)!;

  ok(
    "os dois voltam com a vida cheia",
    estado.duel?.hp[anaId] === DUEL_START_HP && estado.duel?.hp[biaId] === DUEL_START_HP,
    `Ana ${estado.duel?.hp[anaId]} · Bia ${estado.duel?.hp[biaId]}`,
  );
  ok("sem vencedor pendurado da partida anterior", estado.duel?.winnerId === null, `${estado.duel?.winnerId}`);
  ok("a contagem de rodadas recomeça", estado.round === 1, `rodada ${estado.round}`);
}

console.log("\n[8] o duelo é só para dois");
{
  const manager = new RoomManager(() => {}, {
    pickLocation: async () => ({ ...ALVO, panoId: "p" }),
    retryDelaysMs: [1],
  });
  const a = manager.createDuel(perfil("a", "Ana"), "socket-a");
  manager.joinRoom(a.code, perfil("b", "Bia"), "socket-b");
  const terceiro = manager.joinRoom(a.code, perfil("c", "Caio"), "socket-c");
  ok("o terceiro é recusado", !terceiro.ok, terceiro.ok ? "ENTROU" : terceiro.error);

  const sozinho = new RoomManager(() => {}, { pickLocation: async () => ({ ...ALVO, panoId: "p" }) });
  const s = sozinho.createDuel(perfil("a", "Ana"), "socket-a");
  await sozinho.startGame(s.code, s.playerId);
  const estado = sozinho.getState(s.code)!;
  ok(
    "duelo com um jogador só não começa",
    estado.phase === "lobby" && !!estado.error,
    `fase ${estado.phase} · ${estado.error ?? "(sem aviso)"}`,
  );
}

const total = 8 + 4 + 4 + 3 + 3 + 1 + 3 + 3 + 2;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);
