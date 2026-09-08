import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InviteInput = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  full_name: z.string().min(2).max(200),
  phone: z.string().max(50).optional().nullable(),
  role_id: z.string().uuid(),
});

const EMPLOYEE_INVITE_REDIRECT_URL = "https://fitgestor-erp.vercel.app/reset-password";

async function requireActiveAdministrator(supabase: any) {
  const { data: isAdmin, error } = await supabase.rpc("has_role", {
    _role_name: "Administrador",
  });
  if (error) throw new Error(error.message);
  if (!isAdmin) throw new Error("Somente um Administrador pode gerenciar convites de funcionários.");
}

/**
 * Invite (or attach) an employee by e-mail.
 * - Verifies the current user is an active Administrator.
 * - Creates the auth user via Supabase Admin (invite by e-mail) or attaches an existing one.
 * - Calls finalize_employee_invite RPC to write profile + user_role + audit_log.
 */
export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: z.infer<typeof InviteInput>) => InviteInput.parse(data))
  .handler(async ({ data, context }) => {
    // Convites são exclusivos de uma conta ativa com o cargo Administrador.
    await requireActiveAdministrator(context.supabase);

    const { data: orgRow, error: orgErr } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    const orgId = orgRow?.organization_id;
    if (!orgId) throw new Error("Organização não encontrada.");

    const { data: role, error: roleErr } = await context.supabase
      .from("roles")
      .select("id")
      .eq("id", data.role_id)
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!role) throw new Error("Cargo inválido ou fora da sua organização.");

    // Admin operations
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Look up existing user
    let userId: string | null = null;
    {
      const { data: existing, error } = await supabaseAdmin
        .from("profiles")
        .select("id, organization_id")
        .eq("email", data.email)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (existing?.id) {
        if (existing.organization_id && existing.organization_id !== orgId) {
          throw new Error("E-mail já vinculado a outra organização.");
        }
        if (existing.organization_id === orgId) {
          throw new Error("Este e-mail já pertence a um funcionário. Use as ações da lista para alterar o acesso.");
        }
        userId = existing.id;
      }
    }

    let invited = false;
    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        data.email,
        {
          data: { full_name: data.full_name },
          redirectTo: EMPLOYEE_INVITE_REDIRECT_URL,
        },
      );
      if (error || !created?.user?.id) {
        throw new Error(error?.message || "Falha ao enviar convite.");
      }
      userId = created.user.id;
      invited = true;
    }

    const { error: rpcErr } = await context.supabase.rpc(
      "finalize_employee_invite" as any,
      {
        _user_id: userId,
        _email: data.email,
        _full_name: data.full_name,
        _phone: data.phone ?? null,
        _role_id: data.role_id,
      },
    );
    if (rpcErr) {
      // Não deixa uma conta Auth órfã caso a vinculação transacional falhe.
      if (invited && userId) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(rpcErr.message);
    }

    return { ok: true, user_id: userId, invited };
  });

/** Resend invite e-mail for an already-added employee (no local DB changes). */
export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { email: string }) => z.object({
    email: z.string().trim().email().transform((value) => value.toLowerCase()),
  }).parse(data))
  .handler(async ({ data, context }) => {
    await requireActiveAdministrator(context.supabase);

    const { data: employee, error: employeeErr } = await context.supabase
      .from("profiles")
      .select("id, status")
      .eq("email", data.email)
      .maybeSingle();
    if (employeeErr) throw new Error(employeeErr.message);
    if (!employee || !["convite_pendente", "pendente"].includes(employee.status)) {
      throw new Error("Só é possível reenviar convites pendentes da sua organização.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      redirectTo: EMPLOYEE_INVITE_REDIRECT_URL,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
