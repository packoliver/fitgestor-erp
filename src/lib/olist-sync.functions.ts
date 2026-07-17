import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const triggerOlistSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (error) return { ok: false, error: error.message };
    if (!isAdmin) return { ok: false, error: "Apenas administradores podem sincronizar." };
    try {
      const { runOlistSync } = await import("@/lib/olist-sync.server");
      const counters = await runOlistSync();
      return { ok: true, ...counters };
    } catch (e: any) {
      const message = e?.message ?? "Falha na sincronização.";
      return { ok: false, error: message };
    }
  });

export const listOlistRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (!isAdmin) throw new Error("Apenas administradores.");
    const { data, error } = await context.supabase
      .from("integration_events")
      .select("id, status, received_at, processed_at, attempts, error_message, payload")
      .eq("source", "olist")
      .eq("event_type", "sync_run")
      .order("received_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getOlistSyncState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (!isAdmin) throw new Error("Apenas administradores.");
    const { data, error } = await context.supabase
      .from("olist_sync_state")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  });

export const cancelOlistRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (!isAdmin) return { ok: false, error: "Apenas administradores." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("integration_events")
      .update({ status: "cancelado", processed_at: new Date().toISOString() })
      .eq("id", data.id)
      .in("status", ["processando", "pendente"]);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });

export const cancelStuckOlistRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (!isAdmin) return { ok: false, error: "Apenas administradores." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Marca como cancelado tudo que está "processando" há mais de 15 min sem finalizar
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("integration_events")
      .update({ status: "cancelado", processed_at: new Date().toISOString(), error_message: "Cancelado por inatividade" })
      .eq("source", "olist")
      .eq("event_type", "sync_run")
      .eq("status", "processando")
      .lt("received_at", cutoff)
      .select("id");
    if (error) return { ok: false, error: error.message };
    return { ok: true, cancelled: data?.length ?? 0 };
  });
