import { emailEnabled, googleEnabled } from "@/auth";
import { getPool, hasDatabase } from "@/server/db";

export const dynamic = "force-dynamic";

/** Resultado de uma verificacao individual. */
type Check = { ok: boolean; detail: string };

type HealthReport = {
  ok: boolean;
  checks: {
    database: Check;
    mapsBrowserKey: Check;
    mapsServerKey: Check;
    auth: Check;
  };
};

/** Ponto conhecido com cobertura de Street View (Av. Paulista, Sao Paulo). */
const PONTO_DE_TESTE = "-23.5505,-46.6333";

/** Timeout curto: a rota de diagnostico nao pode pendurar esperando o Google. */
const TIMEOUT_MS = 5000;

/**
 * Diagnostico de configuracao. Verifica cada dependencia de verdade — nao basta
 * a variavel existir — e devolve mensagens acionaveis em portugues.
 *
 * Responde SEMPRE com HTTP 200, mesmo quando algo falha: assim a rota serve de
 * health check sem derrubar o deploy, e o estado real vai no corpo.
 *
 * Nenhum valor de chave (nem parcial) aparece na resposta.
 */
export async function GET() {
  const [database, mapsServerKey] = await Promise.all([checkDatabase(), checkMapsServerKey()]);
  const mapsBrowserKey = checkMapsBrowserKey();
  const auth = checkAuth();

  const report: HealthReport = {
    // O jogo so fica de pe se houver panorama para sortear; o banco e opcional
    // (sem ele o jogo roda degradado, sem login/ranking/streak).
    ok: mapsServerKey.ok && mapsBrowserKey.ok,
    checks: { database, mapsBrowserKey, mapsServerKey, auth },
  };

  return Response.json(report, { status: 200 });
}

/** SELECT 1 de verdade pelo pool, para distinguir "configurado" de "acessivel". */
async function checkDatabase(): Promise<Check> {
  if (!hasDatabase()) {
    return {
      ok: false,
      detail:
        "DATABASE_URL não configurada — o jogo roda, mas login, ranking, streak e desafios ficam desligados.",
    };
  }

  try {
    await getPool().query("SELECT 1");
    return { ok: true, detail: "conectado" };
  } catch (err) {
    return {
      ok: false,
      detail: `falha ao conectar: ${mensagemDeErro(err)} — confira DATABASE_URL, se o Postgres está no ar e se aceita conexões deste host.`,
    };
  }
}

/**
 * So da para conferir presenca: restricao por HTTP referrer e coisa que o
 * servidor nao consegue validar (o Google avalia o cabecalho do navegador).
 */
function checkMapsBrowserKey(): Check {
  const presente = !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const lembrete =
    "ela é embutida no bundle em tempo de BUILD: se mudou a chave, refaça o deploy. A restrição por referrer não dá para validar daqui.";

  return presente
    ? { ok: true, detail: `definida — ${lembrete}` }
    : {
        ok: false,
        detail: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ausente — o mapa e o Street View não carregam no navegador. Lembre que ${lembrete}`,
      };
}

/**
 * Chamada real a Street View Metadata API (mesmo padrao de src/server/locations.ts)
 * num ponto com cobertura conhecida. O status da resposta e traduzido para uma
 * mensagem acionavel.
 */
async function checkMapsServerKey(): Promise<Check> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      detail:
        "GOOGLE_MAPS_API_KEY ausente (e sem NEXT_PUBLIC_GOOGLE_MAPS_API_KEY para usar no lugar) — o servidor não consegue sortear locais e nenhuma rodada abre.",
    };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  url.searchParams.set("location", PONTO_DE_TESTE);
  url.searchParams.set("key", apiKey);

  let data: { status?: string; error_message?: string };
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      return { ok: false, detail: `a API do Google respondeu HTTP ${res.status} — tente de novo em instantes.` };
    }
    data = (await res.json()) as { status?: string; error_message?: string };
  } catch (err) {
    return {
      ok: false,
      detail: `não foi possível falar com a API do Google: ${mensagemDeErro(err)} — verifique a saída de rede do servidor.`,
    };
  }

  return traduzStatus(data.status ?? "DESCONHECIDO");
}

/** Traducao dos status da Metadata API para instrucoes de configuracao. */
function traduzStatus(status: string): Check {
  switch (status) {
    case "OK":
      return { ok: true, detail: "OK: chave válida e Street View respondendo" };
    case "ZERO_RESULTS":
      // A chave funcionou (o Google so responde isso depois de autorizar).
      return {
        ok: true,
        detail: "ZERO_RESULTS: a chave funciona, mas o ponto de teste ficou sem panorama — pode ser variação do acervo do Google.",
      };
    case "REQUEST_DENIED":
      return {
        ok: false,
        detail:
          "REQUEST_DENIED: ative a Street View Static API no projeto do Google Cloud e confira as restrições da chave (uma chave restrita por HTTP referrer não funciona no servidor; use restrição por IP ou nenhuma).",
      };
    case "OVER_QUERY_LIMIT":
      return {
        ok: false,
        detail:
          "OVER_QUERY_LIMIT: cota estourada ou faturamento não habilitado — habilite o billing no projeto do Google Cloud e confira os limites de uso da chave.",
      };
    case "INVALID_REQUEST":
      return {
        ok: false,
        detail: "INVALID_REQUEST: o Google recusou os parâmetros da consulta — isso indica um bug na chamada, não na configuração.",
      };
    case "NOT_FOUND":
      return {
        ok: false,
        detail: "NOT_FOUND: o Google não encontrou panorama para o ponto de teste.",
      };
    default:
      return { ok: false, detail: `status inesperado da API do Google: ${status}` };
  }
}

/** Provedores de login ligados, conforme as flags de src/auth.ts. */
function checkAuth(): Check {
  const provedores = [googleEnabled && "google", emailEnabled && "email"].filter(
    (p): p is string => typeof p === "string",
  );

  if (provedores.length === 0) {
    return {
      ok: false,
      detail:
        "nenhum provedor configurado — defina AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET e/ou AUTH_RESEND_KEY/EMAIL_FROM. Sem login, todo mundo joga como convidado.",
    };
  }

  if (!hasDatabase()) {
    return {
      ok: false,
      detail: `${provedores.join(", ")} configurado(s), mas sem DATABASE_URL o login fica desligado (as sessões são guardadas no banco).`,
    };
  }

  return { ok: true, detail: provedores.join(", ") };
}

/** Texto curto do erro, sem vazar objetos com credenciais dentro. */
function mensagemDeErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
