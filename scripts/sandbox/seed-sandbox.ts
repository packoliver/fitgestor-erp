/**
 * Provisiona ambiente sandbox (Orgs A/B, 6 usuários, dados marcados [SANDBOX]).
 * NÃO EXECUTAR EM PRODUÇÃO. Ver scripts/sandbox/README.md.
 *
 * Uso:  APP_ENV=staging ALLOW_SANDBOX_SEED=true bun scripts/sandbox/seed-sandbox.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { assertSandboxEnv, SANDBOX_IDS, SANDBOX_USERS } from "./_guards";

const { supabaseUrl, serviceRoleKey } = assertSandboxEnv();
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function password(key: string): string {
  const envKey = `SANDBOX_PASSWORD_${key.toUpperCase()}`;
  const p = process.env[envKey];
  if (p && p.length >= 8) return p;
  const generated = "S!" + randomBytes(12).toString("base64url");
  console.log(`  ⚠ ${envKey} não definida, gerada: ${generated}`);
  return generated;
}

async function ensureAuthUser(email: string, pwd: string): Promise<string> {
  // Idempotente: se já existir, retorna o UUID atual.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    console.log(`  ↺ usuário existe: ${email} (${existing.id})`);
    return existing.id;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: pwd,
    email_confirm: true,
    user_metadata: { full_name: `[SANDBOX] ${email}`, sandbox: true },
  });
  if (error || !data.user) throw new Error(`createUser(${email}): ${error?.message}`);
  console.log(`  + criado: ${email} (${data.user.id})`);
  return data.user.id;
}

async function main() {
  console.log("\n▶ 1/4 Criando organizações e dados de negócio (seed-data.sql)");
  const seedSql = readFileSync(join(import.meta.dir, "seed-data.sql"), "utf8");
  const { error: seedErr } = await admin.rpc("exec_sql" as any, { sql: seedSql }).single();
  if (seedErr) {
    // Fallback: se não houver função exec_sql, aplicar via chamadas discretas não é viável aqui.
    console.error("  ✗ Não foi possível executar seed-data.sql via RPC.");
    console.error("    Rode manualmente:  psql \"$SANDBOX_DB_URL\" -f scripts/sandbox/seed-data.sql");
    console.error("    Depois re-execute este script (ele é idempotente).");
    process.exit(2);
  }
  console.log("  ✓ seed-data.sql aplicado");

  console.log("\n▶ 2/4 Provisionando usuários auth");
  const userIds: Record<string, string> = {};
  for (const u of SANDBOX_USERS) {
    userIds[u.key] = await ensureAuthUser(u.email, password(u.key));
  }

  console.log("\n▶ 3/4 Vinculando profiles + user_roles");
  for (const u of SANDBOX_USERS) {
    const orgId = u.org === "A" ? SANDBOX_IDS.orgA : SANDBOX_IDS.orgB;
    const uid = userIds[u.key];

    const { error: pErr } = await admin
      .from("profiles")
      .upsert(
        { id: uid, email: u.email, full_name: `[SANDBOX] ${u.key}`, organization_id: orgId, status: "ativo" },
        { onConflict: "id" }
      );
    if (pErr) throw new Error(`profiles(${u.key}): ${pErr.message}`);

    const { data: role, error: rErr } = await admin
      .from("roles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("name", u.role)
      .maybeSingle();
    if (rErr || !role) throw new Error(`role ${u.role} não achado em org ${u.org}: ${rErr?.message}`);

    const { error: urErr } = await admin
      .from("user_roles")
      .upsert(
        { organization_id: orgId, user_id: uid, role_id: role.id },
        { onConflict: "user_id,role_id" }
      );
    if (urErr) throw new Error(`user_roles(${u.key}): ${urErr.message}`);
    console.log(`  ✓ ${u.key} → org ${u.org} / ${u.role}`);
  }

  console.log("\n▶ 4/4 Verificação de isolamento (nenhum usuário em duas orgs)");
  const { data: dup } = await admin
    .from("profiles")
    .select("id,email,organization_id")
    .in("id", Object.values(userIds));
  const bad = (dup ?? []).filter((p) => {
    const expected = SANDBOX_USERS.find((u) => userIds[u.key] === p.id)!;
    const expectedOrg = expected.org === "A" ? SANDBOX_IDS.orgA : SANDBOX_IDS.orgB;
    return p.organization_id !== expectedOrg;
  });
  if (bad.length > 0) {
    console.error("  ✗ Usuários em org inesperada:", bad);
    process.exit(3);
  }
  console.log("  ✓ Isolamento por organização OK");

  console.log("\n✅ Sandbox pronto. UUIDs de usuários:");
  console.table(userIds);
}

main().catch((e) => {
  console.error("\n❌ Falha no seed:", e.message);
  process.exit(1);
});
