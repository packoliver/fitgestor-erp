import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RowSchema = z.record(z.string(), z.any());

const ImportInput = z.object({
  kind: z.enum(["products", "clients", "suppliers", "stock"]),
  rows: z.array(RowSchema).min(1).max(20000),
  options: z.object({
    updateExisting: z.boolean().default(true),
    locationId: z.string().uuid().nullable().optional(),
  }).default({ updateExisting: true }),
});

type Ctx = { supabase: any; userId: string };

function digits(s: unknown): string {
  return String(s ?? "").replace(/\D+/g, "");
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function int(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}
function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s ? s : null;
}
function upper(v: unknown): string | null {
  const s = str(v);
  return s ? s.toUpperCase() : null;
}

async function getOrgId(ctx: Ctx): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles").select("organization_id").eq("id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.organization_id) throw new Error("Organização não encontrada.");
  return data.organization_id as string;
}

async function findOrCreateBrand(ctx: Ctx, orgId: string, name: string | null, cache: Map<string, string>): Promise<string | null> {
  if (!name) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const { data: found } = await ctx.supabase
    .from("brands").select("id").eq("organization_id", orgId).ilike("name", name).maybeSingle();
  if (found?.id) { cache.set(key, found.id); return found.id; }
  const { data: created, error } = await ctx.supabase
    .from("brands").insert({ organization_id: orgId, name, status: "ativo" }).select("id").single();
  if (error) throw new Error(`Marca "${name}": ${error.message}`);
  cache.set(key, created.id);
  return created.id;
}

async function findOrCreateCategory(ctx: Ctx, orgId: string, name: string | null, cache: Map<string, string>): Promise<string | null> {
  if (!name) return null;
  const key = name.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const { data: found } = await ctx.supabase
    .from("categories").select("id").eq("organization_id", orgId).ilike("name", name).maybeSingle();
  if (found?.id) { cache.set(key, found.id); return found.id; }
  const { data: created, error } = await ctx.supabase
    .from("categories").insert({ organization_id: orgId, name, status: "ativo" }).select("id").single();
  if (error) throw new Error(`Categoria "${name}": ${error.message}`);
  cache.set(key, created.id);
  return created.id;
}

async function importProducts(ctx: Ctx, orgId: string, rows: any[], updateExisting: boolean) {
  const errors: { row: number; message: string }[] = [];
  let inserted = 0, updated = 0;
  const brandCache = new Map<string, string>();
  const catCache = new Map<string, string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const name = str(r.name);
      if (!name) throw new Error("Nome do produto é obrigatório");
      const sku = str(r.sku);
      const barcode = str(r.barcode);
      const size = upper(r.size) ?? "ÚNICO";
      const color = str(r.color);
      const sale = num(r.sale_price);
      const cost = num(r.cost_price);
      const brandId = await findOrCreateBrand(ctx, orgId, str(r.brand), brandCache);
      const catId = await findOrCreateCategory(ctx, orgId, str(r.category), catCache);

      // Tenta localizar variante existente pelo SKU
      let variantId: string | null = null;
      let productId: string | null = null;
      if (sku) {
        const { data: v } = await ctx.supabase
          .from("product_variants").select("id, product_id")
          .eq("organization_id", orgId).eq("sku", sku).maybeSingle();
        if (v) { variantId = v.id; productId = v.product_id; }
      }
      if (!productId) {
        // Busca produto por nome+cor
        const q = ctx.supabase.from("products").select("id")
          .eq("organization_id", orgId).eq("name", name);
        if (color) q.eq("color", color); else q.is("color", null);
        const { data: p } = await q.maybeSingle();
        if (p) productId = p.id;
      }

      if (!productId) {
        const { data: created, error } = await ctx.supabase.from("products").insert({
          organization_id: orgId, name, color, brand_id: brandId, category_id: catId,
          sale_price: sale, cost_price: cost, status: "ativo",
        }).select("id").single();
        if (error) throw new Error(error.message);
        productId = created.id;
      } else if (updateExisting) {
        const patch: any = {};
        if (brandId) patch.brand_id = brandId;
        if (catId) patch.category_id = catId;
        if (sale != null) patch.sale_price = sale;
        if (cost != null) patch.cost_price = cost;
        if (Object.keys(patch).length) {
          await ctx.supabase.from("products").update(patch).eq("id", productId);
        }
      }

      if (variantId) {
        if (updateExisting) {
          const patch: any = {};
          if (sale != null) patch.sale_price = sale;
          if (cost != null) patch.cost_price = cost;
          if (barcode) patch.barcode = barcode;
          if (Object.keys(patch).length) {
            await ctx.supabase.from("product_variants").update(patch).eq("id", variantId);
          }
          updated++;
        } else {
          // nada a fazer
        }
      } else {
        const { error } = await ctx.supabase.from("product_variants").insert({
          organization_id: orgId, product_id: productId, size, sku, barcode,
          sale_price: sale, cost_price: cost, status: "ativo",
        });
        if (error) throw new Error(error.message);
        inserted++;
      }
    } catch (e: any) {
      errors.push({ row: i + 2, message: e?.message ?? String(e) });
    }
  }
  return { inserted, updated, errors };
}

