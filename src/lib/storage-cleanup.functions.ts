/**
 * Limpeza de blobs órfãos no bucket `product-images`.
 *
 * Órfão = arquivo que existe no Storage mas não é referenciado por nenhuma
 * linha de `product_images.storage_path`.
 *
 * Regras:
 * - Restrito a Administrador (verificado com o client do usuário, RLS ativo).
 * - Lista SOMENTE a pasta da organização do usuário (`<org_id>/...`).
 * - Remoção sempre via Storage API (`storage.remove`), nunca DELETE em
 *   `storage.objects`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "product-images";
const PAGE_SIZE = 1000;
const MAX_FILES = 20_000;
const REMOVE_BATCH = 100;

export type OrphanScanResult = {
  ok: boolean;
  error?: string;
  dry_run: boolean;
  organization_id?: string;
  storage_files: number;
  referenced_paths: number;
  orphans: number;
  removed: number;
  truncated: boolean;
  sample: string[];
};

export const cleanupProductImageOrphans = createServerFn({ method: "POST" })
  .inputValidator((data: { dryRun?: boolean } | undefined) => ({ dryRun: data?.dryRun !== false }))
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }): Promise<OrphanScanResult> => {
    const empty: OrphanScanResult = {
      ok: false,
      dry_run: data.dryRun,
      storage_files: 0,
      referenced_paths: 0,
      orphans: 0,
      removed: 0,
      truncated: false,
      sample: [],
    };

    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _role_name: "Administrador",
    } as never);
    if (roleErr) return { ...empty, error: roleErr.message };
    if (!isAdmin) return { ...empty, error: "Apenas administradores podem executar a limpeza." };

    const { data: profile, error: profErr } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profErr) return { ...empty, error: profErr.message };
    const orgId = profile?.organization_id;
    if (!orgId) return { ...empty, error: "Organização não encontrada para este usuário." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) Caminhos referenciados no banco (somente da organização)
    const referenced = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: rows, error } = await supabaseAdmin
        .from("product_images")
        .select("storage_path")
        .eq("organization_id", orgId)
        .not("storage_path", "is", null)
        .range(from, from + PAGE_SIZE - 1);
      if (error) return { ...empty, organization_id: orgId, error: error.message };
      for (const r of rows ?? []) if (r.storage_path) referenced.add(r.storage_path);
      if (!rows || rows.length < PAGE_SIZE) break;
    }

    // 2) Lista recursiva da pasta da organização
    const files: string[] = [];
    let truncated = false;
    const walk = async (prefix: string): Promise<void> => {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data: entries, error } = await supabaseAdmin.storage
          .from(BUCKET)
          .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(error.message);
        if (!entries || entries.length === 0) return;
        for (const e of entries) {
          const full = prefix ? `${prefix}/${e.name}` : e.name;
          const isFile = !!(e as any).id || !!(e as any).metadata;
          if (isFile) {
            if (files.length >= MAX_FILES) {
              truncated = true;
              continue;
            }
            files.push(full);
          } else {
            await walk(full);
          }
        }
        if (entries.length < PAGE_SIZE) return;
      }
    };

    try {
      await walk(orgId);
    } catch (e: any) {
      return { ...empty, organization_id: orgId, error: e?.message ?? String(e) };
    }

    const orphans = files.filter((f) => !referenced.has(f));

    let removed = 0;
    if (!data.dryRun && orphans.length > 0) {
      for (let i = 0; i < orphans.length; i += REMOVE_BATCH) {
        const batch = orphans.slice(i, i + REMOVE_BATCH);
        const { error } = await supabaseAdmin.storage.from(BUCKET).remove(batch);
        if (error) {
          return {
            ok: false,
            dry_run: false,
            organization_id: orgId,
            error: `Falha ao remover lote: ${error.message}`,
            storage_files: files.length,
            referenced_paths: referenced.size,
            orphans: orphans.length,
            removed,
            truncated,
            sample: orphans.slice(0, 10),
          };
        }
        removed += batch.length;
      }
    }

    return {
      ok: true,
      dry_run: data.dryRun,
      organization_id: orgId,
      storage_files: files.length,
      referenced_paths: referenced.size,
      orphans: orphans.length,
      removed,
      truncated,
      sample: orphans.slice(0, 10),
    };
  });
