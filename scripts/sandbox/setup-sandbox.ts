/**
 * Orquestrador de setup do sandbox — Fatia 2.1b.
 *
 * Executa TODAS as fases na ordem correta e idempotente:
 *  1. Guardas (APP_ENV, ALLOW, EXPECTED_SANDBOX_PROJECT_REF, ref match, bloqueio prod)
 *  2. Aplica seed-data.sql (dados independentes)
 *  3. Cria usuários auth (idempotente)
 *  4. Vincula profiles + user_roles
 *  5. Cria caixa aberta + venda de referência (dependem de user_id)
 *  6. Persiste .sandbox-manifest.json e .sandbox-credentials.json (permissões 0600)
 *
 * Em qualquer falha faz cleanup seguro (rollback do que este run criou),
 * usando o manifesto parcial e o marcador [SANDBOX] como dupla checagem.
 *
 * NÃO EXECUTAR EM PRODUÇÃO. Ver scripts/sandbox/README.md.
 *
 * Uso:
 *   APP_ENV=staging ALLOW_SANDBOX_SEED=true \
 *   EXPECTED_SANDBOX_PROJECT_REF=<ref|local> \
 *   SANDBOX_SUPABASE_URL=... SANDBOX_SUPABASE_SERVICE_ROLE_KEY=... SANDBOX_DB_URL=... \
 *   bun scripts/sandbox/setup-sandbox.ts
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { execSync } from "child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  assertSandboxEnv,
  SANDBOX_IDS,
  SANDBOX_MARKER,
  SANDBOX_USERS,
  type SandboxManifest,
  type SandboxUserKey,
} from "./_guards";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, ".sandbox-manifest.json");
const CREDS_PATH = join(HERE, ".sandbox-credentials.json");

const env = assertSandboxEnv();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// -------- helpers --------
function log(step: string, msg: string) {
  console.log(`  [${step}] ${msg}`);
}
function loadManifest(): SandboxManifest {
  if (existsSync(MANIFEST_PATH)) {
    try {
      return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
    } catch {}
  }
  return {
    run_id: env.runId,
    project_ref: env.projectRef,
    created_at: new Date().toISOString(),
    organizations: [],
    auth_users: [],
    profiles: [],
    user_roles: [],
    clients: [],
    products: [],
    variants: [],
    stock_locations: [],
    cash_sessions: [],
    sales: [],
    store_credit_accounts: [],
    exchange_vouchers: [],
    exchanges: [],
  };
}
function saveManifest(m: SandboxManifest) {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
  try { chmodSync(MANIFEST_PATH, 0o600); } catch {}
}
function saveCredentials(creds: Record<string, { email: string; password: string; user_id: string }>) {
  const existing: Record<string, unknown> = existsSync(CREDS_PATH)
    ? JSON.parse(readFileSync(CREDS_PATH, "utf8"))
    : {};
  writeFileSync(CREDS_PATH, JSON.stringify({ ...existing, ...creds }, null, 2));
  try { chmodSync(CREDS_PATH, 0o600); } catch {}
}
function passwordFor(key: string): { pwd: string; fromEnv: boolean } {
  const envKey = `SANDBOX_PASSWORD_${key.toUpperCase()}`;
  const p = process.env[envKey];
  if (p && p.length >= 8) return { pwd: p, fromEnv: true };
  return { pwd: "S!" + randomBytes(12).toString("base64url"), fromEnv: false };
}

const manifest = loadManifest();

// -------- fases --------
async function phase1_seedData() {
  log("1/5", "aplicando seed-data.sql via psql");
  const sqlPath = join(HERE, "seed-data.sql");
  try {
    execSync(`psql "${env.dbUrl}" -v ON_ERROR_STOP=1 -f "${sqlPath}"`, {
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "" },
    });
  } catch (e) {
    throw new Error(
      "psql falhou. Verifique SANDBOX_DB_URL e que o psql cliente está instalado."
    );
  }
  manifest.organizations = [SANDBOX_IDS.orgA, SANDBOX_IDS.orgB];
  manifest.clients = [SANDBOX_IDS.clientA1, SANDBOX_IDS.clientA2, SANDBOX_IDS.clientB1, SANDBOX_IDS.clientB2];
  manifest.products = [SANDBOX_IDS.productA, SANDBOX_IDS.productB];
  manifest.variants = [SANDBOX_IDS.variantA_P, SANDBOX_IDS.variantA_M, SANDBOX_IDS.variantB_P];
  saveManifest(manifest);
}

async function phase2_authUsers() {
  log("2/5", "provisionando usuários auth (idempotente)");
  const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw new Error("listUsers: " + error.message);
  const byEmail = new Map((list?.users ?? []).map((u) => [u.email, u]));
  const credsBatch: Record<string, { email: string; password: string; user_id: string }> = {};

  for (const u of SANDBOX_USERS) {
    const { pwd, fromEnv } = passwordFor(u.key);
    const existing = byEmail.get(u.email);
    let uid: string;
    if (existing) {
      uid = existing.id;
      log("2/5", `↺ existe: ${u.email}`);
    } else {
      const { data, error: err } = await admin.auth.admin.createUser({
        email: u.email,
        password: pwd,
        email_confirm: true,
        user_metadata: { full_name: `${SANDBOX_MARKER} ${u.key}`, sandbox: true, sandbox_run_id: env.runId },
      });
      if (err || !data.user) throw new Error(`createUser(${u.email}): ${err?.message}`);
      uid = data.user.id;
      log("2/5", `+ criado: ${u.email}`);
      // Só persiste credencial quando ESTE run criou o usuário e senha veio gerada.
      if (!fromEnv) {
        credsBatch[u.key] = { email: u.email, password: pwd, user_id: uid };
      } else {
        credsBatch[u.key] = { email: u.email, password: "(from env)", user_id: uid };
      }
    }
    const orgId = u.org === "A" ? SANDBOX_IDS.orgA : SANDBOX_IDS.orgB;
    if (!manifest.auth_users.find((x) => x.user_id === uid)) {
      manifest.auth_users.push({ key: u.key as SandboxUserKey, email: u.email, user_id: uid, org_id: orgId });
    }
  }
  if (Object.keys(credsBatch).length > 0) saveCredentials(credsBatch);
  saveManifest(manifest);
}

async function phase3_profilesRoles() {
  log("3/5", "vinculando profiles + user_roles");
  for (const u of manifest.auth_users) {
    const spec = SANDBOX_USERS.find((s) => s.key === u.key)!;
    const { error: pErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: u.user_id,
          email: u.email,
          full_name: `${SANDBOX_MARKER} ${u.key}`,
          organization_id: u.org_id,
          status: "ativo",
        },
        { onConflict: "id" }
      );
    if (pErr) throw new Error(`profiles(${u.key}): ${pErr.message}`);
    if (!manifest.profiles.includes(u.user_id)) manifest.profiles.push(u.user_id);

    const { data: role, error: rErr } = await admin
      .from("roles")
      .select("id")
      .eq("organization_id", u.org_id)
      .eq("name", spec.role)
      .maybeSingle();
    if (rErr || !role) throw new Error(`role ${spec.role} em org ${u.org_id}: ${rErr?.message ?? "não achado"}`);

    const { error: urErr } = await admin
      .from("user_roles")
      .upsert(
        { organization_id: u.org_id, user_id: u.user_id, role_id: role.id },
        { onConflict: "user_id,role_id" }
      );
    if (urErr) throw new Error(`user_roles(${u.key}): ${urErr.message}`);

    if (!manifest.user_roles.find((x) => x.user_id === u.user_id && x.role_id === role.id)) {
      manifest.user_roles.push({ user_id: u.user_id, role_id: role.id, organization_id: u.org_id });
    }
  }
  saveManifest(manifest);
}

async function phase4_userDependentData() {
  log("4/5", "criando caixa aberta (depende de caixa_a)");
  const caixa = manifest.auth_users.find((u) => u.key === "caixa_a");
  if (!caixa) throw new Error("phase4: caixa_a ausente do manifesto");

  // Localiza a loja principal da Org A
  const { data: loc } = await admin
    .from("stock_locations")
    .select("id")
    .eq("organization_id", SANDBOX_IDS.orgA)
    .eq("type", "loja")
    .limit(1)
    .maybeSingle();
  if (!loc) throw new Error("phase4: stock_location não encontrado");
  if (!manifest.stock_locations.includes(loc.id)) manifest.stock_locations.push(loc.id);

  // Já existe caixa aberta para esse operador?
  const { data: openSession } = await admin
    .from("cash_sessions")
    .select("id")
    .eq("organization_id", SANDBOX_IDS.orgA)
    .eq("opened_by", caixa.user_id)
    .eq("status", "open")
    .maybeSingle();

  let sessionId: string;
  if (openSession) {
    sessionId = openSession.id;
    log("4/5", `↺ caixa aberto reaproveitado: ${sessionId}`);
  } else {
    const { data: newS, error: sErr } = await admin
      .from("cash_sessions")
      .insert({
        organization_id: SANDBOX_IDS.orgA,
        location_id: loc.id,
        opened_by: caixa.user_id,
        opening_amount: 0,
        status: "open",
        notes: `${SANDBOX_MARKER} run=${env.runId}`,
      })
      .select("id")
      .single();
    if (sErr || !newS) throw new Error(`cash_sessions insert: ${sErr?.message}`);
    sessionId = newS.id;
    log("4/5", `+ caixa aberto: ${sessionId}`);
  }
  if (!manifest.cash_sessions.includes(sessionId)) manifest.cash_sessions.push(sessionId);

  saveManifest(manifest);

  // Observação: vendas de referência são criadas pelos próprios testes (permission-tests, idempotency),
  // pois dependem de RPCs autenticadas como cada papel. Este orquestrador para aqui.
}

async function phase5_verify() {
  log("5/5", "verificando isolamento por organização");
  const { data: dup } = await admin
    .from("profiles")
    .select("id,email,organization_id")
    .in("id", manifest.auth_users.map((u) => u.user_id));
  const bad = (dup ?? []).filter((p) => {
    const exp = manifest.auth_users.find((u) => u.user_id === p.id)!;
    return p.organization_id !== exp.org_id;
  });
  if (bad.length > 0) throw new Error("phase5: usuários em org inesperada: " + JSON.stringify(bad));
  log("5/5", "✓ isolamento OK");
}

async function safeCleanupOnFailure(reason: string) {
  console.error(`\n⚠ cleanup parcial após falha: ${reason}`);
  // Nunca deletamos organizações/produtos/clientes aqui (podem estar em uso por runs anteriores).
  // Removemos apenas artefatos deste run:
  for (const sid of manifest.cash_sessions) {
    const { error } = await admin
      .from("cash_sessions")
      .delete()
      .eq("id", sid)
      .like("notes", `%run=${env.runId}%`);
    if (error) console.error("  cleanup cash_sessions:", error.message);
  }
  saveManifest(manifest);
  console.error("Manifesto salvo em", MANIFEST_PATH);
}

async function main() {
  try {
    await phase1_seedData();
    await phase2_authUsers();
    await phase3_profilesRoles();
    await phase4_userDependentData();
    await phase5_verify();
  } catch (e: any) {
    await safeCleanupOnFailure(e.message);
    console.error("\n❌ setup abortado:", e.message);
    process.exit(1);
  }

  console.log("\n✅ Sandbox pronto.");
  console.log("   Manifesto:   ", MANIFEST_PATH);
  console.log("   Credenciais: ", CREDS_PATH, "(chmod 0600, .gitignore)");
  console.log("   run_id:      ", env.runId);
}

main();
