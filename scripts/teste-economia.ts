/**
 * Nivel e moedas: as duas contas que o jogador acompanha entre partidas.
 *
 * Sao funcoes puras, o que engana — parece que nao precisam de teste. Mas o
 * README promete numeros exatos ("nivel 2 em 2.500, 21 em 1 milhao"), a loja
 * cobra preco fixo em cima do saldo, e a sequencia de paises paga por uma regra
 * diferente de todos os outros modos. Errar aqui nao quebra nada: o jogador so
 * sobe de nivel na hora errada, ou nunca junta para o chapeu.
 *
 * Rodar com:  npx tsx scripts/teste-economia.ts
 */
import { levelForXp, levelInfo, xpForLevel } from "../src/lib/level.ts";
import { COINS_POR_PAIS, coinsEarned } from "../src/lib/shop.ts";
import type { GameMode } from "../src/lib/types.ts";

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

console.log("\n[1] a curva de nível é a que o README promete");
for (const [nivel, xp] of [[2, 2_500], [3, 10_000], [4, 22_500], [5, 40_000], [21, 1_000_000]] as const) {
  ok(`nível ${nivel} em ${xp.toLocaleString("pt-BR")}`, xpForLevel(nivel) === xp, `${xpForLevel(nivel)}`);
}

console.log("\n[2] nível e XP são inversos um do outro");
for (const nivel of [1, 2, 3, 7, 21, 50]) {
  ok(`nível ${nivel} ida e volta`, levelForXp(xpForLevel(nivel)) === nivel, `→ ${levelForXp(xpForLevel(nivel))}`);
}
// Um ponto antes do limiar ainda e o nivel de baixo: e o que faz a barra encher
// ate o fim em vez de pular.
ok(
  "um ponto antes do limiar ainda é o nível anterior",
  levelForXp(xpForLevel(5) - 1) === 4,
  `${xpForLevel(5) - 1} → nível ${levelForXp(xpForLevel(5) - 1)}`,
);

console.log("\n[3] XP estranho não quebra a tela");
for (const xp of [0, -1, -999_999, Number.NaN]) {
  const nivel = levelForXp(xp);
  ok(`xp ${xp} não fica abaixo do nível 1`, nivel >= 1, `nível ${nivel}`);
}
for (const xp of [0, 1, 2_499, 2_500, 999_999]) {
  const info = levelInfo(xp);
  ok(
    `progresso de ${xp} fica entre 0 e 1`,
    info.progress >= 0 && info.progress <= 1 && Number.isFinite(info.progress),
    `${info.progress.toFixed(3)} · falta ${info.toNextLevel}`,
  );
}

console.log("\n[4] moedas: uma por mil pontos, com os bônus de cada modo");
const base = { isDaily: false, mode: "solo" as GameMode };
ok("2.500 pontos pagam 2", coinsEarned({ ...base, totalScore: 2_500 }) === 2, `${coinsEarned({ ...base, totalScore: 2_500 })}`);
ok("999 pontos pagam 0", coinsEarned({ ...base, totalScore: 999 }) === 0, `${coinsEarned({ ...base, totalScore: 999 })}`);
ok(
  "o desafio do dia paga 25 a mais",
  coinsEarned({ ...base, totalScore: 2_000, isDaily: true }) === 27,
  `${coinsEarned({ ...base, totalScore: 2_000, isDaily: true })}`,
);
ok(
  "vencer o duelo paga 40 a mais",
  coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "win" }) === 41,
  `${coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "win" })}`,
);
ok(
  "empatar o duelo paga 15 a mais",
  coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "draw" }) === 16,
  `${coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "draw" })}`,
);
ok(
  "perder o duelo não paga bônus",
  coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "loss" }) === 1,
  `${coinsEarned({ totalScore: 1_000, mode: "duel", isDaily: false, duelOutcome: "loss" })}`,
);

console.log("\n[5] a sequência de países paga por país, não por ponto");
// Ela nao tem pontuacao: pela regra normal, um jogo inteiro pagaria zero.
ok(
  "cinco países pagam como vencer um duelo",
  coinsEarned({ totalScore: 0, mode: "streak", isDaily: false, streakLength: 5 }) === 5 * COINS_POR_PAIS,
  `${coinsEarned({ totalScore: 0, mode: "streak", isDaily: false, streakLength: 5 })} moedas`,
);
ok(
  "sequência zero paga zero",
  coinsEarned({ totalScore: 0, mode: "streak", isDaily: false, streakLength: 0 }) === 0,
  "0",
);
ok(
  "sem streakLength não paga (nem quebra)",
  coinsEarned({ totalScore: 9_999, mode: "streak", isDaily: false }) === 0,
  `${coinsEarned({ totalScore: 9_999, mode: "streak", isDaily: false })}`,
);
ok(
  "a pontuação é ignorada na sequência",
  coinsEarned({ totalScore: 50_000, mode: "streak", isDaily: false, streakLength: 2 }) === 2 * COINS_POR_PAIS,
  `${coinsEarned({ totalScore: 50_000, mode: "streak", isDaily: false, streakLength: 2 })}`,
);

console.log("\n[6] número estranho nunca vira moeda de graça");
for (const totalScore of [-5_000, Number.NaN, Number.POSITIVE_INFINITY]) {
  const moedas = coinsEarned({ ...base, totalScore });
  ok(`pontuação ${totalScore} não paga negativo nem Infinity`, Number.isFinite(moedas) && moedas >= 0, `${moedas}`);
}
for (const streakLength of [-3, Number.NaN, 2.7]) {
  const moedas = coinsEarned({ totalScore: 0, mode: "streak", isDaily: false, streakLength });
  ok(
    `sequência ${streakLength} não paga negativo nem quebrado`,
    Number.isInteger(moedas) && moedas >= 0,
    `${moedas}`,
  );
}

const total = 5 + 7 + 4 + 5 + 6 + 4 + 6;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);
