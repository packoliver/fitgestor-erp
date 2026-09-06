import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const InviteInput = z.object({
  email: z.string().email(),
  full_name: z.string().min(2).max(200),
  phone: z.string().max(50).optional().nullable(),
  role_id: z.string().uuid(),
});

/**
 * Invite (or attach) an employee by e-mail.
 * - Verifies current user has user.manage permission via RLS-scoped client.
 * - Creates the auth user via Supabase Admin (invite by e-mail) or attaches an existing one.
 * - Calls finalize_employee_invite RPC to write profile + user_role + audit_log.
 */
export const inviteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: z.infer<typeof InviteInput>) => InviteInput.parse(data))
  .handler(async ({ data, context }) => {
    // Authorization guard against the caller's own client (RLS).
    const { data: canManage, error: permErr } = await context.supabase.rpc(
      "has_permission",
      { _code: "user.manage" } as any,
    );
    if (permErr) throw new Error(permErr.message);
    if (!canManage) throw new Error("Sem permissão para convidar funcionários.");

    const { data: orgRow, error: orgErr } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (orgErr) throw new Error(orgErr.message);
    const orgId = orgRow?.organization_id;
    if (!orgId) throw new Error("Organização não encontrada.");

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
        userId = existing.id;
      }
    }

    let invited = false;
    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        data.email,
        { data: { full_name: data.full_name } },
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
    if (rpcErr) throw new Error(rpcErr.message);

    return { ok: true, user_id: userId, invited };
  });

/** Resend invite e-mail for an already-added employee (no local DB changes). */
export const resendInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { email: string }) => z.object({ email: z.string().email() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: canManage } = await context.supabase.rpc("has_permission", {
      _code: "user.manage",
    } as any);
    if (!canManage) throw new Error("Sem permissão.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
