import { emailEnabled, googleEnabled } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * Quais formas de login estao ligadas neste servidor. Lido em runtime, para a
 * tela de login refletir as variaveis sem precisar de um novo build.
 */
export function GET() {
  return Response.json({ google: googleEnabled, email: emailEnabled });
}
