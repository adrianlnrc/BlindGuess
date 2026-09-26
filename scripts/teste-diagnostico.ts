/**
 * `/api/health` e publica e sem autenticacao: qualquer um na internet pode
 * pedi-la. Ela existe para quem esta configurando o jogo descobrir o que falta,
 * entao precisa ser util — e nao pode pagar por isso contando segredo.
 *
 * O caso que motivou estas verificacoes: numa falha de banco a rota devolvia a
 * mensagem crua do driver, que nomeia host, porta e usuario do Postgres.
 *
 * Rodar com:  npx tsx scripts/teste-diagnostico.ts
 */

// Precisa vir antes do import da rota: o modulo do banco le isto ao carregar.
// Porta fechada em 127.0.0.1 da ECONNREFUSED na hora, sem esperar timeout.
process.env.DATABASE_URL = "postgresql://usuario_secreto:senha_secreta@127.0.0.1:59999/banco_secreto";
process.env.GOOGLE_MAPS_API_KEY = "CHAVE-DE-SERVIDOR-SECRETA";
process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "CHAVE-DE-NAVEGADOR-SECRETA";
process.env.AUTH_GOOGLE_SECRET = "SEGREDO-DO-GOOGLE";
process.env.AUTH_RESEND_KEY = "SEGREDO-DO-RESEND";

const SEGREDOS = [
  "usuario_secreto",
  "senha_secreta",
  "banco_secreto",
  "59999",
  "CHAVE-DE-SERVIDOR-SECRETA",
  "CHAVE-DE-NAVEGADOR-SECRETA",
  "SEGREDO-DO-GOOGLE",
  "SEGREDO-DO-RESEND",
];

let falhas = 0;

function ok(titulo: string, condicao: boolean, detalhe: string) {
  console.log(`  ${condicao ? "ok  " : "FALHA"} ${titulo} — ${detalhe}`);
  if (!condicao) falhas += 1;
}

// O erro do banco vai para o log do servidor; aqui ele so polui a saida.
const erroOriginal = console.error;
const logDoServidor: string[] = [];
console.error = (...args: unknown[]) => {
  logDoServidor.push(args.map(String).join(" "));
};

const { GET } = await import("../src/app/api/health/route.ts");
const resposta = await GET();
const corpo = await resposta.text();
console.error = erroOriginal;

const relatorio = JSON.parse(corpo) as {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail: string }>;
};

console.log("\n[1] nenhum segredo sai na resposta");
for (const segredo of SEGREDOS) {
  ok(`"${segredo}" não aparece`, !corpo.includes(segredo), corpo.includes(segredo) ? "VAZOU" : "ausente");
}

console.log("\n[2] a rota continua sendo útil");
ok("responde 200 mesmo com tudo quebrado", resposta.status === 200, `HTTP ${resposta.status}`);
ok(
  "aponta que o banco falhou",
  relatorio.checks.database?.ok === false,
  relatorio.checks.database?.detail.slice(0, 60) ?? "(sem detalhe)",
);
ok(
  "diz por onde começar, sem o texto do driver",
  /conexão recusada|tempo esgotado|host não resolvido|credenciais/.test(
    relatorio.checks.database?.detail ?? "",
  ),
  "pista curta presente",
);
ok(
  "manda procurar o motivo exato no log",
  (relatorio.checks.database?.detail ?? "").includes("log"),
  "aponta para o log do servidor",
);
ok(
  "todas as quatro verificações estão no relatório",
  ["database", "mapsBrowserKey", "mapsServerKey", "auth"].every((k) => k in relatorio.checks),
  Object.keys(relatorio.checks).join(", "),
);

console.log("\n[3] o motivo exato existe — no log, não na resposta");
ok(
  "o erro cru do banco foi para o log do servidor",
  logDoServidor.some((linha) => linha.includes("[health]") && linha.includes("59999")),
  logDoServidor.find((l) => l.includes("[health]"))?.slice(0, 70) ?? "(nada no log)",
);

console.log("\n[4] a chave nunca é ecoada, nem em pedaço");
// Um prefixo de chave ainda é material para quem quer adivinhar o resto.
for (const pedaco of ["CHAVE-DE-SERVIDOR", "CHAVE-DE-NAVEG", "SEGREDO-DO"]) {
  ok(`pedaço "${pedaco}" não aparece`, !corpo.includes(pedaco), "ausente");
}

const total = SEGREDOS.length + 5 + 1 + 3;
console.log(
  falhas === 0
    ? `\n${total}/${total} verificações passaram\n`
    : `\n${falhas} de ${total} verificações FALHARAM\n`,
);
process.exit(falhas === 0 ? 0 : 1);

export {};
