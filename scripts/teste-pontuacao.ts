/**
 * O tamanho do mapa é a régua da pontuação. Se a régua estiver errada, o jogo
 * inteiro fica errado em silêncio: ninguém percebe que 300 km no Brasil está
 * valendo o mesmo que 300 km no mundo. Estas verificações prendem a régua.
 *
 *   npx tsx scripts/teste-pontuacao.ts
 */
import { mapSizeKmFor } from "../src/server/locations.ts";
import { haversineMeters, scoreForDistance } from "../src/lib/scoring.ts";
import type { RegionId } from "../src/lib/types.ts";

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

const REGIOES: RegionId[] = [
  "world", "brazil", "europe", "americas", "asia", "africa", "oceania", "world_rural", "famous",
];

console.log("\n[1] o tamanho de cada mapa é plausível");
for (const regiao of REGIOES) {
  const km = mapSizeKmFor(regiao);
  ok(
    `${regiao} fica entre 500 e 14.916 km`,
    km >= 500 && km <= 14_916,
    `${km.toLocaleString("pt-BR")} km`,
  );
}

ok("o mundo continua sendo a referência de 14.916 km", mapSizeKmFor("world") === 14_916, `${mapSizeKmFor("world")} km`);

// O Brasil cabe numa caixa de ~4.300 km de diagonal; uma régua muito maior que
// isso significaria que a caixa vazou (bug de longitude, por exemplo).
const brasil = mapSizeKmFor("brazil");
ok("o Brasil tem régua de país, não de mundo", brasil > 3_000 && brasil < 6_000, `${brasil.toLocaleString("pt-BR")} km`);

const europa = mapSizeKmFor("europe");
ok("a Europa tem régua de continente pequeno", europa > 3_000 && europa < 7_000, `${europa.toLocaleString("pt-BR")} km`);

console.log("\n[2] a longitude circular não infla a Oceania");
// As sementes da Oceania cruzam o antimeridiano (115°L a -175°). Uma caixa
// ingênua daria quase a volta ao mundo e a régua viraria a do mundo inteiro.
const oceania = mapSizeKmFor("oceania");
ok(
  "Oceania não estourou para o tamanho do mundo",
  oceania < 12_000,
  `${oceania.toLocaleString("pt-BR")} km (caixa ingênua daria ~14.916)`,
);

console.log("\n[3] o mesmo erro custa mais num mapa menor");
const erroKm = 300;
const noMundo = scoreForDistance(erroKm * 1000, mapSizeKmFor("world"));
const noBrasil = scoreForDistance(erroKm * 1000, mapSizeKmFor("brazil"));
ok(
  `errar ${erroKm} km vale menos no Brasil do que no mundo`,
  noBrasil < noMundo,
  `mundo ${noMundo} pts · Brasil ${noBrasil} pts`,
);
ok(
  "e a diferença é grande o bastante para o jogador sentir",
  noMundo - noBrasil > 300,
  `diferença de ${noMundo - noBrasil} pts`,
);

console.log("\n[4] os extremos continuam de pé em qualquer mapa");
for (const regiao of REGIOES) {
  const km = mapSizeKmFor(regiao);
  ok(`${regiao}: acerto exato dá 5000`, scoreForDistance(0, km) === 5000, "0 m → 5000 pts");
}
const metadeDoPlaneta = haversineMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 180 });
ok(
  "meio planeta de erro dá praticamente zero no mapa do mundo",
  scoreForDistance(metadeDoPlaneta, mapSizeKmFor("world")) < 5,
  `${Math.round(metadeDoPlaneta / 1000).toLocaleString("pt-BR")} km → ${scoreForDistance(metadeDoPlaneta, mapSizeKmFor("world"))} pts`,
);
ok(
  "a pontuação nunca é negativa nem passa de 5000",
  REGIOES.every((r) => {
    const km = mapSizeKmFor(r);
    return [0, 1, 1_000, 100_000, 20_000_000].every((m) => {
      const p = scoreForDistance(m, km);
      return p >= 0 && p <= 5000;
    });
  }),
  "testado de 0 a 20.000 km em todos os mapas",
);

console.log("\n[5] a régua é estável entre chamadas (cache não corrompe)");
ok(
  "chamar duas vezes devolve o mesmo número",
  REGIOES.every((r) => mapSizeKmFor(r) === mapSizeKmFor(r)),
  "todas as regiões",
);

const total = 9 + 3 + 1 + 2 + REGIOES.length + 2 + 1;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);
