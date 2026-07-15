/**
 * Cleanup do sandbox. Remove SOMENTE registros presentes no manifesto E
 * que continuem carregando o marcador [SANDBOX] no banco (dupla checagem).
 * Também remove .sandbox-credentials.json.
 * NÃO EXECUTAR EM PRODUÇÃO.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { assertSandboxEnv, SANDBOX_MARKER, type SandboxManifest } from "./_guards";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, ".sandbox-manifest.json");
const CREDS_PATH = join(HERE, ".sandbox-credentials.json");

const env = assertSandboxEnv();
const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

if (!existsSync(MANIFEST_PATH)) {
  console.error("❌ Nenhum manifesto encontrado em " + MANIFEST_PATH);
  console.error("   Cleanup só age sobre IDs registrados por setup-sandbox.ts.");
  process.exit(1);
}
const manifest: SandboxManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

if (manifest.project_ref !== env.projectRef) {
  console.error(
    `❌ Manifesto pertence ao ref=${manifest.project_ref}, mas o ambiente aponta para ref=${env.projectRef}.`
  );
  process.exit(1);
}

/** Delete only rows whose id is in `ids` AND whose `markerCol` starts with [SANDBOX]. */
async function deleteMarked(table: string, ids: string[], markerCol: string | null) {
  if (ids.length === 0) return;
  const q = admin.from(table).delete({ count: "exact" }).in("id", ids);
  const { count, error } = markerCol
    ? await q.like(markerCol, `${SANDBOX_MARKER}%`)
    : await q;
  if (error) console.warn(`  ! ${table}: ${error.message}`);
  else console.log(`  - ${table}: ${count ?? 0} linhas`);
}

async function main() {
  console.log(`\n▶ Cleanup sandbox (run_id=${manifest.run_id}, ref=${manifest.project_ref})`);

  // Ordem: filhos → pais.
  // Exchanges e dependências (só as criadas por testes; sem marcador textual — validamos pelo manifesto E pelas orgs sandbox)
  for (const exId of manifest.exchanges) {
    await admin.from("exchange_payments").delete().eq("exchange_id", exId);
    await admin.from("exchange_new_items").delete().eq("exchange_id", exId);
    await admin.from("exchange_return_items").delete().eq("exchange_id", exId);
    await admin.from("exchange_receipt_items").delete().eq("exchange_id", exId);
    await admin.from("exchange_receipts").delete().eq("exchange_id", exId);
  }
  if (manifest.exchanges.length > 0) {
    const { count } = await admin
      .from("exchanges")
      .delete({ count: "exact" })
      .in("id", manifest.exchanges)
      .in("organization_id", manifest.organizations);
    console.log(`  - exchanges: ${count ?? 0}`);
  }

  // Vouchers e créditos: validação por org sandbox (a rigor os IDs do manifesto bastam,
  // mas usamos "IN orgs sandbox" como segunda barreira).
  await admin
    .from("exchange_voucher_transactions")
    .delete()
    .in("organization_id", manifest.organizations);
  await admin
    .from("exchange_vouchers")
    .delete()
    .in("organization_id", manifest.organizations)
    .like("code", "SBX-%");
  await admin
    .from("store_credit_transactions")
    .delete()
    .in("organization_id", manifest.organizations);
  await admin
    .from("store_credit_accounts")
    .delete()
    .in("organization_id", manifest.organizations);

  // Vendas geradas pelos testes: só as marcadas
  await admin.from("sale_payments").delete().in("organization_id", manifest.organizations);
  await admin.from("sale_items").delete().in("organization_id", manifest.organizations);
  await admin
    .from("sales")
    .delete()
    .in("organization_id", manifest.organizations)
    .like("notes", `%${SANDBOX_MARKER}%`);

  // Caixas do run
  for (const sid of manifest.cash_sessions) {
    await admin.from("cash_movements").delete().eq("cash_session_id", sid);
    await admin.from("cash_sessions").delete().eq("id", sid).like("notes", `%${SANDBOX_MARKER}%`);
  }

  // Movimentos e reservas
  await admin.from("inventory_movements").delete().in("organization_id", manifest.organizations);
  await admin.from("stock_reservations").delete().in("organization_id", manifest.organizations);
  await admin
    .from("inventory_balances")
    .delete()
    .in("organization_id", manifest.organizations)
    .in("variant_id", manifest.variants);

  // Produtos (com marcador)
  await deleteMarked("product_variants", manifest.variants, null);
  await deleteMarked("products", manifest.products, "name");
  await deleteMarked("clients", manifest.clients, "name");

  // user_roles + profiles
  for (const ur of manifest.user_roles) {
    await admin.from("user_roles").delete().eq("user_id", ur.user_id).eq("role_id", ur.role_id);
  }
  for (const uid of manifest.profiles) {
    await admin.from("profiles").delete().eq("id", uid).like("full_name", `${SANDBOX_MARKER}%`);
  }

  // auth.users
  for (const u of manifest.auth_users) {
    const { data } = await admin.auth.admin.getUserById(u.user_id);
    if (data?.user && (data.user.user_metadata as any)?.sandbox === true) {
      const { error } = await admin.auth.admin.deleteUser(u.user_id);
      console.log(`  - auth.users ${u.email}: ${error ? "FAIL " + error.message : "ok"}`);
    } else {
      console.log(`  - auth.users ${u.email}: SKIP (não marcado sandbox)`);
    }
  }

  // Organizações (só se ainda estiverem marcadas)
  await admin
    .from("organizations")
    .delete()
    .in("id", manifest.organizations)
    .like("name", `${SANDBOX_MARKER}%`);

  // Arquivos locais
  try { unlinkSync(CREDS_PATH); console.log(`  - removido: ${CREDS_PATH}`); } catch {}
  try { unlinkSync(MANIFEST_PATH); console.log(`  - removido: ${MANIFEST_PATH}`); } catch {}

  console.log("\n✅ Cleanup concluído.");
}

main().catch((e) => {
  console.error("\n❌ Falha no cleanup:", e.message);
  process.exit(1);
});
