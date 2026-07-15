/**
 * Remove somente dados sandbox. Respeita ordem de FKs.
 * NÃO EXECUTAR EM PRODUÇÃO.
 */
import { createClient } from "@supabase/supabase-js";
import { assertSandboxEnv, SANDBOX_IDS, SANDBOX_USERS } from "./_guards";

const { supabaseUrl, serviceRoleKey } = assertSandboxEnv();
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ORG_IDS = [SANDBOX_IDS.orgA, SANDBOX_IDS.orgB];

// Ordem: filhos primeiro
const TABLES_IN_DELETE_ORDER = [
  "exchange_voucher_transactions",
  "exchange_vouchers",
  "store_credit_transactions",
  "store_credit_accounts",
  "exchange_payments",
  "exchange_new_items",
  "exchange_return_items",
  "exchange_receipt_items",
  "exchange_receipts",
  "exchanges",
  "exchange_counters",
  "exchange_settings",
  "sale_payments",
  "sale_items",
  "sales",
  "sale_counters",
  "cash_movements",
  "cash_sessions",
  "inventory_movements",
  "inventory_balances",
  "stock_reservations",
  "product_variants",
  "product_images",
  "products",
  "clients",
  "stock_locations",
  "user_roles",
  "role_permissions",
  "roles",
  "audit_logs",
];

async function main() {
  console.log(`\n▶ Limpando dados das orgs sandbox: ${ORG_IDS.join(", ")}`);

  for (const t of TABLES_IN_DELETE_ORDER) {
    const { error, count } = await admin
      .from(t)
      .delete({ count: "exact" })
      .in("organization_id", ORG_IDS);
    if (error) console.warn(`  ! ${t}: ${error.message}`);
    else console.log(`  - ${t}: ${count ?? 0} linhas`);
  }

  // Profiles (não têm ON DELETE CASCADE das orgs no schema atual)
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails = new Set(SANDBOX_USERS.map((u) => u.email));
  const sandboxUsers = (users?.users ?? []).filter((u) => u.email && emails.has(u.email));

  for (const u of sandboxUsers) {
    await admin.from("profiles").delete().eq("id", u.id);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    console.log(`  - auth.users ${u.email}: ${error ? "FAIL " + error.message : "ok"}`);
  }

  // Organizações
  const { error: orgErr } = await admin.from("organizations").delete().in("id", ORG_IDS);
  console.log(`  - organizations: ${orgErr ? "FAIL " + orgErr.message : "ok"}`);

  console.log("\n✅ Cleanup concluído.");
}

main().catch((e) => {
  console.error("\n❌ Falha no cleanup:", e.message);
  process.exit(1);
});
