/**
 * Testes de idempotência e concorrência — Fatia 2.1b passo 8.
 * Abre DUAS conexões independentes e dispara complete_exchange em paralelo.
 * Requer usuário Admin A já semeado (aceita o UUID via env SANDBOX_UID_ADMIN_A).
 *
 * NÃO EXECUTAR EM PRODUÇÃO.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { assertSandboxEnv, SANDBOX_IDS } from "./_guards";

const { supabaseUrl, serviceRoleKey } = assertSandboxEnv();

const uidAdminA = process.env.SANDBOX_UID_ADMIN_A;
const pwdAdminA = process.env.SANDBOX_PASSWORD_ADMIN_A;
if (!uidAdminA || !pwdAdminA) {
  console.error("Defina SANDBOX_UID_ADMIN_A e SANDBOX_PASSWORD_ADMIN_A.");
  process.exit(1);
}

// Duas conexões independentes autenticadas como admin_a
function newClient() {
  return createClient(supabaseUrl, process.env.SANDBOX_SUPABASE_PUBLISHABLE_KEY || serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signIn(c: ReturnType<typeof newClient>) {
  const { error } = await c.auth.signInWithPassword({
    email: "admin.a@sandbox.local",
    password: pwdAdminA!,
  });
  if (error) throw new Error("signIn admin_a: " + error.message);
}

const results: Array<{ scenario: string; status: string; detail: string }> = [];

async function locationA(c: ReturnType<typeof newClient>) {
  const { data } = await c
    .from("stock_locations")
    .select("id")
    .eq("organization_id", SANDBOX_IDS.orgA)
    .eq("type", "loja")
    .limit(1)
    .maybeSingle();
  return data!.id as string;
}

async function race<T>(a: Promise<T>, b: Promise<T>) {
  return Promise.allSettled([a, b]);
}

// -------- Cenário 1: mesmo client_request_id em duas conexões
async function scenarioSameRequestId() {
  const c1 = newClient(); const c2 = newClient();
  await Promise.all([signIn(c1), signIn(c2)]);
  const loc = await locationA(c1);
  const payload = {
    location_id: loc,
    client_id: SANDBOX_IDS.clientA1,
    client_request_id: randomUUID(),
    return_items: [],
    new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [{ direction: "incoming", payment_method: "cash", amount: 100 }],
  };
  const [r1, r2] = await race(
    c1.rpc("complete_exchange", { _payload: payload }),
    c2.rpc("complete_exchange", { _payload: payload })
  );
  const ok = [r1, r2].filter((x) => x.status === "fulfilled").length;
  const idem = [r1, r2].some(
    (x) => x.status === "fulfilled" && (x.value as any).data?.idempotent === true
  );

  // Contar exchanges com esse client_request_id
  const { count } = await c1
    .from("exchanges")
    .select("*", { count: "exact", head: true })
    .eq("client_request_id", payload.client_request_id);

  results.push({
    scenario: "mesmo client_request_id — 2 conexões",
    status: count === 1 ? "PASS" : "FAIL",
    detail: `exchanges criadas=${count}, respostas ok=${ok}, idempotent=${idem}`,
  });
}

// -------- Cenário 2: dois requests distintos consumindo o MESMO voucher
async function scenarioVoucherRace() {
  const c1 = newClient(); const c2 = newClient();
  await Promise.all([signIn(c1), signIn(c2)]);
  const loc = await locationA(c1);
  // Voucher SBX-A-VOUCHER = 75.00 — duas requisições de 60 cada devem falhar uma.
  const make = () => ({
    location_id: loc,
    client_id: SANDBOX_IDS.clientA1,
    client_request_id: randomUUID(),
    return_items: [],
    new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [
      { direction: "incoming", payment_method: "exchange_voucher", amount: 60, transaction_reference: "SBX-A-VOUCHER" },
      { direction: "incoming", payment_method: "cash", amount: 40 },
    ],
  });
  const [r1, r2] = await race(
    c1.rpc("complete_exchange", { _payload: make() }),
    c2.rpc("complete_exchange", { _payload: make() })
  );
  const ok = [r1, r2].filter((x) => x.status === "fulfilled" && !(x.value as any).error).length;
  const failed = [r1, r2].filter(
    (x) => x.status === "fulfilled" && (x.value as any).error
  ).length;

  results.push({
    scenario: "voucher race (75 vs 60+60)",
    status: ok === 1 && failed === 1 ? "PASS" : "FAIL",
    detail: `ok=${ok} failed=${failed}`,
  });
}

// -------- Cenário 3: dois requests distintos consumindo o MESMO crédito
async function scenarioCreditRace() {
  const c1 = newClient(); const c2 = newClient();
  await Promise.all([signIn(c1), signIn(c2)]);
  const loc = await locationA(c1);
  // Crédito A1 = 50 — duas vendas de 40 cada devem falhar uma.
  const make = () => ({
    location_id: loc,
    client_id: SANDBOX_IDS.clientA1,
    client_request_id: randomUUID(),
    return_items: [],
    new_items: [{ variant_id: SANDBOX_IDS.variantA_P, quantity: 1 }],
    payments: [
      { direction: "incoming", payment_method: "store_credit", amount: 40 },
      { direction: "incoming", payment_method: "cash", amount: 60 },
    ],
  });
  const [r1, r2] = await race(
    c1.rpc("complete_exchange", { _payload: make() }),
    c2.rpc("complete_exchange", { _payload: make() })
  );
  const ok = [r1, r2].filter((x) => x.status === "fulfilled" && !(x.value as any).error).length;
  const failed = [r1, r2].filter(
    (x) => x.status === "fulfilled" && (x.value as any).error
  ).length;

  results.push({
    scenario: "store_credit race (50 vs 40+40)",
    status: ok === 1 && failed === 1 ? "PASS" : "FAIL",
    detail: `ok=${ok} failed=${failed}`,
  });
}

// -------- Cenário 4: clique duplo (mesma conexão, request repetido)
async function scenarioDoubleClick() {
  const c = newClient(); await signIn(c);
  const loc = await locationA(c);
  const rid = randomUUID();
  const payload = {
    location_id: loc,
    client_id: SANDBOX_IDS.clientA1,
    client_request_id: rid,
    return_items: [],
    new_items: [{ variant_id: SANDBOX_IDS.variantA_M, quantity: 1 }],
    payments: [{ direction: "incoming", payment_method: "cash", amount: 100 }],
  };
  await c.rpc("complete_exchange", { _payload: payload });
  const r2 = await c.rpc("complete_exchange", { _payload: payload });
  const idempotent = (r2.data as any)?.idempotent === true;
  const { count } = await c
    .from("exchanges")
    .select("*", { count: "exact", head: true })
    .eq("client_request_id", rid);
  results.push({
    scenario: "clique duplo (mesmo client_request_id sequencial)",
    status: count === 1 && idempotent ? "PASS" : "FAIL",
    detail: `exchanges=${count} idempotent=${idempotent}`,
  });
}

async function main() {
  try { await scenarioSameRequestId(); } catch (e: any) { results.push({ scenario: "sameRequestId", status: "ERROR", detail: e.message }); }
  try { await scenarioVoucherRace(); }   catch (e: any) { results.push({ scenario: "voucherRace",   status: "ERROR", detail: e.message }); }
  try { await scenarioCreditRace(); }    catch (e: any) { results.push({ scenario: "creditRace",    status: "ERROR", detail: e.message }); }
  try { await scenarioDoubleClick(); }   catch (e: any) { results.push({ scenario: "doubleClick",   status: "ERROR", detail: e.message }); }

  console.log("\n============ IDEMPOTENCY & CONCURRENCY ============");
  console.table(results);
  const failed = results.filter((r) => r.status !== "PASS");
  if (failed.length > 0) process.exit(1);
}

main();
