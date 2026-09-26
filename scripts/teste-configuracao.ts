/**
 * A configuracao da sala vem do cliente, entao ela e entrada hostil.
 *
 * O caso que motivou estas verificacoes: `region` virava chave de busca nas
 * sementes do sorteio, e uma regiao que nao existe nao dava sorteio ruim —
 * estourava com "Cannot read properties of undefined", derrubando a rodada.
 *
 * Rodar com:  npx tsx scripts/teste-configuracao.ts
 */
import { RoomManager } from "../src/server/rooms.ts";
import { mapSizeKmFor } from "../src/server/locations.ts";
import { DEFAULT_AVATAR, DEFAULT_SETTINGS, type PlayerProfile } from "../src/lib/types.ts";

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

const perfil: PlayerProfile = { id: "p1", name: "anfitriao", avatar: { ...DEFAULT_AVATAR } };

/** Sala nova de festa, com o anfitriao dentro. */
function salaNova() {
  const rooms = new RoomManager(() => {});
  const { code, playerId } = rooms.createRoom(perfil, "socket-1");
  return { rooms, code, playerId };
}

function configurar(patch: Record<string, unknown>) {
  const { rooms, code, playerId } = salaNova();
  rooms.updateSettings(code, playerId, patch as never);
  return rooms.getState(code)!.settings;
}

console.log("\n[1] regiao inventada nao derruba a sala");
let cfg = configurar({ region: "atlantis" });
ok(
  "regiao desconhecida volta para o padrao",
  cfg.region === DEFAULT_SETTINGS.region,
  `"atlantis" → "${cfg.region}"`,
);

for (const lixo of [null, undefined, 42, "", "WORLD", { id: "world" }, ["world"]]) {
  cfg = configurar({ region: lixo });
  ok(
    `regiao ${JSON.stringify(lixo)} nao passa`,
    cfg.region === DEFAULT_SETTINGS.region,
    `→ "${cfg.region}"`,
  );
}

console.log("\n[2] toda regiao do catalogo continua aceita");
for (const regiao of [
  "world", "brazil", "europe", "americas", "asia", "africa", "oceania", "world_rural", "famous",
] as const) {
  cfg = configurar({ region: regiao });
  ok(`${regiao} e aceita`, cfg.region === regiao, `→ "${cfg.region}"`);
}

console.log("\n[3] a regiao que sai daqui sempre tem regua de pontuacao");
// Se `sanitizeSettings` deixasse passar algo fora do catalogo, isto estouraria
// — e a pontuacao da rodada e calculada por aqui.
let estourou: string | null = null;
try {
  for (const lixo of ["atlantis", null, 42, ""]) {
    mapSizeKmFor(configurar({ region: lixo }).region);
  }
} catch (err) {
  estourou = (err as Error).message;
}
ok("mapSizeKmFor nao estoura depois do saneamento", estourou === null, estourou ?? "nenhum estouro");

console.log("\n[4] numeros fora da faixa sao presos, nao aceitos");
cfg = configurar({ rounds: 9999 });
ok("rodadas acima do teto viram 20", cfg.rounds === 20, `9999 → ${cfg.rounds}`);
cfg = configurar({ rounds: 0 });
ok("zero rodada vira 1", cfg.rounds === 1, `0 → ${cfg.rounds}`);
cfg = configurar({ rounds: Number.NaN });
ok("NaN em rodadas vira 1", cfg.rounds === 1, `NaN → ${cfg.rounds}`);
cfg = configurar({ roundSeconds: -50 });
ok("tempo negativo vira 0 (sem limite)", cfg.roundSeconds === 0, `-50 → ${cfg.roundSeconds}`);
cfg = configurar({ roundSeconds: 99999 });
ok("tempo acima do teto vira 600", cfg.roundSeconds === 600, `99999 → ${cfg.roundSeconds}`);
cfg = configurar({ roundSeconds: Number.POSITIVE_INFINITY });
ok("Infinity em tempo nao passa", Number.isFinite(cfg.roundSeconds), `Infinity → ${cfg.roundSeconds}`);

console.log("\n[5] as regras de camera sao booleanos, nao o que o cliente mandar");
cfg = configurar({ allowZoom: "sim", allowPan: 1, allowMove: {} });
ok(
  "valores estranhos viram booleano",
  [cfg.allowZoom, cfg.allowPan, cfg.allowMove].every((v) => typeof v === "boolean"),
  `zoom=${cfg.allowZoom} pan=${cfg.allowPan} move=${cfg.allowMove}`,
);
cfg = configurar({ allowZoom: false, allowPan: false, allowMove: false });
ok(
  "desligar de verdade continua desligando",
  cfg.allowZoom === false && cfg.allowPan === false && cfg.allowMove === false,
  "as tres regras em false",
);

console.log("\n[6] quem nao e anfitriao nao muda a configuracao");
const { rooms, code } = salaNova();
rooms.updateSettings(code, "nao-sou-o-anfitriao", { rounds: 1 } as never);
ok(
  "palpite de outro jogador e ignorado",
  rooms.getState(code)!.settings.rounds === DEFAULT_SETTINGS.rounds,
  `rodadas seguem ${rooms.getState(code)!.settings.rounds}`,
);

const total = 1 + 7 + 9 + 1 + 6 + 2 + 1;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);
