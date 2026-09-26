/**
 * A virada do dia decide quando o desafio do dia troca e quando a streak
 * quebra. E puro calculo de fuso, que e onde bug se esconde bem: nada quebra,
 * o dia so vira na hora errada — e ninguem percebe ate perder uma streak.
 *
 * Rodar com:  npx tsx scripts/teste-virada-do-dia.ts
 */
import { today, nextDailyResetAt } from "../src/server/store.ts";

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

/** Hora local de um instante, no fuso pedido. */
function horaLocal(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

const SP = "America/Sao_Paulo";
/** O fuso que o modulo esta mesmo usando: BLINDGUESS_TIMEZONE troca tudo. */
const tz = process.env.BLINDGUESS_TIMEZONE ?? SP;

console.log(`\n[1] a virada cai na meia-noite de ${tz}, não na de Londres`);
for (const iso of [
  "2026-09-26T18:00:00Z",
  "2026-03-09T23:00:00Z",
  "2026-06-15T12:00:00Z",
  // 21:30 em SP: ja e "amanha" em UTC, e o ingenuo erraria o dia aqui.
  "2026-07-02T00:30:00Z",
  // Virada do ano.
  "2026-12-31T23:30:00Z",
]) {
  const quando = nextDailyResetAt(new Date(iso));
  ok(`${iso} vira à meia-noite`, horaLocal(quando, tz) === "00:00:00", `→ ${horaLocal(quando, tz)} em ${tz}`);
}

console.log("\n[2] a virada é sempre no futuro, e a menos de 24h");
for (const iso of ["2026-09-26T02:59:59Z", "2026-09-26T03:00:01Z", "2026-09-26T23:59:59Z"]) {
  const at = new Date(iso);
  const faltam = (nextDailyResetAt(at) - at.getTime()) / 3_600_000;
  ok(
    `${iso} falta entre 0 e 24 h`,
    faltam > 0 && faltam <= 24,
    `${faltam.toFixed(2)} h`,
  );
}

console.log("\n[3] a função é determinística");
// `tzOffsetMs` compara um instante truncado em segundos com um que tem
// milissegundos: sem descartar o resto, duas chamadas no mesmo segundo davam
// valores diferentes, e qualquer teste em cima disso seria instável.
const base = new Date("2026-09-26T18:00:00.000Z");
const comMs = new Date("2026-09-26T18:00:00.937Z");
ok(
  "milissegundos não vazam para o resultado",
  nextDailyResetAt(base) === nextDailyResetAt(comMs),
  `${new Date(nextDailyResetAt(comMs)).toISOString()}`,
);
ok(
  "o resultado é um segundo cheio",
  nextDailyResetAt(comMs) % 1000 === 0,
  `resto ${nextDailyResetAt(comMs) % 1000} ms`,
);

console.log("\n[4] o dia local bate com a virada");
for (const iso of ["2026-09-26T18:00:00Z", "2026-07-02T00:30:00Z", "2026-12-31T23:30:00Z"]) {
  const at = new Date(iso);
  const diaDeHoje = today(at);
  // A virada é o começo do dia seguinte: um instante antes ainda é hoje.
  const umPoucoAntes = today(new Date(nextDailyResetAt(at) - 1000));
  ok(
    `${iso}: um segundo antes da virada ainda é ${diaDeHoje}`,
    umPoucoAntes === diaDeHoje,
    `hoje=${diaDeHoje} · antes da virada=${umPoucoAntes}`,
  );
}

console.log("\n[5] horário de verão não desloca a virada");
// O Brasil não tem mais horário de verão, mas BLINDGUESS_TIMEZONE deixa trocar
// o fuso. Medir o deslocamento "agora" e aplicá-lo em "amanhã" erra uma hora
// numa janela estreita: entre a meia-noite local e a transição, "hoje" já é o
// dia da mudança, então a PRÓXIMA meia-noite tem outro deslocamento. Fora dessa
// janela os dois deslocamentos coincidem e o cálculo ingênuo também acerta —
// por isso as datas aqui são de madrugada, não de fim de tarde.
console.log("      (rodar com BLINDGUESS_TIMEZONE=Europe/Lisbon cobre este caso)");
for (const iso of ["2026-03-29T00:30:00Z", "2026-10-25T00:30:00Z", "2026-03-29T20:00:00Z"]) {
  const quando = nextDailyResetAt(new Date(iso));
  ok(
    `${iso} vira à meia-noite em ${tz}`,
    horaLocal(quando, tz) === "00:00:00",
    `→ ${horaLocal(quando, tz)}`,
  );
}

const total = 5 + 3 + 2 + 3 + 3;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram (fuso: ${tz})\n`
    : `\n${falhas} de ${total} verificações FALHARAM (fuso: ${tz})\n`,
);
process.exit(falhas === 0 ? 0 : 1);
