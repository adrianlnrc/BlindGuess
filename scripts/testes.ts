/**
 * Roda todas as suites de uma vez.
 *
 * As suites nasceram uma a uma e viviam soltas: quem nao soubesse o nome do
 * arquivo nao as rodava, e teste que ninguem roda para de valer. Aqui elas tem
 * um lugar so, com o que cada uma precisa declarado — porque metade delas sobe
 * um servidor de verdade, e um servidor sem build ou sem Postgres falha de um
 * jeito que nao se parece nada com "o teste achou um bug".
 *
 * Rodar com:  npm test
 *             npm test -- --rapido     (so as que nao precisam de servidor)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";

type Suite = {
  arquivo: string;
  titulo: string;
  /**
   * Sobe `server.ts`: precisa do build de producao e do Postgres. Errar este
   * campo nao e detalhe — a suite falha de um jeito que parece bug do jogo.
   * Para conferir: rode com uma DATABASE_URL falsa e veja se ela pula.
   */
  precisaServidor?: boolean;
  /** Fuso extra em que vale a pena repetir a suite. */
  fusosExtras?: string[];
};

const SUITES: Suite[] = [
  { arquivo: "teste-locations.ts", titulo: "sorteio de local" },
  { arquivo: "teste-pontuacao.ts", titulo: "pontuação por tamanho de mapa" },
  { arquivo: "teste-paises.ts", titulo: "descoberta de país" },
  { arquivo: "teste-configuracao.ts", titulo: "configuração da sala" },
  { arquivo: "teste-duelo.ts", titulo: "duelo 1v1" },
  { arquivo: "teste-economia.ts", titulo: "nível e moedas" },
  {
    arquivo: "teste-virada-do-dia.ts",
    titulo: "virada do dia",
    // Sao Paulo nao tem horario de verao: sem um fuso que tenha, o caso mais
    // perigoso desta suite nunca e exercido.
    fusosExtras: ["Europe/Lisbon", "Pacific/Chatham"],
  },
  { arquivo: "teste-diagnostico.ts", titulo: "rota de diagnóstico" },
  { arquivo: "teste-avanco.ts", titulo: "avanço automático da rodada" },
  { arquivo: "teste-personagem.ts", titulo: "personagem 3D" },
  { arquivo: "teste-integracao-maps.ts", titulo: "integração com o Maps", precisaServidor: true },
  { arquivo: "teste-teclado.ts", titulo: "teclado do panorama e HUD", precisaServidor: true },
  { arquivo: "teste-sequencia.ts", titulo: "sequência de países", precisaServidor: true },
  { arquivo: "teste-navegador.ts", titulo: "navegador", precisaServidor: true },
  { arquivo: "teste-seguranca.ts", titulo: "segurança", precisaServidor: true },
  { arquivo: "teste-chat.ts", titulo: "chat da sala", precisaServidor: true },
  { arquivo: "teste-convite.ts", titulo: "convite de amigo", precisaServidor: true },
];

const rapido = process.argv.includes("--rapido");

/** O Postgres esta de pe? As suites de servidor nao sobem sem ele. */
function postgresNoAr(): Promise<boolean> {
  const url = process.env.DATABASE_URL ?? "postgresql://bg:bgpass@127.0.0.1:5432/blindguess_test";
  let host = "127.0.0.1";
  let port = 5432;
  try {
    const parsed = new URL(url);
    host = parsed.hostname || host;
    port = Number(parsed.port || 5432);
  } catch {
    // url estranha: tenta o padrao mesmo
  }

  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 2000 });
    const fim = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once("connect", () => fim(true));
    socket.once("error", () => fim(false));
    socket.once("timeout", () => fim(false));
  });
}

function roda(arquivo: string, env: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    const filho = spawn("node_modules/.bin/tsx", [`scripts/${arquivo}`], {
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, ...env },
      stdio: process.env.VERBOSE ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let saida = "";
    filho.stdout?.on("data", (d: Buffer) => (saida += d));
    filho.stderr?.on("data", (d: Buffer) => (saida += d));

    filho.on("close", (codigo) => {
      if (codigo !== 0 && !process.env.VERBOSE) {
        // So o suficiente para saber o que quebrou; o resto sai com VERBOSE=1.
        console.log(
          saida
            .split("\n")
            .filter((l) => /FALHA|Error|error/.test(l))
            .slice(0, 8)
            .map((l) => `        ${l.trim()}`)
            .join("\n"),
        );
      }
      resolve(codigo === 0);
    });
  });
}

async function main() {
  const temBuild = existsSync(new URL("../.next/BUILD_ID", import.meta.url));
  const temBanco = await postgresNoAr();

  const passaram: string[] = [];
  const falharam: string[] = [];
  const pulados: string[] = [];

  for (const suite of SUITES) {
    if (suite.precisaServidor && rapido) {
      pulados.push(`${suite.titulo} (--rapido)`);
      continue;
    }

    if (suite.precisaServidor && (!temBuild || !temBanco)) {
      const porque = !temBuild ? "sem build (rode `npm run build`)" : "sem Postgres no ar";
      pulados.push(`${suite.titulo} — ${porque}`);
      continue;
    }

    const fusos = ["", ...(suite.fusosExtras ?? [])];
    for (const fuso of fusos) {
      const nome = fuso ? `${suite.titulo} [${fuso}]` : suite.titulo;
      process.stdout.write(`  ${nome} … `);
      const ok = await roda(suite.arquivo, fuso ? { BLINDGUESS_TIMEZONE: fuso } : {});
      console.log(ok ? "ok" : "FALHOU");
      (ok ? passaram : falharam).push(nome);
    }
  }

  console.log(`\n${passaram.length} passaram · ${falharam.length} falharam · ${pulados.length} pulados`);
  for (const p of pulados) console.log(`  pulado: ${p}`);
  for (const f of falharam) console.log(`  FALHOU: ${f}`);

  // Pular nao e passar: quem roda isto precisa saber que faltou cobertura.
  if (pulados.length > 0 && falharam.length === 0) {
    console.log("\nAtenção: nem tudo rodou. Suba o Postgres e faça o build para a cobertura inteira.");
  }

  process.exit(falharam.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("erro ao rodar as suites:", err);
  process.exit(1);
});
