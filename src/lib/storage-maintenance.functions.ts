import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Input = z.object({ dryRun: z.boolean().default(true) });
const BUCKET = "product-images";
const PAGE_SIZE = 1000;
const DELETE_BATCH_SIZE = 100;

async function listFilesRecursively(storage: any, root: string): Promise<string[]> {
  const files: string[] = [];
  const folders = [root];

  while (folders.length > 0) {
    const folder = folders.shift()!;
    let offset = 0;
    while (true) {
      const { data, error } = await storage.list(folder, {
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Falha ao listar ${folder}: ${error.message}`);
      const entries = data ?? [];
      for (const entry of entries) {
        const path = `${folder}/${entry.name}`;
        if (entry.id) files.push(path);
        else folders.push(path);
      }
      if (entries.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return files;
}

/**
 * Identifica e, quando solicitado, remove apenas blobs sem linha correspondente
 * em product_images. O escopo é sempre a organização do administrador logado.
 */
export const maintainProductImageStorage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: z.infer<typeof Input>) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _role_name: "Administrador",
    });
    if (roleError) throw new Error(roleError.message);
    if (!isAdmin) throw new Error("Apenas administradores podem limpar o Storage.");

    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (!profile?.organization_id) throw new Error("Organização não encontrada.");

    const orgId = profile.organization_id;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: referencedRows, error: referencesError } = await supabaseAdmin
      .from("product_images")
      .select("storage_path")
      .eq("organization_id", orgId)
      .not("storage_path", "is", null);
    if (referencesError) throw new Error(referencesError.message);

    const referenced = new Set(
      (referencedRows ?? [])
        .map((row) => row.storage_path)
        .filter((path): path is string => Boolean(path)),
    );
    const storage = supabaseAdmin.storage.from(BUCKET);
    const scannedPaths = await listFilesRecursively(storage, orgId);
    const orphanPaths = scannedPaths.filter((path) => !referenced.has(path));

    if (data.dryRun || orphanPaths.length === 0) {
      return {
        ok: true,
        dryRun: data.dryRun,
        scanned: scannedPaths.length,
        referenced: referenced.size,
        orphans: orphanPaths.length,
        deleted: 0,
      };
    }

    let deleted = 0;
    for (let index = 0; index < orphanPaths.length; index += DELETE_BATCH_SIZE) {
      const batch = orphanPaths.slice(index, index + DELETE_BATCH_SIZE);
      const { data: removed, error } = await storage.remove(batch);
      if (error) throw new Error(`Falha ao excluir arquivos órfãos: ${error.message}`);
      deleted += removed?.length ?? batch.length;
    }

    return {
      ok: true,
      dryRun: false,
      scanned: scannedPaths.length,
      referenced: referenced.size,
      orphans: orphanPaths.length,
      deleted,
    };
  });
