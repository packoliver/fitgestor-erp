/**
 * Testes de idempotência e concorrência — Fatia 2.1b passo 8.
 * Abre DUAS conexões independentes (clients Supabase distintos, com sessões
 * autenticadas separadas — não é o mesmo pool) e dispara complete_exchange
 * simultaneamente. Registra timestamps de início/fim, IDs retornados,
 * contagens de movimentos, pagamentos e saldo final.
 *
 * NÃO EXECUTAR EM PRODUÇÃO.
 *
 * Requer:
 *   SANDBOX_UID_ADMIN_A  (do manifesto ou credentials)
 *   SANDBOX_PASSWORD_ADMIN_A  (ou lê de .sandbox-credentials.json)
 *   SANDBOX_SUPABASE_PUBLISHABLE_KEY (obrigatório: login real, sem service_role)
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { assertSandboxEnv, SANDBOX_IDS } from "./_guards";

const HERE = dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = join(HERE, ".sandbox-credentials.json");

const env = assertSandboxEnv();
const publishable = process.env.SANDBOX_SUPABASE_PUBLISHABLE_KEY;
if (!publishable) {
  console.error("SANDBOX_SUPABASE_PUBLISHABLE_KEY obrigatório (usar publishable/anon, nunca service_role).");
  process.exit(1);
}

// Credenciais admin_a: env vence; senão lê do .sandbox-credentials.json
let pwdAdminA = process.env.SANDBOX_PASSWORD_ADMIN_A;
if (!pwdAdminA && existsSync(CREDS_PATH)) {
  const creds = JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  if (creds.admin_a?.password && creds.admin_a.password !== "(from env)") {
    pwdAdminA = creds.admin_a.password;
  }
}
if (!pwdAdminA) {
  console.error("Defina SANDBOX_PASSWORD_ADMIN_A ou rode setup-sandbox.ts (gera .sandbox-credentials.json).");
  process.exit(1);
}

// Cada conexão tem storageKey único → sessões INDEPENDENTES, não compartilham cookie/pool.
function newClient(label: string) {
  return createClient(env.supabaseUrl, publishable!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `sbx-${label}-${randomUUID()}`,
    },
    global: { headers: { "x-sandbox-conn": label } },
  });
}

async function signIn(c: SupabaseClient, label: string) {
  const { error } = await c.auth.signInWithPassword({
    email: "admin.a@sandbox.local",
    password: pwdAdminA!,
  });
  if (error) throw new Error(`signIn(${label}): ${error.message}`);
}

async function locationA(c: SupabaseClient) {
  const { data } = await c
    .from("stock_locations").select("id")
    .eq("organization_id", SANDBOX_IDS.orgA).eq("type", "loja").limit(1).maybeSingle();
  return data!.id as string;
}

type CallLog = {
  conn: string; started_at: string; finished_at: string; ms: number;
  http_ok: boolean; error?: string; returned_id?: string; idempotent?: boolean;
};

async function timedCall(c: SupabaseClient, label: string, payload: any): Promise<CallLog> {
  const started = new Date();
  const t0 = performance.now();
  const r: any = await c.rpc("complete_exchange", { _payload: payload }).catch((e) => ({ error: e }));
  const finished = new Date();
  return {
    conn: label,
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    ms: Math.round(performance.now() - t0),
    http_ok: !r?.error,
    error: r?.error?.message ?? undefined,
    returned_id: r?.data?.exchange_id ?? r?.data?.id ?? undefined,
    idempotent: r?.data?.idempotent === true,
  };
}

const results: Array<{ scenario: string; status: string; detail: any }> = [];

// -------- Cenário 1: mesmo client_request_id, duas conexões
async function scenarioSameRequestId() {
  const c1 = newClient("c1"), c2 = newClient("c2");
  await Promise.all([signIn(c1, "c1"), signIn(c2, "c2")]);
  const loc = await locationA(c1);
  const rid = randomUUID();
  const payload = {
    location_id: loc, client_id: SANDBOX_IDS.clientA1, client_request_id: rid,
    return_items: [], new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [{ direction: "incoming", payment_method: "cash", amount: 100 }],
  };
  const [l1, l2] = await Promise.all([timedCall(c1, "c1", payload), timedCall(c2, "c2", payload)]);
  const { data: rows } = await c1.from("exchanges")
    .select("id").eq("client_request_id", rid);
  const exId = rows?.[0]?.id;
  const [pays, invs] = await Promise.all([
    exId ? c1.from("exchange_payments").select("id", { count: "exact", head: true }).eq("exchange_id", exId) : { count: 0 } as any,
    exId ? c1.from("inventory_movements").select("id", { count: "exact", head: true }).eq("reference_id", exId) : { count: 0 } as any,
  ]);
  results.push({
    scenario: "same client_request_id — 2 conexões independentes",
    status: (rows?.length === 1) ? "PASS" : "FAIL",
    detail: { calls: [l1, l2], exchanges: rows?.length, payments: pays.count, inv_moves: invs.count },
  });
}

// -------- Cenário 2: voucher race (75 disponível vs 2×60)
async function scenarioVoucherRace() {
  const c1 = newClient("v1"), c2 = newClient("v2");
  await Promise.all([signIn(c1, "v1"), signIn(c2, "v2")]);
  const loc = await locationA(c1);
  const mk = () => ({
    location_id: loc, client_id: SANDBOX_IDS.clientA1, client_request_id: randomUUID(),
    return_items: [], new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [
      { direction: "incoming", payment_method: "exchange_voucher", amount: 60, transaction_reference: "SBX-A-VOUCHER" },
      { direction: "incoming", payment_method: "cash", amount: 40 },
    ],
  });
  const [l1, l2] = await Promise.all([timedCall(c1, "v1", mk()), timedCall(c2, "v2", mk())]);
  const { data: vch } = await c1.from("exchange_vouchers")
    .select("current_balance").eq("code", "SBX-A-VOUCHER").maybeSingle();
  const ok = [l1, l2].filter((x) => x.http_ok).length;
  const failed = [l1, l2].filter((x) => !x.http_ok).length;
  results.push({
    scenario: "voucher race (saldo 75, 2×60)",
    status: ok === 1 && failed === 1 ? "PASS" : "FAIL",
    detail: { calls: [l1, l2], voucher_balance_after: vch?.current_balance },
  });
}

// -------- Cenário 3: crédito race (50 vs 2×40)
async function scenarioCreditRace() {
  const c1 = newClient("k1"), c2 = newClient("k2");
  await Promise.all([signIn(c1, "k1"), signIn(c2, "k2")]);
  const loc = await locationA(c1);
  const mk = () => ({
    location_id: loc, client_id: SANDBOX_IDS.clientA1, client_request_id: randomUUID(),
    return_items: [], new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [
      { direction: "incoming", payment_method: "store_credit", amount: 40 },
      { direction: "incoming", payment_method: "cash", amount: 60 },
    ],
  });
  const [l1, l2] = await Promise.all([timedCall(c1, "k1", mk()), timedCall(c2, "k2", mk())]);
  const { data: acc } = await c1.from("store_credit_accounts")
    .select("balance").eq("client_id", SANDBOX_IDS.clientA1)
    .eq("organization_id", SANDBOX_IDS.orgA).maybeSingle();
  const ok = [l1, l2].filter((x) => x.http_ok).length;
  const failed = [l1, l2].filter((x) => !x.http_ok).length;
  results.push({
    scenario: "store_credit race (saldo 50, 2×40)",
    status: ok === 1 && failed === 1 ? "PASS" : "FAIL",
    detail: { calls: [l1, l2], credit_balance_after: acc?.balance },
  });
}

// -------- Cenário 4: clique duplo sequencial (mesma conexão)
async function scenarioDoubleClick() {
  const c = newClient("dbl"); await signIn(c, "dbl");
  const loc = await locationA(c);
  const rid = randomUUID();
  const payload = {
    location_id: loc, client_id: SANDBOX_IDS.clientA1, client_request_id: rid,
    return_items: [], new_items: [{ variant_id: SANDBOX_IDS.variantA_M, quantity: 1 }],
    payments: [{ direction: "incoming", payment_method: "cash", amount: 100 }],
  };
  const l1 = await timedCall(c, "dbl#1", payload);
  const l2 = await timedCall(c, "dbl#2", payload);
  const { count } = await c.from("exchanges").select("*", { count: "exact", head: true })
    .eq("client_request_id", rid);
  results.push({
    scenario: "clique duplo (mesmo rid sequencial)",
    status: count === 1 && l2.idempotent ? "PASS" : "FAIL",
    detail: { calls: [l1, l2], exchanges: count },
  });
}

async function main() {
  const scenarios = [scenarioSameRequestId, scenarioVoucherRace, scenarioCreditRace, scenarioDoubleClick];
  for (const s of scenarios) {
    try { await s(); }
    catch (e: any) { results.push({ scenario: s.name, status: "ERROR", detail: e.message }); }
  }

  console.log("\n============ IDEMPOTENCY & CONCURRENCY ============");
  for (const r of results) {
    console.log(`\n▸ ${r.scenario} — ${r.status}`);
    console.log(JSON.stringify(r.detail, null, 2));
  }
  const failed = results.filter((r) => r.status !== "PASS");
  console.log(`\nRESUMO: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length > 0) process.exit(1);
}

main();
