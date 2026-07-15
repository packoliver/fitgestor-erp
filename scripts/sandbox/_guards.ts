// Guardas de segurança compartilhadas — aborta se detectar produção.
// Import com: import { assertSandboxEnv } from "./_guards";

const PROD_REF = "crlgixvekzgeizckzxgg"; // Ref de produção deste projeto Lovable.

export interface SandboxEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  dbUrl?: string;
}

export function assertSandboxEnv(): SandboxEnv {
  const appEnv = process.env.APP_ENV;
  const allow = process.env.ALLOW_SANDBOX_SEED;
  const url = process.env.SANDBOX_SUPABASE_URL;
  const key = process.env.SANDBOX_SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.SANDBOX_DB_URL;

  const errors: string[] = [];
  if (appEnv !== "staging" && appEnv !== "test") {
    errors.push(`APP_ENV deve ser "staging" ou "test" (recebido: ${appEnv ?? "vazio"})`);
  }
  if (allow !== "true") {
    errors.push(`ALLOW_SANDBOX_SEED deve ser "true"`);
  }
  if (!url) {
    errors.push(`SANDBOX_SUPABASE_URL não definida`);
  } else if (url.includes(PROD_REF)) {
    errors.push(`SANDBOX_SUPABASE_URL aponta para produção (${PROD_REF}). ABORTAR.`);
  }
  if (!key) {
    errors.push(`SANDBOX_SUPABASE_SERVICE_ROLE_KEY não definida`);
  }

  if (errors.length > 0) {
    console.error("\n❌ Sandbox guards falharam:\n" + errors.map((e) => "  • " + e).join("\n"));
    process.exit(1);
  }

  console.log(`✅ Sandbox guards OK — destino: ${url}`);
  return { supabaseUrl: url!, serviceRoleKey: key!, dbUrl };
}

export const SANDBOX_IDS = {
  orgA: "aaaa0000-0000-0000-0000-000000000001",
  orgB: "bbbb0000-0000-0000-0000-000000000001",
  clientA1: "aaaa0000-0000-0000-0001-000000000001",
  clientA2: "aaaa0000-0000-0000-0001-000000000002",
  clientB1: "bbbb0000-0000-0000-0001-000000000001",
  clientB2: "bbbb0000-0000-0000-0001-000000000002",
  productA: "aaaa0000-0000-0000-0002-000000000001",
  productB: "bbbb0000-0000-0000-0002-000000000001",
  variantA_P: "aaaa0000-0000-0000-0003-000000000001",
  variantA_M: "aaaa0000-0000-0000-0003-000000000002",
  variantB_P: "bbbb0000-0000-0000-0003-000000000001",
  locationA: "aaaa0000-0000-0000-0004-000000000001",
  locationB: "bbbb0000-0000-0000-0004-000000000001",
  cashSessionA_open: "aaaa0000-0000-0000-0005-000000000001",
  cashSessionA_closed: "aaaa0000-0000-0000-0005-000000000002",
  saleA1: "aaaa0000-0000-0000-0006-000000000001",
  saleA2: "aaaa0000-0000-0000-0006-000000000002",
  saleB1: "bbbb0000-0000-0000-0006-000000000001",
} as const;

export const SANDBOX_USERS = [
  { key: "admin_a", email: "admin.a@sandbox.local", role: "Administrador", org: "A" },
  { key: "gerente_a", email: "gerente.a@sandbox.local", role: "Gerente", org: "A" },
  { key: "caixa_a", email: "caixa.a@sandbox.local", role: "Caixa", org: "A" },
  { key: "vendedor_a", email: "vendedor.a@sandbox.local", role: "Vendedor", org: "A" },
  { key: "estoquista_a", email: "estoquista.a@sandbox.local", role: "Estoquista", org: "A" },
  { key: "admin_b", email: "admin.b@sandbox.local", role: "Administrador", org: "B" },
] as const;