async function importClients(ctx: Ctx, orgId: string, rows: any[], updateExisting: boolean) {
  const errors: { row: number; message: string }[] = [];
  let inserted = 0, updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const full_name = str(r.full_name);
      if (!full_name) throw new Error("Nome é obrigatório");
      const cpf = digits(r.cpf) || null;
      const phone = str(r.phone);
      const email = str(r.email);
      const zip = digits(r.zip_code) || null;
      const patch = {
        full_name, cpf, phone, email,
        zip_code: zip,
        address: str(r.address), address_number: str(r.address_number),
        address_complement: str(r.address_complement),
        neighborhood: str(r.neighborhood), city: str(r.city), state: upper(r.state),
        birth_date: str(r.birth_date), notes: str(r.notes),
      };
      let existingId: string | null = null;
      if (cpf) {
        const { data } = await ctx.supabase.from("clients").select("id")
          .eq("organization_id", orgId).eq("cpf", cpf).maybeSingle();
        if (data) existingId = data.id;
      }
      if (!existingId && phone) {
        const { data } = await ctx.supabase.from("clients").select("id")
          .eq("organization_id", orgId).eq("full_name", full_name).eq("phone", phone).maybeSingle();
        if (data) existingId = data.id;
      }
      if (existingId) {
        if (!updateExisting) continue;
        const clean: any = {};
        for (const [k, v] of Object.entries(patch)) if (v != null) clean[k] = v;
        const { error } = await ctx.supabase.from("clients").update(clean).eq("id", existingId);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await ctx.supabase.from("clients").insert({
          organization_id: orgId, status: "ativo", ...patch,
        });
        if (error) throw new Error(error.message);
        inserted++;
      }
    } catch (e: any) {
      errors.push({ row: i + 2, message: e?.message ?? String(e) });
    }
  }
  return { inserted, updated, errors };
}

async function importSuppliers(ctx: Ctx, orgId: string, rows: any[], updateExisting: boolean) {
  const errors: { row: number; message: string }[] = [];
  let inserted = 0, updated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const name = str(r.name);
      if (!name) throw new Error("Nome é obrigatório");
      const document = digits(r.document) || null;
      const patch = {
        name, document, phone: str(r.phone), email: str(r.email),
        city: str(r.city), state: upper(r.state), notes: str(r.notes),
      };
      let existingId: string | null = null;
      if (document) {
        const { data } = await ctx.supabase.from("suppliers").select("id")
          .eq("organization_id", orgId).eq("document", document).maybeSingle();
        if (data) existingId = data.id;
      }
      if (!existingId) {
        const { data } = await ctx.supabase.from("suppliers").select("id")
          .eq("organization_id", orgId).ilike("name", name).maybeSingle();
        if (data) existingId = data.id;
      }
      if (existingId) {
        if (!updateExisting) continue;
        const clean: any = {};
        for (const [k, v] of Object.entries(patch)) if (v != null) clean[k] = v;
        const { error } = await ctx.supabase.from("suppliers").update(clean).eq("id", existingId);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await ctx.supabase.from("suppliers").insert({
          organization_id: orgId, status: "ativo", ...patch,
        });
        if (error) throw new Error(error.message);
        inserted++;
      }
    } catch (e: any) {
      errors.push({ row: i + 2, message: e?.message ?? String(e) });
    }
  }
  return { inserted, updated, errors };
}

async function importStock(ctx: Ctx, orgId: string, rows: any[], locationId: string | null | undefined) {
  const errors: { row: number; message: string }[] = [];
  let inserted = 0, updated = 0;

  let locId = locationId ?? null;
  if (!locId) {
    const { data } = await ctx.supabase.from("stock_locations").select("id")
      .eq("organization_id", orgId).eq("status", "ativo").order("created_at").limit(1).maybeSingle();
    if (!data) throw new Error("Nenhum local de estoque ativo encontrado. Selecione um local antes de importar.");
    locId = data.id;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const sku = str(r.sku);
      const barcode = str(r.barcode);
      const qty = int(r.quantity);
      if (qty == null || qty < 0) throw new Error("Quantidade inválida");
      if (!sku && !barcode) throw new Error("Informe SKU ou código de barras");

      let vq = ctx.supabase.from("product_variants").select("id").eq("organization_id", orgId).limit(1);
      if (sku) vq = vq.eq("sku", sku); else vq = vq.eq("barcode", barcode!);
      const { data: v } = await vq.maybeSingle();
      if (!v) throw new Error(`Variante não encontrada (SKU/EAN: ${sku ?? barcode})`);

      const { data: bal } = await ctx.supabase.from("inventory_balances")
        .select("physical_quantity").eq("variant_id", v.id).eq("location_id", locId).maybeSingle();
      const current = bal?.physical_quantity ?? 0;
      const delta = qty - current;
      if (delta === 0) { updated++; continue; }

      const sign = delta > 0 ? "+" : "";
      const { error } = await ctx.supabase.rpc("apply_stock_movement", {
        _variant_id: v.id,
        _location_id: locId,
        _movement_type: "inventario",
        _quantity: delta,
        _reason: `Importação de estoque: ${current} → ${qty} (${sign}${delta})`,
        _reference_type: "inventory",
        _source: "import",
      });
      if (error) throw new Error(error.message);
      inserted++;
    } catch (e: any) {
      errors.push({ row: i + 2, message: e?.message ?? String(e) });
    }
  }
  return { inserted, updated, errors };
}

export const runImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof ImportInput>) => ImportInput.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = { supabase: context.supabase, userId: context.userId };
    const orgId = await getOrgId(ctx);
    const opt = data.options ?? { updateExisting: true };

    let result;
    if (data.kind === "products") result = await importProducts(ctx, orgId, data.rows, !!opt.updateExisting);
    else if (data.kind === "clients") result = await importClients(ctx, orgId, data.rows, !!opt.updateExisting);
    else if (data.kind === "suppliers") result = await importSuppliers(ctx, orgId, data.rows, !!opt.updateExisting);
    else result = await importStock(ctx, orgId, data.rows, opt.locationId);

    return {
      total: data.rows.length,
      inserted: result.inserted,
      updated: result.updated,
      failed: result.errors.length,
      errors: result.errors.slice(0, 500),
    };
  });

export const listStockLocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("stock_locations").select("id, name").eq("status", "ativo").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
