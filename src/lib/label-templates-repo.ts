import { supabase } from "@/integrations/supabase/client";
import type { LabelTemplate } from "@/lib/label-pdf";
import { DEFAULT_EXCHANGE_POLICY } from "@/lib/label-pdf";

/** Uma linha de `label_templates`, já convertida para o formato usado pelo gerador de PDF. */
export type CustomLabelTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  template: LabelTemplate;
};

type LabelTemplateRow = {
  id: string;
  organization_id: string;
  name: string;
  width: number;
  height: number;
  margin_top: number;
  margin_right: number;
  margin_bottom: number;
  margin_left: number;
  font_family: string;
  font_size: number;
  show_name: boolean;
  show_color: boolean;
  show_size: boolean;
  show_sku: boolean;
  show_barcode: boolean;
  show_price: boolean;
  layout: string;
  policy_text: string | null;
  columns: number;
  column_spacing: number | null;
  is_default: boolean;
  status: string;
};

function rowToCustomTemplate(row: LabelTemplateRow): CustomLabelTemplate {
  return {
    id: row.id,
    name: row.name,
    is_default: row.is_default,
    template: {
      width: Number(row.width),
      height: Number(row.height),
      margin_top: Number(row.margin_top),
      margin_right: Number(row.margin_right),
      margin_bottom: Number(row.margin_bottom),
      margin_left: Number(row.margin_left),
      font_family: row.font_family,
      font_size: Number(row.font_size),
      show_name: row.show_name,
      show_color: row.show_color,
      show_size: row.show_size,
      show_sku: row.show_sku,
      show_barcode: row.show_barcode,
      show_price: row.show_price,
      layout: (row.layout as LabelTemplate["layout"]) ?? "qsf-standard",
      policy_text: row.policy_text ?? DEFAULT_EXCHANGE_POLICY,
      columns: row.columns ?? 1,
      column_spacing: row.column_spacing ?? undefined,
    },
  };
}

/** Busca os modelos de etiqueta ativos da organização do usuário logado. */
export async function listLabelTemplates(): Promise<CustomLabelTemplate[]> {
  const { data, error } = await supabase
    .from("label_templates")
    .select(
      "id, organization_id, name, width, height, margin_top, margin_right, margin_bottom, margin_left, font_family, font_size, show_name, show_color, show_size, show_sku, show_barcode, show_price, layout, policy_text, columns, column_spacing, is_default, status",
    )
    .eq("status", "ativo")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data as LabelTemplateRow[]).map(rowToCustomTemplate);
}

export type LabelTemplateInput = {
  name: string;
  template: LabelTemplate;
};

async function getOrganizationId(): Promise<string> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("Usuário não autenticado.");
  const prof = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
  const orgId = prof.data?.organization_id;
  if (!orgId) throw new Error("Organização não encontrada para o usuário.");
  return orgId;
}

function toRowPayload(input: LabelTemplateInput) {
  const t = input.template;
  return {
    name: input.name,
    width: t.width,
    height: t.height,
    margin_top: t.margin_top,
    margin_right: t.margin_right,
    margin_bottom: t.margin_bottom,
    margin_left: t.margin_left,
    font_family: t.font_family || "helvetica",
    font_size: t.font_size,
    show_name: t.show_name,
    show_color: t.show_color,
    show_size: t.show_size,
    show_sku: t.show_sku,
    show_barcode: t.show_barcode,
    show_price: t.show_price,
    layout: t.layout ?? "qsf-standard",
    policy_text: t.policy_text ?? null,
    columns: Math.max(1, Math.floor(t.columns ?? 1)),
    column_spacing: t.columns && t.columns > 1 ? t.column_spacing ?? null : null,
  };
}

/** Cria um novo modelo customizado para a organização do usuário logado. */
export async function createLabelTemplate(input: LabelTemplateInput): Promise<string> {
  const organization_id = await getOrganizationId();
  const { data, error } = await supabase
    .from("label_templates")
    .insert({ ...toRowPayload(input), organization_id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Atualiza um modelo customizado existente (precisa pertencer à organização do usuário). */
export async function updateLabelTemplate(id: string, input: LabelTemplateInput): Promise<void> {
  const { error } = await supabase.from("label_templates").update(toRowPayload(input)).eq("id", id);
  if (error) throw error;
}

/** Desativa (soft delete) um modelo customizado. */
export async function deactivateLabelTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("label_templates").update({ status: "inativo" }).eq("id", id);
  if (error) throw error;
}
