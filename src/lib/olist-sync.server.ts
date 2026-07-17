/**
 * Servidor: sincroniza produtos, variações, fotos e estoque da Olist/Tiny (API v2).
 * Chamado tanto pelo cron (rota /api/public/hooks/olist-sync) quanto pelo botão manual.
 *
 * Somente leitura na Olist: consulta produtos.pesquisa, produto.obter e
 * lista.atualizacoes.estoque, grava no banco local via supabaseAdmin.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const OLIST_BASE = "https://api.tiny.com.br/api2";
const SLEEP_MS = 2100; // Tiny/Olist: ~30 req/min → ~2s entre chamadas
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Counters = {
  products_created: number;
  products_updated: number;
  variants_created: number;
  variants_updated: number;
  photos_synced: number;
  stock_adjusted: number;
  errors: Array<{ scope: string; id?: string; message: string }>;
};

function fmtDate(d: Date | null): string | null {
  if (!d) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function olistCall(endpoint: string, params: Record<string, string>, attempt = 0): Promise<any> {
  const token = process.env.OLIST_API_TOKEN;
  if (!token) throw new Error("OLIST_API_TOKEN não configurado");
  const body = new URLSearchParams({ token, formato: "JSON", ...params });
  const res = await fetch(`${OLIST_BASE}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Olist HTTP ${res.status}`);
  const json = await res.json();
  const status = json?.retorno?.status;
  if (status === "Erro") {
    const codes = json?.retorno?.codigo_erro;
    if (codes === 20 || codes === "20") {
      return { empty: true, raw: json };
    }
    const msg = String(json?.retorno?.erros?.[0]?.erro || `Olist erro ${codes ?? ""}`);
    // Rate-limit: aguarda e tenta novamente (até 3x)
    if (/API Bloqueada|Excedido o número de acessos/i.test(msg) && attempt < 3) {
      await sleep(30_000 + attempt * 15_000);
      return olistCall(endpoint, params, attempt + 1);
    }
    throw new Error(msg);
  }
  return json?.retorno ?? {};
}

async function firstOrgId(): Promise<string> {
  const explicit = process.env.OLIST_ORGANIZATION_ID;
  if (explicit) return explicit;
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Nenhuma organização encontrada");
  return data.id;
}

async function defaultLocationId(orgId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("stock_locations")
    .select("id, is_default")
    .eq("organization_id", orgId)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) throw new Error("Nenhum local de estoque configurado");
  return data.id;
}

async function upsertVariantMapping(
  orgId: string,
  externalId: string,
  variantId: string,
  metadata: Record<string, any>,
) {
  await supabaseAdmin.from("integration_mappings").upsert(
    {
      organization_id: orgId,
      source: "olist",
      entity_type: "variant",
      external_id: externalId,
      internal_id: variantId,
      metadata,
    },
    { onConflict: "organization_id,source,entity_type,external_id" },
  );
}

async function findLocalProductByExternal(orgId: string, externalId: string) {
  const { data } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("entity_type", "product")
    .eq("external_id", externalId)
    .maybeSingle();
  if (data?.internal_id) return data.internal_id as string;
  // Fallback: procura direto na tabela products pelo olist_product_id
  // (caso o mapping tenha falhado em sync anterior). Evita duplicar.
  const { data: prod } = await supabaseAdmin
    .from("products")
    .select("id")
    .eq("organization_id", orgId)
    .eq("olist_product_id", externalId)
    .maybeSingle();
  if (prod?.id) {
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "product",
        external_id: externalId,
        internal_id: prod.id,
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
    return prod.id as string;
  }
  return undefined;
}

async function findLocalVariantByExternal(orgId: string, externalId: string) {
  const { data } = await supabaseAdmin
    .from("integration_mappings")
    .select("internal_id")
    .eq("organization_id", orgId)
    .eq("source", "olist")
    .eq("entity_type", "variant")
    .eq("external_id", externalId)
    .maybeSingle();
  if (data?.internal_id) return data.internal_id as string;
  const { data: v } = await supabaseAdmin
    .from("product_variants")
    .select("id")
    .eq("organization_id", orgId)
    .eq("olist_variant_id", externalId)
    .maybeSingle();
  if (v?.id) {
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "variant",
        external_id: externalId,
        internal_id: v.id,
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
    return v.id as string;
  }
  return undefined;
}

async function downloadPhoto(url: string): Promise<{ bytes: ArrayBuffer; contentType: string; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Foto HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return { bytes: await res.arrayBuffer(), contentType, ext };
}

async function syncPhotos(
  orgId: string,
  productId: string,
  externalId: string,
  anexos: any[],
  counters: Counters,
) {
  if (!anexos || anexos.length === 0) return;
  const { data: existing } = await supabaseAdmin
    .from("product_images")
    .select("id, storage_path")
    .eq("product_id", productId);
  const existingCount = existing?.length ?? 0;
  // Se já existem fotos, não substituímos (evita loop de upload). Só sincroniza na 1ª vez.
  if (existingCount > 0) return;

  let position = 0;
  for (const a of anexos) {
    const url: string | undefined =
      typeof a === "string" ? a : a?.anexo || a?.url || a?.link;
    if (!url) continue;
    try {
      const { bytes, contentType, ext } = await downloadPhoto(url);
      const path = `${orgId}/olist/${externalId}/${position}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("product-images")
        .upload(path, bytes, { contentType, upsert: false });
      if (upErr) throw upErr;
      const { data: signed } = await supabaseAdmin.storage
        .from("product-images")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      await supabaseAdmin.from("product_images").insert({
        organization_id: orgId,
        product_id: productId,
        image_url: signed?.signedUrl ?? "",
        storage_path: path,
        position,
        is_primary: position === 0,
      });
      counters.photos_synced++;
      position++;
      await sleep(100);
    } catch (e: any) {
      counters.errors.push({ scope: "photo", id: externalId, message: e?.message ?? String(e) });
    }
  }
}

async function syncOneProduct(
  orgId: string,
  externalId: string,
  counters: Counters,
) {
  const retorno = await olistCall("produto.obter.php", { id: externalId });
  const p = retorno?.produto;
  if (!p) return;

  const name: string = p.nome ?? "Produto Olist";
  const cost = Number(p.preco_custo ?? p.preco_custo_medio ?? 0) || 0;
  const price = Number(p.preco ?? 0) || 0;
  const promo = Number(p.preco_promocional ?? 0) || null;
  const status = (p.situacao === "I" ? "inativo" : "ativo") as "ativo" | "inativo";
  const color: string | null = p.marca ? null : null; // marca é separado; cor não é campo padrão v2

  // Produto
  let productId = await findLocalProductByExternal(orgId, externalId);
  if (!productId) {
    const { data: created, error } = await supabaseAdmin
      .from("products")
      .insert({
        organization_id: orgId,
        name,
        cost_price: cost,
        sale_price: price,
        promotional_price: promo,
        status,
        olist_product_id: externalId,
        color,
      })
      .select("id")
      .single();
    if (error) throw error;
    productId = created.id;
    counters.products_created++;
    await supabaseAdmin.from("integration_mappings").upsert(
      {
        organization_id: orgId,
        source: "olist",
        entity_type: "product",
        external_id: externalId,
        internal_id: productId,
        metadata: { codigo: p.codigo, nome: name },
      },
      { onConflict: "organization_id,source,entity_type,external_id" },
    );
  } else {
    await supabaseAdmin
      .from("products")
      .update({
        name,
        cost_price: cost,
        sale_price: price,
        promotional_price: promo,
        status,
      })
      .eq("id", productId);
    counters.products_updated++;
  }

  // Fotos (só na primeira vez)
  const anexos = p.anexos ?? [];
  await syncPhotos(orgId, productId, externalId, Array.isArray(anexos) ? anexos.map((x: any) => x.anexo ?? x) : [], counters);

  // Variações
  const locationId = await defaultLocationId(orgId);
  const variacoes: any[] = Array.isArray(p.variacoes) ? p.variacoes.map((v: any) => v.variacao ?? v) : [];
  if (variacoes.length === 0) {
    // Sem grade — cria variação ÚNICA
    const externalVariantId = `${externalId}:unico`;
    let variantId = await findLocalVariantByExternal(orgId, externalVariantId);
    if (!variantId) {
      const { data: v, error } = await supabaseAdmin
        .from("product_variants")
        .insert({
          organization_id: orgId,
          product_id: productId,
          size: "ÚNICO",
          sku: p.codigo ?? null,
          barcode: p.gtin ?? null,
          cost_price: cost,
          sale_price: price,
          status,
          olist_variant_id: externalId,
        })
        .select("id")
        .single();
      if (error) throw error;
      variantId = v.id;
      counters.variants_created++;
      await upsertVariantMapping(orgId, externalVariantId, variantId, { codigo: p.codigo, tipo: "unico" });
    }
    const saldo = Number(p.estoque_atual ?? p.saldo ?? 0) || 0;
    await adjustStockForVariant(orgId, variantId, locationId, saldo, counters);
  } else {
    for (const v of variacoes) {
      const varExternalId: string = String(v.id ?? `${externalId}:${v.codigo ?? v.grade?.[0]?.valor ?? Math.random()}`);
      const size: string = v.grade?.[0]?.valor ?? v.descricao ?? v.codigo ?? "ÚNICO";
      let variantId = await findLocalVariantByExternal(orgId, varExternalId);
      if (!variantId) {
        const { data: vr, error } = await supabaseAdmin
          .from("product_variants")
          .insert({
            organization_id: orgId,
            product_id: productId,
            size,
            sku: v.codigo ?? null,
            barcode: v.gtin ?? null,
            cost_price: Number(v.preco_custo ?? cost) || cost,
            sale_price: Number(v.preco ?? price) || price,
            status,
            olist_variant_id: varExternalId,
          })
          .select("id")
          .single();
        if (error) throw error;
        variantId = vr.id;
        counters.variants_created++;
        await upsertVariantMapping(orgId, varExternalId, variantId, { codigo: v.codigo });
      } else {
        await supabaseAdmin
          .from("product_variants")
          .update({
            size,
            sku: v.codigo ?? null,
            barcode: v.gtin ?? null,
            sale_price: Number(v.preco ?? price) || price,
          })
          .eq("id", variantId);
        counters.variants_updated++;
      }
      const saldoV = Number(v.estoque_atual ?? v.saldo ?? v.estoque ?? 0) || 0;
      await adjustStockForVariant(orgId, variantId, locationId, saldoV, counters);
    }
  }
}

async function adjustStockForVariant(
  orgId: string,
  variantId: string,
  locationId: string,
  saldo: number,
  counters: Counters,
) {
  try {
    const { data: bal } = await supabaseAdmin
      .from("inventory_balances")
      .select("physical_quantity")
      .eq("variant_id", variantId)
      .eq("location_id", locationId)
      .maybeSingle();
    const current = Number(bal?.physical_quantity ?? 0);
    const delta = saldo - current;
    if (delta === 0) return;
    await supabaseAdmin.rpc("apply_stock_movement_system", {
      _organization_id: orgId,
      _variant_id: variantId,
      _location_id: locationId,
      _movement_type: "inventario",
      _quantity: delta,
      _reason: "Sincronização Olist",
      _notes: `Ajuste automático (delta ${delta > 0 ? "+" : ""}${delta})`,
      _reference_type: "olist_sync",
      _reference_id: undefined,
      _source: "olist_sync",
      _user_id: undefined,
    });
    counters.stock_adjusted++;
  } catch (e: any) {
    counters.errors.push({ scope: "stock.inline", id: variantId, message: e?.message ?? String(e) });
  }
}

async function syncStock(orgId: string, since: Date | null, counters: Counters) {
  const params: Record<string, string> = {};
  const d = fmtDate(since);
  if (d) params.dataAlteracao = d;
  const retorno = await olistCall("lista.atualizacoes.estoque.php", params);
  if (retorno.empty) return;

  const produtos: any[] = Array.isArray(retorno?.produtos) ? retorno.produtos.map((x: any) => x.produto ?? x) : [];
  const locationId = await defaultLocationId(orgId);

  for (const item of produtos) {
    try {
      const externalId: string | undefined = item?.id ? String(item.id) : undefined;
      if (!externalId) continue;
      // Tenta como variação primeiro; se não achar, tenta produto único
      let variantId = await findLocalVariantByExternal(orgId, externalId);
      if (!variantId) {
        variantId = await findLocalVariantByExternal(orgId, `${externalId}:unico`);
      }
      if (!variantId) continue;
      const saldo = Number(item?.saldo ?? 0) || 0;
      const { data: bal } = await supabaseAdmin
        .from("inventory_balances")
        .select("physical_quantity")
        .eq("variant_id", variantId)
        .eq("location_id", locationId)
        .maybeSingle();
      const current = Number(bal?.physical_quantity ?? 0);
      const delta = saldo - current;
      if (delta === 0) continue;
      await supabaseAdmin.rpc("apply_stock_movement_system", {
        _organization_id: orgId,
        _variant_id: variantId,
        _location_id: locationId,
        _movement_type: "inventario",
        _quantity: delta,
        _reason: "Sincronização Olist",
        _notes: `Ajuste automático (delta ${delta > 0 ? "+" : ""}${delta})`,
        _reference_type: "olist_sync",
        _reference_id: undefined,
        _source: "olist_sync",
        _user_id: undefined,
      });
      counters.stock_adjusted++;
      await sleep(50);
    } catch (e: any) {
      counters.errors.push({ scope: "stock", id: item?.id ? String(item.id) : undefined, message: e?.message ?? String(e) });
    }
  }
}

export async function runOlistSync(opts: { organizationId?: string } = {}): Promise<Counters> {
  const orgId = opts.organizationId ?? (await firstOrgId());
  const counters: Counters = {
    products_created: 0,
    products_updated: 0,
    variants_created: 0,
    variants_updated: 0,
    photos_synced: 0,
    stock_adjusted: 0,
    errors: [],
  };

  const startedAt = new Date();
  const { data: eventRow } = await supabaseAdmin
    .from("integration_events")
    .insert({
      organization_id: orgId,
      source: "olist",
      event_type: "sync_run",
      status: "processando",
      payload: { started_at: startedAt.toISOString() },
    })
    .select("id")
    .single();
  const eventId = eventRow?.id as string | undefined;

  const { data: state } = await supabaseAdmin
    .from("olist_sync_state")
    .select("*")
    .eq("organization_id", orgId)
    .maybeSingle();

  const sinceProdutos = state?.last_updated_produtos_at ? new Date(state.last_updated_produtos_at) : null;
  const sinceEstoque = state?.last_updated_estoque_at ? new Date(state.last_updated_estoque_at) : null;

  await supabaseAdmin
    .from("olist_sync_state")
    .upsert({ organization_id: orgId, last_run_started_at: startedAt.toISOString() });

  let productsTotal = 0;
  let productsProcessed = 0;
  let currentProduct: { id?: string; name?: string } | null = null;
  const persistProgress = async (extra: Record<string, any> = {}) => {
    if (!eventId) return;
    await supabaseAdmin
      .from("integration_events")
      .update({
        payload: {
          ...counters,
          started_at: startedAt.toISOString(),
          products_total: productsTotal,
          products_processed: productsProcessed,
          current_product: currentProduct,
          ...extra,
        },
      })
      .eq("id", eventId);
  };

  const isCancelled = async (): Promise<boolean> => {
    if (!eventId) return false;
    const { data } = await supabaseAdmin
      .from("integration_events")
      .select("status")
      .eq("id", eventId)
      .maybeSingle();
    return data?.status === "cancelado";
  };

  try {
    // 1) Produtos
    const params: Record<string, string> = { pagina: "1" };
    const d = fmtDate(sinceProdutos);
    if (d) params.dataAlteracao = d;

    let pagina = 1;
    let totalPages = 1;
    let consecutiveFailures = 0;
    let cancelled = false;
    while (true) {
      if (await isCancelled()) { cancelled = true; break; }
      params.pagina = String(pagina);
      let retorno: any;
      try {
        retorno = await olistCall("produtos.pesquisa.php", params);
        consecutiveFailures = 0;
      } catch (e: any) {
        counters.errors.push({ scope: "produtos.pesquisa", id: `pag ${pagina}`, message: e?.message ?? String(e) });
        consecutiveFailures++;
        if (consecutiveFailures >= 3) break;
        pagina++;
        await sleep(SLEEP_MS);
        continue;
      }
      if (!retorno?.empty) {
        const produtos: any[] = Array.isArray(retorno?.produtos) ? retorno.produtos.map((x: any) => x.produto ?? x) : [];
        totalPages = Number(retorno?.numero_paginas ?? totalPages);
        const registros = Number(retorno?.numero_registros ?? produtos.length) || produtos.length;
        if (productsTotal === 0) {
          productsTotal = registros * totalPages;
          await persistProgress();
        }
        for (const p of produtos) {
          if (await isCancelled()) { cancelled = true; break; }
          const externalId = p?.id ? String(p.id) : undefined;
          if (!externalId) continue;
          currentProduct = { id: externalId, name: p?.nome ?? p?.descricao ?? undefined };
          await persistProgress();
          try {
            await syncOneProduct(orgId, externalId, counters);
          } catch (e: any) {
            counters.errors.push({ scope: "produto", id: externalId, message: e?.message ?? String(e) });
          }
          productsProcessed++;
          if (productsProcessed % 3 === 0) await persistProgress();
          await sleep(SLEEP_MS);
        }
        if (cancelled) break;
      }
      if (pagina >= totalPages) break;
      pagina++;
      await sleep(SLEEP_MS);
    }

    if (cancelled) {
      if (eventId) {
        await supabaseAdmin
          .from("integration_events")
          .update({
            status: "cancelado",
            processed_at: new Date().toISOString(),
            payload: {
              ...counters,
              started_at: startedAt.toISOString(),
              finished_at: new Date().toISOString(),
              products_total: productsTotal || productsProcessed,
              products_processed: productsProcessed,
              current_product: currentProduct,
              cancelled: true,
            },
          })
          .eq("id", eventId);
      }
      return counters;
    }


    // 2) Estoque
    try {
      await persistProgress({ phase: "estoque" });
      await syncStock(orgId, sinceEstoque, counters);
    } catch (e: any) {
      counters.errors.push({ scope: "stock.list", message: e?.message ?? String(e) });
    }

    // Atualiza cursor
    await supabaseAdmin
      .from("olist_sync_state")
      .upsert({
        organization_id: orgId,
        last_updated_produtos_at: startedAt.toISOString(),
        last_updated_estoque_at: startedAt.toISOString(),
      });

    if (eventId) {
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: counters.errors.length > 0 && counters.products_created + counters.products_updated === 0 ? "erro" : "processado",
          processed_at: new Date().toISOString(),
          payload: {
            ...counters,
            started_at: startedAt.toISOString(),
            finished_at: new Date().toISOString(),
            products_total: productsTotal || productsProcessed,
            products_processed: productsProcessed,
          },
        })
        .eq("id", eventId);
    }

  } catch (e: any) {
    if (eventId) {
      await supabaseAdmin
        .from("integration_events")
        .update({
          status: "erro",
          processed_at: new Date().toISOString(),
          error_message: e?.message ?? String(e),
          payload: { ...counters, fatal: e?.message ?? String(e) },
        })
        .eq("id", eventId);
    }
    throw e;
  }

  return counters;
}
