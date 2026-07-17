import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const triggerOlistSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error } = await context.supabase.rpc("has_role", { _role_name: "Administrador" });
    if (error) throw new Error(error.message);
    if (!isAdmin) throw new Error("Apenas administradores podem sincronizar.");
    const { runOlistSync } = await import("@/lib/olist-sync.server");
    const counters = await runOlistSync();
    return counters;
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
