// Guardas de segurança compartilhadas — aborta se detectar produção.
// Uso: import { assertSandboxEnv, SANDBOX_IDS, SANDBOX_USERS } from "./_guards";

const PROD_REF = "crlgixvekzgeizckzxgg"; // Ref de produção deste projeto Lovable — SEMPRE bloqueado.
// Hostnames aceitos como "local" — comparação EXATA, nunca substring.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal", "kong"]);

export interface SandboxEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
  dbUrl: string;
  projectRef: string; // "local" para supabase local
  runId: string;
  isLocal: boolean;
}

/** Extrai hostname de uma URL http(s) ou string de conexão postgres. */
function parseHostname(input: string): string | null {
  try {
    // URL WHATWG lida com http(s):// e também postgresql:// (host fica em u.hostname).
    const u = new URL(input);
    return u.hostname ? u.hostname.toLowerCase() : null;
  } catch {
    // Fallback: "user:pass@host:port/..." ou "host:port".
    const m = input.match(/(?:^|@)([A-Za-z0-9._-]+)(?::\d+)?(?:\/|$)/);
    return m ? m[1].toLowerCase() : null;
  }
}

/** Extrai o project ref de uma URL Supabase ou string de conexão. */
function extractRef(input: string | undefined): string | null {
  if (!input) return null;
  const host = parseHostname(input);
  if (host && LOCAL_HOSTS.has(host)) return "local";
  // Supabase remoto: <ref>.supabase.co  ou  db.<ref>.supabase.co
  if (host) {
    const mHost = host.match(/^(?:db\.)?([a-z0-9]{20})\.supabase\.(co|in)$/);
    if (mHost) return mHost[1];
  }
  // Pooler: hostname genérico + ?options=project%3D<ref> na query
  const mPool = input.match(/project[=%3D]+([a-z0-9]{20})/i);
  if (mPool) return mPool[1].toLowerCase();
  // Compatibilidade com input já sem esquema — tenta regex direta apenas em <ref>.supabase.co
  const mUrl = input.match(/(?:^|[^a-z0-9])([a-z0-9]{20})\.supabase\.(co|in)(?:[^a-z0-9]|$)/i);
  if (mUrl) return mUrl[1].toLowerCase();
  return null;
}


export function assertSandboxEnv(): SandboxEnv {
  const appEnv = process.env.APP_ENV;
  const allow = process.env.ALLOW_SANDBOX_SEED;
  const expectedRef = process.env.EXPECTED_SANDBOX_PROJECT_REF;
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
  if (!expectedRef) {
    errors.push(
      `EXPECTED_SANDBOX_PROJECT_REF não definido — exija o ref exato ("local" para supabase local, ou o ref de 20 chars do projeto de staging)`
    );
  }
  if (!url) errors.push(`SANDBOX_SUPABASE_URL não definida`);
  if (!key) errors.push(`SANDBOX_SUPABASE_SERVICE_ROLE_KEY não definida`);
  if (!dbUrl) errors.push(`SANDBOX_DB_URL não definida`);

  const refFromUrl = extractRef(url);
  const refFromDb = extractRef(dbUrl);

  // Bloqueio absoluto do ref de produção — independente do allowlist.
  for (const [label, ref] of [["SANDBOX_SUPABASE_URL", refFromUrl], ["SANDBOX_DB_URL", refFromDb]] as const) {
    if (ref === PROD_REF) errors.push(`${label} aponta para produção (${PROD_REF}). ABORTAR.`);
  }
  if (url?.includes(PROD_REF) || dbUrl?.includes(PROD_REF)) {
    errors.push(`URL/DB contém o ref de produção ${PROD_REF}. ABORTAR.`);
  }

  // Allowlist como proteção PRINCIPAL: refs devem bater exatamente com o esperado.
  if (expectedRef && refFromUrl && refFromUrl !== expectedRef) {
    errors.push(
      `SANDBOX_SUPABASE_URL (ref=${refFromUrl}) não bate com EXPECTED_SANDBOX_PROJECT_REF (${expectedRef})`
    );
  }
  if (expectedRef && refFromDb && refFromDb !== expectedRef) {
    errors.push(
      `SANDBOX_DB_URL (ref=${refFromDb}) não bate com EXPECTED_SANDBOX_PROJECT_REF (${expectedRef})`
    );
  }
  if (expectedRef && (!refFromUrl || !refFromDb)) {
    errors.push(`Não foi possível extrair o project ref das variáveis SANDBOX_*.`);
  }

  if (errors.length > 0) {
    console.error("\n❌ Sandbox guards falharam:\n" + errors.map((e) => "  • " + e).join("\n"));
    process.exit(1);
  }

  const projectRef = refFromUrl!;
  const isLocal = projectRef === "local";
  const runId = process.env.SANDBOX_RUN_ID || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

  console.log(
    `✅ Sandbox guards OK — ref=${projectRef} isLocal=${isLocal} runId=${runId}\n   destino: ${url}`
  );
  return { supabaseUrl: url!, serviceRoleKey: key!, dbUrl: dbUrl!, projectRef, runId, isLocal };
}

// UUIDs fixos das entidades independentes de usuário.
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
} as const;

export const SANDBOX_MARKER = "[SANDBOX]";

export const SANDBOX_USERS = [
  { key: "admin_a", email: "admin.a@sandbox.local", role: "Administrador", org: "A" },
  { key: "gerente_a", email: "gerente.a@sandbox.local", role: "Gerente", org: "A" },
  { key: "caixa_a", email: "caixa.a@sandbox.local", role: "Caixa", org: "A" },
  { key: "vendedor_a", email: "vendedor.a@sandbox.local", role: "Vendedor", org: "A" },
  { key: "estoquista_a", email: "estoquista.a@sandbox.local", role: "Estoquista", org: "A" },
  { key: "admin_b", email: "admin.b@sandbox.local", role: "Administrador", org: "B" },
] as const;

export type SandboxUserKey = (typeof SANDBOX_USERS)[number]["key"];

// Estrutura persistida em .sandbox-manifest.json
export interface SandboxManifest {
  run_id: string;
  project_ref: string;
  created_at: string;
  organizations: string[];
  auth_users: Array<{ key: SandboxUserKey; email: string; user_id: string; org_id: string }>;
  profiles: string[];
  user_roles: Array<{ user_id: string; role_id: string; organization_id: string }>;
  clients: string[];
  products: string[];
  variants: string[];
  stock_locations: string[];
  cash_sessions: string[];
  sales: string[];
  store_credit_accounts: string[];
  exchange_vouchers: string[];
  exchanges: string[];
}
